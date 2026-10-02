import { useMemo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Badge, Button, DataTable, DataTableValueFilter, Tooltip, buildTableFilterValues, selectedTableValueKeys, type Column } from '@/components/ui';
import { GridMetricIndicator, RouteDisplay } from '@/components/data-display';
import { useUnits } from '@/hooks/useUnits';
import { useFormatting } from '@/hooks/useFormatting';
import { formatDateTime, formatDurationMinutes } from '@/lib/dateFormat';
import { batteryColor, COLOR } from '@/lib/colors';
import { fmtInt } from '@/lib/numberFormat';
import { sessionAveragePowerW, batteryFriendlyScore, durationMinutes, getChargerCategory, type ChargingAnomaly } from '@/lib/chargingAggregation';
import { Icons } from '@/lib/icons';
import type { ChargingSession } from '@/api/types';
import { distanceAddedM } from './charging-curve/helpers';
import { CHARGING_VALUE_COLUMNS, chargingColumnValue, type ChargingValueColumn, type ChargingValueSelections } from './chargingGridValues';

export type ChargingEvidenceSort = 'date' | 'energy' | 'cost' | 'duration' | 'power';

interface ChargingEvidenceTableProps {
  sessions: ChargingSession[];
  availableSessions: ChargingSession[];
  valueSelections: ChargingValueSelections;
  invalidValueSelection: boolean;
  onValueSelectionChange: (column: ChargingValueColumn, values: string[] | null) => void;
  onValueFilterClear: (column: ChargingValueColumn) => void;
  timezone: string;
  selectedIds: ReadonlySet<number>;
  onSelectionChange: (ids: Set<number>) => void;
  onPreview: (session: ChargingSession) => void;
  anomalies: ReadonlyMap<number, ChargingAnomaly>;
  sortBy: ChargingEvidenceSort;
  sortDir: 'asc' | 'desc';
  onSort: (key: ChargingEvidenceSort) => void;
  density: 'compact' | 'comfortable';
  toolbarHeading: ReactNode;
  toolbarActions: ReactNode;
}

