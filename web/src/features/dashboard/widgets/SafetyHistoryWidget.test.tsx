/**
 * SafetyHistoryWidget — behaviour + hardening tests.
 *
 * SafetyHistoryWidget is a dashboard tile that resolves a target vehicle
 * (`vehicleId` prop → first vehicle from `useVehicles` → undefined) and reads
 * that vehicle's safety-snapshot history (`useSafetyHistory`). It renders one
 * of two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → a single line: the 30-day event count (or a "no
 *                            events" note) plus the most-common type + trend.
 *   - standard (cols > 1) → a 3-up stat strip (Events 30d / Most Common / Trend)
 *                            over a `WidgetEventFeed` of classified snapshots.
 * The shell owns the loading skeleton, the error `QueryError`, and the freshness
 * / refresh affordance; the body is never a blank panel — an explicit
 * `EmptyState` stands in whenever there is no history.
 *
 * The pure helpers (`classifySnapshot`, `safetyEventTitle`, `safetyTypeLabel`,
 * `buildSubtitle`) are exported and unit-tested directly. The two data hooks are
 * mocked at their module boundaries so every orchestration branch is
 * deterministic and the network is never touched. `react-i18next` is echo-mocked
 * (returns the English fallback, interpolating `{{var}}`); `useSettings` /
 * `useTimezone` come from the global stub in src/test-setup.ts. `matchMedia`
 * reports reduced-motion so the freshness chip settles synchronously.
 *
 * Regressions locked in by these tests (the point of the elevation):
 *   R1 — a fetch error surfaces the `QueryError` panel ("Can't reach server"),
 *        NOT the misleading "No safety events recorded" empty state (the widget
 *        used to swallow `error` and render an empty panel).
 *   R2 — `buildSubtitle` funnels the enum advisory fields through
 *        `cleanSafetyEnum`, so a raw `SpeedAssistLevelChime` / `FollowDistance3`
 *        value is rendered as "Chime" / "3" and never leaks verbatim.
 *   R3 — `classifySnapshot` uses `isSafetyEnumActive`, so an *inactive* enum
 *        string ("…Off") is NOT classified as an active warning.
 *
 * Facets covered:
 *   - classifySnapshot: every branch, precedence, and the active-vs-inactive
 *     enum discrimination.
 *   - safetyEventTitle / safetyTypeLabel: every type + translator wiring.
 *   - buildSubtitle: enum cleaning, boolean → On/Off, pin-to-drive, join + the
 *     "—" fallback.
 *   - shell states: loading skeleton, error QueryError, and both empty paths —
 *     never a blank panel.
 *   - populated: compact single-line summary; standard stat strip + feed with
 *     cleaned subtitles; trend arrows (↑/↓) + their sublabels.
 *   - vehicle resolution: explicit prop wins → first vehicle fallback.
 *   - refresh wiring: the freshness control invokes the query refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data hooks are mocked so the widget's inputs are deterministic.
vi.mock('@/api/hooks/useVehicleSystems', async (importActual) => {
  const actual =
    await importActual<typeof import('@/api/hooks/useVehicleSystems')>();
  return { ...actual, useSafetyHistory: vi.fn() };
});
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useVehicles: vi.fn() };
});

// jsdom lacks matchMedia; useMotionPreference (via <DataFreshness>) reads it.
// Report reduced-motion so the freshness chip settles on its final visual.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import SafetyHistoryWidget, {
  classifySnapshot,
  safetyEventTitle,
  safetyTypeLabel,
  buildSubtitle,
} from './SafetyHistoryWidget';
import { useSafetyHistory } from '@/api/hooks/useVehicleSystems';
import { useVehicles } from '@/api/hooks/useVehicles';
import type { SafetySnapshot } from '@/types/vehicle-systems';
import type { WidgetProps, WidgetSize } from './types';

const mockSafety = vi.mocked(useSafetyHistory);
const mockVehicles = vi.mocked(useVehicles);

/** Echo translator matching the `(key, fallback)` overload — returns fallback. */
const echo = (_k: string, fb: string) => fb;

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

