<p align="center">
  <a href="https://www.gitgud.cc">
    <img src="static/favicon.png" width="144" height="144" alt="gitgud ninja mark">
  </a>
</p>

<h1 align="center">gitgud</h1>

<p align="center">
  <a href="#quality">
    <img src="https://img.shields.io/badge/TypeScript%20coverage-100%25%20lines%20%7C%20branches%20%7C%20functions-brightgreen" alt="TypeScript coverage: 100% lines, branches, and functions">
  </a>
</p>

gitgud is a community-curated collection for competitive programmers who want to practice beyond the fundamentals. Problem archives are enormous, but problem quality varies. gitgud helps surface the problems that teach something memorable.

## Canon Problems

Inspired by "Canon Events" from _Across the Spider-Verse_, **Canon Problems** are the problems that fundamentally change how you approach competitive programming.

gitgud brings those problems together through community recommendations, making it easier to spend your practice time on ideas and techniques worth learning. Explore recommendations from [Codeforces](https://codeforces.com/) and [Kattis](https://open.kattis.com/), find contests, and track the problems you've solved.

## New to competitive programming?

Start with the fundamentals:

- [CSES Problem Set](https://cses.fi/)
- [CP-Algorithms](https://cp-algorithms.com/)
- [USACO Guide](https://usaco.guide/)
- [AtCoder Educational DP Contest](https://atcoder.jp/contests/dp)
- [Codeforces EDU](https://codeforces.com/edu/courses)

Once you're ready to work through a problem archive, read [Um_nik's guide to practicing competitive programming](https://codeforces.com/blog/entry/98806)—then come find the problems the community believes are worth your time.

## Quality

The instrumented TypeScript runtime (`src/**/*.ts`) is held to 100% line, branch,
and function coverage. CI enforces the thresholds on Node 24:

```bash
pnpm run test:coverage
```

New behavior should ship with regression coverage that keeps this scope at 100%.

## Contribute

gitgud is open source. [Issues and pull requests](https://github.com/cameroncuster/gitgud) are welcome.

Released under the [MIT License](LICENSE). gitgud is an independent community project and is not affiliated with Codeforces or Kattis.
