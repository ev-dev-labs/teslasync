import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { fmtInt } from '@/lib/numberFormat';
import {
  Lock,
  Unlock,
  Eye,
  ShieldCheck,
  ShieldAlert,
  DoorClosed,
  DoorOpen,
  Home,
  UserCheck,
  AlertTriangle,
  Activity,
  Clock,
  BarChart3,
  Car,
  Flashlight,
  Lightbulb,
  Signal,
  Armchair,
  Key,
  Gauge,
  Wrench,
  Monitor,
  CircleDot,
  AlertCircle,
} from 'lucide-react';

import { PageContainer } from '@/components/layout/PageContainer';
import { GlassPanel } from '@/components/ui/GlassPanel';
import { Badge } from '@/components/ui/Badge';
import { Select } from '@/components/ui/Select';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { MetricCard } from '@/components/data-display/MetricCard';
import { Skeleton } from '@/components/feedback/Skeleton';
import { EmptyState } from '@/components/feedback/EmptyState';
import { AlertBanner } from '@/components/feedback/AlertBanner';
import { FadeIn } from '@/components/motion/FadeIn';
import { ChartTooltip } from '@/components/charts/ChartTooltip';
import { VehicleTwin } from '@/components/vehicles';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from '@/components/charts';

import { usePageTitle } from '@/hooks/usePageTitle';
import { useSecurityEvents } from '@/api/hooks/useAdmin';
import { getErrorMessage } from '@/lib/errorMessage';
import { buildTwinStateFromAdmin } from '@/lib/vehicleState';
import { request } from '@/api/client';
import { formatDateTime, formatDateShort } from '@/lib/dateFormat';
import type { SecurityEvent } from '@/types/admin';

/* ------------------------------------------------------------------ */
/*  Helper types                                                       */
/* ------------------------------------------------------------------ */

interface Vehicle {
  id: number;
  vin: string;
  display_name: string;
}

type WindowState = 'Closed' | 'Venting' | 'Open' | 'Unknown';

interface SentryDayBucket {
  date: string;
  sentryOn: number;
  sentryOff: number;
}

/* ------------------------------------------------------------------ */
/*  Pure helpers                                                        */
/* ------------------------------------------------------------------ */

function parseWindowState(val: string | null | undefined): WindowState {
  if (!val) return 'Unknown';
  const lower = val.toLowerCase();
  if (lower === 'closed' || lower === '0') return 'Closed';
  if (lower.includes('vent')) return 'Venting';
  if (lower.includes('open') || lower !== '0') return 'Open';
  return 'Unknown';
}

function windowColor(state: WindowState): string {
  switch (state) {
    case 'Closed':
      return 'bg-green-500/20 border-green-500/40';
    case 'Venting':
      return 'bg-amber-500/20 border-amber-500/40';
    case 'Open':
      return 'bg-red-500/20 border-red-500/40';
    default:
      return 'bg-gray-500/20 border-gray-500/40';
  }
}

function windowTextClass(state: WindowState): string {
  switch (state) {
    case 'Closed':
      return 'text-green-400';
    case 'Venting':
      return 'text-amber-400';
    case 'Open':
      return 'text-red-400';
    default:
      return 'text-gray-400';
  }
}

function doorClosed(state: string | null | undefined): boolean {
  if (!state) return true;
  const lower = state.trim().toLowerCase();
  if (lower === 'closed' || lower === 'closedall' || lower === '0' || lower === 'false') return true;
  // JSON compound: check if all door fields are false/absent
  if (lower.startsWith('{')) {
    try {
      const parsed = JSON.parse(state) as Record<string, unknown>;
      return Object.values(parsed).every((v) => v === false || v == null);
    } catch { /* fall through */ }
  }
  return false;
}

