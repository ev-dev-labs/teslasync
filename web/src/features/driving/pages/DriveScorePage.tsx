import { useState, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Lightbulb,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Award,
  Zap,
  Gauge,
  ShieldCheck,
  Star,
  Target,
  Route,
  Activity,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  ArrowUpRight,
  ArrowDownRight,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Button, Select, Card, CardHeader, Pagination } from '@/components/ui';
import {
  ChartContainer,
  ChartTooltip,
  RadialGauge,
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
} from '@/components/charts';
import { AnimatedNumber, StatCard, MetricBar, InlineMetric, KVList } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { DateRangeFilter } from '@/components/forms';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { useDriveScore, useDrives } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt, fmtWithUnit } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface DriveScore {
  total: number;
  efficiency: number;
  smoothness: number;
  speed: number;
  grade: string;
  whPerKm: number;
}

interface Drive {
  id: number;
  vehicleId: number;
  startDate: string;
  endDate: string | null;
  distance: number;
  durationMin: number;
  speedMax: number | null;
  speedAvg: number | null;
  startBatteryLevel: number | null;
  endBatteryLevel: number | null;
  startAddress: string | null;
  endAddress: string | null;
  outsideTempAvg: number | null;
  powerMax: number | null;
  powerMin: number | null;
  startOdometer: number | null;
  endOdometer: number | null;
}

type SortField = 'date' | 'distance' | 'score' | 'efficiency';
type SortDir = 'asc' | 'desc';

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const GRADE_COLORS: Record<string, string> = {
  'A+': '#39ff14',
  A: '#4ade80',
  B: '#22d3ee',
  C: '#fbbf24',
  D: '#fb923c',
  F: '#f87171',
};

const CATEGORY_COLORS = {
  efficiency: '#4ade80',
  smoothness: '#22d3ee',
  speed: '#a78bfa',
};

const DRIVES_PER_PAGE = 10;

/* ------------------------------------------------------------------ */
/*  Scoring algorithm                                                  */
/* ------------------------------------------------------------------ */

