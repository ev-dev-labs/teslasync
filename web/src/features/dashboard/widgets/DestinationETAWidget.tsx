import { useTranslation } from 'react-i18next';
import { Navigation2 } from 'lucide-react';
import { AnimatedNumber } from '@/components/data-display';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useLocationSnapshotLatest, useVehicles } from '@/api/hooks/useVehicles';
import { useSettings } from '@/hooks/useSettings';
import { fmtNumber, fmtInt } from '@/lib/numberFormat';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber } from './shared';
import type { WidgetProps } from './types';

function locationBadge(
  snapshot: { located_at_home?: boolean; located_at_work?: boolean; located_at_favorite?: boolean } | null | undefined,
  t: (key: string, fallback: string) => string,
): { emoji: string; label: string; variant: 'success' | 'warning' | 'neutral' } {
  if (snapshot?.located_at_home) return { emoji: '🏠', label: t('widget.destinationETA.home', 'Home'), variant: 'success' };
  if (snapshot?.located_at_work) return { emoji: '🏢', label: t('widget.destinationETA.work', 'Work'), variant: 'neutral' };
  if (snapshot?.located_at_favorite) return { emoji: '⭐', label: t('widget.destinationETA.favorite', 'Favorite'), variant: 'neutral' };
  return { emoji: '📍', label: t('widget.destinationETA.other', 'Other'), variant: 'warning' };
}

export default function DestinationETAWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { data: vehicles } = useVehicles();
  const vid = vehicleId ?? vehicles?.[0]?.id;
  const { convertDistance, distanceUnit } = useSettings();

  const {
    data: snapshot,
    isLoading,
    error,
    isFetching,
    isStale,
    isError,
    dataUpdatedAt,
    refetch,
  } = useLocationSnapshotLatest(vid ?? 0);

  const isCompact = size.cols <= 1;

  const isNavigating = snapshot != null &&
    snapshot.destination_name != null &&
    snapshot.destination_name !== '';

  const milesToArrival = snapshot?.miles_to_arrival ?? 0;
  const minutesToArrival = snapshot?.minutes_to_arrival ?? 0;
  const destinationName = snapshot?.destination_name ?? '—';

  const displayDistance = convertDistance(milesToArrival);
  const progressPercent = isNavigating && milesToArrival > 0
    ? Math.max(0, Math.min(100, 100 - (milesToArrival / (milesToArrival + 1)) * 100))
    : 0;

  const locBadge = locationBadge(snapshot, t);

  const shellProps = {
    loading: isLoading,
    error: error ? String(error) : null,
    updatedAt: dataUpdatedAt ?? 0,
    isFetching,
    isStale,
    isError,
    onRefresh: () => { refetch(); },
  };

  // ── Compact (1×2) ──
  if (isCompact) {
    if (!snapshot) {
      return (
        <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
          <EmptyState
            icon={<Navigation2 className="h-5 w-5" />}
            message={t('widget.destinationETA.noData', 'No location data')}
            className="py-4"
          />
        </WidgetShell>
      );
    }

    if (isNavigating) {
      return (
        <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
          <WidgetBigNumber
            value={Math.round(minutesToArrival)}
            unit={t('widget.destinationETA.min', 'min')}
            label={t('widget.destinationETA.eta', 'ETA')}
          />
        </WidgetShell>
      );
    }

    return (
      <WidgetShell {...shellProps}
      updatedAt={dataUpdatedAt}
      isFetching={isFetching}
      isStale={isStale}
      isError={isError}
      onRefresh={() => refetch()}
    >
        <div className="flex h-full flex-col items-center justify-center gap-1 min-h-[44px]">
          <span className="text-2xl" role="img" aria-label={locBadge.label}>
            {locBadge.emoji}
          </span>
          <Badge variant={locBadge.variant === 'success' ? 'success' : locBadge.variant === 'warning' ? 'warning' : 'neutral'} size="sm">
            {locBadge.label}
          </Badge>
        </div>
      </WidgetShell>
    );
  }

  // ── Standard (2×2) ──
  if (!snapshot) {
    return (
      <WidgetShell
        title={t('widget.destinationETA.title', 'Destination ETA')}
        icon={<Navigation2 className="h-3.5 w-3.5 text-cyan-400" />}
        {...shellProps}
      >
        <EmptyState
          icon={<Navigation2 className="h-5 w-5" />}
          message={t('widget.destinationETA.noData', 'No location data')}
          className="py-4"
        />
      </WidgetShell>
    );
  }

  if (!isNavigating) {
    return (
      <WidgetShell
        title={t('widget.destinationETA.title', 'Destination ETA')}
        icon={<Navigation2 className="h-3.5 w-3.5 text-cyan-400" />}
        {...shellProps}
      >
        <div className="flex h-full flex-col items-center justify-center gap-2">
          <span className="text-3xl" role="img" aria-label={locBadge.label}>
            {locBadge.emoji}
          </span>
          <Badge variant={locBadge.variant === 'success' ? 'success' : locBadge.variant === 'warning' ? 'warning' : 'neutral'} size="sm">
            {locBadge.label}
          </Badge>
          <span className="text-xs text-[var(--text-muted)]">
            {t('widget.destinationETA.noNav', 'No active navigation')}
          </span>
        </div>
      </WidgetShell>
    );
  }

  // Navigating — full layout
  const etaHours = Math.floor(minutesToArrival / 60);
  const etaMins = Math.round(minutesToArrival % 60);
  const etaDisplay = etaHours > 0
    ? `${fmtInt(etaHours)}h ${fmtInt(etaMins)}m`
    : `${fmtInt(etaMins)}m`;

  return (
    <WidgetShell
      title={t('widget.destinationETA.title', 'Destination ETA')}
      icon={<Navigation2 className="h-3.5 w-3.5 text-cyan-400" />}
      {...shellProps}
    >
      <div className="flex h-full flex-col justify-between gap-2">
        {/* Destination name */}
        <div className="flex items-center gap-2 min-h-[44px]">
          <Navigation2 className="h-4 w-4 shrink-0 text-cyan-400" />
          <span className="truncate text-sm font-medium text-[var(--text-primary)]">
            {destinationName}
          </span>
        </div>

        {/* ETA countdown + distance */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col items-center gap-0.5">
            <AnimatedNumber
              value={Math.round(minutesToArrival)}
              className="text-3xl font-bold text-cyan-400"
            />
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {etaDisplay}
            </span>
          </div>

          <div className="flex flex-col items-center gap-0.5">
            <span className="text-xl font-semibold tabular-nums text-[var(--text-primary)]">
              {fmtNumber(displayDistance, 1)}
            </span>
            <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
              {distanceUnit}
            </span>
          </div>
        </div>

        {/* Progress bar */}
        <div className="flex flex-col gap-1">
          <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--surface-2)]">
            <div
              className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 transition-all duration-700"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <div className="flex justify-between text-[10px] text-[var(--text-muted)]">
            <span>{t('widget.destinationETA.remaining', 'Remaining')}</span>
            <span>{fmtNumber(displayDistance, 1)} {distanceUnit}</span>
          </div>
        </div>
      </div>
    </WidgetShell>
  );
}
