import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { MetricBar } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useDriveScore } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetGaugeHero, type GaugeHeroConfig, type GaugeHeroStat } from './shared';
import type { WidgetProps } from './types';

const SCORE_COLORS = {
  excellent: '#10b981',
  good: '#22d3ee',
  fair: '#f59e0b',
  poor: '#ef4444',
} as const;

export function scoreColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.excellent;
  if (score >= 60) return SCORE_COLORS.good;
  if (score >= 40) return SCORE_COLORS.fair;
  return SCORE_COLORS.poor;
}

export default function DriveScoreGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const { data: score, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useDriveScore(vehicleIdStr);

  const overall = score?.overall ?? 0;
  const color = useMemo(() => scoreColor(overall), [overall]);

  const isCompact = size.cols === 1 && size.rows === 1;
  const isTall = size.rows >= 2;

  // `/drives/score` answers 200 with an all-zero object (grade "F",
  // total_drives 0) for a vehicle that has no completed drives yet — it never
  // returns null. A plain truthiness check would therefore render a misleading
  // "0 / F" gauge for a brand-new vehicle. Gate on the scored-drive count so
  // the empty state surfaces until there is at least one drive to score.
  const hasScoredDrives = !!score && (score.totalDrives ?? 0) > 0;

  const gauge = useMemo<GaugeHeroConfig>(() => ({
    value: overall,
    max: 100,
    label: score?.grade ?? '—',
    unit: t('widget.driveScoreGauge.weekly', 'Weekly score'),
    color,
  }), [overall, score?.grade, color, t]);

  const stats = useMemo<GaugeHeroStat[]>(() => {
    if (!score) return [];
    return [
      { label: t('widget.driveScoreGauge.efficiency', 'Efficiency'), value: score.efficiency ?? 0 },
      { label: t('widget.driveScoreGauge.smoothness', 'Smoothness'), value: score.smoothness ?? 0 },
      { label: t('widget.driveScoreGauge.speed', 'Speed Discipline'), value: score.speedDiscipline ?? 0 },
    ];
  }, [score, t]);

  const subScores = useMemo(() => {
    if (!score) return [];
    return [
      { key: 'efficiency', label: t('widget.driveScoreGauge.efficiency', 'Efficiency'), value: score.efficiency },
      { key: 'smoothness', label: t('widget.driveScoreGauge.smoothness', 'Smoothness'), value: score.smoothness },
      { key: 'speed', label: t('widget.driveScoreGauge.speed', 'Speed Discipline'), value: score.speedDiscipline },
    ];
  }, [score, t]);

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.driveScoreGauge.title', 'Drive Score')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      error={error ? String(error) : null}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasScoredDrives ? (
        <WidgetGaugeHero gauge={gauge} stats={stats} compact={isCompact}>
          {isTall && (
            <div className="flex flex-col gap-2 w-full">
              {subScores.map((s) => (
                <MetricBar
                  key={s.key}
                  value={s.value ?? 0}
                  max={100}
                  color={scoreColor(s.value ?? 0)}
                  label={s.label}
                  sublabel={`${s.value ?? 0}`}
                />
              ))}
            </div>
          )}
        </WidgetGaugeHero>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Gauge className="h-5 w-5" />}
          message={t('widget.driveScoreGauge.noData', 'No score yet')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
