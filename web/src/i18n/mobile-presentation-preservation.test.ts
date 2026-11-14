import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import changes from './__fixtures__/mobile-presentation-preservation.json';
import catalog from './en.json';
import shell from './en/shell.json';
import { producerProjection } from './producer-projection';
import { catalogBeforeDashboardPolish, designProfileCopy } from './verified-combined-contract';
import { restoreMobilePresentationSource } from './verified-native-source-repair-contract';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

describe('mobile presentation source preservation', () => {
  it.each(changes)('preserves the historical translation producer for $file', change => {
    const source = readFileSync(resolve(process.cwd(), '..', change.file), 'utf8');
    expect(hash(restoreMobilePresentationSource(change.file, source))).toBe(change.before);
    expect(() => restoreMobilePresentationSource(change.file, `${source}\n// unexpected`)).toThrow();
    expect(() => restoreMobilePresentationSource(change.file, source.slice(1))).toThrow();
  });

  it('pins the appearance-loading copy in the actual catalog, shell and producer', () => {
    const file = 'web/src/components/ui/AppDesignBridge.tsx';
    const source = readFileSync(resolve(process.cwd(), '..', file), 'utf8');
    const calls = producerProjection(file, source).calls.map(call => call.call);
    const previous = catalogBeforeDashboardPolish(catalog);
    for (const [key, expected] of designProfileCopy) {
      expect(catalog.common[key]).toBe(expected);
      expect(shell.common[key]).toBe(expected);
      expect(calls).toContain(`t('common.${key}', '${expected}')`);
      expect(previous.common[key]).toBeUndefined();
      const changed = structuredClone(catalog);
      changed.common[key] += '!';
      expect(() => catalogBeforeDashboardPolish(changed)).toThrow();
    }
  });
});
