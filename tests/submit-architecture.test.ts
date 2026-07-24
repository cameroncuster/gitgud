import test from 'node:test';
import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);

async function source(path: string) {
  return readFile(new URL(path, root), 'utf8');
}

async function assertMissing(path: string) {
  await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' }, path);
}

async function typescriptFiles(path: string): Promise<string[]> {
  const directory = new URL(path, root);
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = join(path, entry.name);
      return entry.isDirectory()
        ? typescriptFiles(`${relative}/`)
        : entry.name.endsWith('.ts')
          ? [relative]
          : [];
    })
  );
  return nested.flat();
}

const databaseImport =
  /(?:from\s*['"][^'"]*(?:supabase|services\/database)[^'"]*['"]|import\s*['"][^'"]*(?:supabase|services\/database)[^'"]*['"])/i;
const directDatabaseAccess = /\.(?:from|insert|rpc)\s*\(/;

async function assertNoDatabaseAccess(paths: string[]) {
  for (const path of paths) {
    const contents = await source(path);
    assert.doesNotMatch(contents, databaseImport, path);
    assert.doesNotMatch(contents, directDatabaseAccess, path);
  }
}

test('only the submit provider composition root may import Supabase', async () => {
  const submitProviders = await typescriptFiles('src/lib/submit/providers/');
  await assertNoDatabaseAccess(submitProviders.filter((path) => !path.endsWith('/index.ts')));
  await assertNoDatabaseAccess(await typescriptFiles('src/lib/providers/'));

  const compositionRoot = await source('src/lib/submit/providers/index.ts');
  assert.match(compositionRoot, /createSubmissionPersistence\s*\(/);
  assert.doesNotMatch(compositionRoot, directDatabaseAccess);
});

test('route shell delegates workflow state and keeps no sequencing implementation', async () => {
  const route = await source('src/routes/submit/+page.svelte');
  assert.match(route, /createSubmissionWorkflow/);
  assert.doesNotMatch(route, /rowSeq|handlePattern|for \(let i = 0; i < rows\.length/);
  assert.doesNotMatch(route, /rows\s*=\s*rows\.filter|status:\s*'committing'/);
});

test('obsolete component provider factory and form contracts are deleted', async () => {
  await assertMissing('src/lib/components/submitForm.ts');
  await assertMissing('src/lib/components/submitProviders.ts');
  await assertMissing('src/lib/services/codeforces.ts');
  await assertMissing('src/lib/services/kattis.ts');
  await assertMissing('src/lib/services/kattisUrl.ts');
});
