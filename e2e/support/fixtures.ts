// Representative Supabase fixtures for the deterministic Playwright suite.
//
// These rows mirror the exact snake_case shape the app's data services read
// from Supabase (see src/lib/queries/*Queries.ts) and are
// served by the mock Supabase server (mock-supabase.ts) so the suite can assert
// real rendered rows, links, filters, and sorts without touching production
// data. Each fixture maps 1:1 to a Supabase endpoint:
//
//   PROBLEMS      -> GET  /rest/v1/problems?select=...
//   CONTESTS      -> GET  /rest/v1/contests?select=...
//   LEADERBOARD   -> POST /rest/v1/rpc/get_leaderboard
//
// Values are chosen to exercise real UI logic: mixed sources (codeforces vs
// kattis), a null `type` (renders the "NEW!" badge), distinct like/dislike
// scores (drives the default score sort and the difficulty sort), and multiple
// recommenders (drives the author filter).

// Column shape matches PROBLEM_COLUMNS in src/lib/queries/problemQueries.ts.
export type ProblemRow = {
  id: string;
  name: string;
  difficulty: number | null;
  url: string;
  added_by: string;
  added_by_url: string;
  likes: number;
  dislikes: number;
  type: string | null;
};

// Column shape matches CONTEST_COLUMNS in src/lib/queries/contestQueries.ts.
export type ContestRow = {
  id: string;
  name: string;
  url: string;
  duration_seconds: number;
  difficulty: number | null;
  date_added: string;
  added_by: string;
  added_by_url: string;
  likes: number;
  dislikes: number;
  type: string | null;
};

// Shape matches the record in src/lib/queries/leaderboardQueries.ts (the
// get_leaderboard RPC return rows).
export type LeaderboardRow = {
  user_id: string;
  username: string;
  avatar_url: string;
  github_url: string;
  problems_solved: number;
  earliest_solves_sum: number;
  rank: number;
};

export const PROBLEMS: ProblemRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Fixture Alpha Problem',
    difficulty: 1500,
    url: 'https://codeforces.com/contest/1000/problem/A',
    added_by: 'alice',
    added_by_url: 'https://codeforces.com/profile/alice',
    likes: 10,
    dislikes: 1,
    type: 'graph'
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    name: 'Fixture Beta Problem',
    difficulty: 2100,
    url: 'https://codeforces.com/contest/1000/problem/B',
    added_by: 'bob',
    added_by_url: 'https://codeforces.com/profile/bob',
    likes: 3,
    dislikes: 0,
    type: 'math'
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    name: 'Fixture Gamma Kattis',
    difficulty: 800,
    url: 'https://open.kattis.com/problems/gamma',
    added_by: 'alice',
    added_by_url: 'https://codeforces.com/profile/alice',
    likes: 1,
    dislikes: 5,
    // Null type renders the "NEW!" badge rather than a topic chip.
    type: null
  }
];

export const LARGE_PROBLEMS: ProblemRow[] = Array.from({ length: 280 }, (_, index) => {
  const number = index + 1;
  const isLast = number === 280;
  return {
    id: `large-${String(number).padStart(3, '0')}`,
    name: isLast ? 'Full List Boundary Problem' : `Large Fixture Problem ${number}`,
    difficulty: isLast ? 700 : 1000 + number,
    url:
      number % 2 === 0
        ? `https://open.kattis.com/problems/large-${number}`
        : `https://codeforces.com/contest/2000/problem/${number}`,
    added_by: isLast ? 'full-list-author' : `author-${number % 10}`,
    added_by_url: `https://example.test/users/${isLast ? 'full-list-author' : `author-${number % 10}`}`,
    likes: 281 - number,
    dislikes: 0,
    type: number % 3 === 0 ? 'graph' : 'math'
  };
});

export const CONTESTS: ContestRow[] = [
  {
    id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Fixture Codeforces Round',
    url: 'https://codeforces.com/contest/1000',
    duration_seconds: 7200,
    difficulty: 3,
    date_added: '2024-01-01T00:00:00.000Z',
    added_by: 'carol',
    added_by_url: 'https://codeforces.com/profile/carol',
    likes: 12,
    dislikes: 2,
    type: 'Codeforces'
  },
  {
    id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    name: 'Fixture ICPC Regional',
    url: 'https://codeforces.com/gym/100000',
    duration_seconds: 18000,
    difficulty: 5,
    date_added: '2024-02-01T00:00:00.000Z',
    added_by: 'dave',
    added_by_url: 'https://codeforces.com/profile/dave',
    likes: 4,
    dislikes: 0,
    type: 'ICPC'
  }
];

export const LEADERBOARD: LeaderboardRow[] = [
  {
    user_id: '00000000-0000-0000-0000-0000000000a1',
    username: 'topsolver',
    avatar_url: '',
    github_url: 'https://github.com/topsolver',
    problems_solved: 123,
    earliest_solves_sum: 1000,
    rank: 1
  },
  {
    user_id: '00000000-0000-0000-0000-0000000000a2',
    username: 'runnerup',
    avatar_url: '',
    github_url: 'https://github.com/runnerup',
    problems_solved: 87,
    earliest_solves_sum: 2000,
    rank: 2
  },
  {
    user_id: '00000000-0000-0000-0000-0000000000a3',
    username: 'thirdplace',
    avatar_url: '',
    github_url: 'https://github.com/thirdplace',
    problems_solved: 45,
    earliest_solves_sum: 3000,
    rank: 3
  }
];
