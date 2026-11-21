import { useMemo, useCallback, useDeferredValue, useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { type TableControls } from '@/components/forms';
import { useUrlBatch, useUrlEnum, useUrlString, useUrlNumber } from '@/hooks/useUrlState';
import { useDataState } from '@/hooks/useDataState';
import { parseSearchQuery } from '@/lib/searchQuery';
import { apiUrl } from '@/api/client';
import { scopedPath } from '@/api/scope';
import { useDriveGridPage, type DriveGridQuery } from '@/api/hooks/useDriveGrid';
import { convertDistanceToSI, convertDistanceFromSI, convertPowerFromSI, convertSpeedToSI, convertTempToSI } from '@/lib/unitConversion';
import { DRIVE_GRID_SORT_KEYS, type DriveGridFilters, type DriveGridFilterKey, type DriveGridSortKey } from '../components/DrivesEvidenceTable';
import { DRIVE_REVIEW_STATUSES, compactDriveValueSelection, parseDriveValueSelections, type DriveValueColumn } from '../components/driveGridValues';
import { COLLECTIONS, FSD_FILTERS, TREND_METRICS, type Collection, type FsdFilter } from '../components/drives-orchestrator/drivesListConstants';
import type { useDrivesListPageData } from './useDrivesListPageData';

const GRID_FILTER_KEYS = ['distance', 'duration', 'speed', 'grade', 'battery', 'energy', 'route', 'date', 'start', 'destination',
  'startBattery', 'batteryUsed', 'maxSpeed', 'avgPower', 'outsideTemp', 'insideTemp', 'regen', 'score'] as const;
const gridParameter = (key: string) => `grid_${key.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`)}`;
const viewKeys = ['q', 'sort', 'sortdir', 'coll', 'fsd', 'grid_values', 'grid_status', ...GRID_FILTER_KEYS.map(gridParameter)];
const defaultDirection = (key: DriveGridSortKey) =>
  ['efficiency', 'grade', 'route', 'start', 'destination'].includes(key) ? 'asc' : 'desc';

type QueryInput = Pick<ReturnType<typeof useDrivesListPageData>, 'locale' | 'precision' | 'unitPrefs'> & {
  gridFilters: DriveGridFilters;
  valueFilter: ReturnType<typeof parseDriveValueSelections>;
  fsdDataAvailable: boolean;
  search: string;
};

function buildDriveGridQuery({ locale, precision, unitPrefs, gridFilters, valueFilter, fsdDataAvailable, search }: QueryInput): DriveGridQuery {
  const text: Record<string, string> = {};
  const minimum: Record<string, number> = {};
  let invalid = valueFilter.invalid;
  for (const key of GRID_FILTER_KEYS) {
    const raw = gridFilters[key];
    if (raw.trim() === '' || key === 'grade') continue;
    if (key === 'route' || key === 'date' || key === 'start' || key === 'destination') {
      if (raw.trim()) text[key] = raw.trim();
      continue;
    }
    const n = Number(raw);
    const signed = key === 'outsideTemp' || key === 'insideTemp' || key === 'avgPower' || key === 'batteryUsed';
    if (!Number.isFinite(n) || (!signed && n < 0)) {
      invalid = true;
      continue;
    }
    const normalized = key === 'distance' ? convertDistanceToSI(n, unitPrefs.distance)
      : key === 'speed' || key === 'maxSpeed' ? convertSpeedToSI(n, unitPrefs.speed)
      : key === 'duration' ? n * 60
      : key === 'outsideTemp' || key === 'insideTemp' ? convertTempToSI(n, unitPrefs.temperature)
      : key === 'avgPower' ? n / convertPowerFromSI(1, unitPrefs.power)
      : key === 'energy' || key === 'regen' ? n * 1000 : n;
    if (!Number.isFinite(normalized)) invalid = true;
    else minimum[key] = normalized;
  }
  const values = Object.fromEntries(Object.entries(valueFilter.selections).flatMap(([column, selection]) => {
    if (column === 'fsd' && !fsdDataAvailable) return [];
    const include = Array.isArray(selection);
    return [[column, { exclude: !include, keys: (include ? selection : selection.excluded).map(key => JSON.parse(key) as unknown) }]];
  }));
  const tokens = parseSearchQuery(search).map(token => {
    if (token.kind !== 'kv' || token.key !== 'distance') return token;
    const target = convertDistanceToSI(Number(token.value), unitPrefs.distance);
    return Number.isFinite(target) ? { ...token, target } : token;
  });
  return { locale, precision, invalid, values, text, minimum, grade: gridFilters.grade,
    search: tokens, distance_unit_scale: convertDistanceFromSI(1, unitPrefs.distance) };
}

export function useDrivesListPageFilters(data: ReturnType<typeof useDrivesListPageData>) {
  const { desktopEvidence, fsdDataAvailable, exportScope, t, gridScope, vehicleId, locale, precision, unitPrefs } = data;
  const [sortBy] = useUrlEnum<DriveGridSortKey>('sort', DRIVE_GRID_SORT_KEYS, 'date');
  const [sortDirection] = useUrlEnum('sortdir', ['auto', 'asc', 'desc'] as const, 'auto');
  const effectiveSortDirection = sortDirection === 'auto' ? defaultDirection(sortBy) : sortDirection;
  const [rawPage] = useUrlNumber('page', 1);
  const [rawSize] = useUrlNumber('size', 50);
  // Explicit sizes in shared links (including one row) are supported.
  const pageSize = Number.isSafeInteger(rawSize) && rawSize >= 1 && rawSize <= 1000 ? rawSize : 50;
  const [search] = useUrlString('q', '');
  const [density, setDensity] = useUrlEnum('density', ['compact', 'comfortable'] as const, desktopEvidence ? 'compact' : 'comfortable');
  const [collection] = useUrlEnum<Collection>('coll', COLLECTIONS, 'all');
  const [fsdFilter] = useUrlEnum<FsdFilter>('fsd', FSD_FILTERS, 'all');
  const [trendMetric, setTrendMetric] = useUrlEnum('trend', TREND_METRICS, 'drives');
  const setUrlBatch = useUrlBatch();
  const [gridValues] = useUrlString('grid_values');
  const valueFilter = useMemo(() => parseDriveValueSelections(gridValues), [gridValues]);
  const hasValueFilters = valueFilter.invalid || Object.keys(valueFilter.selections).length > 0;
  const [driveStatus] = useUrlEnum('grid_status', ['all', ...DRIVE_REVIEW_STATUSES] as const, 'all');
  const [params] = useSearchParams();
  const gridFilters = Object.fromEntries(GRID_FILTER_KEYS.map(key => [key, params.get(gridParameter(key)) ?? ''])) as DriveGridFilters;
  const changeGridFilter = (key: DriveGridFilterKey, value: string) => setUrlBatch({ [gridParameter(key)]: value || null, page: null });
  const viewContext = new URLSearchParams(viewKeys.flatMap(key => {
    const value = params.get(key);
    return value ? [[key, value]] : [];
  })).toString();
  const restoreView = (context: string) => {
    const view = new URLSearchParams(context);
    setUrlBatch({ ...Object.fromEntries(viewKeys.map(key => [key, view.get(key)])), page: null });
  };
  const clearGridFilters = () => setUrlBatch({
    ...Object.fromEntries(viewKeys.filter(key => key !== 'sort' && key !== 'sortdir').map(key => [key, null])),
    page: null,
  });
  const changeValueSelection = (column: DriveValueColumn, values: string[] | null, available: string[]) => {
    const next = { ...valueFilter.selections };
    if (values == null) delete next[column];
    else next[column] = compactDriveValueSelection(values, available);
    setUrlBatch({ grid_values: Object.keys(next).length ? JSON.stringify(next) : null, page: null });
  };
  const clearValueFilter = (column: DriveValueColumn) => {
    const next = { ...valueFilter.selections };
    delete next[column];
    const updates: Record<string, string | null> = {
      grid_values: Object.keys(next).length ? JSON.stringify(next) : null,
      page: null,
    };
    if (column === 'date') { updates.coll = null; updates.grid_date = null; }
    else if (column === 'status') updates.grid_status = null;
    else if (column === 'fsd') updates.fsd = null;
    else if (column === 'efficiency' || column === 'grade') updates.grid_grade = null;
    else if (column in gridFilters) updates[gridParameter(column)] = null;
    setUrlBatch(updates);
  };
  const sortGrid = (key: DriveGridSortKey) => {
    if (key === 'fsd' && !fsdDataAvailable) return;
    const direction = key === sortBy ? (effectiveSortDirection === 'desc' ? 'asc' : 'desc') : defaultDirection(key);
    setUrlBatch({ sort: key === 'date' ? null : key, sortdir: direction, page: null });
  };

  const workspace = `${vehicleId}:${data.startDate}:${data.endDate}:${gridScope.timezone}`;
  const previousWorkspace = useRef(workspace);
  const workspaceChanged = previousWorkspace.current !== workspace;
  const page = !workspaceChanged && Number.isSafeInteger(rawPage) && rawPage > 0
    ? Math.min(rawPage, Math.floor(Number.MAX_SAFE_INTEGER / pageSize)) : 1;
  useEffect(() => {
    previousWorkspace.current = workspace;
    if (workspaceChanged && rawPage !== 1) setUrlBatch({ page: null });
  }, [workspace, workspaceChanged, rawPage, setUrlBatch]);
  const setPage = (next: number) => setUrlBatch({ page: next === 1 ? null : String(next) });

  const deferredSearch = useDeferredValue(search);
  const grid: DriveGridQuery = {
    ...buildDriveGridQuery({ locale, precision, unitPrefs, gridFilters, valueFilter, fsdDataAvailable, search: deferredSearch }),
    sort: sortBy === 'fsd' && !fsdDataAvailable ? 'date' : sortBy,
    direction: sortBy === 'fsd' && !fsdDataAvailable ? 'desc' : effectiveSortDirection,
    collection,
    fsd: fsdDataAvailable ? fsdFilter : 'all',
    status: driveStatus,
  };
  const { sort: _sort, direction: _direction, ...matchingGrid } = grid;
  const pageQuery = useDriveGridPage(vehicleId ?? null, gridScope, grid, page, pageSize);
  const pageState = useDataState(pageQuery.isPlaceholderData ? { ...pageQuery, data: undefined } : pageQuery, { provenance: 'historical' });
  const safePage = pageState.data?.page ?? page;
  const matchingTotal = pageQuery.isPlaceholderData ? pageQuery.data?.total : pageState.data?.total;
  const paginatedDrives = pageState.data?.items ?? [];
  const refetchPage = pageQuery.refetch;

  const downloadDriveExport = useCallback((format: 'csv' | 'json') => {
    const link = document.createElement('a');
    link.href = apiUrl(scopedPath('/export/drives', { ...exportScope, filters: { format } }));
    link.download = `teslasync-drives.${format}`;
    link.click();
  }, [exportScope]);
  const tableControls: TableControls = {
    search: {
      value: search,
      onChange: (value) => setUrlBatch({ q: value || null, page: null }),
      placeholder: t('drives.searchPlaceholder', 'Search drives — try "grade:D", "Office", "29.1"'),
      historyScope: 'drives',
      pending: search !== deferredSearch || pageState.status === 'initial' && search !== '',
    },
    density: { value: density, onChange: (next) => { if (next !== 'table') setDensity(next); }, testId: 'drives-density' },
    exports: {
      onExportCsv: () => downloadDriveExport('csv'),
      onExportJson: () => downloadDriveExport('json'),
      selectedCount: 0,
      description: t('drives.exportScope', 'Exports include every drive in the selected vehicle and date range, without list filters or selection.'),
      testId: 'drives-export',
    },
  };
  return {
    sortBy, effectiveSortDirection, setPage, pageSize, search, density, collection,
    fsdFilter, trendMetric, setTrendMetric, setUrlBatch, valueFilter, hasValueFilters,
    gridFilters, changeGridFilter, driveStatus, viewContext, restoreView, clearGridFilters,
    clearValueFilter, sortGrid, changeValueSelection, pageState, matchingTotal, safePage,
    paginatedDrives, refetchPage, matchingGrid, tableControls,
  };
}
