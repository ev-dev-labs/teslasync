import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Lightbulb } from 'lucide-react';

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
import type { StatMetric } from '@/components/data-display/stat-reference';
import { NestedDrivingBrief } from '../operationalbrief-a-m/NestedDrivingBrief';
import { EmptyState, QueryError, Skeleton, StaleRefreshWarning } from '@/components/feedback';
import { FadeIn } from '@/components/motion';

import { formatDateShort } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import { useDrivingCoach } from '@/api/hooks/useDriving';
import { useDataState } from '@/hooks/useDataState';
import { useChartPalette } from '@/hooks/useChartPalette';
import { INTERVALS } from '@/lib/constants';
import type { CoachDriveScore } from '@/types/driving';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useUnits } from '@/hooks/useUnits';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { DynamicsPausedNotice } from '../driving-dynamics-modernization/DynamicsPausedNotice';
import { isFiniteNumber } from '@/lib/numberFormat';

function measuredCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

interface DrivingCoachSectionProps {
  vehicleId: string | undefined;
  /** Other callers retain the table; the ride-first page omits redundancy. */
  showPerDriveScores?: boolean;
}

export default function DrivingCoachSection({ vehicleId, showPerDriveScores = true }: DrivingCoachSectionProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  const palette = useChartPalette();
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
  const initialPaused = !coachState.hasData
    && (coachState.isRefreshBlocked || coachQuery.isLoading || coachState.fatalError != null);
  const totalDrives = measuredCount(coachData?.total_drives_analyzed);
  const analyzedCaption = totalDrives == null ? '—'
    : t('dynamics.coach.drivesAnalyzed', '{{count}} drives analyzed', { count: totalDrives });

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
  const intensityMetrics: StatMetric[] = [
    { metricId: 'efficiency', occurrenceId: 'coach-average',
      rawValue: coachData && totalDrives != null && totalDrives > 0 && isFiniteNumber(coachData.efficiency_wh_km)
        ? coachData.efficiency_wh_km / 1000 : null,
      label: t('dynamics.coach.avgEfficiency', 'Avg Efficiency'),
      display: { formatter: raw => ({ value: efficiency(raw * 1000), unit: '' }) } },
    { metricId: 'efficiency', occurrenceId: 'coach-best',
      rawValue: coachData && totalDrives != null && totalDrives > 0 && isFiniteNumber(coachData.best_efficiency_wh_km)
        ? coachData.best_efficiency_wh_km / 1000 : null,
      label: t('dynamics.coach.bestEfficiency', 'Best Efficiency'),
      display: { formatter: raw => ({ value: efficiency(raw * 1000), unit: '' }) } },
  ];

  return (
    <div className="space-y-4 sm:space-y-5 max-md:[&_button]:min-h-11 max-md:[&_button]:min-w-11 max-md:[&_input]:min-h-11 max-md:[&_select]:min-h-11">
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
      <DynamicsPausedNotice state={coachState} label={t('dynamics.coach.vehicleTitle', 'Vehicle coaching · last 30 days')} />

      {/* Score + Style + Efficiency */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3 xl:gap-5">
        <FadeIn delay={0.43} className="h-full">
          <GlassPanel className="flex h-full flex-col items-center justify-center p-4 sm:p-5">
            {isFiniteNumber(coachData?.overall_score) && totalDrives != null && totalDrives > 0 ? <LinearGauge
              value={coachData.overall_score}
              max={100}
              label={t('dynamics.coach.overallScore', 'Efficiency comparison')}
              color={palette[0]}
              size={160}
            /> : initialPaused ? null : <EmptyState /* no-action: vehicle coaching needs recorded drives */
              message={t('dynamics.coach.noScore', 'No vehicle-wide score available.')}
            />}
            <Caption className="mt-2">
              {analyzedCaption}
            </Caption>
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.44} className="h-full">
          <GlassPanel className="h-full p-4 sm:p-5">
            <PanelTitle className="mb-4">
              {t('dynamics.coach.styleBreakdown', 'Style Breakdown')}
            </PanelTitle>
            {coachData?.style_breakdown ? (
              <>
                <div className="flex h-4 rounded-full overflow-hidden mb-4">
                  {(['efficient', 'moderate', 'aggressive'] as const).map((style) => {
                    const count = measuredCount(coachData.style_breakdown?.[style]);
                    if (count == null || totalDrives == null || totalDrives <= 0 || count > totalDrives) return null;
                    const pct = (count / totalDrives) * 100;
                    if (pct <= 0) return null;
                    return (
                      <div
                        key={style}
                        className={cn(
                          'shrink-0',
                          style === 'efficient' ? 'bg-[var(--semantic-success)]' :
                          style === 'moderate' ? 'bg-[var(--semantic-warning)]' : 'bg-[var(--semantic-danger)]',
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
                    { key: 'efficient', color: 'bg-[var(--semantic-success)]' },
                    { key: 'moderate', color: 'bg-[var(--semantic-warning)]' },
                    { key: 'aggressive', color: 'bg-[var(--semantic-danger)]' },
                  ] as const).map(({ key, color }) => (
                    <div key={key} className="flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className={cn('inline-block h-2 w-2 rounded-full', color)} />
                        <Text as="span" color="secondary">{t(`dynamics.coach.styles.${key}`, key)}</Text>
                      </div>
                      <Text as="span" weight="bold" className="tabular-nums">
                        {measuredCount(coachData.style_breakdown?.[key]) == null ? '—'
                          : fmtNumber(coachData.style_breakdown[key], 0)}
                      </Text>
                    </div>
                  ))}
                </div>
              </>
            ) : initialPaused ? null : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.coach.noData', 'Drive more to see your style breakdown.')} />
            )}
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.45} className="h-full">
          <GlassPanel className="h-full space-y-3 p-4 sm:p-5">
            <NestedDrivingBrief metrics={intensityMetrics}
              title={t('dynamics.brief.coachConsumption', 'Vehicle coaching consumption')}
              description={t('dynamics.coach.scopeDescription', 'Completed drives with positive recorded energy and available speed, power, and temperature over the last 30 days. Scores compare consumption with this vehicle’s best measured trip; power and speed profiles are heuristics, not observed braking technique or safety ratings.')}
              loading={coachQuery.isLoading && !coachState.hasData}
              unavailable={coachState.fatalError != null} retained={coachState.refreshError != null}
              period={{ kind: 'unknown', label: t('dynamics.coach.vehicleTitle', 'Vehicle coaching · last 30 days'),
                reason: analyzedCaption }} />
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
                    <Line {...AREA_DEFAULTS} dataKey="score" stroke={palette[0]} dot={{ fill: palette[0], r: 3 }} name={t('dynamics.coach.score', 'Score')} />
                  </LineChart>
                </ResponsiveContainer>
              </EmbeddedChart>
            ) : initialPaused ? null : (
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
                      {isFiniteNumber(p.value) ? `${fmtNumber(p.value)}%` : '—'}
                    </Text>
                  </div>
                  {isFiniteNumber(p.value) ? <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[var(--theme-primary)]"
                      style={{ width: `${Math.max(0, Math.min(100, p.value))}%` }}
                    />
                  </div> : null}
                </div>
              ))}
            </div> : initialPaused ? null : <EmptyState /* no-action: patterns require recorded coaching evidence */
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
              <Lightbulb className="h-4 w-4 text-[var(--semantic-warning)]" aria-hidden="true" />
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
            ) : initialPaused ? null : (
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
                mobileColumns={['date', 'score', 'style', 'efficiency', 'distance']}
                data={coachData?.per_drive_scores ?? []}
                keyExtractor={(row: CoachDriveScore) => String(row.drive_id)}
                compact
                pagination
                emptyMessage={t('dynamics.coach.noDrives', 'No drives found.')}
              />
            ) : initialPaused ? null : (
              <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('dynamics.coach.noDrives', 'Drive data will appear after your first trip.')} />
            )}
          </GlassPanel>
        </FadeIn> : null}
      </div>
    </div>
  );
}
