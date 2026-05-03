import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, CheckCircle2, Clock, ArrowDownCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

// ── Status → visual mapping ──────────────────────────────────────────

const STATUS_MAP: Record<string, { icon: React.ReactNode; color: string; severity: EventFeedItem['severity'] }> = {
  installed:    { icon: <CheckCircle2 className="h-3.5 w-3.5" />,      color: '#22c55e', severity: 'info' },
  installing:   { icon: <ArrowDownCircle className="h-3.5 w-3.5" />,   color: '#f59e0b', severity: 'warning' },
  downloading:  { icon: <ArrowDownCircle className="h-3.5 w-3.5" />,   color: '#3b82f6', severity: 'info' },
  available:    { icon: <Download className="h-3.5 w-3.5" />,          color: '#6b7280', severity: 'info' },
  scheduled:    { icon: <Clock className="h-3.5 w-3.5" />,             color: '#a78bfa', severity: 'info' },
};

const DEFAULT_STATUS = {
  icon: <Download className="h-3.5 w-3.5" />,
  color: '#6b7280',
  severity: 'info' as const,
};

// ── Compact layout (1-col) ───────────────────────────────────────────

function CompactView({
  latestVersion,
  latestStatus,
  t,
}: {
  latestVersion: string;
  latestStatus: string;
  t: (key: string, fallback: string) => string;
}) {
  const variant = latestStatus === 'installed' ? 'success' : latestStatus === 'installing' ? 'warning' : 'info';
  return (
    <div className="flex items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Download className="h-4 w-4 flex-shrink-0 text-neon-cyan" />
        <span className="text-sm text-[var(--text-primary)] truncate">{latestVersion}</span>
      </div>
      <Badge variant={variant}>
        {latestStatus === 'installed'
          ? t('widget.updateCurrent', 'Current')
          : t('widget.updateStatus', latestStatus)}
      </Badge>
    </div>
  );
}

// ── Main widget ──────────────────────────────────────────────────────

export default function SoftwareUpdateHistoryWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = vid != null ? String(vid) : '';

  const {
    data: updates,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useSoftwareUpdates(vidStr);

  const isCompact = size.cols <= 1;
  const list = updates ?? [];

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      list.map((upd, idx) => {
        const mapped = STATUS_MAP[upd.status] ?? DEFAULT_STATUS;
        const isCurrent = idx === 0 && upd.status === 'installed';
        return {
          id: upd.id,
          icon: isCurrent ? <CheckCircle2 className="h-3.5 w-3.5" /> : mapped.icon,
          title: upd.version ?? '—',
          subtitle: isCurrent
            ? t('widget.updateCurrent', 'Current')
            : (upd.status ?? '—'),
          timestamp: upd.installedAt ?? upd.scheduledAt ?? upd.createdAt ?? new Date(0).toISOString(),
          color: isCurrent ? '#22d3ee' : mapped.color,
          severity: mapped.severity,
        };
      }),
    [list, t],
  );

  // Latest installed version for compact view
  const latest = list.length > 0 ? list[0] : null;

  return (
    <WidgetShell
      title={t('widget.softwareUpdateHistory', 'Update History')}
      icon={<Download className="h-3.5 w-3.5 text-neon-cyan" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
      {isCompact ? (
        latest ? (
          <CompactView
            latestVersion={latest.version ?? '—'}
            latestStatus={latest.status ?? '—'}
            t={t}
          />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Download className="h-5 w-5" />}
            message={t('widget.noUpdates', 'No update history')}
            className="py-4"
          />
        )
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <WidgetEventFeed
            items={feedItems}
            maxItems={15}
            compact={false}
            emptyMessage={t('widget.noUpdates', 'No update history')}
            emptyIcon={<Download className="h-5 w-5" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
