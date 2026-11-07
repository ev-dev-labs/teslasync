import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import type { DataStateSource } from '@/api/dataState';
import type { SignalObservation, SignalsCatalogResponse } from '@/types/signals';
import { Text } from '@/components/ui';
import SignalCatalogWidget from './SignalCatalogWidget';
import { PackBoundary } from './designPacks/PackBoundary';
import type { WidgetSize } from './types';

type QueryFixture<T> = DataStateSource<T> & {
  status: 'pending' | 'success' | 'error';
  refetch: () => Promise<void>;
};

const mocks = vi.hoisted(() => ({
  catalog: vi.fn<() => QueryFixture<SignalsCatalogResponse>>(),
  observations: vi.fn<(id: number) => QueryFixture<SignalObservation[]>>(),
  vehicles: vi.fn<() => { data: { id: number }[] }>(),
  retryCatalog: vi.fn<() => Promise<void>>(),
  retryObservations: vi.fn<() => Promise<void>>(),
}));

vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalCatalog: mocks.catalog,
  useSignalObservations: mocks.observations,
}));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: mocks.vehicles }));
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const { createInstance } = await vi.importActual<typeof import('i18next')>('i18next');
  const i18n = createInstance();
  await i18n.init({ lng: 'en', resources: {}, interpolation: { escapeValue: false } });
  return { ...actual, useTranslation: () => ({ t: i18n.getFixedT('en'), i18n }) };
});
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (value: unknown) => String(value) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: true, durationMs: 0 }),
}));

const packs = [
  ['v1', 'studio'], ['v2', 'elevated'], ['v3', 'precision'], ['v4', 'owner'],
  ['v5', 'iconic'], ['v6', 'expressive'], ['v7', 'pixel'],
] as const;
const full: WidgetSize = { cols: 2, rows: 4 };
const compact: WidgetSize = { cols: 1, rows: 1 };
const timestamp = '2026-11-06T08:30:15Z';
const longField = 'PackVoltageWithACompleteLongSignalIdentity';
const note = 'Catalog definitions and actual observations are different things.';
const catalog: SignalsCatalogResponse = {
  generated_at: timestamp,
  signals: [
    { field: 'Soc', destination: 'battery', value_kind: 'ValueKindFloat', sample_count_total: 1200, vehicle_count: 1, last_seen_at: timestamp },
    { field: longField, destination: 'battery', value_kind: 'ValueKindDouble', sample_count_total: 800, vehicle_count: 1, last_seen_at: timestamp },
    { field: 'VehicleSpeed', destination: 'driving', value_kind: 'ValueKindFloat', sample_count_total: null, vehicle_count: null, last_seen_at: null },
  ],
};

function observation(signal_name: string, value_numeric: number): SignalObservation {
  return { vehicle_id: 42, ts: timestamp, signal_name, value_numeric, value_text: null, value_bool: null, source: 'fleet_telemetry' };
}

function query<T>(
  data: T | undefined,
  refetch: () => Promise<void>,
  overrides: Partial<QueryFixture<T>> = {},
): QueryFixture<T> {
  return {
    data, refetch, status: 'success', error: null, isError: false, isSuccess: true,
    isLoading: false, isPending: false, isFetching: false, isStale: false,
    fetchStatus: 'idle', dataUpdatedAt: Date.now(), ...overrides,
  };
}

function LocationProbe() {
  return <Text data-testid="location">{useLocation().pathname}</Text>;
}

function tree(requestedPackId?: unknown, size = full, vehicleId?: number) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={requestedPackId}>
        <SignalCatalogWidget size={size} vehicleId={vehicleId} />
      </PackBoundary>
      <LocationProbe />
    </MemoryRouter>
  );
}

async function presentation(container: HTMLElement, appearance: string) {
  return waitFor(() => {
    const element = container.querySelector<HTMLElement>(
      `[data-widget-family="list"][data-widget-appearance="${appearance}"]`,
    );
    if (!element) throw new Error('The requested list presentation has not loaded');
    return element;
  });
}

function signalRow(list: HTMLElement, field: string) {
  const row = within(list).getByText(field).closest('div');
  if (!row) throw new Error(`Missing signal row: ${field}`);
  return within(row);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.retryCatalog.mockResolvedValue(undefined);
  mocks.retryObservations.mockResolvedValue(undefined);
  mocks.vehicles.mockReturnValue({ data: [{ id: 7 }] });
  mocks.catalog.mockReturnValue(query(catalog, mocks.retryCatalog));
  mocks.observations.mockReturnValue(query([
    observation('Soc', 68), observation('Soc', 69), observation(longField, 398),
  ], mocks.retryObservations));
});

