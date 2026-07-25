import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import '../scripts/coverage-hooks.mjs';
import { discoverRuntimeTypeScript, toImportUrl } from '../scripts/coverage-scope.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));

test('coverage inventory imports every production runtime TypeScript module', async () => {
  const files = await discoverRuntimeTypeScript(root);
  assert.ok(files.some((file) => file.startsWith('src/lib/')));
  assert.ok(files.some((file) => file.startsWith('src/routes/')));
  assert.ok(files.includes('src/lib/submit/types.ts'));

  const results = await Promise.allSettled(files.map((file) => import(toImportUrl(root, file))));
  const failures = results.flatMap((result, index) =>
    result.status === 'rejected' ? [`${files[index]}: ${String(result.reason)}`] : []
  );
  assert.deepEqual(failures, []);
});
