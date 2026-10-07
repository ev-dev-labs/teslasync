import { useTranslation } from 'react-i18next';
import { useMetricPreferences } from '@/components/data-display/stat-reference';
import { formatMetric, type MetricId, type MetricRaw, type MetricDisplayOptions } from '@/lib/metric-reference';

/** Secondary facts share the exact same engine and expose translated unknown/invalid reasons. */
export function useStatFormatting() {
  const { t } = useTranslation();
  const preferences = useMetricPreferences();
  const text = (id: MetricId, raw: MetricRaw, display?: MetricDisplayOptions): string => {
    const result = formatMetric(id, raw, preferences, undefined, display);
    const reason = result.reasonKey ? t(result.reasonKey, result.reason ?? '') : result.reason;
    return reason ? `${result.text} (${reason})` : result.text;
  };
  return { preferences, text };
}