const NOW = Date.now();
const daysAgo = (d: number) => new Date(NOW - d * 24 * 60 * 60 * 1000).toISOString();

function snap(over: Partial<SafetySnapshot> = {}): SafetySnapshot {
  return { id: 1, vehicle_id: 7, created_at: daysAgo(1), ...over };
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SafetyHistoryWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockVehicles.mockReturnValue(qr({ data: [{ id: 7 }] }));
  mockSafety.mockReturnValue(qr({ data: [] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// ── Pure helper: classifySnapshot ──────────────────────────────────────────

describe('classifySnapshot', () => {
  it('classifies each dominant safety field with the right type/colour/severity', () => {
    expect(classifySnapshot({ automatic_emergency_braking_off: true })).toMatchObject({
      type: 'aeb',
      color: '#ef4444',
      severity: 'critical',
    });
    expect(
      classifySnapshot({ forward_collision_warning: 'ForwardCollisionSensitivityLate' }),
    ).toMatchObject({ type: 'fcw', color: '#f59e0b', severity: 'warning' });
    expect(
      classifySnapshot({ lane_departure_avoidance: 'LaneAssistLevelWarning' }),
    ).toMatchObject({ type: 'lane', color: '#3b82f6', severity: 'warning' });
    expect(classifySnapshot({ blind_spot_collision_warning: true })).toMatchObject({
      type: 'bsw',
      severity: 'warning',
    });
    expect(
      classifySnapshot({ emergency_lane_departure_avoidance: true }),
    ).toMatchObject({ type: 'elda', color: '#ef4444', severity: 'critical' });
  });

  it('falls back to a neutral "general" event for an empty snapshot', () => {
    const cls = classifySnapshot({});
    expect(cls.type).toBe('general');
    expect(cls.color).toBe('#6b7280');
    expect(cls.severity).toBe('info');
  });

  it('resolves precedence highest-severity-first (AEB wins over FCW)', () => {
    const cls = classifySnapshot({
      automatic_emergency_braking_off: true,
      forward_collision_warning: 'ForwardCollisionSensitivityLate',
    });
    expect(cls.type).toBe('aeb');
  });

  it('treats an INACTIVE enum string ("…Off") as not-a-warning (R3)', () => {
    // A naive `!!value` check would wrongly flag the non-empty "…Off" string.
    expect(
      classifySnapshot({ forward_collision_warning: 'ForwardCollisionSensitivityOff' }).type,
    ).toBe('general');
    expect(
      classifySnapshot({ lane_departure_avoidance: 'LaneAssistLevelOff' }).type,
    ).toBe('general');
  });
});

// ── Pure helper: safetyEventTitle ──────────────────────────────────────────

describe('safetyEventTitle', () => {
  it('maps each type to its title, appending the cleaned enum for FCW/lane', () => {
    expect(safetyEventTitle('aeb', {}, echo)).toBe('AEB Activation');
    expect(safetyEventTitle('bsw', {}, echo)).toBe('Blind Spot Warning');
    expect(safetyEventTitle('elda', {}, echo)).toBe('Emergency Lane Departure Avoidance');
    expect(safetyEventTitle('general', {}, echo)).toBe('Safety State Update');
    expect(
      safetyEventTitle('fcw', { forward_collision_warning: 'ForwardCollisionSensitivityLate' }, echo),
    ).toBe('FCW: Late');
    expect(
      safetyEventTitle('lane', { lane_departure_avoidance: 'LaneAssistLevelWarning' }, echo),
    ).toBe('Lane Departure: Warning');
  });

  it('resolves the title through the provided translator', () => {
    const t = vi.fn((_k: string, fb: string) => fb);
    safetyEventTitle('aeb', {}, t);
    expect(t).toHaveBeenCalledWith('widget.safety.aeb', 'AEB Activation');
  });
});

// ── Pure helper: safetyTypeLabel ───────────────────────────────────────────

describe('safetyTypeLabel', () => {
  it('maps each type to its short label', () => {
    expect(safetyTypeLabel('aeb', echo)).toBe('AEB');
    expect(safetyTypeLabel('fcw', echo)).toBe('FCW');
    expect(safetyTypeLabel('lane', echo)).toBe('Lane Departure');
    expect(safetyTypeLabel('bsw', echo)).toBe('Blind Spot');
    expect(safetyTypeLabel('elda', echo)).toBe('Emergency Lane');
    expect(safetyTypeLabel('general', echo)).toBe('General');
  });

  it('resolves the label through the provided translator', () => {
    const t = vi.fn((_k: string, fb: string) => fb);
    expect(safetyTypeLabel('lane', t)).toBe('Lane Departure');
    expect(t).toHaveBeenCalledWith('widget.safety.laneShort', 'Lane Departure');
  });
});

// ── Pure helper: buildSubtitle ─────────────────────────────────────────────

describe('buildSubtitle', () => {
  it('cleans raw enum advisories rather than leaking them verbatim (R2)', () => {
    const out = buildSubtitle(
      {
        speed_limit_warning: 'SpeedAssistLevelChime',
        cruise_follow_distance: 'FollowDistance3',
        pin_to_drive_enabled: true,
      },
      echo,
    );
    expect(out).toBe('Speed Limit: Chime · Follow: 3 · PIN to Drive');
    expect(out).not.toContain('SpeedAssistLevel');
    expect(out).not.toContain('FollowDistance');
  });

  it('renders a boolean advisory as On/Off (never "true"/"false")', () => {
    const out = buildSubtitle({ speed_limit_warning: false }, echo);
    expect(out).toBe('Speed Limit: Off');
    expect(out).not.toContain('false');
  });

  it('omits pin-to-drive when disabled and falls back to "—" when empty', () => {
    expect(buildSubtitle({ pin_to_drive_enabled: false }, echo)).toBe('—');
    expect(buildSubtitle({}, echo)).toBe('—');
  });

  it('joins multiple present advisories with a middot separator', () => {
    const out = buildSubtitle(
      { speed_limit_warning: 'SpeedAssistLevelChime', cruise_follow_distance: 2 },
      echo,
    );
    expect(out).toBe('Speed Limit: Chime · Follow: 2');
  });
});

// ── Widget: shell states ───────────────────────────────────────────────────

describe('SafetyHistoryWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) and no rows while loading', () => {
    mockSafety.mockReturnValue(qr({ isLoading: true, isFetching: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Safety History')).toBeNull();
    expect(screen.queryByText('AEB Activation')).toBeNull();
  });

  it('surfaces a QueryError (not a misleading empty state) on failure (R1)', () => {
    mockSafety.mockReturnValue(
      qr({ isError: true, error: new Error('safety down'), data: undefined }),
    );
    renderWidget(STANDARD);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    // The pre-fix behaviour was to render this empty state on error.
    expect(screen.queryByText('No safety events recorded')).toBeNull();
    expect(screen.queryByText('Safety History')).toBeNull();
  });

  it('renders the title + explicit empty state when there is no history (standard)', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('Safety History')).toBeInTheDocument();
    // Stat strip still renders (sections never disappear) …
    expect(screen.getByText('Events (30d)')).toBeInTheDocument();
    expect(screen.getByText('Most Common')).toBeInTheDocument();
    // … and the feed shows an empty state rather than a blank panel.
    expect(screen.getByText('No safety events recorded')).toBeInTheDocument();
  });

  it('renders the compact empty note when there is no history (compact)', () => {
    renderWidget(COMPACT);

    expect(screen.getByText('No safety events recorded')).toBeInTheDocument();
  });

  it('is resilient when the query resolves to undefined data', () => {
    mockSafety.mockReturnValue(qr({ data: undefined }));
    renderWidget(STANDARD);

    expect(screen.getByText('Safety History')).toBeInTheDocument();
    expect(screen.getByText('No safety events recorded')).toBeInTheDocument();
  });
});

// ── Widget: populated ──────────────────────────────────────────────────────

describe('SafetyHistoryWidget — compact layout', () => {
  it('summarises the 30-day count and most-common type on one line', () => {
    mockSafety.mockReturnValue(
      qr({
        data: [
          snap({ id: 1, automatic_emergency_braking_off: true, created_at: daysAgo(1) }),
          snap({ id: 2, automatic_emergency_braking_off: true, created_at: daysAgo(2) }),
        ],
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('2 events (30d)')).toBeInTheDocument();
    // most-common label ("AEB") + trend ("—") on the caption line.
    expect(screen.getByText(/AEB/)).toBeInTheDocument();
  });
});

describe('SafetyHistoryWidget — standard layout', () => {
  it('renders the stat strip and a feed row with a CLEANED subtitle (R2)', () => {
    mockSafety.mockReturnValue(
      qr({
        data: [
          snap({
            id: 1,
            automatic_emergency_braking_off: true,
            speed_limit_warning: 'SpeedAssistLevelChime',
            created_at: daysAgo(1),
          }),
        ],
      }),
    );
    renderWidget(STANDARD);

    // Stat strip.
    expect(screen.getByText('Events (30d)')).toBeInTheDocument();
    expect(screen.getByText('Most Common')).toBeInTheDocument();
    expect(screen.getByText('Trend')).toBeInTheDocument();
    expect(screen.getByText('AEB')).toBeInTheDocument(); // most-common value

    // Feed row: classified title + cleaned enum subtitle, never the raw string.
    expect(screen.getByText('AEB Activation')).toBeInTheDocument();
    expect(screen.getByText('Speed Limit: Chime')).toBeInTheDocument();
    expect(screen.queryByText(/SpeedAssistLevel/)).toBeNull();
  });

  it('shows an increasing trend (↑) with its sublabel', () => {
    mockSafety.mockReturnValue(
      qr({
        data: [
          snap({ id: 1, automatic_emergency_braking_off: true, created_at: daysAgo(1) }),
          snap({ id: 2, automatic_emergency_braking_off: true, created_at: daysAgo(2) }),
          snap({ id: 3, automatic_emergency_braking_off: true, created_at: daysAgo(45) }),
        ],
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('↑')).toBeInTheDocument();
    expect(screen.getByText('Increasing')).toBeInTheDocument();
  });

  it('shows a decreasing trend (↓) with its sublabel', () => {
    mockSafety.mockReturnValue(
      qr({
        data: [
          snap({ id: 1, automatic_emergency_braking_off: true, created_at: daysAgo(1) }),
          snap({ id: 2, automatic_emergency_braking_off: true, created_at: daysAgo(40) }),
          snap({ id: 3, automatic_emergency_braking_off: true, created_at: daysAgo(45) }),
        ],
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('↓')).toBeInTheDocument();
    expect(screen.getByText('Decreasing')).toBeInTheDocument();
  });
});

// ── Widget: vehicle resolution + refresh ───────────────────────────────────

describe('SafetyHistoryWidget — vehicle resolution', () => {
  it('uses the explicit vehicleId prop when provided', () => {
    renderWidget(STANDARD, { vehicleId: 42 });
    expect(mockSafety).toHaveBeenCalledWith('42');
  });

  it('falls back to the first vehicle when no prop is supplied', () => {
    renderWidget(STANDARD);
    expect(mockSafety).toHaveBeenCalledWith('7');
  });
});

describe('SafetyHistoryWidget — refresh wiring', () => {
  it('invokes the query refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockSafety.mockReturnValue(
      qr({
        data: [snap({ id: 1, automatic_emergency_braking_off: true })],
        refetch,
      }),
    );
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
