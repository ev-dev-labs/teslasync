import type { TFunction } from 'i18next';
import type { RepairCorrectionField } from '@/api/hooks/useDataRepair';
import { convertDistanceToSI, convertEnergyFromSI, type UnitPref } from '@/lib/unitConversion';

export function correctionFields(rule: string): RepairCorrectionField[] {
  switch (rule) {
    case 'duration_mismatch':
    case 'negative_aggregate_duration_s':
      return ['duration_s'];
    case 'negative_aggregate_distance_m':
      return ['distance_m'];
    case 'negative_aggregate_energy_used_wh':
      return ['energy_used_wh'];
    case 'negative_aggregate_regen_energy_wh':
      return ['regen_energy_wh'];
    case 'negative_aggregate_total_energy_added_wh':
      return ['total_energy_added_wh'];
    case 'odometer_rollback':
      return ['start_odometer_m', 'end_odometer_m'];
    case 'soc_inconsistent':
      return ['start_soc_pct', 'end_soc_pct'];
    default:
      return [];
  }
}

export function isBoundaryCorrectionRule(rule: string): boolean {
  return rule === 'ended_before_started'
    || rule === 'same_kind_overlap_drive'
    || rule === 'same_kind_overlap_charging'
    || rule === 'cross_kind_overlap_drive_charging';
}

export function correctionCanClear(field: RepairCorrectionField | ''): boolean {
  return field === 'regen_energy_wh' || field === 'start_odometer_m' || field === 'end_odometer_m';
}

export function correctionFieldLabel(
  t: TFunction,
  field: RepairCorrectionField | 'delta_soc_pct' | 'cost_decimal' | 'cost_source' | 'ended_at',
): string {
  switch (field) {
    case 'duration_s': return t('dataRepair.correction.fields.duration', 'Duration');
    case 'distance_m': return t('dataRepair.correction.fields.distance', 'Distance');
    case 'energy_used_wh': return t('dataRepair.correction.fields.energyUsed', 'Energy used');
    case 'regen_energy_wh': return t('dataRepair.correction.fields.regenEnergy', 'Regenerated energy');
    case 'total_energy_added_wh': return t('dataRepair.correction.fields.energyAdded', 'Energy added');
    case 'start_odometer_m': return t('dataRepair.correction.fields.startOdometer', 'Starting odometer');
    case 'end_odometer_m': return t('dataRepair.correction.fields.endOdometer', 'Ending odometer');
    case 'start_soc_pct': return t('dataRepair.correction.fields.startBattery', 'Starting battery');
    case 'end_soc_pct': return t('dataRepair.correction.fields.endBattery', 'Ending battery');
    case 'delta_soc_pct': return t('dataRepair.correction.fields.batteryChange', 'Battery change');
    case 'cost_decimal': return t('dataRepair.correction.fields.estimatedCost', 'Estimated cost');
    case 'cost_source': return t('dataRepair.correction.fields.costSource', 'Cost source');
    case 'ended_at': return t('dataRepair.correction.fields.endTime', 'End time');
  }
}

export function correctionUnit(field: RepairCorrectionField, prefs: UnitPref): string {
  if (field.endsWith('_odometer_m') || field === 'distance_m') return prefs.distance;
  if (field.endsWith('_wh')) return prefs.energy;
  if (field.endsWith('_pct')) return '%';
  return 's';
}

export function correctionValueToSI(
  field: RepairCorrectionField,
  value: number,
  prefs: UnitPref,
): number {
  if (field.endsWith('_odometer_m') || field === 'distance_m') {
    return convertDistanceToSI(value, prefs.distance);
  }
  if (field.endsWith('_wh')) return value / convertEnergyFromSI(1, prefs.energy);
  return value;
}
