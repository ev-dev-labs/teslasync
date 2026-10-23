/**
 * AutomationHistoryWidget redesign coverage.
 * Exercises the real rows, status presentation, shared shell freshness,
 * TZ-aware date formatting boundary, null safety, and refresh behavior.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { AutomationHistory, AutomationHistoryListResponse } from '@/api/types';
import type { WidgetSize } from './types';

const { historyMock, dateFormatMock, dateLabelsMock } = vi.hoisted(() => ({
  historyMock: vi.fn(),
  dateFormatMock: vi.fn(),
  dateLabelsMock: vi.fn(),
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
  };
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: makeResponse([makeHistory()]),
    isLoading: false, isFetching: false, isStale: false, isError: false,
    dataUpdatedAt: Date.now(), refetch: vi.fn(),
    ...overrides,
  };
}

function renderWidget(size: WidgetSize = FULL) {
  return render(
    <MemoryRouter>
      <AutomationHistoryWidget size={size} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  dateLabelsMock.mockReturnValue('Today');
  dateFormatMock.mockImplementation((value: unknown) => String(value));
  historyMock.mockReturnValue(query());
});
afterEach(cleanup);

describe('AutomationHistoryWidget status and rows', () => {
  it('renders the After-card row pattern without a fabricated success headline', () => {
    historyMock.mockReturnValue(query({
      data: makeResponse([
        makeHistory({ id: 1, automation_name: 'Precondition on weekdays', status: 'success', duration_ms: 2100 }),
        makeHistory({ id: 2, automation_name: 'Close windows if rain', status: 'failed', duration_ms: null }),
      ]),
    }));
    renderWidget(FULL);

    const precondition = screen.getByText('Precondition on weekdays');
    const row = precondition.closest('[role="listitem"]');
    expect(row).not.toBeNull();
    expect(within(row!).getByText('Succeeded')).toBeInTheDocument();
    expect(within(row!).getByText('2.1 s')).toBeInTheDocument();
    expect(within(row!).getByText(/Today/)).toBeInTheDocument();
    expect(screen.queryByText(/Success rate/)).not.toBeInTheDocument();
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
    renderWidget(COMPACT);

    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.getByRole('list', { name: 'Automation history' })).toBeInTheDocument();
  });

  it('maps known and unknown statuses without exposing raw prototype keys', () => {
    expect(automationStatusLabel('success', (_key, fallback) => fallback)).toBe('Succeeded');
    expect(automationStatusLabel('failed', (_key, fallback) => fallback)).toBe('Failed');
    expect(automationStatusLabel('constructor' as never, (_key, fallback) => fallback)).toBe('constructor');
    expect(automationStatusVariant('success')).toBe('success');
    expect(automationStatusVariant('failed')).toBe('danger');
    expect(automationStatusVariant('partial')).toBe('warning');
  });
});

describe('AutomationHistoryWidget states and freshness', () => {
  it('shows a loading shell instead of an empty state', () => {
    historyMock.mockReturnValue(query({ data: undefined, isLoading: true }));
    renderWidget(FULL);
    expect(screen.getByRole('heading', { name: 'Automation history' })).toBeInTheDocument();
    expect(screen.queryByText('No automation runs yet')).not.toBeInTheDocument();
  });

  it('shows an empty state rather than a fabricated zero', () => {
    historyMock.mockReturnValue(query({ data: makeResponse([]) }));
    renderWidget(FULL);
    expect(screen.getByText('No automation runs yet')).toBeInTheDocument();
  });

  it('keeps cached rows and wires refresh to the FreshnessDot control', () => {
    const q = query({ isError: true, isStale: true });
    historyMock.mockReturnValue(q);
    renderWidget(FULL);
    expect(screen.getByText('Precondition')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh data/i }));
    expect(q.refetch).toHaveBeenCalledOnce();
  });

  it('retries an initial error without showing false empty history', () => {
    const q = query({ data: undefined, isError: true, isLoading: false, dataUpdatedAt: 0 });
    historyMock.mockReturnValue(q);
    renderWidget(FULL);
    expect(screen.queryByText('No automation runs yet')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(q.refetch).toHaveBeenCalledOnce();
  });
});