export function ChargingEvidenceTable({
  sessions, availableSessions, valueSelections, invalidValueSelection, onValueSelectionChange, onValueFilterClear,
  timezone, selectedIds, onSelectionChange, onPreview, anomalies,
  sortBy, sortDir, onSort, density, toolbarHeading, toolbarActions,
}: ChargingEvidenceTableProps) {
  const { t } = useTranslation();
  const { formatEnergy, formatPower, formatDistance } = useUnits();
  const { formatCurrency } = useFormatting();
  const columns = useMemo<Column<ChargingSession>[]>(() => {
    const chargerLabels: Record<string, string> = {
      home: t('charging.chargerTypes.home', 'Home / AC'),
      supercharger: t('charging.chargerTypes.supercharger', 'Supercharger'),
      dc: t('charging.chargerTypes.dc', 'DC fast'),
    };
    const battery = (value: number | null) => {
      if (value == null || !Number.isFinite(value)) return <span>—</span>;
      const color = batteryColor(value);
      return (
        <GridMetricIndicator
          kind="battery"
          band={color === COLOR.GOOD ? 'good' : color === COLOR.WARN ? 'warning' : 'critical'}
          title={t('charging.grid.batteryScale', 'Battery level on a 0–100% scale')}
          fraction={Math.min(1, Math.max(0, value / 100))}
        >
          {fmtInt(value)}%
        </GridMetricIndicator>
      );
    };
    const baseColumns: Column<ChargingSession>[] = [
      {
        key: 'date', header: t('charging.grid.started', 'Started'), sortable: true,
        defaultWidth: 185, minWidth: 155,
        render: (s) => (
          <div className="flex min-w-0 items-center gap-2">
            <Link to={`/charging/${s.id}`} className="rounded font-medium text-[var(--text-primary)] underline-offset-4 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-400">
              {formatDateTime(s.started_at, { tz: timezone })}
            </Link>
            {s.live && <Badge variant="info" size="sm">{t('charging.preview.active', 'Active')}</Badge>}
            {anomalies.has(s.id) && (
              <Tooltip content={anomalies.get(s.id)?.message}>
                <Icons.warning className="h-4 w-4 shrink-0 text-amber-300" role="img" aria-label={anomalies.get(s.id)?.message} />
              </Tooltip>
            )}
          </div>
        ),
      },
      {
        key: 'location', header: t('entityContext.location', 'Charge location'),
        defaultWidth: 220, minWidth: 150,
        render: (s) => <RouteDisplay start={{ address: s.start_place, lat: s.start_lat, lon: s.start_lng }} />,
      },
      {
        key: 'charger', header: t('charging.preview.charger', 'Charger'),
        defaultWidth: 135, minWidth: 100,
        render: (s) => {
          const category = getChargerCategory(s.charger_type);
          const label = chargerLabels[category] ?? s.charger_type ?? t('charging.chargerTypes.unknown', 'Charger');
          return <Badge variant={category === 'supercharger' ? 'danger' : category === 'dc' ? 'warning' : 'neutral'} size="sm">{label}</Badge>;
        },
      },
      {
        key: 'duration', header: t('charging.duration', 'Duration'), sortable: true,
        defaultWidth: 100, minWidth: 80, align: 'right',
        render: (s) => durationMinutes(s) > 0 ? formatDurationMinutes(durationMinutes(s)) : '—',
      },
      {
        key: 'energy', header: t('operations.charging.deliveredEnergy', 'Delivered energy'), sortable: true,
        defaultWidth: 135, minWidth: 100, align: 'right', groupStart: true,
        render: (s) => formatEnergy(s.total_energy_added_wh),
      },
      {
        key: 'power', header: t('charging.grid.averagePower', 'Average power'), sortable: true,
        defaultWidth: 130, minWidth: 100, align: 'right',
        render: (s) => formatPower(sessionAveragePowerW(s)),
      },
      {
        key: 'peakPower', header: t('charging.preview.peakPower', 'Peak power'),
        defaultWidth: 120, minWidth: 100, align: 'right', defaultVisible: false,
        render: (s) => formatPower(s.peak_power_w),
      },
      {
        key: 'batteryStart', header: t('charging.grid.startBattery', 'Start battery'),
        defaultWidth: 115, minWidth: 90, align: 'right', groupStart: true,
        render: (s) => battery(s.start_soc_pct),
      },
      {
        key: 'batteryEnd', header: t('charging.grid.endBattery', 'End battery'),
        defaultWidth: 115, minWidth: 90, align: 'right',
        render: (s) => battery(s.end_soc_pct),
      },
      {
        key: 'range', header: t('charging.grid.rangeAdded', 'Range added'),
        defaultWidth: 130, minWidth: 100, align: 'right', defaultVisible: false,
        render: (s) => formatDistance(distanceAddedM(s)),
      },
      {
        key: 'cost', header: t('charging.totalCost', 'Cost'), sortable: true,
        defaultWidth: 100, minWidth: 80, align: 'right', groupStart: true,
        render: (s) => s.cost_decimal == null ? '—' : s.cost_decimal === 0
          ? <Badge variant="success" size="sm">{t('charging.free', 'Free')}</Badge>
          : formatCurrency(s.cost_decimal),
      },
      {
        key: 'rate', header: t('charging.grid.costPerEnergy', 'Cost per kWh'),
        defaultWidth: 130, minWidth: 100, align: 'right', defaultVisible: false,
        render: (s) => s.cost_decimal != null && s.total_energy_added_wh > 0
          ? formatCurrency(s.cost_decimal / (s.total_energy_added_wh / 1000), 2) : '—',
      },
      {
        key: 'score', header: t('charging.grid.batteryScore', 'Battery-friendly score'),
        defaultWidth: 160, minWidth: 120, align: 'right', defaultVisible: false,
        render: (s) => {
          const score = batteryFriendlyScore([s]);
          return score == null ? '—' : `${fmtInt(score)}/100`;
        },
      },
      {
        key: 'actions', header: t('table.actions', 'Actions'), defaultWidth: 65, minWidth: 60,
        render: (s) => (
          <Tooltip content={t('charging.quickView', 'Quick view charging session')}>
            <Button variant="ghost" size="sm" className="h-11 w-11 p-0" aria-label={t('charging.quickView', 'Quick view charging session')} onClick={() => onPreview(s)}>
              <Icons.show className="h-4 w-4" aria-hidden="true" />
            </Button>
          </Tooltip>
        ),
      },
    ];
    const valueLabel = (key: ChargingValueColumn, value: string | number | null): string => {
      if (value == null) return t('table.filter.noValue', '(Not recorded)');
      if (typeof value === 'string') {
        if (key === 'date') return formatDateTime(value, { tz: timezone });
        return key === 'charger' ? chargerLabels[value] ?? value : value;
      }
      switch (key) {
        case 'duration': return formatDurationMinutes(value / 60);
        case 'energy': return formatEnergy(value);
        case 'power':
        case 'peakPower': return formatPower(value);
        case 'batteryStart':
        case 'batteryEnd': return `${fmtInt(value)}%`;
        case 'range': return formatDistance(value);
        case 'cost': return value === 0 ? t('charging.free', 'Free') : formatCurrency(value);
        case 'rate': return formatCurrency(value, 2);
        case 'score': return `${fmtInt(value)}/100`;
        default: return String(value);
      }
    };
    return baseColumns.map((column) => {
      const key = CHARGING_VALUE_COLUMNS.find((candidate) => candidate === column.key);
      if (!key) return column;
      const options = buildTableFilterValues(availableSessions,
        (session) => chargingColumnValue(session, key),
        (value) => valueLabel(key, typeof value === 'boolean' ? String(value) : value));
      return {
        ...column,
        filterActive: valueSelections[key] != null || invalidValueSelection,
        onFilterClear: () => onValueFilterClear(key),
        filter: <DataTableValueFilter
          options={options}
          selected={selectedTableValueKeys(valueSelections[key], options.flatMap((option) => option.keys ?? [option.value]))}
          onChange={(values) => onValueSelectionChange(key, values)}
          invalid={invalidValueSelection}
        />,
      };
    });
  }, [t, timezone, anomalies, onPreview, formatCurrency, formatEnergy, formatPower, formatDistance,
    availableSessions, valueSelections, invalidValueSelection, onValueSelectionChange, onValueFilterClear]);

  return (
    <DataTable
      name={t('charging.section.sessions', 'All charging sessions')}
      caption={t('charging.section.sessions', 'All charging sessions')}
      tableId="charging:evidence"
      columns={columns}
      data={sessions}
      keyExtractor={(s) => s.id}
      rowLabel={(s) => `${formatDateTime(s.started_at, { tz: timezone })} · ${s.start_place ?? ''}`}
      toolbarHeading={toolbarHeading}
      toolbarActions={toolbarActions}
      density={density}
      selectable="multi"
      showSelectionSummary={false}
      selectedKeys={Array.from(selectedIds)}
      onSelectionChange={(keys) => {
        const pageIds = new Set(sessions.map((s) => s.id));
        const next = new Set(Array.from(selectedIds).filter((id) => !pageIds.has(id)));
        keys.forEach((key) => { if (typeof key === 'number') next.add(key); });
        onSelectionChange(next);
      }}
      sortKey={sortBy}
      sortDir={sortDir}
      onSort={(key) => {
        const field = (['date', 'energy', 'cost', 'duration', 'power'] as const).find((value) => value === key);
        if (field) onSort(field);
      }}
      emptyMessage={t('charging.emptyForCollection', 'No charging sessions in this view')}
      className="border-[var(--border-subtle)] shadow-none [&_tbody_td]:whitespace-nowrap"
      resizable
      columnReorder
      stickyHeader
      maxHeight={560}
    />
  );
}
