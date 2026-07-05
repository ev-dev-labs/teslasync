/**
 * WhyEndedPanel — "Why did this drive end?" diagnostic panel.
 *
 * The panel is a lazy, collapsible disclosure that joins the FSM transition
 * history with the raw signal window around a drive's end. It has two exports:
 * the pure `formatTransitionTime` helper and the `WhyEndedPanel` component.
 * This suite pins behaviour + the hardening fixes rather than smoke rendering,
 * and never touches the network (the single data source — `useDriveWhyEnded` —
 * is mocked so every query state can be driven deterministically):
 *
 *   1. formatTransitionTime — the "Invalid Date" guard: an empty / unparseable
 *      `ts` renders the universal "—" placeholder, while a valid ISO threads
 *      through to `toLocaleString()`.
 *   2. Collapsed / lazy — the panel starts collapsed with aria-expanded=false,
 *      the query stays disabled (3rd arg false), and NO content leaks even when
 *      the mock already has data (the `{expanded && …}` gate).
 *   3. Expand — a click flips aria-expanded, reveals the window selector + the
 *      diagnostic region, enables the query (3rd arg true), and wires
 *      aria-controls ⇄ the region's id.
 *   4. Loading / error — the spinner shows while loading; a first-load failure
 *      surfaces the error message + a Retry that calls refetch; a non-Error
 *      rejection falls back to the generic copy.
 *   5. Populated — FSM transitions bind into the timeline (state path + the
 *      empty-trigger "—" fallback + the guarded time), and the signal rows bind
 *      field / value / an absolute timestamp into the table.
 *   6. Empty states — no transitions surfaces the FSM empty card; no signals
 *      surfaces the table's empty message; neither blanks the panel.
 *   7. Window selector — changing the window refetches with the new literal.
 *   8. a11y — every decorative icon carries aria-hidden.
 *
 * Per the directory convention (see JourneyDetailsPanel.test.tsx /
 * ElevationChart.test.tsx): react-i18next is stubbed to echo the English
 * fallback (with {{var}} interpolation) so asserted copy is decoupled from the
 * locale bundle; the heavy shared barrels (@/components/ui, data-display,
 * feedback) + PanelTitle are doubled with light components that surface their
 * key props, so the composition contract is observable without the DataTable
 * virtualizer / timezone-settings subtrees. user-event is not installed in this
 * repo, so interactions go through fireEvent (matching the neighbours).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type {
  DriveDiagnosticResponse,
  DriveDiagnosticSignal,
  DriveDiagnosticTransition,
} from '@/types/admin-diagnostics';

// ── The panel's only data source. Hoisted so the vi.mock factory + the test
//    body share the same handle (loose typing → no return-type casts). ──
const { useDriveWhyEnded } = vi.hoisted(() => ({ useDriveWhyEnded: vi.fn() }));
vi.mock('@/api/hooks/useDriving', () => ({ useDriveWhyEnded }));

// ── i18n: echo the fallback (2nd arg) with {{var}} interpolation (3rd arg). ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown, opts?: unknown): string => {
    const base = typeof fallback === 'string' ? fallback : key;
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      return base.replace(/{{(\w+)}}/g, (_m, name) =>
        name in o ? String(o[name]) : `{{${name}}}`,
      );
    }
    return base;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── Shared component doubles — surface props as testable DOM. ──
vi.mock('@/components/ui', () => ({
  GlassPanel: ({ children, className }: any) => (
    <section className={className}>{children}</section>
  ),
  Button: ({ children, icon, onClick, variant: _v, size: _s, loading: _l, ...rest }: any) => (
    <button type="button" onClick={onClick} {...rest}>
      {icon}
      {children}
    </button>
  ),
  Select: ({ options, value, onChange, ...rest }: any) => (
    <select value={value} onChange={onChange} aria-label={rest['aria-label']}>
      {options.map((o: any) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
  DataTable: ({ data, columns, emptyMessage, keyExtractor }: any) => (
    <div data-testid="signal-table">
      {data.length === 0 ? (
        <div data-testid="signal-empty">{emptyMessage}</div>
      ) : (
        data.map((row: any) => (
          <div data-testid="signal-row" key={keyExtractor(row)}>
            {columns.map((c: any) => (
              <span key={c.key} data-col={c.key}>
                {c.render(row)}
              </span>
            ))}
          </div>
        ))
      )}
    </div>
  ),
}));

vi.mock('@/components/ui/Typography', () => ({
  PanelTitle: ({ children }: any) => <h3>{children}</h3>,
}));

vi.mock('@/components/data-display', () => ({
  Timeline: ({ items }: any) => (
    <ul data-testid="timeline">
      {items.map((it: any, i: number) => (
        <li key={i} data-testid="timeline-item">
          <span data-testid="tl-title">{it.title}</span>
          <span data-testid="tl-subtitle">{it.subtitle}</span>
          <span data-testid="tl-time">{it.time}</span>
        </li>
      ))}
    </ul>
  ),
  TimeStamp: ({ value, format }: any) => (
    <time data-testid="ts" data-format={format}>
      {value == null ? '' : String(value)}
    </time>
  ),
}));

vi.mock('@/components/feedback', () => ({
  Spinner: ({ label }: any) => (
    <div role="status" data-testid="spinner">
      {label ?? 'Loading'}
    </div>
  ),
  EmptyState: ({ title, message, action }: any) => (
    <div data-testid="empty">
      {title ? <div data-testid="empty-title">{title}</div> : null}
      <div data-testid="empty-message">{message}</div>
      {action ? (
        <button type="button" onClick={action.onClick}>
          {action.label}
        </button>
      ) : null}
    </div>
  ),
}));

import { WhyEndedPanel, formatTransitionTime } from './WhyEndedPanel';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const TS_A = '2026-07-04T19:15:00.000Z';
const TS_B = '2026-07-04T19:15:05.000Z';

const TRANSITIONS: DriveDiagnosticTransition[] = [
  {
    id: 1,
    ts: TS_A,
    fsm_name: 'drive',
    from_state: 'driving',
    to_state: 'parked',
    trigger: 'shift_to_park',
    details_json: null,
  },
  {
    id: 2,
    ts: TS_B,
    fsm_name: 'session',
    from_state: 'active',
    to_state: 'closed',
    trigger: '', // exercises the `trigger || '—'` fallback
    details_json: null,
  },
];

const SIGNALS: DriveDiagnosticSignal[] = [
  { ts: '2026-07-04T19:14:59.000Z', field: 'Gear', value: 'P' },
  { ts: TS_A, field: 'VehicleSpeed', value: '0' },
];

interface WhyState {
  data?: DriveDiagnosticResponse;
  isLoading: boolean;
  error: unknown;
  refetch: () => void;
}

function makeWhy(overrides: Partial<WhyState> = {}): WhyState {
  return { data: undefined, isLoading: false, error: null, refetch: vi.fn(), ...overrides };
}

function makeResponse(overrides: Partial<DriveDiagnosticResponse> = {}): DriveDiagnosticResponse {
  return {
    drive_id: 42,
    vehicle_id: 7,
    start_ts: '2026-07-04T18:30:00.000Z',
    end_ts: TS_A,
    ended_status: 'parked',
    window: '60s',
    fsm_transitions: [],
    signal_window: [],
    ...overrides,
  };
}

const toggleBtn = () => screen.getByRole('button', { name: /why did this drive end/i });
const expand = () => fireEvent.click(toggleBtn());

beforeEach(() => {
  useDriveWhyEnded.mockReset();
  useDriveWhyEnded.mockReturnValue(makeWhy());
});

// ── 1. formatTransitionTime (pure) ───────────────────────────────────────────

describe('formatTransitionTime', () => {
  it('renders the "—" placeholder for a missing timestamp', () => {
    expect(formatTransitionTime('')).toBe('—');
    expect(formatTransitionTime(null)).toBe('—');
    expect(formatTransitionTime(undefined)).toBe('—');
  });

  it('renders "—" for an unparseable timestamp instead of "Invalid Date"', () => {
    expect(formatTransitionTime('not-a-timestamp')).toBe('—');
    expect(formatTransitionTime('2026-13-99T99:99:99Z')).toBe('—');
  });

  it('formats a valid ISO timestamp through toLocaleString', () => {
    expect(formatTransitionTime(TS_A)).toBe(new Date(TS_A).toLocaleString());
    expect(formatTransitionTime(TS_A)).not.toBe('—');
  });
});

// ── 2. Collapsed / lazy ──────────────────────────────────────────────────────

describe('WhyEndedPanel — collapsed / lazy', () => {
  it('starts collapsed: aria-expanded=false, no region, query disabled', () => {
    render(<WhyEndedPanel driveId="42" />);

    expect(toggleBtn()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.queryByTestId('signal-table')).toBeNull();
    expect(screen.queryByLabelText('Diagnostic window')).toBeNull();
    // 3rd arg (enabled) is false while collapsed — the lazy contract.
    expect(useDriveWhyEnded).toHaveBeenCalledWith('42', '60s', false);
  });

  it('does not leak content while collapsed even when data is already cached', () => {
    useDriveWhyEnded.mockReturnValue(
      makeWhy({ data: makeResponse({ fsm_transitions: TRANSITIONS, signal_window: SIGNALS }) }),
    );

    render(<WhyEndedPanel driveId="42" />);

    // The `{expanded && …}` gate keeps everything hidden until expand.
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.queryByTestId('signal-row')).toBeNull();
    expect(useDriveWhyEnded).toHaveBeenLastCalledWith('42', '60s', false);
  });
});

// ── 3. Expand interaction + disclosure wiring ────────────────────────────────

describe('WhyEndedPanel — expand', () => {
  it('reveals the region + selector and enables the query on expand', () => {
    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(toggleBtn()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Diagnostic window')).toBeInTheDocument();
    // Re-render after expand fires the query with enabled=true.
    expect(useDriveWhyEnded).toHaveBeenLastCalledWith('42', '60s', true);
  });

  it('ties the toggle to the revealed region via aria-controls ⇄ id', () => {
    render(<WhyEndedPanel driveId="42" />);
    expand();

    const controls = toggleBtn().getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    const region = document.getElementById(controls as string);
    expect(region).not.toBeNull();
    // The region is the container for the diagnostic sections.
    expect(within(region as HTMLElement).getByTestId('signal-table')).toBeInTheDocument();
  });
});

// ── 4. Loading / error ───────────────────────────────────────────────────────

describe('WhyEndedPanel — loading & error', () => {
  it('shows the spinner (and no tables) while loading', () => {
    useDriveWhyEnded.mockReturnValue(makeWhy({ isLoading: true }));

    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(screen.getByTestId('spinner')).toBeInTheDocument();
    expect(screen.queryByTestId('timeline')).toBeNull();
    expect(screen.queryByTestId('signal-table')).toBeNull();
  });

  it('surfaces the error message and retries via refetch', () => {
    const refetch = vi.fn();
    useDriveWhyEnded.mockReturnValue(
      makeWhy({ error: new Error('window too small'), refetch }),
    );

    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(screen.getByTestId('empty-message')).toHaveTextContent('window too small');
    expect(screen.queryByTestId('signal-table')).toBeNull();

    expect(refetch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('falls back to the generic copy for a non-Error rejection', () => {
    useDriveWhyEnded.mockReturnValue(makeWhy({ error: 'boom' }));

    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(screen.getByTestId('empty-message')).toHaveTextContent(
      'Try a different window or reload the page.',
    );
  });
});

// ── 5. Populated ─────────────────────────────────────────────────────────────

describe('WhyEndedPanel — populated', () => {
  beforeEach(() => {
    useDriveWhyEnded.mockReturnValue(
      makeWhy({ data: makeResponse({ fsm_transitions: TRANSITIONS, signal_window: SIGNALS }) }),
    );
  });

  it('binds FSM transitions (state path, empty-trigger fallback, guarded time)', () => {
    render(<WhyEndedPanel driveId="42" />);
    expand();

    const items = screen.getAllByTestId('timeline-item');
    expect(items).toHaveLength(2);

    expect(within(items[0]).getByTestId('tl-title')).toHaveTextContent(
      'drive: driving → parked',
    );
    // The empty `trigger` collapses to the "—" fallback.
    expect(within(items[1]).getByTestId('tl-subtitle')).toHaveTextContent('trigger: —');
    // The time slot routes through the guard for a valid ISO.
    expect(within(items[0]).getByTestId('tl-time')).toHaveTextContent(
      formatTransitionTime(TS_A),
    );
    expect(within(items[0]).getByTestId('tl-time').textContent).not.toBe('—');
  });

  it('binds the signal rows (field, value, absolute timestamp)', () => {
    render(<WhyEndedPanel driveId="42" />);
    expand();

    const rows = screen.getAllByTestId('signal-row');
    expect(rows).toHaveLength(2);

    expect(within(rows[0]).getByText('Gear')).toBeInTheDocument();
    expect(within(rows[0]).getByText('P')).toBeInTheDocument();
    // The timestamp column requests the absolute format explicitly.
    expect(within(rows[0]).getByTestId('ts')).toHaveAttribute('data-format', 'absolute');
    expect(within(rows[1]).getByText('VehicleSpeed')).toBeInTheDocument();
  });

  it('guards a malformed transition timestamp to "—"', () => {
    useDriveWhyEnded.mockReturnValue(
      makeWhy({
        data: makeResponse({
          fsm_transitions: [{ ...TRANSITIONS[0], ts: '' }],
        }),
      }),
    );

    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(screen.getByTestId('tl-time')).toHaveTextContent('—');
  });
});

// ── 6. Empty states ──────────────────────────────────────────────────────────

describe('WhyEndedPanel — empty states', () => {
  it('shows the FSM empty card while still rendering the signal rows', () => {
    useDriveWhyEnded.mockReturnValue(
      makeWhy({ data: makeResponse({ fsm_transitions: [], signal_window: SIGNALS }) }),
    );

    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(screen.getByTestId('empty-title')).toHaveTextContent('No transitions in window');
    expect(screen.queryByTestId('timeline')).toBeNull();
    // The signal section is independent and still renders its rows.
    expect(screen.getAllByTestId('signal-row')).toHaveLength(2);
  });

  it('shows the signal table empty message while still rendering transitions', () => {
    useDriveWhyEnded.mockReturnValue(
      makeWhy({ data: makeResponse({ fsm_transitions: TRANSITIONS, signal_window: [] }) }),
    );

    render(<WhyEndedPanel driveId="42" />);
    expand();

    expect(screen.getByTestId('signal-empty')).toHaveTextContent(
      'No signals in this window for the default whitelist.',
    );
    expect(screen.getAllByTestId('timeline-item')).toHaveLength(2);
    // No FSM empty card when transitions exist.
    expect(screen.queryByTestId('empty')).toBeNull();
  });
});

// ── 7. Window selector ───────────────────────────────────────────────────────

describe('WhyEndedPanel — window selector', () => {
  it('refetches with the newly selected window', () => {
    useDriveWhyEnded.mockReturnValue(makeWhy({ data: makeResponse() }));

    render(<WhyEndedPanel driveId="42" />);
    expand();

    fireEvent.change(screen.getByLabelText('Diagnostic window'), {
      target: { value: '15m' },
    });

    expect(useDriveWhyEnded).toHaveBeenLastCalledWith('42', '15m', true);
  });
});

// ── 8. Accessibility ─────────────────────────────────────────────────────────

describe('WhyEndedPanel — a11y', () => {
  it('marks every decorative icon aria-hidden', () => {
    useDriveWhyEnded.mockReturnValue(
      makeWhy({ data: makeResponse({ fsm_transitions: TRANSITIONS, signal_window: SIGNALS }) }),
    );

    const { container } = render(<WhyEndedPanel driveId="42" />);
    expand();

    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThanOrEqual(1);
    // Chevron (toggle) + GitBranch + Radio — all decorative.
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });
});
