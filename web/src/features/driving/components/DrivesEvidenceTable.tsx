import { useCallback, useMemo, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import { ChevronRight, Route } from 'lucide-react';
import { Badge, Button, DataTable, Input, Select, Text, type Column, type PaginationProps } from '@/components/ui';
import { endpointLabel } from '@/components/data-display';
import type { DriveGridScope } from '@/api/hooks/useDriveGrid';
import type { TableControls } from '@/components/forms';
import {formatDateTime} from '@/lib/dateFormat'
import {formatDurationMinutes} from '@/lib/dateConvert';

import { getEfficiency, gradeFromEfficiency } from '@/lib/drivesAggregation';
import type { Drive } from '@/types/driving';
import type { DriveFsdInsight } from '@/types/fsd';
import { DriveGridMetric } from './DriveGridMetric';
import { DriveEvidenceValueFilter } from './DriveEvidenceValueFilter';
import { driveAverageSpeed, driveBattery } from './driveGridMetrics';
import { DRIVE_REVIEW_STATUSES, DRIVE_VALUE_COLUMNS, driveReviewStatus, driveRouteLabel, driveStatusFlags, type DriveReviewStatus, type DriveValueColumn, type DriveValueSelections } from './driveGridValues';
import { useNumberFormatting } from '@/hooks/useNumberFormatting';

export const DRIVE_GRID_SORT_KEYS = ['date', 'route', 'start', 'destination', 'distance', 'duration', 'speed', 'maxSpeed', 'avgPower', 'outsideTemp', 'insideTemp', 'efficiency', 'grade', 'battery', 'startBattery', 'batteryUsed', 'energy', 'regen', 'score', 'cost', 'fsd', 'status'] as const;
export type DriveGridSortKey = typeof DRIVE_GRID_SORT_KEYS[number];
export type DriveGridFilterKey = 'route' | 'date' | 'start' | 'destination' | 'distance' | 'duration' | 'speed' | 'maxSpeed' | 'avgPower' | 'outsideTemp' | 'insideTemp' | 'grade' | 'battery' | 'startBattery' | 'batteryUsed' | 'energy' | 'regen' | 'score';
export type DriveGridFilters = Record<DriveGridFilterKey, string>;

interface DrivesEvidenceTableProps {
  drives: Drive[];
  gridScope: DriveGridScope;
  rangeTotal?: number;
  emptyContent?: ReactNode;
  valueSelections: DriveValueSelections;
  invalidValueSelection: boolean;
  onValueSelectionChange: (column: DriveValueColumn, values: string[] | null, available: string[]) => void;
  onValueFilterClear: (column: DriveValueColumn) => void;
  selectedIds: Set<number>;
  onSelectionChange: (ids: Set<number>) => void;
  onPreview: (drive: Drive) => void;
  sortBy: DriveGridSortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: DriveGridSortKey) => void;
  collection: string;
  collectionPills: ReadonlyArray<{ key: string; label: string; count?: number; disabled?: boolean }>;
  onCollectionChange: (value: string) => void;
  onDriveFilterClear: () => void;
  fsdFilter: string;
  fsdPills: DrivesEvidenceTableProps['collectionPills'];
  onFsdFilterChange: (value: string) => void;
  filters: DriveGridFilters;
  onFilterChange: (key: DriveGridFilterKey, value: string) => void;
  driveStatus: 'all' | DriveReviewStatus;
  onDriveStatusChange: (value: string) => void;
  vehicleName?: string;
  vehicleId: number | null;
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
  matchingActions?: ReactNode;
  savedViews: { context: string; onRestore: (context: string) => void };
  onClearAllFilters: () => void;
  controls?: TableControls;
  paginationControls?: PaginationProps;
}