function timeSince(iso: string | null | undefined): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 0) return '—';
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/** Aggregate history into daily buckets for sentry chart */
function buildSentryBuckets(events: SecurityEvent[]): SentryDayBucket[] {
  const bucketMap = new Map<string, { on: number; off: number }>();

  for (const ev of events) {
    const dateKey = (ev.createdAt ?? '').slice(0, 10);
    const bucket = bucketMap.get(dateKey) ?? { on: 0, off: 0 };
    if (ev.sentryMode) {
      bucket.on += 1;
    } else {
      bucket.off += 1;
    }
    bucketMap.set(dateKey, bucket);
  }

  return Array.from(bucketMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, counts]) => ({
      date,
      sentryOn: counts.on,
      sentryOff: counts.off,
    }));
}

/** Compute sentry uptime percentage from events */
function computeSentryUptime(events: SecurityEvent[]): number {
  if (events.length === 0) return 0;
  const sentryOnCount = events.filter((e) => e.sentryMode).length;
  return (sentryOnCount / events.length) * 100;
}

/** Find the most recent lock-change event */
function findLastLockChange(events: SecurityEvent[]): string | undefined {
  for (let i = 1; i < events.length; i++) {
    if (events[i].locked !== events[i - 1].locked) {
      return events[i - 1].createdAt;
    }
  }
  return events[0]?.createdAt;
}

/** Summarize all four windows into a short label */
function windowSummary(ev: SecurityEvent | undefined): string {
  if (!ev) return '—';
  const states = [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow].map(parseWindowState);
  const allClosed = states.every((s) => s === 'Closed');
  if (allClosed) return 'All Closed';
  const openCount = states.filter((s) => s !== 'Closed').length;
  return `${openCount} Open/Venting`;
}

function allWindowsClosed(ev: SecurityEvent | undefined): boolean {
  if (!ev) return true;
  return [ev.fdWindow, ev.fpWindow, ev.rdWindow, ev.rpWindow]
    .map(parseWindowState)
    .every((s) => s === 'Closed');
}

/* ------------------------------------------------------------------ */
/*  Live state signal helpers                                          */
/* ------------------------------------------------------------------ */

interface LiveSignal {
  key: string;
  label: string;
  icon: React.ReactNode;
  value: string;
  active: boolean;
}

function boolLabel(val: boolean | null | undefined, t: (k: string, fb: string) => string): string {
  if (val == null) return '—';
  return val ? t('admin.security.on', 'On') : t('admin.security.off', 'Off');
}

