import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { getGlobalLocale, setGlobalLocale } from '@/lib/numberFormat';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { SignalsCatalogResponse } from '@/types/signals';
import type { WidgetSize } from './types';

const mocks = vi.hoisted(() => ({
  catalog: vi.fn(), observations: vi.fn(), retryCatalog: vi.fn(), retryObservations: vi.fn(),
  request: vi.fn(), translation: vi.fn(), realHooks: false,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [{ id: 1 }] }) }));
vi.mock('@/api/client', () => ({ request: mocks.request }));
vi.mock('@/api/hooks/useTelemetry', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useTelemetry')>('@/api/hooks/useTelemetry');
  return {
    ...actual,
    useSignalCatalog: () => {
      const useCatalog = mocks.realHooks ? actual.useSignalCatalog : mocks.catalog;
      return useCatalog();
    },
    useSignalObservations: (id: number) => {
      const useObservations = mocks.realHooks ? actual.useSignalObservations : mocks.observations;
      return useObservations(id);
    },
  };
});

// Exercise the installed library with the unchanged canonical English labels.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const { default: english } = await import('@/i18n/en.json');
  const i18n = createInstance();
  await i18n.init({
    lng: 'en',
    resources: { en: { dashboard: { widget: { signalCatalog: english.widget.signalCatalog } } } },
    interpolation: { escapeValue: false },
  });
  mocks.translation.mockImplementation(i18n.getFixedT('en', 'dashboard'));
  return { ...actual, useTranslation: () => ({ t: mocks.translation, i18n }) };
});

import SignalCatalogWidget from './SignalCatalogWidget';

function query<T>(data: T, refetch: () => void, error: Error | null = null) {
  return { data, refetch, error, isError: error != null, isLoading: false, isFetching: false, isStale: false, dataUpdatedAt: 0 };
}
function mount(client?: QueryClient, size: WidgetSize = { cols: 2, rows: 2 }) {
  const widget = <MemoryRouter><SignalCatalogWidget size={size} /></MemoryRouter>;
  return render(client ? <QueryClientProvider client={client}>{widget}</QueryClientProvider> : widget);
}
const destination = 'battery_with_a_complete_long_storage_destination_identity';
const field = 'PackVoltageWithACompleteLongSignalIdentity';
const timestamp = '2026-10-11T12:00:00Z';
const canonical: SignalsCatalogResponse = {
  signals: [
    { field, destination, value_kind: 'ValueKindDouble', last_seen_at: timestamp, sample_count_total: 250, vehicle_count: 2 },
    { field: 'Speed', destination: 'driving', value_kind: 'ValueKindFloat', last_seen_at: null, sample_count_total: null, vehicle_count: null },
  ],
  generated_at: timestamp,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.realHooks = false;
  mocks.request.mockReset();
  mocks.catalog.mockReturnValue(query(canonical, mocks.retryCatalog));
  mocks.observations.mockReturnValue(query([], mocks.retryObservations));
});

describe('signal catalog independent observations and complete served metadata', () => {
  it('preserves catalog identity and destination while retrying only failed observations', () => {
    mocks.observations.mockReturnValue(query(undefined, mocks.retryObservations, new Error('sample failed')));
    mount();
    expect(screen.getByText(field)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: new RegExp(`^Destination: ${destination}`) })).toBeInTheDocument();
    expect(screen.getByText('ValueKindDouble')).toBeInTheDocument();
    expect(screen.getByText(field)).not.toHaveClass('truncate');
    expect(screen.getByText('Signal observations unavailable')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryObservations).toHaveBeenCalledTimes(1);
    expect(mocks.retryCatalog).not.toHaveBeenCalled();
  });

  it('keeps complete search semantics for value kinds and destinations', () => {
    mount();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'valuekinddouble' } });
    expect(screen.getByText(field)).toBeInTheDocument();
    expect(screen.queryByText('Speed')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'driving' } });
    expect(screen.getByText('Speed')).toBeInTheDocument();
    expect(screen.queryByText(field)).not.toBeInTheDocument();
  });

  it('retains observation counts across a background failure', () => {
    mocks.observations.mockReturnValue(query([
      { signal_name: field },
      { signal_name: field },
    ], mocks.retryObservations, new Error('refresh failed')));
    mount();
    expect(screen.getByText('Previously loaded signal observations remain visible while this source recovers.')).toBeInTheDocument();
    expect(screen.getByText('2', { selector: 'span[title]' })).toBeInTheDocument();
    expect(screen.getByText(field)).toBeInTheDocument();
  });
});

