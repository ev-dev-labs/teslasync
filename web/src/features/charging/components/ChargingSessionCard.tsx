import { Link } from 'react-router-dom';
import {
  Clock, Zap, DollarSign, TrendingUp,
  Plug, ChevronRight, Home,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Badge } from '@/components/ui';
import { ProgressRing, InlineMetric, TimeStamp } from '@/components/data-display';
import { useTranslation } from 'react-i18next';
import { formatDurationMinutes } from '@/lib/dateFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { fmtNumber, fmtWithUnit, fmtInt } from '@/lib/numberFormat';
import type { ChargingSession } from '@/api/types';
import { distanceAddedM, durationMinutes } from './charging-curve/helpers';

type ChargerCategory = 'supercharger' | 'dc' | 'home';

export function getChargerCategory(type: string | null): ChargerCategory {
  if (type && type.toLowerCase().includes('tesla')) return 'supercharger';
  if (
    type &&
    (type.toLowerCase().includes('dc') ||
      type.toLowerCase().includes('ccs') ||
      type.toLowerCase().includes('chademo'))
  )
    return 'dc';
  return 'home';
}

export { formatDurationMinutes as formatDuration };

interface ChargingSessionCardProps {
  session: ChargingSession;
  toDistanceDisplay: (km: number) => number;
  distanceUnit: string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
}

export function ChargingSessionCard({ session, toDistanceDisplay, distanceUnit, selected, onToggleSelect }: ChargingSessionCardProps) {
  const { t } = useTranslation('charging');
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('chargerTypes.supercharger', 'Supercharger'),
    dc: t('chargerTypes.dc', 'DC Fast'),
    home: t('chargerTypes.home', 'Home / AC'),
  };

  const batteryGain =
    (session.end_soc_pct ?? session.start_soc_pct ?? 0) - (session.start_soc_pct ?? 0);
  const durationMin = durationMinutes(session.started_at, session.ended_at);
  const avgRate =
    durationMin > 0
      ? fmtNumber((session.total_energy_added_wh ?? 0) / 1000 / (durationMin / 60))
      : null;
  const cat = getChargerCategory(session.charger_type);
  const costPerKwh =
    session.cost_decimal && (session.total_energy_added_wh ?? 0) > 0
      ? session.cost_decimal / ((session.total_energy_added_wh ?? 0) / 1000)
      : null;
  const addedM = distanceAddedM(session);
  const milesGained = addedM != null ? toDistanceDisplay(addedM / 1000) : null;

  const startSoc = session.start_soc_pct;
  const endSoc = session.end_soc_pct ?? session.start_soc_pct;
  const ringValue = endSoc ?? 0;
  const ringCenter = endSoc != null ? `${endSoc}%` : '—';
  const ringFootnote =
    startSoc != null && session.end_soc_pct != null && startSoc !== session.end_soc_pct
      ? `${startSoc}→${session.end_soc_pct}`
      : undefined;

  const showCheckbox = typeof onToggleSelect === 'function';

  return (
    <div className="flex items-stretch gap-2">
      {showCheckbox && (
        <label className="flex items-center pl-2">
          <input
            type="checkbox"
            className="h-4 w-4 cursor-pointer rounded border-[var(--border-strong)] bg-white/[0.04] text-emerald-500 focus:ring-2 focus:ring-emerald-500"
            checked={!!selected}
            onChange={e => onToggleSelect?.(session.id, e.target.checked)}
            aria-label={t('selectSession', 'Select charging session')}
          />
        </label>
      )}
      <Link to={`/charging/${session.id}`} className="flex-1 min-w-0">
      <GlassPanel hover glow="green" className="p-4 transition-all duration-normal group cursor-pointer">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={ringValue}
            max={100}
            size={56}
            strokeWidth={4}
            color={CHARGER_COLORS[cat]}
            centerLabel={ringCenter}
            label={ringFootnote}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <TimeStamp value={session.started_at} className="text-sm font-semibold text-[var(--text-primary)]" />
              <Badge
                variant={cat === 'supercharger' ? 'danger' : cat === 'dc' ? 'warning' : 'success'}
              >
                {chargerLabels[cat]}
              </Badge>
              {batteryGain > 0 && (
                <span className="text-xs text-emerald-300 font-medium">+{batteryGain}%</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <InlineMetric
                icon={<Zap className="h-3 w-3" />}
                value={fmtWithUnit((session.total_energy_added_wh ?? 0) / 1000, 'kWh')}
              />
              <InlineMetric
                icon={<Clock className="h-3 w-3" />}
                value={formatDurationMinutes(durationMin)}
              />
              {session.peak_power_w != null && (
                <InlineMetric
                  icon={<TrendingUp className="h-3 w-3" />}
                  value={`${fmtNumber(session.peak_power_w / 1000)} kW peak`}
                />
              )}
              {avgRate && (
                <InlineMetric
                  icon={<Plug className="h-3 w-3" />}
                  value={`~${avgRate} kW avg`}
                />
              )}
               {typeof session.cost_decimal === 'number' && (
                <InlineMetric
                  icon={<DollarSign className="h-3 w-3" />}
                   value={`$${fmtNumber(session.cost_decimal)}`}
                  className="text-emerald-300"
                />
              )}
              {typeof costPerKwh === 'number' && (
                <span className="text-[var(--text-muted)]">(${fmtNumber(costPerKwh)}/kWh)</span>
              )}
              {typeof milesGained === 'number' && milesGained > 0 && (
                <span className="flex items-center gap-1 text-purple-300">
                  +{fmtInt(milesGained)} {distanceUnit}
                </span>
              )}
            </div>
            {session.start_place && (
              <div className="mt-1 text-[10px] text-[var(--text-secondary)] flex items-center gap-1 truncate">
                <Home className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{session.start_place}</span>
              </div>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-neon-green transition-colors" />
        </div>
      </GlassPanel>
    </Link>
    </div>
  );
}
