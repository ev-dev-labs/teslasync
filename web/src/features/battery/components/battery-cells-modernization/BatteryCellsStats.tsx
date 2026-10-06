import { useTranslation } from 'react-i18next';
import {
  StatStrip, StatGroup, type StatMetric, type StatPeriod,
} from '@/components/data-display/stat-reference';
import { Badge } from '@/components/ui';
import { knownNumber } from '@/api/dataState';
import type { BatteryCellData, CellReading } from '@/api/hooks/useAnalytics';
import { useUnits } from '@/hooks/useUnits';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';
import { formatTemperatureDelta } from '@/lib/unitConversion';

interface BatteryCellsStatsProps {
  data: BatteryCellData | undefined;
  cells: CellReading[];
  minCell: CellReading | null;
  maxCell: CellReading | null;
  loading: boolean;
  retained: boolean;
  updatedAt: number | null;
  variant: 'overview' | 'temperature' | 'summary';
}

/**
 * Specialist electrical quantities retain their existing scientific precision
 * and units. The shared glossary has no voltage or temperature-delta metric:
 * use its text escape hatch, not a falsely classified absolute temperature.
 * Raw snapshot/cache values are never rewritten.
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
  const imbalance = hasCellSnapshot ? knownNumber(data?.imbalance_mv) : null;
  const spread = knownNumber(data?.temp_spread);
  const missingReason = t('battery.cells.modernization.unknown', 'Measurement unavailable');
  const electrical = (value: unknown, scientific = false, unit = 'V') => {
    const n = knownNumber(value);
    return n == null ? null : `${scientific ? fmtScientificNumber(n, 4) : fmtNumber(n)} ${unit}`;
  };
  const severity = (value: number | null, warning: number, critical: number) => (
    <Badge variant={value == null ? 'neutral' : value > critical ? 'danger' : value > warning ? 'warning' : 'success'} size="sm">
      {value == null ? t('battery.cells.status.unknown', 'Unknown')
        : value > critical ? t('battery.cells.status.significant', 'Significant deviation')
          : value > warning ? t('battery.cells.status.slight', 'Slight deviation')
            : t('battery.cells.status.normal', 'Normal')}
    </Badge>
  );
  const textMetric = (occurrenceId: string, label: string, rawValue: string | null, context?: StatMetric['context']): StatMetric => ({
    metricId: 'text', occurrenceId, label, description: label, rawValue, missingReason, context,
  });
  const total = hasCellSnapshot ? knownNumber(data?.total_cells) : null;
  const cellExtreme = (cell: CellReading | null) =>
    cell == null ? null : `#${cell.cell_number} ${electrical(cell.voltage, true)}`;
  const totalMetric: StatMetric = {
    metricId: 'count', occurrenceId: `${variant}-total`, label: t('battery.cells.kpi.totalCells', 'Total cells'),
    rawValue: total, missingReason,
  };
  const metrics: StatMetric[] = variant === 'temperature' ? [
    textMetric('temperature-average', t('battery.cells.temp.avg', 'Avg temperature'),
      knownNumber(data?.avg_temperature) == null ? null : formatTemperature(data?.avg_temperature)),
    textMetric('temperature-minimum', t('battery.cells.temp.min', 'Min temperature'),
      knownNumber(data?.min_temperature) == null ? null : formatTemperature(data?.min_temperature)),
    textMetric('temperature-maximum', t('battery.cells.temp.max', 'Max temperature'),
      knownNumber(data?.max_temperature) == null ? null : formatTemperature(data?.max_temperature)),
    textMetric('temperature-spread', t('battery.cells.temp.spread', 'Temp spread'),
      spread == null ? null : formatTemperatureDelta(spread, unitPrefs), severity(data?.status === 'no_data' ? null : spread, 3, 5)),
  ] : variant === 'overview' ? [
    totalMetric,
    textMetric('overview-average-voltage', t('battery.cells.kpi.avgVoltage', 'Avg voltage'), hasCellSnapshot ? electrical(data?.avg_voltage, true) : null),
    textMetric('overview-min-cell', t('battery.cells.kpi.minCell', 'Min cell'), cellExtreme(minCell)),
    textMetric('overview-max-cell', t('battery.cells.kpi.maxCell', 'Max cell'), cellExtreme(maxCell)),
    textMetric('overview-imbalance', t('battery.cells.kpi.imbalance', 'Imbalance'), electrical(imbalance, false, 'mV'), severity(imbalance, 5, 15)),
    textMetric('overview-pack-voltage', t('battery.cells.kpi.packVoltage', 'Pack voltage'), electrical(data?.pack_voltage)),
  ] : [
    { ...totalMetric, label: t('battery.cells.stat.totalCells', 'Total cells') },
    textMetric('summary-pack-voltage', t('battery.cells.stat.packVoltage', 'Pack voltage'), electrical(data?.pack_voltage)),
    textMetric('summary-average-voltage', t('battery.cells.stat.avgVoltage', 'Avg cell V'), hasCellSnapshot ? electrical(data?.avg_voltage, true) : null),
    textMetric('summary-voltage-spread', t('battery.cells.stat.voltageSpread', 'V spread'), electrical(imbalance, false, 'mV'), severity(imbalance, 5, 15)),
    textMetric('summary-temperature-spread', t('battery.cells.stat.tempSpread', 'Temp spread'),
      spread == null ? null : formatTemperatureDelta(spread, unitPrefs), severity(data?.status === 'no_data' ? null : spread, 3, 5)),
    textMetric('summary-normal-cells', t('battery.cells.stat.normalCells', 'Normal cells'),
      cells.length === 0 || total == null ? null : `${fmtInt(cells.filter(cell => cell.status === 'normal').length)}/${fmtInt(total)}`),
  ];
  const props = {
    metrics, period: snapshot, loading, retained,
    secondary: t('battery.cells.modernization.signalAvailability', 'Pack and temperature signal availability is not supplied by this endpoint; reported values alone do not establish health.'),
  };
  return variant === 'temperature'
    ? <StatGroup {...props} id="battery-cells-temperature" />
    : <StatStrip {...props} id={`battery-cells-${variant}`}
      title={variant === 'overview' ? t('battery.cells.kpis', 'Summary metrics') : t('battery.cells.summary', 'At a glance')} />;
}
