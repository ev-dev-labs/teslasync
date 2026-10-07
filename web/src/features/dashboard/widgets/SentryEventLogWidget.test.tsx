/**
 * SentryEventLogWidget — behaviour, branch, null-safety and a11y coverage for
 * the dashboard's security / sentry event-feed widget.
 *
 * What this file pins:
 *   - the exported `deriveEvent` mapper, one case per branch of its priority
 *     ladder (door-open > sentry > lock > default), its accent colour /
 *     severity tiering, and the compact lock + sentry subtitle it builds;
 *   - the REGRESSION FIX at the heart of this elevation: `sentry_mode` arrives
 *     from the Fleet Telemetry pipeline as a Tesla enum STRING ("Off" / "Armed"
 *     / "SentryModeStateOff") — never a plain JS boolean — so the old
 *     `if (ev.sentry_mode)` truthy test mislabelled the string "Off" as
 *     "Sentry Mode activated" and could never reach the deactivated branch.
 *     `deriveEvent` now routes every shape through `parseEnumBool`, so "Off"
 *     reads as deactivated (both in the title AND the subtitle chip), a native
 *     boolean is honoured, and an absent signal falls through to the lock
 *     branches instead of being mislabelled;
 *   - the widget's data-source resolution (explicit `vehicleId` prop vs. the
 *     first fleet vehicle vs. an empty fleet → id 0 so the query stays
 *     disabled), the snake_case `/security?vehicle_id=…&limit=…` request URL
 *     with NO `/api/v1` prefix, and the size-driven event limit (4 / 7 / 10);
 *   - every render state fanned out by `WidgetShell` — loading skeleton, the
 *     empty state, and the distinct error message (never a blank panel), plus
 *     the working freshness Refresh control;
 *   - the populated feed — one row per event, wide-only subtitles, newest-first
 *     ordering, and that the decorative row icons are hidden from the a11y tree.
 *
 * Strategy: the vehicle hook (`useVehicles`), the inline TanStack `useQuery` and
 * the API `request` client are mocked so no network is touched and every query
 * state is controllable per-test. i18n is a passthrough that honours the English
 * default and interpolates `{{var}}` tokens so the visible copy is deterministic
 * and real. Because `sentry_mode` is declared `boolean | null` on the shared
 * type but is wider at runtime, the fixture factory accepts loose overrides so
 * the string-enum reality can be exercised. The widget is rendered inside a
 * MemoryRouter because the shared feedback / timeline components it composes may
 * reach for router context.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { TFunction } from 'i18next';

import type { SecurityEvent } from '@/api/types';
import SentryEventLogWidget, { deriveEvent } from './SentryEventLogWidget';
import type { WidgetSize } from './types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default and interpolates {{var}} tokens
// so the door-open title ("Door open: …") and every label assert as real copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { useVehiclesMock, useQueryMock, requestMock } = vi.hoisted(() => ({
  useVehiclesMock: vi.fn(),
  useQueryMock: vi.fn(),
  requestMock: vi.fn(),
}));

vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return { ...actual, useQuery: (options: unknown) => useQueryMock(options) };
});

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => useVehiclesMock(),
}));

vi.mock('@/api/client', () => ({
  request: (...args: unknown[]) => requestMock(...args),
}));

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** i18next-style translator: English default + {{var}} interpolation. */
function makeT() {
  return vi.fn(
    (key: string, defaultValue?: unknown, options?: Record<string, unknown>): string => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
  );
}
const asT = (fn: ReturnType<typeof makeT>): TFunction => fn as unknown as TFunction;

const BASE_TS = '2024-01-01T00:00:00Z';

/**
 * Build a SecurityEvent. Overrides are intentionally loose (`unknown`) because
 * `sentry_mode` / `door_state` are wider at runtime (Tesla enum strings) than
 * the declared `boolean | null` — the whole point of the widget's guards.
 */
