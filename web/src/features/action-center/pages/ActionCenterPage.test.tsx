import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActionCenterFilter,
  ActionCenterRecommendation,
  ActionCenterResponse,
} from '@/types/actionCenter';
import type { Vehicle } from '@/types/vehicle';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import { SelectedVehicleProvider, __SELECTED_VEHICLE_STORAGE_KEY__ } from '@/store/selectedVehicle';

const useActionCenterMock = vi.fn();
const useHistoryMock = vi.fn();
const mutateAsyncMock = vi.fn();
const toastMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const operationalMetricsInput = vi.fn();
const operationalModeState = vi.hoisted(() => ({
  canWrite: true,
}));
const displayPreferences = vi.hoisted(() => ({ locale: 'en-US' }));

vi.mock('@/api/hooks/useActionCenter', () => ({
  useActionCenter: (...args: unknown[]) => useActionCenterMock(...args),
  useActionCenterHistory: (...args: unknown[]) => useHistoryMock(...args),
  useApplyActionCenterAction: () => ({
    mutateAsync: mutateAsyncMock,
    isPending: false,
  }),
}));
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: fleet }),
}));
vi.mock('@/components/feedback', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback')>(
    '@/components/feedback',
  );
  return {
    ...actual,
    useToast: () => ({ toast: toastMock, success: toastSuccess, error: toastError }),
  };
});

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatEnergy: (value: number) => `${value} Wh`,
    unitPrefs: {
      distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
      energy: 'Wh', duration: 's', power: 'W', locale: displayPreferences.locale, precision: 2,
    },
  }),
}));
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));
vi.mock('@/hooks/useOperationalMetrics', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useOperationalMetrics')>(
    '@/hooks/useOperationalMetrics',
  );
  return {
    ...actual,
    useOperationalMetrics: (...args: Parameters<typeof actual.useOperationalMetrics>) => {
      operationalMetricsInput(...args);
      return actual.useOperationalMetrics(...args);
    },
  };
});
vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    mode: operationalModeState.canWrite ? 'live' : 'as_of',
    asOf: operationalModeState.canWrite
      ? null
      : '2026-02-19T00:00:00.000Z',
    online: true,
    isReadOnly: !operationalModeState.canWrite,
    canWrite: operationalModeState.canWrite,
    label: operationalModeState.canWrite ? 'Live' : 'As of',
    description: 'Historical state',
    writeBlockReason: operationalModeState.canWrite
      ? null
      : 'Return to live mode before making operational changes.',
  }),
}));

import ActionCenterPage from './ActionCenterPage';

const fleet: Vehicle[] = [
  { id: 7, vehicle_id: 7, vin: 'SYNTHETIC-AC-7', display_name: 'Orion',
    model: '', trim_badging: '', exterior_color: '', wheel_type: '', state: 'online',
    healthy: true, created_at: '', updated_at: '' },
  { id: 8, vehicle_id: 8, vin: 'SYNTHETIC-AC-8', display_name: 'Lyra',
    model: '', trim_badging: '', exterior_color: '', wheel_type: '', state: 'online',
    healthy: true, created_at: '', updated_at: '' },
  { id: 9, vehicle_id: 9, vin: 'SYNTHETIC-AC-9', display_name: 'Vega',
    model: '', trim_badging: '', exterior_color: '', wheel_type: '', state: 'online',
    healthy: true, created_at: '', updated_at: '' },
];

const recommendation: ActionCenterRecommendation = {
  id: 'ac_0123456789abcdef01234567',
  fingerprint: 'b'.repeat(64),
  source_feature: 'active_alerts',
  related_sources: ['active_alerts'],
  vehicle: { id: 7, display_name: 'Orion' },
  title: 'Review active alert',
  summary: 'A warning remains active.',
  rationale: 'The alert is unacknowledged.',
  priority: 'high',
  severity: 'warning',
  rank: { score: 450, basis: ['priority high +300', 'confidence 0.80 +80'] },
  confidence: { score: 0.8, label: 'high', basis: ['Direct persisted alert'] },
  evidence: [{
    id: 'log:1',
    kind: 'active_alert',
    summary: 'Alert persisted.',
    provenance: { source: 'notification_logs', record_id: '1', source_url: null },
    observed_at: '2026-02-20T00:00:00Z',
  }],
  projected_impact: null,
  safe_actions: ['acknowledge', 'snooze', 'dismiss', 'restore', 'navigate'],
  navigation_path: '/alerts',
  expires_at: '2026-03-01T00:00:00Z',
  freshness: { status: 'fresh', observed_at: '2026-02-20T00:00:00Z', age_s: 60 },
  limitations: ['Not a diagnosis.'],
  current_state: { status: 'open', version: 0, snoozed_until: null, updated_at: null },
  action_history: [],
};

