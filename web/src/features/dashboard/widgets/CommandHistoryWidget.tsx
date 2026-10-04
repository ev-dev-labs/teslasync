import { useMemo, useCallback, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge, type BadgeProps } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useDataState } from '@/hooks/useDataState';
import { dashboardTokens } from '../lib/dashboardTokens';
import { useCommandHistory } from '@/api/hooks/useCommands';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

/** Minimal translate signature the widget threads to its pure helpers. */
type TranslateFn = (key: string, fallback: string) => string;

/** Rendered wherever a command name or status is missing/blank. */
const PLACEHOLDER = '—';

// ── Status → visual mapping ──────────────────────────────────────────

interface StatusVisual {
  icon: ReactNode;
  color: string;
  severity: EventFeedItem['severity'];
}

const STATUS_MAP: Record<string, StatusVisual> = {
  success: { icon: <CheckCircle className="h-3.5 w-3.5" />, color: '#22c55e', severity: 'info' },
  failed:  { icon: <XCircle className="h-3.5 w-3.5" />,     color: '#ef4444', severity: 'critical' },
  pending: { icon: <Clock className="h-3.5 w-3.5" />,       color: '#f59e0b', severity: 'warning' },
};

const DEFAULT_STATUS: StatusVisual = {
  icon: <Terminal className="h-3.5 w-3.5" />,
  color: '#6b7280',
  severity: 'info',
};

/**
 * Resolve a command status to its icon / colour / severity. Unknown, empty, or
 * missing statuses fall back to a neutral terminal glyph so the feed never
 * renders a hole for a status the backend adds later.
 */
export function commandStatusVisual(status: string | null | undefined): StatusVisual {
  if (!status) return DEFAULT_STATUS;
  return Object.prototype.hasOwnProperty.call(STATUS_MAP, status) ? STATUS_MAP[status] : DEFAULT_STATUS;
}

/** Badge variant for the compact single-command summary. */
export function commandBadgeVariant(status: string | null | undefined): BadgeProps['variant'] {
  if (status === 'success') return 'success';
  if (status === 'failed') return 'danger';
  return status === 'pending' ? 'warning' : 'neutral';
}

/** Translated status label for the compact single-command summary. */
export function commandStatusLabel(status: string | null | undefined, t: TranslateFn): string {
  if (status === 'success') return t('widget.commandSuccess', 'Success');
  if (status === 'failed') return t('widget.commandFailed', 'Failed');
  if (status === 'pending') return t('widget.commandPending', 'Pending');
  return status?.trim() || t('widget.commandUnknown', 'Unknown');
}

/**
 * Humanise a raw command identifier (`wake_up` → `Wake up`). Empty, blank, or
 * missing names collapse to an em-dash so a null/empty `command` column can
 * never render a void label.
 */
export function formatCommandName(raw: string | null | undefined): string {
  const trimmed = raw?.trim();
  if (!trimmed) return PLACEHOLDER;
  return trimmed
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  lastCommand,
  lastStatus,
  t,
}: {
  lastCommand: string;
  lastStatus: string;
  t: TranslateFn;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Terminal className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
        <span className={dashboardTokens.metricLabel}>{lastCommand}</span>
      </div>
      <Badge variant={commandBadgeVariant(lastStatus)}>{commandStatusLabel(lastStatus, t)}</Badge>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function CommandHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const vehicleQuery = useVehicles();
  const { data: vehicles } = vehicleQuery;
  const vehicleState = useDataState(vehicleQuery);
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const query = useCommandHistory(vidStr);
  const {
    data: commands,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = query;
  const state = useDataState({ ...query, data: commands ?? undefined }, { provenance: 'historical' });
  const displayState = vid === undefined && (vehicleState.fatalError || vehicleQuery.isLoading) ? vehicleState : state;

  const isCompact = size.cols <= 1;
  const list = useMemo(() => commands ?? [], [commands]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map((cmd) => {
        const mapped = commandStatusVisual(cmd.status);
        return {
          id: cmd.id,
          icon: mapped.icon,
          title: formatCommandName(cmd.command),
          subtitle: [commandStatusLabel(cmd.status, t), cmd.error?.trim()].filter(Boolean).join(' · '),
          timestamp: cmd.created_at ?? '',
          color: mapped.color,
          severity: mapped.severity,
        };
      }),
    [list, t],
  );

  const handleRefresh = useCallback(() => {
    if (vid === undefined) void vehicleQuery.refetch();
    else void refetch();
  }, [vid, vehicleQuery.refetch, refetch]);

  const lastEntry = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.commandHistory', 'Command history')}
      icon={<Terminal className="h-3.5 w-3.5" aria-hidden="true" />}
      loading={isLoading}
      dataState={{ ...displayState, status: displayState.status === 'initial' && !isLoading && !vehicleQuery.isLoading ? 'unavailable' : displayState.status }}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {isCompact ? (
        lastEntry ? (
          <CompactView
            lastCommand={formatCommandName(lastEntry.command)}
            lastStatus={lastEntry.status ?? ''}
            t={t}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Terminal className="h-5 w-5" />}
            message={t('widget.noCommands', 'No commands sent')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WidgetEventFeed
            items={feedItems}
            maxItems={10}
            compact={false}
            emptyMessage={t('widget.noCommands', 'No commands sent')}
            emptyIcon={<Terminal className="h-5 w-5" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
