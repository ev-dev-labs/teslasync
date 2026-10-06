// Behavioural contract for the automations activity sidebar. Exercises every
// branch of the panel and its two internal rows (HistoryRow / LiveEventRow):
//   - header: section title + Live / Reconnecting connection indicator
//   - persistent summary differentiates unavailable and successful zero runs
//   - self-contained loading (skeletons) / error (QueryError) / empty states
//   - history rows: name, relative time, duration, action ratio, error copy,
//     status → icon-accent mapping incl. unknown-status fallback
//   - live SSE rows: name, type badge, error / reason copy, name fallback,
//     unknown-type fallback, slice(0, 5) cap
//   - null-safety guards on the required array props
//
// Follows the repo test conventions: framer-motion is mocked so FadeIn renders
// eagerly (no IntersectionObserver / matchMedia), react-i18next is mocked with
// an interpolating fallback `t`, and every render is wrapped in a MemoryRouter
// because QueryError reaches for useNavigate().

import { describe, it, expect, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { AutomationActivityFeed } from './AutomationActivityFeed';
import { ApiError } from '@/api/client';
import type { AutomationHistory, AutomationHistoryStats } from '@/api/types';
import type { AutomationActivityEvent } from '@/hooks/useAutomationEvents';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { unit_of_length: 'km', unit_of_temp: 'C',
    unit_of_pressure: 'bar', locale: 'en-US', decimal_precision: 2, currency_symbol: '$' } }),
}));

// FadeIn wraps the panel in a framer-motion `motion.div`. Render it eagerly as
// a plain <div> so content is in the DOM synchronously and we never touch
// window.matchMedia (unavailable in jsdom).
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...props }: { children?: ReactNode } & Record<string, unknown>) => (
          <div {...filterMotionProps(props)}>{children}</div>
        ),
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useInView: () => true,
  useReducedMotion: () => false,
}));

function filterMotionProps(props: Record<string, unknown>): Record<string, unknown> {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(props)) {
    if (
      key === 'initial' || key === 'animate' || key === 'exit' || key === 'transition' ||
      key === 'whileHover' || key === 'whileTap' || key === 'whileInView' ||
      key === 'viewport' || key === 'variants' || key === 'layout' || key === 'layoutId'
    ) {
      continue;
    }
    cleaned[key] = value;
  }
  return cleaned;
}

// Interpolating fallback `t` — returns the English default and substitutes
// {{token}} placeholders so we can assert on rendered stats copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, opts?: Record<string, unknown>) => {
      if (!opts) return fallback;
      return Object.entries(opts).reduce(
        (out, [k, v]) => out.replace(`{{${k}}}`, String(v)),
        fallback,
      );
    },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

type Props = ComponentProps<typeof AutomationActivityFeed>;

