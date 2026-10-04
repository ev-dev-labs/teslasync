import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Link2 } from 'lucide-react';
import { Badge, Subhead, Text } from '@/components/ui';
import { EmptyState, QueryError, Skeleton } from '@/components/feedback';
import { useVehicleUpgrades, useVehicles } from '@/api/hooks/useVehicles';
import { useShareLinks } from '@/api/hooks/useSharing';
import { useDrives } from '@/api/hooks/useDriving';
import { useDateFormat } from '@/hooks/useDateFormat';
import { useDataState } from '@/hooks/useDataState';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { combineDataStates } from '@/api/dataState';
import { safeArray } from '@/lib/safeArray';
import { WidgetShell } from './WidgetShell';
import { WidgetBigNumber, WidgetDetailCard } from './shared';
import type { WidgetProps } from './types';

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number' && Number.isFinite(val)) return String(val);
  return null;
}

interface ParsedUpgrade {
  name: string;
  price: string | null;
  description: string | null;
  eligible: boolean;
}

export function parseUpgrades(
  data: Record<string, unknown> | null | undefined,
  unknownName = 'Unknown Upgrade',
): ParsedUpgrade[] {
  if (!data) return [];

  // Handle an "upgrades" array in the envelope
  const upgrades = data.upgrades;
  if (Array.isArray(upgrades)) {
    return upgrades
      .filter((u): u is Record<string, unknown> => u != null && typeof u === 'object' && !Array.isArray(u))
      .map((u) => ({
        name: asString(u.name) ?? asString(u.title) ?? unknownName,
        price: asString(u.price) ?? asString(u.cost),
        description: asString(u.description) ?? asString(u.summary),
        eligible: u.eligible !== false,
      }));
  }

  // Fallback: treat top-level keys as individual upgrades
  const result: ParsedUpgrade[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val == null || typeof val !== 'object' || Array.isArray(val)) continue;
    const rec = val as Record<string, unknown>;
    result.push({
      name: asString(rec.name) ?? key,
      price: asString(rec.price) ?? asString(rec.cost),
      description: asString(rec.description) ?? asString(rec.summary),
      eligible: rec.eligible !== false,
    });
  }
  return result;
}

