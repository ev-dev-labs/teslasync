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
const toastSuccess = vi.fn();
const toastError = vi.fn();
const setVehicleIdMock = vi.fn();

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
    useToast: () => ({ success: toastSuccess, error: toastError }),
  };
});
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ formatEnergy: (value: number) => `${value} Wh` }),
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
  toastSuccess.mockReset();
  toastError.mockReset();
  setVehicleIdMock.mockReset();
  useHistoryMock.mockReset();
  useActionCenterMock.mockReturnValue(queryResult());
  useHistoryMock.mockReturnValue({
    data: { items: [], total: 0, limit: 25, offset: 0 },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mutateAsyncMock.mockResolvedValue({});
});

describe('ActionCenterPage', () => {
  it('renders prioritized evidence, confidence, impact transparency, and provider status', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Action Center' })).toBeInTheDocument();
    expect(useActionCenterMock).toHaveBeenCalledWith(
      expect.objectContaining({ state: 'open', limit: 50, offset: 0 }),
    );
    expect(screen.getByText('Review active alert')).toBeInTheDocument();
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('No projected impact')).toBeInTheDocument();
    expect(screen.getByText(/^available$/i)).toBeInTheDocument();
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
    renderPage();
    expect(screen.getByLabelText('Loading recommendations')).toBeInTheDocument();
    expect(screen.getByLabelText('Action Center summary')).toBeInTheDocument();
    expect(screen.getByText('Source coverage')).toBeInTheDocument();
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
