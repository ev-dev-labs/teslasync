import { useTranslation } from 'react-i18next';
import {
  type StatMetric, type StatPeriod,
} from '@/components/data-display/stat-reference';
import { Badge } from '@/components/ui';
import { knownNumber } from '@/api/dataState';
import type { BatteryCellData, CellReading } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatTemperatureDelta } from '@/lib/unitConversion';
import { BatteryEvidenceBrief } from '../operationalbrief-all/BatteryEvidenceBrief';

// Endpoint-local extension: the shared hook contract remains owned separately.
export type BatteryCellsSnapshot = BatteryCellData & {
  signal_availability?: Partial<Record<
    'min_voltage' | 'max_voltage' | 'avg_voltage' | 'voltage_spread' | 'imbalance_mv'
    | 'pack_voltage' | 'min_temperature' | 'max_temperature' | 'avg_temperature' | 'temp_spread',
    boolean
  >>;
};

export function batteryCellsHealthValue(
  data: BatteryCellsSnapshot | undefined, field: 'imbalance_mv' | 'temp_spread',
): number | null {
  const value = data?.signal_availability?.[field] === true ? knownNumber(data[field]) : null;
  return value == null ? null : Math.abs(value);
}

type AvailabilityField =
  | 'min_voltage' | 'max_voltage' | 'avg_voltage' | 'voltage_spread' | 'imbalance_mv'
  | 'pack_voltage' | 'min_temperature' | 'max_temperature' | 'avg_temperature' | 'temp_spread';

/**
 * A reading the backend flags unavailable is unknown — never a fabricated
 * zero. The endpoint sends `0` for absent signals with presence tracked
 * separately in `signal_availability`, so a display that trusts the bare
 * value renders "0.0°C"/"0.00 V" for missing measurements. When the
 * endpoint omits `signal_availability` entirely (older responses), values
 * are trusted as before, as is a flag the map does not mention (the
 * backend always sends the complete map, so only an explicit `false`
 * means unavailable). Genuine measured zeros (flag `true`) still render.
 */
export function availableReading(
  data: BatteryCellsSnapshot | undefined, field: AvailabilityField, value: unknown,
): number | null {
  if (data?.signal_availability?.[field] === false) return null;
  return knownNumber(value);
}

interface BatteryCellsStatsProps {
  data: BatteryCellsSnapshot | undefined;
  cells: CellReading[];
  minCell: CellReading | null;
  maxCell: CellReading | null;
  loading: boolean;
  retained: boolean;
  updatedAt: number | null;
  variant: 'overview' | 'temperature' | 'summary';
}

/**
 * Electrical readings and temperature deltas retain numeric inputs and their
 * specialist precision; a delta is never formatted as absolute temperature.
 */