export function DrivesEvidenceTable({
  drives, gridScope, rangeTotal, emptyContent, valueSelections, invalidValueSelection, onValueSelectionChange, onValueFilterClear,
  selectedIds, onSelectionChange, onPreview, sortBy, sortDir, onSort,
  collection, collectionPills, onCollectionChange, onDriveFilterClear, fsdFilter, fsdPills, onFsdFilterChange, filters, onFilterChange,
  driveStatus, onDriveStatusChange, vehicleName, vehicleId,
  toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay, toTemperatureDisplay, toPowerDisplay, formatEnergy, formatEnergyCost,
  distanceUnit, speedUnit, efficiencyUnit, temperatureUnit, powerUnit,
  timezone, fsdAvailable, fsdByDriveID, anomalyDriveIds, toolbarActions,
  matchingActions, savedViews, onClearAllFilters, controls, paginationControls,
}: DrivesEvidenceTableProps) {
  const { fmtNumber, fmtInt } = useNumberFormatting();
  const { t } = useTranslation();
  const statusLabels = useMemo(() => ({
    inProgress: t('drives.inProgress', 'In progress'),
    noTelemetry: t('drives.noTelemetry', 'No telemetry'),
    highSpeed: t('drives.highSpeed', 'High speed'),
    highEnergyUse: t('drives.highEnergyUse', 'High energy use'),
  }), [t]);
  const reviewLabels = useMemo(() => ({
    recorded: t('drives.grid.recorded', 'Recorded'),
    needsReview: t('drives.grid.needsReview', 'Needs review'),
    inProgress: statusLabels.inProgress,
  }), [t, statusLabels]);
  const driveWarnings = useCallback((drive: Drive) =>
    driveStatusFlags(drive, anomalyDriveIds.has(drive.id))
      .filter((flag) => flag !== 'inProgress').map((flag) => statusLabels[flag]),
  [anomalyDriveIds, statusLabels]);
  const filterOptions = (pills: DrivesEvidenceTableProps['collectionPills']) =>
    pills.map(({ key, label, count, disabled }) => ({
      value: key,
      label: count == null ? label : t('drives.grid.filterCount', '{{label}} ({{count}})', { label, count }),
      disabled,
    }));
  const textFilter = (key: 'route' | 'date' | 'start' | 'destination', label: string, placeholder: string) => (
    <Input size="sm" value={filters[key]} onChange={event => onFilterChange(key, event.target.value)}
      aria-label={t('drives.grid.locationFilter', 'Filter {{location}}', { location: label })} placeholder={placeholder} />
  );
  const numberFilter = (key: Exclude<DriveGridFilterKey, 'grade' | 'route' | 'date' | 'start' | 'destination'>, label: string, unit: string) => (
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
      key: 'route',
      header: t('drives.grid.route', 'Route'),
      sortable: true,
      pinned: true,
      required: true,
      defaultWidth: 250,
      minWidth: 150,
      filterActive: filters.route !== '',
      filter: textFilter('route', t('drives.grid.route', 'Route'), t('drives.grid.contains', 'Contains')),
      render: (drive) => {
        const route = driveRouteLabel(drive) ?? t('drives.grid.unknownRoute', 'Unknown route');
        return <div className="flex min-w-0 items-center gap-2">
          <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-shape-sm bg-[var(--surface-2)] text-[var(--text-secondary)]">
            <Route className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link className="block truncate font-semibold text-[var(--text-primary)] hover:underline focus-visible:underline"
              title={route} aria-label={`${route} · ${formatDateTime(drive.startTs, { tz: timezone })}`} to={`/drives/${drive.id}`}>{route}</Link>
            {drive.vehicleId === vehicleId && vehicleName && <Text size="xs" color="muted" className="block truncate">{vehicleName}</Text>}
          </div>
        </div>;
      },
    },
    {
      key: 'date',
      header: t('drives.grid.dateTime', 'Date / time'),
      sortable: true,
      defaultWidth: 195,
      minWidth: 160,
      render: (drive) => formatDateTime(drive.startTs, { tz: timezone }),
      quickFilter: textFilter('date', t('drives.grid.dateTime', 'Date / time'), t('drives.grid.dayOrTime', 'Day or time')),
      filterActive: collection !== 'all' || filters.date !== '',
      onFilterClear: onDriveFilterClear,
      filter: (
        <div className="space-y-1.5">
          {textFilter('date', t('drives.grid.dateTime', 'Date / time'), t('drives.grid.dayOrTime', 'Day or time'))}
          <Select
            size="sm"
            value={collection}
            onChange={(event) => onCollectionChange(event.target.value)}
            aria-label={t('drives.collections.aria', 'Filter drives by collection')}
            className="text-xs"
            options={filterOptions(collectionPills)}
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
        filter: textFilter(key, label, t('drives.grid.contains', 'Contains')),
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
      defaultWidth: 125,
      align: 'right',
      filterActive: filters.distance !== '',
      onFilterClear: () => onFilterChange('distance', ''),
      filter: numberFilter('distance', t('drives.distance', 'Distance'), distanceUnit),
      render: (drive) => drive.distanceM > 0 ? `${fmtNumber(toDistanceDisplay(drive.distanceM))} ${distanceUnit}` : '—',
    },
    {
      key: 'duration',
      header: t('drives.duration', 'Duration'),
      sortable: true,
      defaultWidth: 115,
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
      defaultWidth: 135,
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
          options={filterOptions(fsdPills)}
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
      sortable: true,
      defaultWidth: 150,
      filterActive: driveStatus !== 'all',
      filter: <Select size="sm" value={driveStatus} onChange={event => onDriveStatusChange(event.target.value)}
        aria-label={t('drives.grid.statusFilter', 'Filter drive status')}
        options={[{ value: 'all', label: t('common.any', 'Any') },
          ...DRIVE_REVIEW_STATUSES.map(value => ({ value, label: reviewLabels[value] }))]} />,
      render: (drive) => {
        const status = driveReviewStatus(drive, anomalyDriveIds.has(drive.id));
        const warnings = driveWarnings(drive).join(' · ');
        return <Badge variant={status === 'recorded' ? 'success' : status === 'needsReview' ? 'warning' : 'info'}
          size="sm" title={warnings || undefined}>{reviewLabels[status]}{warnings && <span className="sr-only">: {warnings}</span>}</Badge>;
      },
    },
    {
      key: 'actions',
      header: t('drives.grid.preview', 'Preview'),
      fixedWidth: 64,
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
          <ChevronRight className="h-4 w-4" aria-hidden="true" />
        </Button>
      ),
    },
  ], [driveWarnings, distanceUnit, speedUnit, efficiencyUnit, temperatureUnit, powerUnit, fsdAvailable, fsdByDriveID, onPreview, t, timezone, toDistanceDisplay, toSpeedDisplay, toEfficiencyDisplay, toTemperatureDisplay, toPowerDisplay, formatEnergy, formatEnergyCost, collection, collectionPills, onCollectionChange, onDriveFilterClear, fsdFilter, fsdPills, onFsdFilterChange, filters, onFilterChange, fmtNumber, fmtInt, vehicleId, vehicleName, reviewLabels, driveStatus, onDriveStatusChange, anomalyDriveIds]);

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
      if (!key || vehicleId == null) return column;
      const valuesEnabled = key !== 'fsd' || fsdAvailable;
      const conditionLabel = key === 'date'
        ? t('table.filter.otherConditions', 'Other conditions')
        : key === 'start' || key === 'destination' || key === 'route'
          ? t('table.filter.textCondition', 'Text condition')
          : key === 'grade' || key === 'efficiency' || key === 'fsd' || key === 'status'
            ? t('table.filter.conditions', 'Conditions')
            : t('table.filter.numberCondition', 'Number condition');
      return {
        ...column,
        defaultVisible: ['route', 'date', 'distance', 'duration', 'energy', 'status'].includes(key),
        quickFilter: column.quickFilter ?? column.filter,
        groupStart: key === 'startBattery' || key === 'energy' || key === 'fsd',
        filterActive: Boolean(column.filterActive || valuesEnabled && valueSelections[key] != null || invalidValueSelection),
        onFilterClear: () => onValueFilterClear(key),
        filter: (
          <DriveEvidenceValueFilter
            vehicleId={vehicleId}
            scope={gridScope}
            field={key}
            selection={valueSelections[key]}
            labelFor={value => label(key, value)}
            onChange={(values, available) => onValueSelectionChange(key, values, available)}
            condition={column.filter}
            conditionActive={column.filterActive}
            conditionLabel={conditionLabel}
            invalid={invalidValueSelection}
            valuesEnabled={valuesEnabled}
          />
        ),
      };
    });
  }, [columns, gridScope, vehicleId, valueSelections, invalidValueSelection, onValueSelectionChange, onValueFilterClear,
    fsdAvailable, statusLabels, t, timezone, toDistanceDisplay, distanceUnit, toSpeedDisplay, speedUnit,
    toPowerDisplay, powerUnit, toTemperatureDisplay, temperatureUnit, toEfficiencyDisplay, efficiencyUnit, formatEnergy, formatEnergyCost, fmtNumber, fmtInt]);

  return (
    <div data-drive-evidence-grid className="min-w-0">
      <DataTable
        name={t('drives.driveEvidence', 'Drive evidence')}
        tableId="drives:evidence"
        caption={t('drives.driveEvidence', 'Drive evidence')}
        toolbarActions={toolbarActions}
        matchingActions={matchingActions}
        onClearAllFilters={onClearAllFilters}
        savedViews={savedViews}
        showMatchingCount={paginationControls && rangeTotal != null ? { matching: paginationControls.total, rangeTotal } : false}
        controls={controls}
        paginationControls={paginationControls}
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
        mobilePresentation={{
          cardMaxWidth: 780,
          roles: { route: 'title', date: 'meta', distance: 'primary', duration: 'meta', energy: 'meta', status: 'badge' },
          displayValue: (drive, key) => {
            switch (key) {
              case 'route': return driveRouteLabel(drive) ?? t('drives.grid.unknownRoute', 'Unknown route');
              case 'date': return formatDateTime(drive.startTs, { tz: timezone });
              case 'distance': return drive.distanceM > 0 ? `${fmtNumber(toDistanceDisplay(drive.distanceM))} ${distanceUnit}` : null;
              case 'duration': return formatDurationMinutes(drive.durationS / 60);
              case 'energy': return drive.energyUsedWh != null && drive.energyUsedWh > 0 ? formatEnergy(drive.energyUsedWh) : null;
              case 'status': return reviewLabels[driveReviewStatus(drive, anomalyDriveIds.has(drive.id))];
              default: return null;
            }
          },
          badgeVariant: drive => {
            const status = driveReviewStatus(drive, anomalyDriveIds.has(drive.id));
            return status === 'recorded' ? 'success' : status === 'needsReview' ? 'warning' : 'info';
          },
          rowHref: drive => `/drives/${drive.id}`,
          inlineActions: drive => {
            const insight = fsdByDriveID.get(drive.id);
            const fsdColumn = valueColumns.find(column => column.key === 'fsd');
            return fsdAvailable && fsdColumn && insight && insight.confidence !== 'unknown' && insight.fsd_distance_m != null
              ? <div className="flex items-center gap-1.5">
                <Text size="xs" color="muted">{fsdColumn.header}</Text>
                {fsdColumn.render(drive)}
              </div>
              : null;
          },
          onQuickView: onPreview,
          quickViewLabel: t('drives.quickView', 'Quick view drive'),
          showRowCount: false,
          columnToolsInPicker: true,
          compactRows: true,
        }}
        emptyContent={emptyContent}
        emptyMessage={invalidValueSelection
          ? t('table.filter.invalidValues', 'This saved value filter is invalid. Clear it to reset.')
          : t('drives.grid.empty', 'No drives match these filters')}
        noMatchMessage={invalidValueSelection
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
