import { createInstance } from 'i18next';
import { describe, expect, it } from 'vitest';
import ar from '@/i18n/ar.json';
import he from '@/i18n/he.json';
import { formatAnomalyExplanation } from './anomalyExplanation';

describe('localized anomaly fact contracts', () => {
  it.each([
    ['ar', ar, 'تتجاوز قيمة ModuleTempMax البالغة 60°C الحد الأقصى الآمن (55°C).'],
    ['he', he, 'הערך 60°C של ModuleTempMax חורג מהמקסימום הבטוח (55°C).'],
  ] as const)('uses the real %s catalog and typed operands', async (language, catalog, expected) => {
    const i18n = createInstance();
    await i18n.init({ lng: language, resources: { [language]: { translation: catalog } }, interpolation: { escapeValue: false } });
    const anomaly = {
      signal: 'ModuleTempMax', message: 'Legacy English prose.',
      explanation_code: 'above_maximum',
      explanation_params: { value: 60, baseline: 17.5, maximum: 55 },
    };
    expect(formatAnomalyExplanation(anomaly, i18n.t, value => `${value}°C`, String)).toBe(expected);
    expect(anomaly.explanation_params).toEqual({ value: 60, baseline: 17.5, maximum: 55 });
    expect(formatAnomalyExplanation({ ...anomaly, explanation_code: 'future_detector' }, i18n.t, String, String)).toBe('Legacy English prose.');
  });
});
