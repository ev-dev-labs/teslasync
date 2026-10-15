import { Link } from 'react-router-dom';
import type { OperationalBriefMetric } from '@/components/data-display/OperationalBrief';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import { formatMetric, glossary, type MetricPreferences } from '@/lib/metric-reference';

export function formatOperationalMetrics(
  metrics: readonly StatMetric[],
  preferences: MetricPreferences,
  translate: (key: string, fallback: string) => string,
): readonly OperationalBriefMetric[] {
  return metrics.map((metric, index) => {
    const definition = glossary[metric.metricId];
    const label = metric.label ?? translate(`developerReference.stats.metric.${metric.metricId}.label`, definition.label);
    const description = metric.description
      ?? translate(`developerReference.stats.metric.${metric.metricId}.description`, definition.description);
    const formatted = formatMetric(metric.metricId, metric.rawValue, preferences, metric.missingReason, metric.display);
    const reason = formatted.reasonKey ? translate(formatted.reasonKey, formatted.reason ?? '') : formatted.reason;
    const comparison = metric.comparison;
    const compared = comparison ? formatMetric(comparison.metricId, comparison.rawValue, preferences) : null;
    const comparisonReason = compared?.reasonKey
      ? translate(compared.reasonKey, compared.reason ?? '') : compared?.reason;
    const comparisonContext = comparison && compared
      ? [
        `${comparison.label}: ${comparison.signed && comparison.rawValue > 0 && compared.state === 'value' ? '+' : ''}${compared.text}`,
        comparison.period.label,
        comparison.period.kind === 'unknown' ? comparison.period.reason : undefined,
        compared.state !== 'value' ? translate(`developerReference.stats.valueState.${compared.state}`, compared.state) : undefined,
        comparisonReason,
      ].filter(Boolean).join('; ')
      : undefined;
    const accessibleLabel = [`${label}: ${formatted.text}`, reason, comparisonContext].filter(Boolean).join('; ');

    return {
      key: metric.occurrenceId ?? `${metric.metricId}:${index}`,
      label,
      rawValue: metric.rawValue,
      valueState: formatted.state,
      value: metric.href
        ? <Link to={metric.href} aria-label={accessibleLabel}
          className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]">
          {formatted.text}
        </Link>
        : formatted.text,
      detail: <>
        <div>{description}</div>
        {reason && <div>{reason}</div>}
        {metric.context != null && <div>{metric.context}</div>}
        {metric.comparisonContent != null && <div>{metric.comparisonContent}</div>}
        {comparisonContext && <div>{comparisonContext}</div>}
      </>,
    };
  });
}