export function BatteryCellsStats({
  data, cells, minCell, maxCell, loading, retained, updatedAt, variant,
}: BatteryCellsStatsProps) {
  const { t } = useTranslation();
  const { unitPrefs, formatTemperature } = useUnits();
  const { fmtInt, fmtNumber, fmtScientificNumber } = useNumberFormatting();
  const snapshot: StatPeriod = {
    kind: 'snapshot',
    label: t('battery.cells.modernization.snapshot', 'Latest available snapshot'),
    observedAt: updatedAt == null ? null : new Date(updatedAt).toISOString(),
    provenance: t('battery.cells.modernization.snapshotSource', 'Vehicle-scoped backend snapshot; cells are synthesized from brick extrema. Request time is not measurement time.'),
  };
  const hasCellSnapshot = data != null && data.status !== 'no_data';
  const imbalance = hasCellSnapshot ? availableReading(data, 'imbalance_mv', data?.imbalance_mv) : null;
  const imbalanceHealth = batteryCellsHealthValue(data, 'imbalance_mv');
  const spreadHealth = batteryCellsHealthValue(data, 'temp_spread');
  const spread = availableReading(data, 'temp_spread', data?.temp_spread);
  const missingReason = t('battery.cells.modernization.unknown', 'Measurement unavailable');
  const electrical = (scientific = false, unit = 'V') => (value: number) =>
    `${scientific ? fmtScientificNumber(value, 4) : fmtNumber(value)} ${unit}`;
  const severity = (value: number | null, warning: number, critical: number) => (
    <Badge variant={value == null ? 'neutral' : value > critical ? 'danger' : value > warning ? 'warning' : 'success'} size="sm">
      {value == null ? t('battery.cells.status.unknown', 'Unknown')
        : value > critical ? t('battery.cells.status.significant', 'Significant deviation')
          : value > warning ? t('battery.cells.status.slight', 'Slight deviation')
            : t('battery.cells.status.normal', 'Normal')}
    </Badge>
  );
  const numericMetric = (occurrenceId: string, label: string, rawValue: number | null,
    formatter: (raw: number) => string, context?: StatMetric['context']): StatMetric => ({
    metricId: 'number', occurrenceId, label, description: label, rawValue, missingReason, context,
    display: { formatter: raw => ({ value: formatter(raw), unit: '' }) },
  });
  const total = hasCellSnapshot ? knownNumber(data?.total_cells) : null;
  const cellExtreme = (cell: CellReading | null) => (raw: number) =>
    `#${cell?.cell_number} ${electrical(true)(raw)}`;
  const totalMetric: StatMetric = {
    metricId: 'count', occurrenceId: `${variant}-total`, label: t('battery.cells.kpi.totalCells', 'Total cells'),
    rawValue: total, missingReason,
  };
  const metrics: StatMetric[] = variant === 'temperature' ? [
    numericMetric('temperature-average', t('battery.cells.temp.avg', 'Avg temperature'),
      availableReading(data, 'avg_temperature', data?.avg_temperature), formatTemperature),
    numericMetric('temperature-minimum', t('battery.cells.temp.min', 'Min temperature'),
      availableReading(data, 'min_temperature', data?.min_temperature), formatTemperature),
    numericMetric('temperature-maximum', t('battery.cells.temp.max', 'Max temperature'),
      availableReading(data, 'max_temperature', data?.max_temperature), formatTemperature),
    numericMetric('temperature-spread', t('battery.cells.temp.spread', 'Temp spread'),
      spread, raw => formatTemperatureDelta(raw, unitPrefs), severity(spreadHealth, 3, 5)),
  ] : variant === 'overview' ? [
    totalMetric,
    numericMetric('overview-average-voltage', t('battery.cells.kpi.avgVoltage', 'Avg voltage'), hasCellSnapshot ? availableReading(data, 'avg_voltage', data?.avg_voltage) : null, electrical(true)),
    numericMetric('overview-min-cell', t('battery.cells.kpi.minCell', 'Min cell'), knownNumber(minCell?.voltage), cellExtreme(minCell)),
    numericMetric('overview-max-cell', t('battery.cells.kpi.maxCell', 'Max cell'), knownNumber(maxCell?.voltage), cellExtreme(maxCell)),
    numericMetric('overview-imbalance', t('battery.cells.kpi.imbalance', 'Imbalance'), imbalance, electrical(false, 'mV'), severity(imbalanceHealth, 5, 15)),
    numericMetric('overview-pack-voltage', t('battery.cells.kpi.packVoltage', 'Pack voltage'), availableReading(data, 'pack_voltage', data?.pack_voltage), electrical()),
  ] : [
    { ...totalMetric, label: t('battery.cells.stat.totalCells', 'Total cells') },
    numericMetric('summary-pack-voltage', t('battery.cells.stat.packVoltage', 'Pack voltage'), availableReading(data, 'pack_voltage', data?.pack_voltage), electrical()),
    numericMetric('summary-average-voltage', t('battery.cells.stat.avgVoltage', 'Avg cell V'), hasCellSnapshot ? availableReading(data, 'avg_voltage', data?.avg_voltage) : null, electrical(true)),
    numericMetric('summary-voltage-spread', t('battery.cells.stat.voltageSpread', 'V spread'), imbalance, electrical(false, 'mV'), severity(imbalanceHealth, 5, 15)),
    numericMetric('summary-temperature-spread', t('battery.cells.stat.tempSpread', 'Temp spread'),
      spread, raw => formatTemperatureDelta(raw, unitPrefs), severity(spreadHealth, 3, 5)),
    { metricId: 'count', occurrenceId: 'summary-normal-cells', label: t('battery.cells.stat.normalCells', 'Normal cells'),
      rawValue: cells.length === 0 || total == null ? null : cells.filter(cell => cell.status === 'normal').length,
      display: { formatter: raw => ({ value: `${fmtInt(raw)}/${fmtInt(total)}`, unit: '' }) } },
  ];
  const props = {
    metrics, period: snapshot, loading, retained,
    secondary: data?.signal_availability == null
      ? t('battery.cells.modernization.signalAvailability', 'Pack and temperature signal availability is not supplied by this endpoint; reported values alone do not establish health.')
      : undefined,
  };
  if (variant === 'temperature') {
    return <BatteryEvidenceBrief {...props} id="battery-cells-temperature" title={t('battery.cells.temp.title', 'Temperature summary')} />;
  }
  const title = variant === 'overview'
    ? t('battery.cells.kpis', 'Summary metrics')
    : t('battery.cells.summary', 'At a glance');
  return (
    <section>
      <BatteryEvidenceBrief {...props} id={`battery-cells-${variant}`} title={title} />
    </section>
  );
}
