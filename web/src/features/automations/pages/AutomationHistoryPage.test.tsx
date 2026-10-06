import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationHistory, AutomationHistoryListResponse } from '@/api/types';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import '../../../i18n';
import { formatDurationMs } from '@/lib/dateFormat';
import AutomationHistoryPage from './AutomationHistoryPage';

const state = vi.hoisted(() => ({
  filters: vi.fn(),
  data: null as AutomationHistoryListResponse | null,
  isLoading: false,
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
  metrics: [] as readonly StatMetric[],
}));
vi.mock('@/hooks/useOperationalMetrics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalMetrics')>();
  return {
    useOperationalMetrics: (...args: Parameters<typeof actual.useOperationalMetrics>) => {
      state.metrics = args[0];
      return actual.useOperationalMetrics(...args);
    },
  };
});
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
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', locale: 'en-US', decimal_precision: 2, currency_symbol: '$' } }),
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
    expect(screen.getByRole('table', { name: 'Automation history' })).toBeInTheDocument();
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
    const table = screen.getByRole('table', { name: 'Automation history' });
    fireEvent.click(within(table).getByRole('button', { name: 'Home arrival' }));
    expect(screen.getByRole('dialog', { name: 'Execution details' })).toBeInTheDocument();
  });

  it('opens the summary review drawer with full server scope and preserves execution controls', () => {
    state.data = response([row], 60);
    render(<MemoryRouter initialEntries={['/automations/history?automation_id=7&status=failed&page=2']}><AutomationHistoryPage /></MemoryRouter>);
    const brief = screen.getByTestId('automation-history-brief');
    expect(brief).toHaveTextContent('2026-09-01T07:00:00.000Z inclusive → 2026-10-01T07:00:00.000Z exclusive');
    expect(brief.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('60');
    expect(brief.querySelector('[data-operational-metric="duration"] [data-operational-value]')).toHaveTextContent(formatDurationMs(1000));
    expect(state.metrics.find((metric) => metric.occurrenceId === 'duration')).toMatchObject({
      metricId: 'duration', rawValue: 1,
    });
    expect(state.metrics.find((metric) => metric.occurrenceId === 'rate')).toMatchObject({
      metricId: 'percent', rawValue: 100,
    });
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Execution summary details' });
    expect(within(drawer).getAllByText('Server summary across the selected period and rule/status filters, not just this page of rows.').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('60')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter executions by rule' })).toHaveValue('7');
    expect(screen.getByRole('combobox', { name: 'Filter executions by status' })).toHaveValue('failed');
    expect(screen.getByRole('button', { name: 'Home arrival' })).toBeInTheDocument();
  });

  it('keeps successful zero counts separate from undefined percentages and duration', () => {
    state.data = response([]);
    render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    const brief = screen.getByTestId('automation-history-brief');
    expect(brief.querySelector('[data-operational-metric="total"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="rate"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="duration"]')).toHaveAttribute('data-value-state', 'missing');
    expect(screen.getByText('No executions match this period and filters.')).toBeInTheDocument();
  });

  it('preserves measured zero duration and rate but rejects non-finite summary operands', () => {
    state.data = response([row]);
    state.data.summary.avg_duration_ms = 0;
    state.data.summary.success_rate = 0;
    const { rerender } = render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    const brief = screen.getByTestId('automation-history-brief');
    expect(brief.querySelector('[data-operational-metric="duration"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="rate"]')).toHaveAttribute('data-value-state', 'value');
    expect(state.metrics.find((metric) => metric.occurrenceId === 'duration')?.rawValue).toBe(0);
    state.data.summary.avg_duration_ms = Number.NaN;
    state.data.summary.success_rate = Number.POSITIVE_INFINITY;
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(brief.querySelector('[data-operational-metric="duration"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(brief.querySelector('[data-operational-metric="rate"]')).toHaveAttribute('data-value-state', 'invalid');
    expect(brief.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('retains summary, chart, filters and rows on refresh failure and offers source recovery', () => {
    state.data = response([row], 60);
    state.isError = true;
    state.error = new Error('background history failure');
    state.refetch.mockClear();
    render(<MemoryRouter initialEntries={['/automations/history?automation_id=7&page=2']}><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByRole('region', { name: 'Execution summary' })).toBeInTheDocument();
    expect(screen.getByText('Execution activity')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home arrival' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter executions by rule' })).toHaveValue('7');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.filters).toHaveBeenCalledWith(expect.objectContaining({ page: 2, automationId: 7 }));
    expect(screen.queryByText('Server error')).not.toBeInTheDocument();
  });
});
