import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SQL_ROOT = join(ROOT, 'sql');
const OBJECT_DIRECTORIES = ['common', 'auth', 'problems', 'contests', 'leaderboard'];
const EXPECTED_INIT_ORDER = [
  'common/utility_functions.sql',
  'auth/user_roles.sql',
  'auth/user_triggers.sql',
  'auth/user_preferences.sql',
  'problems/problems.sql',
  'problems/user_problem_feedback.sql',
  'problems/user_solved_problems.sql',
  'problems/problem_functions.sql',
  'problems/get_user_solved_problems.sql',
  'contests/contests.sql',
  'contests/user_contest_participation.sql',
  'contests/user_contest_feedback.sql',
  'contests/contest_functions.sql',
  'leaderboard/leaderboard_functions.sql',
  'permissions.sql'
];
const MIGRATION_ACL_ALLOWLIST = new Set([
  'cleanup_legacy_feedback_shims.sql',
  'migrate_schema_rerun_hardening.sql'
]);

function readSql(relativePath: string): string {
  return readFileSync(join(SQL_ROOT, relativePath), 'utf8');
}

function sqlFiles(): string[] {
  const pending = [SQL_ROOT];
  const files: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop();
    assert.ok(directory);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) pending.push(path);
      else if (entry.name.endsWith('.sql')) files.push(relative(SQL_ROOT, path));
    }
  }
  return files.sort();
}

function createPolicyStatements(sql: string): Array<{ name: string; table: string }> {
  return [...sql.matchAll(/^CREATE\s+POLICY\s+"([^"]+)"\s+ON\s+([a-z_][a-z0-9_]*)/gim)].map(
    (match) => ({ name: match[1], table: match[2] })
  );
}

test('init includes every reusable schema object file once and permissions last', () => {
  const includes = [...readSql('init.sql').matchAll(/^\\ir\s+(.+)$/gm)].map((match) => match[1]);
  const objectFiles = OBJECT_DIRECTORIES.flatMap((directory) =>
    readdirSync(join(SQL_ROOT, directory))
      .filter((name) => name.endsWith('.sql'))
      .map((name) => `${directory}/${name}`)
  );
  const reusableFiles = [...objectFiles, 'permissions.sql'].sort();

  assert.deepEqual(reusableFiles, [...EXPECTED_INIT_ORDER].sort());
  assert.deepEqual(includes, EXPECTED_INIT_ORDER);
  assert.equal(new Set(includes).size, includes.length, 'init contains duplicate includes');
});

test('every CREATE POLICY has its exact DROP POLICY IF EXISTS immediately before it', () => {
  for (const path of sqlFiles()) {
    const sql = readSql(path);
    for (const policy of createPolicyStatements(sql)) {
      const pair = new RegExp(
        `DROP\\s+POLICY\\s+IF\\s+EXISTS\\s+"${policy.name}"\\s+ON\\s+${policy.table}\\s*;\\s*CREATE\\s+POLICY\\s+"${policy.name}"\\s+ON\\s+${policy.table}`,
        'i'
      );
      assert.match(sql, pair, `${path}: ${policy.name} is not safely rerunnable`);
    }
  }
});

test('every CREATE TRIGGER has its exact DROP TRIGGER IF EXISTS immediately before it', () => {
  for (const path of sqlFiles()) {
    const sql = readSql(path);
    for (const match of sql.matchAll(
      /^CREATE\s+TRIGGER\s+([a-z_][a-z0-9_]*)[\s\S]*?\bON\s+((?:[a-z_][a-z0-9_]*\.)?[a-z_][a-z0-9_]*)/gim
    )) {
      const [, trigger, table] = match;
      const pair = new RegExp(
        `DROP\\s+TRIGGER\\s+IF\\s+EXISTS\\s+${trigger}\\s+ON\\s+${table}\\s*;\\s*CREATE\\s+TRIGGER\\s+${trigger}`,
        'i'
      );
      assert.match(sql, pair, `${path}: ${trigger} is not safely rerunnable`);
    }
  }
});

test('permissions.sql is the only reusable source of GRANT and REVOKE statements', () => {
  for (const path of sqlFiles()) {
    if (path === 'permissions.sql' || MIGRATION_ACL_ALLOWLIST.has(path)) continue;
    assert.doesNotMatch(
      readSql(path),
      /^\s*(?:GRANT|REVOKE)\b/gim,
      `${path} contains object-local ACL SQL`
    );
  }
});

test('every definer function and permission verification pins the exact search_path', () => {
  const definitions = [
    {
      sql: readSql('auth/user_triggers.sql'),
      signature: 'public.handle_new_user()',
      table: 'public.user_roles'
    },
    {
      sql: readSql('auth/user_preferences.sql'),
      signature: 'public.handle_new_user_preferences()',
      table: 'public.user_preferences'
    },
    {
      sql: readSql('leaderboard/leaderboard_functions.sql'),
      signature: 'get_leaderboard()',
      table: 'public.user_solved_problems'
    },
    {
      sql: readSql('problems/get_user_solved_problems.sql'),
      signature: 'get_user_solved_problems(p_user_id UUID)',
      table: 'public.user_solved_problems'
    },
    {
      sql: readSql('problems/problem_functions.sql'),
      signature: 'update_problem_feedback',
      table: 'public.user_problem_feedback'
    },
    {
      sql: readSql('contests/contest_functions.sql'),
      signature: 'update_contest_feedback',
      table: 'public.user_contest_feedback'
    }
  ];

  for (const definition of definitions) {
    assert.ok(definition.sql.includes(definition.signature));
    assert.match(definition.sql, /SECURITY\s+DEFINER\s+SET\s+search_path\s*=\s*public,\s*pg_temp/i);
    assert.ok(
      definition.sql.includes(definition.table),
      `${definition.signature} lacks a qualified public table`
    );
  }

  const verification = readSql('verify_permissions.sql');
  for (const signature of [
    'handle_new_user()',
    'handle_new_user_preferences()',
    'get_leaderboard()',
    'get_user_solved_problems(uuid)',
    'update_problem_feedback(uuid,boolean)',
    'update_contest_feedback(uuid,boolean)'
  ]) {
    assert.ok(verification.includes(`('${signature}')`));
  }
  assert.match(verification, /p\.prosecdef/);
  assert.match(verification, /p\.proconfig\s*=\s*ARRAY\['search_path=public, pg_temp'\]::TEXT\[\]/);
  assert.ok(verification.includes("('update_updated_at_column()')"));
  assert.match(verification, /has_function_privilege\('authenticated'/);
});

test('forward migration is transactional, idempotent, data-free, and verifies postconditions', () => {
  const migration = readSql('migrate_schema_rerun_hardening.sql');
  const policyFiles = sqlFiles().filter((path) => createPolicyStatements(readSql(path)).length > 0);

  for (const path of policyFiles) {
    assert.match(migration, new RegExp(`^\\\\ir ${path}$`, 'm'));
  }
  assert.match(migration, /^BEGIN;/m);
  assert.match(migration, /^COMMIT;/m);
  assert.ok(migration.indexOf('BEGIN;') < migration.indexOf('COMMIT;'));
  assert.match(migration, /^\\ir permissions\.sql$/m);
  assert.doesNotMatch(migration, /^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE)\b/gim);
  assert.match(migration, /pg_policies/);
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /p\.proconfig\s*=\s*ARRAY\['search_path=public, pg_temp'\]::TEXT\[\]/);
  assert.match(migration, /pg_trigger/);
  assert.match(migration, /leaky_internal_functions/);
});
