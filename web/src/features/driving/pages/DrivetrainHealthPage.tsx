import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import {
  CheckCircle,
  AlertTriangle,
  Thermometer,
  Zap,
  Activity,
  Shield,
  Heart,
  TrendingUp,
  Cpu,
  BatteryCharging,
} from 'lucide-react';

import { PageContainer, Grid } from '@/components/layout';
import { GlassPanel, Badge, Select, Card, CardHeader } from '@/components/ui';
import {
  ChartContainer,
  ChartTooltip,
  ChartGradient,
  LineChart,
  Line,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
  ReferenceLine,
} from '@/components/charts';
import { RadialGauge } from '@/components/charts/RadialGauge';
import {
  AnimatedNumber,
  MetricBar,
  MetricCard,
  InlineMetric,
  KVList,
} from '@/components/data-display';
import { Skeleton, AlertBanner } from '@/components/feedback';
import { FadeIn, StaggerContainer, StaggerItem } from '@/components/motion';

import { useDrivetrainHealth, useDrives, useDrivingStats } from '@/api/hooks/useDriving';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { usePageTitle } from '@/hooks/usePageTitle';
import { formatDateShort } from '@/lib/dateFormat';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';

/* ------------------------------------------------------------------ */
/*  Types & Constants                                                  */
/* ------------------------------------------------------------------ */

type HealthStatus = 'good' | 'warning' | 'critical';

const HEALTH_SCORE: Record<HealthStatus, number> = {
  good: 95,
  warning: 60,
  critical: 25,
};

const HEALTH_COLOR: Record<HealthStatus, string> = {
  good: '#10b981',
  warning: '#f59e0b',
  critical: '#ef4444',
};

const HEALTH_GLOW: Record<HealthStatus, 'green' | 'cyan' | 'purple' | 'none'> = {
  good: 'green',
  warning: 'cyan',
  critical: 'purple',
};

interface TempSensor {
  key: string;
  labelKey: string;
  defaultLabel: string;
  value: number | null;
  maxTemp: number;
  color: string;
  icon: React.ReactNode;
}

