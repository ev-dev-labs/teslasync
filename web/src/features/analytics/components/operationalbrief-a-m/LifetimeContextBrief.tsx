import { useTranslation } from 'react-i18next';
import type { LifetimeStats } from '@/api/hooks/useAnalytics';
import { OperationalBrief, AnimatedNumber, type StatMetric } from '@/components/data-display';
import { ProgressRing } from '@/components/data-display';
import { SourceContent } from '@/components/layout';
import { HelpTooltip } from '@/components/ui';
import { useOperationalMetrics } from '@/hooks/useOperationalMetrics';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { Globe, Moon, TreePine, Home } from 'lucide-react';

export function LifetimeContextBrief({ mode, stats, loading, error, onRetry }: {
  mode: 'funfacts' | 'environment' | 'activity'; stats: LifetimeStats | null | undefined;
  loading: boolean; error: unknown; onRetry: () => void;
}) {
  const { t } = useTranslation();
  const { fmtInt, fmtNumber, precision } = useNumberFormatting();
  const countDisplay = { formatter: (raw: number) => ({ value: fmtInt(raw), unit: '' }) };
  const help = t('help.lifetime.avgEfficiency', 'Average energy used per unit distance across the whole driving history (Wh/km). Lower is better — temperature, speed, and terrain are the main drivers.');
  const title = mode === 'funfacts' ? t('lifetime.funFacts', 'Fun facts')
    : mode === 'environment' ? t('lifetime.environmentalImpact', 'Environmental impact')
      : t('lifetime.activitySummary', 'Activity summary');
  const metrics: StatMetric[] = mode === 'funfacts' ? [
    { metricId: 'percent', occurrenceId: 'lifetime-earth', label: t('lifetime.earthProgress', 'around the Earth'),
      rawValue: stats?.earth_circumferences != null ? stats.earth_circumferences * 100 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) },
      context: <Globe className="h-6 w-6 shrink-0 text-indigo-300" aria-hidden="true" /> },
    { metricId: 'percent', occurrenceId: 'lifetime-moon', label: t('lifetime.moonProgress', 'to the Moon'),
      rawValue: stats?.moon_trips != null ? stats.moon_trips * 100 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: '%' }) },
      context: <Moon className="h-6 w-6 shrink-0 text-slate-300" aria-hidden="true" /> },
    { metricId: 'number', occurrenceId: 'lifetime-fun-trees', label: t('lifetime.treesPlanted', 'trees equivalent planted'),
      rawValue: stats?.trees_equivalent, display: countDisplay,
      context: <TreePine className="h-6 w-6 shrink-0 text-emerald-300" aria-hidden="true" /> },
    { metricId: 'duration', occurrenceId: 'lifetime-homes', label: t('lifetime.homesPowered', 'of home energy used'),
      rawValue: stats?.homes_equivalent_days != null ? stats.homes_equivalent_days * 86400 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw / 86400), unit: t('lifetime.days', 'days') }) },
      context: <Home className="h-6 w-6 shrink-0 text-amber-300" aria-hidden="true" /> },
  ] : mode === 'environment' ? [
    { metricId: 'mass', occurrenceId: 'lifetime-co2-offset', label: t('lifetime.co2Offset', 'CO₂ offset'),
      rawValue: stats?.co2_offset_kg,
      display: { formatter: raw => ({ value: fmtNumber(raw), unit: 'kg' }) },
      context: stats?.co2_offset_kg != null ? <ProgressRing
        value={Math.min((stats.co2_offset_kg / 1000) * 100, 100)} size={64} strokeWidth={5} color="#22c55e" /> : undefined },
    { metricId: 'number', occurrenceId: 'lifetime-environment-trees', label: t('lifetime.treesEquiv', 'trees equivalent'),
      rawValue: stats?.trees_equivalent, display: countDisplay,
      context: <span className="text-4xl" aria-hidden="true">🌳</span> },
    { metricId: 'count', occurrenceId: 'lifetime-coffees', label: t('lifetime.coffeesEquiv', 'cups of coffee saved'),
      rawValue: stats?.total_savings != null ? Math.round(stats.total_savings / 5) : null, display: countDisplay,
      context: <span className="text-4xl" aria-hidden="true">☕</span> },
  ] : [
    { metricId: 'text', occurrenceId: 'lifetime-active-day', label: t('lifetime.mostActiveDay', 'Most active day'),
      rawValue: stats?.most_active_day_of_week || null },
    { metricId: 'identifier', occurrenceId: 'lifetime-peak-hour', label: t('lifetime.mostActiveHour', 'Peak hour'),
      rawValue: stats?.most_active_hour, display: { formatter: raw => ({ value: `${raw}:00`, unit: '' }) } },
    { metricId: 'duration', occurrenceId: 'lifetime-days-on-road', label: t('lifetime.daysOnRoad', 'Days on road'),
      rawValue: stats?.days_on_road != null ? stats.days_on_road * 86400 : null,
      display: { formatter: raw => ({ value: fmtNumber(raw / 86400), unit: '' }) } },
    { metricId: 'efficiency', occurrenceId: 'lifetime-activity-efficiency', label: t('lifetime.avgEfficiency', 'Avg efficiency'),
      rawValue: stats?.avg_efficiency_wh_km != null && stats.avg_efficiency_wh_km > 0 ? stats.avg_efficiency_wh_km / 1000 : null,
      description: help, display: { formatter: raw => ({ value: fmtNumber(raw * 1000), unit: 'Wh/km' }) } },
  ];
  const operationalMetrics = useOperationalMetrics(metrics);
  const displayedMetrics = operationalMetrics.map(metric => mode === 'environment'
    && metric.key === 'lifetime-co2-offset' && metric.valueState === 'value' && stats != null
    ? { ...metric, value: <AnimatedNumber value={stats.co2_offset_kg} decimals={precision} suffix=" kg" /> }
    : metric);
  return <div className="space-y-3">
    <OperationalBrief compact metrics={displayedMetrics} loading={loading && stats == null}
      eyebrow={t('lifetime.title', 'Lifetime stats')} title={title}
      description={t('lifetime.source.aggregate', 'Server lifetime aggregates')}
      scope={<span>{t('lifetime.source.allTime', 'All time')}</span>}
      provenance={t('lifetime.source.aggregate', 'Server lifetime aggregates')}
      statusLabel={loading && stats == null ? t('analytics.brief.loading', 'Loading evidence')
        : stats == null ? t('analytics.brief.unavailable', 'Evidence unavailable')
          : error != null ? t('analytics.brief.retained', 'Retained evidence') : t('analytics.brief.returned', 'Returned evidence')}
      statusTone={error != null || stats == null ? 'warning' : 'neutral'}
      actions={mode === 'activity' ? <HelpTooltip size="xs" i18nKey="help.lifetime.avgEfficiency"
        defaultValue={help} ariaLabel={t('lifetime.moreInfoAbout', 'More info about {{label}}', {
          label: t('lifetime.avgEfficiency', 'Avg efficiency'),
        })} /> : undefined}
    />
    <SourceContent
      state={error != null ? stats == null ? 'error' : 'retained' : !loading && stats == null ? 'empty' : 'ready'}
      label={title} emptyMessage={t('lifetime.noData', 'No driving data yet')}
      errorMessage={t('error.loadFailed', 'Failed to load data')}
      error={error} errorRecovery={{ onRetry }}>{null}</SourceContent>
  </div>;
}
