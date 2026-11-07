import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Gauge } from 'lucide-react';
import { MetricBar } from '@/components/data-display';
import { LinearGauge } from '@/components/charts';
import { EmptyState } from '@/components/feedback';
import { useDriveScore } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { knownNumber } from '@/api/dataState';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import InstrumentPresentation from './designPacks/InstrumentPresentation';
import type { WidgetProps } from './types';
import { COLOR, CHART_NEUTRAL } from '@/lib/colors';

const SCORE_COLORS = {
  excellent: COLOR.GOOD,
  good: COLOR.CYAN,
  fair: COLOR.WARN,
  poor: COLOR.BAD,
} as const;

export function scoreColor(score: number): string {
  if (score >= 80) return SCORE_COLORS.excellent;
  if (score >= 60) return SCORE_COLORS.good;
  if (score >= 40) return SCORE_COLORS.fair;
  return SCORE_COLORS.poor;
}

export default function DriveScoreGaugeWidget({ vehicleId, size }: WidgetProps) {
  const { fmtNumber } = useNumberFormatting();
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vehicleIdStr = vid != null ? String(vid) : undefined;

  const query = useDriveScore(vehicleIdStr);
  const { data: score, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = query;
  const trust = useDataState({ ...query, data: score ?? undefined }, { provenance: 'inferred' });

  const overall = knownNumber(score?.overall);
  const color = useMemo(() => overall == null ? CHART_NEUTRAL : scoreColor(overall), [overall]);

  const isCompact = size.cols === 1 && size.rows === 1;
  const constrained = size.rows <= 5;

  // `/drives/score` answers 200 with an all-zero object (grade "F",
  // total_drives 0) for a vehicle that has no completed drives yet — it never
  // returns null. A plain truthiness check would therefore render a misleading
  // "0 / F" gauge for a brand-new vehicle. Gate on the scored-drive count so
  // the empty state surfaces until there is at least one drive to score.
  const scoredDriveCount = knownNumber(score?.totalDrives);
  const hasScoredDrives = scoredDriveCount != null && scoredDriveCount > 0;

  const subScores = useMemo(() => {
    if (!score) return [];
    return [
      { key: 'efficiency', label: t('widget.driveScoreGauge.efficiency', 'Efficiency'), value: score.efficiency },
      { key: 'smoothness', label: t('widget.driveScoreGauge.smoothness', 'Smoothness'), value: score.smoothness },
      { key: 'speed', label: t('widget.driveTelemetry.speed', 'Speed'), value: score.speedDiscipline },
    ];
  }, [score, t]);
  const gauge = overall != null ? (
    <LinearGauge value={overall} preserveReadingAndScale max={100}
      label={t('widget.weeklySummary.thisWeek', 'this week')}
      ariaLabel={t('widget.driveScoreGauge.title', 'Drive score')}
      unit="" color={color} size={isCompact ? 70 : 100} decimals={0} kind="count" hideScale />
  ) : (
    <div className="flex min-w-0 flex-col items-center gap-1 text-[var(--text-muted)]">
      <span className="text-lg font-semibold tabular-nums">—</span>
      <span className="text-xs">{t('widget.weeklySummary.thisWeek', 'this week')}</span>
    </div>
  );
  const details = !isCompact && (
    <div className={constrained ? 'flex flex-col gap-0.5 w-full' : 'flex flex-col gap-2 w-full'}>
      {subScores.map(s => (
        <MetricBar key={s.key} value={knownNumber(s.value)} max={100}
          color={knownNumber(s.value) == null ? CHART_NEUTRAL : scoreColor(s.value)}
          label={s.label} sublabel={knownNumber(s.value) == null ? '—' : fmtNumber(s.value)}
          size="slim" fill="solid" />
      ))}
    </div>
  );

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.driveScoreGauge.title', 'Drive score')}
      icon={isCompact ? undefined : <Gauge className="h-3.5 w-3.5 text-theme-accent" />}
      loading={isLoading}
      dataState={score != null || isLoading || isError || error ? trust : undefined}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {hasScoredDrives ? (
        <InstrumentPresentation family="ring" compact={isCompact}
          headline={<WidgetBigNumber value={overall == null ? null : fmtNumber(overall, 0)} unit="/100"
            label={t('widget.weeklySummary.thisWeek', 'this week')} animated={false} />}
          reading={{ value: overall, max: 100, label: t('widget.driveScoreGauge.title', 'Drive score'), color }}
          icon={<Gauge />} details={details}>
        <div className={constrained ? 'flex min-w-0 flex-col gap-1' : 'flex min-w-0 flex-col gap-3'}>
          {gauge}
          {details}
        </div>
        </InstrumentPresentation>
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
