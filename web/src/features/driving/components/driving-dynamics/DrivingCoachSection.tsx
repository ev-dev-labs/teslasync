import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, ShieldCheck, Lightbulb } from 'lucide-react';

import { GlassPanel, Badge, DataTable, PanelTitle, SectionTitle, Caption, Text, type Column } from '@/components/ui';
import {
  ChartTooltip,
  LinearGauge,
  AREA_DEFAULTS,
  LineChart,
  Line,
  XAxis,
  YAxis,
  chartGrid,
  axisTick,
  Tooltip,
  ResponsiveContainer,
  EmbeddedChart,
} from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { formatDateShort } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { useDrivingCoach } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { INTERVALS } from '@/lib/constants';
import type { CoachDriveScore } from '@/types/driving';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface DrivingCoachSectionProps {
  vehicleId: string | undefined;
  /** Other callers retain the table; the ride-first page omits redundancy. */
  showPerDriveScores?: boolean;
}

export default function DrivingCoachSection({ vehicleId, showPerDriveScores = true }: DrivingCoachSectionProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const efficiency = (value: number | null | undefined) => value != null
    ? `${fmtNumber(value / convertDistanceFromSI(1000, unitPrefs.distance))} Wh/${unitPrefs.distance}`
    : '—';

  // The coach model aggregates 30 days of drives — it only shifts when a
  // drive completes, so it refreshes on the slow analytics cadence rather
  // than inheriting the page's 5s live-motor poll.
  const coachQuery = useDrivingCoach(vehicleId, 30, INTERVALS.ANALYTICS);
  const coachState = useDataState(coachQuery, { provenance: 'historical' });
  const coachData = coachState.data;

  const coachColumns: Column<CoachDriveScore>[] = useMemo(
    () => [
      { key: 'date', header: t('common.date', 'Date'), render: (r: CoachDriveScore) => formatDateShort(r.date), sortable: true },
      {
        key: 'score', header: t('dynamics.coach.score', 'Score'), sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge variant={r.score >= 75 ? 'success' : r.score >= 50 ? 'warning' : 'danger'} size="sm">
            {r.score}
          </Badge>
        ),
      },
      {
        key: 'style', header: t('dynamics.coach.style', 'Style'), sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge
            variant={r.style === 'efficient' ? 'success' : r.style === 'moderate' ? 'warning' : 'danger'}
            size="sm"
          >
            {r.style}
          </Badge>
        ),
      },
      { key: 'efficiency', header: t('dynamics.coach.whPerKm', 'Wh/km'), render: (r: CoachDriveScore) => fmtNumber(r.efficiency), sortable: true },
      { key: 'distance', header: t('common.distance', 'Distance'), render: (r: CoachDriveScore) => `${fmtNumber(r.distance)} km`, sortable: true },
    ],
    [t, fmtNumber],
  );

  const patterns = useMemo(
    () => [
      { label: t('dynamics.coach.hardAccel', 'High power demand'), value: coachData?.patterns?.hard_accel_pct ?? null },
      { label: t('dynamics.coach.hardBrake', 'Strong regeneration'), value: coachData?.patterns?.hard_brake_pct ?? null },
      { label: t('dynamics.coach.highway', 'Highway Driving'), value: coachData?.patterns?.highway_pct ?? null },
      { label: t('dynamics.coach.shortTrips', 'Short Trips (<5 km)'), value: coachData?.patterns?.short_trip_pct ?? null },
      { label: t('dynamics.coach.coldStarts', 'Cold-weather drives'), value: coachData?.patterns?.cold_start_pct ?? null },
    ],
    [coachData, t],
  );

  return (
    <div className="space-y-4 sm:space-y-5">
      {/* Section heading */}
      <FadeIn delay={0.42}>
        <SectionTitle className="mt-2">
          {t('dynamics.coach.vehicleTitle', 'Vehicle coaching · last 30 days')}
        </SectionTitle>
        <Text as="p" variant="caption" className="mt-2">
          {t('dynamics.coach.scopeDescription', 'Completed drives with positive recorded energy and available speed, power, and temperature over the last 30 days. Scores compare consumption with this vehicle’s best measured trip; power and speed profiles are heuristics, not observed braking technique or safety ratings.')}
        </Text>
      </FadeIn>
      {coachQuery.isLoading ? <Skeleton className="h-12" /> : null}
      {coachState.fatalError ? <QueryError error={coachState.fatalError} onRetry={() => void coachQuery.refetch()} /> : null}
      <StaleRefreshWarning state={coachState} label={t('dynamics.coach.vehicleTitle', 'Vehicle coaching · last 30 days')} />

      {/* Score + Style + Efficiency */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-5">
        <FadeIn delay={0.43} className="h-full">
          <GlassPanel className="flex h-full flex-col items-center justify-center p-4 sm:p-5">
            {coachData?.overall_score != null && coachData.total_drives_analyzed > 0 ? <LinearGauge
              value={coachData?.overall_score ?? 0}
              max={100}
              label={t('dynamics.coach.overallScore', 'Efficiency comparison')}
              color="var(--theme-primary)"
              size={160}
            /> : <EmptyState /* no-action: vehicle coaching needs recorded drives */
              message={t('dynamics.coach.noScore', 'No vehicle-wide score available.')}
            />}
            <Caption className="mt-2">
              {t('dynamics.coach.drivesAnalyzed', '{{count}} drives analyzed', { count: coachData?.total_drives_analyzed ?? 0 })}
            </Caption>
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.44} className="h-full">
          <GlassPanel className="h-full p-4 sm:p-5">
            <PanelTitle className="mb-4">
              {t('dynamics.coach.styleBreakdown', 'Style Breakdown')}
            </PanelTitle>
            {coachData?.style_breakdown && coachData.total_drives_analyzed > 0 ? (
              <>
                <div className="flex h-4 rounded-full overflow-hidden mb-4">
                  {(['efficient', 'moderate', 'aggressive'] as const).map((style) => {
                    const count = coachData.style_breakdown?.[style] ?? 0;
                    const pct = (count / coachData.total_drives_analyzed) * 100;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={style}
                        className={cn(
                          style === 'efficient' ? 'bg-neon-green' :
                          style === 'moderate' ? 'bg-neon-amber' : 'bg-red-500',
                        )}
                        style={{ width: `${pct}%` }}
                        title={t('dynamics.coach.styleCount', '{{style}}: {{count}} drives', {
                          style: t(`dynamics.coach.styles.${style}`, style),
                          count,
                        })}
                      />
                    );
                  })}
                </div>
                <div className="space-y-2">
                  {([
                    { key: 'efficient', color: 'bg-neon-green', text: 'text-emerald-300' },
                    { key: 'moderate', color: 'bg-neon-amber', text: 'text-amber-300' },
                    { key: 'aggressive', color: 'bg-red-500', text: 'text-red-400' },
                  ] as const).map(({ key, color, text }) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
                        <Text as="span" color="secondary">{t(`dynamics.coach.styles.${key}`, key)}</Text>
                      </div>
                      <Text as="span" weight="bold" className={cn('tabular-nums', text)}>
                        {fmtNumber(coachData.style_breakdown?.[key] ?? 0, 0)}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.coach.noData', 'Drive more to see your style breakdown.')} />
            )}
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.45} className="h-full">
          <GlassPanel className="h-full space-y-3 p-4 sm:p-5">
            <StatCard
              label={t('dynamics.coach.avgEfficiency', 'Avg Efficiency')}
              value={efficiency(coachData && coachData.total_drives_analyzed > 0 ? coachData.efficiency_wh_km : null)}
              icon={<Zap className="h-4 w-4" aria-hidden="true" />}
            />
            <StatCard
              label={t('dynamics.coach.bestEfficiency', 'Best Efficiency')}
              value={efficiency(coachData && coachData.total_drives_analyzed > 0 ? coachData.best_efficiency_wh_km : null)}
              icon={<ShieldCheck className="h-4 w-4" aria-hidden="true" />}
            />
          </GlassPanel>
        </FadeIn>
      </div>

      {/* Weekly Trend (hero) + Driving Patterns */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3 xl:gap-5">
        <FadeIn delay={0.46} className="h-full xl:col-span-2">
          <GlassPanel className="h-full p-4 sm:p-5">
            <PanelTitle className="mb-4">
              {t('dynamics.coach.weeklyTrend', 'Weekly Score Trend')}
            </PanelTitle>
            {(coachData?.weekly_trend ?? []).length > 1 ? (
              // chart-a11y:no-table weekly score trend — rolling time-series, score interpreted in context not row-by-row
              <EmbeddedChart
                title={t('dynamics.coach.weeklyTrend', 'Weekly Score Trend')}
                ariaLabel={t('dynamics.coach.weeklyTrendAria', 'Line chart of weekly driving score over time')}
                height={200}
                fluid={false}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={coachData?.weekly_trend ?? []}>
                    {chartGrid}
                    <XAxis dataKey="week" tick={axisTick} tickLine={false} axisLine={false} />
                    <YAxis domain={[0, 100]} tick={axisTick} tickLine={false} axisLine={false} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line {...AREA_DEFAULTS} dataKey="score" stroke="#22c55e" dot={{ fill: '#22c55e', r: 3 }} name={t('dynamics.coach.score', 'Score')} />
                  </LineChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.coach.needWeeks', 'Need at least 2 weeks of data for trend analysis.')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Pattern Indicators */}
        <FadeIn delay={0.47} className="h-full">
          <GlassPanel className="h-full p-4 sm:p-5">
            <PanelTitle className="mb-4">
              {t('dynamics.coach.patterns', 'Driving Patterns')}
            </PanelTitle>
            {coachData?.patterns ? <div className="space-y-3">
              {patterns.map((p) => (
                <div key={p.label} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <Text as="span" color="secondary">{p.label}</Text>
                    <Text as="span" weight="bold" className="tabular-nums">
                      {p.value != null ? `${fmtNumber(p.value)}%` : '—'}
                    </Text>
                  </div>
                  {p.value != null ? <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--theme-primary)]"
                      style={{ width: `${Math.max(0, Math.min(100, p.value))}%` }}
                    />
                  </div> : null}
                </div>
              ))}
            </div> : <EmptyState /* no-action: patterns require recorded coaching evidence */
              message={t('dynamics.coach.noPatterns', 'No driving-pattern evidence available.')}
            />}
          </GlassPanel>
        </FadeIn>
      </div>

      {/* Recommendations + Per-Drive Scores */}
      <div className={cn('grid grid-cols-1 gap-4 xl:gap-5', showPerDriveScores && 'xl:grid-cols-2')}>
        <FadeIn delay={0.48} className="h-full">
          <GlassPanel className="h-full p-4 sm:p-5">
            <PanelTitle className="mb-4 flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-amber-300" aria-hidden="true" />
              {t('dynamics.coach.recommendations', 'Recommendations')}
            </PanelTitle>
            {(coachData?.recommendations ?? []).length > 0 ? (
              <div className="space-y-3">
                {(coachData?.recommendations ?? []).map((rec, i) => (
                  <div
                    key={i}
                    className="flex items-start gap-3 rounded-xl p-3 bg-[var(--surface-2)] border border-[var(--border-default)]"
                  >
                    <Badge
                      variant={rec.impact === 'high' ? 'danger' : rec.impact === 'medium' ? 'warning' : 'success'}
                      size="sm"
                      className="mt-0.5 shrink-0"
                    >
                      {t(`dynamics.coach.impact.${rec.impact}`, rec.impact)}
                    </Badge>
                    <Text as="p" size="sm" color="secondary">{rec.tip}</Text>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.coach.noRecs', 'Recommendations will appear after more drives.')} />
            )}
          </GlassPanel>
        </FadeIn>

        {/* Per-Drive Scores */}
        {showPerDriveScores ? <FadeIn delay={0.49} className="h-full">
          <GlassPanel className="h-full p-4 sm:p-5">
            <PanelTitle className="mb-4">
              {t('dynamics.coach.perDriveScores', 'Per-Drive Scores')}
            </PanelTitle>
            {(coachData?.per_drive_scores ?? []).length > 0 ? (
              <DataTable
                tableId="driving:coach-per-drive"
                columns={coachColumns}
                mobileColumns={['date', 'score', 'style']}
                data={coachData?.per_drive_scores ?? []}
                keyExtractor={(row: CoachDriveScore) => String(row.drive_id)}
                compact
                pagination
                emptyMessage={t('dynamics.coach.noDrives', 'No drives found.')}
              />
            ) : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.coach.noDrives', 'Drive data will appear after your first trip.')} />
            )}
          </GlassPanel>
        </FadeIn> : null}
      </div>
    </div>
  );
}
