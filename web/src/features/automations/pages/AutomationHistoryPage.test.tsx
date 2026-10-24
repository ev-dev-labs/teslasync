import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationHistory, AutomationHistoryListResponse } from '@/api/types';
import type { StatMetric } from '@/components/data-display/stat-reference/types';
import '../../../i18n';
import { formatDurationMs } from '@/lib/dateConvert';
import { assertOperationalBriefDisclosure, assertOperationalMetricUnavailable } from '@/test/operationalBriefAssertions';
import AutomationHistoryPage from './AutomationHistoryPage';

const state = vi.hoisted(() => ({
  filters: vi.fn(),
  data: null as AutomationHistoryListResponse | null,
  isLoading: false,
  isPending: false,
  isFetching: false,
  fetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  isError: false,
  error: null as Error | null,
  refetch: vi.fn(),
  metrics: [] as readonly StatMetric[],
  rulesData: [{ id: 7, name: 'Home arrival' }] as { id: number; name: string }[] | undefined,
  rulesError: null as Error | null,
  rulesFetchStatus: 'idle' as 'idle' | 'fetching' | 'paused',
  rulesRefetch: vi.fn(),
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
      isPending: state.isPending, isFetching: state.isFetching, fetchStatus: state.fetchStatus,
      error: state.error, refetch: state.refetch,
    };
  },
  useAutomationExecutionDetail: () => ({ data: null, isLoading: false, isError: false }),
  useAutomations: () => ({
    data: state.rulesData, error: state.rulesError, isError: state.rulesError !== null,
    fetchStatus: state.rulesFetchStatus, isFetching: state.rulesFetchStatus === 'fetching',
    refetch: state.rulesRefetch,
  }),
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
    state.isPending = false;
    state.isFetching = false;
    state.fetchStatus = 'idle';
    state.isError = false;
    state.error = null;
    state.filters.mockClear();
    state.refetch.mockClear();
    state.rulesData = [{ id: 7, name: 'Home arrival' }];
    state.rulesError = null;
    state.rulesFetchStatus = 'idle';
    state.rulesRefetch.mockClear();
  });

  it('distinguishes active initial loading, paused and pending history from successful empty', () => {
    state.data = null;
    state.isPending = true;
    state.isLoading = true;
    state.isFetching = true;
    state.fetchStatus = 'fetching';
    const { rerender } = render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByLabelText('Loading executions')).toBeInTheDocument();
    expect(screen.queryByText('No executions match this period and filters.')).not.toBeInTheDocument();
    state.isLoading = false;
    state.isFetching = false;
    state.fetchStatus = 'paused';
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.queryByLabelText('Loading executions')).not.toBeInTheDocument();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText('No executions match this period and filters.')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry.*Automation history/i }));
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.rulesRefetch).not.toHaveBeenCalled();
    state.fetchStatus = 'idle';
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByText('No requested source has returned usable data yet.')).toBeInTheDocument();
    expect(screen.queryByText('No executions match this period and filters.')).not.toBeInTheDocument();
    state.data = response([]);
    state.isPending = false;
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByText('No executions match this period and filters.')).toBeInTheDocument();
    expect(screen.queryByText('No requested source has returned usable data yet.')).not.toBeInTheDocument();
    const brief = screen.getByTestId('automation-history-brief');
    expect(brief.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('0');
  });

  it('preserves history while rules load or pause without retained options and recover independently', () => {
    state.data = response([row]);
    state.rulesData = undefined;
    state.rulesFetchStatus = 'fetching';
    const { rerender } = render(<MemoryRouter initialEntries={['/automations/history?automation_id=7']}><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByRole('table', { name: 'Automation history' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Rule #7' })).toBeInTheDocument();
    state.rulesFetchStatus = 'paused';
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Retry.*Filter executions by rule/i }));
    expect(state.rulesRefetch).toHaveBeenCalledOnce();
    expect(state.refetch).not.toHaveBeenCalled();
    state.rulesData = [{ id: 7, name: 'Home arrival' }];
    state.rulesFetchStatus = 'idle';
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.queryByText('Refresh paused')).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Home arrival' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home arrival' })).toBeInTheDocument();
  });

  it('retains both sources through refresh failures and clears only the recovered source warning', () => {
    state.data = response([row], 60);
    state.isError = true;
    state.error = new Error('history refresh failed');
    state.rulesError = new Error('rules refresh failed');
    const { rerender } = render(<MemoryRouter initialEntries={['/automations/history?automation_id=7&page=2']}><AutomationHistoryPage /></MemoryRouter>);
    const warnings = screen.getAllByTestId('stale-refresh-warning');
    expect(warnings).toHaveLength(2);
    fireEvent.click(within(warnings[0]).getByRole('button', { name: 'Refresh' }));
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(state.rulesRefetch).not.toHaveBeenCalled();
    fireEvent.click(within(warnings[1]).getByRole('button', { name: 'Refresh' }));
    expect(state.rulesRefetch).toHaveBeenCalledOnce();
    state.isError = false;
    state.error = null;
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    expect(screen.getByTestId('stale-refresh-warning')).toHaveTextContent('Filter executions by rule');
    expect(screen.getByRole('button', { name: 'Home arrival' })).toBeInTheDocument();
    expect(state.filters).toHaveBeenLastCalledWith(expect.objectContaining({ page: 2, automationId: 7 }));
    state.rulesError = null;
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
  });

  it.each(['paused', 'fetching'] as const)('keeps retained rows and rule options during a %s refresh', (fetchStatus) => {
    state.data = response([row], 60);
    state.fetchStatus = fetchStatus;
    state.isFetching = fetchStatus === 'fetching';
    state.rulesFetchStatus = fetchStatus;
    const { rerender } = render(<MemoryRouter initialEntries={['/automations/history?automation_id=7&page=2']}><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByRole('table', { name: 'Automation history' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Home arrival' })).toBeInTheDocument();
    expect(screen.queryByLabelText('Loading executions')).not.toBeInTheDocument();
    expect(screen.queryAllByTestId('stale-refresh-warning')).toHaveLength(fetchStatus === 'paused' ? 2 : 0);
    state.fetchStatus = 'idle';
    state.isFetching = false;
    state.rulesFetchStatus = 'idle';
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Home arrival' })).toBeInTheDocument();
  });

  it('keeps retained successful empty history and empty rules through a failed refresh', () => {
    state.rulesData = [];
    state.rulesError = new Error('rules refresh failed');
    state.isError = true;
    state.error = new Error('history refresh failed');
    const { rerender } = render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.getByText('No executions match this period and filters.')).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(2);
    expect(screen.getByRole('option', { name: 'All rules' })).toBeInTheDocument();
    expect(screen.getByTestId('automation-history-brief')
      .querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('0');
    state.isError = false;
    state.error = null;
    state.rulesError = null;
    rerender(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    expect(screen.queryByTestId('stale-refresh-warning')).not.toBeInTheDocument();
    expect(screen.getByText('No executions match this period and filters.')).toBeInTheDocument();
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
    expect(brief).not.toHaveTextContent('2026-09-01T07:00:00.000Z');
    assertOperationalBriefDisclosure(brief, '2026-09-01T07:00:00.000Z inclusive → 2026-10-01T07:00:00.000Z exclusive', { contains: true });
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
    for (const id of ['total', 'success', 'failed', 'partial']) {
      expect(brief.querySelector(`[data-operational-metric="${id}"]`)).toHaveAttribute('data-value-state', 'value');
      expect(brief.querySelector(`[data-operational-metric="${id}"] [data-operational-value]`)).toHaveTextContent('0');
    }
    assertOperationalMetricUnavailable(brief, 'Success rate');
    assertOperationalMetricUnavailable(brief, 'Average duration');
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
    expect(state.metrics.find((metric) => metric.occurrenceId === 'duration')?.rawValue).toBeNaN();
    expect(state.metrics.find((metric) => metric.occurrenceId === 'rate')?.rawValue).toBe(Number.POSITIVE_INFINITY);
    assertOperationalMetricUnavailable(brief, 'Success rate');
    assertOperationalMetricUnavailable(brief, 'Average duration');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 empty fields are hidden.');
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
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

  it('keeps new automation navigation with shared focus chrome and a wrapping mobile target', () => {
    render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    const link = screen.getByRole('link', { name: 'New automation' });
    expect(link).toHaveAttribute('href', '/automations/new');
    expect(link).toHaveClass('rounded-shape-sm', 'min-h-11', 'min-w-11', 'md:min-h-9',
      'whitespace-normal', 'focus-visible:outline-2', 'focus-visible:outline-offset-2');
    expect(within(link).getByText('New automation')).toHaveClass('min-w-0', 'break-words');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('allocates filter widths on wrappers and associates visible labels without losing unknown rules', () => {
    state.data = response([row], 60);
    render(<MemoryRouter initialEntries={['/automations/history?automation_id=99&status=partial&page=2']}><AutomationHistoryPage /></MemoryRouter>);
    const rule = screen.getByRole('combobox', { name: 'Filter executions by rule' });
    const status = screen.getByRole('combobox', { name: 'Filter executions by status' });
    expect(screen.getByLabelText('Filter executions by rule', { selector: 'select' })).toBe(rule);
    expect(screen.getByLabelText('Filter executions by status', { selector: 'select' })).toBe(status);
    expect(screen.getByText('Filter executions by rule', { selector: 'label' })).toHaveAttribute('for', rule.id);
    expect(screen.getByText('Filter executions by status', { selector: 'label' })).toHaveAttribute('for', status.id);
    expect(rule.parentElement?.parentElement).toHaveClass('w-full', 'min-w-0', 'sm:flex-1', 'sm:max-w-72');
    expect(status.parentElement?.parentElement).toHaveClass('w-full', 'min-w-0', 'sm:flex-1', 'sm:max-w-60');
    expect(rule).not.toHaveClass('flex-1', 'sm:max-w-72');
    expect(status).not.toHaveClass('flex-1', 'sm:max-w-60');
    expect(within(rule).getByRole('option', { name: 'Rule #99' })).toHaveValue('99');
    expect(rule).toHaveValue('99');
    expect(status).toHaveValue('partial');
    expect(state.filters).toHaveBeenCalledWith(expect.objectContaining({
      automationId: 99, status: 'partial', page: 2, pageSize: 25,
    }));
    fireEvent.change(rule, { target: { value: '7' } });
    expect(state.filters).toHaveBeenCalledWith(expect.objectContaining({
      automationId: 7, status: 'partial', page: 1,
      since: '2026-09-01T07:00:00.000Z', until: '2026-10-01T07:00:00.000Z',
    }));
  });

  it('locates one retained-history recovery beside activity without removing table or summary', () => {
    state.data = response([row]);
    state.isError = true;
    state.error = new Error('background history failure');
    state.refetch.mockClear();
    render(<MemoryRouter><AutomationHistoryPage /></MemoryRouter>);
    const warning = screen.getByTestId('stale-refresh-warning');
    expect(warning.parentElement).toContainElement(screen.getByText('Execution activity'));
    expect(screen.getByRole('region', { name: 'Execution summary' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Automation history' })).toBeInTheDocument();
    expect(screen.getAllByTestId('stale-refresh-warning')).toHaveLength(1);
    fireEvent.click(within(warning).getByRole('button', { name: 'Refresh' }));
    expect(state.refetch).toHaveBeenCalledOnce();
  });
});
