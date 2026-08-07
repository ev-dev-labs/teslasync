import { useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { PageContainer } from '@/components/layout';
import {
  GlassPanel,
  Badge,
  Button,
  PanelTitle,
  Text,
  Caption,
  Label,
  HelpTooltip,
  DataTable,
  useSortToggle,
  type Column,
} from '@/components/ui';
import {
  ChartContainer,
  ChartTooltip,
  LinearGauge,
  AREA_DEFAULTS,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
  Legend,
  renderAnnotationLines,
} from '@/components/charts';
import {
  AnimatedNumber,
  StatCard,
  MetricBar,
  InlineMetric,
  KVList,
} from '@/components/data-display';
import { EmptyState, Skeleton, QueryError } from '@/components/feedback';
import { RangePicker, VehicleSelect } from '@/components/forms';
import { FadeIn } from '@/components/motion';

import { useDriveScore, useDrives } from '@/api/hooks/useDriving';
import { useUnits } from '@/hooks/useUnits';
import { usePageTitle } from '@/hooks/usePageTitle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { formatDateShort, formatDurationMinutes } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { typography, chartTokens } from '@/lib/tokens';
import { COLOR } from '@/lib/colors';
import { Icons } from '@/lib/icons';
import type { Drive } from '@/types/driving';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

/** Per-drive score computed on the client when the API score is absent. */
export interface ComputedScore {
  total: number;
  efficiency: number;
  smoothness: number;
  speed: number;
  grade: string;
  whPerKm: number;
}

export interface ScoredDrive {
  drive: Drive;
  score: ComputedScore;
}

/** Flat row shape for the shared DataTable (sortable by numeric fields). */
interface HistoryRow {
  id: number;
  ts: string;
  route: string;
  distanceM: number;
  durationS: number;
  whPerKm: number;
  total: number;
  grade: string;
  efficiency: number;
  smoothness: number;
  speed: number;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

/**
 * Gauge / chart fill colors keyed by grade. These are passed as dynamic
 * `color` props to LinearGauge / recharts fills — never used as body text.
 */
const GRADE_COLORS: Record<string, string> = {
  'A+': '#39ff14',
  A: '#4ade80',
  B: '#22d3ee',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
};

/** Category accent colors for gauges + chart series (dynamic fills only). */
const CATEGORY_COLORS = {
  efficiency: '#4ade80',
  smoothness: '#22d3ee',
  speed: '#a78bfa',
};

const DRIVES_PER_PAGE = 10;

/* ------------------------------------------------------------------ */
/*  Scoring algorithm                                                  */
/* ------------------------------------------------------------------ */

export function scoreDrive(drive: Drive): ComputedScore {
  const battUsed = (drive.startBatteryPct ?? 50) - (drive.endBatteryPct ?? 45);
  const energyKwh =
    drive.energyUsedWh != null ? drive.energyUsedWh / 1000 : (battUsed / 100) * 75;
  const distanceKm = (drive.distanceM ?? 0) / 1000;
  const whPerKm = distanceKm > 0 ? (energyKwh * 1000) / distanceKm : 200;

  const effScore = Math.max(0, Math.min(40, 40 - (whPerKm - 130) / 3));
  const avgPowerKw = drive.avgPowerW != null ? drive.avgPowerW / 1000 : 30;
  const smoothScore = Math.max(0, Math.min(30, 30 - avgPowerKw / 3));
  const maxSpeedDisplayMph =
    drive.maxSpeedMps != null ? drive.maxSpeedMps * 2.2369362920544 : 80;
  const speedScore = Math.max(
    0,
    Math.min(30, 30 - Math.max(0, maxSpeedDisplayMph - 90) / 2),
  );

  const total = Math.round(effScore + smoothScore + speedScore);
  const grade =
    total >= 90
      ? 'A+'
      : total >= 80
        ? 'A'
        : total >= 70
          ? 'B'
          : total >= 60
            ? 'C'
            : total >= 50
              ? 'D'
              : 'F';

  return {
    total,
    efficiency: Math.round(effScore),
    smoothness: Math.round(smoothScore),
    speed: Math.round(speedScore),
    grade,
    whPerKm: Math.round(whPerKm),
  };
}

export function gradeFromScore(score: number): string {
  return score >= 90
    ? 'A+'
    : score >= 80
      ? 'A'
      : score >= 70
        ? 'B'
        : score >= 60
          ? 'C'
          : score >= 50
            ? 'D'
            : 'F';
}

/* ------------------------------------------------------------------ */
/*  Presentation helpers                                               */
/* ------------------------------------------------------------------ */

export function gradeVariant(grade: string): 'success' | 'info' | 'warning' | 'danger' {
  if (grade === 'A+' || grade === 'A') return 'success';
  if (grade === 'B') return 'info';
  if (grade === 'C') return 'warning';
  return 'danger';
}

export function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? '#94a3b8';
}

/** Toned body-text color per grade (300-level shades, never neon). */
const GRADE_TEXT_CLASS: Record<string, string> = {
  'A+': 'text-emerald-300',
  A: 'text-emerald-300',
  B: 'text-cyan-300',
  C: 'text-amber-300',
  D: 'text-orange-300',
  F: 'text-rose-300',
};

function gradeTextClass(grade: string): string {
  return GRADE_TEXT_CLASS[grade] ?? typography.color.secondary;
}

function scoreTextClass(score: number | null): string {
  if (score == null) return typography.color.muted;
  if (score >= 80) return 'text-emerald-300';
  if (score >= 60) return 'text-amber-300';
  return 'text-rose-300';
}

export function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

export function getDefaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Tips data                                                          */
/* ------------------------------------------------------------------ */

interface Tip {
  key: string;
  category: 'efficiency' | 'smoothness' | 'speed';
  icon: ReactNode;
}

export function buildTips(t: (key: string, fallback: string) => string): Tip[] {
  return [
    {
      key: t(
        'driveScore.tips.preCondition',
        'Pre-condition your cabin while plugged in to reduce HVAC battery drain.',
      ),
      category: 'efficiency',
      icon: <Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.coastMore',
        'Coast more by lifting your foot earlier before stops.',
      ),
      category: 'efficiency',
      icon: <Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.tirePressure',
        'Keep tire pressure at recommended levels for better efficiency.',
      ),
      category: 'efficiency',
      icon: <Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.smoothAccel',
        'Accelerate gradually — aim for steady pedal pressure.',
      ),
      category: 'smoothness',
      icon: <Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.regenBraking',
        'Use regenerative braking instead of the brake pedal when possible.',
      ),
      category: 'smoothness',
      icon: <Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.followDistance',
        'Maintain a larger following distance to avoid sudden braking.',
      ),
      category: 'smoothness',
      icon: <Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.speedLimit',
        'Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h.',
      ),
      category: 'speed',
      icon: <Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.cruiseControl',
        'Use Autopilot or cruise control on highways for consistent speed.',
      ),
      category: 'speed',
      icon: <Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />,
    },
    {
      key: t(
        'driveScore.tips.routePlanning',
        'Plan routes to avoid high-speed stretches when possible.',
      ),
      category: 'speed',
      icon: <Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Achievement definitions                                            */
/* ------------------------------------------------------------------ */

interface Achievement {
  id: string;
  label: string;
  description: string;
  icon: ReactNode;
  check: (scores: ComputedScore[], drives: Drive[]) => boolean;
}

export function buildAchievements(
  t: (key: string, fallback: string) => string,
): Achievement[] {
  return [
    {
      id: 'first-drive',
      label: t('driveScore.achievements.firstDrive', 'First Drive'),
      description: t(
        'driveScore.achievements.firstDriveDesc',
        'Complete your first scored drive.',
      ),
      icon: <Icons.drive className="h-5 w-5" aria-hidden="true" />,
      check: (_scores, drives) => drives.length >= 1,
    },
    {
      id: 'ten-drives',
      label: t('driveScore.achievements.tenDrives', 'Road Regular'),
      description: t(
        'driveScore.achievements.tenDrivesDesc',
        'Complete 10 scored drives.',
      ),
      icon: <Icons.star className="h-5 w-5" aria-hidden="true" />,
      check: (_scores, drives) => drives.length >= 10,
    },
    {
      id: 'fifty-drives',
      label: t('driveScore.achievements.fiftyDrives', 'Highway Hero'),
      description: t(
        'driveScore.achievements.fiftyDrivesDesc',
        'Complete 50 scored drives.',
      ),
      icon: <Icons.trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />,
      check: (_scores, drives) => drives.length >= 50,
    },
    {
      id: 'perfect-score',
      label: t('driveScore.achievements.perfectScore', 'Perfect Score'),
      description: t(
        'driveScore.achievements.perfectScoreDesc',
        'Achieve a 100/100 on any drive.',
      ),
      icon: <Icons.award className="h-5 w-5 text-amber-300" aria-hidden="true" />,
      check: (scores) => scores.some((s) => s.total >= 100),
    },
    {
      id: 'a-plus-streak',
      label: t('driveScore.achievements.aPlusStreak', 'A+ Streak'),
      description: t(
        'driveScore.achievements.aPlusStreakDesc',
        'Get A+ grade on 5 consecutive drives.',
      ),
      icon: <Icons.trophy className="h-5 w-5 text-emerald-300" aria-hidden="true" />,
      check: (scores) => {
        let streak = 0;
        for (const s of scores) {
          if (s.grade === 'A+') {
            streak += 1;
            if (streak >= 5) return true;
          } else {
            streak = 0;
          }
        }
        return false;
      },
    },
    {
      id: 'efficiency-master',
      label: t('driveScore.achievements.efficiencyMaster', 'Efficiency Master'),
      description: t(
        'driveScore.achievements.efficiencyMasterDesc',
        'Score 38+ in efficiency on 3 drives.',
      ),
      icon: <Icons.charging className="h-5 w-5 text-emerald-300" aria-hidden="true" />,
      check: (scores) => scores.filter((s) => s.efficiency >= 38).length >= 3,
    },
    {
      id: 'smooth-operator',
      label: t('driveScore.achievements.smoothOperator', 'Smooth Operator'),
      description: t(
        'driveScore.achievements.smoothOperatorDesc',
        'Score 28+ in smoothness on 3 drives.',
      ),
      icon: <Icons.securityCheck className="h-5 w-5 text-cyan-300" aria-hidden="true" />,
      check: (scores) => scores.filter((s) => s.smoothness >= 28).length >= 3,
    },
    {
      id: 'speed-saint',
      label: t('driveScore.achievements.speedSaint', 'Speed Saint'),
      description: t(
        'driveScore.achievements.speedSaintDesc',
        'Score 28+ in speed discipline on 5 drives.',
      ),
      icon: <Icons.target className="h-5 w-5 text-purple-300" aria-hidden="true" />,
      check: (scores) => scores.filter((s) => s.speed >= 28).length >= 5,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Period statistics                                                  */
/* ------------------------------------------------------------------ */

/** Weekly / monthly roll-up derived from the scored drives in range. */
export interface PeriodStats {
  thisWeekAvg: number | null;
  lastWeekAvg: number | null;
  thisMonthAvg: number | null;
  lastMonthAvg: number | null;
  bestWeek: { avg: number; label: string };
  bestMonth: { avg: number; label: string };
  totalDrives: number;
  aOrBetter: number;
}

/**
 * Aggregate weekly / monthly averages, best week / month, and the A-or-better
 * count from the scored drives. `now` is injected (not read from the clock)
 * so the window boundaries are deterministic and unit-testable.
 *
 * Returns `null` when there are no scored drives so callers render an empty
 * state instead of a grid of zeros.
 */
export function computePeriodStats(
  scoredDrives: ScoredDrive[],
  now: Date,
): PeriodStats | null {
  if (scoredDrives.length === 0) return null;

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - now.getDay());
  const lastWeekStart = new Date(weekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

  const avg = (items: ScoredDrive[]): number | null =>
    items.length > 0
      ? Math.round(items.reduce((s, d) => s + d.score.total, 0) / items.length)
      : null;

  const thisWeekDrives = scoredDrives.filter(
    (sd) => new Date(sd.drive.startTs) >= weekStart,
  );
  const lastWeekDrives = scoredDrives.filter((sd) => {
    const d = new Date(sd.drive.startTs);
    return d >= lastWeekStart && d < weekStart;
  });
  const thisMonthDrives = scoredDrives.filter(
    (sd) => new Date(sd.drive.startTs) >= monthStart,
  );
  const lastMonthDrives = scoredDrives.filter((sd) => {
    const d = new Date(sd.drive.startTs);
    return d >= lastMonthStart && d <= lastMonthEnd;
  });

  const weekMap = new Map<string, ScoredDrive[]>();
  const monthMap = new Map<string, ScoredDrive[]>();
  scoredDrives.forEach((sd) => {
    const d = new Date(sd.drive.startTs);
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const weekOfMonth = Math.ceil(
      (d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7,
    );
    // Key the week bucket by year-MONTH-week. Keying by week-of-month alone
    // collapsed the same week number across different months (e.g. Jun-W3 and
    // Jul-W3) into one bucket, averaging unrelated drives together and
    // corrupting the "Best Week" aggregate + its label.
    const wk = `${d.getFullYear()}-${month}-W${weekOfMonth}`;
    const mo = `${d.getFullYear()}-${month}`;
    if (!weekMap.has(wk)) weekMap.set(wk, []);
    weekMap.get(wk)!.push(sd);
    if (!monthMap.has(mo)) monthMap.set(mo, []);
    monthMap.get(mo)!.push(sd);
  });

  let bestWeek = { avg: 0, label: '—' };
  weekMap.forEach((items, label) => {
    const a = avg(items);
    if (a != null && a > bestWeek.avg) bestWeek = { avg: a, label };
  });
  let bestMonth = { avg: 0, label: '—' };
  monthMap.forEach((items, label) => {
    const a = avg(items);
    if (a != null && a > bestMonth.avg) bestMonth = { avg: a, label };
  });

  const aOrBetter = scoredDrives.filter(
    (sd) => sd.score.grade === 'A+' || sd.score.grade === 'A',
  ).length;

  return {
    thisWeekAvg: avg(thisWeekDrives),
    lastWeekAvg: avg(lastWeekDrives),
    thisMonthAvg: avg(thisMonthDrives),
    lastMonthAvg: avg(lastMonthDrives),
    bestWeek,
    bestMonth,
    totalDrives: scoredDrives.length,
    aOrBetter,
  };
}

/* ------------------------------------------------------------------ */
/*  Internal presentational sub-components (not exported)              */
/* ------------------------------------------------------------------ */

/** One category gauge card (Efficiency / Smoothness / Speed) — DRY helper. */
function CategoryGaugeCard({
  title,
  value,
  max,
  color,
  icon,
  metricLabel,
  metricValue,
}: {
  title: string;
  value: number;
  max: number;
  color: string;
  icon: ReactNode;
  metricLabel: string;
  metricValue: string;
}) {
  return (
    <GlassPanel className="flex flex-col items-center p-4 sm:p-5">
      <PanelTitle className="mb-3 self-start">{title}</PanelTitle>
      <LinearGauge value={value} max={max} label={title} color={color} size={120} hideScale />
      <div className="mt-3 flex items-baseline gap-1">
        <Text as="span" size="2xl" weight="bold" color="primary" className="tabular-nums">
          <AnimatedNumber value={value} />
        </Text>
        <Caption>/{max}</Caption>
      </div>
      <div className="mt-3 w-full">
        <MetricBar label={title} value={value} max={max} color={color} />
      </div>
      <InlineMetric
        icon={icon}
        value={metricValue}
        label={metricLabel}
        className="mt-2 self-start"
      />
    </GlassPanel>
  );
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function DriveScorePage() {
  const { t } = useTranslation();
  usePageTitle(t('driveScore.title', 'Drive Score'));

  /* ---- vehicle selector: header VehiclePicker is the source of truth ---- */
  const { vehicleId } = useSelectedVehicle();
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* ---- queries ---- */
  const scoreQuery = useDriveScore(vehicleIdStr);
  const apiScore = scoreQuery.data;

  const drivesQuery = useDrives(vehicleIdStr);
  const {
    data: drives,
    isLoading: drivesLoading,
    isError: drivesIsError,
    error: drivesError,
    refetch,
  } = drivesQuery;

  /* ---- unit formatting (SI in, display-boundary out) ---- */
  const { unitPrefs, formatDistance, formatSpeed, formatPower } = useUnits();
  const efficiencyUnit = unitPrefs.distance === 'mi' ? 'Wh/mi' : 'Wh/km';
  const efficiencyDisplay = (whPerKm: number) =>
    unitPrefs.distance === 'mi' ? whPerKm * 1.609344 : whPerKm;
  const formatEfficiency = (whPerKm: number) =>
    `${fmtInt(efficiencyDisplay(whPerKm))} ${efficiencyUnit}`;

  /* ---- date filter ---- */
  const [startDate, setStartDate] = useState<string>(getDefaultStartDate);
  const [endDate, setEndDate] = useState<string>(getDefaultEndDate);

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
    () => filteredDrives.map((d) => ({ drive: d, score: scoreDrive(d) })),
    [filteredDrives],
  );

  const allScores = useMemo(
    () => scoredDrives.map((sd) => sd.score),
    [scoredDrives],
  );

  const hasDrives = scoredDrives.length > 0;
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
  const overallGrade = apiScore?.grade ?? gradeFromScore(overallScore);
  const overallTrend = apiScore?.trend ?? 'flat';

  const efficiencyValue = apiScore?.efficiency ?? avgScores.efficiency;
  const smoothnessValue = apiScore?.smoothness ?? avgScores.smoothness;
  const speedValue = apiScore?.speedDiscipline ?? avgScores.speed;

  /* ---- category metric readouts ---- */
  const avgWhPerKm = useMemo(
    () =>
      scoredDrives.length > 0
        ? scoredDrives.reduce((sum, sd) => sum + sd.score.whPerKm, 0) /
          scoredDrives.length
        : 0,
    [scoredDrives],
  );
  const avgPowerW = useMemo(
    () =>
      scoredDrives.length > 0
        ? scoredDrives.reduce(
            (sum, sd) => sum + (sd.drive.avgPowerW ?? 30000),
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
        value: efficiencyValue,
        max: 40,
        fill: CATEGORY_COLORS.efficiency,
      },
      {
        name: t('driveScore.smoothness', 'Smoothness'),
        value: smoothnessValue,
        max: 30,
        fill: CATEGORY_COLORS.smoothness,
      },
      {
        name: t('driveScore.speedDiscipline', 'Speed Discipline'),
        value: speedValue,
        max: 30,
        fill: CATEGORY_COLORS.speed,
      },
    ],
    [efficiencyValue, smoothnessValue, speedValue, t],
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
        durationS: drive.durationS ?? 0,
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

  const historyColumns = useMemo<Column<HistoryRow>[]>(
    () => [
      {
        key: 'date',
        header: t('driveScore.colDate', 'Date'),
        sortable: true,
        visibleOnMobile: true,
        render: (row) => (
          <Text variant="bodySm" className="whitespace-nowrap">
            {formatDateShort(row.ts)}
          </Text>
        ),
      },
      {
        key: 'route',
        header: t('driveScore.colRoute', 'Route'),
        render: (row) => (
          <Text variant="bodySm" className="block max-w-[16rem] truncate">
            {row.route}
          </Text>
        ),
      },
      {
        key: 'distance',
        header: t('driveScore.colDistance', 'Distance'),
        sortable: true,
        align: 'right',
        render: (row) => (
          <Text variant="body" className="tabular-nums">
            {formatDistance(row.distanceM)}
          </Text>
        ),
      },
      {
        key: 'duration',
        header: t('driveScore.colDuration', 'Duration'),
        align: 'right',
        render: (row) => (
          <Text variant="body" className="tabular-nums">
            {formatDurationMinutes(row.durationS / 60)}
          </Text>
        ),
      },
      {
        key: 'efficiency',
        header: t('driveScore.colConsumption', 'Consumption'),
        sortable: true,
        align: 'right',
        render: (row) => (
          <Text variant="body" className="tabular-nums">
            {formatEfficiency(row.whPerKm)}
          </Text>
        ),
      },
      {
        key: 'score',
        header: t('driveScore.colScore', 'Score'),
        sortable: true,
        align: 'right',
        visibleOnMobile: true,
        render: (row) => (
          <Text
            as="span"
            size="sm"
            weight="semibold"
            className={cn('tabular-nums', gradeTextClass(row.grade))}
          >
            {row.total}/100
          </Text>
        ),
      },
      {
        key: 'grade',
        header: t('driveScore.colGrade', 'Grade'),
        align: 'center',
        render: (row) => (
          <Badge variant={gradeVariant(row.grade)} size="sm">
            {row.grade}
          </Badge>
        ),
      },
      {
        key: 'breakdown',
        header: t('driveScore.colBreakdown', 'Eff / Smo / Spd'),
        align: 'right',
        render: (row) => (
          <Caption className="tabular-nums">
            {row.efficiency}/{row.smoothness}/{row.speed}
          </Caption>
        ),
      },
    ],
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

  /* ---- per-section state fallback (loading / error / empty) ---- */
  const buildState =
    (isEmpty: boolean) =>
    (height: number, emptyMsg: string, emptyIcon?: ReactNode): ReactNode | null => {
      if (drivesLoading) return <Skeleton height={height} />;
      if (drivesIsError)
        return (
          <QueryError
            error={drivesError}
            onRetry={() => refetch()}
            resourceName={t('driveScore.resource', 'drive')}
          />
        );
      if (isEmpty)
        return (
          <EmptyState
            /* no-action: transient empty state — surfaces when no scored drives
               exist in the selected period; recovery is picking a wider range. */
            icon={emptyIcon}
            message={emptyMsg}
          />
        );
      return null;
    };
  const driveState = buildState(!hasDrives);
  const scoreState = buildState(!hasData);

  const noDrivesMsg = t(
    'driveScore.empty',
    'Not enough drives in the selected period to calculate a score.',
  );

  /* ---- header actions ---- */
  const actions = (
    <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
      <VehicleSelect />
      <RangePicker
        value={{ start: startDate, end: endDate }}
        onChange={(r) => {
          setStartDate(r.start);
          setEndDate(r.end);
        }}
        align="end"
        triggerTestId="drive-score-range"
      />
      <Button
        variant="ghost"
        onClick={() => refetch()}
        aria-label={t('common.refresh', 'Refresh')}
      >
        <Icons.refresh className="h-4 w-4" aria-hidden="true" />
      </Button>
    </div>
  );

  /* ================================================================ */
  /*  Render                                                          */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('driveScore.title', 'Drive Score')}
      subtitle={t('driveScore.subtitle', 'Your driving rating and breakdown')}
      actions={actions}
      query={[drivesQuery, scoreQuery]}
    >
      {/* ── Band A — KPI summary ─────────────────────────────────── */}
      <FadeIn>
        <section aria-label={t('driveScore.kpis', 'Key metrics')}>
          {drivesIsError ? (
            <GlassPanel className="p-4 sm:p-5">
              <QueryError
                error={drivesError}
                onRetry={() => refetch()}
                resourceName={t('driveScore.resource', 'drive')}
              />
            </GlassPanel>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <StatCard
                loading={drivesLoading}
                label={t('driveScore.avgScore', 'Avg Score')}
                value={avgScores.total}
                unit="/100"
                icon={<Icons.target className="h-5 w-5" aria-hidden="true" />}
                trend={{
                  direction: overallTrend,
                  value: trendLabel,
                  positive: overallTrend === 'up',
                }}
              />
              <StatCard
                loading={drivesLoading}
                label={t('driveScore.bestScore', 'Best Score')}
                value={allScores.length > 0 ? Math.max(...allScores.map((s) => s.total)) : 0}
                unit="/100"
                icon={<Icons.trophy className="h-5 w-5 text-amber-300" aria-hidden="true" />}
              />
              <StatCard
                loading={drivesLoading}
                label={t('driveScore.totalDrivesLabel', 'Total Drives')}
                value={scoredDrives.length}
                icon={<Icons.drive className="h-5 w-5" aria-hidden="true" />}
              />
              <StatCard
                loading={drivesLoading}
                label={t('driveScore.avgEffLabel', 'Avg Efficiency')}
                value={fmtNumber(efficiencyDisplay(avgWhPerKm))}
                unit={efficiencyUnit}
                icon={<Icons.charging className="h-5 w-5 text-emerald-300" aria-hidden="true" />}
              />
            </div>
          )}
        </section>
      </FadeIn>

      {/* ── Band B — Hero: overall score + grade ─────────────────── */}
      <FadeIn delay={0.05}>
        <section
          aria-label={t('driveScore.overall', 'Overall Score')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel className="flex flex-col p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3">{t('driveScore.overall', 'Overall Score')}</PanelTitle>
            {scoreState(240, noDrivesMsg, <Icons.speed className="h-8 w-8" aria-hidden="true" />) ?? (
              <div className="flex flex-1 flex-col items-center justify-center py-4">
                <LinearGauge
                  value={overallScore}
                  max={100}
                  label={t('driveScore.overall', 'Overall Score')}
                  color={gradeColor(overallGrade)}
                  size={200}
                />
                <div className="mt-4 flex items-baseline justify-center gap-1">
                  <Text as="span" size="3xl" weight="bold" color="primary" className="tabular-nums">
                    <AnimatedNumber value={overallScore} />
                  </Text>
                  <Text variant="body" className={typography.color.secondary}>
                    /100
                  </Text>
                  <HelpTooltip
                    className="ml-1.5"
                    size="sm"
                    i18nKey="help.driveScore.body"
                    defaultValue="0–100 score derived from smoothness of acceleration, braking, and cornering combined with energy efficiency. Tunable in Settings → Driving."
                    ariaLabel={t('help.driveScore.iconLabel', {
                      defaultValue: 'More info about Drive Score',
                    })}
                  />
                </div>
                <div className={cn('mt-2 flex items-center gap-2', trendColor)}>
                  <TrendIcon className="h-4 w-4" aria-hidden="true" />
                  <Text variant="body" className={typography.weight.medium}>
                    {trendLabel}
                  </Text>
                </div>
                {apiScore && (
                  <Caption className="mt-1">
                    {t('driveScore.basedOn', 'Based on {{count}} drives', {
                      count: apiScore.totalDrives ?? 0,
                    })}
                  </Caption>
                )}
              </div>
            )}
          </GlassPanel>

          <GlassPanel className="flex flex-col p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3">{t('driveScore.gradeTitle', 'Grade')}</PanelTitle>
            {scoreState(240, noDrivesMsg, <Icons.award className="h-8 w-8" aria-hidden="true" />) ?? (
              <div className="flex flex-1 flex-col justify-center gap-4">
                <div className="flex items-center gap-4">
                  <Badge variant={gradeVariant(overallGrade)} size="lg">
                    {overallGrade}
                  </Badge>
                  <div>
                    <Text as="div" variant="body" className={typography.weight.semibold}>
                      {t('driveScore.gradeLabel', 'Grade: {{grade}}', {
                        grade: overallGrade,
                      })}
                    </Text>
                    <div className={cn('flex items-center gap-1', trendColor)}>
                      <TrendIcon className="h-3 w-3" aria-hidden="true" />
                      <Caption className={trendColor}>{trendLabel}</Caption>
                    </div>
                  </div>
                </div>
                <Caption>
                  {t('driveScore.drivesInPeriod', '{{count}} drives in period', {
                    count: scoredDrives.length,
                  })}
                </Caption>
              </div>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Band C — Category gauges ─────────────────────────────── */}
      <FadeIn delay={0.1}>
        <section
          aria-label={t('driveScore.categoryBreakdown', 'Category Breakdown')}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {scoreState(
            260,
            noDrivesMsg,
            <Icons.efficiency className="h-8 w-8" aria-hidden="true" />,
          ) ? (
            <GlassPanel className="p-4 sm:p-5 sm:col-span-2 lg:col-span-3">
              {scoreState(
                260,
                noDrivesMsg,
                <Icons.efficiency className="h-8 w-8" aria-hidden="true" />,
              )}
            </GlassPanel>
          ) : (
            <>
              <CategoryGaugeCard
                title={t('driveScore.efficiency', 'Efficiency')}
                value={efficiencyValue}
                max={40}
                color={CATEGORY_COLORS.efficiency}
                icon={<Icons.charging className="h-4 w-4 text-emerald-300" aria-hidden="true" />}
                metricLabel={t('driveScore.avgConsumption', 'Avg consumption')}
                metricValue={formatEfficiency(avgWhPerKm)}
              />
              <CategoryGaugeCard
                title={t('driveScore.smoothness', 'Smoothness')}
                value={smoothnessValue}
                max={30}
                color={CATEGORY_COLORS.smoothness}
                icon={<Icons.efficiency className="h-4 w-4 text-cyan-300" aria-hidden="true" />}
                metricLabel={t('driveScore.powerRange', 'Power range')}
                metricValue={formatPower(avgPowerW)}
              />
              <CategoryGaugeCard
                title={t('driveScore.speedDiscipline', 'Speed Discipline')}
                value={speedValue}
                max={30}
                color={CATEGORY_COLORS.speed}
                icon={<Icons.speed className="h-4 w-4 text-purple-300" aria-hidden="true" />}
                metricLabel={t('driveScore.avgMaxSpeed', 'Avg max speed')}
                metricValue={formatSpeed(avgMaxSpeedMps)}
              />
            </>
          )}
        </section>
      </FadeIn>

      {/* ── Band D — Trend (hero) + Category bar (side) ──────────── */}
      <FadeIn delay={0.15}>
        <section
          aria-label={t('driveScore.scoreTrend', 'Score Trend')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3">{t('driveScore.scoreTrend', 'Score Trend')}</PanelTitle>
            {driveState(
              300,
              t('driveScore.noTrend', 'No scored drives to chart yet'),
              <Icons.trendUp className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <ChartContainer
                title={t('driveScore.scoreTrend', 'Score Trend')}
                ariaLabel={t(
                  'driveScore.scoreTrend.aria',
                  'Drive score trend line chart with category breakdowns',
                )}
                data={trendChartData}
                dataColumns={[
                  { key: 'date', label: t('driveScore.col.date', 'Date') },
                  { key: 'score', label: t('driveScore.col.score', 'Score') },
                  { key: 'efficiency', label: t('driveScore.col.efficiency', 'Efficiency') },
                  { key: 'smoothness', label: t('driveScore.col.smoothness', 'Smoothness') },
                  { key: 'speed', label: t('driveScore.col.speed', 'Speed') },
                ]}
                height={300}
                annotations={{
                  vehicleId,
                  scope: 'efficiency',
                  chartId: 'drive-score-trend',
                }}
              >
                {({ annotations: chartAnnotations }) => (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                      <XAxis dataKey="date" stroke={chartTokens.axisStroke} fontSize={12} />
                      <YAxis domain={[0, 100]} stroke={chartTokens.axisStroke} fontSize={12} />
                      <Tooltip content={<ChartTooltip />} />
                      <Legend />
                      <ReferenceLine
                        y={80}
                        stroke={COLOR.GOOD}
                        strokeDasharray="4 4"
                        label={{
                          value: t('driveScore.gradeALine', 'A'),
                          fill: COLOR.GOOD,
                          fontSize: 11,
                        }}
                      />
                      {renderAnnotationLines(chartAnnotations, (ts) => ts)}
                      <Line
                        {...AREA_DEFAULTS}
                        dataKey="score"
                        name={t('driveScore.totalScore', 'Total Score')}
                        stroke={gradeColor(overallGrade)}
                        dot={{ r: 3, fill: gradeColor(overallGrade) }}
                        activeDot={{ r: 5 }}
                      />
                      <Line
                        {...AREA_DEFAULTS}
                        dataKey="efficiency"
                        name={t('driveScore.efficiency', 'Efficiency')}
                        stroke={CATEGORY_COLORS.efficiency}
                        strokeWidth={1}
                        strokeDasharray="4 2"
                      />
                      <Line
                        {...AREA_DEFAULTS}
                        dataKey="smoothness"
                        name={t('driveScore.smoothness', 'Smoothness')}
                        stroke={CATEGORY_COLORS.smoothness}
                        strokeWidth={1}
                        strokeDasharray="4 2"
                      />
                      <Line
                        {...AREA_DEFAULTS}
                        dataKey="speed"
                        name={t('driveScore.speedDiscipline', 'Speed Discipline')}
                        stroke={CATEGORY_COLORS.speed}
                        strokeWidth={1}
                        strokeDasharray="4 2"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </ChartContainer>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-3">
              {t('driveScore.categoryBreakdown', 'Category Breakdown')}
            </PanelTitle>
            {scoreState(
              260,
              noDrivesMsg,
              <Icons.efficiency className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <ChartContainer
                title={t('driveScore.categoryBreakdown', 'Category Breakdown')}
                ariaLabel={t(
                  'driveScore.categoryBreakdown.aria',
                  'Drive score category breakdown horizontal bar chart',
                )}
                data={categoryBarData.map((c) => ({ name: c.name, value: c.value, max: c.max }))}
                dataColumns={[
                  { key: 'name', label: t('driveScore.col.category', 'Category') },
                  { key: 'value', label: t('driveScore.col.value', 'Value') },
                  { key: 'max', label: t('driveScore.col.max', 'Max') },
                ]}
                height={260}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={chartTokens.gridStroke} />
                    <XAxis type="number" domain={[0, 40]} stroke={chartTokens.axisStroke} fontSize={12} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={110}
                      stroke={chartTokens.axisStroke}
                      fontSize={12}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={24}>
                      {categoryBarData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                    <Bar
                      dataKey="max"
                      radius={[0, 6, 6, 0]}
                      barSize={24}
                      fill="#1e293b"
                      opacity={0.3}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Band E — Histogram (hero) + Tips (side) ──────────────── */}
      <FadeIn delay={0.2}>
        <section
          aria-label={t('driveScore.scoreDistribution', 'Score Distribution')}
          className="grid grid-cols-1 gap-4 xl:grid-cols-3"
        >
          <GlassPanel className="p-4 sm:p-5 xl:col-span-2">
            <PanelTitle className="mb-3">
              {t('driveScore.scoreDistribution', 'Score Distribution')}
            </PanelTitle>
            {driveState(
              220,
              t('driveScore.noDistribution', 'No scored drives to chart yet'),
              <Icons.target className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <ChartContainer
                title={t('driveScore.scoreDistribution', 'Score Distribution')}
                ariaLabel={t(
                  'driveScore.scoreDistribution.aria',
                  'Drive score distribution histogram bar chart',
                )}
                data={histogramData.map((h) => ({ range: h.range, count: h.count }))}
                dataColumns={[
                  { key: 'range', label: t('driveScore.col.range', 'Score range') },
                  { key: 'count', label: t('driveScore.col.drives', 'Drives') },
                ]}
                height={240}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogramData} barCategoryGap="20%">
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke={chartTokens.gridStroke}
                      vertical={false}
                    />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: chartTokens.axisStroke }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: chartTokens.axisStroke }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar
                      dataKey="count"
                      name={t('driveScore.drives', 'Drives')}
                      radius={[6, 6, 0, 0]}
                    >
                      {histogramData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            )}
          </GlassPanel>

          <GlassPanel className="p-4 sm:p-5 xl:col-span-1">
            <PanelTitle className="mb-1">{t('driveScore.tipsTitle', 'Improvement Tips')}</PanelTitle>
            <Caption className="mb-3 block">
              {t('driveScore.tipsSubtitle', 'Based on your weakest category: {{category}}', {
                category: weakestCategoryLabel,
              })}
            </Caption>
            {scoreState(
              220,
              t('driveScore.noTips', 'Tips appear once drives are scored'),
              <Icons.lightbulb className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <ul className="space-y-3">
                {relevantTips.map((tip, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-3 rounded-lg bg-[var(--surface-2)] p-3"
                  >
                    <Icons.lightbulb
                      className="mt-0.5 h-5 w-5 shrink-0 text-amber-300"
                      aria-hidden="true"
                    />
                    <Text variant="body">{tip.key}</Text>
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Band F — Best / Worst drives + detail lists ──────────── */}
      <FadeIn delay={0.25}>
        <section
          aria-label={t('driveScore.bestWorst', 'Best and worst drives')}
          className="grid grid-cols-1 gap-4 md:grid-cols-2 3xl:grid-cols-4"
        >
          {/* Best drive */}
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Icons.star className="h-5 w-5 text-emerald-300" aria-hidden="true" />
              <PanelTitle>{t('driveScore.bestDrive', 'Best Drive')}</PanelTitle>
            </div>
            {driveState(
              200,
              t('driveScore.noDrives', 'No drives available'),
              <Icons.star className="h-8 w-8" aria-hidden="true" />,
            ) ??
              (bestDrive ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Caption>{formatDateShort(bestDrive.drive.startTs)}</Caption>
                    <Badge variant={gradeVariant(bestDrive.score.grade)} size="sm">
                      {bestDrive.score.grade}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <LinearGauge
                      value={bestDrive.score.total}
                      max={100}
                      label={t('driveScore.score', 'Score')}
                      color="#4ade80"
                      size={72}
                      className="w-28 shrink-0"
                    />
                    <dl className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <Caption>{t('driveScore.distance', 'Distance')}</Caption>
                        <Text variant="bodySm" className="tabular-nums">
                          {formatDistance(bestDrive.drive.distanceM)}
                        </Text>
                      </div>
                      <div className="flex items-center justify-between">
                        <Caption>{t('driveScore.durationLabel', 'Duration')}</Caption>
                        <Text variant="bodySm" className="tabular-nums">
                          {formatDurationMinutes((bestDrive.drive.durationS ?? 0) / 60)}
                        </Text>
                      </div>
                      <div className="flex items-center justify-between">
                        <Caption>{t('driveScore.consumption', 'Consumption')}</Caption>
                        <Text variant="bodySm" className="tabular-nums">
                          {formatEfficiency(bestDrive.score.whPerKm)}
                        </Text>
                      </div>
                    </dl>
                  </div>
                  <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                    <Text variant="bodySm" className="text-emerald-300">
                      <Icons.star className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      {bestDrive.score.efficiency >= 35
                        ? t('driveScore.tipBestEff', 'Outstanding energy efficiency — minimal energy wasted!')
                        : bestDrive.score.smoothness >= 25
                          ? t('driveScore.tipBestSmooth', 'Exceptionally smooth driving with controlled acceleration.')
                          : t('driveScore.tipBestSpeed', 'Great speed discipline, staying in the optimal range.')}
                    </Text>
                  </div>
                </div>
              ) : (
                <Caption>{t('driveScore.noDrives', 'No drives available')}</Caption>
              ))}
          </GlassPanel>

          {/* Worst drive */}
          <GlassPanel className="p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Icons.severityWarn className="h-5 w-5 text-rose-300" aria-hidden="true" />
              <PanelTitle>{t('driveScore.worstDrive', 'Worst Drive')}</PanelTitle>
            </div>
            {driveState(
              200,
              t('driveScore.noDrives', 'No drives available'),
              <Icons.severityWarn className="h-8 w-8" aria-hidden="true" />,
            ) ??
              (worstDrive ? (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Caption>{formatDateShort(worstDrive.drive.startTs)}</Caption>
                    <Badge variant={gradeVariant(worstDrive.score.grade)} size="sm">
                      {worstDrive.score.grade}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-4">
                    <LinearGauge
                      value={worstDrive.score.total}
                      max={100}
                      label={t('driveScore.score', 'Score')}
                      color="#f87171"
                      size={72}
                      className="w-28 shrink-0"
                    />
                    <dl className="flex-1 space-y-2">
                      <div className="flex items-center justify-between">
                        <Caption>{t('driveScore.distance', 'Distance')}</Caption>
                        <Text variant="bodySm" className="tabular-nums">
                          {formatDistance(worstDrive.drive.distanceM)}
                        </Text>
                      </div>
                      <div className="flex items-center justify-between">
                        <Caption>{t('driveScore.durationLabel', 'Duration')}</Caption>
                        <Text variant="bodySm" className="tabular-nums">
                          {formatDurationMinutes((worstDrive.drive.durationS ?? 0) / 60)}
                        </Text>
                      </div>
                      <div className="flex items-center justify-between">
                        <Caption>{t('driveScore.consumption', 'Consumption')}</Caption>
                        <Text variant="bodySm" className="tabular-nums">
                          {formatEfficiency(worstDrive.score.whPerKm)}
                        </Text>
                      </div>
                    </dl>
                  </div>
                  <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3">
                    <Text variant="bodySm" className="text-rose-300">
                      <Icons.severityWarn className="mr-1 inline h-3 w-3" aria-hidden="true" />
                      {worstDrive.score.efficiency < 15
                        ? t('driveScore.tipWorstEff', 'High energy consumption — possibly high speeds or cold weather.')
                        : worstDrive.score.smoothness < 10
                          ? t('driveScore.tipWorstSmooth', 'Aggressive acceleration and braking detected.')
                          : t('driveScore.tipWorstSpeed', 'Excessive highway speed reduced the overall score.')}
                    </Text>
                  </div>
                </div>
              ) : (
                <Caption>{t('driveScore.noDrives', 'No drives available')}</Caption>
              ))}
          </GlassPanel>

          {/* Score breakdown */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('driveScore.breakdown', 'Score Breakdown')}</PanelTitle>
            {scoreState(
              200,
              noDrivesMsg,
              <Icons.target className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <KVList
                items={[
                  {
                    label: t('driveScore.efficiencyLabel', 'Efficiency (Wh/km)'),
                    value: `${efficiencyValue}/40`,
                  },
                  {
                    label: t('driveScore.smoothnessLabel', 'Smoothness (power range)'),
                    value: `${smoothnessValue}/30`,
                  },
                  {
                    label: t('driveScore.speedLabel', 'Speed Discipline'),
                    value: `${speedValue}/30`,
                  },
                  {
                    label: t('driveScore.totalLabel', 'Total'),
                    value: `${overallScore}/100`,
                  },
                ]}
              />
            )}
          </GlassPanel>

          {/* Period statistics */}
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('driveScore.periodStats', 'Period Statistics')}</PanelTitle>
            {driveState(
              200,
              noDrivesMsg,
              <Icons.drive className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <KVList
                items={[
                  {
                    label: t('driveScore.totalDistance', 'Total Distance'),
                    value: formatDistance(
                      filteredDrives.reduce((sum, d) => sum + (d.distanceM ?? 0), 0),
                    ),
                  },
                  {
                    label: t('driveScore.totalDuration', 'Total Duration'),
                    value: formatDurationMinutes(
                      filteredDrives.reduce((sum, d) => sum + (d.durationS ?? 0), 0) / 60,
                    ),
                  },
                  {
                    label: t('driveScore.avgDistance', 'Avg Distance/Drive'),
                    value: formatDistance(
                      filteredDrives.length > 0
                        ? filteredDrives.reduce((sum, d) => sum + (d.distanceM ?? 0), 0) /
                            filteredDrives.length
                        : 0,
                    ),
                  },
                  {
                    label: t('driveScore.avgDuration', 'Avg Duration/Drive'),
                    value: formatDurationMinutes(
                      filteredDrives.length > 0
                        ? filteredDrives.reduce((sum, d) => sum + (d.durationS ?? 0), 0) /
                            filteredDrives.length /
                            60
                        : 0,
                    ),
                  },
                  {
                    label: t('driveScore.highestSpeed', 'Highest Max Speed'),
                    value: formatSpeed(
                      filteredDrives.length > 0
                        ? Math.max(...filteredDrives.map((d) => d.maxSpeedMps ?? 0))
                        : 0,
                    ),
                  },
                  {
                    label: t('driveScore.aPlusCount', 'A+ Drives'),
                    value: fmtInt(allScores.filter((s) => s.grade === 'A+').length),
                  },
                ]}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Band G — Drive history table (full-width) ────────────── */}
      <FadeIn delay={0.3}>
        <section aria-label={t('driveScore.driveHistory', 'Drive History')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('driveScore.driveHistory', 'Drive History')}</PanelTitle>
            {driveState(
              320,
              t('driveScore.noDrives', 'No drives found for the selected period.'),
              <Icons.drive className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <DataTable
                tableId="driving:drive-score-history"
                columns={historyColumns}
                data={sortedHistory}
                keyExtractor={(row) => row.id}
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={onSort}
                mobileColumns={['date', 'score', 'grade']}
                exportable
                exportFilename="drive-score-history"
                exportRow={(row) => ({
                  drive_id: row.id,
                  occurred_at: row.ts,
                  route: row.route,
                  distance_m: row.distanceM,
                  duration_s: row.durationS,
                  wh_per_km: row.whPerKm,
                  score: row.total,
                  grade: row.grade,
                  efficiency: row.efficiency,
                  smoothness: row.smoothness,
                  speed: row.speed,
                })}
                emptyMessage={t('driveScore.noDrives', 'No drives found for the selected period.')}
                pagination={{ defaultPageSize: DRIVES_PER_PAGE }}
              />
            )}
          </GlassPanel>
        </section>
      </FadeIn>

      {/* ── Band H — Weekly / monthly averages ───────────────────── */}
      <FadeIn delay={0.35}>
        <section
          aria-label={t('driveScore.periodAverages', 'Period averages')}
          className="grid grid-cols-2 gap-3 sm:gap-4 sm:grid-cols-3 lg:grid-cols-6"
        >
          {driveState(
            120,
            t('driveScore.noPeriodStats', 'No weekly/monthly averages available yet'),
            <Icons.target className="h-8 w-8" aria-hidden="true" />,
          ) ? (
            <GlassPanel className="col-span-2 p-4 sm:p-5 sm:col-span-3 lg:col-span-6">
              {driveState(
                120,
                t('driveScore.noPeriodStats', 'No weekly/monthly averages available yet'),
                <Icons.target className="h-8 w-8" aria-hidden="true" />,
              )}
            </GlassPanel>
          ) : periodStats ? (
            <>
              <GlassPanel className="flex flex-col gap-2 p-4 sm:p-5">
                <Label>{t('driveScore.thisWeek', 'This Week')}</Label>
                <div className="flex items-end gap-2">
                  <Text
                    as="span"
                    size="2xl"
                    weight="bold"
                    className={cn('tabular-nums', scoreTextClass(periodStats.thisWeekAvg))}
                  >
                    {periodStats.thisWeekAvg ?? '—'}
                  </Text>
                  {periodStats.thisWeekAvg != null && periodStats.lastWeekAvg != null && (
                    <span
                      className={cn(
                        'flex items-center',
                        typography.size.xs,
                        periodStats.thisWeekAvg >= periodStats.lastWeekAvg
                          ? 'text-emerald-300'
                          : 'text-rose-300',
                      )}
                    >
                      {periodStats.thisWeekAvg >= periodStats.lastWeekAvg ? (
                        <Icons.drillThrough className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Icons.drillDown className="h-3 w-3" aria-hidden="true" />
                      )}
                      {Math.abs(periodStats.thisWeekAvg - periodStats.lastWeekAvg)}
                    </span>
                  )}
                </div>
                <Caption>
                  {t('driveScore.vsLastWeek', 'vs {{val}} last week', {
                    val: periodStats.lastWeekAvg ?? '—',
                  })}
                </Caption>
              </GlassPanel>

              <GlassPanel className="flex flex-col gap-2 p-4 sm:p-5">
                <Label>{t('driveScore.thisMonth', 'This Month')}</Label>
                <div className="flex items-end gap-2">
                  <Text
                    as="span"
                    size="2xl"
                    weight="bold"
                    className={cn('tabular-nums', scoreTextClass(periodStats.thisMonthAvg))}
                  >
                    {periodStats.thisMonthAvg ?? '—'}
                  </Text>
                  {periodStats.thisMonthAvg != null && periodStats.lastMonthAvg != null && (
                    <span
                      className={cn(
                        'flex items-center',
                        typography.size.xs,
                        periodStats.thisMonthAvg >= periodStats.lastMonthAvg
                          ? 'text-emerald-300'
                          : 'text-rose-300',
                      )}
                    >
                      {periodStats.thisMonthAvg >= periodStats.lastMonthAvg ? (
                        <Icons.drillThrough className="h-3 w-3" aria-hidden="true" />
                      ) : (
                        <Icons.drillDown className="h-3 w-3" aria-hidden="true" />
                      )}
                      {Math.abs(periodStats.thisMonthAvg - periodStats.lastMonthAvg)}
                    </span>
                  )}
                </div>
                <Caption>
                  {t('driveScore.vsLastMonth', 'vs {{val}} last month', {
                    val: periodStats.lastMonthAvg ?? '—',
                  })}
                </Caption>
              </GlassPanel>

              <GlassPanel className="flex flex-col gap-2 p-4 sm:p-5">
                <Label>{t('driveScore.bestWeek', 'Best Week')}</Label>
                <Text
                  as="span"
                  size="2xl"
                  weight="bold"
                  className={cn('tabular-nums', scoreTextClass(periodStats.bestWeek.avg))}
                >
                  {periodStats.bestWeek.avg || '—'}
                </Text>
                <Caption>{periodStats.bestWeek.label}</Caption>
              </GlassPanel>

              <GlassPanel className="flex flex-col gap-2 p-4 sm:p-5">
                <Label>{t('driveScore.bestMonth', 'Best Month')}</Label>
                <Text
                  as="span"
                  size="2xl"
                  weight="bold"
                  className={cn('tabular-nums', scoreTextClass(periodStats.bestMonth.avg))}
                >
                  {periodStats.bestMonth.avg || '—'}
                </Text>
                <Caption>{periodStats.bestMonth.label}</Caption>
              </GlassPanel>

              <GlassPanel className="flex flex-col gap-2 p-4 sm:p-5">
                <Label>{t('driveScore.totalDrivesLabel', 'Total Drives')}</Label>
                <Text as="span" size="2xl" weight="bold" color="primary" className="tabular-nums">
                  {periodStats.totalDrives}
                </Text>
                <Caption>{t('driveScore.drivesScored', 'drives scored')}</Caption>
              </GlassPanel>

              <GlassPanel className="flex flex-col gap-2 p-4 sm:p-5">
                <Label>{t('driveScore.ratedAPlus', 'Rated A+/A')}</Label>
                <Text as="span" size="2xl" weight="bold" className="tabular-nums text-emerald-300">
                  {periodStats.aOrBetter}
                </Text>
                <Caption>
                  {periodStats.totalDrives > 0
                    ? `${fmtInt((periodStats.aOrBetter / periodStats.totalDrives) * 100)}% ${t('driveScore.ofDrives', 'of drives')}`
                    : t('driveScore.noDrives', 'no drives')}
                </Caption>
              </GlassPanel>
            </>
          ) : (
            <GlassPanel className="col-span-2 p-4 sm:p-5 sm:col-span-3 lg:col-span-6">
              <EmptyState
                /* no-action: transient — no period aggregates until drives exist */
                message={t('driveScore.noPeriodStats', 'No weekly/monthly averages available yet')}
              />
            </GlassPanel>
          )}
        </section>
      </FadeIn>

      {/* ── Band I — Achievements ────────────────────────────────── */}
      <FadeIn delay={0.4}>
        <section aria-label={t('driveScore.achievements.title', 'Achievements')}>
          <GlassPanel className="p-4 sm:p-5">
            <PanelTitle className="mb-3">{t('driveScore.achievements.title', 'Achievements')}</PanelTitle>
            {driveState(
              200,
              t('driveScore.noAchievements', 'Achievements unlock as you complete scored drives'),
              <Icons.trophy className="h-8 w-8" aria-hidden="true" />,
            ) ?? (
              <ul className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(11rem,1fr))]">
                {unlockedAchievements.map((ach) => (
                  <li
                    key={ach.id}
                    className={cn(
                      'flex flex-col items-center rounded-xl border p-4 text-center transition-all',
                      ach.unlocked
                        ? 'border-amber-500/30 bg-amber-500/10'
                        : 'border-[var(--border-subtle)] bg-white/[0.02] opacity-40',
                    )}
                  >
                    <div
                      className={cn(
                        'mb-2 flex h-10 w-10 items-center justify-center rounded-full',
                        ach.unlocked
                          ? 'bg-amber-500/20 text-amber-300'
                          : cn('bg-[var(--surface-2)]', typography.color.muted),
                      )}
                    >
                      {ach.icon}
                    </div>
                    <Text
                      as="span"
                      variant="body"
                      className={cn(
                        typography.weight.semibold,
                        ach.unlocked ? typography.color.primary : typography.color.muted,
                      )}
                    >
                      {ach.label}
                    </Text>
                    <Caption className="mt-1">{ach.description}</Caption>
                    {ach.unlocked && (
                      <Badge variant="success" size="sm" className="mt-2">
                        {t('driveScore.achievements.unlocked', 'Unlocked')}
                      </Badge>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </GlassPanel>
        </section>
      </FadeIn>
    </PageContainer>
  );
}
