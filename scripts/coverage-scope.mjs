import { readdir } from 'node:fs/promises';
import { relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {string} rootDirectory
 * @returns {Promise<string[]>}
 */
export async function discoverRuntimeTypeScript(rootDirectory) {
  const sourceDirectory = resolve(rootDirectory, 'src');
  /** @type {string[]} */
  const files = [];

  /** @param {string} directory */
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        files.push(relative(rootDirectory, path).split(sep).join('/'));
      }
    }
  }

  await visit(sourceDirectory);
  return files.sort();
}

/**
 * @param {string} rootDirectory
 * @param {string} projectPath
 */
export function toImportUrl(rootDirectory, projectPath) {
  return pathToFileURL(resolve(rootDirectory, projectPath)).href;
}