function buildLiveSignals(ev: SecurityEvent | undefined, t: (k: string, fb: string) => string): LiveSignal[] {
  if (!ev) return [];
  return [
    {
      key: 'hazards',
      label: t('admin.security.live.hazards', 'Hazards'),
      icon: <Flashlight className="h-4 w-4" />,
      value: boolLabel(ev.lightsHazardsActive, t),
      active: !!ev.lightsHazardsActive,
    },
    {
      key: 'highBeams',
      label: t('admin.security.live.highBeams', 'High Beams'),
      icon: <Lightbulb className="h-4 w-4" />,
      value: boolLabel(ev.lightsHighBeams, t),
      active: !!ev.lightsHighBeams,
    },
    {
      key: 'turnSignal',
      label: t('admin.security.live.turnSignal', 'Turn Signal'),
      icon: <Signal className="h-4 w-4" />,
      value: ev.lightsTurnSignal ?? '—',
      active: !!ev.lightsTurnSignal && !ev.lightsTurnSignal.toLowerCase().includes('off'),
    },
    {
      key: 'driverSeat',
      label: t('admin.security.live.driverSeat', 'Driver Seat'),
      icon: <Armchair className="h-4 w-4" />,
      value: ev.driverSeatOccupied == null ? '—' : ev.driverSeatOccupied ? t('admin.security.live.occupied', 'Occupied') : t('admin.security.live.empty', 'Empty'),
      active: !!ev.driverSeatOccupied,
    },
    {
      key: 'pairedKeys',
      label: t('admin.security.live.pairedKeys', 'Paired Keys'),
      icon: <Key className="h-4 w-4" />,
      value: ev.pairedPhoneKeyCount != null ? String(ev.pairedPhoneKeyCount) : '—',
      active: (ev.pairedPhoneKeyCount ?? 0) > 0,
    },
    {
      key: 'valetMode',
      label: t('admin.security.live.valetMode', 'Valet Mode'),
      icon: <Car className="h-4 w-4" />,
      value: boolLabel(ev.valetModeEnabled, t),
      active: !!ev.valetModeEnabled,
    },
    {
      key: 'serviceMode',
      label: t('admin.security.live.serviceMode', 'Service Mode'),
      icon: <Wrench className="h-4 w-4" />,
      value: boolLabel(ev.serviceMode, t),
      active: !!ev.serviceMode,
    },
    {
      key: 'speedLimit',
      label: t('admin.security.live.speedLimit', 'Speed Limit'),
      icon: <Gauge className="h-4 w-4" />,
      value: ev.speedLimitMode ?? '—',
      active: !!ev.speedLimitMode && !ev.speedLimitMode.toLowerCase().includes('off'),
    },
    {
      key: 'homelinkDevices',
      label: t('admin.security.live.homelinkDevices', 'HomeLink Devices'),
      icon: <Home className="h-4 w-4" />,
      value: ev.homelinkDeviceCount != null ? String(ev.homelinkDeviceCount) : '—',
      active: (ev.homelinkDeviceCount ?? 0) > 0,
    },
    {
      key: 'centerDisplay',
      label: t('admin.security.live.centerDisplay', 'Center Display'),
      icon: <Monitor className="h-4 w-4" />,
      value: ev.centerDisplay ?? '—',
      active: !!ev.centerDisplay && !ev.centerDisplay.toLowerCase().includes('off'),
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Security event timeline derivation                                 */
/* ------------------------------------------------------------------ */

interface TimelineEvent {
  id: string;
  title: string;
  subtitle: string;
  timestamp: string;
  variant: 'positive' | 'negative' | 'neutral';
}

function deriveTimeline(events: SecurityEvent[]): TimelineEvent[] {
  if (events.length === 0) return [];

  const sorted = [...events].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );

  const timeline: TimelineEvent[] = [];

  for (let i = 0; i < sorted.length - 1; i++) {
    const curr = sorted[i];
    const prev = sorted[i + 1];

    if (curr.locked !== prev.locked) {
      timeline.push({
        id: `lock-${curr.id}`,
        title: curr.locked ? 'Vehicle Locked' : 'Vehicle Unlocked',
        subtitle: curr.locked ? 'Doors secured' : 'Doors accessible',
        timestamp: curr.createdAt,
        variant: curr.locked ? 'positive' : 'negative',
      });
    }

    if (curr.sentryMode !== prev.sentryMode) {
      timeline.push({
        id: `sentry-${curr.id}`,
        title: curr.sentryMode ? 'Sentry Mode Activated' : 'Sentry Mode Deactivated',
        subtitle: curr.sentryMode ? 'Camera surveillance enabled' : 'Camera surveillance disabled',
        timestamp: curr.createdAt,
        variant: curr.sentryMode ? 'positive' : 'negative',
      });
    }

    if (curr.doorState !== prev.doorState) {
      const closed = doorClosed(curr.doorState);
      timeline.push({
        id: `door-${curr.id}`,
        title: closed ? 'Doors Closed' : 'Door Opened',
        subtitle: curr.doorState ?? '—',
        timestamp: curr.createdAt,
        variant: closed ? 'positive' : 'negative',
      });
    }

    if (timeline.length >= 50) break;
  }

  return timeline.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function SecurityAccessPage() {
  const { t } = useTranslation();
  usePageTitle(t('admin.security.title', 'Security & Access'));

  /* ---- Vehicle list ---- */
  const { data: vehicles, error: vehiclesError } = useQuery({
    queryKey: ['vehicles'],
    queryFn: () => request<Vehicle[]>('/vehicles'),
  });

  const [vehicleId, setVehicleId] = useState<string>('');
  const activeId = vehicleId || String(vehicles?.[0]?.id ?? '');

  /* ---- Latest security state (polled) ---- */
  const { data: latest, isLoading: loadingLatest, error: latestError } = useQuery({
    queryKey: ['security-latest', activeId],
    queryFn: () => request<SecurityEvent>(`/security/latest?vehicle_id=${activeId}`),
    enabled: !!activeId,
    refetchInterval: 5000,
  });

  /* ---- Security event history ---- */
  const { data: history = [], isLoading: loadingHistory, error: historyError } = useSecurityEvents(activeId);

  const anyError = [vehiclesError, latestError, historyError].find(Boolean);
  const isLoading = loadingLatest || loadingHistory;

  /* ---- Computed stats ---- */
  const isSecure = useMemo(() => {
    if (!latest) return true;
    return !!latest.locked && doorClosed(latest.doorState) && allWindowsClosed(latest);
  }, [latest]);

  const sentryUptime = useMemo(() => computeSentryUptime(history), [history]);

  const lastLockChange = useMemo(() => findLastLockChange(history), [history]);

  const sentryBuckets = useMemo(() => buildSentryBuckets(history), [history]);

  /* ---- Security aggregate statistics ---- */
  const securityStats = useMemo(() => {
    if (history.length === 0) return null;
    let lockEvents = 0;
    for (let i = 1; i < history.length; i++) {
      if (history[i].locked !== history[i - 1].locked) lockEvents++;
    }
    const doorOpenCount = history.filter((e) => !doorClosed(e.doorState)).length;
    const windowOpenCount = history.filter(
      (e) => !allWindowsClosed(e),
    ).length;
    const homelinkCount = history.filter((e) => e.homelinkNearby).length;
    const guestCount = history.filter((e) => e.guestMode).length;
    return { lockEvents, doorOpenCount, windowOpenCount, homelinkCount, guestCount, total: history.length };
  }, [history]);

  /* ---- Live vehicle state signals ---- */
  const liveSignals = useMemo(() => buildLiveSignals(latest, t), [latest, t]);

  /* ---- Digital Twin state ---- */
  const twinState = useMemo(() => buildTwinStateFromAdmin(latest), [latest]);

  /* ---- Security event timeline ---- */
  const timelineEvents = useMemo(() => deriveTimeline(history), [history]);

  /* ---- Vehicle selector options ---- */
  const vehicleOptions = useMemo(
    () =>
      (vehicles ?? []).map((v) => ({
        value: String(v.id),
        label: v.display_name || v.vin,
      })),
    [vehicles],
  );

  /* ---- DataTable columns ---- */
  const eventColumns: Column<SecurityEvent>[] = useMemo(
    () => [
      {
        key: 'createdAt',
        header: t('admin.security.col.time', 'Time'),
        sortable: true,
        render: (row) => (
          <span className="text-xs text-gray-400 whitespace-nowrap">
            {formatDateTime(row.createdAt)}
          </span>
        ),
      },
      {
        key: 'locked',
        header: t('admin.security.col.lock', 'Lock'),
        render: (row) => (
          <Badge variant={row.locked ? 'success' : 'danger'} size="sm">
            {row.locked ? t('admin.security.locked', 'Locked') : t('admin.security.unlocked', 'Unlocked')}
          </Badge>
        ),
      },
      {
        key: 'sentryMode',
        header: t('admin.security.col.sentry', 'Sentry'),
        render: (row) => (
          <Badge variant={row.sentryMode ? 'success' : 'neutral'} size="sm">
            {row.sentryMode ? t('admin.security.on', 'On') : t('admin.security.off', 'Off')}
          </Badge>
        ),
      },
      {
        key: 'doorState',
        header: t('admin.security.col.doors', 'Doors'),
        render: (row) => (
          <span
            className={cn(
              'text-sm',
              doorClosed(row.doorState) ? 'text-green-400' : 'text-amber-400',
            )}
          >
            {row.doorState || '—'}
          </span>
        ),
      },
      {
        key: 'windows',
        header: t('admin.security.col.windows', 'Windows'),
        render: (row) => {
          const closed = allWindowsClosed(row);
          return (
            <span className={cn('text-sm', closed ? 'text-green-400' : 'text-amber-400')}>
              {windowSummary(row)}
            </span>
          );
        },
      },
    ],
    [t],
  );

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  return (
    <PageContainer
      title={t('admin.security.title', 'Security & Access')}
      subtitle={t('admin.security.subtitle', 'Lock status, sentry mode, doors, and windows')}
      loading={isLoading}
      error={null}
      actions={
        vehicles && vehicles.length > 1 ? (
          <Select
            options={vehicleOptions}
            value={activeId}
            onChange={(e) => setVehicleId(e.target.value)}
          />
        ) : undefined
      }
    >
      {anyError && (
        <AlertBanner variant="danger" icon={<AlertCircle className="h-5 w-5" />}>
          {t('error.loadFailed', 'Failed to load data')}: {getErrorMessage(anyError)}
        </AlertBanner>
      )}

      {/* ---- Alert banner ---- */}
      {!isSecure && latest && (
        <FadeIn>
          <GlassPanel className="border-red-500/30 bg-red-500/5 mb-4">
            <div className="flex items-center gap-3 px-4 py-3">
              <AlertTriangle className="h-5 w-5 text-red-400 shrink-0" />
              <p className="text-red-400 text-sm font-semibold">
                {t(
                  'admin.security.alert',
                  '⚠ Vehicle may not be secure — check lock, door, and window status.',
                )}
              </p>
            </div>
          </GlassPanel>
        </FadeIn>
      )}

      {/* ---- Visual Digital Twin ---- */}
      {latest && (
        <FadeIn>
          <GlassPanel className="p-4 mb-6 flex items-center justify-center">
            <VehicleTwin {...twinState} size="sm" interactive />
          </GlassPanel>
        </FadeIn>
      )}

      {/* ---- Summary stats row (4 cards) ---- */}
      {loadingLatest ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} height={88} />
          ))}
        </div>
      ) : (
        <FadeIn>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <MetricCard
              label={t('admin.security.stat.status', 'Current Status')}
              value={isSecure ? t('admin.security.secure', 'Secure') : t('admin.security.unsecure', 'Unsecure')}
              icon={<ShieldCheck className="h-5 w-5" />}
              color={isSecure ? 'green' : 'red'}
            />
            <MetricCard
              label={t('admin.security.stat.lastLock', 'Last Lock Change')}
              value={timeSince(lastLockChange)}
              icon={<Clock className="h-5 w-5" />}
              color="cyan"
            />
            <MetricCard
              label={t('admin.security.stat.sentryUptime', 'Sentry Uptime')}
              value={`${fmtInt(sentryUptime)}%`}
              icon={<Activity className="h-5 w-5" />}
              color="blue"
            />
            <MetricCard
              label={t('admin.security.stat.totalEvents', 'Total Events')}
              value={history.length}
              icon={<BarChart3 className="h-5 w-5" />}
              color="purple"
            />
          </div>
        </FadeIn>
      )}

      {/* ---- Security Status Cards (3-col grid, 6 cards) ---- */}
      {loadingLatest ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} height={120} />
          ))}
        </div>
      ) : (
        <FadeIn delay={0.1}>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {/* Lock Status */}
            <GlassPanel className="p-4">
              <div className="flex items-center gap-3 mb-2">
                {latest?.locked ? (
                  <Lock className="h-6 w-6 text-green-400" />
                ) : (
                  <Unlock className="h-6 w-6 text-red-400" />
                )}
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('admin.security.card.lockStatus', 'Lock Status')}
                </h3>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  latest?.locked ? 'text-green-400' : 'text-red-400',
                )}
              >
                {latest?.locked
                  ? t('admin.security.locked', 'Locked')
                  : t('admin.security.unlocked', 'Unlocked')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.security.card.lockDesc', 'Vehicle lock state')}
              </p>
            </GlassPanel>

            {/* Sentry Mode */}
            <GlassPanel className="p-4">
              <div className="flex items-center gap-3 mb-2">
                {latest?.sentryMode ? (
                  <ShieldCheck className="h-6 w-6 text-blue-400" />
                ) : (
                  <ShieldAlert className="h-6 w-6 text-gray-500" />
                )}
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('admin.security.card.sentryMode', 'Sentry Mode')}
                </h3>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  latest?.sentryMode ? 'text-blue-400' : 'text-gray-500',
                )}
              >
                {latest?.sentryMode
                  ? t('admin.security.active', 'Active')
                  : t('admin.security.inactive', 'Inactive')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.security.card.sentryDesc', 'Camera surveillance system')}
              </p>
            </GlassPanel>

            {/* Doors */}
            <GlassPanel className="p-4">
              <div className="flex items-center gap-3 mb-2">
                {doorClosed(latest?.doorState) ? (
                  <DoorClosed className="h-6 w-6 text-green-400" />
                ) : (
                  <DoorOpen className="h-6 w-6 text-amber-400" />
                )}
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('admin.security.card.doors', 'Doors')}
                </h3>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  doorClosed(latest?.doorState) ? 'text-green-400' : 'text-amber-400',
                )}
              >
                {doorClosed(latest?.doorState)
                  ? t('admin.security.closed', 'Closed')
                  : (latest?.doorState ?? '—')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.security.card.doorsDesc', 'All vehicle doors')}
              </p>
            </GlassPanel>

            {/* Windows */}
            <GlassPanel className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <DoorClosed
                  className={cn(
                    'h-6 w-6',
                    allWindowsClosed(latest) ? 'text-green-400' : 'text-amber-400',
                  )}
                />
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('admin.security.card.windows', 'Windows')}
                </h3>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  allWindowsClosed(latest) ? 'text-green-400' : 'text-amber-400',
                )}
              >
                {windowSummary(latest)}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.security.card.windowsDesc', 'Window positions')}
              </p>
            </GlassPanel>

            {/* HomeLink */}
            <GlassPanel className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <Home
                  className={cn(
                    'h-6 w-6',
                    latest?.homelinkNearby ? 'text-purple-400' : 'text-gray-500',
                  )}
                />
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('admin.security.card.homelink', 'HomeLink')}
                </h3>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  latest?.homelinkNearby ? 'text-purple-400' : 'text-gray-500',
                )}
              >
                {latest?.homelinkNearby
                  ? t('admin.security.nearby', 'Nearby')
                  : t('admin.security.away', 'Away')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.security.card.homelinkDesc', 'Garage door opener')}
              </p>
            </GlassPanel>

            {/* Guest Mode */}
            <GlassPanel className="p-4">
              <div className="flex items-center gap-3 mb-2">
                <UserCheck
                  className={cn(
                    'h-6 w-6',
                    latest?.guestMode ? 'text-amber-400' : 'text-gray-500',
                  )}
                />
                <h3 className="text-sm font-semibold text-gray-200">
                  {t('admin.security.card.guestMode', 'Guest Mode')}
                </h3>
              </div>
              <p
                className={cn(
                  'text-2xl font-bold',
                  latest?.guestMode ? 'text-amber-400' : 'text-gray-500',
                )}
              >
                {latest?.guestMode
                  ? t('admin.security.enabled', 'Enabled')
                  : t('admin.security.disabled', 'Disabled')}
              </p>
              <p className="text-xs text-gray-500 mt-1">
                {t('admin.security.card.guestDesc', 'Temporary access mode')}
              </p>
            </GlassPanel>
          </div>
        </FadeIn>
      )}

      {/* ---- Window Status Detail (4 cards) ---- */}
      <FadeIn delay={0.15}>
        <h2 className="text-lg font-semibold text-gray-200 mb-3">
          {t('admin.security.windowDetail', 'Window Status Detail')}
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {(
            [
              {
                key: 'fdWindow' as const,
                label: t('admin.security.window.fd', 'Front Driver'),
              },
              {
                key: 'fpWindow' as const,
                label: t('admin.security.window.fp', 'Front Passenger'),
              },
              {
                key: 'rdWindow' as const,
                label: t('admin.security.window.rd', 'Rear Driver'),
              },
              {
                key: 'rpWindow' as const,
                label: t('admin.security.window.rp', 'Rear Passenger'),
              },
            ] as const
          ).map((win) => {
            const state = parseWindowState(latest?.[win.key]);
            return (
              <GlassPanel
                key={win.key}
                className={cn('p-4 border', windowColor(state))}
              >
                <p className="text-xs text-gray-400 mb-1">{win.label}</p>
                <p className={cn('text-xl font-bold', windowTextClass(state))}>
                  {t(`admin.security.windowState.${(state ?? '').toLowerCase()}`, state)}
                </p>
              </GlassPanel>
            );
          })}
        </div>
      </FadeIn>

      {/* ---- Live Vehicle State ---- */}
      <FadeIn delay={0.17}>
        <GlassPanel className="p-4 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-200">
              {t('admin.security.liveState', 'Live Vehicle State')}
            </h2>
            {latest && (
              <span className="flex items-center gap-1.5 text-xs text-green-400">
                <CircleDot className="h-3 w-3 animate-pulse" />
                {t('admin.security.live.indicator', 'Live')}
              </span>
            )}
          </div>
          {liveSignals.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
              {liveSignals.map((sig) => (
                <GlassPanel key={sig.key} className="p-3" hover>
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={cn(sig.active ? 'text-cyan-400' : 'text-gray-500')}>
                      {sig.icon}
                    </span>
                    <span className="text-[10px] font-medium text-gray-400 truncate">
                      {sig.label}
                    </span>
                  </div>
                  <span
                    className={cn(
                      'text-sm font-semibold block truncate',
                      sig.active ? 'text-white' : 'text-gray-500',
                    )}
                  >
                    {sig.value}
                  </span>
                </GlassPanel>
              ))}
            </div>
          ) : (
            <EmptyState message={t('admin.security.live.noData', 'No live state data available')} />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- Sentry Mode Chart ---- */}
      <FadeIn delay={0.2}>
        <GlassPanel className="p-4 mb-6">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            {t('admin.security.sentryChart', 'Sentry Mode Activity')}
          </h2>
          {sentryBuckets.length > 0 ? (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={sentryBuckets}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--glass-border)" strokeOpacity={0.4} />
                  <XAxis
                    dataKey="date"
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    tickFormatter={(val: string) => formatDateShort(val)}
                  />
                  <YAxis
                    tick={{ fill: 'var(--text-muted)', fontSize: 11 }}
                    allowDecimals={false}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: 12, color: 'var(--text-muted)' }}
                  />
                  <Bar
                    dataKey="sentryOn"
                    name={t('admin.security.chart.sentryOn', 'Sentry On')}
                    fill="#3b82f6"
                    radius={[4, 4, 0, 0]}
                    stackId="sentry"
                  />
                  <Bar
                    dataKey="sentryOff"
                    name={t('admin.security.chart.sentryOff', 'Sentry Off')}
                    fill="#6b7280"
                    radius={[4, 4, 0, 0]}
                    stackId="sentry"
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- Security Statistics ---- */}
      <FadeIn delay={0.25}>
        <GlassPanel className="p-4 mb-6">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            {t('admin.security.statsTitle', 'Security Statistics')}
          </h2>
          {loadingHistory ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {Array.from({ length: 7 }).map((_, i) => (
                <Skeleton key={i} height={80} />
              ))}
            </div>
          ) : securityStats ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              <MetricCard
                label={t('admin.security.stats.lockEvents', 'Lock/Unlock Events')}
                value={securityStats.lockEvents}
                icon={<Lock className="h-4 w-4" />}
                color="green"
              />
              <MetricCard
                label={t('admin.security.stats.sentryUptime', 'Sentry Uptime')}
                value={`${fmtInt(sentryUptime)}%`}
                icon={<Eye className="h-4 w-4" />}
                color="blue"
              />
              <MetricCard
                label={t('admin.security.stats.doorOpens', 'Door Open Events')}
                value={securityStats.doorOpenCount}
                icon={<DoorOpen className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('admin.security.stats.windowOpens', 'Window Open Events')}
                value={securityStats.windowOpenCount}
                icon={<Car className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('admin.security.stats.homelink', 'HomeLink Detections')}
                value={securityStats.homelinkCount}
                icon={<Home className="h-4 w-4" />}
                color="purple"
              />
              <MetricCard
                label={t('admin.security.stats.guestMode', 'Guest Mode Usage')}
                value={securityStats.guestCount}
                icon={<UserCheck className="h-4 w-4" />}
                color="amber"
              />
              <MetricCard
                label={t('admin.security.stats.totalEvents', 'Total Events')}
                value={securityStats.total}
                icon={<Activity className="h-4 w-4" />}
                color="cyan"
              />
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[var(--text-muted)]">
              <Activity className="h-8 w-8 opacity-20" />
              <p className="text-xs">{t('common.noData', 'No data available')}</p>
            </div>
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- Security Event History Table ---- */}
      <FadeIn delay={0.3}>
        <GlassPanel className="p-4">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            {t('admin.security.eventHistory', 'Security Event History')}
          </h2>
          {loadingHistory ? (
            <Skeleton lines={8} />
          ) : (
            <DataTable<SecurityEvent>
              columns={eventColumns}
              data={history}
              keyExtractor={(row) => row.id}
              emptyMessage={t(
                'admin.security.noEvents',
                'No security events recorded yet.',
              )}
              compact
              pagination={{ defaultPageSize: 50 }}
            />
          )}
        </GlassPanel>
      </FadeIn>

      {/* ---- Security Event Timeline ---- */}
      <FadeIn delay={0.35}>
        <GlassPanel className="p-4">
          <h2 className="text-lg font-semibold text-gray-200 mb-4">
            {t('admin.security.timeline', 'Security Event Timeline')}
          </h2>
          {timelineEvents.length > 0 ? (
            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {timelineEvents.map((ev) => (
                <div
                  key={ev.id}
                  className="flex items-start gap-3 rounded-lg bg-white/[0.02] p-3"
                >
                  <div
                    className={cn(
                      'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full',
                      ev.variant === 'positive'
                        ? 'bg-green-500/20 text-green-400'
                        : ev.variant === 'negative'
                          ? 'bg-red-500/20 text-red-400'
                          : 'bg-gray-500/20 text-gray-400',
                    )}
                  >
                    {ev.title.toLowerCase().includes('lock') ? (
                      ev.variant === 'positive' ? (
                        <Lock className="h-4 w-4" />
                      ) : (
                        <Unlock className="h-4 w-4" />
                      )
                    ) : ev.title.toLowerCase().includes('sentry') ? (
                      ev.variant === 'positive' ? (
                        <ShieldCheck className="h-4 w-4" />
                      ) : (
                        <ShieldAlert className="h-4 w-4" />
                      )
                    ) : ev.variant === 'positive' ? (
                      <DoorClosed className="h-4 w-4" />
                    ) : (
                      <DoorOpen className="h-4 w-4" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-200">
                      {t(`admin.security.timeline.${ev.id.split('-')[0]}.${ev.variant}`, ev.title)}
                    </p>
                    <p className="text-xs text-gray-500">{ev.subtitle}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 whitespace-nowrap shrink-0">
                    {formatDateTime(ev.timestamp)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState message={t('admin.security.timeline.noEvents', 'No state changes detected in the history.')} />
          )}
        </GlassPanel>
      </FadeIn>
    </PageContainer>
  );
}
