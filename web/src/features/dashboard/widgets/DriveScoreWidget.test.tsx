/**
 * DriveScoreWidget — comprehensive unit + integration coverage.
 *
 * Exercises every export of DriveScoreWidget.tsx:
 *   - `driveScoreFromEfficiency` — the pure Wh/km → 0..100 score derivation,
 *     including the clamp-at-100 case and the non-finite / non-positive guards
 *     it was hardened against (a partial payload's NaN/Infinity, or a
 *     no-drives-yet 0 that must never surface as a real "worst" score);
 *   - `scoreColor` — the three-band accent selector (all boundaries);
 *   - `toEfficiencyDisplay` — the SI-Wh/km → user-unit converter (km passthrough,
 *     the miles multiply, and the non-finite → 0 guard); and
 *   - the default widget component across every render branch: the full gauge
 *     view, the compact 1×1 variant (stat suppressed), the empty state for
 *     null / zero-efficiency / non-finite payloads, the loading skeleton, the
 *     keep-last-data-on-error resilience path, and the manual-refresh
 *     interaction. Also pins the trailing-7-day analytics contract.
 *
 * Strategy (mirrors the repo convention, e.g. BatteryCellsWidget.test.tsx and
 * ChargeStatusLiveWidget.test.tsx):
 *   - The single data hook (`useFleetAnalytics`) is replaced with a hoisted
 *     `vi.fn()` double so the network is never touched and every render is
 *     deterministic.
 *   - `react-i18next` is stubbed to resolve the developer fallback string (and
 *     interpolate `{{vars}}`) so assertions read the real English copy.
 *   - The global test-setup already mocks `useSettings` (km / °C), which
 *     `useUnits` reads — that is why efficiency renders in "Wh/km" and the
 *     km→display passthrough is exercised by the render tests, while the miles
 *     branch is covered directly through the pure `toEfficiencyDisplay`.
 *   - `matchMedia` is stubbed before any import runs because <DataFreshness>'s
 *     `useMotionPreference` (rendered transitively by <WidgetShell>) touches it
 *     on first paint and jsdom does not provide it.
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

// Hoisted hook double — the network boundary. Never hit real endpoints.
const { fleetAnalyticsMock } = vi.hoisted(() => ({ fleetAnalyticsMock: vi.fn() }));

vi.mock('@/api/hooks/useAnalytics', () => ({ useFleetAnalytics: fleetAnalyticsMock }));

import DriveScoreWidget, {
  driveScoreFromEfficiency,
  scoreColor,
  toEfficiencyDisplay,
} from './DriveScoreWidget';
import type { WidgetSize } from './types';

// ── Fixtures ───────────────────────────────────────────────────────────────
const SIZE_COMPACT: WidgetSize = { cols: 1, rows: 1 };
const SIZE_STANDARD: WidgetSize = { cols: 1, rows: 2 };

interface Analytics {
  avg_efficiency_wh_km: number;
}

interface QueryOverrides {
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function makeQuery(data?: Partial<Analytics>, over: QueryOverrides = {}) {
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

function renderWidget(node: ReactElement) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  fleetAnalyticsMock.mockReset();
  // Sensible default: a real 7-day window whose 320 Wh/km ⇒ a score of 78.
  fleetAnalyticsMock.mockReturnValue(makeQuery({ avg_efficiency_wh_km: 320 }));
});

// ── driveScoreFromEfficiency (pure) ──────────────────────────────────────────
describe('driveScoreFromEfficiency', () => {
  it('maps consumption to a 0..100 score, clamping frugal drives at 100', () => {
    expect(driveScoreFromEfficiency(250)).toBe(100); // reference ⇒ perfect
    expect(driveScoreFromEfficiency(500)).toBe(50); // half as efficient
    expect(driveScoreFromEfficiency(1000)).toBe(25);
    expect(driveScoreFromEfficiency(400)).toBe(63); // 62.5 rounds up
    expect(driveScoreFromEfficiency(125)).toBe(100); // 200 clamped to 100
  });

  it('returns 0 (⇒ "no score") for non-positive or non-finite input', () => {
    expect(driveScoreFromEfficiency(0)).toBe(0);
    expect(driveScoreFromEfficiency(-250)).toBe(0);
    expect(driveScoreFromEfficiency(Number.NaN)).toBe(0);
    expect(driveScoreFromEfficiency(Number.POSITIVE_INFINITY)).toBe(0);
    expect(driveScoreFromEfficiency(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

// ── scoreColor (pure) ────────────────────────────────────────────────────────
describe('scoreColor', () => {
  it('selects green / amber / red by band with the correct boundaries', () => {
    expect(scoreColor(100)).toBe('#10b981'); // green
    expect(scoreColor(76)).toBe('#10b981');
    expect(scoreColor(75)).toBe('#f59e0b'); // boundary is strict >75 → amber
    expect(scoreColor(51)).toBe('#f59e0b');
    expect(scoreColor(50)).toBe('#ef4444'); // boundary is strict >50 → red
    expect(scoreColor(0)).toBe('#ef4444');
  });
});

// ── toEfficiencyDisplay (pure) ───────────────────────────────────────────────
describe('toEfficiencyDisplay', () => {
  it('passes Wh/km through for metric and multiplies by km-per-mile for miles', () => {
    expect(toEfficiencyDisplay(200, false)).toBe(200);
    expect(toEfficiencyDisplay(200, true)).toBeCloseTo(321.8688, 4);
  });

  it('collapses non-finite input to 0 so the stat never renders NaN', () => {
    expect(toEfficiencyDisplay(Number.NaN, false)).toBe(0);
    expect(toEfficiencyDisplay(Number.POSITIVE_INFINITY, true)).toBe(0);
    expect(toEfficiencyDisplay(0, false)).toBe(0);
  });
});

// ── Widget render states ─────────────────────────────────────────────────────
describe('DriveScoreWidget', () => {
  it('renders the score gauge and the efficiency stat at standard size', () => {
    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    // 320 Wh/km ⇒ round(250/320*100) = 78.
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    // Efficiency stat: label, km-passthrough value, and the Wh/km unit.
    expect(screen.getByText('Efficiency')).toBeInTheDocument();
    expect(screen.getByText('320')).toBeInTheDocument();
    expect(screen.getByText('Wh/km')).toBeInTheDocument();
    // Not the empty state.
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
  });

  it('requests the trailing 7-day analytics window', () => {
    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);
    expect(fleetAnalyticsMock).toHaveBeenCalledWith(7);
  });

  it('suppresses the efficiency stat in the compact 1×1 layout', () => {
    renderWidget(<DriveScoreWidget size={SIZE_COMPACT} />);

    // The gauge essentials still render...
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
    // ...but the compact hero omits the stat row entirely.
    expect(screen.queryByText('Efficiency')).not.toBeInTheDocument();
    expect(screen.queryByText('320')).not.toBeInTheDocument();
  });

  it('renders the empty state (role=status) when analytics is absent', () => {
    fleetAnalyticsMock.mockReturnValue(makeQuery(undefined));

    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Score')).not.toBeInTheDocument();
  });

  it('shows the empty state (not a misleading red 0/100 gauge) when there are no drives yet', () => {
    // Analytics is present but the window has no drives ⇒ efficiency 0. A real
    // drive can never score 0, so this must read as "no data", not a 0 score.
    fleetAnalyticsMock.mockReturnValue(makeQuery({ avg_efficiency_wh_km: 0 }));

    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByText('Score')).not.toBeInTheDocument();
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('treats a non-finite efficiency payload as no score', () => {
    fleetAnalyticsMock.mockReturnValue(
      makeQuery({ avg_efficiency_wh_km: Number.NaN }),
    );

    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    expect(screen.getByText('No data yet')).toBeInTheDocument();
    expect(screen.queryByText('Score')).not.toBeInTheDocument();
  });

  it('renders a loading skeleton with no gauge or empty state while first fetching', () => {
    fleetAnalyticsMock.mockReturnValue(makeQuery(undefined, { isLoading: true }));

    const { container } = renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    expect(container.querySelector('.animate-pulse')).toBeTruthy();
    expect(screen.queryByText('Score')).not.toBeInTheDocument();
    expect(screen.queryByText('No data yet')).not.toBeInTheDocument();
  });

  it('keeps the gauge on a background-refetch error (never blanks a live widget)', () => {
    fleetAnalyticsMock.mockReturnValue(
      makeQuery({ avg_efficiency_wh_km: 320 }, { isError: true }),
    );

    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    // Last-known score is retained despite the error flag.
    expect(screen.getByText('78')).toBeInTheDocument();
    expect(screen.getByText('Score')).toBeInTheDocument();
  });

  it('falls back to the empty state on error when no data is present', () => {
    fleetAnalyticsMock.mockReturnValue(makeQuery(undefined, { isError: true }));

    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    expect(screen.getByText('No data yet')).toBeInTheDocument();
  });

  it('invokes refetch when the freshness/refresh control is activated', () => {
    const refetch = vi.fn();
    fleetAnalyticsMock.mockReturnValue(
      makeQuery(
        { avg_efficiency_wh_km: 320 },
        { refetch, isFetching: false, dataUpdatedAt: Date.now() },
      ),
    );

    renderWidget(<DriveScoreWidget size={SIZE_STANDARD} />);

    const refreshBtn = screen.getByRole('button', { name: /refresh/i });
    fireEvent.click(refreshBtn);

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