function makeEvent(over: Partial<Record<keyof SecurityEvent, unknown>> = {}): SecurityEvent {
  const base: Record<string, unknown> = {
    vehicle_id: 1,
    ts: BASE_TS,
    event_type: 'security',
    doors_open: null,
    windows_open: null,
    locked: null,
    sentry_mode: null,
    user_present: null,
    detail: null,
    source: 'test',
    id: 1,
    created_at: BASE_TS,
  };
  return { ...base, ...over } as unknown as SecurityEvent;
}

interface QueryResult {
  data: SecurityEvent[] | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<QueryResult> = {}): QueryResult {
  return {
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

interface CapturedQuery {
  queryKey: unknown[];
  queryFn: () => Promise<unknown>;
  enabled: boolean;
}
function lastQueryOptions(): CapturedQuery {
  return useQueryMock.mock.calls.at(-1)?.[0] as CapturedQuery;
}

/** ISO timestamp `mins` minutes before now — keeps the feed's relative-time
 *  formatter on its sub-24h path so no locale-dependent date is rendered. */
function minsAgo(mins: number): string {
  return new Date(Date.now() - mins * 60_000).toISOString();
}

function renderWidget(size: WidgetSize = { cols: 3, rows: 2 }, vehicleId?: number) {
  return render(
    <MemoryRouter>
      <SentryEventLogWidget size={size} vehicleId={vehicleId} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useVehiclesMock.mockReset();
  useQueryMock.mockReset();
  requestMock.mockReset();

  useVehiclesMock.mockReturnValue({ data: [{ id: 1 }] });
  useQueryMock.mockReturnValue(makeResult());
  requestMock.mockResolvedValue([]);
});

// ── Pure mapper: deriveEvent ─────────────────────────────────────────────────

describe('deriveEvent', () => {
  it('gives an open door top priority with a warning severity and lists the doors', () => {
    // door-open must win even when sentry + lock are also present.
    const d = deriveEvent(
      makeEvent({ door_state: 'FrontLeftOpen, RearRightClosed', locked: true, sentry_mode: 'Armed' }),
      asT(makeT()),
    );
    expect(d.title).toBe('Door open: FrontLeftOpen');
    expect(d.severity).toBe('warning');
    expect(d.color).toBe('#f59e0b');
  });

  it('routes the door-open title through i18n with interpolation', () => {
    const t = makeT();
    deriveEvent(makeEvent({ door_state: 'RearOpen' }), asT(t));
    expect(t).toHaveBeenCalledWith('widget.sentryLog.doorOpen', 'Door open: {{doors}}', {
      doors: 'RearOpen',
    });
  });

  it('reads a non-Off Tesla enum string as Sentry ON', () => {
    const d = deriveEvent(makeEvent({ sentry_mode: 'Armed' }), asT(makeT()));
    expect(d.title).toBe('Sentry Mode activated');
    expect(d.severity).toBe('info');
    expect(d.color).toBe('#06b6d4');
  });

  it('REGRESSION: treats the enum string "Off" as deactivated, not activated', () => {
    const d = deriveEvent(makeEvent({ sentry_mode: 'Off' }), asT(makeT()));
    expect(d.title).toBe('Sentry Mode deactivated');
    // The old truthy test rendered "activated" here — this is the bug fix.
    expect(d.title).not.toBe('Sentry Mode activated');
    expect(d.color).toBe('#6b7280');
  });

  it('treats the full "SentryModeStateOff" enum token as deactivated too', () => {
    const d = deriveEvent(makeEvent({ sentry_mode: 'SentryModeStateOff' }), asT(makeT()));
    expect(d.title).toBe('Sentry Mode deactivated');
  });

  it('honours a native boolean sentry_mode in both directions', () => {
    expect(deriveEvent(makeEvent({ sentry_mode: true }), asT(makeT())).title).toBe(
      'Sentry Mode activated',
    );
    expect(deriveEvent(makeEvent({ sentry_mode: false }), asT(makeT())).title).toBe(
      'Sentry Mode deactivated',
    );
  });

  it('falls through to the lock branches when sentry_mode is absent', () => {
    const locked = deriveEvent(makeEvent({ locked: true }), asT(makeT()));
    expect(locked.title).toBe('Vehicle locked');
    expect(locked.severity).toBe('info');
    expect(locked.color).toBe('#22c55e');

    const unlocked = deriveEvent(makeEvent({ locked: false }), asT(makeT()));
    expect(unlocked.title).toBe('Vehicle unlocked');
    expect(unlocked.severity).toBe('critical');
    expect(unlocked.color).toBe('#ef4444');
  });

  it('defaults to a neutral security-updated descriptor when nothing is set', () => {
    const d = deriveEvent(makeEvent(), asT(makeT()));
    expect(d.title).toBe('Security state updated');
    expect(d.severity).toBe('info');
    expect(d.color).toBe('#8b5cf6');
  });

  it('builds a compact lock + sentry subtitle joined with a middot', () => {
    const d = deriveEvent(makeEvent({ locked: true, sentry_mode: 'Armed' }), asT(makeT()));
    expect(d.subtitle).toContain('🔒 Locked');
    expect(d.subtitle).toContain('🛡️ Sentry On');
    expect(d.subtitle).toContain('·');
  });

  it('REGRESSION: the subtitle chip reads "Sentry Off" for an Off enum string', () => {
    const d = deriveEvent(makeEvent({ locked: false, sentry_mode: 'Off' }), asT(makeT()));
    expect(d.subtitle).toContain('Sentry Off');
    expect(d.subtitle).toContain('🔓 Unlocked');
    expect(d.subtitle).not.toContain('Sentry On');
  });

  it('collapses to an em-dash subtitle when neither lock nor sentry is present', () => {
    expect(deriveEvent(makeEvent(), asT(makeT())).subtitle).toBe('—');
    // A whitespace-only / empty sentry string counts as absent, not "off".
    expect(deriveEvent(makeEvent({ sentry_mode: '' }), asT(makeT())).subtitle).toBe('—');
  });
});

// ── Data-source resolution + query wiring ────────────────────────────────────

describe('SentryEventLogWidget — query wiring', () => {
  it('keys the query on the explicit vehicleId prop over the fleet default', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 99 }] });
    renderWidget({ cols: 3, rows: 2 }, 42);
    const opts = lastQueryOptions();
    expect(opts.queryKey).toEqual(['security-events', 42, 'sentry-log-10']);
    expect(opts.enabled).toBe(true);
  });

  it('falls back to the first fleet vehicle when no prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [{ id: 7 }, { id: 8 }] });
    renderWidget({ cols: 2, rows: 1 });
    expect(lastQueryOptions().queryKey[1]).toBe(7);
  });

  it('disables the query when the fleet is empty and no prop is given', () => {
    useVehiclesMock.mockReturnValue({ data: [] });
    renderWidget({ cols: 2, rows: 1 });
    const opts = lastQueryOptions();
    expect(opts.queryKey[1]).toBe(0);
    expect(opts.enabled).toBe(false);
  });

  it('fetches the snake_case security endpoint with NO /api/v1 prefix', async () => {
    renderWidget({ cols: 3, rows: 2 }, 42);
    await lastQueryOptions().queryFn();
    expect(requestMock).toHaveBeenCalledWith('/security?vehicle_id=42&limit=10');
  });

  it('scales the event limit with the widget size (wide 10 / tall 7 / small 4)', () => {
    renderWidget({ cols: 3, rows: 2 }, 5);
    expect(lastQueryOptions().queryKey[2]).toBe('sentry-log-10');

    renderWidget({ cols: 2, rows: 2 }, 5);
    expect(lastQueryOptions().queryKey[2]).toBe('sentry-log-7');

    renderWidget({ cols: 1, rows: 1 }, 5);
    expect(lastQueryOptions().queryKey[2]).toBe('sentry-log-4');
  });
});

