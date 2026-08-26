#!/usr/bin/env python3
import argparse
import contextlib
import os
import re
import time

import psycopg
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv
from google import genai

# Load environment variables
load_dotenv()
SUPABASE_CONN = os.getenv("SUPABASE_CONN")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

GEMINI_MODEL = "gemini-2.0-flash-lite"

# Problem types
PROBLEM_TYPES = [
    "geometry",
    "string",
    "tree",
    "math",
    "graph",
    "queries",
    "array",
    "misc",
]


class ProblemFetcher:
    """Class to fetch problem details from different platforms"""

    @staticmethod
    def get_problem_source(url):
        """Determine the problem source based on URL"""
        if "dmoj.ca" in url:
            return "dmoj"
        return "kattis" if "kattis.com" in url else "codeforces"

    @staticmethod
    def extract_codeforces_info(url):
        """Extract problem information from a Codeforces URL"""
        # Handle shorthand "CF" format (e.g., "CF 1794E")
        cf_short_pattern = r"^CF\s*(\d+)([A-Z\d]+)$"
        cf_short_match = re.match(cf_short_pattern, url, re.IGNORECASE)
        if cf_short_match:
            contest_id = cf_short_match.group(1)
            index = cf_short_match.group(2)
            return {
                "contestId": contest_id,
                "index": index,
                "problemId": f"{contest_id}{index}",
                "url": f"https://codeforces.com/contest/{contest_id}/problem/{index}",
            }

        # Handle shorthand "GYM" format (e.g., "GYM 102253C")
        gym_short_pattern = r"^GYM\s*(\d+)([A-Z\d]+)$"
        gym_short_match = re.match(gym_short_pattern, url, re.IGNORECASE)
        if gym_short_match:
            contest_id = gym_short_match.group(1)
            index = gym_short_match.group(2)
            return {
                "contestId": contest_id,
                "index": index,
                "problemId": f"G{contest_id}{index}",
                "url": f"https://codeforces.com/gym/{contest_id}/problem/{index}",
            }

        # Clean URL
        clean_url = re.sub(r"^(https?:\/\/)?(www\.)?", "", url)

        # Match different Codeforces URL patterns
        contest_pattern = (
            r"(?:mirror\.)?codeforces\.com\/contest\/(\d+)\/problem\/([A-Z\d]+)"
        )
        problemset_pattern = (
            r"(?:mirror\.)?codeforces\.com\/problemset\/problem\/(\d+)\/([A-Z\d]+)"
        )
        gym_pattern = r"(?:mirror\.)?codeforces\.com\/gym\/(\d+)\/problem\/([A-Z\d]+)"

        contest_match = re.search(contest_pattern, clean_url)
        problemset_match = re.search(problemset_pattern, clean_url)
        gym_match = re.search(gym_pattern, clean_url)

        match = contest_match or problemset_match or gym_match

        if not match:
            return None

        is_gym = bool(gym_match)

        normalized_url = (
            f"https://codeforces.com/gym/{match.group(1)}/problem/{match.group(2)}"
            if is_gym
            else f"https://codeforces.com/contest/{match.group(1)}/problem/{match.group(2)}"
        )

        return {
            "contestId": match.group(1),
            "index": match.group(2),
            "problemId": f"{'G' if is_gym else ''}{match.group(1)}{match.group(2)}",
            "url": normalized_url,
        }

    @staticmethod
    def extract_kattis_info(url):
        """Extract problem information from a Kattis URL"""
        # Handle bare problem ID
        if re.match(r"^[a-z0-9]+$", url):
            problem_id = url
            return {
                "problemId": problem_id,
                "url": f"https://open.kattis.com/problems/{problem_id}",
            }

        # Clean URL
        clean_url = re.sub(r"^(https?:\/\/)?(www\.)?", "", url)

        # Match Kattis URL pattern
        kattis_pattern = r"(?:open\.)?kattis\.com\/problems\/([a-z0-9]+)"
        match = re.search(kattis_pattern, clean_url)

        if not match:
            return None

        problem_id = match.group(1)
        return {
            "problemId": problem_id,
            "url": f"https://open.kattis.com/problems/{problem_id}",
        }

    @staticmethod
    def extract_dmoj_info(url):
        """Extract problem information from a DMOJ URL"""
        # Bare codes are rejected here for the same reason the web ingestion
        # rejects them: DMOJ codes are opaque, so any stray word would match.
        clean_url = re.sub(r"^(https?:\/\/)?(www\.)?", "", url)

        match = re.search(r"^dmoj\.ca\/problem\/([a-z0-9_]+)$", clean_url)

        if not match:
            return None

        problem_id = match.group(1)
        return {
            "problemId": problem_id,
            "url": f"https://dmoj.ca/problem/{problem_id}",
        }

    @staticmethod
    def fetch_codeforces_problem(problem_info):
        """Fetch problem data from Codeforces API and website"""
        is_gym = "gym" in problem_info["url"]

        # First get basic info from API
        api_url = (
            f"https://codeforces.com/api/contest.standings?contestId={problem_info['contestId']}&from=1&count=1&gym=true"
            if is_gym
            else f"https://codeforces.com/api/contest.standings?contestId={problem_info['contestId']}&from=1&count=1"
        )

        try:
            response = requests.get(api_url)
            data = response.json()

            if data["status"] != "OK":
                print(f"API error: {data.get('comment', 'Unknown error')}")
                return None

            problem = next(
                (
                    p
                    for p in data["result"]["problems"]
                    if p["index"] == problem_info["index"]
                ),
                None,
            )

            if not problem and is_gym:
                # For gym problems with no API data, create minimal info
                problem = {
                    "name": f"Problem {problem_info['index']} from Gym Contest {problem_info['contestId']}",
                    "tags": ["gym"],
                }
            elif not problem:
                print("Problem not found in API response")
                return None
            else:
                problem = {"name": problem["name"], "tags": problem.get("tags", [])}

            # Now fetch the problem statement from the website
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            response = requests.get(problem_info["url"], headers=headers)

            if response.status_code != 200:
                print(
                    f"Failed to fetch Codeforces problem statement: HTTP {response.status_code}"
                )
                problem["statement"] = ""
                return problem

            soup = BeautifulSoup(response.text, "html.parser")

            # Extract problem statement
            statement_div = soup.select_one(".problem-statement")
            if statement_div:
                # Remove input and output sections to focus on the problem description
                for section in statement_div.select(
                    ".input-specification, .output-specification, .sample-tests"
                ):
                    if section:
                        section.decompose()

                statement = statement_div.get_text(strip=True, separator=" ")
                problem["statement"] = statement
            else:
                problem["statement"] = ""
                print(f"Could not find problem statement for {problem_info['url']}")

            return problem

        except Exception as e:
            print(f"Error fetching from Codeforces: {e}")
            return None

    @staticmethod
    def fetch_kattis_problem(problem_info):
        """Fetch problem data from Kattis website"""
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            response = requests.get(problem_info["url"], headers=headers)

            if response.status_code != 200:
                print(f"Failed to fetch Kattis problem: HTTP {response.status_code}")
                return None

            soup = BeautifulSoup(response.text, "html.parser")

            # Extract problem name
            problem_name = soup.find("h1")
            name = (
                problem_name.text.strip()
                if problem_name
                else problem_info["problemId"].replace("-", " ").title()
            )

            # Try to extract tags (Kattis doesn't have official tags, so we'll use keywords from the problem statement)
            problem_text = soup.find("div", class_="problembody")
            keywords = []
            statement = ""

            if problem_text:
                # Extract the problem statement
                statement = problem_text.get_text(strip=True, separator=" ")

                # Look for common algorithm keywords
                text_content = statement.lower()
                for keyword in ["array", "string", "tree", "graph", "math", "geometry"]:
                    if keyword in text_content:
                        keywords.append(keyword)

            return {"name": name, "tags": keywords, "statement": statement}

        except Exception as e:
            print(f"Error fetching from Kattis: {e}")
            return None

    @staticmethod
    def fetch_dmoj_problem(problem_info):
        """Fetch problem data from the DMOJ API

        DMOJ problem pages are behind bot protection, so metadata comes from
        the public API instead. It carries no statement text, so classification
        falls back to the name and types alone.
        """
        try:
            headers = {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36"
            }
            api_url = f"https://dmoj.ca/api/v2/problem/{problem_info['problemId']}"
            response = requests.get(api_url, headers=headers)

            if response.status_code != 200:
                print(f"Failed to fetch DMOJ problem: HTTP {response.status_code}")
                return None

            problem = response.json().get("data", {}).get("object", {})

            name = (problem.get("name") or "").strip() or problem_info["problemId"]
            types = [t for t in problem.get("types", []) if isinstance(t, str)]

            return {"name": name, "tags": types, "statement": ""}

        except Exception as e:
            print(f"Error fetching from DMOJ: {e}")
            return None

    @classmethod
    def fetch_problem_details(cls, problem_id, url):
        """Fetch problem details based on URL"""
        source = cls.get_problem_source(url)

        if source == "codeforces":
            problem_info = cls.extract_codeforces_info(url)
            if not problem_info:
                print(f"Invalid Codeforces URL: {url}")
                return None
            return cls.fetch_codeforces_problem(problem_info)

        elif source == "kattis":
            problem_info = cls.extract_kattis_info(url)
            if not problem_info:
                print(f"Invalid Kattis URL: {url}")
                return None
            return cls.fetch_kattis_problem(problem_info)

        elif source == "dmoj":
            problem_info = cls.extract_dmoj_info(url)
            if not problem_info:
                print(f"Invalid DMOJ URL: {url}")
                return None
            return cls.fetch_dmoj_problem(problem_info)

        return None


