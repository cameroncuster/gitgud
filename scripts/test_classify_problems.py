import unittest
from types import SimpleNamespace
from unittest.mock import patch

from classify_problems import (
    GEMINI_MODEL,
    ProblemFetcher,
    classify_problem,
    is_degraded_metadata,
)


class FakeModels:
    def __init__(self, response_text=None, error=None):
        self.response_text = response_text
        self.error = error
        self.calls = []

    def generate_content(self, *, model, contents):
        self.calls.append({"model": model, "contents": contents})
        if self.error:
            raise self.error
        return SimpleNamespace(text=self.response_text)


class FakeClient:
    def __init__(self, response_text=None, error=None):
        self.models = FakeModels(response_text=response_text, error=error)


class ClassifyProblemTest(unittest.TestCase):
    def test_uses_supported_genai_client_and_normalizes_response(self):
        client = FakeClient(response_text=" Graph \n")

        result = classify_problem(
            "Shortest Path", ["graphs"], "Find the shortest route.", client=client
        )

        self.assertEqual(result, "graph")
        self.assertEqual(client.models.calls[0]["model"], GEMINI_MODEL)
        self.assertIn("Problem name: Shortest Path", client.models.calls[0]["contents"])

    def test_invalid_response_falls_back_to_misc(self):
        client = FakeClient(response_text="dynamic programming")

        self.assertEqual(classify_problem("Example", [], client=client), "misc")

    def test_sdk_error_falls_back_to_misc(self):
        client = FakeClient(error=RuntimeError("offline"))

        self.assertEqual(classify_problem("Example", [], client=client), "misc")


class FakeResponse:
    def __init__(self, status_code=200, payload=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}

    def json(self):
        return self._payload


class DmojFetcherTest(unittest.TestCase):
    def test_source_detection_covers_all_three_providers(self):
        self.assertEqual(
            ProblemFetcher.get_problem_source("https://dmoj.ca/problem/ciw26p2"), "dmoj"
        )
        self.assertEqual(
            ProblemFetcher.get_problem_source("https://open.kattis.com/problems/hello"),
            "kattis",
        )
        self.assertEqual(
            ProblemFetcher.get_problem_source(
                "https://codeforces.com/contest/1/problem/A"
            ),
            "codeforces",
        )

    def test_extracts_only_fully_qualified_dmoj_urls(self):
        for url in [
            "https://dmoj.ca/problem/ciw26p2",
            "https://www.dmoj.ca/problem/ciw26p2",
            "dmoj.ca/problem/ciw26p2",
        ]:
            self.assertEqual(
                ProblemFetcher.extract_dmoj_info(url),
                {
                    "problemId": "ciw26p2",
                    "url": "https://dmoj.ca/problem/ciw26p2",
                },
            )

        for url in [
            "ciw26p2",
            "https://dmoj.ca/problem/CIW26P2",
            "https://evil.example/dmoj.ca/problem/ciw26p2",
            "https://dmoj.ca/problem/ciw26p2/extra",
        ]:
            self.assertIsNone(ProblemFetcher.extract_dmoj_info(url), url)

    def test_reads_name_and_types_from_the_api_payload(self):
        payload = {
            "data": {"object": {"name": "CIW '26 P2", "types": ["Simulation", 7]}}
        }
        with patch(
            "classify_problems.requests.get", return_value=FakeResponse(payload=payload)
        ) as get:
            details = ProblemFetcher.fetch_dmoj_problem({"problemId": "ciw26p2"})

        self.assertEqual(
            details, {"name": "CIW '26 P2", "tags": ["Simulation"], "statement": ""}
        )
        self.assertEqual(
            get.call_args[0][0], "https://dmoj.ca/api/v2/problem/ciw26p2"
        )

    def test_missing_name_falls_back_to_the_problem_code(self):
        with patch(
            "classify_problems.requests.get",
            return_value=FakeResponse(payload={"data": {"object": {}}}),
        ):
            details = ProblemFetcher.fetch_dmoj_problem({"problemId": "ciw26p2"})

        self.assertEqual(details["name"], "ciw26p2")
        self.assertEqual(details["tags"], [])

    def test_upstream_and_transport_failures_return_none(self):
        with patch(
            "classify_problems.requests.get", return_value=FakeResponse(status_code=403)
        ):
            self.assertIsNone(ProblemFetcher.fetch_dmoj_problem({"problemId": "x"}))

        with patch(
            "classify_problems.requests.get", side_effect=RuntimeError("offline")
        ):
            self.assertIsNone(ProblemFetcher.fetch_dmoj_problem({"problemId": "x"}))

    def test_routes_dmoj_urls_through_the_api_fetcher(self):
        with patch.object(
            ProblemFetcher, "fetch_dmoj_problem", return_value={"name": "ok"}
        ) as fetch:
            details = ProblemFetcher.fetch_problem_details(
                1, "https://dmoj.ca/problem/ciw26p2"
            )

        self.assertEqual(details, {"name": "ok"})
        self.assertEqual(fetch.call_args[0][0]["problemId"], "ciw26p2")

        self.assertIsNone(
            ProblemFetcher.fetch_problem_details(1, "https://dmoj.ca/problem/BAD")
        )


class DegradedMetadataTest(unittest.TestCase):
    def test_only_a_bare_problem_code_counts_as_degraded(self):
        url = "https://dmoj.ca/problem/ciw26p2"
        self.assertTrue(is_degraded_metadata("ciw26p2", url))
        self.assertFalse(is_degraded_metadata("CIW '26 P2 - Number Shuffle", url))

    def test_non_dmoj_rows_are_never_treated_as_degraded(self):
        # Guards the backfill from touching curated Kattis and Codeforces names.
        self.assertFalse(
            is_degraded_metadata("hello", "https://open.kattis.com/problems/hello")
        )
        self.assertFalse(
            is_degraded_metadata(None, "https://codeforces.com/contest/1/problem/A")
        )


if __name__ == "__main__":
    unittest.main()
