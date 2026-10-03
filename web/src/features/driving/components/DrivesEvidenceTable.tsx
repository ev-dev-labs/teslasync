import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { AlertTriangle, Eye } from 'lucide-react';
import { Badge, Button, DataTable, DataTableValueFilter, Input, Select, buildTableFilterValues, selectedTableValueKeys, type Column } from '@/components/ui';
import { endpointLabel } from '@/components/data-display';
import { formatDateTime, formatDurationMinutes } from '@/lib/dateFormat';

import { getEfficiency, gradeFromEfficiency } from '@/lib/drivesAggregation';
import type { Drive } from '@/types/driving';
import type { DriveFsdInsight } from '@/types/fsd';
import { DriveGridMetric } from './DriveGridMetric';
import { driveAverageSpeed, driveBattery } from './driveGridMetrics';
import { DRIVE_VALUE_COLUMNS, driveColumnValue, driveStatusFlags, type DriveValueColumn, type DriveValueSelections } from './driveGridValues';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export const DRIVE_GRID_SORT_KEYS = ['date', 'route', 'start', 'destination', 'distance', 'duration', 'speed', 'maxSpeed', 'avgPower', 'outsideTemp', 'insideTemp', 'efficiency', 'grade', 'battery', 'startBattery', 'batteryUsed', 'energy', 'regen', 'score', 'cost', 'fsd'] as const;
export type DriveGridSortKey = typeof DRIVE_GRID_SORT_KEYS[number];
export type DriveGridFilterKey = 'start' | 'destination' | 'distance' | 'duration' | 'speed' | 'maxSpeed' | 'avgPower' | 'outsideTemp' | 'insideTemp' | 'grade' | 'battery' | 'startBattery' | 'batteryUsed' | 'energy' | 'regen' | 'score';
export type DriveGridFilters = Record<DriveGridFilterKey, string>;

interface DrivesEvidenceTableProps {
  drives: Drive[];
  availableDrives: Drive[];
  valueSelections: DriveValueSelections;
  invalidValueSelection: boolean;
  onValueSelectionChange: (column: DriveValueColumn, values: string[] | null) => void;
  onValueFilterClear: (column: DriveValueColumn) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  onPreview: (drive: Drive) => void;
  sortBy: DriveGridSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: DriveGridSortKey) => void;
  search: string;
  onSearchChange: (value: string) => void;
  collection: string;
  onCollectionChange: (value: string) => void;
  onDriveFilterClear: () => void;
  fsdFilter: string;
  onFsdFilterChange: (value: string) => void;
  filters: DriveGridFilters;
  onFilterChange: (key: DriveGridFilterKey, value: string) => void;
  toDistanceDisplay: (meters: number) => number;
  toSpeedDisplay: (metersPerSecond: number) => number;
  toEfficiencyDisplay: (whPerKm: number) => number;
  toTemperatureDisplay: (celsius: number) => number;
  toPowerDisplay: (watts: number) => number;
  formatEnergy: (wh: number) => string;
  formatEnergyCost: (kwh: number) => string;
  distanceUnit: string;
  speedUnit: string;
  efficiencyUnit: string;
  temperatureUnit: string;
  powerUnit: string;
  timezone: string;
  fsdAvailable: boolean;
  fsdByDriveID: ReadonlyMap<number, DriveFsdInsight>;
  anomalyDriveIds: ReadonlySet<number>;
  toolbarActions?: ReactNode;
  toolbarHeading?: ReactNode;
}