const data: ActionCenterResponse = {
  items: [recommendation],
  total: 1,
  limit: 50,
  offset: 0,
  generated_at: '2026-02-20T00:01:00Z',
  summary: { open: 1, acknowledged: 0, snoozed: 0, dismissed: 0, critical: 0, high: 1 },
  provider_status: [{
    source_feature: 'active_alerts',
    status: 'available',
    item_count: 1,
    limitations: [],
  }],
};

function queryResult(overrides: Record<string, unknown> = {}) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isError: false,
    isStale: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function renderPage(url = '/action-center') {
  window.history.replaceState(null, '', url);
  return render(
    <BrowserRouter>
      <SelectedVehicleProvider>
        <ActionCenterPage />
      </SelectedVehicleProvider>
    </BrowserRouter>,
  );
}

beforeEach(() => {
  useActionCenterMock.mockReset();
  mutateAsyncMock.mockReset();
  toastMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  window.localStorage.clear();
  window.localStorage.setItem(__SELECTED_VEHICLE_STORAGE_KEY__, '7');
  operationalMetricsInput.mockReset();
  operationalModeState.canWrite = true;
  displayPreferences.locale = 'en-US';
  useHistoryMock.mockReset();
  useActionCenterMock.mockReturnValue(queryResult());
  useHistoryMock.mockReturnValue({
    data: { items: [], total: 0, limit: 25, offset: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mutateAsyncMock.mockResolvedValue({
    recommendation: {
      ...recommendation,
      current_state: {
        status: 'acknowledged',
        version: 1,
        snoozed_until: null,
        updated_at: '2026-02-20T00:02:00Z',
      },
    },
    event: {
      id: 1,
      recommendation_id: recommendation.id,
      fingerprint: recommendation.fingerprint,
      action: 'acknowledge',
      from_state: 'open',
      to_state: 'acknowledged',
      outcome: 'applied',
      state_version: 1,
      occurred_at: '2026-02-20T00:02:00Z',
    },
  });
});

describe('ActionCenterPage URL scope roundtrip', () => {
  it.each([
    { name: 'All vehicles', clearIndex: null, limit: 25, state: 'dismissed' },
    { name: 'filter Clear filters', clearIndex: 0, limit: 25, state: 'open' },
    { name: 'empty Clear filters', clearIndex: 1, limit: 50, state: 'open' },
  ])('retains fleet-local scope after $name and a real remount', async ({ clearIndex, limit, state }) => {
    useActionCenterMock.mockReturnValue(queryResult({ data: { ...data, items: [], total: 0 } }));
    const mounted = renderPage('/action-center?vehicle_id=8&priority=high&state=dismissed&limit=25&offset=25');
    expect(screen.getByLabelText('Vehicle')).toHaveValue('8');
    expect(window.localStorage.getItem(__SELECTED_VEHICLE_STORAGE_KEY__)).toBe('8');
    if (clearIndex == null) {
      fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value: '' } });
    } else {
      fireEvent.click(screen.getAllByRole('button', { name: 'Clear filters' })[clearIndex]!);
    }
    const expected: ActionCenterFilter = {
      vehicle_id: undefined, priority: clearIndex == null ? 'high' : undefined,
      source_feature: undefined, state: state as ActionCenterFilter['state'], limit, offset: 0,
    };
    await waitFor(() => expect(useActionCenterMock).toHaveBeenLastCalledWith(expected));
    expect(screen.getByLabelText('Vehicle')).toHaveValue('');
    expect(new URL(window.location.href).searchParams.get('vehicle_scope')).toBe('fleet');
    expect(new URL(window.location.href).searchParams.has('vehicle_id')).toBe(false);
    expect(window.localStorage.getItem(__SELECTED_VEHICLE_STORAGE_KEY__)).toBe('8');
    const url = window.location.href;
    mounted.unmount();
    const reopened = renderPage(url);
    expect(screen.getByLabelText('Vehicle')).toHaveValue('');
    expect(useActionCenterMock).toHaveBeenLastCalledWith(expected);
    reopened.unmount();
    window.history.replaceState(null, '', '/battery');
    const otherRoute = renderHook(() => useSelectedVehicle(), {
      wrapper: ({ children }) => (
        <BrowserRouter><SelectedVehicleProvider>{children}</SelectedVehicleProvider></BrowserRouter>
      ),
    });
    expect(otherRoute.result.current.vehicleId).toBe(8);
    otherRoute.unmount();
  });

  it.each([
    { name: 'fleet and all states', vehicle: '', stateValue: '', expectedState: undefined },
    { name: 'selected vehicle and dismissed', vehicle: '8', stateValue: 'dismissed', expectedState: 'dismissed' as const },
  ])('copies and reopens the actual current filters and pagination for $name', async ({ vehicle, stateValue, expectedState }) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    useActionCenterMock.mockReturnValue(queryResult({ data: { ...data, total: 120 } }));
    const mounted = renderPage('/action-center?context=review');
    fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value: vehicle } });
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'critical' } });
    fireEvent.change(screen.getByLabelText('Source'), { target: { value: 'battery_health' } });
    fireEvent.change(screen.getByLabelText('State'), { target: { value: stateValue } });
    fireEvent.change(screen.getByLabelText('Rows per page'), { target: { value: '25' } });
    fireEvent.click(screen.getByRole('button', { name: 'Next page' }));
    const expected: ActionCenterFilter = {
      vehicle_id: vehicle ? 8 : undefined, priority: 'critical', source_feature: 'battery_health',
      state: expectedState, limit: 25, offset: 25,
    };
    expect(useActionCenterMock).toHaveBeenLastCalledWith(expected);
    expect(screen.getByText('Showing 26–50 of 120')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(new URL(copied).searchParams.get('context')).toBe('review');
    mounted.unmount();
    window.localStorage.setItem(__SELECTED_VEHICLE_STORAGE_KEY__, '7');
    const reopened = renderPage(copied);
    expect(useActionCenterMock).toHaveBeenLastCalledWith(expected);
    expect(screen.getByLabelText('Vehicle')).toHaveValue(vehicle);
    expect(screen.getByLabelText('Priority')).toHaveValue('critical');
    expect(screen.getByLabelText('Source')).toHaveValue('battery_health');
    expect(screen.getByLabelText('State')).toHaveValue(stateValue);
    expect(screen.getByLabelText('Rows per page')).toHaveValue('25');
    expect(screen.getByText('Showing 26–50 of 120')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Priority'), { target: { value: 'low' } });
    expect(useActionCenterMock).toHaveBeenLastCalledWith({ ...expected, priority: 'low', offset: 0 });
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    reopened.unmount();
  });

  it('copies inherited defaults with a concrete scope independent of recipient preference', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const mounted = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    expect(new URL(copied).searchParams.get('vehicle_id')).toBe('7');
    mounted.unmount();
    window.localStorage.setItem(__SELECTED_VEHICLE_STORAGE_KEY__, '8');
    renderPage(copied);
    expect(screen.getByLabelText('Vehicle')).toHaveValue('7');
    expect(screen.getByLabelText('State')).toHaveValue('open');
    expect(useActionCenterMock).toHaveBeenLastCalledWith({
      vehicle_id: 7, priority: undefined, source_feature: undefined, state: 'open', limit: 50, offset: 0,
    });
  });

  it.each([
    { name: 'malformed ID with stored fallback', rawVehicle: 'abc', storedVehicle: '8', effectiveVehicle: 8, copiedVehicle: '8', scope: 'selected' },
    { name: 'deleted ID with stored fallback', rawVehicle: '42', storedVehicle: '8', effectiveVehicle: 8, copiedVehicle: '8', scope: 'selected' },
    { name: 'malformed ID with first-vehicle fallback', rawVehicle: 'abc', storedVehicle: '42', effectiveVehicle: 7, copiedVehicle: '7', scope: 'selected' },
    { name: 'deleted ID with first-vehicle fallback', rawVehicle: '42', storedVehicle: '42', effectiveVehicle: 7, copiedVehicle: '7', scope: 'selected' },
    { name: 'valid selected ID', rawVehicle: '7', storedVehicle: '8', effectiveVehicle: 7, copiedVehicle: '7', scope: 'selected' },
    { name: 'valid numeric ID spelling', rawVehicle: '08', storedVehicle: '8', effectiveVehicle: 8, copiedVehicle: '08', scope: 'selected' },
    { name: 'intentional fleet marker with malformed ID', rawVehicle: 'abc', storedVehicle: '8', effectiveVehicle: undefined, copiedVehicle: 'abc', scope: 'fleet' },
  ])('copies effective scope for $name and reopens with recipient preference 9', async ({ rawVehicle, storedVehicle, effectiveVehicle, copiedVehicle, scope }) => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    window.localStorage.setItem(__SELECTED_VEHICLE_STORAGE_KEY__, storedVehicle);
    useActionCenterMock.mockReturnValue(queryResult({ data: { ...data, total: 120 } }));
    const historyLength = window.history.length;
    const mounted = renderPage(
      '/action-center?vehicle_id=' + rawVehicle + '&vehicle_scope=' + scope + '&priority=critical&source_feature=battery_health&state=all&limit=25&offset=25&context=review&vin=retained',
    );
    const expected: ActionCenterFilter = {
      vehicle_id: effectiveVehicle, priority: 'critical', source_feature: 'battery_health',
      state: undefined, limit: 25, offset: 25,
    };
    await waitFor(() => expect(useActionCenterMock).toHaveBeenLastCalledWith(expected));
    expect(screen.getByLabelText('Vehicle')).toHaveValue(effectiveVehicle == null ? '' : String(effectiveVehicle));
    expect(window.localStorage.getItem(__SELECTED_VEHICLE_STORAGE_KEY__)).toBe(String(effectiveVehicle ?? 8));
    expect(window.history.length).toBe(historyLength);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link to this view' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    const copied = writeText.mock.calls[0]![0] as string;
    const copiedUrl = new URL(copied);
    expect(copied).toBe(window.location.href);
    expect(Object.fromEntries(copiedUrl.searchParams)).toEqual({
      vehicle_id: copiedVehicle, vehicle_scope: scope, priority: 'critical',
      source_feature: 'battery_health', state: 'all', limit: '25', offset: '25',
      context: 'review', vin: 'retained',
    });
    mounted.unmount();
    window.localStorage.setItem(__SELECTED_VEHICLE_STORAGE_KEY__, '9');
    const reopened = renderPage(copied);
    expect(useActionCenterMock).toHaveBeenLastCalledWith(expected);
    expect(screen.getByLabelText('Vehicle')).toHaveValue(effectiveVehicle == null ? '' : String(effectiveVehicle));
    expect(screen.getByLabelText('Priority')).toHaveValue('critical');
    expect(screen.getByLabelText('Source')).toHaveValue('battery_health');
    expect(screen.getByLabelText('State')).toHaveValue('');
    expect(screen.getByLabelText('Rows per page')).toHaveValue('25');
    expect(screen.getByText('Showing 26–50 of 120')).toBeInTheDocument();
    expect(window.localStorage.getItem(__SELECTED_VEHICLE_STORAGE_KEY__)).toBe(String(effectiveVehicle ?? 9));
    expect(window.history.length).toBe(historyLength);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    reopened.unmount();
  });

  it.each([
    { name: 'missing defaults', query: '', limit: 50, offset: 0 },
    { name: 'lower bounds', query: 'limit=1&offset=0', limit: 1, offset: 0 },
    { name: 'upper bounds', query: 'limit=100&offset=100000', limit: 100, offset: 100000 },
    { name: 'below bounds', query: 'limit=0&offset=-1', limit: 50, offset: 0 },
    { name: 'above bounds', query: 'limit=101&offset=100001', limit: 50, offset: 0 },
    { name: 'fractional values', query: 'limit=25.5&offset=1.5', limit: 50, offset: 0 },
    { name: 'non-numeric values', query: 'limit=NaN&offset=Infinity', limit: 50, offset: 0 },
  ])('hydrates validated defaults and pagination for $name', ({ query, limit, offset }) => {
    renderPage(`/action-center?priority=invalid&source_feature=invalid&state=invalid&${query}`);
    expect(useActionCenterMock).toHaveBeenLastCalledWith({
      vehicle_id: 7, priority: undefined, source_feature: undefined, state: 'open', limit, offset,
    });
    expect(screen.getByLabelText('Priority')).toHaveValue('');
    expect(screen.getByLabelText('Source')).toHaveValue('');
    expect(screen.getByLabelText('State')).toHaveValue('open');
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });
});

