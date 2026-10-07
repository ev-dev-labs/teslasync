import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowUpCircle, Link2 } from 'lucide-react';
import { Badge } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { useVehicleUpgrades, useVehicles } from '@/api/hooks/useVehicles';
import { useShareLinks } from '@/api/hooks/useSharing';
import { useDrives } from '@/api/hooks/useDriving';
import { useDateFormat } from '@/hooks/useDateFormat';
import { WidgetShell } from './WidgetShell';
import type { WidgetProps } from './types';

/** Safely extract a string from an unknown value */
function asString(val: unknown): string | null {
  if (val == null) return null;
  if (typeof val === 'string' && val.length > 0) return val;
  if (typeof val === 'number') return String(val);
  return null;
}

interface ParsedUpgrade {
  name: string;
  price: string | null;
  description: string | null;
  eligible: boolean;
}

export function parseUpgrades(data: Record<string, unknown> | null | undefined): ParsedUpgrade[] {
  if (!data) return [];

  // Handle an "upgrades" array in the envelope
  const upgrades = data.upgrades;
  if (Array.isArray(upgrades)) {
    return upgrades
      .filter((u): u is Record<string, unknown> => u != null && typeof u === 'object')
      .map((u) => ({
        name: asString(u.name) ?? asString(u.title) ?? 'Unknown Upgrade',
        price: asString(u.price) ?? asString(u.cost),
        description: asString(u.description) ?? asString(u.summary),
        eligible: u.eligible !== false,
      }));
  }

  // Fallback: treat top-level keys as individual upgrades
  const result: ParsedUpgrade[] = [];
  for (const [key, val] of Object.entries(data)) {
    if (val == null || typeof val !== 'object') continue;
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
  const { data: vehicles } = useVehicles();
  const numericId = vehicleId ?? vehicles?.[0]?.id ?? 0;
  const stringId = numericId > 0 ? String(numericId) : undefined;

  const {
    data: envelope,
    isLoading: upgradesLoading,
    isFetching: upgradesFetching,
    isStale: upgradesStale,
    isError: upgradesError,
    dataUpdatedAt: upgradesUpdatedAt,
    refetch: refetchUpgrades,
  } = useVehicleUpgrades(stringId);

  // Get the most recent drive to show share links
  const { data: drivesData } = useDrives(stringId);
  const recentDriveId = useMemo(() => {
    const drives = drivesData ?? [];
    return drives.length > 0 ? String(drives[0].id) : '';
  }, [drivesData]);

  const { data: shareLinksData } = useShareLinks(recentDriveId);

  const upgradesData = envelope?.data ?? null;
  const isCompact = size.cols <= 1;
  const isWide = size.cols >= 3;

  const upgrades = useMemo(() => parseUpgrades(upgradesData), [upgradesData]);
  const shareLinks = shareLinksData ?? [];

  const eligibleCount = useMemo(
    () => upgrades.filter((u) => u.eligible).length,
    [upgrades],
  );

  const activeShareLinks = useMemo(
    () => shareLinks.filter((l) => {
      if (!l.expires_at) return true;
      const days = daysUntil(l.expires_at);
      return days == null || days > 0;
    }),
    [shareLinks],
  );

  const nearestExpiry = useMemo(() => {
    const withExpiry = activeShareLinks
      .filter((l) => l.expires_at)
      .sort((a, b) => (daysUntil(a.expires_at) ?? Infinity) - (daysUntil(b.expires_at) ?? Infinity));
    return withExpiry[0] ?? null;
  }, [activeShareLinks]);

  const shellProps = {
    loading: upgradesLoading,
    updatedAt: upgradesUpdatedAt ?? 0,
    isFetching: upgradesFetching,
    isStale: upgradesStale,
    isError: upgradesError,
    onRefresh: () => refetchUpgrades(),
  };

  // ── Compact layout (1×2): upgrade count ──
  if (isCompact) {
    return (
      <WidgetShell {...shellProps}>
        <div className="h-full flex flex-col items-center justify-center gap-1.5 min-h-[44px]">
          <ArrowUpCircle className="h-4 w-4 text-emerald-400" />
          {upgrades.length > 0 ? (
            <>
              <span className="text-2xl font-bold text-[var(--text-primary)]">
                {eligibleCount}
              </span>
              <span className="text-2xs text-[var(--text-muted)] uppercase tracking-wider">
                {t('widget.upgrades.available', 'available')}
              </span>
            </>
          ) : (
            <Badge variant="success" size="sm" className="min-h-[44px] min-w-[44px] flex items-center justify-center">
              {t('widget.upgrades.upToDate', 'Up to date')}
            </Badge>
          )}
        </div>
      </WidgetShell>
    );
  }

  // ── Standard / Wide layout ──
  return (
    <WidgetShell
      title={t('widget.upgrades.title', 'Upgrades & Sharing')}
      icon={<ArrowUpCircle className="h-3.5 w-3.5 text-emerald-400" />}
      {...shellProps}
    >
      <div className="overflow-y-auto h-full space-y-3">
        {/* Upgrades section */}
        <div>
          <h4 className="text-2xs uppercase text-[var(--text-muted)] tracking-wider mb-2">
            {t('widget.upgrades.upgradesHeading', 'Available Upgrades')}
          </h4>
          {upgrades.length > 0 ? (
            <div className="space-y-2">
              {upgrades.map((upgrade, index) => (
                <div
                  key={`${upgrade.name}-${index}`}
                  className="flex items-start justify-between gap-2 py-1.5 px-1 border-b border-white/[0.06] last:border-b-0"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-[var(--text-primary)] truncate">
                        {upgrade.name}
                      </span>
                      {upgrade.price && (
                        <Badge variant="neutral" size="sm">
                          ${upgrade.price}
                        </Badge>
                      )}
                    </div>
                    {upgrade.description && (
                      <p className="text-xs text-[var(--text-secondary)] mt-0.5 truncate">
                        {upgrade.description}
                      </p>
                    )}
                    {isWide && (
                      <span className="text-2xs text-[var(--text-muted)] mt-0.5 block">
                        {upgrade.eligible
                          ? t('widget.upgrades.eligible', 'Eligible')
                          : t('widget.upgrades.notEligible', 'Not eligible')}
                      </span>
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
            <div className="flex items-center gap-2 py-3 justify-center">
              <span className="text-sm text-emerald-400" aria-hidden="true">✅</span>
              <span className="text-sm text-[var(--text-secondary)]">
                {t('widget.upgrades.allApplied', 'All upgrades applied')}
              </span>
            </div>
          )}
        </div>

        {/* Divider */}
        <div className="border-t border-white/[0.08]" />

        {/* Share Links section */}
        <div>
          <h4 className="text-2xs uppercase text-[var(--text-muted)] tracking-wider mb-2 flex items-center gap-1.5">
            <Link2 className="h-3 w-3" />
            {t('widget.upgrades.shareLinksHeading', 'Share Links')}
          </h4>
          {activeShareLinks.length > 0 ? (
            <div className="space-y-1">
              <div className="flex items-center justify-between py-1 px-1">
                <span className="text-2xs uppercase text-[var(--text-muted)] tracking-wide">
                  {t('widget.upgrades.activeLinks', 'Active links')}
                </span>
                <span className="text-sm text-[var(--text-primary)] font-medium">
                  {activeShareLinks.length}
                </span>
              </div>
              {nearestExpiry && (
                <div className="flex items-center justify-between py-1 px-1">
                  <span className="text-2xs uppercase text-[var(--text-muted)] tracking-wide">
                    {t('widget.upgrades.nearestExpiry', 'Nearest expiry')}
                  </span>
                  <Badge variant="warning" size="sm">
                    {fmtDate(nearestExpiry.expires_at) ?? '—'}
                  </Badge>
                </div>
              )}
            </div>
          ) : (
            <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */
              icon={<Link2 className="h-5 w-5" />}
              message={t('widget.upgrades.noShareLinks', 'No active share links')}
              className="py-2"
            />
          )}
        </div>
      </div>
    </WidgetShell>
  );
}
