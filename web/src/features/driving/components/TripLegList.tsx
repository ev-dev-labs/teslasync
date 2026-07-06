import { GlassPanel, PanelTitle, Text, Caption } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { MapPin, Zap, Clock, ArrowRight } from 'lucide-react';
import type { TripLeg, TripChargeStop, TripLocation } from '@/types/driving';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface TripLegListProps {
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}

/** Round a possibly-missing number to an integer, treating null/undefined/NaN as 0. */
function roundOrZero(value: number | null | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : 0;
}

/**
 * Human label for a trip endpoint: prefer the geocoded name, fall back to a
 * "lat, lng" pair, and finally an em-dash when neither is usable. Guards against
 * malformed payloads where a location — or its coordinates — is missing, which
 * would otherwise throw on the raw `loc.lat.toFixed()` path.
 */
function locationLabel(loc: TripLocation | null | undefined): string {
  const name = loc?.name?.trim();
  if (name) return name;
  const lat = loc?.lat;
  const lng = loc?.lng;
  if (typeof lat === 'number' && Number.isFinite(lat) && typeof lng === 'number' && Number.isFinite(lng)) {
    return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  }
  return '—';
}

export function TripLegList({ legs, chargeStops }: TripLegListProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatEnergy } = useUnits();
  const { formatCurrency } = useFormatting();
  const distanceUnit = unitPrefs.distance;
  const toDistanceDisplay = (value: number | null | undefined) =>
    convertDistanceFromSI(typeof value === 'number' && Number.isFinite(value) ? value : 0, distanceUnit);

  const legItems = legs ?? [];
  const stops = chargeStops ?? [];

  if (legItems.length === 0) {
    return (
      <GlassPanel className="p-6">
        <PanelTitle className="mb-4">
          {t('tripPlanner.legs.title', 'Route Breakdown')}
        </PanelTitle>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('tripPlanner.legs.empty', 'Plan a trip to see the route breakdown')} />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-6">
      <PanelTitle className="mb-4">
        {t('tripPlanner.legs.title', 'Route Breakdown')}
      </PanelTitle>
      <div className="space-y-3">
        {legItems.map((leg, idx) => {
          const stop = idx < stops.length ? stops[idx] : null;
          const arrivalSoc = roundOrZero(leg.arrival_soc);
          return (
            <FadeIn key={idx} delay={idx * 0.03}>
              <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
                {/* Leg header */}
                <div className="flex items-center gap-2 mb-3">
                  <Text as="span" size="xs" weight="bold" color="primary" className="flex items-center justify-center h-6 w-6 rounded-full bg-[var(--surface-2)]">
                    {idx + 1}
                  </Text>
                  <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)] min-w-0">
                    <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                    <span className="truncate">{locationLabel(leg.from)}</span>
                    <ArrowRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                    <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                    <span className="truncate">{locationLabel(leg.to)}</span>
                  </div>
                </div>
                {/* Leg metrics */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  <div>
                    <Caption>{t('tripPlanner.legs.distance', 'Distance')}</Caption>
                    <Text as="p" weight="medium" color="primary">
                      {toDistanceDisplay(leg.distance_m).toFixed(1)} {distanceUnit}
                    </Text>
                  </div>
                  <div>
                    <Caption>{t('tripPlanner.legs.duration', 'Duration')}</Caption>
                    <Text as="p" weight="medium" color="primary">
                      {roundOrZero((leg.duration_s ?? 0) / 60)} {t('common.min', 'min')}
                    </Text>
                  </div>
                  <div>
                    <Caption>{t('tripPlanner.legs.energy', 'Energy')}</Caption>
                    <Text as="p" weight="medium" color="primary">{formatEnergy(leg.energy_wh, { precision: 1 })}</Text>
                  </div>
                  <div>
                    <Caption>{t('tripPlanner.legs.soc', 'Battery')}</Caption>
                    <Text as="p" weight="medium" color="primary">
                      <span className="text-emerald-400">{roundOrZero(leg.start_soc)}%</span>
                      <span className="text-[var(--text-muted)] mx-1">→</span>
                      <span className={arrivalSoc < 20 ? 'text-rose-400' : 'text-amber-400'}>
                        {arrivalSoc}%
                      </span>
                    </Text>
                  </div>
                </div>
              </div>

              {/* Charging stop after this leg */}
              {stop && (
                <div className="ml-3 mt-2 mb-1 flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                  <Zap aria-hidden="true" className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                  <div className="text-sm">
                    <Text as="p" weight="medium" className="text-blue-300">{stop.name?.trim() || t('tripPlanner.legs.chargeStop', 'Charging stop')}</Text>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[var(--text-secondary)]">
                      <span className="flex items-center gap-1">
                        <Clock aria-hidden="true" className="h-3 w-3" />
                        {roundOrZero((stop.charge_duration_s ?? 0) / 60)} {t('common.min', 'min')}
                      </span>
                      <span>
                        {roundOrZero(stop.charge_from_soc)}% → {roundOrZero(stop.charge_to_soc)}%
                      </span>
                      <span>{formatEnergy(stop.energy_wh, { precision: 1 })}</span>
                      <span className="text-emerald-400">{formatCurrency(stop.cost ?? 0)}</span>
                    </div>
                    {stop.is_recommended && (
                      <Caption className="mt-1 block italic">
                        {t('tripPlanner.legs.recommended', 'Recommended stop point — actual charger locations may vary')}
                      </Caption>
                    )}
                  </div>
                </div>
              )}
            </FadeIn>
          );
        })}
      </div>
    </GlassPanel>
  );
}
