import { getChargerCategory } from './chargingAggregation';

export type ChargerKind = 'supercharger' | 'dcFast' | 'acHome' | 'ac' | 'unknown';

export function classifyChargingSource(charger: Parameters<typeof getChargerCategory>[0]): ChargerKind {
  switch (getChargerCategory(charger)) {
    case 'supercharger':
      return 'supercharger';
    case 'dc':
      return 'dcFast';
    case 'home':
      return 'acHome';
    case 'ac':
      return 'ac';
    default:
      return 'unknown';
  }
}