describe('ActionCenterPage', () => {
  it('preserves recommendation actions and provider evidence on a failed background refresh', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      isError: true, error: new Error('Refresh offline'),
    }));
    const { container } = renderPage();
    expect(container.querySelector('[data-layout-reference]')).not.toBeNull();
    expect(screen.getByText('Review active alert')).toBeInTheDocument();
    expect(screen.getByText(/^available$/i)).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Retained summary')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('does not claim zero recommendation counts before summary evidence exists', () => {
    useActionCenterMock.mockReturnValue(queryResult({ data: undefined }));
    renderPage();
    const summary = screen.getByLabelText('Action center summary');
    expect(within(summary).getAllByText('—')).toHaveLength(6);
    expect(within(summary).queryByText('0')).not.toBeInTheDocument();
    expect(summary.querySelectorAll('[data-operational-metric][data-value-state="missing"]')).toHaveLength(6);
  });

  it('renders prioritized evidence, confidence, impact transparency, and provider status', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Action center' })).toBeInTheDocument();
    expect(useActionCenterMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'open', limit: 50, offset: 0 }),
    );
    expect(screen.getByText('Review active alert')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('No projected impact')).toBeInTheDocument();
    expect(screen.getByText(/^available$/i)).toBeInTheDocument();
  });

  it('retains all six raw counts in the real bridge without substituting the paginated list size', () => {
    const summary = { open: 1200, critical: 3, high: 9, acknowledged: 4, snoozed: 2, dismissed: 0 };
    useActionCenterMock.mockReturnValue(queryResult({ data: { ...data, summary } }));
    const { container } = renderPage();
    expect(operationalMetricsInput).toHaveBeenLastCalledWith([
      expect.objectContaining({ metricId: 'count', occurrenceId: 'open', rawValue: 1200 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'critical', rawValue: 3 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'high', rawValue: 9 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'acknowledged', rawValue: 4 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'snoozed', rawValue: 2 }),
      expect.objectContaining({ metricId: 'count', occurrenceId: 'dismissed', rawValue: 0 }),
    ]);
    expect(container.querySelector('[data-operational-metric="open"] [data-operational-value]')).toHaveTextContent('1,200');
    expect(container.querySelector('[data-operational-metric="dismissed"]')).toHaveAttribute('data-value-state', 'value');
    expect(container.querySelector('[data-operational-metric="dismissed"] [data-operational-value]')).toHaveTextContent('0');
    const bridge = within(screen.getByLabelText('Action center summary')).getByRole('region', { name: 'Decision queue overview' });
    expect(bridge).toHaveTextContent('Orion · Before priority, source, state, and pagination filters');
    expect(within(bridge).getByText(/^Generated (?!recommendations)/)).toBeInTheDocument();
  });

  it('opens and closes the actual Review details drawer with count semantics and bounded source context', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(within(drawer).getByText('Operational metrics')).toBeInTheDocument();
    expect(within(drawer).getByText('Generated recommendations with critical priority across all inbox states.')).toBeInTheDocument();
    expect(within(drawer).getByText('Generated recommendations with high priority across all inbox states.')).toBeInTheDocument();
    expect(within(drawer).getAllByText('Provider-specific evidence windows and limits apply; these counts are not an all-time total.').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('Server-generated recommendation evidence')).toBeInTheDocument();
    expect(within(drawer).getByText('Not scored')).toBeInTheDocument();
    fireEvent.click(within(drawer).getByText('Close'));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'acknowledge' })).toBeEnabled();
  });

  it('uses saved display locale while retaining unitless integer count operands', () => {
    displayPreferences.locale = 'de-DE';
    useActionCenterMock.mockReturnValue(queryResult({
      data: { ...data, summary: { ...data.summary, open: 1200 } },
    }));
    const { container } = renderPage();
    expect(container.querySelector('[data-operational-metric="open"] [data-operational-value]')).toHaveTextContent('1.200');
    expect(operationalMetricsInput).toHaveBeenLastCalledWith(expect.arrayContaining([
      expect.objectContaining({ metricId: 'count', occurrenceId: 'open', rawValue: 1200 }),
    ]));
  });

  it('keeps partial provider coverage distinct from zero counts and retains provider limitations', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: {
        ...data,
        summary: { open: 0, critical: 0, high: 0, acknowledged: 0, snoozed: 0, dismissed: 0 },
        provider_status: [{
          source_feature: 'active_alerts', status: 'unavailable',
          item_count: 0, limitations: ['Persisted alert source unavailable.'],
        }],
      },
    }));
    const { container } = renderPage();
    expect(screen.getByText('Partial source coverage')).toBeInTheDocument();
    expect(screen.getByText('Persisted alert source unavailable.')).toBeInTheDocument();
    expect(container.querySelectorAll('[data-operational-metric][data-value-state="value"]')).toHaveLength(6);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const narrative = within(screen.getByRole('dialog')).getByRole('region', { name: 'Decision narrative' });
    expect(within(narrative).getByText('Source coverage is incomplete or unknown; unavailable sources do not imply zero findings.', { selector: 'p' })).toBeInTheDocument();
  });

  it('does not render invalid count operands as measured zero', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: { ...data, summary: { ...data.summary, open: Number.NaN, high: -1 } },
    }));
    const { container } = renderPage();
    for (const key of ['open', 'high']) {
      const metric = container.querySelector(`[data-operational-metric="${key}"]`);
      expect(metric).toHaveAttribute('data-value-state', 'invalid');
      expect(metric?.querySelector('[data-operational-value]')).toHaveTextContent('—');
    }
  });

  it('updates snake_case filters', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Vehicle'), { target: { value: '7' } });
    await waitFor(() =>
      expect(useActionCenterMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ vehicle_id: 7, limit: 50, offset: 0 }),
      ),
    );
  });

  it('renders loading state without hiding summary and source panels', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: undefined,
      isLoading: true,
      isFetching: true,
    }));
    const { container } = renderPage();
    expect(screen.getByLabelText('Loading recommendations')).toBeInTheDocument();
    expect(screen.getByLabelText('Action center summary')).toBeInTheDocument();
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-value]')).toHaveLength(0);
  });

  it('confirmation-gates state actions', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/does not control the vehicle/i)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: /acknowledge/i }));
    await waitFor(() =>
      expect(mutateAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          recommendation_id: recommendation.id,
          action: 'acknowledge',
          expected_version: 0,
          confirmed: true,
        }),
      ),
    );
  });

  it('disables inbox state changes in historical mode while preserving source navigation', () => {
    operationalModeState.canWrite = false;
    renderPage();

    expect(
      screen.getByRole('button', { name: /acknowledge/i }),
    ).toBeDisabled();
    expect(
      screen.getByRole('button', { name: /Open source/i }),
    ).not.toBeDisabled();
  });

  it('offers a version-safe Undo that restores a reversible action', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /acknowledge/i }));
    fireEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /acknowledge/i }),
    );

    await waitFor(() => expect(toastMock).toHaveBeenCalledTimes(1));
    const toast = toastMock.mock.calls[0]?.[0] as {
      action?: { label: string; onClick?: () => void };
    };
    expect(toast.action?.label).toBe('Undo');
    toast.action?.onClick?.();

    await waitFor(() => {
      expect(mutateAsyncMock).toHaveBeenLastCalledWith({
        recommendation_id: recommendation.id,
        fingerprint: recommendation.fingerprint,
        action: 'restore',
        expected_version: 1,
        confirmed: true,
        snoozed_until: null,
      });
    });
    expect(toastSuccess).toHaveBeenCalledWith(
      'Action undone',
      'The recommendation was restored to the open queue.',
    );
  });

  it('shows persisted action outcomes in recommendation details', () => {
    useHistoryMock.mockReturnValue({
      data: {
        items: [{
          id: 4,
          recommendation_id: recommendation.id,
          fingerprint: recommendation.fingerprint,
          action: 'acknowledge',
          from_state: 'open',
          to_state: 'acknowledged',
          outcome: 'applied',
          state_version: 1,
          occurred_at: '2026-02-20T00:02:00Z',
        }],
        total: 1,
        limit: 25,
        offset: 0,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Evidence, scoring, and outcomes/i }));
    expect(screen.getByText(/open → acknowledged/i)).toBeInTheDocument();
  });

  it('renders the empty state while preserving source coverage', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: { ...data, items: [], total: 0, summary: { ...data.summary, open: 0 } },
    }));
    renderPage();
    expect(screen.getByText('Inbox clear')).toBeInTheDocument();
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
  });

  it('renders a retryable error state', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: undefined,
      error: new Error('provider failed'),
      isError: true,
    }));
    renderPage();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
  });
});

