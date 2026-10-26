import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { FileSearch } from 'lucide-react';
import { EmptyState } from '@/components/feedback';
import { useAuditLogs, useSecurityEvents } from '@/api/hooks/useAdmin';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetDetailCard, WidgetBigNumber, type DetailEntry } from './shared';
import type { WidgetProps } from './types';
import { useDataState } from '@/hooks/useDataState';
import { combineDataStates, type DataState } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDateLabels } from '@/hooks/useDateLabels';

// ── Severity → visual mapping ────────────────────────────────────────

type Severity = 'info' | 'warning' | 'critical';

/** Minimal translate signature — structurally compatible with i18next's `t`. */
type TFn = (key: string, fallback: string) => string;

function inferAuditSeverity(action: string): Severity {
  const lower = (action ?? '').toLowerCase();
  if (lower.includes('delete') || lower.includes('revoke') || lower.includes('fail')) return 'critical';
  if (lower.includes('update') || lower.includes('change') || lower.includes('modify')) return 'warning';
  return 'info';
}

function inferSecuritySeverity(event: { locked: boolean | null; sentryMode: string | boolean | null }): Severity {
  if (event.locked === false) return 'critical';
  if (event.sentryMode === 'active' || event.sentryMode === true) return 'warning';
  return 'info';
}

