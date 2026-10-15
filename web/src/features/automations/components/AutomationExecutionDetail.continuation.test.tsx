import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationExecutionDetail as Detail } from '@/api/types';
import { AutomationExecutionDetail } from './AutomationExecutionDetail';

const source = vi.hoisted(() => ({
  data: undefined as (Detail & {
    action_results_availability?: { status: string; complete: boolean; truncated: boolean; total: number };
    fsm_transitions_availability?: { status: string; complete: boolean; truncated: boolean; total: number };
  }) | null | undefined,
  error: null as Error | null,
  retry: vi.fn(),
}));
vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomationExecutionDetail: () => ({
    data: source.data, error: source.error, isError: source.error != null,
    isLoading: false, refetch: source.retry,
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, values?: Record<string, unknown>) =>
      (fallback ?? key).replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? '')),
    i18n: { language: 'en' },
  }),
}));

function detail(): Detail {
  return {
    id: 91, automation_id: 12, automation_name: 'Full retained execution name',
    vehicle_id: 3, triggered_at: '2026-10-05T23:00:00Z', completed_at: null,
    duration_ms: null, trigger_type: 'signal', trigger_snapshot: null,
    conditions_met: true, conditions_snapshot: null, actions_total: 1,
    actions_succeeded: 0, actions_failed: 1, status: 'failed',
    error: 'Complete retained execution failure', fsm_state: 'parked',
    created_at: '2026-10-05T23:00:00Z', success_rate: 0,
    actions_executed: [{ action: 'notification', diagnostic: 'Complete action diagnostic without truncation' }],
    fsm_transitions: [{
      id: 18, vehicle_id: 3, ts: '2026-10-05T23:00:00Z', fsm_name: 'vehicle',
      from_state: 'charging', to_state: 'parked', trigger: 'charge-ended',
    }],
  };
}

function renderDetail() {
  const onClose = vi.fn();
  render(<MemoryRouter><AutomationExecutionDetail id={91} onClose={onClose} /></MemoryRouter>);
  return onClose;
}

describe('Execution detail continuation retention', () => {
  beforeEach(() => {
    source.data = detail();
    source.error = null;
    source.retry.mockClear();
  });

  it('retains every detail section on refresh failure and retries without closing', () => {
    source.error = new Error('detail refresh unavailable');
    const onClose = renderDetail();
    expect(screen.getByText('Full retained execution name')).toBeInTheDocument();
    expect(screen.getByText('Complete retained execution failure')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Action results' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle state transitions' })).toBeInTheDocument();
    expect(screen.getByText(/Complete action diagnostic without truncation/)).toHaveClass('whitespace-pre-wrap', 'break-words');
    expect(screen.getByText('vehicle: charging → parked')).toBeInTheDocument();
    expect(screen.getByText('0/1')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('shows explicit unavailable recovery instead of fabricating a record for a null response', () => {
    source.data = null;
    const onClose = renderDetail();
    expect(screen.getByText('Execution details are unavailable.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Action results' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(source.retry).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['failed', 'unavailable', 'not_applicable'])('keeps empty subsection shells without claiming no transitions when %s', (status) => {
    source.data = {
      ...detail(), actions_executed: [], fsm_transitions: [],
      action_results_availability: { status: 'unavailable', complete: false, truncated: false, total: 0 },
      fsm_transitions_availability: { status, complete: false, truncated: false, total: 0 },
    };
    renderDetail();
    expect(screen.getByRole('heading', { name: 'Action results' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Vehicle state transitions' })).toBeInTheDocument();
    expect(screen.queryByText('No vehicle state transitions were recorded during this execution window.')).not.toBeInTheDocument();
    expect(screen.queryByText('No action results are recorded for this execution.')).not.toBeInTheDocument();
    const message = status === 'failed' ? 'This history section could not be loaded.'
      : status === 'not_applicable' ? 'No vehicle is associated with this execution.' : 'History availability is unknown.';
    expect(screen.getAllByText(message).length).toBeGreaterThan(0);
  });

  it('claims empty transitions only for a successfully loaded complete window', () => {
    source.data = {
      ...detail(), fsm_transitions: [],
      fsm_transitions_availability: { status: 'available', complete: true, truncated: false, total: 0 },
    };
    renderDetail();
    expect(screen.getByText('No vehicle state transitions were recorded during this execution window.')).toBeInTheDocument();
  });

  it.each([true, false])('preserves populated transitions while warning about incomplete coverage (truncated=%s)', (truncated) => {
    source.data = {
      ...detail(),
      fsm_transitions_availability: { status: 'available', complete: false, truncated, total: truncated ? 101 : 1 },
    };
    renderDetail();
    expect(screen.getByText('vehicle: charging → parked')).toBeInTheDocument();
    expect(screen.getByText(truncated ? 'Only part of this history is shown.' : 'This execution window is still open; history may be incomplete.')).toBeInTheDocument();
  });
});
