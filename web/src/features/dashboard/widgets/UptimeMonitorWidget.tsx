import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useSystemHealth } from '@/api/hooks/useAdmin';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

const SERVICE_KEYS = ['database', 'mqtt', 'tesla_api', 'fleet_telemetry'] as const;

type StatusKind = 'success' | 'warning' | 'danger' | 'unknown';

type TFn = (key: string, fallback: string) => string;

// Collapse any backend status string into a single visual kind. The health
// contract (ComponentStatus in @/types/admin) emits 'healthy'/'ok' for good,
// 'degraded'/'warning' for recoverable, a family of broken states
// ('unhealthy'/'offline'/'down'/'failed') for danger, and 'unknown' when a
// probe has never run. Anything unrecognised is treated as broken so a
// newly-added bad state fails safe (red) rather than silently reading healthy.
function classifyStatus(status: string): StatusKind {
  switch (status) {
    case 'ok':
    case 'healthy':
      return 'success';
    case 'degraded':
    case 'warning':
      return 'warning';
    case 'unknown':
      return 'unknown';
    default:
      return 'danger';
  }
}

const KIND_BADGE: Record<StatusKind, 'success' | 'warning' | 'danger' | 'neutral'> = {
  success: 'success',
  warning: 'warning',
  danger: 'danger',
  unknown: 'neutral',
};

const KIND_DOT: Record<StatusKind, string> = {
  success: 'bg-green-500 shadow-green-500/40',
  warning: 'bg-amber-400 shadow-amber-400/40',
  danger: 'bg-red-500 shadow-red-500/40',
  unknown: 'bg-gray-400 shadow-gray-400/40',
};

function kindLabel(kind: StatusKind, t: TFn): string {
  switch (kind) {
    case 'success':
      return t('widget.uptime.statusOk', 'OK');
    case 'warning':
      return t('widget.uptime.statusDegraded', 'Degraded');
    case 'unknown':
      return t('widget.uptime.statusUnknown', 'Unknown');
    default:
      return t('widget.uptime.statusDown', 'Down');
  }
}

function StatusDot({ kind }: { kind: StatusKind }) {
  // Decorative: the adjacent Badge conveys the same status as text, so hide the
  // dot from assistive tech to avoid a duplicate announcement.
  return (
    <span
      aria-hidden="true"
      className={`inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_6px] ${KIND_DOT[kind]}`}
    />
  );
}

interface ServiceRowProps {
  label: string;
  kind: StatusKind;
  statusLabel: string;
  failures: number;
  failuresLabel: string;
  lastError: string | null;
}

function ServiceRow({ label, kind, statusLabel, failures, failuresLabel, lastError }: ServiceRowProps) {
  return (
    <div className="flex items-center justify-between gap-2" title={lastError ?? undefined}>
      <div className="flex min-w-0 items-center gap-2">
        <StatusDot kind={kind} />
        <span className="truncate text-xs text-[var(--text-secondary)]">{label}</span>
      </div>
      <div className="flex flex-shrink-0 items-center gap-1.5">
        {failures > 0 && (
          <span
            role="img"
            aria-label={failuresLabel}
            className="text-2xs tabular-nums text-[var(--text-muted)]"
          >
            ×{failures}
          </span>
        )}
        <Badge variant={KIND_BADGE[kind]} className="text-2xs">
          {statusLabel}
        </Badge>
      </div>
    </div>
  );
}

export default function UptimeMonitorWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data, isLoading, error, isFetching, isStale, isError, dataUpdatedAt, refetch } = useSystemHealth();

  // Match the sibling system widgets (SystemHealthWidget / APIUsageWidget): a
  // single-column placement is "compact". The registered minSize is 1×2, so the
  // previous `cols === 1 && rows === 1` condition was unreachable and the compact
  // count never rendered — a 1-wide widget wrongly showed the full per-service
  // list crammed into one narrow column.
  const isCompact = size.cols <= 1;
  const isTall = size.rows >= 2;

  const services = useMemo(() => {
    const components = data?.components ?? {};
    return SERVICE_KEYS.map((key) => {
      const status = components[key]?.status ?? 'unhealthy';
      const kind = classifyStatus(status);
      const failures = components[key]?.consecutiveFailures ?? 0;
      return {
        key,
        label: t(
          `widget.uptime.${key}`,
          key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
        ),
        kind,
        statusLabel: kindLabel(kind, t),
        failures,
        failuresLabel: `${failures} ${t('widget.uptime.consecutiveFailures', 'consecutive failures')}`,
        lastError: components[key]?.lastError ?? null,
      };
    });
  }, [data, t]);

  const totalCount = services.length;
  const healthyCount = services.filter((s) => s.kind === 'success').length;
  const overallKind = classifyStatus(data?.status ?? 'unknown');
  const overallLabel =
    data?.status === 'healthy' ? t('widget.uptime.allOk', 'All OK') : kindLabel(overallKind, t);
  const summaryLabel = `${healthyCount}/${totalCount} ${t('widget.uptime.servicesHealthy', 'services healthy')}`;

  // Only replace the whole widget with a full-panel error on the INITIAL load
  // failure, when there is no cached health payload to fall back on. This widget
  // refetches on an interval, so once data is on screen a transient
  // background-refetch failure must not blank out otherwise-valid status — it is
  // surfaced through the freshness indicator's error state instead (WidgetShell
  // forwards `isError` to <DataFreshness>).
  const blockingError = !data && error ? String(error) : null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.uptime.title', 'Uptime Monitor')}
      icon={<Activity className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={blockingError}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={refetch}
    >
      {data ? (
        <div className="flex h-full flex-col gap-2">
          {/* Overall status badge */}
          <div className="flex items-center justify-between">
            <span className="text-2xs uppercase tracking-wider text-[var(--text-muted)]">
              {t('widget.uptime.overall', 'Overall')}
            </span>
            <Badge variant={KIND_BADGE[overallKind]}>{overallLabel}</Badge>
          </div>

          {isCompact ? (
            /* Compact: just the healthy/total count */
            <div className="flex flex-1 items-center justify-center">
              <span
                role="img"
                aria-label={summaryLabel}
                className="text-2xl font-bold tabular-nums text-[var(--text-primary)]"
              >
                {healthyCount}/{totalCount}
              </span>
            </div>
          ) : (
            /* Full: row per service */
            <div className="flex flex-col gap-2">
              {services.map((svc) => (
                <ServiceRow
                  key={svc.key}
                  label={svc.label}
                  kind={svc.kind}
                  statusLabel={svc.statusLabel}
                  failures={svc.failures}
                  failuresLabel={svc.failuresLabel}
                  lastError={svc.lastError}
                />
              ))}
            </div>
          )}

          {/* Extended detail in tall, non-compact mode */}
          {isTall && !isCompact && (
            <div className="mt-auto border-t border-white/[0.06] pt-2">
              <div className="flex items-center justify-between text-2xs text-[var(--text-muted)]">
                <span>{t('widget.uptime.dbSize', 'DB Size')}</span>
                <span className="text-[var(--text-secondary)]">{data.databaseSize || '—'}</span>
              </div>
              <div className="flex items-center justify-between text-2xs text-[var(--text-muted)]">
                <span>{t('widget.uptime.tables', 'Tables')}</span>
                <span className="text-[var(--text-secondary)]">{data.tableCount ?? '—'}</span>
              </div>
            </div>
          )}
        </div>
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Activity className="h-5 w-5" />}
          message={t('widget.uptime.noData', 'No system health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