function buildSecurityTitle(
  event: {
    locked: boolean | null;
    sentryMode: string | boolean | null;
    doorState: string | boolean | null;
    guestMode: boolean | null;
    valetModeEnabled: boolean | null;
  },
  t: TFn,
): string {
  const parts: string[] = [];
  if (event.locked != null) {
    parts.push(
      event.locked
        ? t('widget.securityLocked', 'Vehicle locked')
        : t('widget.securityUnlocked', 'Vehicle unlocked'),
    );
  }
  if (event.sentryMode) {
    const sentryLabel =
      typeof event.sentryMode === 'string' ? event.sentryMode : t('widget.securityOn', 'On');
    parts.push(`${t('widget.securitySentry', 'Sentry')}: ${sentryLabel}`);
  }
  if (event.doorState) {
    const doorLabel =
      typeof event.doorState === 'string' ? event.doorState : t('widget.securityDoorOpen', 'Open');
    parts.push(`${t('widget.securityDoor', 'Door')}: ${doorLabel}`);
  }
  if (event.guestMode != null) {
    parts.push(
      event.guestMode
        ? t('widget.securityGuestOn', 'Guest mode on')
        : t('widget.securityGuestOff', 'Guest mode off'),
    );
  }
  if (event.valetModeEnabled != null) {
    parts.push(
      event.valetModeEnabled
        ? t('widget.securityValetOn', 'Valet mode on')
        : t('widget.securityValetOff', 'Valet mode off'),
    );
  }
  return parts.length > 0 ? parts[0] : t('widget.auditSecurityEvent', 'Security event');
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  totalEvents24h,
  worstSeverity,
  t,
}: {
  totalEvents24h: number;
  worstSeverity: Severity;
  t: TFn;
}) {
  const { fmtInt } = useNumberFormatting();
  const badgeLabel = worstSeverity === 'critical'
    ? t('widget.auditCritical', 'Critical')
    : worstSeverity === 'warning'
      ? t('widget.auditWarning', 'Warning')
      : t('widget.auditInfo', 'Info');

  return (
    <WidgetBigNumber
      value={fmtInt(totalEvents24h)}
      label={t('widget.auditEvents24h', 'Events (24h)')}
      badge={{ text: badgeLabel, variant: worstSeverity === 'critical' ? 'error' : worstSeverity === 'warning' ? 'warning' : 'neutral' }}
    />
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function AuditLogWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDateShort, formatTime } = useDateFormat();
  const { formatRelativeDays } = useDateLabels();
  const vehiclesQuery = useVehicles();
  const vid = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id;
  const vidStr = Number.isSafeInteger(vid) && Number(vid) > 0 ? String(vid) : '';

  const auditQuery = useAuditLogs();
  const {
    data: auditLogs,
    isFetching: auditFetching,
    isStale: auditStale,
    isError: auditIsError,
    refetch: auditRefetch,
  } = auditQuery;

  const securityQuery = useSecurityEvents(vidStr);
  const {
    data: securityEvents,
    isFetching: secFetching,
    isStale: secStale,
    isError: secIsError,
    refetch: secRefetch,
  } = securityQuery;

  const isFetching = auditFetching || secFetching;
  const isStale = auditStale || secStale;
  const isError = auditIsError || secIsError;

  const isCompact = size.cols <= 1;

  const handleRefresh = useCallback(() => {
    auditRefetch();
    if (vidStr) secRefetch();
    if (vehicleId == null) void vehiclesQuery.refetch?.();
  }, [auditRefetch, secRefetch, vidStr, vehicleId, vehiclesQuery.refetch]);

  const auditState = useDataState(auditQuery, { provenance: 'historical' });
  const discoveryState = useDataState(vehiclesQuery);
  const securityState = useDataState(
    vidStr ? securityQuery : {
      ...vehiclesQuery,
      data: vehiclesQuery.data !== undefined ? [] : undefined,
    },
    { provenance: 'historical', unavailable: !vidStr && vehiclesQuery.data !== undefined },
  );
  const sourceStates: DataState<unknown>[] = [
    auditState,
    ...(vidStr || (vehicleId == null && vehiclesQuery.data === undefined) ? [securityState] : []),
  ];
  if (vehicleId == null && sourceStates.some((state) => state.hasData)) sourceStates.push(discoveryState);
  const dataState = {
    ...combineDataStates(sourceStates),
    data: { auditLogs, securityEvents },
    hasData: sourceStates.some((state) => state.hasData),
    retry: handleRefresh,
  };

  const formatRowTime = useCallback((timestamp: string): string => {
    const ms = new Date(timestamp).getTime();
    if (!Number.isFinite(ms)) return '—';
    const day = formatRelativeDays(timestamp);
    if (day === 'Today') return formatTime(timestamp);
    if (day === 'Yesterday') return day;
    return formatDateShort(timestamp);
  }, [formatDateShort, formatRelativeDays, formatTime, t]);

  const feedItems = useMemo(() => {
    const logs = safeArray(auditLogs).map((entry) => {
      const sev = inferAuditSeverity(entry.action);
      return {
        id: `audit-${entry.id}`,
        title: entry.action ?? '—',
        subtitle: [entry.resource, entry.details].filter(Boolean).join(' · ') || '—',
        value: formatRowTime(entry.createdAt ?? ''),
        timestamp: entry.createdAt ?? '',
        severity: sev,
      };
    });

    const events = (vidStr ? safeArray(securityEvents) : []).map((event) => {
      const sev = inferSecuritySeverity(event);
      return {
        id: `sec-${event.id}`,
        title: buildSecurityTitle(event, t),
        subtitle: t('widget.auditSecurityEvent', 'Security event'),
        value: formatRowTime(event.createdAt ?? ''),
        timestamp: event.createdAt ?? '',
        severity: sev,
      };
    });

    return [...logs, ...events].sort((a, b) => {
      const left = new Date(a.timestamp).getTime();
      const right = new Date(b.timestamp).getTime();
      if (!Number.isFinite(left)) return Number.isFinite(right) ? 1 : 0;
      if (!Number.isFinite(right)) return -1;
      return right - left;
    });
  }, [auditLogs, securityEvents, formatRowTime, t, vidStr]);

  // Compute 24h stats for compact view
  const { totalEvents24h, worstSeverity } = useMemo(() => {
    const now = Date.now();
    const dayAgo = now - 24 * 60 * 60 * 1000;
    const recent = feedItems.filter((item) => {
      const at = new Date(item.timestamp).getTime();
      return at >= dayAgo && at <= now;
    });
    let worst: Severity = 'info';
    for (const item of recent) {
      if (item.severity === 'critical') { worst = 'critical'; break; }
      if (item.severity === 'warning') worst = 'warning';
    }
    return { totalEvents24h: recent.length, worstSeverity: worst };
  }, [feedItems]);

  return (
    <WidgetShell
      title={t('widget.auditLog', 'Audit log')}
      icon={<FileSearch className="h-3.5 w-3.5 text-[var(--text-secondary)]" />}
      dataState={dataState}
      updatedAt={dataState.updatedAt ?? 0}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {isCompact ? (
        feedItems.length > 0 ? (
          <CompactView
            totalEvents24h={totalEvents24h}
            worstSeverity={worstSeverity}
            t={t}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<FileSearch className="h-5 w-5" />}
            message={t('widget.noAuditEvents', 'No audit events')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WidgetDetailCard
            entries={feedItems.slice(0, 15).map((item): DetailEntry => ({
              id: item.id,
              label: item.title,
              sublabel: item.subtitle,
              value: item.value,
            }))}
            emptyMessage={t('widget.noAuditEvents', 'No audit events')}
            emptyIcon={<FileSearch className="h-5 w-5" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
