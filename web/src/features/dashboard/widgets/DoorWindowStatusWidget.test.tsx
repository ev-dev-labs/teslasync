/**
 * DoorWindowStatusWidget contract + hardening tests.
 *
 * The widget is a self-refreshing dashboard tile that projects a vehicle's
 * four door + four window states from `/security/latest`. Its whole shape is a
 * function of three inputs: the resolved vehicle id (`vehicleId` prop, else the
 * first fleet vehicle, else none/0), the `useSecurityLatest` query result, and
 * the widget `size`:
 *
 *   - size 1×1  → compact tile: two summary badges (doors / windows), no title.
 *   - otherwise → full tile: titled header + a "Doors" grid + a "Windows" grid.
 *   - no `securityData`            → the accessible "no data" empty state.
 *   - isLoading / error            → skeleton / QueryError chrome.
 *
 * Two layers are locked here:
 *
 *  A. The pure parsers/labellers (exported for testability):
 *     - `parseWindowState` — the SI enum surface. Regression-pins the fix where
 *       the Tesla `WindowStateUnknown` value (served as "Unknown") and prefixed
 *       "WindowStateClosed" / the "0" sentinel used to fall through to `open`,
 *       raising a phantom "window open" warning. Now: unknown→unknown,
 *       closed/0→closed, PartiallyOpen/Vented→partial, Opened→open.
 *     - `parseDoorStates` — boolean, `all_closed`, the primary single "Closed"
 *       string, the descriptive per-door "…Open" list (driver/passenger +
 *       front/rear and front/rear + left/right), and the generic "open".
 *     - `toGridStatus` / `toValueLabel` — every state → status + i18n label.
 *
 *  B. The component behaviour: full vs compact vs empty/loading/error views,
 *     the id-resolution fallback chain, and the accessible refresh control.
 *
 * i18n is stubbed to echo the English fallback so every copy assertion is real,
 * and `@/api/hooks/useVehicles` is partially mocked (real module kept, only the
 * two hooks the widget reads are overridden) so no network is ever touched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n passthrough: honour the English fallback so every copy assertion is real.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown) =>
      typeof defaultValue === 'string' ? defaultValue : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

// The fleet list + security query result are injected per-test through these
// mutable holders (the `MOCK_`/`mock` prefixes let vitest hoist the factory
// above them safely). Only the two hooks the widget reads are overridden — the
// rest of the real module is preserved so transitive importers keep working.
const mockUseSecurityLatest = vi.fn((_id: number, _interval?: number) => MOCK_SECURITY);
let MOCK_VEHICLES: { data: Vehicle[] | undefined };
let MOCK_SECURITY: SecurityQuery;
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return {
    ...actual,
    useVehicles: () => MOCK_VEHICLES,
    useSecurityLatest: (id: number, interval?: number) => mockUseSecurityLatest(id, interval),
  };
});

import DoorWindowStatusWidget, {
  parseWindowState,
  parseDoorStates,
  toGridStatus,
  toValueLabel,
} from './DoorWindowStatusWidget';
import type { WidgetSize } from './types';
import type { SecurityEvent } from '@/api/types';
import type { Vehicle } from '@/types/vehicle';

/** Only the fields the widget reads off the `useSecurityLatest` result. */
interface SecurityQuery {
  data: SecurityEvent | null | undefined;
  isLoading: boolean;
  error: unknown;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

const NOW = Date.parse('2026-07-05T12:00:00.000Z');
const FULL: WidgetSize = { cols: 2, rows: 2 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

/** Echoing translator matching the shape `toValueLabel` expects. */
const echo = (_key: string, fallback: string) => fallback;

function makeSecurity(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    vehicle_id: 1,
    ts: '2026-07-05T12:00:00Z',
    event_type: 'state',
    doors_open: null,
    windows_open: null,
    locked: true,
    sentry_mode: false,
    user_present: false,
    detail: null,
    source: 'test',
    created_at: '2026-07-05T12:00:00Z',
    ...overrides,
  };
}

function makeQuery(overrides: Partial<SecurityQuery> = {}): SecurityQuery {
  return {
    data: makeSecurity(),
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: NOW,
    refetch: vi.fn(),
    ...overrides,
  };
}

function fleet(...ids: number[]): Vehicle[] {
  return ids.map((id) => ({ id })) as unknown as Vehicle[];
}

interface RenderOpts {
  query?: SecurityQuery;
  vehicles?: Vehicle[];
  vehicleId?: number;
}

function renderWidget(size: WidgetSize, opts: RenderOpts = {}) {
  MOCK_SECURITY = opts.query ?? makeQuery();
  MOCK_VEHICLES = { data: opts.vehicles ?? [] };
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DoorWindowStatusWidget vehicleId={opts.vehicleId} size={size} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The section wrapper `<div>` that groups a heading (`Doors`/`Windows`) + grid. */
function sectionOf(heading: string): HTMLElement {
  const el = screen.getByText(heading).closest('div');
  if (!el) throw new Error(`section "${heading}" not found`);
  return el as HTMLElement;
}

beforeEach(() => {
  MOCK_VEHICLES = { data: [] };
  MOCK_SECURITY = makeQuery();
  mockUseSecurityLatest.mockClear();
});

afterEach(() => {
  cleanup();
});

// ── A. Pure helpers ────────────────────────────────────────────────────────

describe('toGridStatus', () => {
  it('maps each state to its status severity', () => {
    expect(toGridStatus('closed')).toBe('ok');
    expect(toGridStatus('open')).toBe('warning');
    expect(toGridStatus('partial')).toBe('warning');
    expect(toGridStatus('unknown')).toBe('unknown');
  });
});

describe('toValueLabel', () => {
  it('translates each state and uses an em dash for unknown', () => {
    expect(toValueLabel('closed', echo)).toBe('Closed');
    expect(toValueLabel('open', echo)).toBe('Open');
    expect(toValueLabel('partial', echo)).toBe('Partial');
    expect(toValueLabel('unknown', echo)).toBe('—');
  });
});

describe('parseWindowState', () => {
  it('coerces native booleans to open/closed', () => {
    expect(parseWindowState(true)).toBe('open');
    expect(parseWindowState(false)).toBe('closed');
  });

  it('treats absent / blank values as unknown', () => {
    expect(parseWindowState(null)).toBe('unknown');
    expect(parseWindowState(undefined)).toBe('unknown');
    expect(parseWindowState('')).toBe('unknown');
    expect(parseWindowState(42)).toBe('unknown');
  });

  it('maps closed enum values (incl. prefixed + "0" sentinel) to closed', () => {
    expect(parseWindowState('Closed')).toBe('closed');
    expect(parseWindowState('WindowStateClosed')).toBe('closed');
    expect(parseWindowState('0')).toBe('closed');
  });

  it('maps partial / vented enum values to partial', () => {
    expect(parseWindowState('PartiallyOpen')).toBe('partial');
    expect(parseWindowState('WindowStatePartiallyOpen')).toBe('partial');
    expect(parseWindowState('Vented')).toBe('partial');
  });

  it('maps opened enum values to open', () => {
    expect(parseWindowState('Opened')).toBe('open');
    expect(parseWindowState('WindowStateOpened')).toBe('open');
  });

  it('regression: "Unknown" is NOT reported as open (phantom-open guard)', () => {
    // Tesla's default WindowStateUnknown (served as "Unknown") previously fell
    // through the `=== 'closed'` check to `open`, raising a false window-open
    // warning. It must resolve to `unknown`.
    expect(parseWindowState('Unknown')).toBe('unknown');
    expect(parseWindowState('WindowStateUnknown')).toBe('unknown');
  });
});

describe('parseDoorStates', () => {
  it('coerces native booleans to all-open / all-closed', () => {
    expect(parseDoorStates(true)).toEqual({ fl: 'open', fr: 'open', rl: 'open', rr: 'open' });
    expect(parseDoorStates(false)).toEqual({ fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed' });
  });

  it('treats absent / blank values as all-unknown', () => {
    expect(parseDoorStates(null)).toEqual({ fl: 'unknown', fr: 'unknown', rl: 'unknown', rr: 'unknown' });
    expect(parseDoorStates('')).toEqual({ fl: 'unknown', fr: 'unknown', rl: 'unknown', rr: 'unknown' });
  });

  it('maps the all-closed sentinels and the primary "Closed" string to all-closed', () => {
    const allClosed = { fl: 'closed', fr: 'closed', rl: 'closed', rr: 'closed' };
    expect(parseDoorStates('all_closed')).toEqual(allClosed);
    expect(parseDoorStates('AllClosed')).toEqual(allClosed);
    expect(parseDoorStates('Closed')).toEqual(allClosed);
  });

  it('opens exactly the doors named in a driver/passenger front/rear list', () => {
    expect(
      parseDoorStates('driver front open,passenger front open,driver rear open,passenger rear open'),
    ).toEqual({ fl: 'open', fr: 'open', rl: 'open', rr: 'open' });
  });

  it('opens exactly the doors named in a front/rear left/right list, closing the rest', () => {
    expect(parseDoorStates('DriverFront:Open,PassengerRear:Open')).toEqual({
      fl: 'open',
      fr: 'closed',
      rl: 'closed',
      rr: 'open',
    });
    expect(parseDoorStates('front left open, rear right open')).toEqual({
      fl: 'open',
      fr: 'closed',
      rl: 'closed',
      rr: 'open',
    });
  });

  it('treats a bare "open" token as every door open', () => {
    expect(parseDoorStates('open')).toEqual({ fl: 'open', fr: 'open', rl: 'open', rr: 'open' });
  });
});

// ── B. Component behaviour ──────────────────────────────────────────────────

describe('DoorWindowStatusWidget — full view', () => {
  it('renders titled Doors/Windows grids with the correct per-position labels', () => {
    renderWidget(FULL, {
      query: makeQuery({
        data: makeSecurity({
          door_state: 'DriverFront:Open,PassengerRear:Open',
          fd_window: 'Closed',
          fp_window: 'PartiallyOpen',
          rd_window: 'Closed',
          rp_window: 'Opened',
        }),
      }),
    });

    expect(screen.getByText('Door & Window Status')).toBeInTheDocument();
    expect(screen.getByText('Doors')).toBeInTheDocument();
    expect(screen.getByText('Windows')).toBeInTheDocument();

    // Doors: front-left + rear-right open, the other two closed.
    const doors = within(sectionOf('Doors'));
    expect(doors.getAllByText('Open')).toHaveLength(2);
    expect(doors.getAllByText('Closed')).toHaveLength(2);

    // Windows: closed / partial / closed / opened.
    const windows = within(sectionOf('Windows'));
    expect(windows.getAllByText('Closed')).toHaveLength(2);
    expect(windows.getByText('Partial')).toBeInTheDocument();
    expect(windows.getByText('Open')).toBeInTheDocument();
  });

  it('regression: "Unknown" windows render an em dash, never an "Open" warning', () => {
    renderWidget(FULL, {
      query: makeQuery({
        data: makeSecurity({
          door_state: 'Closed',
          fd_window: 'Unknown',
          fp_window: 'Unknown',
          rd_window: 'Unknown',
          rp_window: 'Unknown',
        }),
      }),
    });

    const windows = within(sectionOf('Windows'));
    expect(windows.getAllByText('—')).toHaveLength(4);
    expect(windows.queryByText('Open')).toBeNull();
  });
});

describe('DoorWindowStatusWidget — compact view', () => {
  it('summarises open counts and drops the header title', () => {
    renderWidget(COMPACT, {
      query: makeQuery({
        data: makeSecurity({
          door_state: 'DriverFront:Open,PassengerRear:Open',
          fd_window: 'Opened',
          fp_window: 'Closed',
          rd_window: 'Closed',
          rp_window: 'Closed',
        }),
      }),
    });

    expect(screen.getByText('2 door(s) open')).toBeInTheDocument();
    expect(screen.getByText('1 window(s) open')).toBeInTheDocument();
    // A 1×1 tile suppresses the header title entirely.
    expect(screen.queryByText('Door & Window Status')).toBeNull();
  });

  it('regression: all-"Unknown" windows summarise as closed, not a false open count', () => {
    renderWidget(COMPACT, {
      query: makeQuery({
        data: makeSecurity({
          door_state: 'Closed',
          fd_window: 'Unknown',
          fp_window: 'Unknown',
          rd_window: 'Unknown',
          rp_window: 'Unknown',
        }),
      }),
    });

    expect(screen.getByText('Doors ✓')).toBeInTheDocument();
    expect(screen.getByText('Windows ✓')).toBeInTheDocument();
    expect(screen.queryByText('4 window(s) open')).toBeNull();
  });
});

describe('DoorWindowStatusWidget — lifecycle states', () => {
  it('renders only a skeleton while loading', () => {
    const { container } = renderWidget(FULL, { query: makeQuery({ isLoading: true }) });
    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Door & Window Status')).toBeNull();
    expect(screen.queryByText('No door/window data')).toBeNull();
  });

  it('surfaces a query error instead of the grids', () => {
    renderWidget(FULL, { query: makeQuery({ error: new Error('boom'), isError: true }) });
    // jsdom reports navigator.onLine === true → QueryError's network branch.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('Doors')).toBeNull();
  });

  it('shows an accessible empty state when there is no security data', () => {
    renderWidget(FULL, { query: makeQuery({ data: null }) });
    expect(screen.getByText('No door/window data')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The doors/windows sections are short-circuited entirely.
    expect(screen.queryByText('Doors')).toBeNull();
  });
});

describe('DoorWindowStatusWidget — vehicle resolution + refresh', () => {
  it('queries the explicit vehicleId at the 5s live interval', () => {
    renderWidget(FULL, { vehicleId: 7 });
    expect(mockUseSecurityLatest).toHaveBeenCalledWith(7, 5000);
  });

  it('falls back to the first fleet vehicle when no vehicleId is given', () => {
    renderWidget(FULL, { vehicles: fleet(3, 9) });
    expect(mockUseSecurityLatest).toHaveBeenCalledWith(3, 5000);
  });

  it('resolves to id 0 (disabled) when neither a prop nor a fleet vehicle exists', () => {
    renderWidget(FULL, { vehicles: [] });
    expect(mockUseSecurityLatest).toHaveBeenCalledWith(0, 5000);
  });

  it('refetches when the accessible "Refresh" freshness control is activated', () => {
    const refetch = vi.fn();
    renderWidget(FULL, { query: makeQuery({ refetch, isFetching: false }) });

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
