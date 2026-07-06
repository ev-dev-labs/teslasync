import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Car } from 'lucide-react';

import { GlassPanel, PanelTitle } from '@/components/ui';
import { MetricBar } from '@/components/data-display';
import { Skeleton, EmptyState, QueryError } from '@/components/feedback';
import { useUnits } from '@/hooks/useUnits';
import { useChartPalette } from '@/hooks/useChartPalette';
import { convertDistanceFromSI } from '@/lib/unitConversion';
import { fmtInt, fmtNumber, safeNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import type { VehicleComparisonEntry } from '@/types/analytics';

/** Backend `vehicle_comparison[].distance` is SI kilometres; efficiency is Wh/km. */
const METERS_PER_KM = 1000;
const KM_PER_MILE = 1.609344;

export interface FleetComparisonPanelProps {
  /** Per-vehicle rollup from the fleet analytics summary. */
  entries: VehicleComparisonEntry[];
  loading: boolean;
  error: unknown;
  onRetry?: () => void;
  className?: string;
}

/**
 * Side-panel breakdown comparing each fleet vehicle's distance (bar length)
 * and efficiency (sub-label), converted from SI to the user's display units at
 * the render boundary. Owns its own loading / empty / error states so it can be
 * dropped into any bento column without the parent gating it.
 */
export function FleetComparisonPanel({
  entries,
  loading,
  error,
  onRetry,
  className,
}: FleetComparisonPanelProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const palette = useChartPalette();

  const distanceUnit = unitPrefs.distance;
  const efficiencyUnit = distanceUnit === 'mi' ? 'Wh/mi' : 'Wh/km';

  const { rows, maxDistance } = useMemo(() => {
    const fromKm = (km: number) => convertDistanceFromSI(km * METERS_PER_KM, distanceUnit);
    const whPerKmToDisplay = (whPerKm: number) =>
      distanceUnit === 'mi' ? whPerKm * KM_PER_MILE : whPerKm;
    // `safeNumber` coerces null/undefined/NaN/Infinity from the API to 0 so a
    // single bad rollup can't produce NaN bar widths or scramble the sort.
    const mapped = (entries ?? [])
      .map((e) => ({
        id: e.id,
        name: e.name?.trim() || t('quickStats.fleet.unnamed', 'Unnamed'),
        distance: fromKm(safeNumber(e.distance)),
        efficiency: whPerKmToDisplay(safeNumber(e.efficiency)),
      }))
      .sort((a, b) => b.distance - a.distance);
    // `|| 1` guards MetricBar's `value / max` when every vehicle is at 0 km.
    const peak = mapped.reduce((m, r) => Math.max(m, r.distance), 0) || 1;
    return { rows: mapped, maxDistance: peak };
  }, [entries, distanceUnit, t]);

  return (
    <GlassPanel className={cn('p-4 sm:p-5', className)} aria-busy={loading || undefined}>
      <PanelTitle className="mb-3 flex items-center gap-2">
        <Car className="h-4 w-4 text-cyan-300" aria-hidden="true" />
        {t('quickStats.fleet.title', 'Fleet Comparison')}
      </PanelTitle>

      {loading ? (
        <Skeleton height={200} />
      ) : error ? (
        <QueryError error={error} onRetry={onRetry} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Car className="h-8 w-8" />}
          message={t('quickStats.fleet.empty', 'No fleet comparison data yet')}
        />
      ) : (
        <ul className="space-y-3" aria-label={t('quickStats.fleet.title', 'Fleet Comparison')}>
          {rows.map((r, i) => (
            <li key={r.id}>
              <MetricBar
                label={r.name}
                value={r.distance}
                max={maxDistance}
                color={palette[i % palette.length] ?? '#22d3ee'}
                sublabel={`${fmtInt(r.distance)} ${distanceUnit} · ${fmtNumber(r.efficiency)} ${efficiencyUnit}`}
              />
            </li>
          ))}
        </ul>
      )}
    </GlassPanel>
  );
}
