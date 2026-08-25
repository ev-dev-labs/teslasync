import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Activity,
  AlertTriangle,
  CircleSlash,
  Database,
  Gauge,
  HelpCircle,
  Radio,
} from 'lucide-react';
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui';
import { useApiHealth, type ApiHealthStatus } from '@/api/hooks/useApiHealth';
import { useExtendedSystemHealth } from '@/api/hooks/useAdmin';
import { useRbacMatrix } from '@/api/hooks/useRbacMatrix';
import { cn } from '@/lib/cn';
import { PrefetchLink } from '../PrefetchLink';
import {
  useStatusBarAnnouncer,
  useStatusBarPopover,
} from './StatusBarContext';

/**
 * Footer status-bar API connection health segment.
 *
 * Footer status-bar segment that pings the backend `/healthz` endpoint and
 * surfaces the current API connection health (latency + ok/degraded/offline).
 * Color is paired with an icon so the state is also legible to users with
 * color-vision differences.
 */

interface ConnectionSegmentProps {
  iconOnly?: boolean;
  enableAdminDiagnostics?: boolean;
}

interface VariantConfig {
  icon: typeof Activity;
  text: string;
  dot: string;
  /** Short label, e.g. "API". Shown to the right of the icon when not iconOnly. */
  short: string;
}

interface ConnectionPresentation {
  ariaLabel: string;
  content: ReactNode;
  tooltip: ReactNode;
  tone: string;
}

function hasAdminAccess(data: ReturnType<typeof useRbacMatrix>['data']): boolean {
  if (!data || data.mode !== 'session') return false;
  return (
    data.my_roles.some((role) => role.toLowerCase() === 'admin') ||
    Object.entries(data.effective_for_me).some(
      ([permission, allowed]) => allowed && permission.startsWith('admin.'),
    )
  );
}

function readNumber(
  value: Record<string, unknown> | undefined,
  key: string,
): number | null {
  const candidate = value?.[key];
  return typeof candidate === 'number' && Number.isFinite(candidate)
    ? candidate
    : null;
}

