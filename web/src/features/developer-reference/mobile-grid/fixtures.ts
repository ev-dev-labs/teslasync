/** REFERENCE FIXTURES only. All physical quantities stay canonical SI on disk. */
export interface ReferenceRecord {
  id: string;
  place: 'home' | 'supercharger';
  timestamp: string;
  energy_wh: number | null;
  duration_s: number | null;
  distance_m: number | null;
  temperature_c: number | null;
  power_w: number | null;
  start_percent: number | null;
  end_percent: number | null;
  cost_usd: number | null;
  score: 'A' | 'B' | null;
  raw_field: string;
  note: 'normal' | 'long';
  status: 'complete' | 'pending';
}
export interface ReferenceScenario {
  id: string;
  labelKey: string;
  label: string;
  count: number;
  state?: 'loading' | 'error' | 'retained' | 'empty';
  query?: string;
  grouped?: boolean;
  long?: boolean;
  keyValue?: boolean;
  selecting?: boolean;
  openSort?: boolean;
  replacing?: boolean;
  fullExportOnly?: boolean;
  exportFailure?: boolean;
}
export const REFERENCE_SCENARIOS: readonly ReferenceScenario[] = [
  { id: 'dev-empty', labelKey: 'empty', label: 'Empty with action', count: 0, state: 'empty' },
  { id: 'dev-no-match', labelKey: 'noMatch', label: 'No matching records', count: 21, query: 'unmatched-reference' },
  { id: 'dev-loading', labelKey: 'loading', label: 'Loading: three skeletons', count: 10, state: 'loading' },
  { id: 'dev-error', labelKey: 'error', label: 'Initial error with Retry', count: 10, state: 'error' },
  { id: 'dev-retained-error', labelKey: 'retained', label: 'Retained data with retry', count: 10, state: 'retained' },
  { id: 'dev-one-row', labelKey: 'oneRow', label: 'One row: zero and missing values', count: 1 },
  { id: 'dev-one-page', labelKey: 'onePage', label: 'One page', count: 6 },
  { id: 'dev-many-pages', labelKey: 'manyPages', label: 'Three cumulative batches', count: 21 },
  { id: 'dev-200-rows', labelKey: 'manyRows', label: '200 reference rows', count: 200 },
  { id: 'dev-grouped', labelKey: 'grouped', label: 'Groups of one and three', count: 4, grouped: true },
  { id: 'dev-long-values', labelKey: 'longValues', label: 'Long titles and values', count: 4, long: true },
  { id: 'dev-many-columns', labelKey: 'manyColumns', label: '15 source fields: nothing lost', count: 4 },
  { id: 'dev-key-value', labelKey: 'keyValue', label: 'Timestamp key/value records', count: 4, grouped: true, keyValue: true, long: true },
  { id: 'dev-selection', labelKey: 'selection', label: 'Selection across batches', count: 21, selecting: true },
  { id: 'dev-sort-open', labelKey: 'sortOpen', label: 'Sort bottom sheet open', count: 21, openSort: true },
  { id: 'dev-replacing-page', labelKey: 'replacing', label: 'Replacing server-page adapter gap', count: 10, replacing: true },
  { id: 'dev-full-export', labelKey: 'fullExport', label: 'Full-result export is not selected export', count: 21, selecting: true, fullExportOnly: true },
  { id: 'dev-export-error', labelKey: 'exportError', label: 'Export request failure', count: 21, selecting: true, exportFailure: true },
];
export function makeReferenceRecords(count: number, long = false): ReferenceRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `reference-${index + 1}`,
    place: index % 3 === 0 ? 'supercharger' : 'home',
    timestamp: index === 0 ? '2026-10-03T14:13:00Z' : '2026-10-02T14:13:00Z',
    energy_wh: index === 0 ? 0 : 26300,
    duration_s: index === 0 ? null : 10800,
    distance_m: index === 0 ? null : 42300,
    temperature_c: index === 0 ? 0 : 22.5,
    power_w: index === 0 ? null : 7700,
    start_percent: index === 0 ? null : 45,
    end_percent: index === 0 ? null : 80,
    cost_usd: index === 0 ? 0 : 3.2,
    score: index === 0 ? null : 'A',
    raw_field: long ? 'BatteryLevelVeryLongDiagnosticFieldNameWithoutBreaks' : 'BatteryLevel',
    note: long ? 'long' : 'normal',
    status: index === 0 ? 'pending' : 'complete',
  }));
}