function scoreDrive(drive: Drive): DriveScore {
  const battUsed = (drive.startBatteryLevel ?? 50) - (drive.endBatteryLevel ?? 45);
  const energyKwh = (battUsed / 100) * 75;
  const whPerKm =
    drive.distance > 0 ? (energyKwh * 1000) / drive.distance : 200;

  const effScore = Math.max(0, Math.min(40, 40 - (whPerKm - 130) / 3));
  const powerRange = (drive.powerMax ?? 50) - (drive.powerMin ?? -20);
  const smoothScore = Math.max(0, Math.min(30, 30 - powerRange / 5));
  const maxSpeed = drive.speedMax ?? 80;
  const speedScore = Math.max(
    0,
    Math.min(30, 30 - Math.max(0, maxSpeed - 90) / 2),
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

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function gradeVariant(
  grade: string,
): 'success' | 'info' | 'warning' | 'danger' {
  if (grade === 'A+' || grade === 'A') return 'success';
  if (grade === 'B') return 'info';
  if (grade === 'C') return 'warning';
  return 'danger';
}

function gradeColor(grade: string): string {
  return GRADE_COLORS[grade] ?? '#94a3b8';
}

const GRADE_TEXT_CLASS: Record<string, string> = {
  'A+': 'text-[#39ff14]',
  A: 'text-green-400',
  B: 'text-cyan-400',
  C: 'text-amber-400',
  D: 'text-orange-400',
  F: 'text-red-400',
};

function gradeTextClass(grade: string): string {
  return GRADE_TEXT_CLASS[grade] ?? 'text-gray-400';
}

function scoreTextClass(score: number | null): string {
  if (score == null) return 'text-[var(--text-muted)]';
  if (score >= 80) return 'text-green-400';
  if (score >= 60) return 'text-amber-400';
  return 'text-red-400';
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function getDefaultStartDate(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString().slice(0, 10);
}

function getDefaultEndDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/* ------------------------------------------------------------------ */
/*  Tips data                                                          */
/* ------------------------------------------------------------------ */

interface Tip {
  key: string;
  category: 'efficiency' | 'smoothness' | 'speed';
  icon: React.ReactNode;
}

function buildTips(
  t: (key: string, fallback: string) => string,
): Tip[] {
  return [
    {
      key: t(
        'driveScore.tips.preCondition',
        'Pre-condition your cabin while plugged in to reduce HVAC battery drain.',
      ),
      category: 'efficiency',
      icon: <Zap className="h-4 w-4 text-green-400" />,
    },
    {
      key: t(
        'driveScore.tips.coastMore',
        'Coast more by lifting your foot earlier before stops.',
      ),
      category: 'efficiency',
      icon: <Zap className="h-4 w-4 text-green-400" />,
    },
    {
      key: t(
        'driveScore.tips.tirePressure',
        'Keep tire pressure at recommended levels for better efficiency.',
      ),
      category: 'efficiency',
      icon: <Zap className="h-4 w-4 text-green-400" />,
    },
    {
      key: t(
        'driveScore.tips.smoothAccel',
        'Accelerate gradually — aim for steady pedal pressure.',
      ),
      category: 'smoothness',
      icon: <Activity className="h-4 w-4 text-cyan-400" />,
    },
    {
      key: t(
        'driveScore.tips.regenBraking',
        'Use regenerative braking instead of the brake pedal when possible.',
      ),
      category: 'smoothness',
      icon: <Activity className="h-4 w-4 text-cyan-400" />,
    },
    {
      key: t(
        'driveScore.tips.followDistance',
        'Maintain a larger following distance to avoid sudden braking.',
      ),
      category: 'smoothness',
      icon: <Activity className="h-4 w-4 text-cyan-400" />,
    },
    {
      key: t(
        'driveScore.tips.speedLimit',
        'Stay within the speed limit — aerodynamic drag rises exponentially above 90 km/h.',
      ),
      category: 'speed',
      icon: <Gauge className="h-4 w-4 text-violet-400" />,
    },
    {
      key: t(
        'driveScore.tips.cruiseControl',
        'Use Autopilot or cruise control on highways for consistent speed.',
      ),
      category: 'speed',
      icon: <Gauge className="h-4 w-4 text-violet-400" />,
    },
    {
      key: t(
        'driveScore.tips.routePlanning',
        'Plan routes to avoid high-speed stretches when possible.',
      ),
      category: 'speed',
      icon: <Gauge className="h-4 w-4 text-violet-400" />,
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
  icon: React.ReactNode;
  check: (scores: DriveScore[], drives: Drive[]) => boolean;
}

function buildAchievements(
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
      icon: <Route className="h-5 w-5" />,
      check: (_scores, drives) => drives.length >= 1,
    },
    {
      id: 'ten-drives',
      label: t('driveScore.achievements.tenDrives', 'Road Regular'),
      description: t(
        'driveScore.achievements.tenDrivesDesc',
        'Complete 10 scored drives.',
      ),
      icon: <Star className="h-5 w-5" />,
      check: (_scores, drives) => drives.length >= 10,
    },
    {
      id: 'fifty-drives',
      label: t('driveScore.achievements.fiftyDrives', 'Highway Hero'),
      description: t(
        'driveScore.achievements.fiftyDrivesDesc',
        'Complete 50 scored drives.',
      ),
      icon: <Trophy className="h-5 w-5 text-yellow-400" />,
      check: (_scores, drives) => drives.length >= 50,
    },
    {
      id: 'perfect-score',
      label: t('driveScore.achievements.perfectScore', 'Perfect Score'),
      description: t(
        'driveScore.achievements.perfectScoreDesc',
        'Achieve a 100/100 on any drive.',
      ),
      icon: <Award className="h-5 w-5 text-amber-400" />,
      check: (scores) => scores.some((s) => s.total >= 100),
    },
    {
      id: 'a-plus-streak',
      label: t('driveScore.achievements.aPlusStreak', 'A+ Streak'),
      description: t(
        'driveScore.achievements.aPlusStreakDesc',
        'Get A+ grade on 5 consecutive drives.',
      ),
      icon: <Trophy className="h-5 w-5 text-green-400" />,
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
      icon: <Zap className="h-5 w-5 text-green-400" />,
      check: (scores) =>
        scores.filter((s) => s.efficiency >= 38).length >= 3,
    },
    {
      id: 'smooth-operator',
      label: t('driveScore.achievements.smoothOperator', 'Smooth Operator'),
      description: t(
        'driveScore.achievements.smoothOperatorDesc',
        'Score 28+ in smoothness on 3 drives.',
      ),
      icon: <ShieldCheck className="h-5 w-5 text-cyan-400" />,
      check: (scores) =>
        scores.filter((s) => s.smoothness >= 28).length >= 3,
    },
    {
      id: 'speed-saint',
      label: t('driveScore.achievements.speedSaint', 'Speed Saint'),
      description: t(
        'driveScore.achievements.speedSaintDesc',
        'Score 28+ in speed discipline on 5 drives.',
      ),
      icon: <Target className="h-5 w-5 text-violet-400" />,
      check: (scores) =>
        scores.filter((s) => s.speed >= 28).length >= 5,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Main page component                                                */
/* ------------------------------------------------------------------ */

export default function DriveScorePage() {
  const { t } = useTranslation();
  usePageTitle(t('driveScore.title', 'Drive Score'));

  /* ---- vehicle selector ---- */
  const { data: vehicles } = useVehicles();
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  /* ---- queries ---- */
  const {
    data: apiScore,
  } = useDriveScore(vehicleIdStr);
  const {
    data: drives,
    isLoading: drivesLoading,
  } = useDrives(vehicleIdStr);

  /* ---- settings ---- */
  const {
    convertDistance,
    convertSpeed,
    convertEfficiency,
    distanceUnit,
    speedUnit,
    efficiencyUnit,
  } = useSettings();

  /* ---- date filter ---- */
  const [startDate, setStartDate] = useState<string>(getDefaultStartDate);
  const [endDate, setEndDate] = useState<string>(getDefaultEndDate);

  /* ---- sort state ---- */
  const [sortField, setSortField] = useState<SortField>('date');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  /* ---- pagination ---- */
  const [currentPage, setCurrentPage] = useState(1);

  /* ---- filtered & scored drives ---- */
  const filteredDrives = useMemo(() => {
    if (!drives) return [];
    const start = new Date(startDate).getTime();
    const end = new Date(endDate).getTime() + 86_400_000;
    return drives.filter((d) => {
      const ts = new Date(d.startDate).getTime();
      return ts >= start && ts <= end;
    });
  }, [drives, startDate, endDate]);

  const scoredDrives = useMemo(
    () =>
      filteredDrives.map((d) => ({
        drive: d,
        score: scoreDrive(d),
      })),
    [filteredDrives],
  );

  /* ---- sorted drives ---- */
  const sortedDrives = useMemo(() => {
    const sorted = [...scoredDrives];
    sorted.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case 'date':
          cmp =
            new Date(a.drive.startDate).getTime() -
            new Date(b.drive.startDate).getTime();
          break;
        case 'distance':
          cmp = a.drive.distance - b.drive.distance;
          break;
        case 'score':
          cmp = a.score.total - b.score.total;
          break;
        case 'efficiency':
          cmp = a.score.whPerKm - b.score.whPerKm;
          break;
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return sorted;
  }, [scoredDrives, sortField, sortDir]);

  /* ---- paginated drives ---- */
  const totalPages = Math.max(1, Math.ceil(sortedDrives.length / DRIVES_PER_PAGE));
  const paginatedDrives = useMemo(
    () =>
      sortedDrives.slice(
        (currentPage - 1) * DRIVES_PER_PAGE,
        currentPage * DRIVES_PER_PAGE,
      ),
    [sortedDrives, currentPage],
  );

  /* ---- aggregate scored data for charts ---- */
  const allScores = useMemo(
    () => scoredDrives.map((sd) => sd.score),
    [scoredDrives],
  );

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
  const overallGrade = apiScore?.grade ?? (
    overallScore >= 90
      ? 'A+'
      : overallScore >= 80
        ? 'A'
        : overallScore >= 70
          ? 'B'
          : overallScore >= 60
            ? 'C'
            : overallScore >= 50
              ? 'D'
              : 'F'
  );
  const overallTrend = apiScore?.trend ?? 'flat';

  /* ---- trend chart data (last 20 drives) ---- */
  const trendChartData = useMemo(() => {
    const recent = [...scoredDrives]
      .sort(
        (a, b) =>
          new Date(a.drive.startDate).getTime() -
          new Date(b.drive.startDate).getTime(),
      )
      .slice(-20);
    return recent.map((sd) => ({
      date: formatDateShort(sd.drive.startDate),
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
        value: apiScore?.efficiency ?? avgScores.efficiency,
        max: 40,
        fill: CATEGORY_COLORS.efficiency,
      },
      {
        name: t('driveScore.smoothness', 'Smoothness'),
        value: apiScore?.smoothness ?? avgScores.smoothness,
        max: 30,
        fill: CATEGORY_COLORS.smoothness,
      },
      {
        name: t('driveScore.speedDiscipline', 'Speed Discipline'),
        value: apiScore?.speedDiscipline ?? avgScores.speed,
        max: 30,
        fill: CATEGORY_COLORS.speed,
      },
    ],
    [apiScore, avgScores, t],
  );

  /* ---- tips based on weakest category ---- */
  const tips = useMemo(() => buildTips(t), [t]);

  const weakestCategory = useMemo((): 'efficiency' | 'smoothness' | 'speed' => {
    const eff = (apiScore?.efficiency ?? avgScores.efficiency) / 40;
    const sm = (apiScore?.smoothness ?? avgScores.smoothness) / 30;
    const sp = (apiScore?.speedDiscipline ?? avgScores.speed) / 30;
    if (eff <= sm && eff <= sp) return 'efficiency';
    if (sm <= sp) return 'smoothness';
    return 'speed';
  }, [apiScore, avgScores]);

  const relevantTips = useMemo(
    () => tips.filter((tip) => tip.category === weakestCategory),
    [tips, weakestCategory],
  );

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

  /* ---- handlers ---- */
  const handleVehicleChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      setSelectedVehicle(Number(e.target.value));
      setCurrentPage(1);
    },
    [],
  );

  const handleSort = useCallback(
    (field: SortField) => {
      if (sortField === field) {
        setSortDir((prev) => (prev === 'asc' ? 'desc' : 'asc'));
      } else {
        setSortField(field);
        setSortDir('desc');
      }
      setCurrentPage(1);
    },
    [sortField],
  );

  const handleDateApply = useCallback(() => {
    setCurrentPage(1);
  }, []);

  /* ---- best & worst drives ---- */
  const bestDrive = useMemo(
    () => scoredDrives.length > 0 ? [...scoredDrives].sort((a, b) => b.score.total - a.score.total)[0] : null,
    [scoredDrives],
  );
  const worstDrive = useMemo(
    () => scoredDrives.length > 0 ? [...scoredDrives].sort((a, b) => a.score.total - b.score.total)[0] : null,
    [scoredDrives],
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

  /* ---- weekly / monthly averages ---- */
  const periodStats = useMemo(() => {
    if (scoredDrives.length === 0) return null;
    const now = new Date();
    const weekStart = new Date(now); weekStart.setDate(now.getDate() - now.getDay());
    const lastWeekStart = new Date(weekStart); lastWeekStart.setDate(lastWeekStart.getDate() - 7);
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);

    const avg = (items: typeof scoredDrives) => items.length > 0 ? Math.round(items.reduce((s, d) => s + d.score.total, 0) / items.length) : null;

    const thisWeekDrives = scoredDrives.filter((sd) => new Date(sd.drive.startDate) >= weekStart);
    const lastWeekDrives = scoredDrives.filter((sd) => { const d = new Date(sd.drive.startDate); return d >= lastWeekStart && d < weekStart; });
    const thisMonthDrives = scoredDrives.filter((sd) => new Date(sd.drive.startDate) >= monthStart);
    const lastMonthDrives = scoredDrives.filter((sd) => { const d = new Date(sd.drive.startDate); return d >= lastMonthStart && d <= lastMonthEnd; });

    const weekMap = new Map<string, typeof scoredDrives>();
    const monthMap = new Map<string, typeof scoredDrives>();
    scoredDrives.forEach((sd) => {
      const d = new Date(sd.drive.startDate);
      const wk = `${d.getFullYear()}-W${Math.ceil((d.getDate() + new Date(d.getFullYear(), d.getMonth(), 1).getDay()) / 7)}`;
      const mo = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!weekMap.has(wk)) weekMap.set(wk, []);
      weekMap.get(wk)!.push(sd);
      if (!monthMap.has(mo)) monthMap.set(mo, []);
      monthMap.get(mo)!.push(sd);
    });

    let bestWeek = { avg: 0, label: '—' };
    weekMap.forEach((items, label) => { const a = avg(items); if (a != null && a > bestWeek.avg) bestWeek = { avg: a, label }; });
    let bestMonth = { avg: 0, label: '—' };
    monthMap.forEach((items, label) => { const a = avg(items); if (a != null && a > bestMonth.avg) bestMonth = { avg: a, label }; });

    const aOrBetter = allScores.filter((s) => s.grade === 'A+' || s.grade === 'A').length;

    return {
      thisWeekAvg: avg(thisWeekDrives), lastWeekAvg: avg(lastWeekDrives),
      thisMonthAvg: avg(thisMonthDrives), lastMonthAvg: avg(lastMonthDrives),
      bestWeek, bestMonth, totalDrives: scoredDrives.length, aOrBetter,
    };
  }, [scoredDrives, allScores]);

  /* ---- loading state ---- */
  const isLoading = drivesLoading;

  /* ---- vehicle selector actions ---- */
  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  const vehicleSelector = vehicles && vehicles.length > 1 ? (
    <Select
      options={vehicleOptions}
      value={vehicleId != null ? String(vehicleId) : ''}
      onChange={handleVehicleChange}
      placeholder={t('driveScore.selectVehicle', 'Select vehicle')}
    />
  ) : null;

  /* ---- trend icon helper ---- */
  const TrendIcon = overallTrend === 'up'
    ? TrendingUp
    : overallTrend === 'down'
      ? TrendingDown
      : Minus;

  const trendLabel =
    overallTrend === 'up'
      ? t('driveScore.trendUp', 'Improving')
      : overallTrend === 'down'
        ? t('driveScore.trendDown', 'Declining')
        : t('driveScore.trendFlat', 'Stable');

  const trendColor =
    overallTrend === 'up'
      ? 'text-green-400'
      : overallTrend === 'down'
        ? 'text-red-400'
        : 'text-gray-400';

  /* ---- sort header helper ---- */
  const SortHeader = ({
    field,
    label,
  }: {
    field: SortField;
    label: string;
  }) => (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 font-medium"
    >
      {label}
      {sortField === field &&
        (sortDir === 'asc' ? (
          <ChevronUp className="h-3 w-3" />
        ) : (
          <ChevronDown className="h-3 w-3" />
        ))}
    </Button>
  );

  /* ================================================================ */
  /*  Render                                                           */
  /* ================================================================ */

  return (
    <PageContainer
      title={t('driveScore.title', 'Drive Score')}
      subtitle={t('driveScore.subtitle', 'Your driving rating and breakdown')}
      loading={isLoading}
      actions={vehicleSelector}
    >
      {/* -------- Section 9: Date range filter -------- */}
      <FadeIn>
        <GlassPanel className="mb-6">
          <DateRangeFilter
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
            onApply={handleDateApply}
            presets
          />
        </GlassPanel>
      </FadeIn>

      {/* -------- Empty guard -------- */}
      {!isLoading && scoredDrives.length === 0 && (
        <EmptyState
          icon={<Gauge className="h-12 w-12 text-gray-500" />}
          title={t('driveScore.emptyTitle', 'No Scored Drives')}
          message={t(
            'driveScore.empty',
            'Not enough drives in the selected period to calculate a score.',
          )}
        />
      )}

      {scoredDrives.length > 0 && (
        <StaggerContainer className="space-y-6">
          {/* -------- Section 1: Hero overall score gauge -------- */}
          <StaggerItem>
            <GlassPanel className="flex flex-col items-center py-8">
              <RadialGauge
                value={overallScore}
                max={100}
                label={t('driveScore.overall', 'Overall Score')}
                color={gradeColor(overallGrade)}
                size={200}
              />
              <div className="mt-4 text-center">
                <span className="text-4xl font-bold">
                  <AnimatedNumber value={overallScore} />
                </span>
                <span className="text-lg text-white/60 ml-1">/100</span>
              </div>
              <div className={cn('mt-2 flex items-center gap-2', trendColor)}>
                <TrendIcon className="h-4 w-4" />
                <span className="text-sm font-medium">{trendLabel}</span>
              </div>
              {apiScore && (
                <span className="mt-1 text-xs text-white/40">
                  {t('driveScore.basedOn', 'Based on {{count}} drives', {
                    count: apiScore.totalDrives,
                  })}
                </span>
              )}
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 3: Grade badge -------- */}
          <StaggerItem>
            <GlassPanel className="flex items-center justify-between px-6 py-4">
              <div className="flex items-center gap-4">
                <Badge
                  variant={gradeVariant(overallGrade)}
                  size="lg"
                >
                  {overallGrade}
                </Badge>
                <div>
                  <span className="text-lg font-semibold text-white">
                    {t('driveScore.gradeLabel', 'Grade: {{grade}}', {
                      grade: overallGrade,
                    })}
                  </span>
                  <div className={cn('flex items-center gap-1 text-sm', trendColor)}>
                    <TrendIcon className="h-3 w-3" />
                    <span>{trendLabel}</span>
                  </div>
                </div>
              </div>
              <div className="text-right text-sm text-white/60">
                <span>
                  {t('driveScore.drivesInPeriod', '{{count}} drives in period', {
                    count: scoredDrives.length,
                  })}
                </span>
              </div>
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 2: Score breakdown cards -------- */}
          <StaggerItem>
            <Grid cols={{ default: 1, md: 3 }} gap={4}>
              {/* Efficiency */}
              <GlassPanel className="flex flex-col items-center p-6">
                <RadialGauge
                  value={apiScore?.efficiency ?? avgScores.efficiency}
                  max={40}
                  label={t('driveScore.efficiency', 'Efficiency')}
                  color={CATEGORY_COLORS.efficiency}
                  size={120}
                />
                <div className="mt-3 text-center">
                  <span className="text-2xl font-bold text-white">
                    <AnimatedNumber
                      value={apiScore?.efficiency ?? avgScores.efficiency}
                    />
                  </span>
                  <span className="text-sm text-white/50 ml-1">/40</span>
                </div>
                <MetricBar
                  label={t('driveScore.efficiency', 'Efficiency')}
                  value={apiScore?.efficiency ?? avgScores.efficiency}
                  max={40}
                  color={CATEGORY_COLORS.efficiency}
                />
                <InlineMetric
                  icon={<Zap className="h-4 w-4 text-green-400" />}
                  label={t('driveScore.avgConsumption', 'Avg consumption')}
                  value={fmtWithUnit(
                    convertEfficiency(
                      scoredDrives.reduce(
                        (sum, sd) => sum + sd.score.whPerKm,
                        0,
                      ) / scoredDrives.length,
                    ),
                    efficiencyUnit,
                  )}
                  className="mt-2"
                />
              </GlassPanel>

              {/* Smoothness */}
              <GlassPanel className="flex flex-col items-center p-6">
                <RadialGauge
                  value={apiScore?.smoothness ?? avgScores.smoothness}
                  max={30}
                  label={t('driveScore.smoothness', 'Smoothness')}
                  color={CATEGORY_COLORS.smoothness}
                  size={120}
                />
                <div className="mt-3 text-center">
                  <span className="text-2xl font-bold text-white">
                    <AnimatedNumber
                      value={apiScore?.smoothness ?? avgScores.smoothness}
                    />
                  </span>
                  <span className="text-sm text-white/50 ml-1">/30</span>
                </div>
                <MetricBar
                  label={t('driveScore.smoothness', 'Smoothness')}
                  value={apiScore?.smoothness ?? avgScores.smoothness}
                  max={30}
                  color={CATEGORY_COLORS.smoothness}
                />
                <InlineMetric
                  icon={<Activity className="h-4 w-4 text-cyan-400" />}
                  label={t('driveScore.powerRange', 'Power range')}
                  value={fmtWithUnit(
                    scoredDrives.length > 0
                      ? Math.round(
                          scoredDrives.reduce(
                            (sum, sd) =>
                              sum +
                              ((sd.drive.powerMax ?? 50) -
                                (sd.drive.powerMin ?? -20)),
                            0,
                          ) / scoredDrives.length,
                        )
                      : 0,
                    'kW',
                  )}
                  className="mt-2"
                />
              </GlassPanel>

              {/* Speed Discipline */}
              <GlassPanel className="flex flex-col items-center p-6">
                <RadialGauge
                  value={apiScore?.speedDiscipline ?? avgScores.speed}
                  max={30}
                  label={t('driveScore.speedDiscipline', 'Speed Discipline')}
                  color={CATEGORY_COLORS.speed}
                  size={120}
                />
                <div className="mt-3 text-center">
                  <span className="text-2xl font-bold text-white">
                    <AnimatedNumber
                      value={apiScore?.speedDiscipline ?? avgScores.speed}
                    />
                  </span>
                  <span className="text-sm text-white/50 ml-1">/30</span>
                </div>
                <MetricBar
                  label={t('driveScore.speedDiscipline', 'Speed Discipline')}
                  value={apiScore?.speedDiscipline ?? avgScores.speed}
                  max={30}
                  color={CATEGORY_COLORS.speed}
                />
                <InlineMetric
                  icon={<Gauge className="h-4 w-4 text-violet-400" />}
                  label={t('driveScore.avgMaxSpeed', 'Avg max speed')}
                  value={fmtWithUnit(
                    scoredDrives.length > 0
                      ? Math.round(
                          convertSpeed(
                            scoredDrives.reduce(
                              (sum, sd) =>
                                sum + (sd.drive.speedMax ?? 80),
                              0,
                            ) / scoredDrives.length,
                          ),
                        )
                      : 0,
                    speedUnit,
                  )}
                  className="mt-2"
                />
              </GlassPanel>
            </Grid>
          </StaggerItem>

          {/* -------- Section 4: Score trend chart -------- */}
          <StaggerItem>
            <GlassPanel>
              <ChartContainer title={t('driveScore.scoreTrend', 'Score Trend')} height={300}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendChartData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis dataKey="date" stroke="#94a3b8" fontSize={12} />
                    <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={12} />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <ReferenceLine
                      y={80}
                      stroke="#4ade80"
                      strokeDasharray="4 4"
                      label={{
                        value: t('driveScore.gradeALine', 'A'),
                        fill: '#4ade80',
                        fontSize: 11,
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="score"
                      name={t('driveScore.totalScore', 'Total Score')}
                      stroke={gradeColor(overallGrade)}
                      strokeWidth={2}
                      dot={{ r: 3, fill: gradeColor(overallGrade) }}
                      activeDot={{ r: 5 }}
                    />
                    <Line
                      type="monotone"
                      dataKey="efficiency"
                      name={t('driveScore.efficiency', 'Efficiency')}
                      stroke={CATEGORY_COLORS.efficiency}
                      strokeWidth={1}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="smoothness"
                      name={t('driveScore.smoothness', 'Smoothness')}
                      stroke={CATEGORY_COLORS.smoothness}
                      strokeWidth={1}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                    <Line
                      type="monotone"
                      dataKey="speed"
                      name={t('driveScore.speedDiscipline', 'Speed Discipline')}
                      stroke={CATEGORY_COLORS.speed}
                      strokeWidth={1}
                      strokeDasharray="4 2"
                      dot={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 5: Category bar chart -------- */}
          <StaggerItem>
            <GlassPanel>
              <ChartContainer title={t('driveScore.categoryBreakdown', 'Category Breakdown')} height={260}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={categoryBarData} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                    <XAxis type="number" domain={[0, 40]} stroke="#94a3b8" fontSize={12} />
                    <YAxis
                      type="category"
                      dataKey="name"
                      width={130}
                      stroke="#94a3b8"
                      fontSize={12}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="value" radius={[0, 6, 6, 0]} barSize={28}>
                      {categoryBarData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                    <Bar
                      dataKey="max"
                      radius={[0, 6, 6, 0]}
                      barSize={28}
                      fill="#1e293b"
                      opacity={0.3}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 5b: Score Distribution Histogram -------- */}
          <StaggerItem>
            <GlassPanel>
              <ChartContainer title={t('driveScore.scoreDistribution', 'Score Distribution')} height={220}>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogramData} barCategoryGap="20%">
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.5} vertical={false} />
                    <XAxis dataKey="range" tick={{ fontSize: 11, fill: 'var(--text-muted)' }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'var(--text-muted)' }} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar dataKey="count" name={t('driveScore.drives', 'Drives')} radius={[6, 6, 0, 0]}>
                      {histogramData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.color} fillOpacity={0.8} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartContainer>
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 6: Tips / Recommendations -------- */}
          <StaggerItem>
            <GlassPanel>
              <CardHeader
                title={t('driveScore.tipsTitle', 'Improvement Tips')}
              />
              <div className="px-4 pb-4">
                <span className="text-sm text-white/60 mb-3 block">
                  {t('driveScore.tipsSubtitle', 'Based on your weakest category: {{category}}', {
                    category:
                      weakestCategory === 'efficiency'
                        ? t('driveScore.efficiency', 'Efficiency')
                        : weakestCategory === 'smoothness'
                          ? t('driveScore.smoothness', 'Smoothness')
                          : t('driveScore.speedDiscipline', 'Speed Discipline'),
                  })}
                </span>
                <div className="space-y-3">
                  {relevantTips.map((tip, idx) => (
                    <div
                      key={idx}
                      className="flex items-start gap-3 rounded-lg bg-white/5 p-3"
                    >
                      <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-yellow-400" />
                      <span className="text-sm text-white/80">{tip.key}</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 6b: Best & Worst Drives -------- */}
          <StaggerItem>
            <Grid cols={{ default: 1, sm: 2 }} gap={4}>
              <GlassPanel className="p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <Star className="h-5 w-5 text-green-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driveScore.bestDrive', 'Best Drive')}</h3>
                </div>
                {bestDrive ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">{formatDateShort(bestDrive.drive.startDate)}</span>
                      <Badge variant={gradeVariant(bestDrive.score.grade)} size="sm">{bestDrive.score.grade}</Badge>
                    </div>
                    <div className="flex items-center gap-4">
                      <RadialGauge value={bestDrive.score.total} max={100} label={t('driveScore.score', 'Score')} color="#4ade80" size={72} />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-muted)]">{t('driveScore.distance', 'Distance')}</span>
                          <span className="text-[var(--text-primary)]">{fmtNumber(convertDistance(bestDrive.drive.distance))} {distanceUnit}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-muted)]">{t('driveScore.durationLabel', 'Duration')}</span>
                          <span className="text-[var(--text-primary)]">{formatDuration(bestDrive.drive.durationMin)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-muted)]">{t('driveScore.consumption', 'Consumption')}</span>
                          <span className="text-[var(--text-primary)]">{fmtInt(convertEfficiency(bestDrive.score.whPerKm))} {efficiencyUnit}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg bg-green-500/5 border border-green-500/20 p-3">
                      <p className="text-xs text-green-400">
                        <Star className="inline h-3 w-3 mr-1" />
                        {bestDrive.score.efficiency >= 35
                          ? t('driveScore.tipBestEff', 'Outstanding energy efficiency — minimal energy wasted!')
                          : bestDrive.score.smoothness >= 25
                            ? t('driveScore.tipBestSmooth', 'Exceptionally smooth driving with controlled acceleration.')
                            : t('driveScore.tipBestSpeed', 'Great speed discipline, staying in the optimal range.')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">{t('driveScore.noDrives', 'No drives available')}</p>
                )}
              </GlassPanel>

              <GlassPanel className="p-5 sm:p-6">
                <div className="flex items-center gap-2 mb-4">
                  <AlertTriangle className="h-5 w-5 text-red-400" />
                  <h3 className="text-sm font-semibold text-[var(--text-primary)]">{t('driveScore.worstDrive', 'Worst Drive')}</h3>
                </div>
                {worstDrive ? (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--text-muted)]">{formatDateShort(worstDrive.drive.startDate)}</span>
                      <Badge variant={gradeVariant(worstDrive.score.grade)} size="sm">{worstDrive.score.grade}</Badge>
                    </div>
                    <div className="flex items-center gap-4">
                      <RadialGauge value={worstDrive.score.total} max={100} label={t('driveScore.score', 'Score')} color="#f87171" size={72} />
                      <div className="flex-1 space-y-2">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-muted)]">{t('driveScore.distance', 'Distance')}</span>
                          <span className="text-[var(--text-primary)]">{fmtNumber(convertDistance(worstDrive.drive.distance))} {distanceUnit}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-muted)]">{t('driveScore.durationLabel', 'Duration')}</span>
                          <span className="text-[var(--text-primary)]">{formatDuration(worstDrive.drive.durationMin)}</span>
                        </div>
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-[var(--text-muted)]">{t('driveScore.consumption', 'Consumption')}</span>
                          <span className="text-[var(--text-primary)]">{fmtInt(convertEfficiency(worstDrive.score.whPerKm))} {efficiencyUnit}</span>
                        </div>
                      </div>
                    </div>
                    <div className="rounded-lg bg-red-500/5 border border-red-500/20 p-3">
                      <p className="text-xs text-red-400">
                        <AlertTriangle className="inline h-3 w-3 mr-1" />
                        {worstDrive.score.efficiency < 15
                          ? t('driveScore.tipWorstEff', 'High energy consumption — possibly high speeds or cold weather.')
                          : worstDrive.score.smoothness < 10
                            ? t('driveScore.tipWorstSmooth', 'Aggressive acceleration and braking detected.')
                            : t('driveScore.tipWorstSpeed', 'Excessive highway speed reduced the overall score.')}
                      </p>
                    </div>
                  </div>
                ) : (
                  <p className="text-sm text-[var(--text-muted)]">{t('driveScore.noDrives', 'No drives available')}</p>
                )}
              </GlassPanel>
            </Grid>
          </StaggerItem>

          {/* -------- Section 7: Drive history table -------- */}
          <StaggerItem>
            <GlassPanel>
              <CardHeader
                title={t('driveScore.driveHistory', 'Drive History')}
              />
              <div className="overflow-x-auto">
                <div className="min-w-[800px]">
                  {/* Table header */}
                  <div className="grid grid-cols-8 gap-2 border-b border-white/10 px-4 pb-2">
                    <SortHeader
                      field="date"
                      label={t('driveScore.colDate', 'Date')}
                    />
                    <span className="text-xs font-medium text-white/50 flex items-center">
                      {t('driveScore.colRoute', 'Route')}
                    </span>
                    <SortHeader
                      field="distance"
                      label={t('driveScore.colDistance', 'Distance')}
                    />
                    <span className="text-xs font-medium text-white/50 flex items-center">
                      {t('driveScore.colDuration', 'Duration')}
                    </span>
                    <span className="text-xs font-medium text-white/50 flex items-center">
                      {t('driveScore.colConsumption', 'Consumption')}
                    </span>
                    <SortHeader
                      field="score"
                      label={t('driveScore.colScore', 'Score')}
                    />
                    <span className="text-xs font-medium text-white/50 flex items-center">
                      {t('driveScore.colGrade', 'Grade')}
                    </span>
                    <SortHeader
                      field="efficiency"
                      label={t('driveScore.colEfficiency', 'Eff')}
                    />
                  </div>

                  {/* Table body */}
                  {paginatedDrives.length === 0 && (
                    <div className="py-8 text-center text-sm text-white/40">
                      {t('driveScore.noDrives', 'No drives found for the selected period.')}
                    </div>
                  )}

                  {paginatedDrives.map(({ drive, score: ds }) => (
                    <div
                      key={drive.id}
                      className="grid grid-cols-8 gap-2 border-b border-white/5 px-4 py-3 hover:bg-white/5 transition-colors"
                    >
                      {/* Date */}
                      <span className="text-sm text-white/80 truncate">
                        {formatDateShort(drive.startDate)}
                      </span>

                      {/* Route */}
                      <span className="text-sm text-white/60 truncate">
                        {drive.startAddress
                          ? `${drive.startAddress}${drive.endAddress ? ` → ${drive.endAddress}` : ''}`
                          : t('driveScore.unknownRoute', 'Unknown')}
                      </span>

                      {/* Distance */}
                      <span className="text-sm text-white/80">
                        {fmtWithUnit(
                          convertDistance(drive.distance),
                          distanceUnit,
                        )}
                      </span>

                      {/* Duration */}
                      <span className="text-sm text-white/80">
                        {formatDuration(drive.durationMin)}
                      </span>

                      {/* Consumption */}
                      <span className="text-sm text-white/80">
                        {fmtWithUnit(
                          convertEfficiency(ds.whPerKm),
                          efficiencyUnit,
                        )}
                      </span>

                      {/* Score */}
                      <span
                        className={cn('text-sm font-semibold', gradeTextClass(ds.grade))}
                      >
                        {ds.total}/100
                      </span>

                      {/* Grade */}
                      <span>
                        <Badge variant={gradeVariant(ds.grade)} size="sm">
                          {ds.grade}
                        </Badge>
                      </span>

                      {/* Efficiency breakdown */}
                      <span className="text-xs text-white/50">
                        {ds.efficiency}/{ds.smoothness}/{ds.speed}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex justify-center py-4">
                  <Pagination
                    page={currentPage}
                    total={sortedDrives.length}
                    pageSize={DRIVES_PER_PAGE}
                    onPageChange={setCurrentPage}
                  />
                </div>
              )}
            </GlassPanel>
          </StaggerItem>

          {/* -------- Section 8: Score summary cards -------- */}
          <StaggerItem>
            <Grid cols={{ default: 2, md: 4 }} gap={4}>
              <StatCard
                label={t('driveScore.avgScore', 'Avg Score')}
                value={avgScores.total}
                unit="/100"
                icon={<Target className="h-5 w-5 text-white/40" />}
                trend={{
                  direction: overallTrend,
                  value: trendLabel,
                  positive: overallTrend === 'up',
                }}
              />
              <StatCard
                label={t('driveScore.bestScore', 'Best Score')}
                value={
                  allScores.length > 0
                    ? Math.max(...allScores.map((s) => s.total))
                    : 0
                }
                unit="/100"
                icon={<Trophy className="h-5 w-5 text-yellow-400" />}
              />
              <StatCard
                label={t('driveScore.totalDrivesLabel', 'Total Drives')}
                value={scoredDrives.length}
                icon={<Route className="h-5 w-5 text-white/40" />}
              />
              <StatCard
                label={t('driveScore.avgEffLabel', 'Avg Efficiency')}
                value={fmtNumber(
                  scoredDrives.length > 0
                    ? convertEfficiency(
                        scoredDrives.reduce(
                          (sum, sd) => sum + sd.score.whPerKm,
                          0,
                        ) / scoredDrives.length,
                      )
                    : 0,
                )}
                unit={efficiencyUnit}
                icon={<Zap className="h-5 w-5 text-green-400" />}
              />
            </Grid>
          </StaggerItem>

          {/* -------- Section 9: Weekly / Monthly Averages -------- */}
          {periodStats && (
            <StaggerItem>
              <Grid cols={{ default: 2, sm: 3, lg: 6 }} gap={3}>
                <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('driveScore.thisWeek', 'This Week')}
                  </span>
                  <div className="flex items-end gap-2">
                    <span className={cn('text-2xl font-bold tabular-nums', scoreTextClass(periodStats.thisWeekAvg))}>
                      {periodStats.thisWeekAvg ?? '—'}
                    </span>
                    {periodStats.thisWeekAvg != null && periodStats.lastWeekAvg != null && (
                      <span className={cn('text-xs flex items-center', periodStats.thisWeekAvg >= periodStats.lastWeekAvg ? 'text-green-400' : 'text-red-400')}>
                        {periodStats.thisWeekAvg >= periodStats.lastWeekAvg ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {Math.abs(periodStats.thisWeekAvg - periodStats.lastWeekAvg)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {t('driveScore.vsLastWeek', 'vs {{val}} last week', { val: periodStats.lastWeekAvg ?? '—' })}
                  </span>
                </GlassPanel>

                <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('driveScore.thisMonth', 'This Month')}
                  </span>
                  <div className="flex items-end gap-2">
                    <span className={cn('text-2xl font-bold tabular-nums', scoreTextClass(periodStats.thisMonthAvg))}>
                      {periodStats.thisMonthAvg ?? '—'}
                    </span>
                    {periodStats.thisMonthAvg != null && periodStats.lastMonthAvg != null && (
                      <span className={cn('text-xs flex items-center', periodStats.thisMonthAvg >= periodStats.lastMonthAvg ? 'text-green-400' : 'text-red-400')}>
                        {periodStats.thisMonthAvg >= periodStats.lastMonthAvg ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
                        {Math.abs(periodStats.thisMonthAvg - periodStats.lastMonthAvg)}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {t('driveScore.vsLastMonth', 'vs {{val}} last month', { val: periodStats.lastMonthAvg ?? '—' })}
                  </span>
                </GlassPanel>

                <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('driveScore.bestWeek', 'Best Week')}
                  </span>
                  <span className={cn('text-2xl font-bold tabular-nums', scoreTextClass(periodStats.bestWeek.avg))}>
                    {periodStats.bestWeek.avg || '—'}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{periodStats.bestWeek.label}</span>
                </GlassPanel>

                <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('driveScore.bestMonth', 'Best Month')}
                  </span>
                  <span className={cn('text-2xl font-bold tabular-nums', scoreTextClass(periodStats.bestMonth.avg))}>
                    {periodStats.bestMonth.avg || '—'}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">{periodStats.bestMonth.label}</span>
                </GlassPanel>

                <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('driveScore.totalDrivesLabel', 'Total Drives')}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-[var(--text-primary)]">
                    {periodStats.totalDrives}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {t('driveScore.drivesScored', 'drives scored')}
                  </span>
                </GlassPanel>

                <GlassPanel className="p-4 sm:p-5 flex flex-col gap-2">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    {t('driveScore.ratedAPlus', 'Rated A+/A')}
                  </span>
                  <span className="text-2xl font-bold tabular-nums text-green-400">
                    {periodStats.aOrBetter}
                  </span>
                  <span className="text-[10px] text-[var(--text-muted)]">
                    {periodStats.totalDrives > 0 ? `${Math.round((periodStats.aOrBetter / periodStats.totalDrives) * 100)}% ${t('driveScore.ofDrives', 'of drives')}` : t('driveScore.noDrives', 'no drives')}
                  </span>
                </GlassPanel>
              </Grid>
            </StaggerItem>
          )}

          {/* -------- Section 10: Achievement badges -------- */}
          <StaggerItem>
            <GlassPanel>
              <CardHeader
                title={t('driveScore.achievements.title', 'Achievements')}
              />
              <Grid cols={{ default: 2, md: 4 }} gap={3} className="p-4">
                {unlockedAchievements.map((ach) => (
                  <div
                    key={ach.id}
                    className={cn(
                      'flex flex-col items-center rounded-xl border p-4 text-center transition-all',
                      ach.unlocked
                        ? 'border-yellow-500/30 bg-yellow-500/5'
                        : 'border-white/5 bg-white/[0.02] opacity-40',
                    )}
                  >
                    <div
                      className={cn(
                        'mb-2 flex h-10 w-10 items-center justify-center rounded-full',
                        ach.unlocked
                          ? 'bg-yellow-500/20 text-yellow-400'
                          : 'bg-white/5 text-white/30',
                      )}
                    >
                      {ach.icon}
                    </div>
                    <span
                      className={cn(
                        'text-sm font-semibold',
                        ach.unlocked ? 'text-white' : 'text-white/40',
                      )}
                    >
                      {ach.label}
                    </span>
                    <span className="mt-1 text-xs text-white/40">
                      {ach.description}
                    </span>
                    {ach.unlocked && (
                      <Badge variant="success" size="sm" className="mt-2">
                        {t('driveScore.achievements.unlocked', 'Unlocked')}
                      </Badge>
                    )}
                  </div>
                ))}
              </Grid>
            </GlassPanel>
          </StaggerItem>

          {/* -------- Score detail KVList -------- */}
          <StaggerItem>
            <Grid cols={{ default: 1, md: 2 }} gap={4}>
              <Card>
                <CardHeader
                  title={t('driveScore.breakdown', 'Score Breakdown')}
                />
                <KVList
                  items={[
                    {
                      label: t(
                        'driveScore.efficiencyLabel',
                        'Efficiency (Wh/km)',
                      ),
                      value: `${apiScore?.efficiency ?? avgScores.efficiency}/40`,
                    },
                    {
                      label: t(
                        'driveScore.smoothnessLabel',
                        'Smoothness (power range)',
                      ),
                      value: `${apiScore?.smoothness ?? avgScores.smoothness}/30`,
                    },
                    {
                      label: t('driveScore.speedLabel', 'Speed Discipline'),
                      value: `${apiScore?.speedDiscipline ?? avgScores.speed}/30`,
                    },
                    {
                      label: t('driveScore.totalLabel', 'Total'),
                      value: `${overallScore}/100`,
                    },
                  ]}
                />
              </Card>

              <Card>
                <CardHeader
                  title={t('driveScore.periodStats', 'Period Statistics')}
                />
                <KVList
                  items={[
                    {
                      label: t('driveScore.totalDistance', 'Total Distance'),
                      value: fmtWithUnit(
                        convertDistance(
                          filteredDrives.reduce(
                            (sum, d) => sum + d.distance,
                            0,
                          ),
                        ),
                        distanceUnit,
                      ),
                    },
                    {
                      label: t('driveScore.totalDuration', 'Total Duration'),
                      value: formatDuration(
                        filteredDrives.reduce(
                          (sum, d) => sum + d.durationMin,
                          0,
                        ),
                      ),
                    },
                    {
                      label: t('driveScore.avgDistance', 'Avg Distance/Drive'),
                      value: fmtWithUnit(
                        filteredDrives.length > 0
                          ? convertDistance(
                              filteredDrives.reduce(
                                (sum, d) => sum + d.distance,
                                0,
                              ) / filteredDrives.length,
                            )
                          : 0,
                        distanceUnit,
                      ),
                    },
                    {
                      label: t(
                        'driveScore.avgDuration',
                        'Avg Duration/Drive',
                      ),
                      value: formatDuration(
                        filteredDrives.length > 0
                          ? filteredDrives.reduce(
                              (sum, d) => sum + d.durationMin,
                              0,
                            ) / filteredDrives.length
                          : 0,
                      ),
                    },
                    {
                      label: t('driveScore.highestSpeed', 'Highest Max Speed'),
                      value: fmtWithUnit(
                        filteredDrives.length > 0
                          ? convertSpeed(
                              Math.max(
                                ...filteredDrives.map(
                                  (d) => d.speedMax ?? 0,
                                ),
                              ),
                            )
                          : 0,
                        speedUnit,
                      ),
                    },
                    {
                      label: t('driveScore.aPlusCount', 'A+ Drives'),
                      value: fmtInt(
                        allScores.filter((s) => s.grade === 'A+').length,
                      ),
                    },
                  ]}
                />
              </Card>
            </Grid>
          </StaggerItem>
        </StaggerContainer>
      )}
    </PageContainer>
  );
}
