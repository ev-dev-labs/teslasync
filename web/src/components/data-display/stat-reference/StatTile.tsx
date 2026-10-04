import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Text, Tooltip } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatMetric, glossary, type MetricPreferences } from '@/lib/metric-reference';
import type { StatMetric } from './types';
import styles from './statReference.module.css';

export interface StatTileProps {
  metric: StatMetric;
  preferences: MetricPreferences;
  loading: boolean;
}

export function StatTile({ metric, preferences, loading }: StatTileProps) {
  const { t } = useTranslation();
  const definition = glossary[metric.metricId];
  const label = t(`developerReference.stats.metric.${metric.metricId}.label`, definition.label);
  const description = t(`developerReference.stats.metric.${metric.metricId}.description`, definition.description);
  const result = formatMetric(metric.metricId, metric.rawValue, preferences, metric.missingReason);
  const reason = result.reasonKey ? t(result.reasonKey, result.reason ?? '') : result.reason;
  const comparison = metric.comparison;
  const delta = comparison ? formatMetric(comparison.metricId, comparison.rawValue, preferences) : null;
  const comparisonReason = delta?.reasonKey ? t(delta.reasonKey, delta.reason ?? '') : delta?.reason;
  const comparisonPeriodReason = comparison?.period.kind === 'unknown' ? comparison.period.reason : undefined;
  const comparisonState = delta && delta.state !== 'value'
    ? t(`developerReference.stats.valueState.${delta.state}`, delta.state) : undefined;
  const deltaText = delta
    ? `${comparison?.signed && comparison.rawValue > 0 && delta.state === 'value' ? '+' : ''}${delta.text}`
    : undefined;
  const comparisonContext = comparison && delta
    ? [`${comparison.label}: ${deltaText}`, comparison.period.label, comparisonPeriodReason,
      comparisonState, comparisonReason].filter(Boolean).join('; ')
    : undefined;
  const accessibleLabel = [`${label}: ${result.text}${reason ? `; ${reason}` : ''}`, comparisonContext]
    .filter(Boolean).join('; ');
  const content = <>
    <Tooltip content={description} multiline>
      <Text as="span" data-stat-label className="block text-[13px] font-medium leading-5 text-[var(--text-secondary)]"
        tabIndex={metric.href ? undefined : 0}>{label}</Text>
    </Tooltip>
    {loading ? <span aria-hidden="true" className="mt-1 block h-7 w-24 max-w-full rounded bg-[var(--surface-3)] motion-safe:animate-pulse" />
      : <span className={cn('mt-1 block font-semibold leading-tight text-[var(--text-primary)]', styles.value,
        result.text.length > 18 && styles.longValue, result.text.length > 28 && styles.extremeValue)}>
        <span data-stat-value>{result.value}</span>
        {result.unit && <>{['temperature', 'percent', 'score'].includes(definition.format) ? '' : ' '}
          <span data-stat-unit className="font-normal text-[var(--text-secondary)]">{result.unit}</span></>}
      </span>}
    {loading && <span className="sr-only">{t('developerReference.stats.state.loading', 'Loading measurements')}</span>}
    {!loading && reason && <span className="mt-1 block text-xs text-[var(--text-secondary)]">{reason}</span>}
    {!loading && delta && <span data-stat-delta data-comparison-state={delta.state}
      className="mt-1 block text-xs font-medium text-[var(--text-secondary)]">
      {comparison?.label}: {deltaText} · <span data-stat-comparison-period>{comparison?.period.label}</span>
      {comparisonPeriodReason && <span data-stat-comparison-period-reason className="mt-1 block">{comparisonPeriodReason}</span>}
      {comparisonState && <span data-stat-comparison-state-label className="mt-1 block">{comparisonState}</span>}
      {comparisonReason && <span data-stat-comparison-reason className="mt-1 block">{comparisonReason}</span>}
    </span>}
  </>;
  const props = {
    'data-stat': true, 'data-metric': metric.metricId, 'data-state': loading ? 'loading' : result.state,
    'data-missing-reason': reason, 'aria-label': loading ? undefined : accessibleLabel,
    className: cn(styles.tile, 'min-w-0 p-3 text-left'),
  };
  return metric.href
    ? <Link {...props} to={metric.href} className={cn(props.className,
      'group relative hover:bg-[var(--surface-2)] focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--focus-ring)]')}>
      {content}<span aria-hidden="true" className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">›</span>
    </Link>
    : <div {...props}>{content}</div>;
}
