# gitgud database

This directory is the source of truth for gitgud's PostgreSQL schema, Row Level Security policies, database functions, and explicit grants.

> **Safety:** run schema changes against a disposable or development Supabase project first. Never test by changing existing production records.

## Apply the schema

`init.sql` uses `psql`'s `\ir` include command, so run it through `psql` from the repository root:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/init.sql
```

`DATABASE_URL` should come from a protected local environment or password file. Do not paste database credentials into shell history, source files, issues, or pull requests.

The Supabase dashboard SQL editor does **not** interpret `\ir`. If you use the dashboard, execute the files in the order listed by [`init.sql`](init.sql), ending with [`permissions.sql`](permissions.sql).

## Verify permissions

After applying the schema, run the read-only permission checks:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f sql/verify_permissions.sql
```

Review every reported grant and policy before using the project with real data. Anonymous users should receive only the public reads and RPC execution the application requires; authenticated mutations must remain scoped by Row Level Security.

## Layout

| Path                                | Purpose                                                   |
| ----------------------------------- | --------------------------------------------------------- |
| `init.sql`                          | Ordered entry point for the complete schema               |
| `permissions.sql`                   | Least-privilege grants, applied after all objects exist   |
| `verify_permissions.sql`            | Read-only grant and policy verification                   |
| `cleanup_legacy_feedback_shims.sql` | One-off, idempotent removal of retired feedback overloads |
| `auth/`                             | User roles, preferences, profile triggers, and policies   |
| `problems/`                         | Problem catalog, feedback, solved state, and RPCs         |
| `contests/`                         | Contest catalog, feedback, participation, and RPCs        |
| `leaderboard/`                      | Public leaderboard functions                              |
| `common/`                           | Shared database utilities                                 |

## Schema summary

### Authentication and profiles

- `user_roles` controls administrative capabilities.
- `user_preferences` stores user-level display and privacy choices.
- Authentication triggers create the corresponding application records.

### Problems

- `problems` stores the curated cross-platform catalog.
- `user_problem_feedback` stores one user's like/dislike state.
- `user_solved_problems` tracks personal progress.
- Problem functions centralize authorized feedback and catalog mutations.

### Contests

- `contests` stores recommended contests.
- `user_contest_feedback` stores one user's like/dislike state.
- `user_contest_participation` tracks participation.
- Contest functions centralize authorized feedback and catalog mutations.

### Leaderboard

Leaderboard functions expose the public ranking data used by the application without granting broad table access.

## Change checklist

For every database change:

1. Update the relevant table or function file.
2. Keep [`init.sql`](init.sql) ordered and complete.
3. Update [`permissions.sql`](permissions.sql) when an object's access contract changes.
4. Extend [`verify_permissions.sql`](verify_permissions.sql) for new grants, revocations, or policies.
5. Validate on an isolated database.
6. Confirm anonymous and authenticated roles cannot cross account or administrative boundaries.

See the [project README](../README.md) for application setup and the [MIT License](../LICENSE) for licensing.