def is_degraded_metadata(name, url):
    """Whether a row still carries the bare problem code the submit flow stores
    when provider metadata could not be fetched."""
    info = ProblemFetcher.extract_dmoj_info(url)
    return bool(info) and name == info["problemId"]


def classify_problem(name, tags, statement="", client=None):
    """Use Gemini to classify a problem based on its name, tags, and statement."""
    # Truncate statement if it's too long (Gemini has context limits)
    max_statement_length = 10000
    if statement and len(statement) > max_statement_length:
        statement = statement[:max_statement_length] + "..."

    prompt = f"""
    Given the following competitive programming problem, classify it into ONE of these types:
    {", ".join(PROBLEM_TYPES)}

    Problem name: {name}
    Problem tags: {", ".join(tags) if tags else "None"}

    Problem statement:
    {statement if statement else "Not available"}

    IMPORTANT: Choose the FIRST category in the list that applies to this problem.
    For example, if a problem could be both "geometry" and "math", choose "geometry"
    since it appears first in the list.

    Return only the type name, nothing else.
    """

    try:
        gemini_client = client or genai.Client(api_key=GEMINI_API_KEY)
        response = gemini_client.models.generate_content(
            model=GEMINI_MODEL, contents=prompt
        )
        problem_type = response.text.strip().lower()

        # Validate the response is one of our types
        if problem_type not in PROBLEM_TYPES:
            print(
                f"Warning: Invalid classification '{problem_type}' for problem '{name}'. Using 'misc' as default."
            )
            return "misc"

        return problem_type
    except Exception as e:
        print(f"Error classifying problem '{name}': {e}")
        return "misc"


