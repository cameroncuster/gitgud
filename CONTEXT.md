# Project context

## Domain vocabulary

- **Problem**: a tracked competitive-programming problem from Codeforces or Kattis.
- **Contest**: a tracked programming contest; participation is a per-user marker.
- **Reaction**: a current user's like or dislike. Repeating the same reaction undoes it.
- **Solved**: a per-user marker on a problem, independent of the aggregate `solved` count.
- **Actor**: the signed-in browser user and resolved admin role.
- **Leaderboard entry**: a public ranked user returned by `get_leaderboard`.

## Intentional interaction differences

- Problem reactions update optimistically; an ordinary successful RPC response with no row leaves that optimistic state in place.
- Contest reactions update only after the server returns the updated contest.
- Problem solved state updates optimistically and reloads the actor's solved set after a failed write.
- Contest participation updates only after the write succeeds.
- Public list read failures are logged server-side and render the existing safe empty table or shell.

Public problem, contest, and leaderboard reads live in `src/lib/queries`. Current-user reads remain browser-side. Browser identity/session ownership lives in `src/lib/auth/currentActor.ts`; bearer authorization for protected server handlers lives in `src/lib/server/authorization.ts`.
