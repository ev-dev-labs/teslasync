/**
 * DrivingPerformanceCards — behaviour + hardening coverage.
 *
 * Single export: <DrivingPerformanceCards>. It renders the six-tile KPI band
 * at the top of the Driving analytics tab. Every tile is fed from the shared
 * `FleetAnalyticsQuery` (the page's `useFleetAnalytics()` result) and must:
 *   - show a stable skeleton band while the fleet query is loading,
 *   - convert the backend's km / km·h⁻¹ aggregates into the user's display
 *     unit (km vs mi, km/h vs mph) via the real `@/lib/unitConversion`
 *     helpers threaded through `useUnits()`,
 *   - never blank out — each tile falls back to an em-dash placeholder when
 *     its stat is missing (undefined data, an errored query, or a payload
 *     that simply doesn't carry that stat, as is the case today for the
 *     driving power / regen aggregates),
 *   - clamp non-finite values to 0 through the `safe()` guard rather than
 *     rendering "NaN".
 *
 * Facets covered:
 *   1. LOADING     — a six-tile skeleton band renders, no metric labels leak,
 *                    and the labelled group is not yet present.
 *   2. METRIC      — all six tiles render with km/(km·h⁻¹) values + unit
 *                    subtitles when the user prefers metric units.
 *   3. IMPERIAL    — the same payload is converted to mph / mi (and power /
 *                    regen stay in kW, un-converted) when the user prefers
 *                    imperial units.
 *   4. EMPTY       — a resolved payload whose `drive_analytics` carries no
 *                    stats degrades every tile to the em-dash placeholder
 *                    while keeping all six labels + unit subtitles visible.
 *   5. ERROR       — an errored query (data undefined) degrades identically,
 *                    never a blank band.
 *   6. PARTIAL     — only the tiles whose stat is present show a value; the
 *                    rest independently fall back to the placeholder.
 *   7. SAFE        — a non-finite stat value renders "0", not "NaN", while a
 *                    sibling finite value in the same stat still converts.
 *   8. A11Y        — the band is exposed as a labelled group with one icon
 *                    per tile.
 *
 * `react-i18next` is stubbed to the English fallback so visible copy is
 * deterministic. `@/hooks/useSettings` (the source `useUnits()` reads for the
 * unit preference) is mocked per-test so metric/imperial can be toggled; the
 * real conversion + formatting libs run underneath so the asserted numbers are
 * genuine. No network is touched — the query result is passed in as a prop.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { FleetAnalytics, StatsSummary } from '@/api/types';
import type { FleetAnalyticsQuery } from './constants';

const { mockUseSettings } = vi.hoisted(() => ({ mockUseSettings: vi.fn() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, def?: string) => def ?? _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return { ...actual, useSettings: mockUseSettings };
});

import { DrivingPerformanceCards } from './DrivingPerformanceCards';

const EM_DASH = '\u2014';

const LABELS = {
  topSpeed: 'Top Speed',
  avgSpeed: 'Avg Speed',
  peakPower: 'Peak Power',
  peakRegen: 'Peak Regen',
  avgDriveDist: 'Avg Drive Distance',
  longestDrive: 'Longest Drive',
} as const;

/** Minimal settings bag — `useUnits()` only reads these five fields. */
function settingsFor(length: 'km' | 'mi') {
  return {
    settings: {
      unit_of_length: length,
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      locale: 'en-US',
      decimal_precision: 2,
    },
  };
}

function stat(partial: Partial<StatsSummary>): StatsSummary {
  return { min: 0, max: 0, avg: 0, median: 0, p95: 0, count: 0, ...partial };
}

/** Build a query result carrying only the drive-analytics stats we exercise. */
function queryWith(driveAnalytics: Record<string, StatsSummary>): FleetAnalyticsQuery {
  const data = { drive_analytics: driveAnalytics } as unknown as FleetAnalytics;
  return { data, isLoading: false, isError: false, error: null } as unknown as FleetAnalyticsQuery;
}

const FULL_STATS: Record<string, StatsSummary> = {
  speed_stats: stat({ max: 200, avg: 65 }),
  power_stats: stat({ max: 250 }),
  regen_stats: stat({ max: 80 }),
  distance_stats: stat({ avg: 42.5, max: 128.3 }),
};

/** Read the value + subtitle rendered inside the tile carrying `label`. */
function readTile(label: string): { value: string; subtitle: string } {
  const labelNode = screen.getByText(label);
  const column = labelNode.closest('div');
  if (!column) throw new Error(`no tile column for "${label}"`);
  const paragraphs = Array.from(column.querySelectorAll('p'));
  return {
    value: paragraphs[1]?.textContent?.trim() ?? '',
    subtitle: paragraphs[2]?.textContent?.trim() ?? '',
  };
}

