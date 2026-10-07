import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Server } from 'lucide-react';
import { StatusBadge, StatCard } from '@/components/data-display';
import { EmptyState } from '@/components/feedback';
import { useSystemHealth, useDBStats, useConnectionPool } from '@/api/hooks/useAdmin';
import { fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

type Translate = (key: string, fallback: string) => string;

/**
 * Normalised health tier. Collapses the open-ended backend status vocabulary
 * (`healthy`/`ok`/`degraded`/`warning`/`unhealthy`/`offline`/`down`/`failed`/
 * `unknown`/…) into the four visual tiers this widget renders. Keeping the
 * mapping here — instead of a raw-string → colour switch — means a recoverable
 * `warning` shares the amber `degraded` tier (rather than the alarming red
 * `down` tier), and a never-polled `unknown` component stays neutral grey.
 */
export type StatusTier = 'ok' | 'degraded' | 'unknown' | 'down';

const SERVICE_KEYS = [
  { key: 'database', i18n: 'db' },
  { key: 'mqtt', i18n: 'mqtt' },
  { key: 'tesla_api', i18n: 'teslaApi' },
  { key: 'fleet_telemetry', i18n: 'workers' },
] as const;

/**
 * Map a raw component status onto one of four visual tiers. Case-insensitive
 * and null-safe: a `null`/`undefined`/empty status carries no information, so
 * it is treated as neutral `unknown` (never an alarmist red), while any
 * unrecognised *non-empty* value degrades to `down`. Never throws.
 */
export function statusTier(status: string | null | undefined): StatusTier {
  switch ((status ?? '').toLowerCase()) {
    case 'ok':
    case 'healthy':
      return 'ok';
    case 'degraded':
    case 'warning':
      return 'degraded';
    case 'unknown':
    case '':
      return 'unknown';
    default:
      return 'down';
  }
}

const TIER_DOT: Record<StatusTier, string> = {
  ok: 'bg-green-500 shadow-green-500/40',
  degraded: 'bg-amber-400 shadow-amber-400/40',
  unknown: 'bg-gray-400 shadow-gray-400/40',
  down: 'bg-red-500 shadow-red-500/40',
};

const TIER_LABEL: Record<StatusTier, { key: string; fallback: string }> = {
  ok: { key: 'widget.systemHealth.statusOk', fallback: 'Healthy' },
  degraded: { key: 'widget.systemHealth.statusDegraded', fallback: 'Degraded' },
  unknown: { key: 'widget.systemHealth.statusUnknown', fallback: 'Unknown' },
  down: { key: 'widget.systemHealth.statusDown', fallback: 'Down' },
};

function tierLabel(tier: StatusTier, t: Translate): string {
  const meta = TIER_LABEL[tier];
  return t(meta.key, meta.fallback);
}

function StatusDot({ tier, label }: { tier: StatusTier; label: string }) {
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      className={`inline-block h-2.5 w-2.5 rounded-full shadow-[0_0_6px] ${TIER_DOT[tier]}`}
    />
  );
}

/** Human label for the overall system status shown in the compact layout. */
export function overallLabel(status: string, t: Translate): string {
  if (status === 'healthy') return t('widget.systemHealth.healthy', 'Healthy');
  if (status === 'degraded') return t('widget.systemHealth.degraded', 'Degraded');
  return t('widget.systemHealth.down', 'Down');
}

/** Map the overall system status onto a StatusBadge presence tone. */
export function overallBadgeStatus(status: string): 'online' | 'away' | 'offline' {
  if (status === 'healthy') return 'online';
  if (status === 'degraded') return 'away';
  return 'offline';
}

export default function SystemHealthWidget({ size }: WidgetProps) {
  const { t } = useTranslation('dashboard');

  const health = useSystemHealth();
  const dbStats = useDBStats();
  const pool = useConnectionPool();

  const isCompact = size.cols <= 1;

  const services = useMemo(() => {
    const components = health.data?.components ?? {};
    return SERVICE_KEYS.map((svc) => {
      const tier = statusTier(components[svc.key]?.status ?? 'unhealthy');
      const label = t(
        `widget.systemHealth.${svc.i18n}`,
        svc.key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      );
      return { key: svc.key, label, tier, a11yLabel: `${label}: ${tierLabel(tier, t)}` };
    });
  }, [health.data, t]);

  const overallStatus = health.data?.status ?? 'unknown';
  const healthyCount = services.filter((s) => s.tier === 'ok').length;

  // `||` (not `??`) so an empty-string databaseSize also degrades to the
  // placeholder instead of rendering a blank stat value.
  const dbSize = health.data?.databaseSize || dbStats.data?.databaseSize || '—';
  const activeConns = pool.data?.inUse ?? 0;
  const maxConns = pool.data?.maxOpen ?? 0;
  const runtime = pool.data as Record<string, unknown> | undefined;
  const goroutines = runtime?.goroutines;
  const memory = runtime?.memoryMB;

  const isLoading = health.isLoading;
  const hasError = health.error ? String(health.error) : null;
  const hasData = health.data != null;

  return (
    <WidgetShell
      title={isCompact ? undefined : t('widget.systemHealth.title', 'System Health')}
      icon={<Server className="h-3.5 w-3.5 text-neon-green" />}
      loading={isLoading}
      error={hasError}
      updatedAt={health.dataUpdatedAt}
      isFetching={health.isFetching}
      isStale={health.isStale}
      isError={health.isError}
      onRefresh={() => health.refetch()}
    >
      {hasData ? (
        isCompact ? (
          /* ── Compact layout (1×2) ── */
          <div className="flex flex-col items-center justify-center gap-2 h-full min-h-[44px]">
            <StatusBadge status={overallBadgeStatus(overallStatus)} size="sm" />
            <span className="text-sm font-semibold text-[var(--text-primary)] truncate">
              {overallLabel(overallStatus, t)}
            </span>
            <span className="text-xs text-[var(--text-secondary)]">
              {healthyCount}/{services.length} {t('widget.systemHealth.services', 'services')}
            </span>
          </div>
        ) : (
          /* ── Standard layout (2×4) ── */
          <div className="flex flex-col gap-3 h-full">
            {/* Service status grid */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-2">
              {services.map((svc) => (
                <div key={svc.key} className="flex items-center gap-2 min-h-[44px]">
                  <StatusDot tier={svc.tier} label={svc.a11yLabel} />
                  <span className="text-xs text-[var(--text-secondary)] truncate">{svc.label}</span>
                </div>
              ))}
            </div>

            {/* Stats grid */}
            <div className="grid grid-cols-2 gap-2 mt-auto">
              <StatCard
                label={t('widget.systemHealth.dbSize', 'DB Size')}
                value={dbSize}
              />
              <StatCard
                label={t('widget.systemHealth.activeConns', 'Active Conns')}
                value={maxConns > 0 ? `${fmtInt(activeConns)}/${fmtInt(maxConns)}` : fmtInt(activeConns)}
              />
              <StatCard
                label={t('widget.systemHealth.memory', 'Memory')}
                value={memory != null ? `${fmtInt(memory)} MB` : '—'}
              />
              <StatCard
                label={t('widget.systemHealth.goroutines', 'Goroutines')}
                value={goroutines != null ? fmtInt(goroutines) : '—'}
              />
            </div>
          </div>
        )
      ) : (
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
          icon={<Server className="h-5 w-5" />}
          message={t('widget.systemHealth.noData', 'No system health data')}
          className="py-4"
        />
      )}
    </WidgetShell>
  );
}
