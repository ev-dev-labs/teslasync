import '@testing-library/jest-dom/vitest';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/i18n/en.json';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import type { DataQualityFieldScore } from '@/types/admin-operator-confidence';
import { FieldQualityTable } from './FieldQualityTable';

vi.unmock('react-i18next');
vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(), downloadJSON: vi.fn(),
}));

function field(overrides: Partial<DataQualityFieldScore> = {}): DataQualityFieldScore {
  return {
    field: 'VehicleSpeed', sample_count: 1234, last_seen_at: '2026-10-13T18:00:00Z',
    freshness_seconds: 61, max_gap_seconds: 5400, duplicate_ratio: 0.125,
    versioned_sample_count: 1000, unversioned_sample_count: 234,
    normalization_coverage_pct: 81.0373, normalization_coverage_state: 'measured',
    composite_score: 49.125, severity: 'critical', ...overrides,
  };
}

const translations = {
  admin: { dataQuality: {
    tableTitle: 'Qualité des champs', colField: 'Champ', colFieldSamples: '{{samples}} échantillons',
    colSeverity: 'Qualité', colFreshness: 'Fraîcheur', colMaxGap: 'Écart maximal',
    colDuplicates: 'Doublons', colVersioned: 'Attestés', colUnversioned: 'Non attestés',
    colCoverage: 'Couverture', unknown: 'Inconnu', trustUnknown: 'Inconnu',
    trustPartial: 'Partiellement attesté', trustComplete: 'Entièrement attesté',
    trustNone: 'Non attesté',
  }, diskForecast: { severityOk: 'Correct' } },
  severity: { warn: 'Avertissement', critical: 'Critique' },
  recentPages: { shortMinute: 'min-local', shortHour: 'h-local', shortDay: 'j-local' },
};
const observers = new Map<Element, ResizeObserverCallback>();
const retry = vi.fn();
const clients: QueryClient[] = [];

beforeEach(() => {
  localStorage.clear(); observers.clear(); vi.clearAllMocks();
  setGlobalLocale('en-US'); setGlobalPrecision(2);
  vi.stubGlobal('ResizeObserver', class {
    private elements = new Set<Element>();
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { this.elements.add(element); observers.set(element, this.callback); }
    unobserve(element: Element) { this.elements.delete(element); observers.delete(element); }
    disconnect() { this.elements.forEach(element => observers.delete(element)); this.elements.clear(); }
  });
});
afterEach(() => {
  cleanup(); clients.forEach(client => client.clear()); clients.length = 0;
  vi.unstubAllGlobals(); setGlobalLocale('en-US'); setGlobalPrecision(2);
});

