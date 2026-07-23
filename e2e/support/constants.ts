// Shared constants for the mocked Playwright layer, imported by both
// playwright.config.ts and the specs so the mock server URL/port is defined once.
export const MOCK_PORT = 54321;
export const MOCK_URL = `http://127.0.0.1:${MOCK_PORT}`;