interface ChartDataPoint {
  date: string;
  powerMax: number;
  powerMin: number;
  outsideTemp: number | null;
  distance: number;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function healthBadgeVariant(
  health: HealthStatus,
): 'success' | 'warning' | 'danger' {
  if (health === 'good') return 'success';
  if (health === 'warning') return 'warning';
  return 'danger';
}

function getAlertVariant(
  health: HealthStatus,
): 'warning' | 'danger' {
  return health === 'warning' ? 'warning' : 'danger';
}

function tempSeverityColor(celsius: number | null, max: number): string {
  if (celsius === null) return '#6b7280';
  const ratio = celsius / max;
  if (ratio >= 0.85) return HEALTH_COLOR.critical;
  if (ratio >= 0.65) return HEALTH_COLOR.warning;
  return HEALTH_COLOR.good;
}

function tempNeonColor(
  celsius: number | null,
  max: number,
): 'green' | 'amber' | 'red' {
  if (celsius === null) return 'green';
  const ratio = celsius / max;
  if (ratio >= 0.85) return 'red';
  if (ratio >= 0.65) return 'amber';
  return 'green';
}

/* ------------------------------------------------------------------ */
/*  DrivetrainHealthPage                                              */
/* ------------------------------------------------------------------ */

export default function DrivetrainHealthPage() {
  const { t } = useTranslation();
  usePageTitle(t('drivetrain.title', 'Drivetrain Health'));

  /* ---- State ---- */
  const [selectedVehicle, setSelectedVehicle] = useState<number | null>(null);

  /* ---- Data hooks ---- */
  const { data: vehicles } = useVehicles();
  const vehicleId = selectedVehicle ?? vehicles?.[0]?.id ?? null;
  const vehicleIdStr = vehicleId != null ? String(vehicleId) : undefined;

  const {
    data: health,
    isLoading: healthLoading,
    error: healthError,
  } = useDrivetrainHealth(vehicleIdStr);
  const { data: drives } = useDrives(vehicleIdStr);
  const { data: stats } = useDrivingStats(vehicleIdStr);

  /* ---- Settings ---- */
  const {
    convertTemp,
    convertSpeed,
    convertDistance,
    tempUnit,
    speedUnit,
    distanceUnit,
    fmtTemp,
  } = useSettings();

  /* ---- Vehicle selector options ---- */
  const vehicleOptions = useMemo(() => {
    if (!vehicles?.length) return [];
    return vehicles.map((v) => ({
      value: String(v.id),
      label: v.display_name || v.vin,
    }));
  }, [vehicles]);

  /* ---- Health derived values ---- */
  const overallHealth: HealthStatus = health?.overallHealth ?? 'good';
  const healthScore = HEALTH_SCORE[overallHealth];
  const healthColor = HEALTH_COLOR[overallHealth];

  /* ---- Temperature sensors ---- */
  const sensors: TempSensor[] = useMemo(() => {
    if (!health) return [];
    return [
      {
        key: 'frontMotor',
        labelKey: 'drivetrain.frontMotor',
        defaultLabel: 'Front Motor',
        value: health.frontMotorTempC,
        maxTemp: 150,
        color: '#06b6d4',
        icon: <Zap className="h-4 w-4" />,
      },
      {
        key: 'rearMotor',
        labelKey: 'drivetrain.rearMotor',
        defaultLabel: 'Rear Motor',
        value: health.rearMotorTempC,
        maxTemp: 150,
        color: '#8b5cf6',
        icon: <Zap className="h-4 w-4" />,
      },
      {
        key: 'inverter',
        labelKey: 'drivetrain.inverter',
        defaultLabel: 'Inverter',
        value: health.inverterTempC,
        maxTemp: 120,
        color: '#f59e0b',
        icon: <Cpu className="h-4 w-4" />,
      },
      {
        key: 'battery',
        labelKey: 'drivetrain.battery',
        defaultLabel: 'Battery',
        value: health.batteryTempC,
        maxTemp: 60,
        color: '#10b981',
        icon: <BatteryCharging className="h-4 w-4" />,
      },
    ];
  }, [health]);

  /* ---- Chart data from drives ---- */
  const chartData: ChartDataPoint[] = useMemo(() => {
    if (!drives?.length) return [];
    return drives
      .slice()
      .sort(
        (a, b) =>
          new Date(a.startDate).getTime() - new Date(b.startDate).getTime(),
      )
      .slice(-30)
      .map((d) => ({
        date: formatDateShort(d.startDate),
        powerMax: d.powerMax ?? 0,
        powerMin: d.powerMin ?? 0,
        outsideTemp: d.outsideTempAvg ?? null,
        distance: d.distance,
      }));
  }, [drives]);

  /* ---- Temperature trend (drives with temp data) ---- */
  const tempTrendData = useMemo(() => {
    return chartData.filter((d) => d.outsideTemp !== null);
  }, [chartData]);

  /* ---- Aggregate power metrics ---- */
  const avgPowerMax = useMemo(() => {
    if (!chartData.length) return 0;
    const sum = chartData.reduce((acc, d) => acc + d.powerMax, 0);
    return sum / chartData.length;
  }, [chartData]);

  const peakPower = useMemo(() => {
    if (!chartData.length) return 0;
    return Math.max(...chartData.map((d) => d.powerMax));
  }, [chartData]);

  const minRegenPower = useMemo(() => {
    if (!chartData.length) return 0;
    return Math.min(...chartData.map((d) => d.powerMin));
  }, [chartData]);

  /* ---- Recommendations based on health ---- */
  const recommendations = useMemo(() => {
    const tips: Array<{
      key: string;
      text: string;
      priority: 'high' | 'medium' | 'low';
    }> = [];

    if (overallHealth === 'critical') {
      tips.push({
        key: 'critical-stop',
        text: t(
          'drivetrain.tips.criticalStop',
          'Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.',
        ),
        priority: 'high',
      });
      tips.push({
        key: 'service-urgent',
        text: t(
          'drivetrain.tips.serviceUrgent',
          'Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.',
        ),
        priority: 'high',
      });
    }

    if (overallHealth === 'warning' || overallHealth === 'critical') {
      tips.push({
        key: 'reduce-load',
        text: t(
          'drivetrain.tips.reduceLoad',
          'Reduce driving intensity and avoid hard acceleration to allow components to cool.',
        ),
        priority: 'medium',
      });
      tips.push({
        key: 'check-coolant',
        text: t(
          'drivetrain.tips.checkCoolant',
          'Schedule a service appointment to inspect the coolant system and fluid levels.',
        ),
        priority: 'medium',
      });
      tips.push({
        key: 'avoid-supercharging',
        text: t(
          'drivetrain.tips.avoidSupercharging',
          'Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.',
        ),
        priority: 'medium',
      });
    }

    tips.push({
      key: 'regular-service',
      text: t(
        'drivetrain.tips.regularService',
        'Keep up with regular service intervals for optimal drivetrain health and longevity.',
      ),
      priority: 'low',
    });
    tips.push({
      key: 'gentle-accel',
      text: t(
        'drivetrain.tips.gentleAccel',
        'Gentle acceleration helps maintain lower motor temperatures and extends component life.',
      ),
      priority: 'low',
    });
    tips.push({
      key: 'precondition',
      text: t(
        'drivetrain.tips.precondition',
        'Precondition the battery in cold weather for better thermal performance and driving efficiency.',
      ),
      priority: 'low',
    });
    tips.push({
      key: 'monitor-temps',
      text: t(
        'drivetrain.tips.monitorTemps',
        'Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.',
      ),
      priority: 'low',
    });

    return tips;
  }, [overallHealth, t]);

  /* ---- Display helpers ---- */
  const displayTemp = (celsius: number | null): string => {
    if (celsius === null) return '—';
    return fmtTemp(celsius);
  };

  /* ---------------------------------------------------------------- */
  /*  Render                                                          */
  /* ---------------------------------------------------------------- */

  return (
    <PageContainer
      title={t('drivetrain.title', 'Drivetrain Health')}
      subtitle={t(
        'drivetrain.subtitle',
        'Motor, inverter, and battery thermal status',
      )}
      loading={healthLoading}
      error={healthError as Error | null}
      empty={!health}
      emptyMessage={t('drivetrain.empty', 'No drivetrain data available.')}
      actions={
        vehicleOptions.length > 0 ? (
          <Select
            value={String(vehicleId ?? '')}
            onChange={(e) =>
              setSelectedVehicle(
                e.target.value ? Number(e.target.value) : null,
              )
            }
            options={[
              {
                value: '',
                label: t('drivetrain.allVehicles', 'All Vehicles'),
              },
              ...vehicleOptions,
            ]}
          />
        ) : undefined
      }
    >
      {health && (
        <>
          {/* ═══ Section 5: Alert banner for warning / critical ═══ */}
          {overallHealth !== 'good' && (
            <FadeIn>
              <AlertBanner
                variant={getAlertVariant(overallHealth)}
                title={
                  overallHealth === 'critical'
                    ? t(
                        'drivetrain.alert.criticalTitle',
                        'Critical Temperature Warning',
                      )
                    : t(
                        'drivetrain.alert.warningTitle',
                        'Elevated Temperatures Detected',
                      )
                }
                icon={<AlertTriangle className="h-4 w-4" />}
              >
                {overallHealth === 'critical'
                  ? t(
                      'drivetrain.alert.criticalMsg',
                      'One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.',
                    )
                  : t(
                      'drivetrain.alert.warningMsg',
                      'Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.',
                    )}
              </AlertBanner>
            </FadeIn>
          )}

          {/* ═══ Section 1: Health status overview ═══ */}
          <FadeIn>
            <GlassPanel
              glow={HEALTH_GLOW[overallHealth]}
              className="p-6"
            >
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-4">
                  {overallHealth === 'good' ? (
                    <CheckCircle
                      className="h-10 w-10 shrink-0"
                      style={{ color: healthColor }}
                    />
                  ) : (
                    <AlertTriangle
                      className="h-10 w-10 shrink-0"
                      style={{ color: healthColor }}
                    />
                  )}
                  <div>
                    <h2 className="text-xl font-semibold text-[var(--text-primary)]">
                      {overallHealth === 'good'
                        ? t(
                            'drivetrain.healthGood',
                            'Drivetrain Healthy',
                          )
                        : overallHealth === 'warning'
                          ? t(
                              'drivetrain.healthWarn',
                              'Drivetrain Running Warm',
                            )
                          : t(
                              'drivetrain.healthCrit',
                              'Drivetrain Overheating',
                            )}
                    </h2>
                    <p className="text-sm text-[var(--text-muted)]">
                      {t('drivetrain.motorState', 'Motor State')}:{' '}
                      {health.motorStatus}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant={healthBadgeVariant(overallHealth)}
                    size="lg"
                    dot
                  >
                    {t(
                      `drivetrain.health.${overallHealth}`,
                      overallHealth.toUpperCase(),
                    )}
                  </Badge>
                  <span
                    className="text-2xl font-bold"
                    style={{ color: healthColor }}
                  >
                    <AnimatedNumber value={healthScore} suffix="%" />
                  </span>
                </div>
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ═══ Section 8 + 4: Health gauge · Motor status · Stats ═══ */}
          <FadeIn delay={0.1}>
            <Grid cols={{ default: 1, md: 3 }} gap={4}>
              {/* Health score gauge */}
              <GlassPanel className="flex flex-col items-center justify-center p-6">
                <RadialGauge
                  value={healthScore}
                  max={100}
                  label={t('drivetrain.healthScore', 'Health Score')}
                  unit="%"
                  color={healthColor}
                  size={140}
                />
                <p className="mt-3 text-center text-xs text-[var(--text-muted)]">
                  {t(
                    'drivetrain.healthScoreDesc',
                    'Overall drivetrain condition rating',
                  )}
                </p>
              </GlassPanel>

              {/* Motor status card */}
              <GlassPanel className="p-6">
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t('drivetrain.motorDetails', 'Motor Details')}
                </h3>
                <KVList
                  items={[
                    {
                      label: t('drivetrain.motorStatus', 'Motor Status'),
                      value: health.motorStatus,
                    },
                    {
                      label: t('drivetrain.overallHealth', 'Overall Health'),
                      value:
                        overallHealth.charAt(0).toUpperCase() +
                        overallHealth.slice(1),
                    },
                    {
                      label: t(
                        'drivetrain.healthScoreLabel',
                        'Health Score',
                      ),
                      value: `${healthScore}%`,
                    },
                    {
                      label: t(
                        'drivetrain.sensorCount',
                        'Active Sensors',
                      ),
                      value: String(
                        sensors.filter((s) => s.value !== null).length,
                      ),
                    },
                  ]}
                />
                <div className="mt-4 flex items-center gap-2">
                  <Activity className="h-4 w-4 text-[var(--text-muted)]" />
                  <span className="text-xs text-[var(--text-muted)]">
                    {t(
                      'drivetrain.realTime',
                      'Real-time telemetry active',
                    )}
                  </span>
                </div>
              </GlassPanel>

              {/* Drive statistics summary */}
              <GlassPanel className="p-6">
                <h3 className="mb-3 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t('drivetrain.driveStats', 'Drive Statistics')}
                </h3>
                {stats ? (
                  <KVList
                    items={[
                      {
                        label: t('drivetrain.totalDrives', 'Total Drives'),
                        value: fmtInt(stats.totalDrives),
                      },
                      {
                        label: t(
                          'drivetrain.totalDistance',
                          'Total Distance',
                        ),
                        value: `${fmtInt(convertDistance(stats.totalDistanceKm))} ${distanceUnit}`,
                      },
                      {
                        label: t('drivetrain.avgSpeed', 'Avg Speed'),
                        value: `${fmtNumber(convertSpeed(stats.avgSpeedKmh), 1)} ${speedUnit}`,
                      },
                      {
                        label: t('drivetrain.topSpeed', 'Top Speed'),
                        value: `${fmtNumber(convertSpeed(stats.topSpeedKmh), 1)} ${speedUnit}`,
                      },
                    ]}
                  />
                ) : (
                  <Skeleton lines={4} />
                )}
              </GlassPanel>
            </Grid>
          </FadeIn>

          {/* ═══ Section 2: Temperature gauges ═══ */}
          <FadeIn delay={0.15}>
            <GlassPanel className="p-6">
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
                <Thermometer className="mr-2 inline-block h-4 w-4" />
                {t('drivetrain.tempGauges', 'Temperature Gauges')}
              </h3>
              <Grid cols={{ default: 2, md: 4 }} gap={6}>
                {sensors.map((sensor) => (
                  <div
                    key={sensor.key}
                    className="flex flex-col items-center"
                  >
                    <RadialGauge
                      value={
                        sensor.value !== null
                          ? convertTemp(sensor.value)
                          : 0
                      }
                      max={convertTemp(sensor.maxTemp)}
                      label={t(sensor.labelKey, sensor.defaultLabel)}
                      unit={tempUnit}
                      color={tempSeverityColor(
                        sensor.value,
                        sensor.maxTemp,
                      )}
                    />
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {t('drivetrain.maxLabel', 'Max')}:{' '}
                      {fmtNumber(convertTemp(sensor.maxTemp), 0)}
                      {tempUnit}
                    </p>
                  </div>
                ))}
              </Grid>
            </GlassPanel>
          </FadeIn>

          {/* ═══ Section 3: Temperature metric cards ═══ */}
          <StaggerContainer className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {sensors.map((sensor) => (
              <StaggerItem key={sensor.key}>
                <MetricCard
                  label={t(sensor.labelKey, sensor.defaultLabel)}
                  value={displayTemp(sensor.value)}
                  icon={sensor.icon}
                  color={tempNeonColor(sensor.value, sensor.maxTemp)}
                  subtitle={
                    sensor.value !== null
                      ? `${fmtNumber((sensor.value / sensor.maxTemp) * 100, 0)}% ${t('drivetrain.ofMax', 'of max')}`
                      : t('drivetrain.noData', 'No data')
                  }
                />
              </StaggerItem>
            ))}
            <StaggerItem>
              <MetricCard
                label={t('drivetrain.healthScore', 'Health Score')}
                value={`${healthScore}%`}
                icon={<Heart className="h-4 w-4" />}
                color={
                  overallHealth === 'good'
                    ? 'green'
                    : overallHealth === 'warning'
                      ? 'amber'
                      : 'red'
                }
              />
            </StaggerItem>
            <StaggerItem>
              <MetricCard
                label={t('drivetrain.peakPower', 'Peak Power')}
                value={
                  peakPower > 0 ? `${fmtInt(peakPower)} kW` : '—'
                }
                icon={<Zap className="h-4 w-4" />}
                color="purple"
              />
            </StaggerItem>
          </StaggerContainer>

          {/* ═══ Section 10: Drivetrain thermal metrics ═══ */}
          <FadeIn delay={0.2}>
            <GlassPanel className="p-6">
              <h3 className="mb-4 text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
                <Activity className="mr-2 inline-block h-4 w-4" />
                {t(
                  'drivetrain.thermalMetrics',
                  'Thermal Load Indicators',
                )}
              </h3>
              <div className="space-y-4">
                {sensors.map((sensor) => (
                  <MetricBar
                    key={sensor.key}
                    label={t(sensor.labelKey, sensor.defaultLabel)}
                    value={sensor.value ?? 0}
                    max={sensor.maxTemp}
                    color={tempSeverityColor(
                      sensor.value,
                      sensor.maxTemp,
                    )}
                    sublabel={displayTemp(sensor.value)}
                  />
                ))}
              </div>

              {/* Power inline metrics */}
              <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <InlineMetric
                  icon={
                    <Zap className="h-4 w-4 text-purple-400" />
                  }
                  label={t('drivetrain.peakPower', 'Peak Power')}
                  value={
                    peakPower > 0
                      ? `${fmtInt(peakPower)} kW`
                      : '—'
                  }
                />
                <InlineMetric
                  icon={
                    <TrendingUp className="h-4 w-4 text-cyan-400" />
                  }
                  label={t('drivetrain.avgPower', 'Avg Power')}
                  value={
                    avgPowerMax > 0
                      ? `${fmtNumber(avgPowerMax, 1)} kW`
                      : '—'
                  }
                />
                <InlineMetric
                  icon={
                    <Activity className="h-4 w-4 text-green-400" />
                  }
                  label={t('drivetrain.drivesLabel', 'Drives')}
                  value={stats ? fmtInt(stats.totalDrives) : '—'}
                />
                <InlineMetric
                  icon={
                    <Shield className="h-4 w-4 text-amber-400" />
                  }
                  label={t('drivetrain.regenRatio', 'Regen Ratio')}
                  value={
                    stats
                      ? `${fmtNumber(stats.regenRatio * 100, 1)}%`
                      : '—'
                  }
                />
              </div>
            </GlassPanel>
          </FadeIn>

          {/* ═══ Section 6: Historical temperature chart ═══ */}
          {tempTrendData.length > 1 && (
            <FadeIn delay={0.25}>
              <ChartContainer
                title={t(
                  'drivetrain.tempHistory',
                  'Temperature Trend',
                )}
                subtitle={t(
                  'drivetrain.tempHistorySub',
                  'Outside temperature recorded during recent drives',
                )}
                height={300}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={tempTrendData}>
                    <defs>
                      <ChartGradient
                        id="dtTempGrad"
                        color="#06b6d4"
                      />
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.4}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{
                        fill: 'var(--text-muted)',
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      tick={{
                        fill: 'var(--text-muted)',
                        fontSize: 10,
                      }}
                      label={{
                        value: tempUnit,
                        angle: -90,
                        position: 'insideLeft',
                        style: {
                          fill: 'var(--text-muted)',
                          fontSize: 11,
                        },
                      }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="outsideTemp"
                      name={t(
                        'drivetrain.outsideTemp',
                        'Outside Temp',
                      )}
                      stroke="#06b6d4"
                      strokeWidth={2}
                      dot={{ r: 3, fill: '#06b6d4' }}
                      connectNulls
                    />
                    <ReferenceLine
                      y={convertTemp(35)}
                      stroke="#f59e0b"
                      strokeDasharray="4 4"
                      label={{
                        value: t(
                          'drivetrain.warmZone',
                          'Warm Zone',
                        ),
                        fill: '#f59e0b',
                        fontSize: 10,
                      }}
                    />
                    <ReferenceLine
                      y={convertTemp(0)}
                      stroke="#06b6d4"
                      strokeDasharray="4 4"
                      label={{
                        value: t(
                          'drivetrain.freezing',
                          'Freezing',
                        ),
                        fill: '#06b6d4',
                        fontSize: 10,
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}

          {/* ═══ Section 7: Power output chart ═══ */}
          {chartData.length > 1 && (
            <FadeIn delay={0.3}>
              <ChartContainer
                title={t(
                  'drivetrain.powerOutput',
                  'Power Output History',
                )}
                subtitle={t(
                  'drivetrain.powerOutputSub',
                  'Peak and regen power per drive over time',
                )}
                height={300}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData}>
                    <defs>
                      <ChartGradient
                        id="dtPwrMaxGrad"
                        color="#8b5cf6"
                      />
                      <ChartGradient
                        id="dtPwrMinGrad"
                        color="#ef4444"
                      />
                    </defs>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      stroke="var(--glass-border)"
                      strokeOpacity={0.4}
                    />
                    <XAxis
                      dataKey="date"
                      tick={{
                        fill: 'var(--text-muted)',
                        fontSize: 10,
                      }}
                    />
                    <YAxis
                      tick={{
                        fill: 'var(--text-muted)',
                        fontSize: 10,
                      }}
                      label={{
                        value: 'kW',
                        angle: -90,
                        position: 'insideLeft',
                        style: {
                          fill: 'var(--text-muted)',
                          fontSize: 11,
                        },
                      }}
                    />
                    <Tooltip content={<ChartTooltip />} />
                    <Legend />
                    <Area
                      type="monotone"
                      dataKey="powerMax"
                      name={t(
                        'drivetrain.powerMax',
                        'Peak Power (kW)',
                      )}
                      stroke="#8b5cf6"
                      fill="url(#dtPwrMaxGrad)"
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="powerMin"
                      name={t(
                        'drivetrain.powerMin',
                        'Regen Power (kW)',
                      )}
                      stroke="#ef4444"
                      fill="url(#dtPwrMinGrad)"
                      strokeWidth={2}
                    />
                    <ReferenceLine
                      y={0}
                      stroke="#64748b"
                      strokeDasharray="2 2"
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </ChartContainer>
            </FadeIn>
          )}

          {/* ═══ Section 11: Health recommendations ═══ */}
          <FadeIn delay={0.35}>
            <GlassPanel className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <Shield className="h-5 w-5 text-neon-cyan" />
                <h3 className="text-sm font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  {t(
                    'drivetrain.recommendations',
                    'Health Recommendations',
                  )}
                </h3>
              </div>
              <StaggerContainer className="space-y-3">
                {recommendations.map((tip) => (
                  <StaggerItem key={tip.key}>
                    <div
                      className={cn(
                        'flex items-start gap-3 rounded-lg border px-4 py-3',
                        tip.priority === 'high'
                          ? 'border-neon-red/20 bg-neon-red/5'
                          : tip.priority === 'medium'
                            ? 'border-neon-amber/20 bg-neon-amber/5'
                            : 'border-white/5 bg-white/[0.02]',
                      )}
                    >
                      {tip.priority === 'high' ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neon-red" />
                      ) : tip.priority === 'medium' ? (
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-neon-amber" />
                      ) : (
                        <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-neon-cyan" />
                      )}
                      <p className="text-sm text-[var(--text-secondary)]">
                        {tip.text}
                      </p>
                    </div>
                  </StaggerItem>
                ))}
              </StaggerContainer>
            </GlassPanel>
          </FadeIn>

          {/* ═══ Detail cards: Temperatures + Power summary ═══ */}
          <FadeIn delay={0.4}>
            <Grid cols={{ default: 1, md: 2 }} gap={4}>
              <Card>
                <CardHeader
                  title={t(
                    'drivetrain.temperatures',
                    'Temperature Details',
                  )}
                />
                <KVList
                  items={[
                    {
                      label: t(
                        'drivetrain.frontMotorTemp',
                        'Front Motor Temp',
                      ),
                      value: displayTemp(health.frontMotorTempC),
                    },
                    {
                      label: t(
                        'drivetrain.rearMotorTemp',
                        'Rear Motor Temp',
                      ),
                      value: displayTemp(health.rearMotorTempC),
                    },
                    {
                      label: t(
                        'drivetrain.inverterTemp',
                        'Inverter Temp',
                      ),
                      value: displayTemp(health.inverterTempC),
                    },
                    {
                      label: t(
                        'drivetrain.batteryTemp',
                        'Battery Temp',
                      ),
                      value: displayTemp(health.batteryTempC),
                    },
                  ]}
                />
              </Card>

              <Card>
                <CardHeader
                  title={t(
                    'drivetrain.powerSummary',
                    'Power Summary',
                  )}
                />
                <KVList
                  items={[
                    {
                      label: t(
                        'drivetrain.peakPowerLabel',
                        'Peak Power',
                      ),
                      value:
                        peakPower > 0
                          ? `${fmtInt(peakPower)} kW`
                          : '—',
                    },
                    {
                      label: t(
                        'drivetrain.avgPowerLabel',
                        'Avg Peak Power',
                      ),
                      value:
                        avgPowerMax > 0
                          ? `${fmtNumber(avgPowerMax, 1)} kW`
                          : '—',
                    },
                    {
                      label: t(
                        'drivetrain.maxRegenLabel',
                        'Max Regen',
                      ),
                      value:
                        minRegenPower < 0
                          ? `${fmtNumber(Math.abs(minRegenPower), 1)} kW`
                          : '—',
                    },
                    {
                      label: t(
                        'drivetrain.regenLabel',
                        'Total Regen',
                      ),
                      value: stats
                        ? `${fmtNumber(stats.totalRegenKwh, 1)} kWh`
                        : '—',
                    },
                    {
                      label: t(
                        'drivetrain.co2Label',
                        'CO₂ Saved',
                      ),
                      value: stats
                        ? `${fmtNumber(stats.co2SavedKg, 1)} kg`
                        : '—',
                    },
                  ]}
                />
              </Card>
            </Grid>
          </FadeIn>
        </>
      )}
    </PageContainer>
  );
}
