import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import type { MetricPreferences } from '@/lib/metric-reference';
import { formatOperationalMetrics } from '@/lib/operationalMetrics';

/** Public reports supply their existing preferences without adding settings queries. */
export function usePublicOperationalMetrics(
  metrics: readonly StatMetric[],
  preferences: MetricPreferences,
) {
  const { t } = useTranslation();
  return useMemo(() => formatOperationalMetrics(metrics, preferences, (key, fallback) => t(key, fallback)),
    [metrics, preferences, t]);
}
