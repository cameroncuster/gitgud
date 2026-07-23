import { expect, type Page, type ConsoleMessage, type Request } from '@playwright/test';

// Shared harness for the Playwright suite.
//
// The original suite allowed a broad list of "benign" console/network messages
// because it ran against a placeholder backend that always failed to fetch.
// That allowlist could hide real regressions (any "Failed to fetch" passed).
//
// The mocked scenarios now run against a reachable backend, so we hold them to
// a strict bar: zero unexpected console errors AND zero failed network
// requests. Only truly environment-specific noise that is not a product defect
// (a missing favicon, a canceled navigation) is tolerated, and only in the
// narrow places it legitimately occurs.

// Console/network noise that is never a product defect. Kept intentionally tiny
// — a favicon 404 in a test build, and Chromium's benign "ERR_ABORTED" for
// navigations/prefetches the browser itself cancels. Anything else is a
// failure.
const NEVER_A_DEFECT = [/favicon/i, /net::ERR_ABORTED/i];

function isNeverADefect(text: string): boolean {
  return NEVER_A_DEFECT.some((re) => re.test(text));
}

export type Collected = {
  consoleErrors: string[];
  pageErrors: string[];
  failedRequests: string[];
};

// Attach console, pageerror, and network-failure collectors. The returned
// object accumulates anything unexpected; assert it is empty with
// `expectClean` after the interactions under test.
export function collect(page: Page): Collected {
  const c: Collected = { consoleErrors: [], pageErrors: [], failedRequests: [] };

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error' && !isNeverADefect(msg.text())) {
      c.consoleErrors.push(`console.error: ${msg.text()}`);
    }
  });

  page.on('pageerror', (err: Error) => {
    if (!isNeverADefect(err.message)) {
      c.pageErrors.push(`pageerror: ${err.message}`);
    }
  });

  // A failed request is a request that never received a response (DNS,
  // connection refused, aborted). Real backend errors (a 500) still produce a
  // response and are asserted on the rendered UI, not here.
  page.on('requestfailed', (req: Request) => {
    const failure = req.failure();
    const text = `${req.method()} ${req.url()} — ${failure?.errorText ?? 'failed'}`;
    if (!isNeverADefect(text)) {
      c.failedRequests.push(text);
    }
  });

  return c;
}

// Assert no unexpected console errors, page errors, or failed requests were
// seen. Each category is reported separately so a failure names exactly what
// leaked.
export function expectClean(c: Collected, context: string): void {
  expect(c.consoleErrors, `unexpected console errors on ${context}`).toEqual([]);
  expect(c.pageErrors, `unexpected page errors on ${context}`).toEqual([]);
  expect(c.failedRequests, `unexpected failed network requests on ${context}`).toEqual([]);
}

// The app hydrates client-side; the header "Home" link is present in the
// server-rendered HTML, so waiting for it is a cheap, reliable signal that the
// shell is up.
export async function waitForShell(page: Page): Promise<void> {
  await expect(page.getByRole('link', { name: 'Home' })).toBeVisible();
}