describe('ActionCenterPage result-count trust', () => {
  it.each([
    {
      name: 'initial loading',
      query: { data: undefined, isLoading: true, isFetching: true },
    },
    {
      name: 'initial failure',
      query: { data: undefined, isError: true, error: new Error('Source unavailable') },
    },
    { name: 'unresolved response', query: { data: undefined } },
    { name: 'non-finite total', query: { data: { ...data, total: Number.NaN } } },
    { name: 'negative total', query: { data: { ...data, total: -1 } } },
  ])('keeps pagination total unknown for $name', ({ query }) => {
    useActionCenterMock.mockReturnValue(queryResult(query));
    renderPage();

    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Page 1 of Unknown')).toBeInTheDocument();
    expect(within(pagination).queryByText(/Showing/)).not.toBeInTheDocument();
    expect(within(pagination).getByRole('button', { name: 'Next page' })).toBeDisabled();
    expect(within(pagination).getByLabelText('Rows per page')).toHaveValue('50');
    expect(screen.getByLabelText('Action center summary')).toBeInTheDocument();
    expect(screen.getByText('Filter decisions')).toBeInTheDocument();
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('keeps an authoritative empty response distinct from an unknown count', () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: { ...data, items: [], total: 0, summary: { ...data.summary, open: 0 } },
    }));
    renderPage();

    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Showing 0–0 of 0')).toBeInTheDocument();
    expect(within(pagination).queryByText('Page 1 of Unknown')).not.toBeInTheDocument();
    expect(screen.getByText('Inbox clear')).toBeInTheDocument();
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
  });

  it('retains the full-result total through refresh failure and preserves page-size actions', async () => {
    useActionCenterMock.mockReturnValue(queryResult({
      data: { ...data, total: 120 },
      isError: true,
      error: new Error('Refresh unavailable'),
    }));
    renderPage();

    const pagination = screen.getByRole('navigation', { name: 'Pagination' });
    expect(within(pagination).getByText('Showing 1–50 of 120')).toBeInTheDocument();
    expect(screen.getByText('Review active alert')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(within(pagination).getByRole('button', { name: 'Next page' }));
    await waitFor(() => expect(useActionCenterMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ vehicle_id: 7, state: 'open', limit: 50, offset: 50 }),
    ));
    fireEvent.change(within(pagination).getByLabelText('Rows per page'), {
      target: { value: '25' },
    });
    await waitFor(() => expect(useActionCenterMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ vehicle_id: 7, state: 'open', limit: 25, offset: 0 }),
    ));
    expect(mutateAsyncMock).not.toHaveBeenCalled();
  });

  it('refreshes evidence without changing inbox state and retains a wrapping mobile target', () => {
    const refetch = vi.fn();
    useActionCenterMock.mockReturnValue(queryResult({ refetch }));
    renderPage();

    const refresh = screen.getByRole('button', { name: 'Refresh evidence' });
    expect(refresh).toHaveClass('min-h-11', 'md:min-h-10', 'whitespace-normal');
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(mutateAsyncMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
