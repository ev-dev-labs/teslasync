import type { ReactNode } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimeMachineField, TimeMachineRange, TimeMachineState } from '@/api/hooks/useTimeMachine';
import { fmtNumber, fmtScientificNumber } from '@/lib/numberFormat';
import { formatDateShort, formatDateTime } from '@/lib/dateFormat';

const h = vi.hoisted(() => ({
  vehicleId: 7,
  hasVehicle: true,
  timezone: '',
  vehiclesLoading: false,
  vehiclesError: null as Error | null,
  rangeLoading: false,
  rangeError: null as Error | null,
  paused: false,
  range: null as TimeMachineRange | null | undefined,
  reconstruction: undefined as TimeMachineState | undefined,
  error: null as Error | null,
  refetch: vi.fn(),
  readState: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce((text, [name, value]) =>
        text.replaceAll(`{{${name}}}`, String(value)), fallback ?? key),
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicle: h.hasVehicle ? { id: h.vehicleId, display_name: 'Pool car', timezone: h.timezone } : null }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: h.vehiclesError ? undefined : h.hasVehicle ? [{ id: h.vehicleId }] : [],
    isLoading: h.vehiclesLoading, isError: h.vehiclesError != null, error: h.vehiclesError,
    refetch: h.refetch, dataUpdatedAt: 1,
  }),
}));
vi.mock('@/api/hooks/useTimeMachine', () => ({
  useTimeMachineRange: () => ({
    data: h.range, isLoading: h.rangeLoading, isError: h.rangeError != null, error: h.rangeError,
    isFetching: h.rangeLoading, fetchStatus: h.paused ? 'paused' : 'idle', dataUpdatedAt: 1, refetch: h.refetch,
  }),
  useTimeMachineState: (vehicleId: number | null, at: string | null) => {
    h.readState(vehicleId, at);
    return {
      data: h.reconstruction, isLoading: false, isError: h.error != null, error: h.error,
      isFetching: false, fetchStatus: h.paused ? 'paused' : 'idle', dataUpdatedAt: 1, refetch: h.refetch,
    };
  },
}));

// The shared setup pins useTimezone to UTC for provider-free tests. This
// provider-mounted page must exercise the real vehicle/settings resolver.
vi.unmock('@/lib/timezone');

import TimeMachinePage, { ageVariant, categorize, groupByCategory } from './TimeMachinePage';
import { assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';

const earliest = '2026-10-01T00:00:00.000Z';
const latest = '2026-10-02T00:00:00.000Z';
const fields: TimeMachineField[] = [
  { field: 'TpmsPressure', value: 0, value_kind: 'float', ts: latest, age_seconds: 119 },
  { field: 'BatteryLevel', value: null, value_kind: 'float', ts: earliest, age_seconds: 3600 },
  { field: 'DoorLock', value: false, value_kind: 'bool', ts: latest, age_seconds: 120 },
  { field: 'UnclassifiedSignal', value: 'raw value', value_kind: 'string', ts: latest, age_seconds: 1 },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/time-machine']}><TimeMachinePage /></MemoryRouter>
  </QueryClientProvider>);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.vehicleId = 7;
  h.hasVehicle = true;
  h.timezone = '';
  h.vehiclesLoading = false;
  h.vehiclesError = null;
  h.rangeLoading = false;
  h.rangeError = null;
  h.paused = false;
  h.range = { earliest, latest, field_count: 4 };
  h.reconstruction = { at: latest, count: 4, fields };
  h.error = null;
});