/** Compute days until an expiry date */
export function daysUntil(dateStr: string | null): number | null {
  if (!dateStr) return null;
  const expiry = new Date(dateStr);
  if (isNaN(expiry.getTime())) return null;
  return Math.ceil((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
}

export default function VehicleUpgradesWidget({ vehicleId, size }: WidgetProps) {
  const { t } = useTranslation('dashboard');
  const { formatDate: fmtDate } = useDateFormat();
  const { fmtInt, fmtNumber } = useNumberFormatting();
  const vehiclesQuery = useVehicles();
  const numericId = vehicleId ?? safeArray(vehiclesQuery.data)[0]?.id ?? 0;
  const stringId = Number.isSafeInteger(numericId) && numericId > 0 ? String(numericId) : undefined;
  const vehiclesState = useDataState(vehiclesQuery);

  const upgradesQuery = useVehicleUpgrades(stringId);
  const {
    data: envelope,
    isLoading: upgradesLoading,
    isFetching: upgradesFetching,
    isStale: upgradesStale,
    isError: upgradesError,
    dataUpdatedAt: upgradesUpdatedAt,
    refetch: refetchUpgrades,
  } = upgradesQuery;

  // Get the most recent drive to show share links
  const drivesQuery = useDrives(stringId);
  const { data: drivesData } = drivesQuery;
  const recentDriveId = useMemo(() => {
    const id = stringId ? safeArray(drivesData)[0]?.id : undefined;
    return id != null && Number.isSafeInteger(id) && id > 0 ? String(id) : '';
  }, [drivesData, stringId]);

  const shareLinksQuery = useShareLinks(recentDriveId);
  const { data: shareLinksData } = shareLinksQuery;

  const upgradesData = envelope?.data ?? null;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const unknownName = t('widget.subscriptions.unknown', 'Unknown');
  const upgrades = useMemo(() => parseUpgrades(upgradesData, unknownName), [upgradesData, unknownName]);
  const upgradesKnown = Array.isArray(upgradesData?.upgrades) || upgrades.length > 0;
  const upgradesState = useDataState(upgradesQuery, {
    partial: envelope !== undefined && !upgradesKnown,
  });
  const drivesState = useDataState(drivesQuery, { partial: drivesData !== undefined && !Array.isArray(drivesData) });
  const shareLinksState = useDataState(shareLinksQuery, {
    partial: shareLinksData !== undefined && (!Array.isArray(shareLinksData)
      || safeArray(shareLinksData).some(link => link.expires_at != null && daysUntil(link.expires_at) == null)),
  });
  const sharingState = recentDriveId ? shareLinksState : drivesState;
  const shareLinks = recentDriveId ? safeArray(shareLinksData) : [];

  const eligibleCount = useMemo(
    () => upgrades.filter((u) => u.eligible).length,
    [upgrades],
  );

  const activeShareLinks = useMemo(
    () => shareLinks.filter((l) => {
      if (!l.expires_at) return true;
      const days = daysUntil(l.expires_at);
      return days != null && days > 0;
    }),
    [shareLinks],
  );

  const nearestExpiry = useMemo(() => {
    const withExpiry = activeShareLinks
      .filter((l) => l.expires_at)
      .sort((a, b) => (daysUntil(a.expires_at) ?? Infinity) - (daysUntil(b.expires_at) ?? Infinity));
    return withExpiry[0] ?? null;
  }, [activeShareLinks]);

  const refresh = () => {
    if (!stringId) {
      void vehiclesQuery.refetch();
      return;
    }
    void refetchUpgrades();
    if (!isCompact) {
      void drivesQuery.refetch();
      if (recentDriveId) void shareLinksQuery.refetch();
    }
  };
  const sources = isCompact ? [upgradesState] : [upgradesState, drivesState, ...(recentDriveId ? [shareLinksState] : [])];
  const combined = combineDataStates(sources);
  const hasData = sources.some(source => source.hasData);
  const state = !stringId ? vehiclesState : isCompact ? upgradesState : {
    ...upgradesState,
    ...combined,
    hasData,
    fatalError: hasData ? null : sources.find(source => source.fatalError)?.fatalError ?? null,
    status: !hasData && sources.some(source => source.fatalError) ? 'initialFailure' as const : combined.status,
    retry: refresh,
  };
  const shellProps = {
    title: t('widget.upgrades.title', 'Upgrades & sharing'),
    loading: upgradesLoading,
    dataState: state,
    updatedAt: stringId ? state.updatedAt ?? upgradesUpdatedAt ?? 0 : vehiclesState.updatedAt ?? 0,
    isFetching: stringId ? upgradesFetching || (!isCompact && state.isRefreshing) : vehiclesQuery.isFetching,
    isStale: stringId ? upgradesStale || state.status === 'stale' : vehiclesQuery.isStale,
    isError: stringId ? upgradesError || state.refreshError != null || state.fatalError != null : vehiclesQuery.isError,
    onRefresh: refresh,
  };
  const emptyMessage = t('widget.emptyMessage', 'This widget has no qualifying data yet.');
  const formatPrice = (price: string | null) => {
    if (price == null) return null;
    // The opaque vendor payload does not guarantee a currency; never invent "$".
    const number = Number(price);
    return price.trim() !== '' && Number.isFinite(number) ? fmtNumber(number) : price;
  };
  if (!stringId) {
    return <WidgetShell {...shellProps}>
      <EmptyState icon={<ArrowUpCircle className="h-5 w-5" />}
        message={t('widget.noVehicle', 'No vehicle')}
        actionTo={{ label: t('widget.chooseVehicle', 'Choose vehicle'), to: '/vehicles' }} />
    </WidgetShell>;
  }

  // ── Compact layout (1×2): upgrade count ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <WidgetBigNumber value={upgradesKnown ? fmtInt(eligibleCount) : null} animated={false} align="center"
          label={t('widget.upgrades.available', 'available')} />
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      icon={<ArrowUpCircle className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      <div className="overflow-y-auto h-full space-y-3">
        {/* Upgrades section */}
        <div>
          <Subhead className="mb-2">
            {t('widget.upgrades.upgradesHeading', 'Available upgrades')}
          </Subhead>
          {upgradesState.fatalError ? (
            <QueryError error={upgradesState.fatalError} onRetry={() => { void refetchUpgrades(); }} />
          ) : upgradesState.status === 'initial' ? <Skeleton className="h-20" /> : upgrades.length > 0 ? (
            <div className="space-y-2">
              {upgrades.map((upgrade, index) => (
                <div
                  key={`${upgrade.name}-${index}`}
                  className="flex items-start justify-between gap-2 py-1.5 px-1 border-b border-[var(--border-default)] last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <Text variant="bodySm" className="truncate">
                        {upgrade.name}
                      </Text>
                      {upgrade.price && (
                        <Badge variant="neutral" size="sm">
                          {formatPrice(upgrade.price)}
                        </Badge>
                      )}
                    </div>
                    {upgrade.description && (
                      <Text variant="bodySm" className="mt-0.5 truncate">
                        {upgrade.description}
                      </Text>
                    )}
                    {isWide && (
                      <Text variant="caption" className="mt-0.5 block">
                        {upgrade.eligible
                          ? t('widget.upgrades.eligible', 'Eligible')
                          : t('widget.upgrades.notEligible', 'Not eligible')}
                      </Text>
                    )}
                  </div>
                  <Badge
                    variant={upgrade.eligible ? 'success' : 'neutral'}
                    size="sm"
                  >
                    {upgrade.eligible
                      ? t('widget.upgrades.eligible', 'Eligible')
                      : t('widget.upgrades.notEligible', 'Not eligible')}
                  </Badge>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState /* no-action: eligibility evidence cannot be created in this widget */
              message={emptyMessage} className="py-3" />
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-[var(--border-default)]" />

        {/* Share Links section */}
        <div>
          <Subhead className="mb-2 flex items-center gap-1.5">
            <Link2 className="h-3 w-3" />
            {t('widget.upgrades.shareLinksHeading', 'Share links')}
          </Subhead>
          {sharingState.fatalError ? (
            <QueryError error={sharingState.fatalError} onRetry={() => {
              void drivesQuery.refetch();
              if (recentDriveId) void shareLinksQuery.refetch();
            }} />
          ) : sharingState.status === 'initial' ? <Skeleton className="h-16" /> : activeShareLinks.length > 0 ? (
            <WidgetDetailCard entries={[
              { label: t('widget.upgrades.activeLinks', 'Active links'), value: fmtInt(activeShareLinks.length) },
              ...(nearestExpiry ? [{
                label: t('widget.upgrades.nearestExpiry', 'Nearest expiry'),
                value: fmtDate(nearestExpiry.expires_at) ?? '—',
              }] : []),
            ]} />
          ) : (
            <EmptyState
              icon={<Link2 className="h-5 w-5" />}
              message={recentDriveId && !Array.isArray(shareLinksData)
                ? emptyMessage : t('widget.upgrades.noShareLinks', 'No active share links')}
              actionTo={{ label: t('nav.drives', 'Drives'), to: '/drives' }}
              className="py-2"
            />
          )}
        </div>
      </div>
    </WidgetShell>
  );
}
