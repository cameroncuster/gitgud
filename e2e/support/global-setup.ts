import { appendFileSync, readFileSync } from 'node:fs';
import { MOCK_HOST } from './constants.ts';

// The mocked E2E build is baked with a Supabase URL whose host is MOCK_HOST
// (gitgud-e2e.localhost). Browsers resolve *.localhost to loopback natively, but
// Node (which runs the SSR reads and the server-side admin recheck) does NOT, so
// the mock host must resolve to 127.0.0.1 for the Node process too. We ensure a
// loopback /etc/hosts entry once, before any server starts.
//
// Why a stable NAMED host (not 127.0.0.1)? @supabase/supabase-js derives its
// localStorage auth key from the URL's first hostname label. A named host yields
// a stable, human-meaningful key (sb-gitgud-e2e-auth-token) the auth-seeding
// init script targets deterministically, independent of port.
//
// This is best-effort: if the entry cannot be written (no permission), Node's
// SSR/recheck fetches to the mock will fail and the affected tests will surface
// it clearly. It never mutates anything but the loopback hosts mapping.
export default function globalSetup(): void {
  const line = `127.0.0.1 ${MOCK_HOST}`;
  try {
    const current = readFileSync('/etc/hosts', 'utf8');
    if (!current.split('\n').some((l) => l.trim().split(/\s+/).includes(MOCK_HOST))) {
      appendFileSync('/etc/hosts', `\n${line}\n`);
    }
  } catch (err) {
    console.warn(
      `[global-setup] could not ensure '${line}' in /etc/hosts; ` +
        `server-side (Node) fetches to the mock may fail. ${
          err instanceof Error ? err.message : ''
        }`
    );
  }
}