// ── Render states ────────────────────────────────────────────────────────────

describe('SentryEventLogWidget — states', () => {
  it('renders a loading skeleton while the query is pending', () => {
    useQueryMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No security events recorded')).toBeNull();
  });

  it('shows the empty state when there are no events', () => {
    useQueryMock.mockReturnValue(makeResult({ data: [] }));
    renderWidget();
    expect(screen.getByText('No security events recorded')).toBeInTheDocument();
  });

  it('shows a DISTINCT error message (never the misleading empty copy) on failure', () => {
    useQueryMock.mockReturnValue(makeResult({ isError: true, data: undefined }));
    renderWidget();
    expect(screen.getByText('Failed to load security events')).toBeInTheDocument();
    expect(screen.queryByText('No security events recorded')).toBeNull();
  });

  it('wires the freshness Refresh control back to refetch', () => {
    const refetch = vi.fn();
    useQueryMock.mockReturnValue(makeResult({ data: [], dataUpdatedAt: Date.now(), refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Populated feed ───────────────────────────────────────────────────────────

describe('SentryEventLogWidget — populated', () => {
  it('renders one row per event with its derived title', () => {
    useQueryMock.mockReturnValue(
      makeResult({
        data: [
          makeEvent({ id: 1, locked: false, ts: minsAgo(5), created_at: minsAgo(5) }),
          makeEvent({ id: 2, sentry_mode: 'Armed', ts: minsAgo(9), created_at: minsAgo(9) }),
        ],
      }),
    );
    renderWidget({ cols: 3, rows: 2 });
    expect(screen.getByText('Vehicle unlocked')).toBeInTheDocument();
    expect(screen.getByText('Sentry Mode activated')).toBeInTheDocument();
  });

  it('REGRESSION: an Off sentry event renders "deactivated", not "activated"', () => {
    useQueryMock.mockReturnValue(
      makeResult({
        data: [makeEvent({ id: 1, sentry_mode: 'Off', ts: minsAgo(3), created_at: minsAgo(3) })],
      }),
    );
    renderWidget({ cols: 3, rows: 2 });
    expect(screen.getByText('Sentry Mode deactivated')).toBeInTheDocument();
    expect(screen.queryByText('Sentry Mode activated')).toBeNull();
  });

  it('shows the subtitle on a wide widget but hides it when narrow', () => {
    const data = [
      makeEvent({ id: 1, locked: true, sentry_mode: 'Armed', ts: minsAgo(4), created_at: minsAgo(4) }),
    ];
    useQueryMock.mockReturnValue(makeResult({ data }));

    const wide = renderWidget({ cols: 3, rows: 2 });
    expect(screen.getByText(/🛡️ Sentry On/)).toBeInTheDocument();
    wide.unmount();

    renderWidget({ cols: 2, rows: 2 });
    expect(screen.queryByText(/🛡️ Sentry On/)).toBeNull();
    // The primary title still renders in the narrow variant.
    expect(screen.getByText('Sentry Mode activated')).toBeInTheDocument();
  });

  it('orders the feed newest-first', () => {
    useQueryMock.mockReturnValue(
      makeResult({
        data: [
          makeEvent({ id: 1, locked: true, ts: minsAgo(60), created_at: minsAgo(60) }),
          makeEvent({ id: 2, locked: false, ts: minsAgo(5), created_at: minsAgo(5) }),
        ],
      }),
    );
    renderWidget({ cols: 3, rows: 2 });
    const newest = screen.getByText('Vehicle unlocked');
    const oldest = screen.getByText('Vehicle locked');
    // The newest event's node must precede the oldest one in document order.
    expect(newest.compareDocumentPosition(oldest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('hides the decorative row icons from the accessibility tree', () => {
    useQueryMock.mockReturnValue(
      makeResult({
        data: [
          makeEvent({ id: 1, locked: true, ts: minsAgo(3), created_at: minsAgo(3) }),
          makeEvent({ id: 2, locked: false, ts: minsAgo(6), created_at: minsAgo(6) }),
          makeEvent({ id: 3, sentry_mode: 'Armed', ts: minsAgo(9), created_at: minsAgo(9) }),
        ],
      }),
    );
    const { container } = renderWidget({ cols: 3, rows: 2 });
    // One aria-hidden icon per row (plus the header icon).
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThanOrEqual(3);
  });
});
