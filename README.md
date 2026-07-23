<p align="center">
  <a href="https://www.gitgud.cc">
    <img src="static/favicon.png" width="144" height="144" alt="gitgud ninja mark">
  </a>
</p>

<h1 align="center">gitgud</h1>

<p align="center">
  Community-curated competitive programming problems and contests.
  <br>
  <a href="https://www.gitgud.cc"><strong>Visit gitgud.cc</strong></a>
  ·
  <a href="VISION.md">Vision</a>
  ·
  <a href="LICENSE">MIT License</a>
</p>

<p align="center">
  <a href="https://github.com/cameroncuster/gitgud/actions/workflows/ci.yml"><img src="https://github.com/cameroncuster/gitgud/actions/workflows/ci.yml/badge.svg" alt="CI status"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/cameroncuster/gitgud" alt="MIT license"></a>
  <a href="https://www.gitgud.cc"><img src="https://img.shields.io/badge/site-gitgud.cc-355d7a" alt="Live site"></a>
</p>

## What is gitgud?

gitgud helps competitive programmers discover problems worth solving. The catalog combines community recommendations with source, difficulty, topic, and feedback signals so practice can be intentional rather than random.

The live application currently includes:

- Curated problems from [Codeforces](https://codeforces.com/) and [Kattis](https://open.kattis.com/)
- Recommended contests, with source, duration, difficulty, and participation tracking
- Topic, source, author, solved-status, and difficulty controls
- Community likes and dislikes for problems and contests
- GitHub authentication, solved-problem tracking, profiles, settings, and a leaderboard
- Responsive Paper and Dark Ink themes

Read [VISION.md](VISION.md) for the longer-term product direction.

## Technology

- [SvelteKit](https://svelte.dev/docs/kit) and TypeScript
- [Tailwind CSS](https://tailwindcss.com/)
- [Supabase](https://supabase.com/) / PostgreSQL with Row Level Security
- [Vercel](https://vercel.com/) for the production deployment
- [Playwright](https://playwright.dev/) and Node's test runner

## Local development

### Prerequisites

- Node.js 22 (the pinned version is in [`.nvmrc`](.nvmrc))
- pnpm 10
- A Supabase project for database-backed development

### Setup

1. Clone and install the project:

   ```bash
   git clone https://github.com/cameroncuster/gitgud.git
   cd gitgud
   corepack enable
   pnpm install --frozen-lockfile
   ```

2. Create `.env` with the client-safe Supabase values:

   ```dotenv
   PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
   ```

   Never use a Supabase service-role key in a `PUBLIC_*` variable.

3. Apply the database schema if you are provisioning a new project. See [the SQL guide](sql/README.md) before running any database command.

4. Start the development server:

   ```bash
   pnpm dev
   ```

   Vite prints the local URL, normally <http://localhost:5173>.

## Validation

Run the same core checks used by CI:

```bash
pnpm run lint
pnpm run lint:es
pnpm run check
pnpm run test
pnpm run build
pnpm run test:e2e
```

The Playwright suite is anonymous and read-only. It must not log in, submit content, or mutate remote data.

## End-to-end tests

The Playwright suite (`pnpm test:e2e`) has two layers:

- **Mocked suite (default).** A local mock Supabase server serves representative fixtures over the exact endpoints the app reads. Tests cover rendered problems, contests, leaderboard rows, links, filters, sorting, empty states, and backend failures without credentials or real data.
- **Live read-only smoke (opt-in).** The suite can load anonymous data from a live Supabase project. It performs only reads and must use the client-safe anon or publishable key—never a service-role key.

To run only the live layer locally:

```bash
SUPABASE_SMOKE=1 E2E_LIVE_ONLY=1 \
  PUBLIC_SUPABASE_URL=https://your-project.supabase.co \
  PUBLIC_SUPABASE_ANON_KEY=<anon key> \
  pnpm test:e2e
```

In CI, configure `PUBLIC_SUPABASE_URL` as an Actions variable and `PUBLIC_SUPABASE_ANON_KEY` as an Actions secret. The workflow detects both values before enabling the live step; when either is absent, the deterministic mocked suite still runs.

## Database

The complete schema lives under [`sql/`](sql/). It includes:

- User roles, preferences, and account triggers
- Problems, feedback, and solved-problem tracking
- Contests, feedback, and participation tracking
- Leaderboard and mutation functions
- Explicit least-privilege grants and verification queries

Apply and verify the schema using the commands in [`sql/README.md`](sql/README.md). Treat production data as immutable during development and testing.

## Continuous integration

GitHub Actions checks formatting, ESLint, Svelte types, unit tests, the deterministic Playwright suite, and the production build. The live read-only smoke runs only when its repository variable and secret are configured.

## Project structure

| Path                  | Purpose                                                |
| --------------------- | ------------------------------------------------------ |
| `src/routes/`         | SvelteKit pages, server loads, and API endpoints       |
| `src/lib/components/` | Shared interface components                            |
| `src/lib/services/`   | Supabase and external-platform integrations            |
| `sql/`                | PostgreSQL schema, functions, grants, and verification |
| `e2e/`                | Anonymous Playwright coverage                          |
| `tests/`              | Dependency-light unit and regression tests             |
| `static/`             | Site icons and source-platform artwork                 |

## Contributing

Issues and focused pull requests are welcome. Keep changes narrow, avoid unrelated refactors, and run the validation commands for the surfaces you change. Database changes must preserve Row Level Security and least-privilege grants.

## Security

Do not commit credentials or use elevated Supabase keys in client code. If you discover a vulnerability, report it privately to the repository owner rather than opening a public exploit report.

## License

Copyright © 2025 Cameron Custer. Released under the [MIT License](LICENSE).

Codeforces, Kattis, GitHub, Supabase, and Vercel are trademarks of their respective owners. gitgud is an independent community project.