def main():
    parser = argparse.ArgumentParser(description="Classify problems in the database")
    parser.add_argument(
        "--all",
        action="store_true",
        help="Process all problems, not just those with NULL type",
    )
    parser.add_argument(
        "--fetch-details",
        action="store_true",
        help="Fetch problem details from source websites",
    )
    parser.add_argument(
        "--batch-size",
        type=int,
        default=50,
        help="Number of problems to process in a batch (to avoid rate limiting)",
    )
    parser.add_argument(
        "--delay",
        type=float,
        default=2.0,
        help="Delay in seconds between API calls",
    )
    parser.add_argument(
        "--backfill-only",
        action="store_true",
        help="Only repair DMOJ rows stored without provider metadata, leaving type untouched (needs no Gemini key)",
    )
    args = parser.parse_args()

    # Connect to the database using psycopg3
    with contextlib.ExitStack() as stack:
        gemini_client = (
            None
            if args.backfill_only
            else stack.enter_context(genai.Client(api_key=GEMINI_API_KEY))
        )
        conn = stack.enter_context(psycopg.connect(SUPABASE_CONN))

        # Create a cursor
        with conn.cursor() as cursor:
            try:
                # Query problems
                if args.backfill_only:
                    # Only DMOJ rows can be degraded, so leave the rest alone.
                    cursor.execute(
                        "SELECT id, name, tags, url FROM problems WHERE url LIKE '%dmoj.ca%'"
                    )
                elif args.all:
                    cursor.execute("SELECT id, name, tags, url FROM problems")
                else:
                    cursor.execute(
                        "SELECT id, name, tags, url FROM problems WHERE type IS NULL"
                    )

                problems = cursor.fetchall()

                if not problems:
                    print("No problems found to classify.")
                    return

                verb = "check" if args.backfill_only else "classify"
                print(f"Found {len(problems)} problems to {verb}.")

                # Process problems in batches to avoid rate limiting
                for i in range(0, len(problems), args.batch_size):
                    batch = problems[i : i + args.batch_size]
                    print(
                        f"Processing batch {i // args.batch_size + 1}/{(len(problems) - 1) // args.batch_size + 1} ({len(batch)} problems)"
                    )

                    # Process each problem in the batch
                    for problem_id, name, tags, url in batch:
                        print(f"Processing problem: {name}")

                        statement = ""
                        # Always fetch details to get the problem statement
                        print(
                            f"  Fetching details from {ProblemFetcher.get_problem_source(url)}..."
                        )
                        details = ProblemFetcher.fetch_problem_details(problem_id, url)

                        if details and "statement" in details:
                            statement = details["statement"]
                            print(
                                f"  Retrieved problem statement ({len(statement)} characters)"
                            )
                        else:
                            print("  Could not retrieve problem statement")

                        # A row whose name is still its bare problem code was
                        # stored without provider metadata, so refresh it here.
                        if details and is_degraded_metadata(name, url):
                            name = details["name"]
                            tags = details["tags"]
                            cursor.execute(
                                "UPDATE problems SET name = %s, tags = %s WHERE id = %s",
                                (name, tags, problem_id),
                            )
                            print(f"  → Backfilled metadata: {name}")

                        # Add a delay to avoid rate limiting
                        time.sleep(args.delay)

                        if args.backfill_only:
                            continue

                        # Classify the problem
                        problem_type = classify_problem(
                            name, tags, statement, client=gemini_client
                        )
                        print(f"  → Classified as: {problem_type}")

                        # Update the database
                        cursor.execute(
                            "UPDATE problems SET type = %s WHERE id = %s",
                            (problem_type, problem_id),
                        )

                    # Commit after each batch
                    conn.commit()
                    print(f"Batch {i // args.batch_size + 1} completed and committed.")

                print(f"Successfully processed {len(problems)} problems.")

            except Exception as e:
                # Rollback happens automatically with context manager on exception
                print(f"Error: {e}")


if __name__ == "__main__":
    main()
