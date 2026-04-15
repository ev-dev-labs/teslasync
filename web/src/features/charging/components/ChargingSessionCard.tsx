import { Link } from 'react-router-dom';
import {
  Clock, Zap, DollarSign, TrendingUp,
  Plug, ChevronRight, Home, Cable, Activity, Gauge,
} from 'lucide-react';
import { GlassPanel } from '@/components/ui';
import { Badge } from '@/components/ui';
import { ProgressRing, InlineMetric } from '@/components/data-display';
import { useTranslation } from 'react-i18next';
import { formatDateTime } from '@/lib/dateFormat';
import { CHARGER_COLORS } from '@/lib/colors';
import { fmtNumber, fmtWithUnit, fmtPercent, fmtInt } from '@/lib/numberFormat';
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

export function formatDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = fmtInt(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

interface ChargingSessionCardProps {
  session: ChargingSession;
  convertDistance: (km: number) => number;
  distanceUnit: string;
}

export function ChargingSessionCard({ session, convertDistance, distanceUnit }: ChargingSessionCardProps) {
  const { t } = useTranslation('charging');
  const chargerLabels: Record<ChargerCategory, string> = {
    supercharger: t('chargerTypes.supercharger', 'Supercharger'),
    dc: t('chargerTypes.dc', 'DC Fast'),
    home: t('chargerTypes.home', 'Home / AC'),
  };

  const batteryGain =
    (session.end_battery_level ?? session.start_battery_level) - session.start_battery_level;
  const avgRate =
    session.duration_min > 0
      ? fmtNumber(session.charge_energy_added / (session.duration_min / 60))
      : null;
  const cat = getChargerCategory(session.fast_charger_type);
  const costPerKwh =
    session.cost && session.charge_energy_added > 0
      ? session.cost / session.charge_energy_added
      : null;
  const efficiency =
    session.charge_energy_added > 0 &&
    session.charge_energy_used &&
    session.charge_energy_used > 0
      ? (session.charge_energy_added / session.charge_energy_used) * 100
      : null;
  const rangeGained =
    session.start_range_km != null && session.end_range_km != null
      ? convertDistance(session.end_range_km - session.start_range_km)
      : null;
  const chargerSpec = [
    session.charger_voltage != null ? `${session.charger_voltage}V` : null,
    session.charger_phases != null ? `${session.charger_phases}-phase` : null,
    session.charger_actual_current != null ? `${session.charger_actual_current}A` : null,
  ]
    .filter(Boolean)
    .join(' / ');

  return (
    <Link to={`/charging/${session.id}`}>
      <GlassPanel hover glow="green" className="p-4 transition-all duration-200 group cursor-pointer">
        <div className="flex items-center gap-4">
          <ProgressRing
            value={session.end_battery_level ?? session.start_battery_level}
            max={100}
            size={48}
            strokeWidth={4}
            color={CHARGER_COLORS[cat]}
            label={`${session.end_battery_level ?? session.start_battery_level}%`}
          />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-1 flex-wrap">
              <p className="text-sm font-semibold text-[var(--text-primary)]">
                {formatDateTime(session.start_date)}
              </p>
              <Badge
                variant={cat === 'supercharger' ? 'danger' : cat === 'dc' ? 'warning' : 'success'}
              >
                {chargerLabels[cat]}
              </Badge>
              {session.conn_charge_cable && (
                <Badge variant="info">
                  <Cable className="h-2.5 w-2.5 inline mr-0.5" />
                  {session.conn_charge_cable}
                </Badge>
              )}
              {batteryGain > 0 && (
                <span className="text-xs text-neon-green font-medium">+{batteryGain}%</span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)]">
              <InlineMetric
                icon={<Zap className="h-3 w-3" />}
                value={fmtWithUnit(session.charge_energy_added ?? 0, 'kWh')}
              />
              <InlineMetric
                icon={<Clock className="h-3 w-3" />}
                value={formatDuration(session.duration_min)}
              />
              {session.charger_power != null && (
                <InlineMetric
                  icon={<TrendingUp className="h-3 w-3" />}
                  value={`${fmtNumber(session.charger_power)} kW peak`}
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
                  className="text-neon-green"
                />
              )}
              {typeof costPerKwh === 'number' && (
                <span className="text-[var(--text-muted)]">(${fmtNumber(costPerKwh)}/kWh)</span>
              )}
              {typeof efficiency === 'number' && (
                <InlineMetric
                  icon={<Activity className="h-3 w-3" />}
                  value={`${fmtPercent(efficiency)} eff`}
                  className="text-neon-cyan"
                />
              )}
              {typeof rangeGained === 'number' && rangeGained > 0 && (
                <span className="flex items-center gap-1 text-neon-purple">
                  +{fmtInt(rangeGained)} {distanceUnit}
                </span>
              )}
            </div>
            {chargerSpec && (
              <div className="mt-1 text-[10px] text-[var(--text-muted)]">
                <Gauge className="h-2.5 w-2.5 inline mr-1" />
                {chargerSpec}
                {session.fast_charger_brand && (
                  <span className="ml-2">· {session.fast_charger_brand}</span>
                )}
              </div>
            )}
            {session.location_name && (
              <div className="mt-1 text-[10px] text-[var(--text-secondary)] flex items-center gap-1 truncate">
                <Home className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{session.location_name}</span>
              </div>
            )}
          </div>
          <ChevronRight className="h-4 w-4 text-gray-700 group-hover:text-neon-green transition-colors" />
        </div>
      </GlassPanel>
    </Link>
  );
}
