import { Link } from 'react-router-dom';
import { MetricCard } from '@/components/data-display';
import { Grid } from '@/components/layout';
import { Badge, Text } from '@/components/ui';
import { fmtNumber } from '@/lib/numberFormat';
import { Evidence, RawRows } from './Evidence';
import { type PhysicsPage, hours, unknown, yesNo } from './PhysicsPageShell';

export default function PhysicsUnknownSection({ physics }: { physics: PhysicsPage }) {
  const { report, t } = physics;
  const coverage = report?.unknown_os;
  const budgets = coverage?.budgets ?? [];
  const window = coverage?.window_hours;
  const sampled = window != null && window > 0 && coverage?.sample_hours != null
    ? Math.min(100, Math.max(0, coverage.sample_hours / window * 100)) : null;
  const missing = window != null && window > 0 && coverage?.unknown_hours != null
    ? Math.min(100, Math.max(0, coverage.unknown_hours / window * 100)) : null;
  const sorted = [...budgets].sort((a, b) => b.hours - a.hours);
  const worst = sorted[0];
  const flagged = budgets.filter((row) => row.unknown);
  return <>
    <Evidence title={physics.title} honesty={coverage?.honesty}>
      <Grid cols={{ default: 1, md: 3 }} gap={3}>
        <MetricCard label={t('teslaOnly.window', 'Window')} value={hours(window, t)} color="cyan" />
        <MetricCard label={t('teslaOnly.sampled', 'Sampled')} value={hours(coverage?.sample_hours, t)} color="green" />
        <MetricCard label={t('teslaOnly.unknownHours', 'Unknown')} value={hours(coverage?.unknown_hours, t)} color="amber" />
      </Grid>
      <div className="flex flex-wrap gap-2">
        <Badge variant="neutral" size="sm">{t('teslaOnly.unknownAccepted', 'Accepted telemetry: {{value}}', { value: sampled == null ? unknown(t) : `${fmtNumber(sampled, 1)}%` })}</Badge>
        <Badge variant="warning" size="sm">{t('teslaOnly.unknownUncovered', 'Uncovered window: {{value}}', { value: missing == null ? unknown(t) : `${fmtNumber(missing, 1)}%` })}</Badge>
        <Badge variant="neutral" size="sm">{t('teslaOnly.unknownKinds', 'Reported signal budgets: {{count}}', { count: budgets.length })}</Badge>
      </div>
      <Text as="p" variant="caption">{t('teslaOnly.unknownAnalysis', 'Accepted telemetry is not completeness of every signal. Per-signal unknown budgets can overlap in time; never add them together or subtract them from sampled hours. An absent budget is unknown, not zero.')}</Text>
      <Text as="p" variant="caption">{t('teslaOnly.unknownWindowCaution', 'Accepted hours and unknown hours use the report window, not a promise of contiguous coverage. A zero or missing percentage does not prove a sensor never went silent.')}</Text>
    </Evidence>
    <Evidence title={t('teslaOnly.unknownSignalInvestigation', 'Signal-specific unknown-hour investigation')}>
      <div className="flex flex-wrap gap-2">
        <Badge variant="warning" size="sm">{t('teslaOnly.unknownFlagged', 'Unknown-flagged signal budgets: {{count}} / {{total}}', { count: flagged.length, total: budgets.length })}</Badge>
        {report?.evidence?.history_truncated && <Badge variant="warning" size="sm">{t('teslaOnly.historyCapped', 'History row cap reached')}</Badge>}
        {report?.evidence && !report.evidence.history_available && <Badge variant="warning" size="sm">{t('teslaOnly.historyUnavailable', 'History unavailable')}</Badge>}
      </div>
      <Text as="p" variant="bodySm">{t('teslaOnly.unknownWorst', 'Largest returned signal gap: {{signal}} · {{duration}}', {
        signal: worst?.kind ?? unknown(t), duration: hours(worst?.hours, t),
      })}</Text>
      {sorted.length ? <div className="grid gap-3 md:grid-cols-2">
        {sorted.map((row) => <div key={row.kind} className="space-y-1 rounded-lg border border-[var(--glass-border)] p-3">
          <div className="flex justify-between gap-2"><Text as="span" variant="bodySm">{row.kind}</Text><Badge variant={row.unknown ? 'warning' : 'neutral'} size="sm">{hours(row.hours, t)}</Badge></div>
          <Text as="p" variant="caption">{t('teslaOnly.unknownBudgetShare', '{{value}} of requested window', { value: window != null && window > 0 ? `${fmtNumber(Math.min(100, Math.max(0, 100 * row.hours / window)), 1)}%` : unknown(t) })}</Text>
          <Text as="p" variant="caption">{row.unknown ? t('teslaOnly.unknownBudgetFlagged', 'Uncertain signal coverage') : t('teslaOnly.unknownBudgetUnflagged', 'No unknown flag reported for this budget')}</Text>
        </div>)}
      </div> : <Text as="p" variant="bodySm">{t('teslaOnly.unknownNoBudgets', 'No signal-specific budgets returned; individual signal coverage cannot be assessed.')}</Text>}
      <div className="flex flex-wrap gap-4">
        <Link to="/tesla-physics/clocks" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.unknownInspectClocks', 'Check event and ingest intervals')} →</Link>
        <Link to="/tesla-physics/nervous-system" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.unknownInspectNerves', 'Check silent and contradictory signals')} →</Link>
        <Link to="/tesla-physics/car-kept-living" className="text-[var(--theme-primary)] underline-offset-4 hover:underline">{t('teslaOnly.unknownInspectQueue', 'Check broker and replay context')} →</Link>
      </div>
      <RawRows title={t('teslaOnly.budgetBreakdown', 'Per-signal coverage budget')} rows={sorted} tableId="physics:unknown" t={t}
        keyExtractor={(r) => r.kind} columns={[
          { key: 'kind', header: t('teslaOnly.kind', 'Kind'), render: (r) => r.kind },
          { key: 'hours', header: t('teslaOnly.unknownHours', 'Unknown'), render: (r) => hours(r.hours, t) },
          { key: 'flag', header: t('teslaOnly.unknownFlag', 'Unknown flag'), render: (r) => yesNo(r.unknown, t) },
        ]} />
    </Evidence>
  </>;
}
