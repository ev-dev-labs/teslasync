import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import catalog from './en.json';
import transition from './__fixtures__/widget-implementation-transition.json';
import { catalogBeforeWidgetImplementation, restoreWidgetImplementationSource } from './verified-widget-implementation-contract';

describe('additive widget implementation preservation', () => {
  it('rejects source drift instead of silently projecting an unverified edit', () => {
    const patch = transition.sources[0];
    const source = readFileSync(resolve(process.cwd(), '..', patch.file), 'utf8');
    expect(restoreWidgetImplementationSource(patch.file, source)).not.toBe(source);
    expect(() => restoreWidgetImplementationSource(patch.file, source + '\n')).toThrow();
  });

  it('preserves the original widget copy and rejects changes to new copy', () => {
    expect(catalogBeforeWidgetImplementation(catalog).widget).toEqual(catalog.widget);
    const changed = structuredClone(catalog);
    changed.dashboard.designPacks.classic = 'Unverified replacement';
    expect(() => catalogBeforeWidgetImplementation(changed)).toThrow();
    expect(catalog.dashboard.designPacks.classic).not.toBe('Unverified replacement');
  });
});
