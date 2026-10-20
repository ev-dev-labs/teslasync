export type ChargerKind = 'supercharger' | 'dcFast' | 'acHome' | 'unknown';

export function classifyChargingSource(chargerType: string | null | undefined): ChargerKind {
  switch (chargerType?.trim().toLowerCase()) {
    case 'supercharger':
      return 'supercharger';
    case 'dc':
      return 'dcFast';
    case 'ac':
      return 'acHome';
    default:
      return 'unknown';
  }
}