beforeEach(() => {
  mockUseSettings.mockReturnValue(settingsFor('km'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DrivingPerformanceCards', () => {
  it('renders a six-tile skeleton band while loading and withholds the metric group', () => {
    const query = { data: undefined, isLoading: true } as unknown as FleetAnalyticsQuery;
    const { container } = render(<DrivingPerformanceCards query={query} />);

    // MetricBandSkeleton count={6} → 6 tiles × 2 skeleton bars each.
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(12);
    // No real tile content leaks while loading…
    expect(screen.queryByText(LABELS.topSpeed)).not.toBeInTheDocument();
    // …and the labelled data group only appears once data resolves.
    expect(screen.queryByRole('group')).not.toBeInTheDocument();
  });

  it('renders all six tiles with metric values and unit subtitles', () => {
    render(<DrivingPerformanceCards query={queryWith(FULL_STATS)} />);

    // Speed: km/h passes straight through the km/h→km/h conversion.
    expect(readTile(LABELS.topSpeed)).toEqual({ value: '200', subtitle: 'km/h' });
    expect(readTile(LABELS.avgSpeed)).toEqual({ value: '65', subtitle: 'km/h' });
    // Power / regen are already kW and are not unit-converted.
    expect(readTile(LABELS.peakPower)).toEqual({ value: '250', subtitle: 'kW' });
    expect(readTile(LABELS.peakRegen)).toEqual({ value: '80', subtitle: 'kW' });
    // Distance: km→km at one decimal.
    expect(readTile(LABELS.avgDriveDist)).toEqual({ value: '42.5', subtitle: 'km' });
    expect(readTile(LABELS.longestDrive)).toEqual({ value: '128.3', subtitle: 'km' });
  });

  it('converts speed to mph and distance to mi when the user prefers imperial units', () => {
    mockUseSettings.mockReturnValue(settingsFor('mi'));
    render(<DrivingPerformanceCards query={queryWith(FULL_STATS)} />);

    // 200 km/h → 124.27 mph (0 dp); 65 km/h → 40.39 mph.
    expect(readTile(LABELS.topSpeed)).toEqual({ value: '124', subtitle: 'mph' });
    expect(readTile(LABELS.avgSpeed)).toEqual({ value: '40', subtitle: 'mph' });
    // 42.5 km → 26.41 mi (1 dp); 128.3 km → 79.72 mi.
    expect(readTile(LABELS.avgDriveDist)).toEqual({ value: '26.4', subtitle: 'mi' });
    expect(readTile(LABELS.longestDrive)).toEqual({ value: '79.7', subtitle: 'mi' });
    // Power / regen are unit-agnostic — unchanged across unit systems.
    expect(readTile(LABELS.peakPower)).toEqual({ value: '250', subtitle: 'kW' });
    expect(readTile(LABELS.peakRegen)).toEqual({ value: '80', subtitle: 'kW' });
  });

  it('degrades every tile to a placeholder (never a blank band) when the payload carries no stats', () => {
    render(<DrivingPerformanceCards query={queryWith({})} />);

    // Six tiles, six placeholders — but every label + unit subtitle stays.
    expect(screen.getAllByText(EM_DASH)).toHaveLength(6);
    Object.values(LABELS).forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    // The subtitles still describe the (metric) units under the placeholders.
    expect(readTile(LABELS.topSpeed)).toEqual({ value: EM_DASH, subtitle: 'km/h' });
    expect(readTile(LABELS.avgDriveDist)).toEqual({ value: EM_DASH, subtitle: 'km' });
  });

  it('degrades gracefully on an errored query with no data', () => {
    const query = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
    } as unknown as FleetAnalyticsQuery;
    render(<DrivingPerformanceCards query={query} />);

    // Error path resolves to the same six-placeholder band, still labelled.
    expect(screen.getAllByText(EM_DASH)).toHaveLength(6);
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getByText(LABELS.longestDrive)).toBeInTheDocument();
  });

  it('resolves each tile independently — present stats render, absent ones fall back', () => {
    render(<DrivingPerformanceCards query={queryWith({ speed_stats: stat({ max: 200, avg: 65 }) })} />);

    // Speed tiles have data…
    expect(readTile(LABELS.topSpeed).value).toBe('200');
    expect(readTile(LABELS.avgSpeed).value).toBe('65');
    // …while the four tiles without a backing stat fall back.
    expect(readTile(LABELS.peakPower).value).toBe(EM_DASH);
    expect(readTile(LABELS.peakRegen).value).toBe(EM_DASH);
    expect(readTile(LABELS.avgDriveDist).value).toBe(EM_DASH);
    expect(readTile(LABELS.longestDrive).value).toBe(EM_DASH);
    expect(screen.getAllByText(EM_DASH)).toHaveLength(4);
  });

  it('clamps a non-finite stat value to 0 via safe() instead of rendering NaN', () => {
    render(
      <DrivingPerformanceCards
        query={queryWith({ speed_stats: stat({ max: Number.NaN, avg: 50 }) })}
      />,
    );

    // safe(NaN) → 0; the sibling finite value in the same stat still converts.
    expect(readTile(LABELS.topSpeed).value).toBe('0');
    expect(readTile(LABELS.topSpeed).value).not.toContain('NaN');
    expect(readTile(LABELS.avgSpeed).value).toBe('50');
  });

  it('exposes the band as a labelled group with one decorative icon per tile', () => {
    const { container } = render(<DrivingPerformanceCards query={queryWith(FULL_STATS)} />);

    const group = screen.getByRole('group', { name: /driving performance metrics/i });
    expect(group).toHaveAttribute('aria-label', 'Driving performance metrics');
    // All six labels live inside the single labelled group…
    Object.values(LABELS).forEach((label) => {
      expect(within(group).getByText(label)).toBeInTheDocument();
    });
    // …and each tile carries exactly one (lucide) icon.
    expect(container.querySelectorAll('svg')).toHaveLength(6);
  });
});