describe('signal catalog actual query functions and independent source trust', () => {
  function client() {
    mocks.realHooks = true;
    return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  }

  function respond(observations: unknown = { observations: [] }) {
    mocks.request.mockImplementation((path: string) => {
      if (path === '/signals/catalog') return Promise.resolve(canonical);
      if (path.startsWith('/signals/observations?')) return Promise.resolve(observations);
      return Promise.reject(new Error(`Unexpected test request: ${path}`));
    });
  }

  function row(name: string) {
    return screen.getByText(name).closest('div')?.parentElement as HTMLElement;
  }

  it('renders the real canonical envelope, joins field identities, and distinguishes global totals from fetched samples', async () => {
    const cache = client();
    respond({ count: 2, total: 250, observations: [
      { vehicle_id: 1, field, ts: timestamp, value_kind: 'ValueKindDouble', value: 400 },
      { vehicle_id: 1, field, ts: timestamp, value_kind: 'ValueKindDouble', value: 401 },
    ] });
    mount(cache);
    await waitFor(() => expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('2'));
    expect(within(row(field)).getByText(/Total observations: 250/)).toHaveTextContent('Vehicles observed: 2');
    expect(within(row('Speed')).getByTitle('Observations in fetched sample')).toHaveTextContent('0');
    expect(within(row('Speed')).getByText(/Total observations: —/)).toHaveTextContent('Vehicles observed: —');
    expect(within(row('Speed')).getByText(/Last seen: —/)).toBeInTheDocument();
    expect(screen.getByText('Unit and description are not provided by this catalog.')).toBeInTheDocument();
    expect(screen.queryByText('V', { exact: true })).toBeNull();
    expect(screen.queryByText('m/s', { exact: true })).toBeNull();
    expect(cache.getQueryData(['signal-catalog'])).toEqual(canonical);
  });

  it('renders successful empty catalog data distinctly from an initial failure', async () => {
    const cache = client();
    mocks.request.mockImplementation((path: string) => Promise.resolve(
      path === '/signals/catalog' ? { signals: [], generated_at: timestamp } : { observations: [] },
    ));
    mount(cache);
    expect(await screen.findByText('No signals in catalog')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search signals' })).toBeInTheDocument();
    expect(cache.getQueryState(['signal-catalog'])?.status).toBe('success');
  });

  it('reports a missing required field as a catalog source error, not a dropped row or empty success', async () => {
    const cache = client();
    mocks.request.mockImplementation((path: string) => Promise.resolve(
      path === '/signals/catalog'
        ? { ...canonical, signals: [{ ...canonical.signals[0], field: undefined }] }
        : { observations: [] },
    ));
    mount(cache);
    await waitFor(() => expect(cache.getQueryState(['signal-catalog'])?.status).toBe('error'));
    expect(cache.getQueryState(['signal-catalog'])?.error?.message).toMatch(/Invalid signal catalog row/);
    expect(cache.getQueryData(['signal-catalog'])).toBeUndefined();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
    expect(screen.queryByText(field)).toBeNull();
    expect(await screen.findByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('keeps a valid cached catalog visible and searchable after a malformed refresh', async () => {
    const cache = client();
    respond();
    const { container } = mount(cache);
    expect(await screen.findByText(field)).toBeInTheDocument();
    mocks.request.mockImplementation((path: string) => Promise.resolve(
      path === '/signals/catalog'
        ? { ...canonical, signals: [{ ...canonical.signals[0], value_kind: null }] }
        : { observations: [] },
    ));
    await act(async () => { await cache.refetchQueries({ queryKey: ['signal-catalog'] }); });
    await waitFor(() => expect(container.querySelector('[data-data-state="stale"]')).toBeTruthy());
    expect(cache.getQueryData(['signal-catalog'])).toEqual(canonical);
    expect(screen.getByText(field)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'double' } });
    expect(screen.getByText(field)).toBeInTheDocument();
    expect(screen.queryByText('Speed')).toBeNull();
  });

  it('keeps counts unknown through observation failure and loading, then shows real zero after a successful empty retry', async () => {
    const cache = client();
    mocks.request.mockImplementation((path: string) => path === '/signals/catalog'
      ? Promise.resolve(canonical) : Promise.reject(new Error('sample failed')));
    mount(cache);
    expect(await screen.findByText('Signal observations unavailable')).toBeInTheDocument();
    expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('—');
    mocks.request.mockClear();
    let resolveSample: ((value: unknown) => void) | undefined;
    mocks.request.mockImplementation((path: string) => path === '/signals/catalog'
      ? Promise.resolve(canonical) : new Promise((resolve) => { resolveSample = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(resolveSample).toBeDefined());
    expect(mocks.request.mock.calls.every(([path]) => String(path).startsWith('/signals/observations?'))).toBe(true);
    expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('—');
    await act(async () => { resolveSample?.({ count: 0, total: 0, observations: [] }); });
    await waitFor(() => expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('0'));
    expect(screen.queryByText('Signal observations unavailable')).toBeNull();
  });

  it('retains real observation counts after failure and refreshes both sources manually', async () => {
    const cache = client();
    respond({ observations: [{ vehicle_id: 1, field, ts: timestamp, value_kind: 'ValueKindDouble', value: 400 }] });
    mount(cache);
    await waitFor(() => expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('1'));
    mocks.request.mockImplementation((path: string) => path === '/signals/catalog'
      ? Promise.resolve(canonical) : Promise.reject(new Error('refresh failed')));
    await act(async () => { await cache.refetchQueries({ queryKey: ['signal-observations'] }); });
    expect(await screen.findByText('Previously loaded signal observations remain visible while this source recovers.')).toBeInTheDocument();
    expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('1');
    mocks.request.mockClear();
    respond();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    await waitFor(() => expect(mocks.request.mock.calls.some(([path]) => path === '/signals/catalog')).toBe(true));
    expect(mocks.request.mock.calls.some(([path]) => String(path).startsWith('/signals/observations?'))).toBe(true);
    await waitFor(() => expect(within(row(field)).getByTitle('Observations in fetched sample')).toHaveTextContent('0'));
  });

  it('preserves the compact signal count when the independent observation source fails', async () => {
    const cache = client();
    mocks.request.mockImplementation((path: string) => path === '/signals/catalog'
      ? Promise.resolve(canonical) : Promise.reject(new Error('sample failed')));
    const { container } = mount(cache, { cols: 1, rows: 1 });
    expect(await screen.findByText('2')).toBeInTheDocument();
    expect(screen.getByText(/signals available/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Signal catalog/i })).toBeInTheDocument();
    await waitFor(() => expect(container.querySelector('[data-data-state="partial"]')).toBeTruthy());
    expect(screen.queryByRole('textbox')).toBeNull();
  });
});


describe('signal catalog numeric translation counts and formatted operands', () => {
  let originalLocale: string;

  beforeEach(() => {
    originalLocale = getGlobalLocale();
    setGlobalLocale('en-US');
  });

  afterEach(() => {
    act(() => { setGlobalLocale(originalLocale); });
  });

  it('uses numeric counts for plural selection and replacement counts for installed i18next interpolation', async () => {
    const i18n = createInstance();
    await i18n.init({
      lng: 'en',
      resources: { en: { translation: {
        observations_one: 'One observation: {{count}}',
        observations_other: 'Many observations: {{count}}',
      } } },
      interpolation: { escapeValue: false },
    });
    expect(i18n.t('observations', { count: 1, replace: { count: '1' } })).toBe('One observation: 1');
    expect(i18n.t('observations', { count: 12345, replace: { count: '12,345' } })).toBe('Many observations: 12,345');
    expect(i18n.t('missing', 'Total observations: {{count}}', {
      count: 12345, replace: { count: '12,345' },
    })).toBe('Total observations: 12,345');
  });

  it('keeps canonical aggregate labels formatted and reactive without refetching either source', () => {
    const catalog: SignalsCatalogResponse = {
      ...canonical,
      signals: [{ ...canonical.signals[0], sample_count_total: 12345, vehicle_count: 6789 }],
    };
    mocks.catalog.mockReturnValue(query(catalog, mocks.retryCatalog));
    mount();
    expect(screen.getByText(/Total observations: 12,345/)).toHaveTextContent('Vehicles observed: 6,789');
    expect(mocks.translation).toHaveBeenCalledWith('widget.signalCatalog.totalSamples', 'Total observations: {{count}}', {
      count: 12345, replace: { count: '12,345' },
    });
    expect(mocks.translation).toHaveBeenCalledWith('widget.signalCatalog.vehicleCount', 'Vehicles observed: {{count}}', {
      count: 6789, replace: { count: '6,789' },
    });
    act(() => { setGlobalLocale('de-DE'); });
    expect(screen.getByText(/Total observations: 12\.345/)).toHaveTextContent('Vehicles observed: 6.789');
    expect(mocks.translation).toHaveBeenCalledWith('widget.signalCatalog.totalSamples', 'Total observations: {{count}}', {
      count: 12345, replace: { count: '12.345' },
    });
    expect(mocks.translation).toHaveBeenCalledWith('widget.signalCatalog.vehicleCount', 'Vehicles observed: {{count}}', {
      count: 6789, replace: { count: '6.789' },
    });
    expect(mocks.retryCatalog).not.toHaveBeenCalled();
    expect(mocks.retryObservations).not.toHaveBeenCalled();
    expect(catalog.signals[0].sample_count_total).toBe(12345);
    expect(catalog.signals[0].vehicle_count).toBe(6789);
  });

  it('distinguishes real zero aggregate counts from missing metadata in canonical interpolation', () => {
    mocks.catalog.mockReturnValue(query({
      ...canonical,
      signals: [
        { ...canonical.signals[0], sample_count_total: 0, vehicle_count: 0 },
        canonical.signals[1],
      ],
    }, mocks.retryCatalog));
    mount();
    expect(screen.getByText(/Total observations: 0/)).toHaveTextContent('Vehicles observed: 0');
    expect(screen.getByText(/Total observations: —/)).toHaveTextContent('Vehicles observed: —');
    for (const [key, fallback] of [
      ['widget.signalCatalog.totalSamples', 'Total observations: {{count}}'],
      ['widget.signalCatalog.vehicleCount', 'Vehicles observed: {{count}}'],
    ]) {
      expect(mocks.translation).toHaveBeenCalledWith(key, fallback, { count: 0, replace: { count: '0' } });
      expect(mocks.translation).toHaveBeenCalledWith(key, fallback, { count: undefined, replace: { count: '—' } });
    }
  });
});
