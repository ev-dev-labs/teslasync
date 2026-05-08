import { GlassPanel } from '@/components/ui';
import { EmptyState } from '@/components/feedback';
import { FadeIn } from '@/components/motion';
import { useTranslation } from 'react-i18next';
import { useUnits } from '@/hooks/useUnits';
import { MapPin, Zap, Clock, ArrowRight } from 'lucide-react';
import type { TripLeg, TripChargeStop } from '@/types/driving';
import { convertDistanceFromSI } from '@/lib/unitConversion';

interface TripLegListProps {
  legs: TripLeg[];
  chargeStops: TripChargeStop[];
}

export function TripLegList({ legs, chargeStops }: TripLegListProps) {
  const { t } = useTranslation();
  const { unitPrefs } = useUnits();
  const toDistanceDisplay = (value: number) => convertDistanceFromSI(value, unitPrefs.distance);

  const distanceUnit = unitPrefs.distance;
  const legItems = legs ?? [];
  const stops = chargeStops ?? [];

  if (legItems.length === 0) {
    return (
      <GlassPanel className="p-6">
        <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
          {t('tripPlanner.legs.title', 'Route Breakdown')}
        </h3>
        <EmptyState /* no-action: transient empty state — surfaces when source data is missing; no specific recovery action available */ message={t('tripPlanner.legs.empty', 'Plan a trip to see the route breakdown')} />
      </GlassPanel>
    );
  }

  return (
    <GlassPanel className="p-6">
      <h3 className="text-lg font-semibold text-[var(--text-primary)] mb-4">
        {t('tripPlanner.legs.title', 'Route Breakdown')}
      </h3>
      <div className="space-y-3">
        {legItems.map((leg, idx) => (
          <FadeIn key={idx} delay={idx * 0.03}>
            <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-4">
              {/* Leg header */}
              <div className="flex items-center gap-2 mb-3">
                <span className="flex items-center justify-center h-6 w-6 rounded-full bg-[var(--surface-2)] text-xs font-bold text-[var(--text-primary)]">
                  {idx + 1}
                </span>
                <div className="flex items-center gap-1 text-sm text-[var(--text-secondary)] min-w-0">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                  <span className="truncate">{leg.from.name || `${leg.from.lat.toFixed(2)}, ${leg.from.lng.toFixed(2)}`}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-[var(--text-muted)]" />
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-400" />
                  <span className="truncate">{leg.to.name || `${leg.to.lat.toFixed(2)}, ${leg.to.lng.toFixed(2)}`}</span>
                </div>
              </div>
              {/* Leg metrics */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('tripPlanner.legs.distance', 'Distance')}</span>
                  <p className="text-[var(--text-primary)] font-medium">
                    {toDistanceDisplay(leg.distance_km).toFixed(1)} {distanceUnit}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('tripPlanner.legs.duration', 'Duration')}</span>
                  <p className="text-[var(--text-primary)] font-medium">
                    {Math.round(leg.duration_min)} {t('common.min', 'min')}
                  </p>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('tripPlanner.legs.energy', 'Energy')}</span>
                  <p className="text-[var(--text-primary)] font-medium">{leg.energy_kwh.toFixed(1)} kWh</p>
                </div>
                <div>
                  <span className="text-[var(--text-muted)] text-xs">{t('tripPlanner.legs.soc', 'Battery')}</span>
                  <p className="text-[var(--text-primary)] font-medium">
                    <span className="text-emerald-400">{Math.round(leg.start_soc)}%</span>
                    <span className="text-[var(--text-muted)] mx-1">→</span>
                    <span className={leg.arrival_soc < 20 ? 'text-rose-400' : 'text-amber-400'}>
                      {Math.round(leg.arrival_soc)}%
                    </span>
                  </p>
                </div>
              </div>
            </div>

            {/* Charging stop after this leg */}
            {idx < stops.length && (
              <div className="ml-3 mt-2 mb-1 flex items-start gap-2 rounded-lg border border-blue-500/20 bg-blue-500/5 p-3">
                <Zap className="h-4 w-4 shrink-0 text-blue-400 mt-0.5" />
                <div className="text-sm">
                  <p className="text-blue-300 font-medium">{stops[idx].name}</p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-[var(--text-secondary)]">
                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      {Math.round(stops[idx].charge_duration_min)} {t('common.min', 'min')}
                    </span>
                    <span>
                      {Math.round(stops[idx].charge_from_soc)}% → {Math.round(stops[idx].charge_to_soc)}%
                    </span>
                    <span>{stops[idx].energy_kwh.toFixed(1)} kWh</span>
                    <span className="text-emerald-400">${stops[idx].cost.toFixed(2)}</span>
                  </div>
                  {stops[idx].is_recommended && (
                    <p className="text-xs text-[var(--text-muted)] mt-1 italic">
                      {t('tripPlanner.legs.recommended', 'Recommended stop point — actual charger locations may vary')}
                    </p>
                  )}
                </div>
              </div>
            )}
          </FadeIn>
        ))}
      </div>
    </GlassPanel>
  );
}
