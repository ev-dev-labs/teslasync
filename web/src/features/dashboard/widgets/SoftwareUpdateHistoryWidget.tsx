import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, CheckCircle2, Clock, ArrowDownCircle } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import type { SoftwareUpdate } from '@/types/vehicle-systems';
import { WidgetShell } from './WidgetShell';
import { WidgetEventFeed } from './shared';
import type { EventFeedItem } from './shared';
import type { WidgetProps } from './types';

/** Narrow translate signature — the shared `t` is structurally compatible. */
type TranslateFn = (key: string, fallback: string) => string;
type BadgeVariant = 'success' | 'warning' | 'info';
type FeedSeverity = 'info' | 'warning' | 'critical';

// ── Status → semantic metadata (pure, translation-agnostic) ──────────

export interface UpdateStatusMeta {
  /**
   * i18n key (dashboard namespace) for the human-readable label. An empty
   * string means "no key" — render {@link labelDefault} verbatim.
   */
  labelKey: string;
  /** English default, shown when the key is absent from the active locale. */
  labelDefault: string;
  /** Badge colour variant for the compact tile. */
  variant: BadgeVariant;
  /** Timeline dot colour (hex) for the feed row. */
  color: string;
  /** Event-feed severity. */
  severity: FeedSeverity;
}

const STATUS_META: Record<string, UpdateStatusMeta> = {
  installed:   { labelKey: 'widget.updateStatusInstalled',   labelDefault: 'Installed',   variant: 'success', color: '#22c55e', severity: 'info' },
  installing:  { labelKey: 'widget.updateStatusInstalling',  labelDefault: 'Installing',  variant: 'warning', color: '#f59e0b', severity: 'warning' },
  downloading: { labelKey: 'widget.updateStatusDownloading', labelDefault: 'Downloading', variant: 'info',    color: '#3b82f6', severity: 'info' },
  available:   { labelKey: 'widget.updateStatusAvailable',   labelDefault: 'Available',   variant: 'info',    color: '#6b7280', severity: 'info' },
  scheduled:   { labelKey: 'widget.updateStatusScheduled',   labelDefault: 'Scheduled',   variant: 'info',    color: '#a78bfa', severity: 'info' },
};

/**
 * Resolve display metadata for a software-update status. Unknown, empty, or
 * missing statuses fall back to a neutral visual that echoes the raw status
 * text (or an em-dash) so a badge / feed row never renders blank. The lookup
 * is case-insensitive and whitespace-tolerant.
 */
export function updateStatusMeta(status: string | null | undefined): UpdateStatusMeta {
  const key = (status ?? '').trim().toLowerCase();
  const known = STATUS_META[key];
  if (known) return known;
  const raw = (status ?? '').trim();
  return {
    labelKey: '',
    labelDefault: raw.length > 0 ? raw : '—',
    variant: 'info',
    color: '#6b7280',
    severity: 'info',
  };
}

const EPOCH_ISO = new Date(0).toISOString();

/**
 * ISO timestamp used to order updates newest-first. Mirrors the key
 * {@link WidgetEventFeed} sorts on, so the compact "latest" tile, the "Current"
 * marker, and the feed order stay consistent regardless of the order the API
 * returns rows in.
 */
export function updateTimestamp(
  upd: Pick<SoftwareUpdate, 'installedAt' | 'scheduledAt' | 'createdAt'>,
): string {
  return upd.installedAt ?? upd.scheduledAt ?? upd.createdAt ?? EPOCH_ISO;
}

// Stable, module-scoped icon nodes — referenced by identity from memoised JSX
// so the feed's child rows aren't handed a fresh element every render.
const STATUS_ICON: Record<string, ReactNode> = {
  installed:   <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  installing:  <ArrowDownCircle className="h-3.5 w-3.5" aria-hidden="true" />,
  downloading: <ArrowDownCircle className="h-3.5 w-3.5" aria-hidden="true" />,
  available:   <Download className="h-3.5 w-3.5" aria-hidden="true" />,
  scheduled:   <Clock className="h-3.5 w-3.5" aria-hidden="true" />,
};
const DEFAULT_ICON: ReactNode = <Download className="h-3.5 w-3.5" aria-hidden="true" />;
const CURRENT_ICON: ReactNode = <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />;

function statusLabel(t: TranslateFn, meta: UpdateStatusMeta): string {
  return meta.labelKey ? t(meta.labelKey, meta.labelDefault) : meta.labelDefault;
}

function isInstalledStatus(status: string | null | undefined): boolean {
  return (status ?? '').trim().toLowerCase() === 'installed';
}

// ── Compact layout (1-col) ───────────────────────────────────────────

function CompactView({ latest, t }: { latest: SoftwareUpdate; t: TranslateFn }) {
  const meta = updateStatusMeta(latest.status);
  return (
    <div className="flex items-center justify-between gap-2 min-h-[44px]">
      <div className="flex items-center gap-2 min-w-0">
        <Download className="h-4 w-4 flex-shrink-0 text-neon-cyan" aria-hidden="true" />
        <span className="text-sm text-[var(--text-primary)] truncate">{latest.version ?? '—'}</span>
      </div>
      <Badge variant={meta.variant}>
        {isInstalledStatus(latest.status)
          ? t('widget.updateCurrent', 'Current')
          : statusLabel(t, meta)}
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

  // Order newest-first so the compact tile and the "Current" marker stay correct
  // even when the API returns rows in an arbitrary order (the feed re-sorts by
  // the same key, so this keeps every surface in agreement).
  const sorted = useMemo<SoftwareUpdate[]>(() => {
    const list = updates ?? [];
    return [...list].sort(
      (a, b) => new Date(updateTimestamp(b)).getTime() - new Date(updateTimestamp(a)).getTime(),
    );
  }, [updates]);

  const feedItems = useMemo<EventFeedItem[]>(
    () =>
      sorted.map((upd, idx) => {
        const meta = updateStatusMeta(upd.status);
        const isCurrent = idx === 0 && isInstalledStatus(upd.status);
        return {
          id: upd.id,
          icon: isCurrent
            ? CURRENT_ICON
            : (STATUS_ICON[(upd.status ?? '').trim().toLowerCase()] ?? DEFAULT_ICON),
          title: upd.version ?? '—',
          subtitle: isCurrent ? t('widget.updateCurrent', 'Current') : statusLabel(t, meta),
          timestamp: updateTimestamp(upd),
          color: isCurrent ? '#22d3ee' : meta.color,
          severity: meta.severity,
        };
      }),
    [sorted, t],
  );

  // Latest update (newest-first) for the compact tile.
  const latest = sorted.length > 0 ? sorted[0] : null;

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  return (
    <WidgetShell
      title={t('widget.softwareUpdateHistory', 'Update History')}
      icon={<Download className="h-3.5 w-3.5 text-neon-cyan" aria-hidden="true" />}
      loading={isLoading}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={handleRefresh}
    >
      {isCompact ? (
        latest ? (
          <CompactView latest={latest} t={t} />
        ) : (
          <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
            icon={<Download className="h-5 w-5" aria-hidden="true" />}
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
            emptyIcon={<Download className="h-5 w-5" aria-hidden="true" />}
          />
        </div>
      )}
    </WidgetShell>
  );
}
