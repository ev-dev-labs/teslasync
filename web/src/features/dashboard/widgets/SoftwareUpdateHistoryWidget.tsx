import { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Badge, Text } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicles } from '@/api/hooks/useVehicles';
import { useSoftwareUpdates } from '@/api/hooks/useVehicleSystems';
import { useDataState } from '@/hooks/useDataState';
import { useDateFormat } from '@/hooks/useDateFormat';
import { safeArray } from '@/lib/safeArray';
import type { SoftwareUpdate } from '@/types/vehicle-systems';
import { WidgetShell } from './WidgetShell';
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
  const { formatDateShort, formatDayKey } = useDateFormat();
  const vehiclesQuery = useVehicles();
  const { data: vehicles } = vehiclesQuery;
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const vidStr = typeof vid === 'number' && Number.isSafeInteger(vid) && vid > 0 ? String(vid) : '';

  const updatesQuery = useSoftwareUpdates(vidStr);
  const {
    data: updates,
    isLoading,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = updatesQuery;
  const updatesState = useDataState(updatesQuery, { partial: updates !== undefined && !Array.isArray(updates) });
  const vehiclesState = useDataState(vehiclesQuery);
  const dataState = vidStr ? updatesState : vehiclesState;

  const isCompact = size.cols <= 1;

  // Order newest-first so the compact tile and the "Current" marker stay correct
  // even when the API returns rows in an arbitrary order (the feed re-sorts by
  // the same key, so this keeps every surface in agreement).
  const sorted = useMemo<SoftwareUpdate[]>(() => {
    const list = safeArray(updates);
    return [...list].sort(
      (a, b) => new Date(updateTimestamp(b)).getTime() - new Date(updateTimestamp(a)).getTime(),
    );
  }, [updates]);

  const currentId = useMemo(
    () => sorted.find((upd) => isInstalledStatus(upd.status))?.id ?? null,
    [sorted],
  );

  const updatesThisYear = useMemo(() => {
    const year = formatDayKey(new Date()).slice(0, 4);
    return sorted.filter((upd) =>
      isInstalledStatus(upd.status)
      && typeof upd.installedAt === 'string'
      && formatDayKey(upd.installedAt).startsWith(`${year}-`),
    ).length;
  }, [sorted, formatDayKey]);

  // Latest update (newest-first) for the compact tile.
  const latest = sorted.length > 0 ? sorted[0] : null;

  const handleRefresh = useCallback(() => {
    if (!vidStr) {
      void vehiclesQuery.refetch();
      return;
    }
    void refetch();
  }, [vidStr, vehiclesQuery.refetch, refetch]);

  return (
    <WidgetShell
      title={t('widget.softwareUpdateHistory', 'Update history')}
      icon={<Download className="h-3.5 w-3.5 text-neon-cyan" aria-hidden="true" />}
      loading={isLoading}
      dataState={dataState}
      updatedAt={vidStr ? dataUpdatedAt : vehiclesQuery.dataUpdatedAt}
      isFetching={vidStr ? isFetching : vehiclesQuery.isFetching}
      isStale={vidStr ? isStale : vehiclesQuery.isStale}
      isError={vidStr ? isError : vehiclesQuery.isError}
      onRefresh={handleRefresh}
      footer={
        sorted.length > 0 ? (
          <div className="flex items-center justify-between gap-3">
            <Text variant="caption">
              {t('widget.updatesThisYear', '{{count}} updates this year', { count: updatesThisYear })}
            </Text>
            <Link
              to="/software-updates"
              className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-[var(--accent-primary)] hover:underline"
            >
              {t('widget.changelogs', 'Changelogs')}
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        ) : undefined
      }
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
          {sorted.length === 0 ? (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Download className="h-5 w-5" aria-hidden="true" />}
              message={t('widget.noUpdates', 'No update history')}
              className="py-4"
            />
          ) : (
          <div role="list" aria-label={t('widget.eventFeed.label', 'Event feed')}>
            {sorted.slice(0, 15).map((upd) => {
              const meta = updateStatusMeta(upd.status);
              const installed = isInstalledStatus(upd.status);
              const current = upd.id === currentId;
              const dateLabel = installed && upd.installedAt
                ? t('widget.updateInstalledOn', 'Installed {{date}}', {
                    date: formatDateShort(upd.installedAt),
                  })
                : statusLabel(t, meta);

              return (
                <div
                  role="listitem"
                  key={upd.id}
                  className="flex min-h-8 gap-2.5 py-2"
                >
                  <span
                    aria-hidden="true"
                    className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
                      current
                        ? 'bg-[var(--semantic-success)]'
                        : 'bg-[var(--surface-2)] border border-[var(--border-subtle)]'
                    }`}
                  />
                  <div className="min-w-0 flex-1">
                    <Text as="p" variant="bodySm" weight="medium" color="primary" className="break-words">
                      {upd.version ?? '—'}
                    </Text>
                    <Text as="p" variant="caption" className="mt-0.5 break-words">
                      {dateLabel}
                    </Text>
                  </div>
                  {current ? (
                    <Badge variant="success" className="self-start shrink-0">
                      {t('widget.updateCurrent', 'Current')}
                    </Badge>
                  ) : null}
                </div>
              );
            })}
          </div>
          )}
        </div>
      )}
    </WidgetShell>
  );
}
