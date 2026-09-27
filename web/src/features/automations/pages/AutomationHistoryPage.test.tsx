import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationHistory, AutomationHistoryListResponse } from '@/api/types';
import '../../../i18n';
import AutomationHistoryPage from './AutomationHistoryPage';

const state = vi.hoisted(() => ({
  filters: vi.fn(),
  data: null as AutomationHistoryListResponse | null,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
}));
vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomationHistoryPage: (filters: unknown) => {
    state.filters(filters);
    return {
      data: state.data, isLoading: state.isLoading, isError: state.isError,
      error: state.error, refetch: state.refetch,
    };
  },
  useAutomationExecutionDetail: () => ({ data: null, isLoading: false, isError: false }),
  useAutomations: () => ({ data: [{ id: 7, name: 'Home arrival' }] }),
}));
vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    startInstant: '2026-09-01T07:00:00.000Z',
    endInstantExclusive: '2026-10-01T07:00:00.000Z',
  }),
}));

const row: AutomationHistory = {
  id: 12, automation_id: 7, automation_name: 'Home arrival', vehicle_id: 2,
  triggered_at: '2026-09-05T12:00:00Z', completed_at: '2026-09-05T12:00:01Z',
  duration_ms: 1000, trigger_type: 'geofence', trigger_snapshot: null,
  conditions_met: true, conditions_snapshot: null, actions_executed: null,
  actions_total: 2, actions_succeeded: 2, actions_failed: 0,
  status: 'success', error: null, fsm_state: null, created_at: '2026-09-05T12:00:00Z',
};

function response(items: AutomationHistory[], total = items.length): AutomationHistoryListResponse {
  return {
    items, total, limit: 25, offset: 0,
    summary: {
      total_executions: total, succeeded: items.length, failed: 0,
      partial: 0, success_rate: 100, avg_duration_ms: 1000,
    },
    trend: items.map((item) => ({ day: '2026-09-05', status: item.status, count: 1 })),
  };
}

describe('Automation History', () => {
  beforeEach(() => {
    state.data = response([]);
    state.isLoading = false;
    state.isError = false;
    state.error = null;
    state.filters.mockClear();
  });

  it('uses the shared header time range for server-side history, summary and trend', () => {
    state.data = response([row]);
    render(<MemoryRouter initialEntries={['/automations/history']}><AutomationHistoryPage /></MemoryRouter>);
    expect(state.filters).toHaveBeenCalledWith(expect.objectContaining({
      since: '2026-09-01T07:00:00.000Z',
      until: '2026-10-01T07:00:00.000Z',
      page: 1,
    }));
    expect(screen.getByRole('region', { name: 'Execution summary' })).toBeInTheDocument();
    expect(screen.getByText('Execution activity')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Automation History' })).toBeInTheDocument();
    expect(screen.queryByLabelText(/Filter.*date|Start date|End date/i)).not.toBeInTheDocument();
  });

  it('passes rule and status filters and page index to the server', () => {
    state.data = response([row], 60);
    render(<MemoryRouter initialEntries={['/automations/history?automation_id=7&status=failed&page=2']}><AutomationHistoryPage /></MemoryRouter>);
    expect(state.filters).toHaveBeenCalledWith(expect.objectContaining({
      automationId: 7, status: 'failed', page: 2, pageSize: 25,
    }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Filter executions by status' }), { target: { value: 'success' } });
    expect(state.filters).toHaveBeenCalledWith(expect.objectContaining({
      automationId: 7, status: 'success', page: 1,
    }));
  });

  it('keeps the chart and filters when history is empty or fails', () => {
    const { rerender } = render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByText('No executions match this period and filters.')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Manage automation rules' })[0]).toHaveAttribute('href', '/automations/list');
    state.data = null;
    state.isError = true;
    state.error = new Error('database unavailable');
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByRole('combobox', { name: 'Filter executions by rule' })).toBeInTheDocument();
    expect(screen.getByText('Execution activity')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /retry/i }).length).toBeGreaterThan(0);
  });

  it('opens execution detail from a full-width table row', () => {
    state.data = response([row]);
    render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    const table = screen.getByRole('table', { name: 'Automation History' });
    fireEvent.click(within(table).getByRole('button', { name: 'Home arrival' }));
    expect(screen.getByRole('dialog', { name: 'Execution details' })).toBeInTheDocument();
  });
});
