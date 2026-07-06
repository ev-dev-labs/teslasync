/**
 * RecentlyUnlockedAchievements — comprehensive unit + integration coverage.
 *
 * Exercises every export of RecentlyUnlockedAchievements.tsx:
 *   - `unlockedTs` — the pure `unlocked_at` ISO → sortable epoch-ms parser,
 *     including the null passthrough and the non-finite guard it was hardened
 *     against (a truthy-but-unparseable timestamp used to leak `NaN` into the
 *     newest-first comparator and silently scramble the strip order); and
 *   - the default widget across every render branch: the newest-first badge
 *     strip with its narrow (3) / wide (5) limit, the locked / undated
 *     exclusion, the vehicle-id resolution contract, the deep-link navigation
 *     (with URL encoding), the empty state (no unlocks / absent payload), the
 *     loading skeleton, the opt-out `showOnDashboard = false` empty state, the
 *     keep-last-data-on-error resilience path (the regression this elevation
 *     fixed — a background-refetch error must NOT blank a live widget), and the
 *     manual-refresh interaction.
 *
 * Strategy (mirrors the repo convention, e.g. DriveScoreWidget.test.tsx and
 * OdometerCounterWidget.test.tsx):
 *   - The three data sources (`useLifetimeStats`, `useVehicles`,
 *     `useAchievementCelebrationPrefs`) are replaced with hoisted `vi.fn()`
 *     doubles so the network / localStorage are never touched and every render
 *     is deterministic.
 *   - Only `useNavigate` is replaced on `react-router-dom`; `MemoryRouter`
 *     stays real (the badge buttons and <QueryError> need router context).
 *   - `react-i18next` is stubbed to resolve the developer fallback string (and
 *     interpolate `{{vars}}`) so assertions read the shipped English copy.
 *   - The real <AchievementBadge> renders so the strip is covered end-to-end.
 *   - `matchMedia` is stubbed before any import because <DataFreshness>'s
 *     `useMotionPreference` (rendered transitively by <WidgetShell>) reads it on
 *     first paint and jsdom does not provide it.
 *
 * `@testing-library/user-event` is intentionally NOT a dependency of this
 * codebase — interactions use `fireEvent`, consistent with the other slice
 * tests.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactElement } from 'react';

// jsdom lacks matchMedia; <DataFreshness>'s useMotionPreference reads it on
// first paint. Install a no-op (reduced-motion = false) BEFORE any import.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

// react-i18next passthrough — resolve the fallback (2nd arg) and interpolate
// `{{vars}}` from the options object so assertions read production copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, opts?: Record<string, unknown>) => {
      let out = typeof fallback === 'string' ? fallback : key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
  }),
}));

// Hoisted doubles — the data + navigation boundary. Never hit real endpoints.
const { lifetimeMock, vehiclesMock, prefsMock, navigateSpy } = vi.hoisted(() => ({
  lifetimeMock: vi.fn(),
  vehiclesMock: vi.fn(),
  prefsMock: vi.fn(),
  navigateSpy: vi.fn(),
}));

vi.mock('@/api/hooks/useAnalytics', () => ({ useLifetimeStats: lifetimeMock }));
vi.mock('@/api/hooks/useVehicles', () => ({ useVehicles: vehiclesMock }));
vi.mock('@/hooks/useAchievementCelebrationPrefs', () => ({
  useAchievementCelebrationPrefs: prefsMock,
}));

// Keep MemoryRouter / real router internals; spy only on the navigate fn so the
// deep-link contract is assertable.
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigateSpy };
});

import RecentlyUnlockedAchievementsWidget, {
  unlockedTs,
} from './RecentlyUnlockedAchievements';
import type { WidgetSize } from './types';
import type { AchievementCelebrationPrefs } from '@/hooks/useAchievementCelebrationPrefs';

// ── Fixtures ─────────────────────────────────────────────────────────────────
const SIZE_NARROW: WidgetSize = { cols: 1, rows: 2 };
const SIZE_WIDE: WidgetSize = { cols: 3, rows: 2 };

interface Achievement {
  id: string;
  name: string;
  description: string;
  icon: string;
  unlocked: boolean;
  unlocked_at: string | null;
  progress: number;
  target: number;
  current: number;
}

function makeAchievement(over: Partial<Achievement>): Achievement {
  return {
    id: 'ach',
    name: 'Achievement',
    description: 'A thing you did',
    icon: '🏆',
    unlocked: true,
    unlocked_at: '2026-01-01T00:00:00.000Z',
    progress: 1,
    target: 1,
    current: 1,
    ...over,
  };
}

interface LifetimeQueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeLifetimeQuery(
  achievements: Achievement[] | undefined,
  over: LifetimeQueryOverrides = {},
) {
  const data = achievements ? { achievements } : undefined;
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: data ? Date.now() : 0,
    refetch: vi.fn(),
    ...over,
  };
}

const DEFAULT_PREFS: AchievementCelebrationPrefs = {
  showToasts: true,
  playSound: false,
  showOnDashboard: true,
  pushOnUnlock: true,
};

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

// A well-spread, deliberately out-of-order set. Newest → oldest by unlocked_at:
// March, February, January, then December (previous year). The locked entry has
// no timestamp and must be excluded regardless of the `unlocked` flag.
const MARCH = makeAchievement({ id: 'm', name: 'March', unlocked_at: '2026-03-15T00:00:00.000Z' });
const FEBRUARY = makeAchievement({ id: 'f', name: 'February', unlocked_at: '2026-02-10T00:00:00.000Z' });
const JANUARY = makeAchievement({ id: 'j', name: 'January', unlocked_at: '2026-01-05T00:00:00.000Z' });
const DECEMBER = makeAchievement({ id: 'd', name: 'December', unlocked_at: '2025-12-20T00:00:00.000Z' });
const LOCKED = makeAchievement({ id: 'l', name: 'Locked One', unlocked: false, unlocked_at: null });

function badgeButtons() {
  return screen.getAllByRole('button', { name: /^View achievement:/ });
}

beforeEach(() => {
  lifetimeMock.mockReset();
  vehiclesMock.mockReset();
  prefsMock.mockReset();
  navigateSpy.mockReset();

  // Sensible defaults: one vehicle, prefs on, a populated lifetime payload.
  vehiclesMock.mockReturnValue({ data: [{ id: 7 }] });
  prefsMock.mockReturnValue(DEFAULT_PREFS);
  lifetimeMock.mockReturnValue(
    makeLifetimeQuery([JANUARY, MARCH, FEBRUARY, DECEMBER, LOCKED]),
  );
});

// ── unlockedTs (pure) ─────────────────────────────────────────────────────────
describe('unlockedTs', () => {
  it('parses an ISO timestamp to its epoch-ms value and orders chronologically', () => {
    expect(unlockedTs('2026-03-15T00:00:00.000Z')).toBe(
      Date.parse('2026-03-15T00:00:00.000Z'),
    );
    // Newer date ⇒ strictly larger value, so `b - a` sorts newest-first.
    expect(unlockedTs('2026-03-15T00:00:00.000Z')).toBeGreaterThan(
      unlockedTs('2026-01-05T00:00:00.000Z'),
    );
  });

  it('collapses a null or unparseable timestamp to 0 so the comparator never sees NaN', () => {
    expect(unlockedTs(null)).toBe(0);
    expect(unlockedTs('')).toBe(0);
    expect(unlockedTs('not-a-real-date')).toBe(0);
    expect(Number.isNaN(unlockedTs('garbage'))).toBe(false);
  });
});

// ── Widget: badge strip ───────────────────────────────────────────────────────
describe('RecentlyUnlockedAchievementsWidget', () => {
  it('renders unlocked badges newest-first, capped at 3 in the narrow layout, excluding locked/undated', () => {
    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    const buttons = badgeButtons();
    // 5 supplied → 1 locked excluded → top 3 by unlocked_at desc.
    expect(buttons).toHaveLength(3);
    expect(buttons[0]).toHaveAttribute('aria-label', 'View achievement: March');
    expect(buttons[1]).toHaveAttribute('aria-label', 'View achievement: February');
    expect(buttons[2]).toHaveAttribute('aria-label', 'View achievement: January');
    // December (4th newest) is dropped by the narrow limit; Locked is filtered out.
    expect(screen.queryByText('December')).not.toBeInTheDocument();
    expect(screen.queryByText('Locked One')).not.toBeInTheDocument();
  });

  it('raises the cap to 5 in a wide (cols >= 3) layout', () => {
    const many = [MARCH, FEBRUARY, JANUARY, DECEMBER].concat(
      makeAchievement({ id: 'n1', name: 'Nov', unlocked_at: '2025-11-01T00:00:00.000Z' }),
      makeAchievement({ id: 'o1', name: 'Oct', unlocked_at: '2025-10-01T00:00:00.000Z' }),
    );
    lifetimeMock.mockReturnValue(makeLifetimeQuery(many));

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_WIDE} />);

    // 6 unlocked → capped at 5; the oldest (Oct) is dropped.
    expect(badgeButtons()).toHaveLength(5);
    expect(screen.queryByText('Oct')).not.toBeInTheDocument();
    expect(screen.getByText('Nov')).toBeInTheDocument();
  });

  it('keeps an unparseable-but-unlocked badge in the strip and sorts it last (no crash, no scramble)', () => {
    const bad = makeAchievement({ id: 'x', name: 'BadDate', unlocked_at: 'not-a-date' });
    lifetimeMock.mockReturnValue(makeLifetimeQuery([bad, MARCH, JANUARY]));

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    const buttons = badgeButtons();
    expect(buttons).toHaveLength(3);
    // Valid dates keep their order; the NaN-guarded (⇒ 0) entry sinks to the end.
    expect(buttons[0]).toHaveAttribute('aria-label', 'View achievement: March');
    expect(buttons[1]).toHaveAttribute('aria-label', 'View achievement: January');
    expect(buttons[2]).toHaveAttribute('aria-label', 'View achievement: BadDate');
  });

  it('deep-links to the lifetime page with a URL-encoded achievement id on click', () => {
    lifetimeMock.mockReturnValue(
      makeLifetimeQuery([makeAchievement({ id: 'road warrior', name: 'Road Warrior' })]),
    );

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    fireEvent.click(screen.getByRole('button', { name: 'View achievement: Road Warrior' }));

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy).toHaveBeenCalledWith('/lifetime?achievement=road%20warrior');
  });

  it('resolves the vehicle id (prop override → first vehicle → none) for the lifetime query', () => {
    // Prop override wins.
    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} vehicleId={42} />);
    expect(lifetimeMock).toHaveBeenCalledWith('42');

    // No prop → first vehicle from useVehicles (id 7).
    lifetimeMock.mockClear();
    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);
    expect(lifetimeMock).toHaveBeenCalledWith('7');

    // No prop AND no vehicles → undefined (⇒ the all-vehicles endpoint).
    lifetimeMock.mockClear();
    vehiclesMock.mockReturnValue({ data: [] });
    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);
    expect(lifetimeMock).toHaveBeenCalledWith(undefined);
  });

  it('shows the empty state (role=status) when no achievements are unlocked yet', () => {
    lifetimeMock.mockReturnValue(makeLifetimeQuery([LOCKED]));

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    expect(
      screen.getByText(/achievements will appear here as you unlock them/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByTestId('recently-unlocked-list')).not.toBeInTheDocument();
  });

  it('shows the empty state (not a crash) when the lifetime payload is absent', () => {
    lifetimeMock.mockReturnValue(makeLifetimeQuery(undefined));

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    expect(
      screen.getByText(/achievements will appear here as you unlock them/i),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('recently-unlocked-list')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton with no strip or empty state while first fetching', () => {
    lifetimeMock.mockReturnValue(makeLifetimeQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByTestId('recently-unlocked-list')).not.toBeInTheDocument();
    expect(
      screen.queryByText(/achievements will appear here/i),
    ).not.toBeInTheDocument();
  });

  it('keeps the last-known strip on a background-refetch error (never blanks a live widget)', () => {
    // Data is present but a background refetch failed. The strip must survive —
    // the failure is signalled through the header freshness indicator only.
    lifetimeMock.mockReturnValue(
      makeLifetimeQuery([MARCH, JANUARY], { isError: true }),
    );

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    expect(screen.getByTestId('recently-unlocked-list')).toBeInTheDocument();
    expect(badgeButtons()).toHaveLength(2);
    expect(screen.getByText('March')).toBeInTheDocument();
  });

  it('renders the opt-out empty state (hiding the strip) when showOnDashboard is off', () => {
    prefsMock.mockReturnValue({ ...DEFAULT_PREFS, showOnDashboard: false });
    // Data is available, but the user opted the widget content out.
    lifetimeMock.mockReturnValue(makeLifetimeQuery([MARCH, FEBRUARY]));

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    expect(
      screen.getByText('Recently unlocked achievements are hidden in your settings.'),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('recently-unlocked-list')).not.toBeInTheDocument();
    expect(screen.queryByText('March')).not.toBeInTheDocument();
  });

  it('invokes refetch when the header refresh control is activated', () => {
    const refetch = vi.fn();
    lifetimeMock.mockReturnValue(
      makeLifetimeQuery([MARCH], { refetch, isFetching: false, dataUpdatedAt: Date.now() }),
    );

    renderWidget(<RecentlyUnlockedAchievementsWidget size={SIZE_NARROW} />);

    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
