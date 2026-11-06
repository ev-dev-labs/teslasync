import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import catalog from './en.json';
import { catalogBeforeDashboardPolish } from './verified-combined-contract';

describe('reviewed notification wording', () => {
  it('reconstructs the exact prior notification catalog without changing historical fingerprints', () => {
    const previous = catalogBeforeDashboardPolish(catalog);
    expect(createHash('sha256').update(JSON.stringify(previous.notifications)).digest('hex'))
      .toBe('5e81386f5e893da7cbca69d748518894628a7fb8662b2dec6fb773047382ae93');
  });

  it('rejects unreviewed changes to the new human type label', () => {
    const changed = structuredClone(catalog);
    changed.notifications.report.values.alertRule = 'alert.rule';
    expect(() => catalogBeforeDashboardPolish(changed)).toThrow();
  });
});
