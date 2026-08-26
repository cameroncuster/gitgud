import { existsSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { pathToFileURL } from 'node:url';
// @ts-expect-error Node 24 exposes registerHooks before the installed Node declarations do.
import { registerHooks } from 'node:module';

const root = resolvePath(import.meta.dirname, '..');
const publicEnv = Object.freeze({
  PUBLIC_SUPABASE_URL: process.env.PUBLIC_SUPABASE_URL ?? 'http://localhost',
  PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'placeholder',
  PUBLIC_CODEFORCES_API_BASE: process.env.PUBLIC_CODEFORCES_API_BASE,
  PUBLIC_KATTIS_BASE: process.env.PUBLIC_KATTIS_BASE,
  PUBLIC_DMOJ_API_BASE: process.env.PUBLIC_DMOJ_API_BASE
});
const virtualModules = new Map([
  ['$app/environment', 'export const browser = false; export const dev = false;'],
  [
    '$env/static/public',
    `export const PUBLIC_SUPABASE_URL = ${JSON.stringify(publicEnv.PUBLIC_SUPABASE_URL)}; export const PUBLIC_SUPABASE_PUBLISHABLE_KEY = ${JSON.stringify(publicEnv.PUBLIC_SUPABASE_PUBLISHABLE_KEY)};`
  ],
  ['$env/dynamic/public', `export const env = ${JSON.stringify(publicEnv)};`]
]);

/** @param {string} path */
function sourceUrl(path) {
  return pathToFileURL(path).href;
}

/** @param {string} path */
function resolveTypeScript(path) {
  if (existsSync(path)) return path;
  if (existsSync(`${path}.ts`)) return `${path}.ts`;
  return path;
}

registerHooks({
  resolve(
    /** @type {string} */ specifier,
    /** @type {{ parentURL: string }} */ context,
    /** @type {(specifier: string, context: { parentURL: string }) => unknown} */ nextResolve
  ) {
    if (virtualModules.has(specifier)) return { url: `coverage:${specifier}`, shortCircuit: true };
    if (specifier.startsWith('$lib/')) {
      const path = resolvePath(root, 'src/lib', specifier.slice('$lib/'.length));
      return { url: sourceUrl(resolveTypeScript(path)), shortCircuit: true };
    }

    if (specifier.startsWith('.') || specifier.startsWith('/')) {
      const baseUrl = new URL(specifier, context.parentURL);
      if (baseUrl.protocol === 'file:' && !baseUrl.pathname.endsWith('.ts')) {
        const typeScriptUrl = new URL(`${baseUrl.href}.ts`);
        if (existsSync(typeScriptUrl)) return { url: typeScriptUrl.href, shortCircuit: true };
      }
    }
    return nextResolve(specifier, context);
  },
  load(
    /** @type {string} */ url,
    /** @type {unknown} */ context,
    /** @type {(url: string, context: unknown) => unknown} */ nextLoad
  ) {
    if (url.startsWith('coverage:')) {
      const specifier = url.slice('coverage:'.length);
      return { format: 'module', source: virtualModules.get(specifier), shortCircuit: true };
    }
    return nextLoad(url, context);
  }
});
