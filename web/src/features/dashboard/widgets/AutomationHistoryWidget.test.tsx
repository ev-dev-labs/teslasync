/**
 * AutomationHistoryWidget redesign coverage.
 * Exercises the real rows, status presentation, shared shell freshness,
 * TZ-aware date formatting boundary, null safety, and refresh behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationHistory, AutomationHistoryListResponse, AutomationHistoryStatus } from '@/api/types';
import type { WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

interface HistoryQuery {
  data: AutomationHistoryListResponse | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const { historyMock, dateFormatMock, dateLabelsMock } = vi.hoisted(() => ({
  historyMock: vi.fn<() => HistoryQuery>(),
  dateFormatMock: vi.fn<(value: unknown) => string>(),
  dateLabelsMock: vi.fn<(value: unknown) => string>(),
}));

vi.mock('@/api/hooks/useAutomations', () => ({
  useAutomationHistory: () => historyMock(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, options?: Record<string, unknown>) => {
      let value = fallback ?? key;
      if (options) {
        for (const [name, option] of Object.entries(options)) {
          value = value.replaceAll(`{{${name}}}`, String(option));
        }
      }
      return value;
    },
  }),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (value: unknown) => dateFormatMock(value),
    formatTime: (value: unknown) => dateFormatMock(value),
  }),
}));
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => ({ formatRelativeDays: (value: unknown) => dateLabelsMock(value) }),
}));

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));
vi.hoisted(() => {
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false, media: query, onchange: null,
      addListener: () => {}, removeListener: () => {},
      addEventListener: () => {}, removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

import AutomationHistoryWidget, {
  automationStatusLabel,
  automationStatusVariant,
} from './AutomationHistoryWidget';

const NOW = '2026-07-05T12:00:00.000Z';
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 2 };

function makeHistory(overrides: Partial<AutomationHistory> = {}): AutomationHistory {
  return {
    id: 1, automation_id: 10, automation_name: 'Precondition',
    vehicle_id: 7, triggered_at: NOW, completed_at: NOW,
    duration_ms: 2100, trigger_type: 'schedule', trigger_snapshot: null,
    conditions_met: true, conditions_snapshot: null, actions_executed: null,
    actions_total: 1, actions_succeeded: 1, actions_failed: 0,
    status: 'success', error: null, fsm_state: null, created_at: NOW,
    ...overrides,
  };
}

function makeResponse(items: AutomationHistory[] = []): AutomationHistoryListResponse {
  return {
    items,
    total: items.length,
    limit: 20,
    offset: 0,
    summary: {
      total_executions: items.length,
      succeeded: items.filter(item => item.status === 'success').length,
      failed: items.filter(item => item.status === 'failed').length,
      partial: items.filter(item => item.status === 'partial').length,
      success_rate: items.length ? (items.filter(item => item.status === 'success').length / items.length) * 100 : 0,
      avg_duration_ms: 2100,
    },
    trend: [],
  };
}

function query(overrides: Partial<HistoryQuery> = {}): HistoryQuery {
  return {
    data: makeResponse([makeHistory()]),
    isLoading: false, isFetching: false, isStale: false, isError: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...overrides,
  };
}

function widgetTree(packId: PackId, size: WidgetSize = FULL) {
  return (
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <AutomationHistoryWidget size={size} />
      </PackBoundary>
    </MemoryRouter>
  );
}

function renderWidget(packId: PackId, size: WidgetSize = FULL) {
  return render(
    widgetTree(packId, size),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dateLabelsMock.mockReturnValue('Today');
  dateFormatMock.mockImplementation((value: unknown) => String(value));
  historyMock.mockReturnValue(query());
});
afterEach(cleanup);

describe.each(PACK_IDS)('AutomationHistoryWidget status and rows (%s)', packId => {
  it('renders the After-card row pattern without a fabricated success headline', () => {
    historyMock.mockReturnValue(query({
      data: makeResponse([
        makeHistory({ id: 1, automation_name: 'Precondition on weekdays', status: 'success', duration_ms: 2100 }),
        makeHistory({ id: 2, automation_name: 'Close windows if rain', status: 'failed', duration_ms: null }),
      ]),
    }));
    const { container } = renderWidget(packId);

    const precondition = screen.getByText('Precondition on weekdays');
    const row = precondition.closest('[role="listitem"]');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Succeeded')).toBeInTheDocument();
    expect(within(row!).getByText('2.1 s')).toBeInTheDocument();
    expect(within(row!).getByText(/Today/)).toBeInTheDocument();
    expect(screen.queryByText(/Success rate/)).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    const list = screen.getByRole('list', { name: 'Automation history' });
    if (packId === 'classic') {
      expect(list).not.toHaveAttribute('data-timeline-appearance');
    } else {
      expect(list).toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[packId]);
    }
    const failedRow = screen.getByText('Close windows if rain').closest('[role="listitem"]');
    expect(within(failedRow!).getByText('Failed')).toBeInTheDocument();
    expect(within(failedRow!).getByText('—')).toBeInTheDocument();
  });

  it('uses the shared date/TZ boundary and null-safe placeholders', () => {
    dateLabelsMock.mockReturnValue('Yesterday');
    dateFormatMock.mockReturnValue('Oct 18 4:02 PM');
    historyMock.mockReturnValue(query({
      data: makeResponse([makeHistory({
        automation_name: null as unknown as string,
        triggered_at: null as unknown as string,
        status: null as unknown as never,
        duration_ms: null,
      })]),
    }));
    renderWidget(packId, COMPACT);

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('list', { name: 'Automation history' })).toBeInTheDocument();
  });

  it('preserves execution statuses and distinguishes zero, unknown, and invalid durations', () => {
    const statuses: AutomationHistoryStatus[] = ['success', 'failed', 'partial', 'running', 'skipped', 'cancelled', 'test', 'undo'];
    const labels = ['Succeeded', 'Failed', 'Partial', 'Running', 'Skipped', 'Cancelled', 'Test', 'Undone', 'future-status'];
    const durations = [0, 999, 1000, null, -1, Number.NaN, Number.POSITIVE_INFINITY, 2100, undefined];
    const durationLabels = ['0 ms', '999 ms', '1.0 s', '—', '—', '—', '—', '2.1 s', '—'];
    historyMock.mockReturnValue(query({
      data: makeResponse([...statuses, 'future-status' as AutomationHistoryStatus].map((status, index) =>
        makeHistory({ id: index + 1, automation_name: `Execution ${index}`, status, duration_ms: durations[index] }),
      )),
    }));
    renderWidget(packId);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(labels.length);
    rows.forEach((row, index) => {
      expect(within(row).getByText(labels[index])).toBeInTheDocument();
      expect(within(row).getByText(durationLabels[index])).toBeInTheDocument();
    });
  });

  it('keeps newest-first ordering and compact/full limits without mutating retained history', () => {
    const items = Array.from({ length: 12 }, (_, index) => makeHistory({
      id: index + 1,
      automation_name: `Execution ${index + 1}`,
      triggered_at: new Date(Date.parse(NOW) + index * 1000).toISOString(),
    }));
    items.splice(1, 0, makeHistory({ id: 99, automation_name: 'Invalid timestamp', triggered_at: 'not-a-date' }));
    const originalOrder = items.map(item => item.id);
    historyMock.mockReturnValue(query({ data: makeResponse(items) }));
    const view = renderWidget(packId);
    const rowNames = () => screen.getAllByRole('listitem').map(row => within(row).getByText(/^Execution /).textContent);

    expect(rowNames()).toEqual(Array.from({ length: 10 }, (_, index) => `Execution ${12 - index}`));
    view.rerender(widgetTree(packId, COMPACT));
    expect(rowNames()).toEqual(['Execution 12', 'Execution 11', 'Execution 10', 'Execution 9']);
    expect(screen.queryByText('Invalid timestamp')).not.toBeInTheDocument();
    expect(items.map(item => item.id)).toEqual(originalOrder);
  });
});

it('maps known and unknown statuses without exposing raw prototype keys', () => {
  expect(automationStatusLabel('success', (_key, fallback) => fallback)).toBe('Succeeded');
  expect(automationStatusLabel('failed', (_key, fallback) => fallback)).toBe('Failed');
  expect(automationStatusLabel('constructor' as never, (_key, fallback) => fallback)).toBe('constructor');
  expect(automationStatusVariant('success')).toBe('success');
  expect(automationStatusVariant('failed')).toBe('danger');
  expect(automationStatusVariant('partial')).toBe('warning');
});

describe.each(PACK_IDS)('AutomationHistoryWidget states and freshness (%s)', packId => {
  it('shows a loading shell instead of an empty state', () => {
    historyMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    const { container } = renderWidget(packId);
    expect(screen.getByRole('heading', { name: 'Automation history' })).toBeInTheDocument();
    expect(screen.queryByText('No automation runs yet')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initial');
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
  });

  it('shows an empty state rather than a fabricated zero', () => {
    historyMock.mockReturnValue(query({ data: makeResponse([]) }));
    renderWidget(packId);
    expect(screen.getByText('No automation runs yet')).toBeInTheDocument();
  });

  it('keeps cached rows and wires refresh to the FreshnessDot control', () => {
    const q = query({ isError: true, isStale: true });
    historyMock.mockReturnValue(q);
    const { container } = renderWidget(packId);
    expect(screen.getByText('Precondition')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'stale');
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(q.refetch).toHaveBeenCalledOnce();
  });

  it('retries an initial error without showing false empty history', () => {
    const q = query({ data: undefined, isError: true, isLoading: false, dataUpdatedAt: 0 });
    historyMock.mockReturnValue(q);
    const { container } = renderWidget(packId);
    expect(screen.queryByText('No automation runs yet')).not.toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-data-state', 'initialFailure');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(q.refetch).toHaveBeenCalledOnce();
  });

  it('keeps rows visible while a background refresh is in flight', () => {
    historyMock.mockReturnValue(query({ isFetching: true }));
    const { container } = renderWidget(packId);
    expect(screen.getByText('Precondition')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('No automation runs yet')).not.toBeInTheDocument();
  });
});

it('keeps the mounted retained rows and refresh action while switching every pack', () => {
  const q = query({ isError: true, isStale: true });
  historyMock.mockReturnValue(q);
  const view = renderWidget('classic');
  const originalRow = screen.getByText('Precondition').closest('[role="listitem"]');

  PACK_IDS.forEach(packId => {
    view.rerender(widgetTree(packId));
    expect(screen.getByText('Precondition').closest('[role="listitem"]')).toBe(originalRow);
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
  });
  expect(q.refetch).toHaveBeenCalledTimes(PACK_IDS.length);
});
