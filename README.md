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
</p>

gitgud helps competitive programmers find problems worth solving. Explore community recommendations from [Codeforces](https://codeforces.com/) and [Kattis](https://open.kattis.com/), filter by topic and difficulty, track progress, and discover contests and top problem solvers.

## Features

- Curated problems and contests with community feedback
- Topic, source, author, status, and difficulty filters
- GitHub sign-in, progress tracking, profiles, and leaderboard
- Responsive Paper and Dark Ink themes

See [VISION.md](VISION.md) for the product direction.

## Run locally

Requires Node.js 24 and pnpm 10.

```bash
git clone https://github.com/cameroncuster/gitgud.git
cd gitgud
corepack enable
pnpm install --frozen-lockfile
cat > .env <<'EOF'
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-key
EOF
pnpm dev
```

Set `PUBLIC_SUPABASE_URL` and the client-safe `PUBLIC_SUPABASE_PUBLISHABLE_KEY` in `.env`. Never expose a secret or service-role key. For a new database, follow the [SQL guide](sql/README.md).

## Validate

```bash
pnpm run lint
pnpm run lint:es
pnpm run check
pnpm run test
pnpm run test:coverage
pnpm run build
pnpm run check:performance
pnpm run test:performance
pnpm run test:e2e
```

CI runs the required quality, coverage, production build/performance, and desktop/mobile Playwright
checks in parallel on Node.js 24. `test:coverage` measures every production TypeScript module under
`src/`, including route modules, and enforces 98% lines, 95% branches, and 98% functions. It excludes
only declaration files and does not claim execution coverage for Svelte components. After a
production build, `check:performance` checks the existing Vercel output without rebuilding;
`test:performance` performs both steps. The performance checks cover immutable JS/CSS and the
deterministic full 280-problem homepage HTML fixture budgets. Live read-only Supabase smoke tests run
when CI has the required repository variable and secret; otherwise those optional jobs exit cleanly.

## Contributing

Focused issues and pull requests are welcome. Read [AGENTS.md](AGENTS.md) for the development, security, database, and validation rules.

## License

Released under the [MIT License](LICENSE). gitgud is an independent community project and is not affiliated with Codeforces or Kattis.
