import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSortToggle } from '@/components/ui';
import { useDriveScore, useDrives } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { useRangeState } from '@/hooks/useRangeState';
import { formatDateShort } from '@/lib/dateFormat';
import { typography } from '@/lib/tokens';
import { Icons } from '@/lib/icons';
import { getEnergyIntensityWhPerKm } from '@/lib/drivesAggregation';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDataState } from '@/hooks/useDataState';
import { knownNumber } from '@/api/dataState';
import {
  CATEGORY_COLORS, gradeFromScore, scoreDrive,
  type HistoryRow, type ScoredDrive,
} from '../components/score-orchestrator/scoreDomain';
import { buildTips } from '../components/score-orchestrator/scoreTips';
import { buildAchievements } from '../components/score-orchestrator/scoreAchievements';
import { computePeriodStats } from '../components/score-orchestrator/scorePeriodStats';
import { createHistoryColumns } from '../components/score-orchestrator/scoreHistoryColumns';

export function useDriveScorePage() {
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const { t } = useTranslation();
  usePageTitle(t('driveScore.title', 'Drive Score'));

  /* ---- vehicle selector: header VehiclePicker is the source of truth ---- */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* ---- queries ---- */
  const scoreQuery = useDriveScore(vehicleIdStr);
  const apiScoreState = useDataState(scoreQuery, { provenance: 'historical' });
  const apiScore = scoreQuery.data;

  const drivesQuery = useDrives(vehicleIdStr);
  const {
    data: drives,
    refetch,
  } = drivesQuery;
  const drivesSource = useDataState(drivesQuery, { provenance: 'historical' });
  const drivesLoading = vehicleIdStr != null && !drivesSource.hasData && (drivesQuery.isLoading || drivesQuery.isPending);
  const drivesError = drivesSource.fatalError;
  const drivesIsError = drivesError != null;

  /* ---- unit formatting (SI in, display-boundary out) ---- */
  const { unitPrefs, formatDistance, formatSpeed, formatPower } = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const efficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;
  const formatEfficiency = (whPerKm: number) =>
    `${fmtInt(efficiencyDisplay(whPerKm))} ${efficiencyUnit}`;

  /* ---- date filter ---- */
  const { start: startDate, end: endDate } = useRangeState({
    persistKey: 'drive-score.range',
  });

  /* ---- table sort (shared DataTable controlled sort) ---- */
  const { sortKey, sortDir, onSort, sortFn } = useSortToggle('date', 'desc');

  /* ---- filtered & scored drives ---- */
  const filteredDrives = useMemo(() => {
    const list = drives ?? [];
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime() + 86_400_000;
    return list.filter((d) => {
      const ts = new Date(d.startTs).getTime();
      return ts >= start && ts <= end;
    });
  }, [drives, startDate, endDate]);

  const scoredDrives = useMemo<ScoredDrive[]>(
    () => filteredDrives.flatMap((drive) => {
      const score = scoreDrive(drive);
      return score ? [{ drive, score }] : [];
    }),
    [filteredDrives],
  );
  const unscoredDriveCount = filteredDrives.length - scoredDrives.length;

  const allScores = useMemo(
    () => scoredDrives.map((sd) => sd.score),
    [scoredDrives],
  );

  const hasDrives = scoredDrives.length > 0;
  const hasDrivePayload = Array.isArray(drives);
  const hasScore = apiScore != null;
  const hasData = hasDrives || hasScore;

  /* ---- aggregate averages ---- */
  const avgScores = useMemo(() => {
    if (allScores.length === 0)
      return { total: 0, efficiency: 0, smoothness: 0, speed: 0 };
    const sum = allScores.reduce(
      (acc, s) => ({
        total: acc.total + s.total,
        efficiency: acc.efficiency + s.efficiency,
        smoothness: acc.smoothness + s.smoothness,
        speed: acc.speed + s.speed,
      }),
      { total: 0, efficiency: 0, smoothness: 0, speed: 0 },
    );
    const n = allScores.length;
    return {
      total: Math.round(sum.total / n),
      efficiency: Math.round(sum.efficiency / n),
      smoothness: Math.round(sum.smoothness / n),
      speed: Math.round(sum.speed / n),
    };
  }, [allScores]);

  const overallScore = apiScore?.overall ?? avgScores.total;
  const overallReading = knownNumber(apiScore?.overall ?? (hasDrives ? avgScores.total : null));
  const overallGrade = apiScore?.grade ?? (overallReading != null ? gradeFromScore(overallScore) : '—');
  const overallTrend = apiScore?.trend ?? 'flat';

  const efficiencyValue = apiScore?.efficiency ?? avgScores.efficiency;
  const smoothnessValue = apiScore?.smoothness ?? avgScores.smoothness;
  const speedValue = apiScore?.speedDiscipline ?? avgScores.speed;
  const efficiencyReading = knownNumber(apiScore?.efficiency ?? (hasDrives ? avgScores.efficiency : null));
  const smoothnessReading = knownNumber(apiScore?.smoothness ?? (hasDrives ? avgScores.smoothness : null));
  const speedReading = knownNumber(apiScore?.speedDiscipline ?? (hasDrives ? avgScores.speed : null));
  const hasCategoryReadings = efficiencyReading != null && smoothnessReading != null && speedReading != null;

  /* ---- category metric readouts ---- */
  const avgWhPerKm = useMemo(
    () => {
      const energyWh = scoredDrives.reduce(
        (sum, sd) => sum + (sd.drive.energyUsedWh ?? 0),
        0,
      );
      const distanceM = scoredDrives.reduce(
        (sum, sd) => sum + sd.drive.distanceM,
        0,
      );
      return getEnergyIntensityWhPerKm(distanceM, energyWh) ?? 0;
    },
    [scoredDrives],
  );
  const avgPowerW = useMemo(
    () =>
      scoredDrives.length > 0
        ? scoredDrives.reduce(
            (sum, sd) => sum + (sd.drive.avgPowerW ?? 0),
            0,
          ) / scoredDrives.length
        : 0,
    [scoredDrives],
  );
  const avgMaxSpeedMps = useMemo(
    () =>
      scoredDrives.length > 0
        ? scoredDrives.reduce(
            (sum, sd) => sum + (sd.drive.maxSpeedMps ?? 0),
            0,
          ) / scoredDrives.length
        : 0,
    [scoredDrives],
  );

  /* ---- trend chart data (last 20 drives) ---- */
  const trendChartData = useMemo(() => {
    const recent = [...scoredDrives]
      .sort(
        (a, b) =>
          new Date(a.drive.startTs).getTime() -
          new Date(b.drive.startTs).getTime(),
      )
      .slice(-20);
    return recent.map((sd) => ({
      date: formatDateShort(sd.drive.startTs),
      score: sd.score.total,
      efficiency: sd.score.efficiency,
      smoothness: sd.score.smoothness,
      speed: sd.score.speed,
    }));
  }, [scoredDrives]);

  /* ---- category bar chart data ---- */
  const categoryBarData = useMemo(
    () => [
      {
        name: t('driveScore.efficiency', 'Efficiency'),
        value: efficiencyReading,
        max: 40,
        fill: CATEGORY_COLORS.efficiency,
      },
      {
        name: t('driveScore.smoothness', 'Smoothness'),
        value: smoothnessReading,
        max: 30,
        fill: CATEGORY_COLORS.smoothness,
      },
      {
        name: t('driveScore.speedDiscipline', 'Speed Discipline'),
        value: speedReading,
        max: 30,
        fill: CATEGORY_COLORS.speed,
      },
    ],
    [efficiencyReading, smoothnessReading, speedReading, t],
  );

  /* ---- score distribution histogram ---- */
  const histogramData = useMemo(() => {
    const ranges = [
      { range: '0–20', min: 0, max: 20, color: '#f87171' },
      { range: '20–40', min: 20, max: 40, color: '#fb923c' },
      { range: '40–60', min: 40, max: 60, color: '#fbbf24' },
      { range: '60–80', min: 60, max: 80, color: '#22d3ee' },
      { range: '80–100', min: 80, max: 101, color: '#4ade80' },
    ];
    return ranges.map((r) => ({
      ...r,
      count: allScores.filter((s) => s.total >= r.min && s.total < r.max).length,
    }));
  }, [allScores]);

  /* ---- tips based on weakest category ---- */
  const tips = useMemo(() => buildTips(t), [t]);
  const weakestCategory = useMemo((): 'efficiency' | 'smoothness' | 'speed' => {
    const eff = efficiencyValue / 40;
    const sm = smoothnessValue / 30;
    const sp = speedValue / 30;
    if (eff <= sm && eff <= sp) return 'efficiency';
    if (sm <= sp) return 'smoothness';
    return 'speed';
  }, [efficiencyValue, smoothnessValue, speedValue]);
  const relevantTips = useMemo(
    () => tips.filter((tip) => tip.category === weakestCategory),
    [tips, weakestCategory],
  );
  const weakestCategoryLabel =
    weakestCategory === 'efficiency'
      ? t('driveScore.efficiency', 'Efficiency')
      : weakestCategory === 'smoothness'
        ? t('driveScore.smoothness', 'Smoothness')
        : t('driveScore.speedDiscipline', 'Speed Discipline');

  /* ---- achievements ---- */
  const achievements = useMemo(() => buildAchievements(t), [t]);
  const unlockedAchievements = useMemo(
    () =>
      achievements.map((a) => ({
        ...a,
        unlocked: a.check(allScores, filteredDrives),
      })),
    [achievements, allScores, filteredDrives],
  );

  /* ---- best & worst drives ---- */
  const bestDrive = useMemo(
    () =>
      scoredDrives.length > 0
        ? [...scoredDrives].sort((a, b) => b.score.total - a.score.total)[0]
        : null,
    [scoredDrives],
  );
  const worstDrive = useMemo(
    () =>
      scoredDrives.length > 0
        ? [...scoredDrives].sort((a, b) => a.score.total - b.score.total)[0]
        : null,
    [scoredDrives],
  );

  /* ---- weekly / monthly averages ---- */
  const periodStats = useMemo(
    () => computePeriodStats(scoredDrives, new Date()),
    [scoredDrives],
  );

  /* ---- drive history rows (flat, for shared DataTable) ---- */
  const historyRows = useMemo<HistoryRow[]>(
    () =>
      scoredDrives.map(({ drive, score }) => ({
        id: drive.id,
        ts: drive.startTs,
        route: drive.startAddress
          ? `${drive.startAddress}${drive.endAddress ? ` → ${drive.endAddress}` : ''}`
          : t('driveScore.unknownRoute', 'Unknown'),
        distanceM: drive.distanceM ?? 0,
        durationS: knownNumber(drive.durationS),
        whPerKm: score.whPerKm,
        total: score.total,
        grade: score.grade,
        efficiency: score.efficiency,
        smoothness: score.smoothness,
        speed: score.speed,
      })),
    [scoredDrives, t],
  );

  const sortedHistory = useMemo(
    () =>
      sortFn(historyRows, (row, key) => {
        switch (key) {
          case 'date':
            return new Date(row.ts).getTime();
          case 'distance':
            return row.distanceM;
          case 'efficiency':
            return row.whPerKm;
          case 'score':
            return row.total;
          default:
            return 0;
        }
      }),
    [historyRows, sortFn],
  );

  const historyColumns = useMemo(
    () => createHistoryColumns(t, formatDistance, formatEfficiency),
    // formatDistance / formatEfficiency are stable across renders with the
    // same unit prefs; recompute columns when the translator changes.
    [t, formatDistance, formatEfficiency],
  );

  /* ---- trend indicator ---- */
  const TrendIcon =
    overallTrend === 'up'
      ? Icons.trendUp
      : overallTrend === 'down'
        ? Icons.trendDown
        : Icons.remove;
  const trendLabel =
    overallTrend === 'up'
      ? t('driveScore.trendUp', 'Improving')
      : overallTrend === 'down'
        ? t('driveScore.trendDown', 'Declining')
        : t('driveScore.trendFlat', 'Stable');
  const trendColor =
    overallTrend === 'up'
      ? 'text-emerald-300'
      : overallTrend === 'down'
        ? 'text-rose-300'
        : typography.color.secondary;

  const noDrivesMsg = t(
    'driveScore.empty',
    'Not enough drives in the selected period to calculate a score.',
  );
  const completeDistance = filteredDrives.every((drive) => knownNumber(drive.distanceM) != null);
  const completeDuration = filteredDrives.every((drive) => knownNumber(drive.durationS) != null);
  const measuredMaxSpeeds = filteredDrives
    .map((drive) => knownNumber(drive.maxSpeedMps))
    .filter((value): value is number => value != null);

  return {
    t, fmtInt, fmtNumber, vehicleId, vehicleIdStr,
    scoreQuery, apiScoreState, apiScore, drivesQuery, refetch, drivesSource,
    drivesLoading, drivesError, drivesIsError,
    formatDistance, formatSpeed, formatPower, efficiencyUnit, efficiencyDisplay, formatEfficiency,
    sortKey, sortDir, onSort, filteredDrives, scoredDrives, unscoredDriveCount, allScores,
    hasDrives, hasDrivePayload, hasScore, hasData, avgScores,
    overallReading, overallGrade, overallTrend,
    efficiencyReading, smoothnessReading, speedReading, hasCategoryReadings,
    avgWhPerKm, avgPowerW, avgMaxSpeedMps, trendChartData, categoryBarData, histogramData,
    relevantTips, weakestCategoryLabel, unlockedAchievements, bestDrive, worstDrive,
    periodStats, sortedHistory, historyColumns, TrendIcon, trendLabel, trendColor,
    noDrivesMsg, completeDistance, completeDuration, measuredMaxSpeeds,
  };
}

export type DriveScorePageModel = ReturnType<typeof useDriveScorePage>;
