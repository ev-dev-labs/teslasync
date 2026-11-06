import { describe, expect, it } from 'vitest';
import catalog from './en.json';
import systemCatalog from './en/locale-system.json';
import toastCatalog from './en/locale-detail-toast.json';
import { catalogBeforeDashboardPolish } from './verified-combined-contract';

describe('reviewed data-repair wording', () => {
  it('preserves the prior catalog while shipping the new copy in generated resources', () => {
    const previous = catalogBeforeDashboardPolish(catalog);
    expect(previous.dataRepair.correction).toBeUndefined();
    expect(previous.dataRepair.cases.manualResolutionTitle).toBeUndefined();
    expect(previous.dataRepair.cases.filters.active).toBeUndefined();
    expect(previous.toast.dataRepair.case.correction).toBeUndefined();
    expect(previous.dataRepair.cases.resolve).toBe('Resolve case');

    expect(systemCatalog.dataRepair.correction).toEqual(catalog.dataRepair.correction);
    expect(systemCatalog.dataRepair.cases.manualResolutionTitle).toBe(catalog.dataRepair.cases.manualResolutionTitle);
    expect(systemCatalog.dataRepair.cases.filters.active).toBe(catalog.dataRepair.cases.filters.active);
    expect(toastCatalog.toast.dataRepair.case.correction).toEqual(catalog.toast.dataRepair.case.correction);
  });

  it('rejects altered or unreviewed correction copy', () => {
    const changed = structuredClone(catalog);
    changed.dataRepair.correction.nextSteps = 'Changed';
    expect(() => catalogBeforeDashboardPolish(changed)).toThrow();

    const extended = structuredClone(catalog);
    Object.assign(extended.dataRepair.correction, { unreviewed: 'Unreviewed copy' });
    expect(() => catalogBeforeDashboardPolish(extended)).toThrow();
  });
});