function makeHistory(overrides: Partial<AutomationHistory> = {}): AutomationHistory {
  return {
    id: 1,
    automation_id: 10,
    automation_name: 'Precondition Cabin',
    vehicle_id: 3,
    triggered_at: new Date().toISOString(),
    completed_at: null,
    duration_ms: 1500,
    trigger_type: 'schedule',
    trigger_snapshot: null,
    conditions_met: true,
    conditions_snapshot: null,
    actions_executed: null,
    actions_total: 0,
    actions_succeeded: 0,
    actions_failed: 0,
    status: 'success',
    error: null,
    fsm_state: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function makeStats(overrides: Partial<AutomationHistoryStats> = {}): AutomationHistoryStats {
  return {
    total_executions: 42,
    succeeded: 40,
    failed: 1,
    partial: 1,
    success_rate: 92,
    avg_duration_ms: 1234,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<AutomationActivityEvent> = {}): AutomationActivityEvent {
  return {
    id: 'ae-1',
    type: 'automation.triggered',
    data: {
      automation_id: 10,
      name: 'Cabin Warmup',
      vehicle: 'Model 3',
      trigger: 'schedule',
      at: new Date().toISOString(),
      mode: 'live',
    },
    receivedAt: new Date(),
    ...overrides,
  } as AutomationActivityEvent;
}

function renderFeed(overrides: Partial<Props> = {}) {
  const props: Props = {
    history: [],
    historyStats: null,
    isLoading: false,
    error: undefined,
    liveEvents: [],
    connectionState: 'connected',
    ...overrides,
  };
  return render(
    <MemoryRouter>
      <AutomationActivityFeed {...props} />
    </MemoryRouter>,
  );
}

describe('AutomationActivityFeed — header & connection state', () => {
  it('renders the section title and a Live indicator when connected', () => {
    renderFeed({ connectionState: 'connected' });
    expect(screen.getByText('Recent activity')).toBeInTheDocument();
    expect(screen.getByText('Live')).toBeInTheDocument();
    expect(screen.queryByText('Reconnecting')).toBeNull();
  });

  it('swaps to a Reconnecting indicator when the stream is reconnecting', () => {
    renderFeed({ connectionState: 'reconnecting' });
    expect(screen.getByText('Reconnecting')).toBeInTheDocument();
    expect(screen.queryByText('Live')).toBeNull();
  });
});

describe('AutomationActivityFeed — stats summary', () => {
  it('renders the totals/success/avg summary when there are executions', () => {
    const { container } = renderFeed({ historyStats: makeStats({ total_executions: 42 }) });
    expect(container.textContent).toContain('42 total');
    expect(container.textContent).toContain('success');
    expect(container.textContent).toContain('avg');
  });

  it('keeps a missing summary when historyStats is null without inventing totals or averages', () => {
    const { container } = renderFeed({ historyStats: null });
    expect(container.textContent).not.toContain('total');
    expect(container.textContent).not.toContain('avg');
    expect(screen.getByTestId('automation-activity-brief').querySelectorAll('[data-value-state="missing"]')).toHaveLength(3);
  });

  it('keeps measured zero executions separate from undefined rate and average', () => {
    renderFeed({ historyStats: makeStats({ total_executions: 0 }) });
    const brief = screen.getByTestId('automation-activity-brief');
    expect(brief.querySelector('[data-operational-metric="total"]')).toHaveAttribute('data-value-state', 'value');
    expect(brief.querySelector('[data-operational-metric="total"] [data-operational-value]')).toHaveTextContent('0');
    expect(brief.querySelector('[data-operational-metric="rate"]')).toHaveAttribute('data-value-state', 'missing');
    expect(brief.querySelector('[data-operational-metric="duration"]')).toHaveAttribute('data-value-state', 'missing');
  });

  it('reviews retained summary evidence without hiding independent live events or retry', () => {
    const onRetry = vi.fn();
    renderFeed({ historyStats: makeStats(), error: new Error('refresh unavailable'), onRetry,
      liveEvents: [makeEvent({ data: { automation_id: 10, name: 'Independent stream',
        vehicle: 'Model 3', trigger: 'schedule', at: new Date().toISOString(), mode: 'live' } })] });
    const brief = screen.getByTestId('automation-activity-brief');
    expect(within(brief).getByText('Retained execution summary')).toBeInTheDocument();
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Execution summary details' });
    expect(within(drawer).getAllByText('History aggregate window is not supplied. Independent live events and recent rows are not this summary denominator.').length).toBeGreaterThan(0);
    expect(within(drawer).getByText('42 total')).toBeInTheDocument();
    expect(screen.getByText('Independent stream')).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });
});

describe('AutomationActivityFeed — loading / error / empty', () => {
  it('shows skeleton placeholders during the initial history load', () => {
    const { container } = renderFeed({
      isLoading: true,
      connectionState: 'connected',
      history: [],
    });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(8);
    expect(screen.getByTestId('automation-activity-brief')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByTestId('automation-activity-brief').querySelectorAll('[data-operational-value]')).toHaveLength(0);
    expect(screen.queryByText('No execution history yet')).toBeNull();
  });

  it('renders a fatal history error without hiding independent live events', () => {
    renderFeed({
      error: new ApiError('boom', 500),
      history: [],
      liveEvents: [makeEvent({ id: 'retained-live', data: {
        automation_id: 10, name: 'Independent live event', vehicle: 'Model 3',
        trigger: 'schedule', at: new Date().toISOString(), mode: 'live',
      } })],
    });
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(screen.getByText('Independent live event')).toBeInTheDocument();
  });

  it('retains history rows, ordering, metadata and retry after a refresh failure', () => {
    const onRetry = vi.fn();
    renderFeed({
      error: new Error('refresh offline'), onRetry,
      history: [
        makeHistory({ id: 2, automation_name: 'First retained', actions_total: 4, actions_succeeded: 2 }),
        makeHistory({ id: 1, automation_name: 'Second retained', status: 'failed', error: 'Complete diagnostic' }),
      ],
    });
    const first = screen.getByText('First retained');
    const second = screen.getByText('Second retained');
    expect(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('2/4')).toBeInTheDocument();
    expect(screen.getByText('Complete diagnostic')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('keeps supplied history and live events during a background load', () => {
    const { container } = renderFeed({
      isLoading: true, history: [makeHistory()], liveEvents: [makeEvent()],
    });
    expect(screen.getByText('Precondition Cabin')).toBeInTheDocument();
    expect(screen.getByText('Cabin Warmup')).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(1);
  });

  it('shows the empty state when there is no history and no live activity', () => {
    renderFeed({ history: [], liveEvents: [] });
    const empty = screen.getByRole('status');
    expect(empty).toBeInTheDocument();
    expect(within(empty).getByText('No execution history yet')).toBeInTheDocument();
  });

  it('does not show the empty state when only live events are present', () => {
    renderFeed({ history: [], liveEvents: [makeEvent({ id: 'ae-live-1' })] });
    expect(screen.queryByText('No execution history yet')).toBeNull();
    expect(screen.getByText('Cabin Warmup')).toBeInTheDocument();
  });

  it('refreshes empty history through the supplied source recovery callback', () => {
    const onRetry = vi.fn();
    renderFeed({ history: [], liveEvents: [], onRetry });
    fireEvent.click(within(screen.getByRole('status')).getByRole('button', { name: 'Refresh' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText('No execution history yet')).toBeInTheDocument();
  });
});

describe('AutomationActivityFeed — history rows', () => {
  it('keeps complete names, errors, duration and action metadata in wrapping shared rows', () => {
    const name = 'A long automation name that must remain readable in the narrow activity rail';
    const error = 'First diagnostic line\nSecond diagnostic line with the complete remediation evidence';
    renderFeed({ history: [makeHistory({
      automation_name: name, error, actions_total: 4, actions_succeeded: 2, duration_ms: 1500,
    })] });
    expect(screen.getByText(name)).toHaveClass('break-words');
    expect(screen.getByText(/Second diagnostic line/)).not.toHaveClass('truncate');
    expect(screen.getByText('2/4')).toBeInTheDocument();
    expect(screen.getByText('1.50s')).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();
  });

  it('renders the automation name, relative time and duration', () => {
    renderFeed({
      history: [makeHistory({ automation_name: 'Nightly Charge', duration_ms: 1500 })],
    });
    expect(screen.getByText('Nightly Charge')).toBeInTheDocument();
    expect(screen.getByText('Just now')).toBeInTheDocument();
    expect(screen.getByText('1.50s')).toBeInTheDocument();
  });

  it('renders the action ratio only when actions_total > 0', () => {
    const { rerender } = renderFeed({
      history: [makeHistory({ actions_total: 0, actions_succeeded: 0 })],
    });
    expect(screen.queryByText('0/0')).toBeNull();

    rerender(
      <MemoryRouter>
        <AutomationActivityFeed
          history={[makeHistory({ actions_total: 3, actions_succeeded: 2 })]}
          historyStats={null}
          isLoading={false}
          liveEvents={[]}
          connectionState="connected"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText('2/3')).toBeInTheDocument();
  });

  it('keeps a nullish actions_succeeded unknown in the ratio', () => {
    renderFeed({
      history: [
        makeHistory({
          actions_total: 4,
          actions_succeeded: null as unknown as number,
        }),
      ],
    });
    expect(screen.getByText('—/4')).toBeInTheDocument();
    expect(screen.queryByText('0/4')).not.toBeInTheDocument();
  });

  it('surfaces the error message when a run failed', () => {
    renderFeed({
      history: [
        makeHistory({ status: 'failed', error: 'Vehicle unreachable', automation_name: 'Lock Doors' }),
      ],
    });
    expect(screen.getByText('Vehicle unreachable')).toBeInTheDocument();
    expect(screen.getByText('Lock Doors')).toBeInTheDocument();
  });

  it('maps status to a toned accent icon and falls back to running for unknown status', () => {
    // success → emerald, failed → rose, unknown → indigo (running fallback).
    // connectionState=reconnecting + no stats isolates the row icon colour.
    const { container: ok } = renderFeed({
      connectionState: 'reconnecting',
      history: [makeHistory({ status: 'success' })],
    });
    expect(ok.querySelector('svg.text-emerald-300')).not.toBeNull();

    const { container: bad } = renderFeed({
      connectionState: 'reconnecting',
      history: [makeHistory({ status: 'failed', error: 'x' })],
    });
    expect(bad.querySelector('svg.text-rose-300')).not.toBeNull();

    const { container: unknown } = renderFeed({
      connectionState: 'reconnecting',
      history: [makeHistory({ status: 'not-a-real-status' as AutomationHistory['status'] })],
    });
    expect(unknown.querySelector('svg.text-indigo-300')).not.toBeNull();
  });
});

describe('AutomationActivityFeed — live SSE rows', () => {
  it('renders the event name and a type badge for a triggered event', () => {
    renderFeed({
      liveEvents: [makeEvent({ id: 'ae-t', type: 'automation.triggered' })],
    });
    expect(screen.getByText('Cabin Warmup')).toBeInTheDocument();
    expect(screen.getByText('triggered')).toBeInTheDocument();
  });

  it('renders the error copy for a failed live event', () => {
    renderFeed({
      liveEvents: [
        makeEvent({
          id: 'ae-f',
          type: 'automation.failed',
          data: {
            automation_id: 10,
            name: 'Lock Doors',
            error: 'Action 2 failed',
            action_index: 2,
            mode: 'live',
          },
        }),
      ],
    });
    expect(screen.getByText('failed')).toBeInTheDocument();
    expect(screen.getByText('Action 2 failed')).toBeInTheDocument();
  });

  it('renders the reason copy for a skipped live event', () => {
    renderFeed({
      liveEvents: [
        makeEvent({
          id: 'ae-s',
          type: 'automation.skipped',
          data: {
            automation_id: 10,
            name: 'Sentry Guard',
            reason: 'condition not met',
            mode: 'live',
          },
        }),
      ],
    });
    expect(screen.getByText('skipped')).toBeInTheDocument();
    expect(screen.getByText('condition not met')).toBeInTheDocument();
  });

  it('falls back to #<automation_id> when the event carries no name', () => {
    renderFeed({
      liveEvents: [
        makeEvent({
          id: 'ae-noname',
          data: { automation_id: 77 } as AutomationActivityEvent['data'],
        }),
      ],
    });
    expect(screen.getByText('#77')).toBeInTheDocument();
  });

  it('falls back to the triggered accent for an unknown event type', () => {
    const { container } = renderFeed({
      liveEvents: [
        makeEvent({
          id: 'ae-x',
          type: 'automation.mystery' as AutomationActivityEvent['type'],
          data: {
            automation_id: 5,
            name: 'Mystery Auto',
            vehicle: 'Model Y',
            trigger: 'manual',
            at: new Date().toISOString(),
            mode: 'live',
          },
        }),
      ],
    });
    expect(screen.getByText('Mystery Auto')).toBeInTheDocument();
    expect(screen.getByText('mystery')).toBeInTheDocument();
    // triggered fallback accent = pulsing cyan icon
    expect(container.querySelector('svg.animate-pulse.text-cyan-300')).not.toBeNull();
  });

  it('caps the live feed at the five most recent events', () => {
    const events = Array.from({ length: 7 }, (_, i) =>
      makeEvent({
        id: `ae-${i}`,
        data: {
          automation_id: i,
          name: `evt-${i}`,
          vehicle: 'Model 3',
          trigger: 'schedule',
          at: new Date().toISOString(),
          mode: 'live',
        },
      }),
    );
    renderFeed({ liveEvents: events });
    expect(screen.getByText('evt-0')).toBeInTheDocument();
    expect(screen.getByText('evt-4')).toBeInTheDocument();
    expect(screen.queryByText('evt-5')).toBeNull();
    expect(screen.queryByText('evt-6')).toBeNull();
  });

  it('renders live events above history without hiding either', () => {
    renderFeed({
      history: [makeHistory({ automation_name: 'History Row' })],
      liveEvents: [makeEvent({ id: 'ae-both', data: { automation_id: 1, name: 'Live Row', vehicle: 'M3', trigger: 't', at: new Date().toISOString(), mode: 'live' } })],
    });
    expect(screen.getByText('Live Row')).toBeInTheDocument();
    expect(screen.getByText('History Row')).toBeInTheDocument();
    expect(screen.queryByText('No execution history yet')).toBeNull();
  });
});

describe('AutomationActivityFeed — null-safety guards', () => {
  it('does not crash and shows the empty state when liveEvents is undefined', () => {
    renderFeed({ liveEvents: undefined as unknown as Props['liveEvents'], history: [] });
    expect(screen.getByText('No execution history yet')).toBeInTheDocument();
  });

  it('does not crash and shows the empty state when history is undefined', () => {
    renderFeed({ history: undefined as unknown as Props['history'], liveEvents: [] });
    expect(screen.getByText('No execution history yet')).toBeInTheDocument();
  });
});
