# Repository guidelines

These instructions apply to every contributor and coding agent working in this repository.

## Development

- Use the Node.js version pinned in `.nvmrc` and pnpm 10.
- Keep pull requests focused on one logical change and avoid unrelated refactors.
- Use SvelteKit and TypeScript conventions already present in the surrounding code.
- Use Tailwind CSS v4 and the semantic theme variables in `src/app.css` for interface styling.
- Preserve responsive behavior, keyboard access, visible focus, semantic HTML, and both Paper and Dark Ink themes.
- Do not add a dependency unless the change clearly requires it and the maintainer has approved it.

## Database and security

- Treat `sql/` as the source of truth for the PostgreSQL schema, functions, Row Level Security policies, and grants.
- Follow `sql/README.md` for applying and verifying database changes.
- Use psycopg 3 for Python database scripts.
- Never expose a Supabase service-role key through `PUBLIC_*` variables or browser code.
- Test database changes only against isolated test data. Never alter existing production records during development or verification.
- Keep server-side proxy endpoints allowlisted and bounded; do not accept arbitrary upstream URLs.

## Validation

Run the checks relevant to the changed surface before requesting review:

```bash
pnpm run lint
pnpm run lint:es
pnpm run check
pnpm run test
pnpm run build
pnpm run test:e2e
```

- Add focused regression coverage for behavior changes.
- Keep Playwright runs deterministic. Live smoke tests must be explicitly opt-in and read-only unless an isolated test fixture owns every mutation.
- Do not weaken Row Level Security, permission checks, or tests to make a change pass.
