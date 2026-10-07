import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useFormatting } from '@/hooks/useFormatting';
import type { MetricPreferences } from '@/lib/metric-reference';

/** Existing settings bridges only. No legacy converters, queries or preference mutations. */
export function useMetricPreferences(): MetricPreferences {
  const { unitPrefs } = useUnits();
  const { precision, locale } = useNumberFormatting();
  const { currencySymbol } = useFormatting();
  return { units: { ...unitPrefs, precision: unitPrefs.precision ?? precision,
    locale: unitPrefs.locale ?? locale }, currency: { kind: 'symbol', value: currencySymbol } };
}
