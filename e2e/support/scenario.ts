import { MOCK_URL } from './constants.ts';

// Switches the shared mock Supabase server's response mode before a test
// navigates. Because the app reads data server-side during SSR, the scenario
// must be set on the mock (not via browser interception) prior to page.goto.
//
// The mocked specs run single-worker (see playwright.config.ts), so this
// server-wide setting is deterministic for the test that set it.
export type Scenario = 'data' | 'empty' | 'error';

export async function setScenario(scenario: Scenario): Promise<void> {
  const res = await fetch(`${MOCK_URL}/__control/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario })
  });
  if (!res.ok) {
    throw new Error(`failed to set mock scenario '${scenario}': HTTP ${res.status}`);
  }
  const body = (await res.json()) as { scenario: Scenario };
  if (body.scenario !== scenario) {
    throw new Error(`mock scenario did not switch to '${scenario}' (got '${body.scenario}')`);
  }
}