function resize(width: number) {
  act(() => observers.forEach((callback, element) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry], {} as ResizeObserver,
  )));
}
function mount(fields: readonly DataQualityFieldScore[], extra: Partial<Parameters<typeof FieldQualityTable>[0]> = {}, language = 'en') {
  const i18n = createInstance();
  void i18n.use(initReactI18next).init({
    initAsync: false, lng: language, fallbackLng: 'en',
    resources: { en: { translation: en }, fr: { translation: translations } },
    interpolation: { escapeValue: false },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}><MemoryRouter><I18nextProvider i18n={i18n}>
    <FieldQualityTable fields={fields} loading={false} error={null} onRetry={retry} {...extra} />
  </I18nextProvider></MemoryRouter></QueryClientProvider>);
}
async function exportAs(format: 'CSV' | 'JSON') {
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
  expect(screen.getByText('Exports include only matching loaded rows, or selected loaded rows.')).toBeInTheDocument();
  expect(screen.queryByRole('menuitemradio', { name: /full result/i })).toBeNull();
  fireEvent.click(screen.getByRole('menuitem', { name: `Download as ${format}` }));
  await waitFor(() => expect(format === 'JSON' ? downloadJSON : downloadCSV).toHaveBeenCalledOnce());
}
function exportedRows(): Record<string, unknown>[] {
  return vi.mocked(downloadJSON).mock.calls[0][1] as Record<string, unknown>[];
}
describe('FieldQualityTable presentation and preservation contracts', () => {
  it('preserves worst first ordering ties all eight columns samples score and raw input', () => {
    const fields = Object.freeze([Object.freeze(field({ field: 'Healthy', composite_score: 100, severity: 'ok' })),
      Object.freeze(field({ field: 'Zulu' })), Object.freeze(field({ field: 'Alpha' }))]);
    mount(fields);
    const table = screen.getByRole('table');
    expect(within(table).getAllByRole('row').slice(1).map(row => row.querySelector('[data-column-key="field"]')?.textContent))
      .toEqual(['Alpha1,234 samples', 'Zulu1,234 samples', 'Healthy1,234 samples']);
    expect(within(table).getAllByRole('columnheader')).toHaveLength(8);
    expect(within(table).getAllByText('49.13')).toHaveLength(2);
    expect(fields.map(row => row.field)).toEqual(['Healthy', 'Zulu', 'Alpha']);
    expect(fields[1]).toMatchObject({ freshness_seconds: 61, max_gap_seconds: 5400, duplicate_ratio: 0.125 });
  });

  it.each([
    ['max gap', 'Max gap', '2h'], ['duplicates', 'Duplicates', '12.50%'],
    ['attested count', 'Attested', '1,000'], ['unattested count', 'Unattested', '234'],
    ['coverage and trust', 'Coverage', '81.04%'],
  ])('keeps mobile %s reachable in the real shared detail presentation', (_name, label, value) => {
    mount([field()]);
    resize(375);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const detail = screen.getByRole('dialog', { name: /VehicleSpeed|Per-field quality/ });
    expect(within(detail).getByText(label)).toBeInTheDocument();
    expect(detail).toHaveTextContent(value);
    expect(detail).toHaveTextContent('1,234 samples');
    expect(detail).toHaveTextContent('49.13');
    expect(detail).toHaveTextContent('VehicleSpeed');
    expect(detail).toHaveTextContent('1m');
    expect(detail).toHaveTextContent('Partially attested');
    fireEvent.click(within(detail).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('uses allocated mobile boundaries without dropping rows or stored preferences', () => {
    localStorage.setItem('teslasync.table.admin:data-quality-fields.columns',
      JSON.stringify({ order: ['coverage', 'field', 'severity', 'freshness', 'gap', 'duplicates', 'versioned', 'unversioned'], hidden: [] }));
    const before = localStorage.getItem('teslasync.table.admin:data-quality-fields.columns');
    const view = mount([field(), field({ field: 'Second', composite_score: 100 })]);
    resize(639);
    expect(view.container.querySelector('[data-mobile-table]')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(2);
    resize(640);
    expect(screen.getByRole('table')).toHaveTextContent('Second');
    resize(641);
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(3);
    expect(localStorage.getItem('teslasync.table.admin:data-quality-fields.columns')).toBe(before);
  });

  it('exports SI numeric values rather than formatted duration ratio and count strings', async () => {
    const row = field();
    mount([row]);
    await exportAs('JSON');
    expect(exportedRows()).toEqual([{
      field: 'VehicleSpeed', sample_count: 1234, last_seen_at: '2026-10-13T18:00:00Z',
      freshness_seconds: 61, max_gap_seconds: 5400, duplicate_ratio: 0.125,
      versioned_sample_count: 1000, unversioned_sample_count: 234,
      normalization_coverage_pct: 81.0373, normalization_coverage_state: 'measured',
      composite_score: 49.125, severity: 'critical',
    }]);
  });

  it('keeps every measured zero numeric and unknown coverage null in JSON', async () => {
    const zero = field({ field: 'Zero', sample_count: 0, composite_score: 0, freshness_seconds: 0,
      max_gap_seconds: 0, duplicate_ratio: 0, versioned_sample_count: 0, unversioned_sample_count: 0,
      normalization_coverage_pct: 0 });
    const unknown = field({ field: 'Unknown', normalization_coverage_pct: null, normalization_coverage_state: 'unknown' });
    mount([unknown, zero]);
    await exportAs('JSON');
    expect(exportedRows()).toEqual([zero, unknown]);
  });

  it('preserves runtime null numeric values in raw JSON instead of display placeholders', async () => {
    // Deliberate runtime resilience fixture; these nulls do not broaden the wire TypeScript schema.
    const row: DataQualityFieldScore = JSON.parse(JSON.stringify({
      ...field(), freshness_seconds: null, max_gap_seconds: null, duplicate_ratio: null,
      versioned_sample_count: null, unversioned_sample_count: null, normalization_coverage_pct: null,
      normalization_coverage_state: 'unknown',
    }));
    mount([row]);
    const table = screen.getByRole('table');
    expect(within(table).getAllByText('—')).toHaveLength(5);
    expect(within(table).getAllByText('Unknown')).toHaveLength(2);
    await exportAs('JSON');
    expect(exportedRows()).toEqual([row]);
  });

  it('exports only matching loaded rows after search without claiming a full result', async () => {
    mount([field({ field: 'Excluded', composite_score: 1 }), field({ field: 'Kept', composite_score: 2 })]);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search loaded rows' }), { target: { value: 'Kept' } });
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Excluded')).toBeNull());
    await exportAs('JSON');
    expect(exportedRows().map(row => row.field)).toEqual(['Kept']);
    expect(retry).not.toHaveBeenCalled();
  });

  it('preserves raw value filter interactions and loaded row scope', async () => {
    mount([field({ field: 'Keep' }), field({ field: 'Drop' })]);
    fireEvent.click(screen.getByRole('button', { name: 'Field filter' }));
    const dialog = screen.getByRole('dialog', { name: 'Field filter' });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Select all shown values' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Keep' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(within(screen.getByRole('table')).getByText('Keep')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryByText('Drop')).toBeNull();
    await exportAs('JSON');
    expect(exportedRows().map(row => row.field)).toEqual(['Keep']);
  });

  it('defines CSV as display text while JSON remains a raw numeric contract', async () => {
    const view = mount([field()]);
    await exportAs('CSV');
    const csv = vi.mocked(downloadCSV).mock.calls[0][1];
    expect(csv).toContain('Freshness');
    expect(csv).toContain('1m');
    expect(csv).toContain('2h');
    expect(csv).toContain('12.50%');
    expect(csv).toContain('"1,000"');
    expect(csv).toContain('81.04%');
    expect(csv).toContain('Partially attested');
    expect(downloadJSON).not.toHaveBeenCalled();
    view.unmount();
    vi.mocked(downloadCSV).mockClear();
    const saved = { order: ['coverage', 'field', 'severity', 'freshness', 'gap', 'duplicates', 'versioned', 'unversioned'], hidden: ['gap'] };
    localStorage.setItem('teslasync.table.admin:data-quality-fields.columns', JSON.stringify(saved));
    mount([field()]);
    await exportAs('CSV');
    expect(vi.mocked(downloadCSV).mock.calls[0][1].split('\r\n')[0])
      .toBe('Coverage,Field,Quality,Freshness,Duplicates,Attested,Unattested');
    expect(vi.mocked(downloadCSV).mock.calls[0][1]).not.toContain('2h');
    await exportAs('JSON');
    expect(exportedRows()).toEqual([field()]);
    expect(localStorage.getItem('teslasync.table.admin:data-quality-fields.columns')).toBe(JSON.stringify(saved));
  });

  it.each([
    ['warn', 'Avertissement'], ['critical', 'Critique'],
  ] as const)('localizes severity %s without changing the raw classification', (severity, label) => {
    const row = field({ severity });
    const healthy = field({ field: 'Healthy', severity: 'ok', composite_score: 100 });
    mount([row, healthy], {}, 'fr');
    expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText('Correct')).toBeInTheDocument();
    expect(row.severity).toBe(severity);
    expect(healthy.severity).toBe('ok');
  });

  it('uses a localized human caption instead of the persistent table identifier', () => {
    mount([field()], {}, 'fr');
    const table = screen.getByRole('table', { name: 'Qualité des champs' });
    expect(table.querySelector('caption')).toHaveTextContent('Qualité des champs');
    expect(localStorage.getItem('teslasync.table.admin:data-quality-fields.columns')).toBeNull();
  });

  it('localizes duration digits and existing minute hour day units without SI mutation', () => {
    setGlobalLocale('ar-EG');
    const row = field({ freshness_seconds: 61, max_gap_seconds: 129600 });
    mount([row, field({ field: 'Hour', composite_score: 100, freshness_seconds: 5400 })], {}, 'fr');
    const table = screen.getByRole('table');
    const freshness = table.querySelector('tbody [data-column-key="freshness"]');
    const gap = table.querySelector('tbody [data-column-key="gap"]');
    expect(freshness).toHaveTextContent('١');
    expect(freshness).toHaveTextContent('min-local');
    expect(gap).toHaveTextContent('٢');
    expect(gap).toHaveTextContent('j-local');
    const hour = table.querySelectorAll('tbody [data-column-key="freshness"]')[1];
    expect(hour).toHaveTextContent('٢');
    expect(hour).toHaveTextContent('h-local');
    expect(row).toMatchObject({ freshness_seconds: 61, max_gap_seconds: 129600 });
  });

  it('uses the embedded variant without losing inherited toolbar actions', () => {
    const view = mount([field()]);
    expect(view.container.querySelector('[data-grid-frame]')).toHaveAttribute('data-grid-variant', 'embedded');
    expect(screen.getByRole('button', { name: 'Export list' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Reorder or hide columns' })).toBeEnabled();
    expect(screen.getByRole('searchbox', { name: 'Search loaded rows' })).toBeEnabled();
  });

  it('keeps unknown coverage distinct from measured zero and honors stale unknown state', () => {
    mount([field({ field: 'Zero', normalization_coverage_pct: 0 }),
      field({ field: 'Missing', normalization_coverage_pct: null, normalization_coverage_state: 'unknown' }),
      field({ field: 'Stale', normalization_coverage_pct: 100, normalization_coverage_state: 'unknown' })]);
    const table = screen.getByRole('table');
    expect(within(table).getByText('0.00%')).toBeInTheDocument();
    expect(within(table).getAllByText('Unknown')).toHaveLength(4);
    expect(within(table).queryByText('100.00%')).toBeNull();
  });

  it('keeps loaded rows during refresh and exposes empty refresh and error retry independently', () => {
    const view = mount([field()], { loading: true });
    expect(screen.getByRole('table')).toHaveTextContent('VehicleSpeed');
    view.unmount();
    const empty = mount([]);
    expect(screen.getByText('No field scores')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledOnce();
    empty.unmount();
    mount([], { error: new Error('Read failed') });
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(retry).toHaveBeenCalledTimes(2);
  });

  it('renders initial loading inside the preserved field section without fabricating rows', () => {
    const view = mount([], { loading: true });
    expect(screen.getByText('Per-field quality and provenance')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.queryByText('No field scores')).toBeNull();
    expect(view.container.textContent).not.toContain('0 samples');
  });
});
