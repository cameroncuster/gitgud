import { test, expect, type Page } from '@playwright/test';
import { parseKattisProblemPage } from '../src/lib/providers/kattis/ingestion.ts';

// Regression coverage for the real Kattis problem-page HTML parser.
//
// parseKattisProblemPage scrapes the live open.kattis.com markup for a
// problem's display name (the <h1>) and difficulty (.difficulty_number, with a
// .difficulty fallback). Every other Kattis test mocks parsePage out, so the
// selector logic that is most likely to break when Kattis changes its markup is
// otherwise unexercised. These snapshots pin its behavior against captured
// fixtures so a markup drift or an accidental selector change fails loudly.
//
// The parser uses the browser-only DOMParser, so it cannot run in the Node
// unit-test process. We run the *production* function (serialized via
// .toString(), not a copy) inside a real browser DOM via page.evaluate. Adding
// a DOM shim (jsdom/happy-dom) purely for this would introduce a dependency the
// repo guidelines discourage; the Playwright browser already provides one.

const parserSource = parseKattisProblemPage.toString();

async function parseInBrowser(
  page: Page,
  html: string,
  problemId: string
): Promise<{ name: string; rating: number }> {
  return page.evaluate(
    ([source, htmlArg, idArg]) => {
      const fn = new Function(`return (${source});`)() as (
        html: string,
        problemId: string
      ) => { name: string; rating: number };
      return fn(htmlArg, idArg);
    },
    [parserSource, html, problemId] as const
  );
}

// A realistic slice of the open.kattis.com problem page: the problem title in an
// <h1> and the difficulty rendered in a .difficulty_number badge.
const FULL_PAGE = `<!doctype html>
<html lang="en">
  <head><title>Two Stones – Kattis</title></head>
  <body>
    <div class="problem-wrapper">
      <div class="headline-wrapper">
        <h1 class="book-page-heading">Two Stones</h1>
      </div>
      <div class="problem-sidebar">
        <div class="metadata_list">
          <span class="difficulty_number">2.1</span>
        </div>
      </div>
    </div>
  </body>
</html>`;

// Older/alternate markup that exposes the difficulty via the .difficulty class
// rather than .difficulty_number.
const LEGACY_DIFFICULTY_CLASS = `<!doctype html>
<html>
  <body>
    <h1>Legacy Problem</h1>
    <span class="difficulty">7</span>
  </body>
</html>`;

// A page with a title but no difficulty element at all.
const NO_DIFFICULTY = `<!doctype html>
<html>
  <body>
    <h1>Nameless Difficulty</h1>
  </body>
</html>`;

// A page with neither a title nor a difficulty (e.g. an error/interstitial page).
const NO_TITLE = `<!doctype html>
<html>
  <body>
    <div class="alert">Problem not available</div>
  </body>
</html>`;

test.describe('parseKattisProblemPage', () => {
  test('reads the h1 name and .difficulty_number rating', async ({ page }) => {
    await page.goto('about:blank');
    const result = await parseInBrowser(page, FULL_PAGE, 'twostones');
    expect(result).toEqual({ name: 'Two Stones', rating: 2.1 });
  });

  test('falls back to the .difficulty class when .difficulty_number is absent', async ({
    page
  }) => {
    await page.goto('about:blank');
    const result = await parseInBrowser(page, LEGACY_DIFFICULTY_CLASS, 'legacy');
    expect(result).toEqual({ name: 'Legacy Problem', rating: 7 });
  });

  test('defaults the rating to 5 when no difficulty element is present', async ({ page }) => {
    await page.goto('about:blank');
    const result = await parseInBrowser(page, NO_DIFFICULTY, 'nodiff');
    expect(result).toEqual({ name: 'Nameless Difficulty', rating: 5 });
  });

  test('falls back to the problem id when the h1 is missing', async ({ page }) => {
    await page.goto('about:blank');
    const result = await parseInBrowser(page, NO_TITLE, 'missingtitle');
    expect(result).toEqual({ name: 'missingtitle', rating: 5 });
  });
});
