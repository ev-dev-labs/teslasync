import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ActionCenterRecommendation,
  ActionCenterResponse,
} from '@/types/actionCenter';

const useActionCenterMock = vi.fn();
const useHistoryMock = vi.fn();
const mutateAsyncMock = vi.fn();
const toastMock = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();
const setVehicleIdMock = vi.fn();
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
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: { id: 7, display_name: 'Orion' },
    vehicles: [{ id: 7, display_name: 'Orion' }],
    setVehicleId: setVehicleIdMock,
  }),
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
}));
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

function renderPage() {
  return render(
    <MemoryRouter>
      <ActionCenterPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useActionCenterMock.mockReset();
  mutateAsyncMock.mockReset();
  toastMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  setVehicleIdMock.mockReset();
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
    expect(screen.getByText('Orion · Before priority, source, state, and pagination filters')).toBeInTheDocument();
    expect(screen.getByText(/^Generated (?!recommendations)/)).toBeInTheDocument();
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
    expect(within(screen.getByRole('dialog')).getByText('Source coverage is incomplete or unknown; unavailable sources do not imply zero findings.')).toBeInTheDocument();
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
