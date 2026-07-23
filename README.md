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

Requires Node.js 22 and pnpm 10.

```bash
git clone https://github.com/cameroncuster/gitgud.git
cd gitgud
corepack enable
pnpm install --frozen-lockfile
cat > .env <<'EOF'
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-or-publishable-key
EOF
pnpm dev
```

Set `PUBLIC_SUPABASE_URL` and the client-safe `PUBLIC_SUPABASE_ANON_KEY` in `.env`. Never expose a service-role key. For a new database, follow the [SQL guide](sql/README.md).

## Validate

```bash
pnpm run lint
pnpm run lint:es
pnpm run check
pnpm run test
pnpm run build
pnpm run test:e2e
```

## Contributing

Focused issues and pull requests are welcome. Read [AGENTS.md](AGENTS.md) for the development, security, database, and validation rules.

## License

Released under the [MIT License](LICENSE). gitgud is an independent community project and is not affiliated with Codeforces or Kattis.
