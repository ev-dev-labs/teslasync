import { Link } from 'react-router-dom';
import {
  Clock, Zap, DollarSign, TrendingUp,
  Plug, ChevronRight, Home,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Badge } from '@/components/ui';
import { ProgressRing, InlineMetric } from '@/components/data-display';
import { useTranslation } from 'react-i18next';
import { formatDateTime, formatDurationMinutes } from '@/lib/dateFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { fmtNumber, fmtWithUnit, fmtInt } from '@/lib/numberFormat';
import type { ChargingSession } from '@/api/types';

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
  convertDistance: (km: number) => number;
  distanceUnit: string;
  selected?: boolean;
  onToggleSelect?: (id: number, on: boolean) => void;
}

export function ChargingSessionCard({ session, convertDistance, distanceUnit, selected, onToggleSelect }: ChargingSessionCardProps) {
  const { t } = useTranslation('charging');
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('chargerTypes.supercharger', 'Supercharger'),
    dc: t('chargerTypes.dc', 'DC Fast'),
    home: t('chargerTypes.home', 'Home / AC'),
  };

  const batteryGain =
    (session.end_battery_pct ?? session.start_battery_pct) - session.start_battery_pct;
  const avgRate =
    session.duration_min > 0
      ? fmtNumber(session.energy_added_kwh / (session.duration_min / 60))
      : null;
  const cat = getChargerCategory(session.charger_type);
  const costPerKwh =
    session.cost && session.energy_added_kwh > 0
      ? session.cost / session.energy_added_kwh
      : null;
  const milesGained = session.miles_added != null ? convertDistance(session.miles_added) : null;

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
      <GlassPanel hover glow="green" className="p-4 transition-all duration-200 group cursor-pointer">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={session.end_battery_pct ?? session.start_battery_pct}
            max={100}
            size={48}
            strokeWidth={4}
            color={CHARGER_COLORS[cat]}
            label={`${session.end_battery_pct ?? session.start_battery_pct}%`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {formatDateTime(session.start_ts)}
              </p>
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
                value={fmtWithUnit(session.energy_added_kwh ?? 0, 'kWh')}
              />
              <InlineMetric
                icon={<Clock className="h-3 w-3" />}
                value={formatDurationMinutes(session.duration_min)}
              />
              {session.charger_power_kw_max != null && (
                <InlineMetric
                  icon={<TrendingUp className="h-3 w-3" />}
                  value={`${fmtNumber(session.charger_power_kw_max)} kW peak`}
                />
              )}
              {avgRate && (
                <InlineMetric
                  icon={<Plug className="h-3 w-3" />}
                  value={`~${avgRate} kW avg`}
                />
              )}
              {typeof session.cost === 'number' && (
                <InlineMetric
                  icon={<DollarSign className="h-3 w-3" />}
                  value={`$${fmtNumber(session.cost)}`}
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
            {session.charger_location && (
              <div className="mt-1 text-[10px] text-[var(--text-secondary)] flex items-center gap-1 truncate">
                <Home className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{session.charger_location}</span>
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
