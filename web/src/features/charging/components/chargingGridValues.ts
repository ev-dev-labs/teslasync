import type { ChargingSession } from '@/api/types';
import { endpointLabel } from '@/components/data-display';
import {
  parseTableValueSelections, type TableValueSelections,
} from '@/components/ui';
import {
  batteryFriendlyScore, durationMinutes, getChargerCategory, sessionAveragePowerW,
} from '@/lib/chargingAggregation';
import { distanceAddedM } from './charging-curve/helpers';

export const CHARGING_VALUE_COLUMNS = [
  'date', 'location', 'charger', 'duration', 'energy', 'power', 'peakPower',
  'batteryStart', 'batteryEnd', 'range', 'cost', 'rate', 'score',
] as const;
export type ChargingValueColumn = typeof CHARGING_VALUE_COLUMNS[number];
export type ChargingValueSelections = TableValueSelections<ChargingValueColumn>;

export function parseChargingValueSelections(raw: string) {
  return parseTableValueSelections(raw, CHARGING_VALUE_COLUMNS);
}

const finite = (value: number | null): number | null =>
  value != null && Number.isFinite(value) ? value : null;

export function chargingColumnValue(session: ChargingSession, column: ChargingValueColumn): string | number | null {
  switch (column) {
    case 'date': return Number.isFinite(Date.parse(session.started_at)) ? session.started_at : null;
    case 'location': return endpointLabel({ address: session.start_place, lat: session.start_lat, lon: session.start_lng });
    case 'charger': {
      const category = getChargerCategory(session.charger_type);
      return category === 'unknown' ? session.charger_type : category;
    }
    case 'duration': return durationMinutes(session) > 0 ? durationMinutes(session) * 60 : null;
    case 'energy': return finite(session.total_energy_added_wh);
    case 'power': return sessionAveragePowerW(session);
    case 'peakPower': return finite(session.peak_power_w);
    case 'batteryStart': return finite(session.start_soc_pct);
    case 'batteryEnd': return finite(session.end_soc_pct);
    case 'range': return finite(distanceAddedM(session));
    case 'cost': return finite(session.cost_decimal);
    case 'rate': return session.cost_decimal != null && session.total_energy_added_wh > 0
      ? finite(session.cost_decimal / (session.total_energy_added_wh / 1000)) : null;
    case 'score': return batteryFriendlyScore([session]);
  }
}
