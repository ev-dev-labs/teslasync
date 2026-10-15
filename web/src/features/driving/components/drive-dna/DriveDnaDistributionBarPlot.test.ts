import { describe, expect, it } from 'vitest';
import { createEnglishI18n } from '@/test/createEnglishI18n';
import { emissionLabel } from './DriveDnaDistributionBarPlot';

const fmtInt = (value: number) => new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);

describe('emissionLabel', () => {
  it('selects plurals from the numeric count and shows the formatted value', async () => {
    const i18n = await createEnglishI18n();
    const t = i18n.getFixedT('en', 'translation') as unknown as (key: string, options: Record<string, unknown>) => string;
    expect(emissionLabel(t, fmtInt, 1)).toBe('1 emission');
    expect(emissionLabel(t, fmtInt, 0)).toBe('0 emissions');
    expect(emissionLabel(t, fmtInt, 1234)).toBe('1,234 emissions');
  });

  it('keeps missing and invalid counts unknown rather than a measured zero', async () => {
    const i18n = await createEnglishI18n();
    const t = i18n.getFixedT('en', 'translation') as unknown as (key: string, options: Record<string, unknown>) => string;
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, '12']) {
      expect(emissionLabel(t, fmtInt, value)).toBe('—');
    }
  });
});
