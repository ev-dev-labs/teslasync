import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationExecutionDetail as Detail } from '@/api/types';
import { AutomationExecutionDetail } from './AutomationExecutionDetail';

const source = vi.hoisted(() => ({
  data: undefined as Detail | null | undefined,
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
});