function AdminConnectionControl({
  presentation,
}: {
  presentation: ConnectionPresentation;
}) {
  const { t } = useTranslation();
  const rbac = useRbacMatrix();
  const isAdmin = hasAdminAccess(rbac.data);
  const { open, toggle, close } = useStatusBarPopover('connection');
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const health = useExtendedSystemHealth({ enabled: isAdmin && open });

  if (!isAdmin) {
    return (
      <Tooltip content={presentation.tooltip} side="top">
        <PrefetchLink
          to="/system-status"
          aria-label={presentation.ariaLabel}
          className={cn(
            'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
            'hover:bg-[var(--control-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)]',
            presentation.tone,
          )}
        >
          {presentation.content}
        </PrefetchLink>
      </Tooltip>
    );
  }

  const components = health.data?.components ?? {};
  const database = components.database as Record<string, unknown> | undefined;
  const pool = components.database_pool as Record<string, unknown> | undefined;
  const telemetry = components.telemetry_buffers as Record<string, unknown> | undefined;
  const stream = (
    components.fleet_telemetry ??
    components.mqtt
  ) as Record<string, unknown> | undefined;
  const dbLatency = readNumber(database, 'latency_ms');
  const activeConnections = readNumber(pool, 'acquired_conns');
  const queueDepth = telemetry
    ? (readNumber(telemetry, 'drive_buffered') ?? 0) +
      (readNumber(telemetry, 'charge_buffered') ?? 0)
    : null;
  const diagnosticStatusLabels: Record<string, string> = {
    healthy: t('statusBar.connectionDiagnostics.status.healthy', 'Healthy'),
    degraded: t('statusBar.connectionDiagnostics.status.degraded', 'Degraded'),
    unhealthy: t('statusBar.connectionDiagnostics.status.unhealthy', 'Unhealthy'),
    enabled: t('statusBar.connectionDiagnostics.status.enabled', 'Enabled'),
    disabled: t('statusBar.connectionDiagnostics.status.disabled', 'Disabled'),
  };
  const formatDiagnosticStatus = (value: string) =>
    diagnosticStatusLabels[value] ??
    (value.charAt(0).toUpperCase() + value.slice(1));
  const streamStatus =
    typeof stream?.status === 'string'
      ? formatDiagnosticStatus(stream.status)
      : t('statusBar.connectionDiagnostics.unknown', 'Unknown');
  const healthStatus = health.data?.status;
  const healthStatusLabel = healthStatus
    ? formatDiagnosticStatus(healthStatus)
    : t('statusBar.connectionDiagnostics.checking', 'Checking');
  const healthStatusTone =
    healthStatus === 'healthy'
      ? 'text-emerald-300'
      : healthStatus === 'degraded'
        ? 'text-amber-300'
        : healthStatus === 'unhealthy'
          ? 'text-rose-300'
          : undefined;

  return (
    <>
      <Tooltip content={presentation.tooltip} side="top">
        <Button
          ref={triggerRef}
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`${presentation.ariaLabel}. ${t(
            'statusBar.connectionDiagnostics.open',
            'Open connection diagnostics',
          )}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          onClick={toggle}
          className={cn(
            'h-5 min-h-0 gap-1.5 rounded px-1.5 py-0 text-xs leading-none',
            presentation.tone,
          )}
        >
          {presentation.content}
        </Button>
      </Tooltip>

      <Popover
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        side="top"
        align="start"
        ariaLabel={t(
          'statusBar.connectionDiagnostics.title',
          'Connection diagnostics',
        )}
        className="w-[min(92vw,320px)] p-3"
      >
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
          <PanelTitle>
            {t('statusBar.connectionDiagnostics.title', 'Connection diagnostics')}
          </PanelTitle>
          <Text
            as="span"
            size="2xs"
            color="muted"
            className={healthStatusTone}
          >
            {healthStatusLabel}
          </Text>
        </div>

        {health.isError ? (
          <Text as="p" size="sm" color="secondary" className="py-3 text-rose-300">
            {t(
              'statusBar.connectionDiagnostics.unavailable',
              'Diagnostics are temporarily unavailable.',
            )}
          </Text>
        ) : (
          <div className="space-y-2 py-3">
            <DiagnosticRow
              icon={<Database className="h-3.5 w-3.5" aria-hidden />}
              label={t('statusBar.connectionDiagnostics.database', 'Database latency')}
              value={dbLatency == null ? '—' : `${dbLatency}ms`}
            />
            <DiagnosticRow
              icon={<Gauge className="h-3.5 w-3.5" aria-hidden />}
              label={t('statusBar.connectionDiagnostics.pool', 'Active DB connections')}
              value={activeConnections == null ? '—' : String(activeConnections)}
            />
            <DiagnosticRow
              icon={<Radio className="h-3.5 w-3.5" aria-hidden />}
              label={t('statusBar.connectionDiagnostics.telemetry', 'Telemetry stream')}
              value={streamStatus}
            />
            <DiagnosticRow
              icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
              label={t('statusBar.connectionDiagnostics.queue', 'Buffered events')}
              value={queueDepth == null ? '—' : String(queueDepth)}
            />
          </div>
        )}

        <PrefetchLink
          to="/system-status"
          onClick={close}
          className="inline-flex text-xs font-medium text-[var(--theme-primary)] hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-ring)]"
        >
          {t('statusBar.connectionDiagnostics.fullStatus', 'Open system status')}
        </PrefetchLink>
      </Popover>
    </>
  );
}

function DiagnosticRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-[var(--text-muted)]">{icon}</span>
      <Text as="span" size="xs" color="secondary" className="min-w-0 flex-1">
        {label}
      </Text>
      <Text as="span" size="xs" weight="semibold" className="tabular-nums">
        {value}
      </Text>
    </div>
  );
}

export function ConnectionSegment({
  iconOnly = false,
  enableAdminDiagnostics = false,
}: ConnectionSegmentProps) {
  const { t } = useTranslation();
  const { status: rawStatus, latencyMs } = useApiHealth();
  const announce = useStatusBarAnnouncer();

  const short = t('statusBar.connection.short', 'API');
  const cfg: Record<ApiHealthStatus, VariantConfig> = {
    ok: { icon: Activity, text: 'text-emerald-300', dot: 'bg-emerald-400', short },
    degraded: { icon: AlertTriangle, text: 'text-amber-300', dot: 'bg-amber-400', short },
    offline: { icon: CircleSlash, text: 'text-rose-300', dot: 'bg-rose-400', short },
    unknown: { icon: HelpCircle, text: 'text-[var(--text-muted)]', dot: 'bg-[var(--surface-2)]', short },
  };
  // Defensive: an out-of-contract status (a bad cast or a future union member)
  // degrades to the neutral "unknown" variant instead of throwing on
  // `cfg[status].icon`. Every downstream lookup then uses this safe value.
  const status: ApiHealthStatus = rawStatus in cfg ? rawStatus : 'unknown';
  const v = cfg[status];
  const Icon = v.icon;

  const stateLabel: Record<ApiHealthStatus, string> = {
    ok: t('statusBar.connection.ok', 'Online'),
    degraded: t('statusBar.connection.degraded', 'Degraded'),
    offline: t('statusBar.connection.offline', 'Offline'),
    unknown: t('statusBar.connection.unknown', 'Connecting…'),
  };
  const currentStateLabel = stateLabel[status];

  const latencyLabel = latencyMs != null ? `${latencyMs}ms` : '—';
  const tooltip = (
    <span>
      {t('statusBar.connection.tooltip', 'API connection')} · {currentStateLabel}
      {latencyMs != null && status !== 'offline' ? ` · ${latencyLabel}` : ''}
    </span>
  );

  const ariaLabel = `${t('statusBar.connection.aria', 'API connection status')}: ${currentStateLabel}${
    latencyMs != null && status !== 'offline' ? ` (${latencyLabel})` : ''
  }`;

  const previousStatus = useRef(status);
  useEffect(() => {
    if (previousStatus.current !== status) {
      announce?.(
        `${t('statusBar.connection.aria', 'API connection status')}: ${currentStateLabel}`,
      );
      previousStatus.current = status;
    }
  }, [announce, currentStateLabel, status, t]);

  const content = (
    <>
      <span
        className={cn('inline-block h-1.5 w-1.5 shrink-0 rounded-full', v.dot)}
        aria-hidden
      />
      <Icon className="h-3 w-3 shrink-0" aria-hidden />
      {!iconOnly && (
        <>
          <span className="font-medium">{v.short}</span>
          {status !== 'offline' && status !== 'unknown' && latencyMs != null && (
            <span className="text-[var(--text-muted)]">· {latencyLabel}</span>
          )}
          {status === 'offline' && (
            <span className="text-[var(--text-muted)]">· {stateLabel.offline}</span>
          )}
        </>
      )}
    </>
  );

  const presentation = { ariaLabel, content, tooltip, tone: v.text };

  if (enableAdminDiagnostics) {
    return <AdminConnectionControl presentation={presentation} />;
  }

  return (
    <Tooltip content={tooltip} side="top">
      <PrefetchLink
        to="/system-status"
        aria-label={ariaLabel}
        className={cn(
          'inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-xs leading-none',
          'hover:bg-[var(--control-bg)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--focus-ring)]',
          v.text,
        )}
      >
        {content}
      </PrefetchLink>
    </Tooltip>
  );
}