export function DrivesEvidenceTable({
  drives, availableDrives, valueSelections, invalidValueSelection, onValueSelectionChange, onValueFilterClear,
  selectedIds, onSelectionChange, onPreview, sortBy, sortDir, onSort,
  search, onSearchChange, collection, onCollectionChange, onDriveFilterClear, fsdFilter, onFsdFilterChange, filters, onFilterChange,
  toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay, toTemperatureDisplay, toPowerDisplay, formatEnergy, formatEnergyCost,
  distanceUnit, speedUnit, efficiencyUnit, temperatureUnit, powerUnit,
  timezone, fsdAvailable, fsdByDriveID, anomalyDriveIds, toolbarActions, toolbarHeading,
}: DrivesEvidenceTableProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const statusLabels = useMemo(() => ({
    inProgress: t('drives.inProgress', 'In progress'),
    noTelemetry: t('drives.noTelemetry', 'No telemetry'),
    highSpeed: t('drives.highSpeed', 'High speed'),
    highEnergyUse: t('drives.highEnergyUse', 'High energy use'),
  }), [t]);
  const driveWarnings = useCallback((drive: Drive) =>
    driveStatusFlags(drive, anomalyDriveIds.has(drive.id))
      .filter((flag) => flag !== 'inProgress').map((flag) => statusLabels[flag]),
  [anomalyDriveIds, statusLabels]);
  const numberFilter = (key: Exclude<DriveGridFilterKey, 'grade' | 'start' | 'destination'>, label: string, unit: string) => (
    <Input
      size="sm"
      type="number"
      min={key === 'outsideTemp' || key === 'insideTemp' || key === 'avgPower' || key === 'batteryUsed' ? undefined : 0}
      step="any"
      value={filters[key]}
      onChange={(event) => onFilterChange(key, event.target.value)}
      aria-label={t('drives.grid.minFilter', 'Minimum {{label}} ({{unit}})', { label, unit })}
      placeholder={t('drives.grid.min', 'Min')}
      className="min-w-20 text-xs"
    />
  );
  const columns = useMemo<Column<Drive>[]>(() => [
    {
      key: 'date',
      header: t('drives.grid.dateTime', 'Date / time'),
      sortable: true,
      defaultWidth: 210,
      minWidth: 190,
      render: (drive) => {
        const warnings = driveWarnings(drive).join(' · ');
        const date = formatDateTime(drive.startTs, { tz: timezone });
        return (
          <div className="flex min-w-0 items-center gap-2">
            <Link
              className="truncate font-medium text-[var(--text-primary)] hover:underline focus-visible:underline"
              title={date}
              to={`/drives/${drive.id}`}
            >
              {date}
            </Link>
            {drive.endTs == null && <Badge variant="success" size="sm" className="shrink-0">{t('drives.inProgress', 'In progress')}</Badge>}
            {warnings && (
              <span title={warnings} className="shrink-0 text-amber-700 dark:text-amber-300">
                <AlertTriangle className="h-3.5 w-3.5" role="img" aria-label={warnings} />
              </span>
            )}
          </div>
        );
      },
      filterActive: search !== '' || collection !== 'all',
      onFilterClear: onDriveFilterClear,
      filter: (
        <div className="space-y-1.5">
          <Input
            size="sm"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            aria-label={t('drives.grid.search', 'Search drive or route')}
            placeholder={t('drives.grid.searchPlaceholder', 'Search route or grade')}
            className="text-xs"
          />
          <Select
            size="sm"
            value={collection}
            onChange={(event) => onCollectionChange(event.target.value)}
            aria-label={t('drives.collections.aria', 'Filter drives by collection')}
            className="text-xs"
            options={[
              { value: 'all', label: t('drives.coll.all', 'All drives') },
              { value: 'anomalies', label: t('drives.coll.anomalies', 'Anomalies') },
              { value: 'notable', label: t('drives.coll.notable', 'Notable') },
              { value: 'commutes', label: t('drives.coll.commutes', 'Commutes') },
              { value: 'tagged', label: t('drives.coll.tagged', 'Tagged'), disabled: true },
            ]}
          />
        </div>
      ),
    },
    ...(['start', 'destination'] as const).map((key): Column<Drive> => {
      const label = key === 'start' ? t('drives.grid.start', 'Start') : t('drives.grid.destination', 'Destination');
      return {
        key,
        header: label,
        sortable: true,
        defaultWidth: 175,
        minWidth: 120,
        filterActive: filters[key] !== '',
        onFilterClear: () => onFilterChange(key, ''),
        filter: (
          <Input
            size="sm"
            value={filters[key]}
            onChange={(event) => onFilterChange(key, event.target.value)}
            aria-label={t('drives.grid.locationFilter', 'Filter {{location}}', { location: label })}
            placeholder={t('drives.grid.contains', 'Contains')}
          />
        ),
        render: (drive) => {
          const location = endpointLabel(key === 'start'
            ? { address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }
            : { address: drive.endAddress, lat: drive.endLat, lon: drive.endLon });
          return <div className="truncate text-[var(--text-secondary)]" title={location ?? undefined}>{location ?? '—'}</div>;
        },
      };
    }),
    {
      key: 'distance',
      header: `${t('drives.distance', 'Distance')} (${distanceUnit})`,
      sortable: true,
      defaultWidth: 145,
      align: 'right',
      filterActive: filters.distance !== '',
      onFilterClear: () => onFilterChange('distance', ''),
      filter: numberFilter('distance', t('drives.distance', 'Distance'), distanceUnit),
      render: (drive) => drive.distanceM > 0 ? fmtNumber(toDistanceDisplay(drive.distanceM)) : '—',
    },
    {
      key: 'duration',
      header: t('drives.duration', 'Duration'),
      sortable: true,
      defaultWidth: 135,
      align: 'right',
      filterActive: filters.duration !== '',
      onFilterClear: () => onFilterChange('duration', ''),
      filter: numberFilter('duration', t('drives.duration', 'Duration'), t('drives.grid.minutes', 'minutes')),
      render: (drive) => formatDurationMinutes(drive.durationS / 60),
    },
    {
      key: 'speed',
      header: `${t('drives.grid.avgSpeed', 'Avg speed')} (${speedUnit})`,
      sortable: true,
      defaultWidth: 165,
      align: 'right',
      filterActive: filters.speed !== '',
      onFilterClear: () => onFilterChange('speed', ''),
      filter: numberFilter('speed', t('drives.speed', 'Speed'), speedUnit),
      render: (drive) => {
        const average = driveAverageSpeed(drive);
        return average != null ? fmtInt(toSpeedDisplay(average)) : '—';
      },
    },
    {
      key: 'maxSpeed',
      header: `${t('drives.grid.maxSpeed', 'Max speed')} (${speedUnit})`,
      sortable: true,
      defaultWidth: 165,
      align: 'right',
      filterActive: filters.maxSpeed !== '',
      onFilterClear: () => onFilterChange('maxSpeed', ''),
      filter: numberFilter('maxSpeed', t('drives.grid.maxSpeed', 'Max speed'), speedUnit),
      render: (drive) => drive.maxSpeedMps != null ? fmtInt(toSpeedDisplay(drive.maxSpeedMps)) : '—',
    },
    {
      key: 'avgPower',
      header: `${t('drives.grid.avgPower', 'Avg power')} (${powerUnit})`,
      sortable: true,
      defaultWidth: 165,
      align: 'right',
      filterActive: filters.avgPower !== '',
      onFilterClear: () => onFilterChange('avgPower', ''),
      filter: numberFilter('avgPower', t('drives.grid.avgPower', 'Avg power'), powerUnit),
      render: (drive) => drive.avgPowerW != null ? fmtNumber(toPowerDisplay(drive.avgPowerW)) : '—',
    },
    ...(['outsideTemp', 'insideTemp'] as const).map((key): Column<Drive> => {
      const label = key === 'outsideTemp' ? t('drives.grid.outsideTemp', 'Outside temp') : t('drives.grid.insideTemp', 'Cabin temp');
      return {
        key,
        header: `${label} (${temperatureUnit})`,
        sortable: true,
        defaultVisible: key === 'outsideTemp',
        defaultWidth: 160,
        align: 'right',
        filterActive: filters[key] !== '',
        onFilterClear: () => onFilterChange(key, ''),
        filter: numberFilter(key, label, temperatureUnit),
        render: (drive) => {
          const value = key === 'outsideTemp' ? drive.outsideTempAvgC : drive.insideTempAvgC;
          return value != null ? fmtNumber(toTemperatureDisplay(value)) : '—';
        },
      };
    }),
    {
      key: 'efficiency',
      header: `${t('drives.grid.efficiency', 'Efficiency')} (${efficiencyUnit})`,
      sortable: true,
      defaultWidth: 185,
      align: 'right',
      filterActive: filters.grade !== '',
      onFilterClear: () => onFilterChange('grade', ''),
      filter: (
        <Select
          size="sm"
          value={filters.grade}
          onChange={(event) => onFilterChange('grade', event.target.value)}
          aria-label={t('drives.grid.gradeFilter', 'Filter by efficiency grade')}
          className="text-xs"
          options={[
            { value: '', label: t('drives.grid.allGrades', 'All grades') },
            ...['A+', 'A', 'B', 'C', 'D', '—'].map((grade) => ({ value: grade, label: grade })),
          ]}
        />
      ),
      render: (drive) => {
        const efficiency = getEfficiency(drive);
        return (
          <DriveGridMetric kind="efficiency" value={efficiency} scaleLabel="">
            {efficiency != null ? fmtInt(toEfficiencyDisplay(efficiency)) : '—'}
          </DriveGridMetric>
        );
      },
    },
    {
      key: 'startBattery',
      header: t('drives.grid.startBattery', 'Battery start (%)'),
      sortable: true,
      defaultWidth: 160,
      align: 'right',
      filterActive: filters.startBattery !== '',
      onFilterClear: () => onFilterChange('startBattery', ''),
      filter: numberFilter('startBattery', t('drives.grid.startBattery', 'Battery start (%)'), '%'),
      render: (drive) => {
        const { start } = driveBattery(drive);
        return (
          <DriveGridMetric kind="battery" value={start} scaleLabel={t('drives.grid.batteryScale', 'Bar represents battery level out of 100%')}>
            {start != null ? fmtNumber(start) : '—'}
          </DriveGridMetric>
        );
      },
    },
    {
      key: 'battery',
      header: t('drives.grid.endBatteryColumn', 'Battery end (%)'),
      sortable: true,
      defaultWidth: 155,
      align: 'right',
      filterActive: filters.battery !== '',
      onFilterClear: () => onFilterChange('battery', ''),
      filter: numberFilter('battery', t('drives.grid.endBattery', 'End battery'), '%'),
      render: (drive) => {
        const { end } = driveBattery(drive);
        return (
          <DriveGridMetric kind="battery" value={end} scaleLabel={t('drives.grid.batteryScale', 'Bar represents battery level out of 100%')}>
            {end != null ? fmtNumber(end) : '—'}
          </DriveGridMetric>
        );
      },
    },
    {
      key: 'batteryUsed',
      header: t('drives.grid.batteryUsed', 'Battery used (pp)'),
      sortable: true,
      defaultWidth: 160,
      align: 'right',
      filterActive: filters.batteryUsed !== '',
      onFilterClear: () => onFilterChange('batteryUsed', ''),
      filter: numberFilter('batteryUsed', t('drives.grid.batteryUsed', 'Battery used (pp)'), t('drives.grid.percentagePoints', 'percentage points')),
      render: (drive) => {
        const { used } = driveBattery(drive);
        return used != null ? fmtNumber(used) : '—';
      },
    },
    {
      key: 'energy',
      header: t('drives.grid.energy', 'Energy'),
      sortable: true,
      defaultWidth: 155,
      align: 'right',
      filterActive: filters.energy !== '',
      onFilterClear: () => onFilterChange('energy', ''),
      filter: numberFilter('energy', t('drives.grid.energy', 'Energy'), 'kWh'),
      render: (drive) => drive.energyUsedWh != null && drive.energyUsedWh > 0 ? formatEnergy(drive.energyUsedWh) : '—',
    },
    {
      key: 'regen',
      header: t('drives.grid.regen', 'Regen'),
      sortable: true,
      defaultWidth: 170,
      align: 'right',
      filterActive: filters.regen !== '',
      onFilterClear: () => onFilterChange('regen', ''),
      filter: numberFilter('regen', t('drives.grid.regen', 'Regen'), 'kWh'),
      render: (drive) => drive.regenEnergyWh != null ? formatEnergy(drive.regenEnergyWh) : '—',
    },
    {
      key: 'fsd',
      header: t('drives.grid.fsd', 'FSD'),
      sortable: fsdAvailable,
      defaultWidth: 145,
      align: 'right',
      filterActive: fsdFilter !== 'all' && fsdAvailable,
      onFilterClear: () => onFsdFilterChange('all'),
      filter: (
        <Select
          size="sm"
          value={fsdFilter}
          onChange={(event) => onFsdFilterChange(event.target.value)}
          aria-label={t('drives.fsdFilter.aria', 'Filter drives by FSD evidence')}
          disabled={!fsdAvailable}
          className="text-xs"
          options={[
            { value: 'all', label: t('drives.fsdFilter.all', 'All FSD data') },
            { value: 'reported', label: t('drives.fsdFilter.reported', 'FSD') },
            { value: 'high', label: t('drives.fsdFilter.high', 'High confidence') },
            { value: 'estimated', label: t('drives.fsdFilter.estimated', 'Estimated') },
            { value: 'ambiguous', label: t('drives.fsdFilter.ambiguous', 'Ambiguous') },
            { value: 'unknown', label: t('drives.fsdFilter.unknown', 'Unknown') },
          ]}
        />
      ),
      render: (drive) => {
        const insight = fsdByDriveID.get(drive.id);
        if (!fsdAvailable || !insight || insight.confidence === 'unknown' || insight.fsd_distance_m == null) return '—';
        const value = insight.fsd_share_pct != null
          ? `${fmtNumber(insight.fsd_share_pct)}%`
          : `${fmtNumber(toDistanceDisplay(insight.fsd_distance_m))} ${distanceUnit}`;
        return (
          <Badge
            variant={insight.confidence === 'high' ? 'success' : insight.confidence === 'ambiguous' ? 'warning' : 'info'}
            size="sm"
            title={insight.reset_affected
              ? t('drives.fsdResetAffected', 'A counter reset lowered confidence for this drive.')
              : t('drives.fsdReportedHelp', 'Reported supervised-driving distance derived from cumulative counters.')}
          >
            {insight.confidence === 'high' ? '' : '~'}{value}{insight.confidence === 'ambiguous' ? ` · ${t('drives.fsdAmbiguous', 'ambiguous')}` : ''}
          </Badge>
        );
      },
    },
    {
      key: 'grade',
      header: t('drives.grid.grade', 'Grade'),
      sortable: true,
      defaultVisible: false,
      defaultWidth: 90,
      align: 'center',
      render: (drive) => {
        const grade = gradeFromEfficiency(getEfficiency(drive));
        return (
          <Badge
            variant={grade.label === 'A+' || grade.label === 'A' ? 'success' : grade.label === 'B' ? 'info' : grade.label === 'C' ? 'warning' : grade.label === 'D' ? 'danger' : 'neutral'}
            size="sm"
            aria-label={t('drives.efficiencyGradeAria', 'Efficiency grade {{grade}}', { grade: grade.label })}
          >
            {grade.label}
          </Badge>
        );
      },
    },
    {
      key: 'score',
      header: t('drives.grid.score', 'Drive score'),
      sortable: true,
      defaultVisible: false,
      defaultWidth: 140,
      align: 'right',
      filterActive: filters.score !== '',
      onFilterClear: () => onFilterChange('score', ''),
      filter: numberFilter('score', t('drives.grid.score', 'Drive score'), t('drives.grid.points', 'points')),
      render: (drive) => (
        <DriveGridMetric kind="score" value={drive.score} scaleLabel={t('drives.grid.scoreScale', 'Drive score out of 100')}>
          {drive.score != null ? fmtInt(drive.score) : '—'}
        </DriveGridMetric>
      ),
    },
    {
      key: 'cost',
      header: t('drives.grid.estimatedCost', 'Est. cost'),
      sortable: true,
      defaultVisible: false,
      defaultWidth: 125,
      align: 'right',
      render: (drive) => drive.energyUsedWh != null && drive.energyUsedWh > 0 ? `~${formatEnergyCost(drive.energyUsedWh / 1000)}` : '—',
    },
    {
      key: 'status',
      header: t('drives.grid.status', 'Status'),
      defaultVisible: false,
      defaultWidth: 250,
      render: (drive) => [
        drive.endTs == null ? t('drives.inProgress', 'In progress') : '',
        ...driveWarnings(drive),
      ].filter(Boolean).join(' · ') || '—',
    },
    {
      key: 'actions',
      header: t('drives.grid.preview', 'Preview'),
      defaultWidth: 80,
      align: 'center',
      render: (drive) => (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          aria-label={t('drives.quickView', 'Quick view drive')}
          title={t('drives.quickView', 'Quick view drive')}
          onClick={() => onPreview(drive)}
        >
          <Eye className="h-4 w-4" aria-hidden="true" />
        </Button>
      ),
    },
  ], [driveWarnings, distanceUnit, speedUnit, efficiencyUnit, temperatureUnit, powerUnit, fsdAvailable, fsdByDriveID, onPreview, t, timezone, toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay, toTemperatureDisplay, toPowerDisplay, formatEnergy, formatEnergyCost, search, onSearchChange, collection, onCollectionChange, onDriveFilterClear, fsdFilter, onFsdFilterChange, filters, onFilterChange, fmtNumber, fmtInt]);

  const valueColumns = useMemo<Column<Drive>[]>(() => {
    const label = (key: DriveValueColumn, value: string | number | null): string => {
      if (value == null) return key === 'status' ? t('drives.grid.noFlags', 'No flags') : t('table.filter.noValue', '(Not recorded)');
      if (typeof value === 'string') {
        if (key === 'date') return formatDateTime(value, { tz: timezone });
        if (key === 'status') return value.split('|').map((flag) =>
          Object.entries(statusLabels).find(([name]) => name === flag)?.[1] ?? flag,
        ).join(' · ');
        if (key === 'fsd') {
          const [kind, raw] = value.split(':');
          return kind === 'share' ? `${fmtNumber(Number(raw))}%` : `${fmtNumber(toDistanceDisplay(Number(raw)))} ${distanceUnit}`;
        }
        return value;
      }
      switch (key) {
        case 'distance': return `${fmtNumber(toDistanceDisplay(value))} ${distanceUnit}`;
        case 'duration': return formatDurationMinutes(value / 60);
        case 'speed':
        case 'maxSpeed': return `${fmtInt(toSpeedDisplay(value))} ${speedUnit}`;
        case 'avgPower': return `${fmtNumber(toPowerDisplay(value))} ${powerUnit}`;
        case 'outsideTemp':
        case 'insideTemp': return `${fmtNumber(toTemperatureDisplay(value))} ${temperatureUnit}`;
        case 'efficiency': return `${fmtInt(toEfficiencyDisplay(value))} ${efficiencyUnit}`;
        case 'startBattery':
        case 'battery': return `${fmtNumber(value)}%`;
        case 'batteryUsed': return t('drives.grid.usedValue', '{{value}} pp', { value: fmtNumber(value) });
        case 'energy':
        case 'regen': return formatEnergy(value);
        case 'cost': return `~${formatEnergyCost(value / 1000)}`;
        default: return fmtInt(value);
      }
    };
    return columns.map((column) => {
      const key = DRIVE_VALUE_COLUMNS.find((item) => item === column.key);
      if (!key) return column;
      const options = buildTableFilterValues(availableDrives,
        drive => driveColumnValue(drive, key, fsdByDriveID, anomalyDriveIds, fsdAvailable),
        value => label(key, typeof value === 'boolean' ? String(value) : value));
      const conditionLabel = key === 'date'
        ? t('table.filter.otherConditions', 'Other conditions')
        : key === 'start' || key === 'destination'
          ? t('table.filter.textCondition', 'Text condition')
          : key === 'grade' || key === 'efficiency' || key === 'fsd'
            ? t('table.filter.conditions', 'Conditions')
            : t('table.filter.numberCondition', 'Number condition');
      const selection = valueSelections[key];
      const selected = selectedTableValueKeys(selection, options.flatMap((option) => option.keys ?? [option.value]));
      return {
        ...column,
        groupStart: key === 'startBattery' || key === 'energy' || key === 'fsd',
        filterActive: Boolean(column.filterActive || valueSelections[key] != null || invalidValueSelection),
        onFilterClear: () => onValueFilterClear(key),
        filter: (
          <DataTableValueFilter
            options={options}
            selected={selected}
            onChange={(values) => onValueSelectionChange(key, values)}
            condition={column.filter}
            conditionActive={column.filterActive}
            conditionLabel={conditionLabel}
            invalid={invalidValueSelection}
          />
        ),
      };
    });
  }, [columns, availableDrives, valueSelections, invalidValueSelection, onValueSelectionChange, onValueFilterClear,
    fsdByDriveID, fsdAvailable, anomalyDriveIds, statusLabels, t, timezone, toDistanceDisplay, distanceUnit, toSpeedDisplay, speedUnit,
    toPowerDisplay, powerUnit, toTemperatureDisplay, temperatureUnit, toEfficiencyDisplay, efficiencyUnit, formatEnergy, formatEnergyCost, fmtNumber, fmtInt]);

  return (
    <div data-drive-evidence-grid className="min-w-0">
      <DataTable
        name={t('drives.driveEvidence', 'Drive evidence')}
        tableId="drives:evidence"
        caption={t('drives.driveEvidence', 'Drive evidence')}
        toolbarActions={toolbarActions}
        toolbarHeading={toolbarHeading}
        columns={valueColumns}
        data={drives}
        keyExtractor={(drive) => drive.id}
        rowLabel={(drive) => `${formatDateTime(drive.startTs, { tz: timezone })} · ${endpointLabel({ address: drive.startAddress, lat: drive.startLat, lon: drive.startLon }) ?? ''} → ${endpointLabel({ address: drive.endAddress, lat: drive.endLat, lon: drive.endLon }) ?? ''}`}
        density="compact"
        selectable="multi"
        showSelectionSummary={false}
        selectedKeys={Array.from(selectedIds)}
        onSelectionChange={(keys) => {
          const pageIds = new Set(drives.map((drive) => drive.id));
          const next = new Set(Array.from(selectedIds).filter((id) => !pageIds.has(id)));
          keys.forEach((key) => { if (typeof key === 'number') next.add(key); });
          onSelectionChange(next);
        }}
        sortKey={sortBy}
        sortDir={sortDir}
        onSort={(key) => {
          const next = DRIVE_GRID_SORT_KEYS.find((item) => item === key);
          if (next) onSort(next);
        }}
        emptyMessage={invalidValueSelection
          ? t('table.filter.invalidValues', 'This saved value filter is invalid. Clear it to reset.')
          : t('drives.grid.empty', 'No drives match these filters')}
        className="border-[var(--border-subtle)] shadow-none [&_tbody_td]:whitespace-nowrap"
        resizable
        columnReorder
        stickyHeader
        maxHeight={560}
      />
    </div>
  );
}
