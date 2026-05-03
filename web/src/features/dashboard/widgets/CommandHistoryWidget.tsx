import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Terminal, CheckCircle, XCircle, Clock } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useCommandHistory } from '@/api/hooks/useCommands';
import { useVehicles } from '@/api/hooks/useVehicles';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

// ── Status → visual mapping ──────────────────────────────────────────

const STATUS_MAP: Record<string, { icon: React.ReactNode; color: string; severity: EventFeedItem['severity'] }> = {
  success: { icon: <CheckCircle className="h-3.5 w-3.5" />, color: '#22c55e', severity: 'info' },
  failed:  { icon: <XCircle className="h-3.5 w-3.5" />,     color: '#ef4444', severity: 'critical' },
  pending: { icon: <Clock className="h-3.5 w-3.5" />,       color: '#f59e0b', severity: 'warning' },
};

const DEFAULT_STATUS = {
  icon: <Terminal className="h-3.5 w-3.5" />,
  color: '#6b7280',
  severity: 'info' as const,
};

function formatCommandName(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── Compact layout (1×2) ─────────────────────────────────────────────

function CompactView({
  lastCommand,
  lastStatus,
  t,
}: {
  lastCommand: string;
  lastStatus: string;
  t: (key: string, fallback: string) => string;
}) {
  const variant = lastStatus === 'success' ? 'success' : lastStatus === 'failed' ? 'danger' : 'warning';
  const label = lastStatus === 'success'
    ? t('widget.commandSuccess', 'Success')
    : lastStatus === 'failed'
      ? t('widget.commandFailed', 'Failed')
      : t('widget.commandPending', 'Pending');

  return (
    <div className="flex items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Terminal className="h-4 w-4 flex-shrink-0 text-neon-cyan" />
        <span className="text-sm text-[var(--text-primary)] truncate">{lastCommand}</span>
      </div>
      <Badge variant={variant}>{label}</Badge>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function CommandHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : undefined;

  const {
    data: commands,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useCommandHistory(vidStr);

  const isCompact = size.cols <= 1;
  const list = commands ?? [];

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map((cmd) => {
        const mapped = STATUS_MAP[cmd.status] ?? DEFAULT_STATUS;
        return {
          id: cmd.id,
          icon: mapped.icon,
          title: formatCommandName(cmd.command ?? '—'),
          subtitle: cmd.status ?? '—',
          timestamp: cmd.created_at ?? new Date(0).toISOString(),
          color: mapped.color,
          severity: mapped.severity,
        };
      }),
    [list],
  );

  const lastEntry = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.commandHistory', 'Command History')}
      icon={<Terminal className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
        lastEntry ? (
          <CompactView
            lastCommand={formatCommandName(lastEntry.command ?? '—')}
            lastStatus={lastEntry.status ?? '—'}
            t={t}
          />
        ) : (
          <EmptyState
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
