import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const root = path.resolve('src', 'features', 'dashboard', 'widgets', 'designPacks');

async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => entry.isDirectory()
    ? sourceFiles(path.join(directory, entry.name))
    : Promise.resolve(/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) ? [path.join(directory, entry.name)] : [])));
  return files.flat();
}

describe('named pack source boundaries', () => {
  it('keeps production modules and controller imports free of legacy presentation paths', async () => {
    const files = [...await sourceFiles(root),
      path.join(root, '..', 'VehicleHeroWidget.tsx'),
      path.join(root, '..', 'BatteryGaugeWidget.tsx')];
    for (const file of files) {
      expect(file, file).not.toMatch(/[\\/]pilots[\\/]|_v[1-7]\.tsx$/);
      expect(await readFile(file, 'utf8'), file).not.toMatch(/(?:from\s+|import\s*\()['"][^'"]*(?:[\\/]pilots[\\/]|_v[1-7](?:['"]|\.tsx))/);
    }
  });

  it('keeps data acquisition and commands out of pack renderers', async () => {
    for (const directory of ['packs', 'families', 'viewModels']) {
      for (const file of await sourceFiles(path.join(root, directory))) {
        expect(await readFile(file, 'utf8'), file).not.toMatch(/from\s+['"]@\/api\/|\b(?:fetch|EventSource|WebSocket)\s*\(/);
      }
    }
  });
});