describe('TimeMachinePage preservation', () => {
  it('keeps all six categories, every raw field and unknown distinct from real zero', async () => {
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    for (const category of ['battery', 'climate', 'motion', 'tires', 'security', 'other']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
    expect(screen.getByText('UnclassifiedSignal')).toBeInTheDocument();
    expect(screen.getByText('raw value')).toBeInTheDocument();
    const zero = screen.getByText('TpmsPressure').closest('li');
    const unknown = screen.getByText('BatteryLevel').closest('li');
    if (!zero || !unknown) throw new Error('Reconstructed rows missing');
    expect(within(zero).queryByText('—')).not.toBeInTheDocument();
    expect(within(unknown).getByText('—')).toBeInTheDocument();
    expect(screen.getByText('No')).toBeInTheDocument();
  });

  it('keeps historical rows and bounds while a reconstruction refresh fails', async () => {
    h.error = new Error('refresh failed');
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    expect(screen.getByText('raw value')).toBeInTheDocument();
    expect(screen.getByText('Reconstructed signal state may be out of date')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('clamps presets to bounds and resets reconstruction scope when the vehicle changes', async () => {
    const view = renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    fireEvent.click(screen.getByRole('button', { name: '−1w' }));
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, earliest));
    const callsBeforeVehicleChange = h.readState.mock.calls.length;
    h.vehicleId = 8;
    view.rerender(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/time-machine']}><TimeMachinePage /></MemoryRouter>
    </QueryClientProvider>);
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(8, latest));
    const nextVehicleCalls = h.readState.mock.calls.slice(callsBeforeVehicleChange);
    expect(nextVehicleCalls[0]).toEqual([8, null]);
    expect(nextVehicleCalls.some(([vehicleId, at]) => vehicleId === 8 && at === null)).toBe(true);
    expect(nextVehicleCalls.some(([vehicleId, at]) => vehicleId === 8 && at === earliest)).toBe(false);
  });

  it('retains category shells and retry controls on initial reconstruction failure', async () => {
    h.reconstruction = undefined;
    h.error = new Error('initial failure');
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Signal reconstruction could not be loaded.')).toHaveLength(6));
    assertOperationalMetricUnavailable(screen.getByTestId('time-machine-summary'), 'Signals reconstructed');
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(6);
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a real empty reconstruction as zero without removing any category shell', async () => {
    h.reconstruction = { at: latest, count: 0, fields: [] };
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    const count = screen.getByText('Signals reconstructed').closest('[data-operational-metric]');
    if (!(count instanceof HTMLElement)) throw new Error('Reconstruction summary missing');
    expect(within(count).getByText('0')).toBeInTheDocument();
    for (const category of ['battery', 'climate', 'motion', 'tires', 'security', 'other']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
  });

  it('opens the built-in review drawer with the independent history span and resolved instant', async () => {
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    const brief = screen.getByTestId('time-machine-summary');
    const span = brief.querySelector('[data-operational-metric="history-span"]');
    if (!(span instanceof HTMLElement)) throw new Error('History span missing');
    expect(span).toHaveAttribute('data-value-state', 'value');
    expect(within(span).getByText('1d', { selector: '[data-operational-value]' })).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Signals reconstructed')).toBeInTheDocument();
    const drawerSpanLabel = within(drawer).getByText('History span');
    expect(drawerSpanLabel).toBeInTheDocument();
    const drawerSpanRow = drawerSpanLabel.parentElement;
    if (!(drawerSpanRow instanceof HTMLElement)) throw new Error('Drawer history span row missing');
    expect(within(drawerSpanRow).getByText('1d', { selector: 'span' })).toBeInTheDocument();
    expect(within(drawer).getAllByText(/independent timeline source/).length).toBeGreaterThan(0);
  });

  it('keeps first-match classification, source field order and exact age boundaries', () => {
    expect(categorize('TpmsBatteryVoltage')).toBe('tires');
    const grouped = groupByCategory(fields);
    expect(Object.values(grouped).flat()).toHaveLength(fields.length);
    expect(grouped.battery[0].field).toBe('BatteryLevel');
    expect(ageVariant(119)).toBe('success');
    expect(ageVariant(120)).toBe('warning');
    expect(ageVariant(3599)).toBe('warning');
    expect(ageVariant(3600)).toBe('danger');
  });
});


describe('TimeMachinePage shared primitive adoption', () => {
  function expectSections() {
    expect(screen.getByRole('heading', { name: 'Timeline' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Overview' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Reconstructed signal state' })).toBeInTheDocument();
    for (const category of ['battery', 'climate', 'motion', 'tires', 'security', 'other']) {
      expect(screen.getByRole('heading', { name: category })).toBeInTheDocument();
    }
  }

  it('keeps all historical shells and unknown metrics when no vehicle is selected', () => {
    h.hasVehicle = false;
    h.range = undefined;
    h.reconstruction = undefined;
    renderPage();
    expectSections();
    expect(h.readState).toHaveBeenLastCalledWith(null, null);
    expect(screen.getAllByText(/No vehicles found/).length).toBeGreaterThan(0);
    for (const name of ['−1h', '−1d', '−1w', 'Now']) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
    assertOperationalMetricUnavailable(screen.getByTestId('time-machine-summary'), 'Signals reconstructed');
  });

  it('reports initial fleet failure with recovery instead of claiming there are no vehicles', () => {
    h.hasVehicle = false;
    h.vehiclesError = new Error('fleet unavailable');
    h.range = undefined;
    h.reconstruction = undefined;
    renderPage();
    expectSections();
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps source-shaped loading inside every historical shell while vehicles resolve', () => {
    h.hasVehicle = false;
    h.vehiclesLoading = true;
    h.range = undefined;
    h.reconstruction = undefined;
    renderPage();
    expectSections();
    expect(screen.getByRole('status', { name: 'Loading battery' })).toBeInTheDocument();
    expect(screen.queryByText(/No vehicles found/)).not.toBeInTheDocument();
  });

  it('distinguishes an authoritative empty timeline from a real empty reconstruction', () => {
    h.range = { earliest: null, latest: null, field_count: 0 };
    h.reconstruction = undefined;
    renderPage();
    expectSections();
    expect(screen.getAllByText(/History appears once telemetry starts flowing/)).toHaveLength(7);
    expect(screen.queryByText(/No battery signals at this instant/)).not.toBeInTheDocument();
    assertOperationalMetricUnavailable(screen.getByTestId('time-machine-summary'), 'Signals reconstructed');
    const tracked = screen.getByText('Fields tracked').closest('[data-operational-metric]');
    if (!(tracked instanceof HTMLElement)) throw new Error('Source metrics missing');
    expect(within(tracked).getByText('0')).toBeInTheDocument();
  });

  it.each([
    { earliest: 'not-an-instant', latest, field_count: 4 },
    { earliest: latest, latest: earliest, field_count: 4 },
    { earliest: null, latest, field_count: 4 },
  ])('preserves all shells for unusable timeline bounds: $earliest / $latest', range => {
    h.range = range;
    h.reconstruction = undefined;
    renderPage();
    expectSections();
    expect(screen.getByText('Timeline bounds unavailable')).toBeInTheDocument();
    expect(screen.getByText(/Recorded timeline bounds could not be interpreted/)).toBeInTheDocument();
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.getAllByText(/A usable timeline is required/)).toHaveLength(6);
  });

  it('retains independent shells and range recovery on initial timeline failure', () => {
    h.range = undefined;
    h.rangeError = new Error('range unavailable');
    h.reconstruction = undefined;
    renderPage();
    expectSections();
    expect(screen.queryByText('No signal history')).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('labels retained evidence as pending while the independent requested instant changes', async () => {
    const view = renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    fireEvent.click(screen.getByRole('button', { name: '−1d' }));
    expect(screen.getByText(/The selected instant is pending/)).toBeInTheDocument();
    expect(screen.getByText('raw value')).toBeInTheDocument();
    const summary = screen.getByTestId('time-machine-summary');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    const instantDrawer = screen.getByRole('dialog');
    expect(instantDrawer.textContent).toContain('2026');
    expect(instantDrawer.querySelector('[title^="2026-"]')).toBeNull();
    fireEvent.keyDown(instantDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, earliest));
    h.reconstruction = { at: earliest, count: 4, fields };
    view.rerender(<QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={['/time-machine']}><TimeMachinePage /></MemoryRouter>
    </QueryClientProvider>);
    expect(screen.queryByText(/The selected instant is pending/)).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

  it('keeps raw signed SI, tiny magnitudes and timestamp values without guessed unit conversion', async () => {
    const signedFields: TimeMachineField[] = [
      ...fields,
      { field: 'BatteryPower', value: -1250.75, value_kind: 'float', ts: latest, age_seconds: 119 },
      { field: 'UnclassifiedTinyValue', value: -0.0000002, value_kind: 'float', ts: latest, age_seconds: 120 },
      { field: 'ObservedTime', value: latest, value_kind: 'time', ts: latest, age_seconds: 3600 },
    ];
    const original = structuredClone(signedFields);
    h.reconstruction = { at: latest, count: signedFields.length, fields: signedFields };
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    expect(screen.getByText(fmtNumber(-1250.75))).toBeInTheDocument();
    expect(screen.getByText(fmtScientificNumber(-0.0000002, 4))).toBeInTheDocument();
    const timestamp = screen.getByText('ObservedTime').closest('li');
    if (!(timestamp instanceof HTMLElement)) throw new Error('Timestamp field missing');
    expect(timestamp.querySelector('[title^="2026-"]')).toBeNull();
    expect(signedFields).toEqual(original);
  });

  it('names field observation age separately from query freshness at exact thresholds', async () => {
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    expect(screen.getByLabelText('Fresh observation, changed 1m before the reconstruction instant')).toHaveTextContent('Fresh · 1m');
    expect(screen.getByLabelText('Stale observation, changed 2m before the reconstruction instant')).toHaveTextContent('Stale · 2m');
    expect(screen.getByLabelText('Very stale observation, changed 1h before the reconstruction instant')).toHaveTextContent('Very stale · 1h');
  });

  it('uses the saved vehicle timezone consistently for endpoints, values, scope and slider text', async () => {
    h.timezone = 'Pacific/Honolulu';
    h.reconstruction = { at: latest, count: 1, fields: [
      { field: 'ObservedTime', value: latest, value_kind: 'time', ts: latest, age_seconds: 1 },
    ] };
    const view = renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    const honoluluLatest = formatDateTime(latest, { locale: 'en-US', tz: 'Pacific/Honolulu' });
    const honoluluEarliest = formatDateShort(earliest, { locale: 'en-US', tz: 'Pacific/Honolulu' });
    expect(within(view.container).getByText(honoluluLatest)).toBeInTheDocument();
    expect(within(view.container).getByText(honoluluEarliest)).toBeInTheDocument();
    expect(view.container.querySelector('[title^="2026-"]')).toBeNull();
    fireEvent.click(within(screen.getByTestId('time-machine-summary')).getByRole('button', { name: 'Review details' }));
    const tzDrawer = screen.getByRole('dialog');
    expect(within(tzDrawer).getByText(honoluluLatest)).toBeInTheDocument();
    fireEvent.keyDown(tzDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('slider')).toHaveAttribute('aria-valuetext', formatDateTime(latest, { locale: 'en-US', tz: h.timezone }));
    expect(h.reconstruction.at).toBe(latest);
  });

  it('preserves retained rows and timeline controls while historical sources are paused', async () => {
    h.paused = true;
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    expectSections();
    expect(screen.getByText('raw value')).toBeInTheDocument();
    expect(screen.getByRole('slider')).toBeEnabled();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getAllByTestId('stale-refresh-warning')[0]).toHaveAttribute('data-refresh-blocked', 'true');
  });

  it('retains a usable single-instant timeline and all four bounded presets', async () => {
    h.range = { earliest: latest, latest, field_count: 4 };
    renderPage();
    await waitFor(() => expect(h.readState).toHaveBeenLastCalledWith(7, latest));
    for (const name of ['−1h', '−1d', '−1w', 'Now']) {
      fireEvent.click(screen.getByRole('button', { name }));
      expect(h.readState).toHaveBeenLastCalledWith(7, latest);
    }
    expect(screen.getByRole('slider')).toHaveValue('1');
    expect(screen.getByText('0s', { selector: '[data-operational-value]' })).toBeInTheDocument();
  });
});
