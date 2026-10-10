import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { OperationalBriefMetric } from '@/components/data-display/OperationalBrief';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import { formatOperationalMetrics } from '@/lib/operationalMetrics';
import { useFormatting } from './useFormatting';
import { useUnits } from './useUnits';

/** Reuse validated source measurements and specialist displays in OperationalBrief. */
export function useOperationalMetrics(
  metrics: readonly StatMetric[], preferences?: MetricPreferences,
): readonly OperationalBriefMetric[] {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const { currencySymbol } = useFormatting();
  const effective = useMemo<MetricPreferences>(() => preferences ?? {
    units: unitPrefs,
    currency: { kind: 'symbol', value: currencySymbol },
  }, [preferences, unitPrefs, currencySymbol]);

  return useMemo(() => formatOperationalMetrics(metrics, effective, (key, fallback) => t(key, fallback)),
    [metrics, effective, t]);
}
