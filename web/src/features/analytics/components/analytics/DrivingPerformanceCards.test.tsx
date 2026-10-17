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
 *   - keep missing/invalid readings unknown and require a recorded sample
 *     population without discarding measured zero or signed values.
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
 *   7. SAFE        — a non-finite stat value renders "—", not "NaN", while a
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
import { render, screen, within, cleanup, fireEvent } from '@testing-library/react';
import type { FleetAnalytics, StatsSummary } from '@/api/types';
import type { FleetAnalyticsQuery } from './constants';

const { mockUseSettings } = vi.hoisted(() => ({ mockUseSettings: vi.fn() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, def?: string, opts?: Record<string, unknown>) =>
        (def ?? _key).replace(/{{(\w+)}}/g, (_m, name: string) => String(opts?.[name] ?? `{{${name}}}`)),
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
  topSpeed: 'Top speed',
  avgSpeed: 'Avg speed',
  peakPower: 'Peak power',
  peakRegen: 'Peak regen',
  avgDriveDist: 'Avg drive distance',
  longestDrive: 'Longest drive',
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
  return { min: 0, max: 0, avg: 0, median: 0, p95: 0, count: 3, ...partial };
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
  const column = labelNode.closest('[data-operational-metric]');
  if (!column) throw new Error(`no tile column for "${label}"`);
  const text = column.querySelector('[data-operational-value]')?.textContent?.trim() ?? '';
  const match = /^(.*?) (km\/h|mph|kW|km|mi)$/.exec(text);
  return {
    value: match?.[1] ?? text,
    subtitle: match?.[2] ?? '',
  };
}

/** Hidden tiles have no drawer group; the drawer counts them instead. */
function expectTilesHidden(labels: readonly string[], hiddenText: string) {
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
  const dialog = screen.getByRole('dialog');
  try {
    labels.forEach(label => {
      expect(within(dialog).queryByRole('group', { name: label })).not.toBeInTheDocument();
    });
    expect(within(dialog).getByText(hiddenText)).toBeInTheDocument();
  } finally {
    fireEvent.keyDown(dialog, { key: 'Escape' });
  }
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
}

beforeEach(() => {
  mockUseSettings.mockReturnValue(settingsFor('km'));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('DrivingPerformanceCards', () => {
  it.each([0, -1, 0.5, Number.NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, undefined, null])(
    'requires valid samples for each statistic with count %s',
    (count) => {
      const stats = { ...stat({ max: 25.5, avg: 0 }), count } as unknown as StatsSummary;
      render(<DrivingPerformanceCards query={queryWith({
        speed_stats: stats, power_stats: stats, regen_stats: stats, distance_stats: stats,
      })} />);
      expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
      expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
      Object.values(LABELS).forEach(label => {
        expect(screen.getByText(label)).toBeInTheDocument();
      });
      expectTilesHidden(Object.values(LABELS), '6 empty fields are hidden.');
    },
  );

  it('does not let an empty speed population suppress independently measured distance or regeneration', () => {
    render(<DrivingPerformanceCards query={queryWith({
      speed_stats: stat({ count: 0, max: 200 }),
      distance_stats: stat({ avg: 0.25, max: 0.5 }),
      regen_stats: stat({ max: -0.25 }),
    })} />);
    expect(screen.queryByText(LABELS.topSpeed)).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.avgSpeed)).not.toBeInTheDocument();
    expect(screen.queryByText(LABELS.peakPower)).not.toBeInTheDocument();
    expect(readTile(LABELS.avgDriveDist).value).toBe('0.25');
    expect(readTile(LABELS.longestDrive).value).toBe('0.50');
    expect(readTile(LABELS.peakRegen).value).toBe('-0.25');
    expectTilesHidden([LABELS.topSpeed, LABELS.avgSpeed, LABELS.peakPower], '3 empty fields are hidden.');
  });

  it('keeps absent and infinite fields unknown despite a valid sample population', () => {
    render(<DrivingPerformanceCards query={queryWith({
      speed_stats: { count: 2, max: Infinity } as StatsSummary,
    })} />);
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    expectTilesHidden(Object.values(LABELS), '6 empty fields are hidden.');
  });

  it('keeps the six-metric group while loading without publishing values', () => {
    const query = { data: undefined, isLoading: true } as unknown as FleetAnalyticsQuery;
    const { container } = render(<DrivingPerformanceCards query={query} />);

    expect(container.querySelector('[data-operational-brief]')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelector('[data-operational-value]')).toBeNull();
    expect(screen.getByText(LABELS.topSpeed)).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Driving performance metrics' })).toBeInTheDocument();
  });

  it('renders all six tiles with metric values and unit subtitles', () => {
    render(<DrivingPerformanceCards query={queryWith(FULL_STATS)} />);

    // Speed: km/h passes straight through the km/h→km/h conversion.
    expect(readTile(LABELS.topSpeed)).toEqual({ value: '200.00', subtitle: 'km/h' });
    expect(readTile(LABELS.avgSpeed)).toEqual({ value: '65.00', subtitle: 'km/h' });
    // Power / regen are already kW and are not unit-converted.
    expect(readTile(LABELS.peakPower)).toEqual({ value: '250.00', subtitle: 'kW' });
    expect(readTile(LABELS.peakRegen)).toEqual({ value: '80.00', subtitle: 'kW' });
    // Distance: km→km at one decimal.
    expect(readTile(LABELS.avgDriveDist)).toEqual({ value: '42.50', subtitle: 'km' });
    expect(readTile(LABELS.longestDrive)).toEqual({ value: '128.30', subtitle: 'km' });
  });

  it('converts speed to mph and distance to mi when the user prefers imperial units', () => {
    mockUseSettings.mockReturnValue(settingsFor('mi'));
    render(<DrivingPerformanceCards query={queryWith(FULL_STATS)} />);

    // 200 km/h → 124.27 mph (0 dp); 65 km/h → 40.39 mph.
    expect(readTile(LABELS.topSpeed)).toEqual({ value: '124.27', subtitle: 'mph' });
    expect(readTile(LABELS.avgSpeed)).toEqual({ value: '40.39', subtitle: 'mph' });
    // 42.5 km → 26.41 mi (1 dp); 128.3 km → 79.72 mi.
    expect(readTile(LABELS.avgDriveDist)).toEqual({ value: '26.41', subtitle: 'mi' });
    expect(readTile(LABELS.longestDrive)).toEqual({ value: '79.72', subtitle: 'mi' });
    // Power / regen are unit-agnostic — unchanged across unit systems.
    expect(readTile(LABELS.peakPower)).toEqual({ value: '250.00', subtitle: 'kW' });
    expect(readTile(LABELS.peakRegen)).toEqual({ value: '80.00', subtitle: 'kW' });
  });

  it('degrades every tile to a placeholder (never a blank band) when the payload carries no stats', () => {
    render(<DrivingPerformanceCards query={queryWith({})} />);

    // Six tiles, six omissions — but every label stays as a face chip and the drawer counts them.
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-operational-metric]')).toHaveLength(0);
    Object.values(LABELS).forEach((label) => {
      expect(screen.getByText(label)).toBeInTheDocument();
    });
    expectTilesHidden(Object.values(LABELS), '6 empty fields are hidden.');
  });

  it('degrades gracefully on an errored query with no data', () => {
    const query = {
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error('boom'),
    } as unknown as FleetAnalyticsQuery;
    render(<DrivingPerformanceCards query={query} />);

    // Error path resolves to the same six-omission band, still labelled.
    expect(screen.getByText('No metric values are available yet.')).toBeInTheDocument();
    expect(screen.getByRole('group')).toBeInTheDocument();
    expect(screen.getByText(LABELS.longestDrive)).toBeInTheDocument();
    expectTilesHidden(Object.values(LABELS), '6 empty fields are hidden.');
  });

  it('resolves each tile independently — present stats render, absent ones fall back', () => {
    render(<DrivingPerformanceCards query={queryWith({ speed_stats: stat({ max: 200, avg: 65 }) })} />);

    // Speed tiles have data…
    expect(readTile(LABELS.topSpeed).value).toBe('200.00');
    expect(readTile(LABELS.avgSpeed).value).toBe('65.00');
    // …while the four tiles without a backing stat are omitted from the face.
    const hiddenTiles = [LABELS.peakPower, LABELS.peakRegen, LABELS.avgDriveDist, LABELS.longestDrive];
    hiddenTiles.forEach(label => {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    });
    expectTilesHidden(hiddenTiles, '4 empty fields are hidden.');
  });

  it('distinguishes a non-finite stat from measured zero without rendering NaN', () => {
    render(
      <DrivingPerformanceCards
        query={queryWith({ speed_stats: stat({ max: Number.NaN, avg: 50 }) })}
      />,
    );

    expect(screen.queryByText(LABELS.topSpeed)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toContain('NaN');
    expect(readTile(LABELS.avgSpeed).value).toBe('50.00');
    expectTilesHidden([LABELS.topSpeed, LABELS.peakPower, LABELS.peakRegen, LABELS.avgDriveDist, LABELS.longestDrive],
      '5 empty fields are hidden.');
  });

  it('retains measured zero and signed regeneration independently of unknown fields', () => {
    render(<DrivingPerformanceCards query={queryWith({
      speed_stats: stat({ max: 0, avg: 0 }),
      regen_stats: stat({ max: -12.5 }),
    })} />);
    expect(readTile(LABELS.topSpeed)).toEqual({ value: '0.00', subtitle: 'km/h' });
    expect(readTile(LABELS.peakRegen)).toEqual({ value: '-12.50', subtitle: 'kW' });
    expect(screen.queryByText(LABELS.peakPower)).not.toBeInTheDocument();
    expect(screen.getByText(LABELS.topSpeed).closest('[data-operational-metric]')).toHaveAttribute('data-value-state', 'value');
    expectTilesHidden([LABELS.peakPower, LABELS.avgDriveDist, LABELS.longestDrive], '3 empty fields are hidden.');
  });

  it('exposes all six source metrics in a labelled group with working detail review', () => {
    const { container } = render(<DrivingPerformanceCards query={queryWith(FULL_STATS)} />);

    const group = screen.getByRole('group', { name: /driving performance metrics/i });
    expect(group).toHaveAttribute('aria-label', 'Driving performance metrics');
    // All six labels live inside the single labelled group…
    Object.values(LABELS).forEach((label) => {
      expect(within(group).getByText(label)).toBeInTheDocument();
    });
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    fireEvent.click(within(group).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(within(screen.getByRole('dialog')).getByText('Returned speed and distance statistics; power and regeneration remain unknown when the response omits them.', { selector: `[id="${screen.getByRole('dialog').getAttribute('aria-describedby')}"]` })).toBeInTheDocument();
  });
});
