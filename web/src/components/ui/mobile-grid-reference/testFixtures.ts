import { vi } from 'vitest';
import type { MobileGridCallbacks, MobileGridModel, MobileRow } from './types';

export function referenceRow(): MobileRow {
  return {
    key: 'r1', title: 'Reference record', primary: '$0.00',
    meta: [{ key: 'energy_wh', label: 'Energy', value: '0 kWh' }],
    details: [{ key: 'energy_wh', label: 'Energy', value: '0 kWh' }],
  };
}
export function referenceModel(): MobileGridModel {
  return {
    id: 'dev-test', label: 'Test reference', variant: 'cards', state: { kind: 'ready' },
    groups: [{ key: 'day', label: 'Oct 3 · Yesterday', rows: [referenceRow()], memberCount: 1, summary: 'must not render' }],
    query: '', maximumRows: 21,
    sortKey: 'newest', sortOptions: [{ key: 'newest', label: 'Newest first' }, { key: 'cost', label: 'Highest cost' }],
    filterKey: 'all', filters: [{ key: 'all', label: 'All', count: 21 }, { key: 'home', label: 'Home', count: 3 }],
    selection: { enabled: false, mode: 'multi', keys: [] },
    pagination: { kind: 'cumulative', shown: 10, total: 21, nextCount: 10 },
    exports: [{ scope: 'matchingLoaded', label: 'Request matching export' }, { scope: 'selectedLoaded', label: 'Request selected export' }],
    overlays: { sort: false, overflow: false },
  };
}
export function referenceCallbacks(): MobileGridCallbacks {
  return {
    onSearch: vi.fn(), onFilter: vi.fn(), onSort: vi.fn(), onOverlay: vi.fn(),
    onSelectionMode: vi.fn(), onToggleSelection: vi.fn(), onActivate: vi.fn(),
    onExport: vi.fn(), onLoadMore: vi.fn(), onRetry: vi.fn(), onClear: vi.fn(),
  };
}
