import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Zap, ShieldCheck, Lightbulb } from 'lucide-react';

import { GlassPanel, Badge, DataTable, type Column } from '@/components/ui';
import {
  ChartTooltip,
  RadialGauge,
  AREA_DEFAULTS,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from '@/components/charts';
import { StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { fmtNumber } from '@/lib/numberFormat';
import { formatDateShort } from '@/lib/dateFormat';
import { cn } from '@/lib/cn';
import type { DrivingCoachData, CoachDriveScore } from '@/types/driving';

interface DrivingCoachSectionProps {
  coachData: DrivingCoachData | undefined;
}

export default function DrivingCoachSection({ coachData }: DrivingCoachSectionProps) {
  const { t } = useTranslation();

  const coachColumns: Column<CoachDriveScore>[] = useMemo(
    () => [
      { key: 'date', header: t('Date'), render: (r: CoachDriveScore) => formatDateShort(r.date), sortable: true },
      {
        key: 'score', header: t('Score'), sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge variant={r.score >= 75 ? 'success' : r.score >= 50 ? 'warning' : 'danger'} size="sm">
            {r.score}
          </Badge>
        ),
      },
      {
        key: 'style', header: t('Style'), sortable: true,
        render: (r: CoachDriveScore) => (
          <Badge
            variant={r.style === 'efficient' ? 'success' : r.style === 'moderate' ? 'warning' : 'danger'}
            size="sm"
          >
            {r.style}
          </Badge>
        ),
      },
      { key: 'efficiency', header: t('Wh/km'), render: (r: CoachDriveScore) => fmtNumber(r.efficiency), sortable: true },
      { key: 'distance', header: t('Distance'), render: (r: CoachDriveScore) => `${fmtNumber(r.distance)} km`, sortable: true },
    ],
    [t],
  );

  const patterns = [
    { label: t('dynamics.coach.hardAccel', 'Hard Acceleration'), value: coachData?.patterns.hard_accel_pct ?? 0, lo: 20, hi: 40 },
    { label: t('dynamics.coach.hardBrake', 'Hard Braking'), value: coachData?.patterns.hard_brake_pct ?? 0, lo: 15, hi: 30 },
    { label: t('dynamics.coach.highway', 'Highway Driving'), value: coachData?.patterns.highway_pct ?? 0, lo: 50, hi: 70 },
    { label: t('dynamics.coach.shortTrips', 'Short Trips (<5 km)'), value: coachData?.patterns.short_trip_pct ?? 0, lo: 30, hi: 50 },
    { label: t('dynamics.coach.coldStarts', 'Cold Starts'), value: coachData?.patterns.cold_start_pct ?? 0, lo: 15, hi: 30 },
  ];

  return (
    <>
      {/* Section heading */}
      <FadeIn delay={0.42}>
        <div className="mt-4 mb-2">
          <h2 className="text-lg font-semibold text-white/80">
            {t('dynamics.coach.title', 'Driving Coach')}
          </h2>
        </div>
      </FadeIn>

      {/* Score + Style + Efficiency */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <FadeIn delay={0.43}>
          <GlassPanel className="flex flex-col items-center justify-center p-6">
            <RadialGauge
              value={coachData?.overall_score ?? 0}
              max={100}
              label={t('dynamics.coach.overallScore', 'Driving Score')}
              color={
                (coachData?.overall_score ?? 0) >= 75 ? '#22c55e' :
                (coachData?.overall_score ?? 0) >= 50 ? '#f59e0b' : '#ef4444'
              }
              size={160}
            />
            <p className="mt-2 text-xs text-white/50">
              {t('dynamics.coach.drivesAnalyzed', '{{count}} drives analyzed', { count: coachData?.total_drives_analyzed ?? 0 })}
            </p>
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.44}>
          <GlassPanel className="p-6">
            <h3 className="text-sm font-semibold mb-4">
              {t('dynamics.coach.styleBreakdown', 'Style Breakdown')}
            </h3>
            {coachData && coachData.total_drives_analyzed > 0 ? (
              <>
                <div className="flex h-4 rounded-full overflow-hidden mb-4">
                  {(['efficient', 'moderate', 'aggressive'] as const).map((style) => {
                    const count = coachData.style_breakdown[style] ?? 0;
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
                        title={`${style}: ${count}`}
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
                        <span className="capitalize text-white/70">{t(`dynamics.coach.style.${key}`, key)}</span>
                      </div>
                      <span className={cn('font-bold tabular-nums', text)}>
                        {coachData.style_breakdown[key] ?? 0}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <EmptyState message={t('dynamics.coach.noData', 'Drive more to see your style breakdown.')} />
            )}
          </GlassPanel>
        </FadeIn>

        <FadeIn delay={0.45}>
          <GlassPanel className="p-6 space-y-3">
            <StatCard
              label={t('dynamics.coach.avgEfficiency', 'Avg Efficiency')}
              value={`${fmtNumber(coachData?.efficiency_wh_km ?? 0)} Wh/km`}
              icon={<Zap className="h-4 w-4" />}
            />
            <StatCard
              label={t('dynamics.coach.bestEfficiency', 'Best Efficiency')}
              value={`${fmtNumber(coachData?.best_efficiency_wh_km ?? 0)} Wh/km`}
              icon={<ShieldCheck className="h-4 w-4" />}
            />
          </GlassPanel>
        </FadeIn>
      </div>

      {/* Weekly Trend */}
      <FadeIn delay={0.46}>
        <GlassPanel className="p-6">
          <h3 className="text-sm font-semibold mb-4">
            {t('dynamics.coach.weeklyTrend', 'Weekly Score Trend')}
          </h3>
          {(coachData?.weekly_trend ?? []).length > 1 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={coachData?.weekly_trend ?? []}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }} tickLine={false} axisLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: 'rgba(255,255,255,0.5)' }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Line {...AREA_DEFAULTS} dataKey="score" stroke="#22c55e" dot={{ fill: '#22c55e', r: 3 }} name={t('Score')} />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message={t('dynamics.coach.needWeeks', 'Need at least 2 weeks of data for trend analysis.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Pattern Indicators */}
      <FadeIn delay={0.47}>
        <GlassPanel className="p-6">
          <h3 className="text-sm font-semibold mb-4">
            {t('dynamics.coach.patterns', 'Driving Patterns')}
          </h3>
          <div className="space-y-3">
            {patterns.map((p) => (
              <div key={p.label} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-white/70">{p.label}</span>
                  <span className={cn('font-bold tabular-nums',
                    p.value <= p.lo ? 'text-emerald-300' :
                    p.value <= p.hi ? 'text-amber-300' : 'text-red-400',
                  )}>
                    {fmtNumber(p.value)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className={cn('h-full rounded-full',
                      p.value <= p.lo ? 'bg-neon-green' :
                      p.value <= p.hi ? 'bg-neon-amber' : 'bg-red-500',
                    )}
                    style={{ width: `${Math.min(100, p.value)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </GlassPanel>
      </FadeIn>

      {/* Recommendations */}
      <FadeIn delay={0.48}>
        <GlassPanel className="p-6">
          <h3 className="text-sm font-semibold mb-4 flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-neon-amber" />
            {t('dynamics.coach.recommendations', 'Recommendations')}
          </h3>
          {(coachData?.recommendations ?? []).length > 0 ? (
            <div className="space-y-3">
              {(coachData?.recommendations ?? []).map((rec, i) => (
                <div
                  key={i}
                  className="flex items-start gap-3 rounded-xl p-3 bg-white/[0.03] border border-white/[0.06]"
                >
                  <Badge
                    variant={rec.impact === 'high' ? 'danger' : rec.impact === 'medium' ? 'warning' : 'success'}
                    size="sm"
                    className="mt-0.5 shrink-0"
                  >
                    {rec.impact}
                  </Badge>
                  <p className="text-sm text-white/70">{rec.tip}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message={t('dynamics.coach.noRecs', 'Recommendations will appear after more drives.')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* Per-Drive Scores */}
      <FadeIn delay={0.49}>
        <GlassPanel className="p-6">
          <h3 className="text-sm font-semibold mb-4">
            {t('dynamics.coach.perDriveScores', 'Per-Drive Scores')}
          </h3>
          {(coachData?.per_drive_scores ?? []).length > 0 ? (
            <DataTable
              columns={coachColumns}
              data={coachData?.per_drive_scores ?? []}
              keyExtractor={(row: CoachDriveScore) => String(row.drive_id)}
              compact
              pagination
              emptyMessage={t('dynamics.coach.noDrives', 'No drives found.')}
            />
          ) : (
            <EmptyState message={t('dynamics.coach.noDrives', 'Drive data will appear after your first trip.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </>
  );
}
