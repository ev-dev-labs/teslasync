import { useTranslation } from 'react-i18next';
import { GlassPanel, Heading, Text } from '@/components/ui';
import { StatGroup, StatStrip, type StatMetric } from '@/components/data-display/stat-reference';
import type { MetricPreferences, StatPeriod } from '@/lib/metric-reference';
import { stripMetrics } from './fixtures';

export function StripExamples({ preferences }: { preferences: MetricPreferences }) {
  const { t } = useTranslation();
  const unknown: StatPeriod = { kind: 'unknown',
    label: t('developerReference.stats.period.synthetic', 'Synthetic period — not live data'),
    reason: t('developerReference.stats.period.unknownReason', 'No backend query or complete-window claim is associated with these fixtures.') };
  const analysis: StatPeriod = { kind: 'analysis',
    label: t('developerReference.stats.period.week', 'Last 7 days (Sep 27 – Oct 3) — synthetic'),
    start: '2026-09-27T00:00:00Z', endExclusive: '2026-10-04T00:00:00Z',
    timezone: 'UTC', completeness: 'complete', provenance: 'synthetic-reference-only' };
  const acrossYears: StatPeriod = { ...analysis,
    label: t('developerReference.stats.period.crossYear', 'Dec 28, 2025 – Jan 3, 2026 — synthetic'),
    start: '2025-12-28T00:00:00Z', endExclusive: '2026-01-04T00:00:00Z' };
  const linked: readonly StatMetric[] = [
    { metricId: 'count', rawValue: 6, href: '/dev/stats',
      comparison: { metricId: 'number', rawValue: 2, period: unknown, signed: true,
        label: t('developerReference.stats.comparison.count', 'Change in sessions') } },
    { metricId: 'energy', rawValue: 158000,
      comparison: { metricId: 'percent', rawValue: -4, period: unknown,
        label: t('developerReference.stats.comparison.energy', 'Energy change') } },
    { metricId: 'currency', rawValue: 12345678.9 },
    { metricId: 'charge.overallRate', rawValue: null,
      missingReason: t('developerReference.stats.reason.sessions', 'Needs at least 2 sessions — synthetic reason, not a production eligibility rule') },
    { metricId: 'duration', rawValue: 7800 }, { metricId: 'power', rawValue: 0 },
  ];
  return <div className="space-y-4">
    <GlassPanel className="space-y-4 p-4">
      <Heading>{t('developerReference.stats.strips.title', 'Two through six tiles')}</Heading>
      <Text as="p">{t('developerReference.stats.strips.policy',
        'Container widths determine two, three or up to six columns. Odd phone rows span the final tile. All examples below are synthetic.')}</Text>
      {[2, 3, 4, 5, 6].map(count => <StatStrip key={count} id={`dev-stats-${count}`}
        title={t('developerReference.stats.strips.count', '{{count}} synthetic tiles', { count })}
        metrics={stripMetrics.slice(0, count)} period={analysis} preferences={preferences} />)}
    </GlassPanel>
    <StatStrip id="dev-stats-states" title={t('developerReference.stats.strips.states', 'Links, comparisons, zero and missing reasons')}
      metrics={linked} period={acrossYears} preferences={preferences}
      breakdown={[
        t('developerReference.stats.fact.home', '4 home'), t('developerReference.stats.fact.supercharger', '2 Supercharger'),
        t('developerReference.stats.fact.grade', 'Battery score A'), t('developerReference.stats.fact.start', 'Usually starts 6 AM'),
        t('developerReference.stats.fact.recorded', 'Recorded cost fixture'), t('developerReference.stats.fact.synthetic', 'Synthetic reference'),
      ]} />
    <StatStrip id="dev-stats-loading" title={t('developerReference.stats.strips.loading', 'Reserved loading geometry')}
      metrics={stripMetrics} period={unknown} loading preferences={preferences} />
    <StatStrip id="dev-stats-retained" title={t('developerReference.stats.strips.retained', 'Retained measurements during refresh')}
      metrics={stripMetrics} period={unknown} loading retained
      error={t('developerReference.stats.state.error', 'Synthetic refresh error; retained measurements remain visible')} preferences={preferences} />
    <StatStrip id="dev-stats-error" title={t('developerReference.stats.strips.error', 'Error with explicit missing readings')}
      metrics={[{ metricId: 'energy', rawValue: null }, { metricId: 'duration', rawValue: null }]} period={unknown}
      error={t('developerReference.stats.state.noSource', 'Synthetic source error; no measurements supplied')} preferences={preferences} />
    <GlassPanel className="p-4">
      <Heading>{t('developerReference.stats.group.title', 'Embedded group uses the same renderer')}</Heading>
      <Text as="p" id="dev-stats-card-period" data-stat-period>{analysis.label}</Text>
      <StatGroup id="dev-stats-group" metrics={stripMetrics} period={analysis} preferences={preferences}
        periodInHeader periodHeaderId="dev-stats-card-period" />
    </GlassPanel>
    <StatStrip id="dev-stats-snapshot" metrics={[{ metricId: 'percent', rawValue: 74 }]}
      period={{ kind: 'snapshot', label: t('developerReference.stats.period.now', 'Now — synthetic snapshot; freshness unknown'),
        observedAt: null, provenance: 'synthetic-reference-only' }} preferences={preferences} />
    <StatStrip id="dev-stats-status" metrics={[{ metricId: 'status', rawValue: t('developerReference.stats.status.fixture', 'Synthetic fit status') }]}
      period={unknown} preferences={preferences} />
    <StatStrip id="dev-stats-alltime" metrics={stripMetrics.slice(0, 2)}
      period={{ kind: 'alltime', label: t('developerReference.stats.period.alltime', 'All time — synthetic only'),
        provenance: 'synthetic-reference-only' }} preferences={preferences} />
    <StatStrip id="dev-stats-event" metrics={stripMetrics.slice(0, 2)}
      period={{ kind: 'event', label: t('developerReference.stats.period.event', 'Single event — synthetic open-ended record'),
        eventId: 'synthetic', start: '2026-10-01T12:00:00Z', end: null, provenance: 'synthetic-reference-only' }} preferences={preferences} />
    <StatStrip id="dev-stats-empty" metrics={[]} period={unknown} preferences={preferences} />
  </div>;
}
