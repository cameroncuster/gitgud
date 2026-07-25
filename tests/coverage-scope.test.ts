import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { discoverRuntimeTypeScript } from '../scripts/coverage-scope.mjs';

test('runtime discovery is recursive, sorted, and excludes only declarations', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'gitgud-coverage-scope-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src/lib/submit'), { recursive: true });
  await mkdir(join(root, 'src/routes/nested'), { recursive: true });
  await Promise.all([
    writeFile(join(root, 'src/lib/z.ts'), 'export const z = 1;'),
    writeFile(join(root, 'src/lib/app.d.ts'), 'declare const app: string;'),
    writeFile(join(root, 'src/lib/submit/types.ts'), 'export type T = string;'),
    writeFile(join(root, 'src/routes/nested/a.ts'), 'export const a = 1;')
  ]);

  assert.deepEqual(await discoverRuntimeTypeScript(root), [
    'src/lib/submit/types.ts',
    'src/lib/z.ts',
    'src/routes/nested/a.ts'
  ]);
});
