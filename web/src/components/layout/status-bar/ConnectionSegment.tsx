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
import { Button, PanelTitle, Popover, Text, Tooltip } from '@/components/ui/runtime';
import { useApiHealth, type ApiHealthStatus } from '@/api/hooks/useApiHealth';
import { useExtendedSystemHealth } from '@/api/hooks/useAdmin';
import { useRbacMatrix } from '@/api/hooks/useRbacMatrix';
import { cn } from '@/lib/cn';
import { Icon } from '@/components/ui/Icon';
import { neonColorMap, severityTokens, typography } from '@/lib/tokens';
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
            'inline-flex min-w-0 items-center gap-1.5 rounded-shape-sm px-1.5 py-0.5',
            typography.size.xs,
            'hover:bg-[var(--control-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--focus-ring)]',
            presentation.tone,
          )}
        >
          {presentation.content}
        </PrefetchLink>
      </Tooltip>
    );
  }

  const components = health.data?.components;
  const database = components?.database;
  const pool = components?.database_pool;
  const telemetry = components?.telemetry_buffers;
  const stream = components?.fleet_telemetry ?? components?.mqtt;
  const dbLatency = readNumber(database, 'latency_ms');
  const activeConnections = readNumber(pool, 'acquired_conns');
  const driveBuffered = readNumber(telemetry, 'drive_buffered');
  const chargeBuffered = readNumber(telemetry, 'charge_buffered');
  const queueDepth = driveBuffered != null && chargeBuffered != null
    ? driveBuffered + chargeBuffered
    : null;
  const diagnosticStatusLabels: Record<string, string> = {
    healthy: t('statusBar.connectionDiagnostics.status.healthy', 'Healthy'),
    degraded: t('statusBar.connectionDiagnostics.status.degraded', 'Degraded'),
    unhealthy: t('statusBar.connectionDiagnostics.status.unhealthy', 'Unhealthy'),
    enabled: t('statusBar.connectionDiagnostics.status.enabled', 'Enabled'),
    disabled: t('statusBar.connectionDiagnostics.status.disabled', 'Disabled'),
  };
  const formatDiagnosticStatus = (value: string) =>
    diagnosticStatusLabels[value] ?? value;
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
      ? severityTokens.success.fg
      : healthStatus === 'degraded'
        ? severityTokens.warn.fg
        : healthStatus === 'unhealthy'
          ? severityTokens.critical.fg
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
            'h-auto min-h-5 min-w-0 gap-1.5 rounded-shape-sm px-1.5 py-0',
            typography.size.xs,
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
        className="w-connection-diagnostics p-3"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border-subtle)] pb-2">
          <PanelTitle>
            {t('statusBar.connectionDiagnostics.title', 'Connection diagnostics')}
          </PanelTitle>
          <Text
            as="span"
            size="xs"
            color="muted"
            className={healthStatusTone}
          >
            {healthStatusLabel}
          </Text>
        </div>

        {health.isError && (
          <Text as="p" size="sm" className={cn('py-3', severityTokens.critical.fg)}>
            {t(
              'statusBar.connectionDiagnostics.unavailable',
              'Diagnostics are temporarily unavailable.',
            )}
          </Text>
        )}
        {(!health.isError || health.data) && (
          <div className="space-y-2 py-3">
            <DiagnosticRow
              icon={<Icon icon={Database} size="sm" />}
              label={t('statusBar.connectionDiagnostics.database', 'Database latency')}
              value={dbLatency == null ? '—' : `${dbLatency}ms`}
            />
            <DiagnosticRow
              icon={<Icon icon={Gauge} size="sm" />}
              label={t('statusBar.connectionDiagnostics.pool', 'Active DB connections')}
              value={activeConnections == null ? '—' : String(activeConnections)}
            />
            <DiagnosticRow
              icon={<Icon icon={Radio} size="sm" />}
              label={t('statusBar.connectionDiagnostics.telemetry', 'Telemetry stream')}
              value={streamStatus}
            />
            <DiagnosticRow
              icon={<Icon icon={Activity} size="sm" />}
              label={t('statusBar.connectionDiagnostics.queue', 'Buffered events')}
              value={queueDepth == null ? '—' : String(queueDepth)}
            />
          </div>
        )}

        <PrefetchLink
          to="/system-status"
          onClick={close}
          className={cn('inline-flex max-w-full break-words hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--focus-ring)]', typography.size.xs, typography.weight.medium, severityTokens.info.fg)}
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
      <Text as="span" size="xs" color="secondary" className="min-w-0 flex-1 break-words">
        {label}
      </Text>
      <Text as="span" size="xs" weight="medium" className="min-w-0 break-words tabular-nums">
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
    ok: { icon: Activity, text: severityTokens.success.fg, dot: severityTokens.success.dot, short },
    degraded: { icon: AlertTriangle, text: severityTokens.warn.fg, dot: severityTokens.warn.dot, short },
    offline: { icon: CircleSlash, text: neonColorMap.neutral.text, dot: neonColorMap.neutral.dot, short },
    unknown: { icon: HelpCircle, text: neonColorMap.neutral.text, dot: neonColorMap.neutral.dot, short },
  };
  // Defensive: an out-of-contract status (a bad cast or a future union member)
  // degrades to the neutral "unknown" variant instead of throwing on
  // `cfg[status].icon`. Every downstream lookup then uses this safe value.
  const status: ApiHealthStatus = rawStatus in cfg ? rawStatus : 'unknown';
  const v = cfg[status];

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
      <Icon icon={v.icon} size="xs" />
      {!iconOnly && (
        <>
          <Text size="xs" weight="medium" className="min-w-0 break-words">{v.short}</Text>
          {status !== 'offline' && status !== 'unknown' && latencyMs != null && (
            <Text size="xs" color="muted">· {latencyLabel}</Text>
          )}
          {status === 'offline' && (
            <Text size="xs" color="muted" className="min-w-0 break-words">· {stateLabel.offline}</Text>
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
          'inline-flex min-w-0 items-center gap-1.5 rounded-shape-sm px-1.5 py-0.5',
          typography.size.xs,
          'hover:bg-[var(--control-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-[var(--focus-ring)]',
          v.text,
        )}
      >
        {content}
      </PrefetchLink>
    </Tooltip>
  );
}