describe('SignalCatalogWidget production design packs', () => {
  it.each(packs)('%s preserves every category, served metadata and actual actions in %s', async (packId, appearance) => {
    const view = render(tree(packId, full, 42));
    const selected = await presentation(view.container, appearance);
    const list = within(selected).getByRole('list', { name: 'Signals available' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(2);
    expect(within(list).getByRole('heading', { name: 'Destination: battery' })).toBeInTheDocument();
    expect(within(list).getByRole('heading', { name: 'Destination: driving' })).toBeInTheDocument();
    expect(within(list).getByText(longField)).not.toHaveClass('truncate');
    expect(signalRow(list, 'Soc').getByTitle('Observations in fetched sample')).toHaveTextContent('2');
    expect(signalRow(list, longField).getByTitle('Observations in fetched sample')).toHaveTextContent('1');
    expect(signalRow(list, 'VehicleSpeed').getByTitle('Observations in fetched sample')).toHaveTextContent('0');
    expect(signalRow(list, 'Soc').getByText(/Total observations: 1,200/)).toHaveTextContent('Vehicles observed: 1');
    expect(signalRow(list, 'Soc').getByText(`Last seen: ${timestamp}`)).toBeInTheDocument();
    expect(signalRow(list, longField).getByText('ValueKindDouble')).toBeInTheDocument();
    expect(signalRow(list, 'VehicleSpeed').getByText(/Total observations: —/)).toHaveTextContent('Vehicles observed: —');
    expect(signalRow(list, 'VehicleSpeed').getByText('Last seen: —')).toBeInTheDocument();
    expect(within(list).getByText('2,000 obs')).toBeInTheDocument();
    expect(within(list).getByText('Observations unavailable')).toBeInTheDocument();
    expect(within(selected).getByText(note)).toBeInTheDocument();
    expect(within(selected).getByText('Unit and description are not provided by this catalog.')).toBeInTheDocument();
    expect(within(selected).getAllByText('Soc')).toHaveLength(2);
    expect(selected.querySelector('.lucide-book-open')).not.toBeNull();
    expect(selected).toHaveAttribute('data-instrument-family', 'list');
    expect(within(selected).queryByRole('meter')).not.toBeInTheDocument();
    expect(within(selected).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(selected).queryByText(/68%|398 V|m\/s/)).not.toBeInTheDocument();
    expect(mocks.catalog).toHaveBeenCalledTimes(1);
    expect(mocks.observations).toHaveBeenCalledTimes(1);
    expect(mocks.observations).toHaveBeenLastCalledWith(42);

    const search = within(selected).getByRole('textbox', { name: 'Search signals' });
    for (const term of ['driving', 'valuekinddouble', 'Soc']) {
      fireEvent.change(search, { target: { value: term } });
      const currentList = screen.getByRole('list', { name: 'Signals available' });
      const expectedField = term === 'driving' ? 'VehicleSpeed' : term === 'Soc' ? 'Soc' : longField;
      expect(within(currentList).getByText(expectedField)).toBeInTheDocument();
      expect(within(currentList).getAllByRole('listitem')).toHaveLength(1);
    }
    fireEvent.change(search, { target: { value: 'no-such-signal' } });
    expect(screen.getByText('No matching signals')).toBeInTheDocument();
    expect(screen.getByText('3 signals')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse' })).toHaveAttribute('href', '/signals');
    fireEvent.change(search, { target: { value: '' } });
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(mocks.retryCatalog).toHaveBeenCalledOnce();
    expect(mocks.retryObservations).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', { name: 'Browse' }));
    expect(screen.getByTestId('location')).toHaveTextContent('/signals');
  });

  it.each(packs)('%s retains compact counts and honest successful-empty evidence in %s', async (packId, appearance) => {
    const view = render(tree(packId, compact));
    const selected = await presentation(view.container, appearance);
    expect(selected.querySelector('.widget-big-number')).toHaveTextContent('Signals available');
    expect(selected.querySelector('.widget-big-number')).toHaveTextContent('3');
    expect(within(selected).queryByRole('textbox')).not.toBeInTheDocument();
    expect(within(selected).queryByRole('list')).not.toBeInTheDocument();
    expect(mocks.observations).toHaveBeenLastCalledWith(7);
    expect(screen.getByRole('link', { name: 'Browse' })).toBeInTheDocument();

    mocks.catalog.mockReturnValue(query({ signals: [], generated_at: timestamp }, mocks.retryCatalog));
    view.rerender(tree(packId, compact));
    expect(selected.querySelector('.widget-big-number')).toHaveTextContent('0');
    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Browse' })).not.toBeInTheDocument();
    view.rerender(tree(packId, full));
    expect(screen.getByRole('textbox', { name: 'Search signals' })).toBeInTheDocument();
    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();
    expect(view.container.querySelector('[data-widget-family="list"] [role="list"]')).not.toBeInTheDocument();
    expect(screen.getByText(note)).toBeInTheDocument();
  });

  it('keeps Classic as the default/recovery and preserves search state through all seven pack changes', async () => {
    const view = render(tree());
    expect(view.container.querySelector('[data-widget-pack="classic"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family]')).toBeNull();
    expect(screen.queryByText(note)).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), { target: { value: 'Double' } });

    for (const [packId, appearance] of packs) {
      view.rerender(tree(packId));
      const selected = await presentation(view.container, appearance);
      expect(within(selected).getByRole('textbox', { name: 'Search signals' })).toHaveValue('Double');
      const list = within(selected).getByRole('list');
      expect(within(list).getByText(longField)).toBeInTheDocument();
      expect(within(list).queryByText('Soc')).not.toBeInTheDocument();
    }
    for (const packId of ['classic', 'retired-pack']) {
      view.rerender(tree(packId));
      expect(view.container.querySelector('[data-widget-family]')).toBeNull();
      expect(screen.queryByText(note)).not.toBeInTheDocument();
      expect(screen.getByRole('textbox', { name: 'Search signals' })).toHaveValue('Double');
      expect(screen.getByText(longField)).toBeInTheDocument();
    }
    view.rerender(tree('classic', compact));
    expect(screen.getByText('Signals available')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps unknown samples and catalog aggregates distinct, with an independent observation retry', async () => {
    mocks.observations.mockReturnValue(query<SignalObservation[]>(undefined, mocks.retryObservations, {
      status: 'error', isError: true, error: new Error('synthetic sample outage'),
    }));
    const view = render(tree('v4'));
    const selected = await presentation(view.container, 'owner');
    const list = within(selected).getByRole('list');
    expect(screen.getByText('Signal observations unavailable')).toBeInTheDocument();
    expect(signalRow(list, 'Soc').getByTitle('Observations in fetched sample')).toHaveTextContent('—');
    expect(signalRow(list, 'Soc').getByText(/Total observations: 1,200/)).toBeInTheDocument();
    expect(signalRow(list, 'VehicleSpeed').getByText(/Total observations: —/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryObservations).toHaveBeenCalledOnce();
    expect(mocks.retryCatalog).not.toHaveBeenCalled();

    mocks.observations.mockReturnValue(query([], mocks.retryObservations));
    view.rerender(tree('v4'));
    expect(signalRow(screen.getByRole('list'), 'Soc').getByTitle('Observations in fetched sample')).toHaveTextContent('0');
    expect(screen.queryByText('Signal observations unavailable')).not.toBeInTheDocument();
  });

  it.each(['refresh-error', 'paused'] as const)('retains real catalog rows and samples during %s without claiming source recovery', async (condition) => {
    const error = condition === 'refresh-error' ? new Error('synthetic background outage') : null;
    const overrides = {
      error, isError: error != null,
      fetchStatus: condition === 'paused' ? 'paused' as const : 'idle' as const,
    };
    mocks.catalog.mockReturnValue(query(catalog, mocks.retryCatalog, overrides));
    mocks.observations.mockReturnValue(query([observation('Soc', 68)], mocks.retryObservations, overrides));
    const { container } = render(tree('v7'));
    const selected = await presentation(container, 'pixel');
    expect(container.querySelector('[data-data-state="stale"]')).not.toBeNull();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Previously loaded signal observations remain visible while this source recovers.')).toBeInTheDocument();
    expect(signalRow(within(selected).getByRole('list'), 'Soc').getByTitle('Observations in fetched sample')).toHaveTextContent('1');
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryObservations).toHaveBeenCalledOnce();
    expect(mocks.retryCatalog).not.toHaveBeenCalled();
  });

  it('keeps loading and fatal catalog failure honest even when observations are available', async () => {
    mocks.catalog.mockReturnValue(query<SignalsCatalogResponse>(undefined, mocks.retryCatalog, {
      status: 'pending', isLoading: true, isPending: true, dataUpdatedAt: 0,
    }));
    const view = render(tree('v1'));
    expect(screen.getByRole('heading', { name: 'Signal catalog' })).toBeInTheDocument();
    expect(view.container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('No signals in catalog')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();

    mocks.catalog.mockReturnValue(query<SignalsCatalogResponse>(undefined, mocks.retryCatalog, {
      status: 'error', isError: true, error: new Error('synthetic catalog outage'), dataUpdatedAt: 0,
    }));
    view.rerender(tree('v1'));
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(view.container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    expect(view.container.querySelector('[data-widget-family="list"] [role="list"]')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(mocks.retryCatalog).toHaveBeenCalledOnce();
    expect(mocks.retryObservations).toHaveBeenCalledOnce();
  });
});
