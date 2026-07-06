import type { ComponentProps } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SignalObservation } from '@/types/signals';
import { getSignalMeta } from '@/lib/signalCatalog';
import { chartTokens } from '@/lib/tokens';
import { formatTime } from '@/lib/dateFormat';

import {
  POWERSHARE_SIGNALS,
  SERIES_LIMIT,
  POWER_COLOR,
  HOURS_COLOR,
  type TrendPoint,
  type SnapshotRow,
} from './constants';
import { buildSeries, seriesPeak, humanizeEnum } from './helpers';
import { SignalSnapshotPanel } from './SignalSnapshotPanel';

/**
 * powershare/constants — module contract + real-consumer wiring.
 *
 * `constants.ts` is a pure reference module: the five cold-signal identifiers
 * the Powershare cockpit subscribes to (per ADR-005), the trend-series window,
 * the two chart accent colors, and the `TrendPoint` / `SnapshotRow` row shapes.
 * None of these values has a type that could catch a drifted signal name, a
 * fat-fingered hex, or a shrunken window — a wrong value would silently blank
 * the page (dead subscription → "No data") or mis-color the charts with NO
 * compile error to stop it. These tests therefore pin each constant's meaning
 * against its real source of truth (the backend proto mirror in `signalCatalog`
 * and the shared `chartTokens` palette) and prove the two row types flow
 * through their genuine consumers — `buildSeries` / `seriesPeak` for
 * `TrendPoint`, the rendered `SignalSnapshotPanel` for `SnapshotRow` — rather
 * than asserting the literals back at themselves.
 *
 * Conventions mirror the sibling cost-analysis `constants.test.ts` and the
 * charging component tests: `react-i18next` is stubbed so `t(key, fallback)`
 * resolves to its English fallback deterministically, `useSettings` /
 * `useTimezone` come from the global `src/test-setup.ts` stubs, and the panel's
 * error branch renders `<QueryError>` (which reaches for `useNavigate`), so
 * every render is wrapped in a `<MemoryRouter>`.
 */

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

const HEX6 = /^#[0-9a-f]{6}$/i;
const BASE_TS = Date.parse('2026-05-05T12:00:00Z');

/** Minimal-but-valid raw observation; overrides tweak the fields under test. */
function obs(overrides: Partial<SignalObservation> = {}): SignalObservation {
  return {
    vehicle_id: 1,
    ts: '2026-05-05T12:00:00Z',
    signal_name: POWERSHARE_SIGNALS.power,
    value_numeric: null,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
    ...overrides,
  };
}

/** Snapshot rows built exactly the way `PowersharePage` assembles them, incl.
 *  a `ts: null` row so the "no timestamp yet" branch is exercised. */
function makeRows(): SnapshotRow[] {
  return [
    { key: 'status', label: 'Status', value: 'Active', ts: '2026-05-05T12:00:00Z' },
    { key: 'type', label: 'Destination', value: 'Home', ts: null },
    { key: 'power', label: 'Output Power', value: '7.00 kW', ts: '2026-05-05T12:03:00Z' },
  ];
}

function renderPanel(props: Partial<ComponentProps<typeof SignalSnapshotPanel>> = {}) {
  const merged: ComponentProps<typeof SignalSnapshotPanel> = {
    rows: makeRows(),
    isLoading: false,
    error: null,
    onRetry: vi.fn(),
    ...props,
  };
  return {
    ...render(
      <MemoryRouter>
        <SignalSnapshotPanel {...merged} />
      </MemoryRouter>,
    ),
    onRetry: merged.onRetry,
  };
}

describe('POWERSHARE_SIGNALS — cold-signal identifiers', () => {
  it('maps the five logical keys to their exact Tesla proto identifiers', () => {
    // A rename of any wire name silently returns zero rows for that signal, so
    // pin all five verbatim against the backend proto (fields 206–210).
    expect(POWERSHARE_SIGNALS).toEqual({
      status: 'PowershareStatus',
      type: 'PowershareType',
      stopReason: 'PowershareStopReason',
      hoursLeft: 'PowershareHoursLeft',
      power: 'PowershareInstantaneousPowerKW',
    });
  });

  it('exposes five unique, non-empty, Powershare-prefixed signal names', () => {
    const names = Object.values(POWERSHARE_SIGNALS);
    expect(names).toHaveLength(5);
    expect(new Set(names).size).toBe(5);
    for (const name of names) {
      expect(name.startsWith('Powershare')).toBe(true);
      expect(name.length).toBeGreaterThan('Powershare'.length);
    }
  });

  it('references only signals that exist in the shared catalog (no dead subscriptions)', () => {
    for (const name of Object.values(POWERSHARE_SIGNALS)) {
      const meta = getSignalMeta(name);
      expect(meta, `${name} must exist in signalCatalog`).toBeDefined();
      expect(meta?.category).toBe('Powershare');
    }
  });

  it('classifies the numeric pair and the text trio the way the page consumes them', () => {
    // Numeric signals feed the trend charts (a series); the text signals only
    // ever surface their latest row — the split must match the catalog.
    expect(getSignalMeta(POWERSHARE_SIGNALS.power)?.type).toBe('number');
    expect(getSignalMeta(POWERSHARE_SIGNALS.hoursLeft)?.type).toBe('number');
    expect(getSignalMeta(POWERSHARE_SIGNALS.status)?.type).toBe('string');
    expect(getSignalMeta(POWERSHARE_SIGNALS.type)?.type).toBe('string');
    expect(getSignalMeta(POWERSHARE_SIGNALS.stopReason)?.type).toBe('string');
  });

  it('drives humanizeEnum prefix-stripping for each enum signal', () => {
    // The signal name doubles as the strip prefix `humanizeEnum` uses to turn a
    // proto-cased literal into a human label — prove that wiring end to end.
    expect(humanizeEnum('PowershareStatusActive', POWERSHARE_SIGNALS.status)).toBe('Active');
    expect(humanizeEnum('PowershareTypeHome', POWERSHARE_SIGNALS.type)).toBe('Home');
    expect(
      humanizeEnum('PowershareStopReasonUserRequest', POWERSHARE_SIGNALS.stopReason),
    ).toBe('User Request');
    expect(humanizeEnum(null, POWERSHARE_SIGNALS.status)).toBeNull();
  });
});

describe('SERIES_LIMIT — trend-series window', () => {
  it('is a positive integer wide enough for a trend yet bounded', () => {
    expect(Number.isInteger(SERIES_LIMIT)).toBe(true);
    // Strictly wider than the latest-only (limit 1) text window, but capped so
    // a runaway value can't flood the observations endpoint.
    expect(SERIES_LIMIT).toBeGreaterThan(1);
    expect(SERIES_LIMIT).toBeLessThanOrEqual(500);
  });

  it('caps the realized trend at exactly one point per observation in the window', () => {
    const rows: SignalObservation[] = Array.from({ length: SERIES_LIMIT }, (_, i) =>
      obs({ ts: new Date(BASE_TS + i * 60_000).toISOString(), value_numeric: i }),
    );
    const series = buildSeries(rows);
    expect(series).toHaveLength(SERIES_LIMIT);
    // seriesPeak is the MetricBar/relative-scale ceiling — the largest reading.
    expect(seriesPeak(series)).toBe(SERIES_LIMIT - 1);
  });
});

describe('chart accent colors — palette wiring', () => {
  it('are valid, distinct 6-digit hex colors', () => {
    expect(POWER_COLOR).toMatch(HEX6);
    expect(HOURS_COLOR).toMatch(HEX6);
    expect(POWER_COLOR).not.toBe(HOURS_COLOR);
  });

  it('stay in sync with the shared chart-token palette (no drift)', () => {
    // Kept as literals for direct chart-primitive consumption, but they MUST
    // track chartTokens.series[2] (amber) / [5] (cyan) — pin the drift.
    expect(POWER_COLOR).toBe(chartTokens.series[2]);
    expect(HOURS_COLOR).toBe(chartTokens.series[5]);
  });
});

describe('TrendPoint — produced + reduced by the real trend helpers', () => {
  it('reverses newest-first observations into chronological points and drops non-numeric rows', () => {
    const data: SignalObservation[] = [
      obs({ ts: '2026-05-05T12:02:00Z', value_numeric: 7 }), // newest
      obs({ ts: '2026-05-05T12:01:30Z', value_numeric: null }), // text/bool kind → dropped
      obs({ ts: '2026-05-05T12:00:00Z', value_numeric: 3 }), // oldest
    ];
    const series = buildSeries(data);

    expect(series).toHaveLength(2); // the null-valued row is filtered out
    expect(series.map((p) => p.value)).toEqual([3, 7]); // oldest → newest

    const point: TrendPoint = series[0];
    expect(point.ts).toBe('2026-05-05T12:00:00Z');
    expect(point.label).toBe(formatTime(point.ts)); // pre-formatted X-axis label
    expect(typeof point.value).toBe('number');
  });

  it('is null/undefined-safe and floors an empty trend peak at 0', () => {
    expect(buildSeries(undefined)).toEqual([]);
    expect(buildSeries([])).toEqual([]);
    expect(seriesPeak([])).toBe(0);
  });

  it('seriesPeak returns the largest reading regardless of arrival order', () => {
    const series = buildSeries([
      obs({ ts: '2026-05-05T12:02:00Z', value_numeric: 2 }),
      obs({ ts: '2026-05-05T12:01:00Z', value_numeric: 9 }),
      obs({ ts: '2026-05-05T12:00:00Z', value_numeric: 4 }),
    ]);
    expect(seriesPeak(series)).toBe(9);
  });
});

describe('SnapshotRow — rendered by SignalSnapshotPanel', () => {
  it('renders every row as a table cell with its label and value', () => {
    renderPanel();

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Output Power')).toBeInTheDocument();
    expect(screen.getByText('7.00 kW')).toBeInTheDocument();
  });

  it('renders the em-dash placeholder in the Updated column when ts is null', () => {
    renderPanel();

    // The `ts: null` row ("Home") must not blank its Updated cell — it renders
    // the universal "—" placeholder instead.
    const nullTsRow = screen.getByText('Home').closest('tr');
    expect(nullTsRow).not.toBeNull();
    expect(within(nullTsRow as HTMLElement).getByText('—')).toBeInTheDocument();
  });

  it('shows the empty message instead of a blank panel when no signals have arrived', () => {
    renderPanel({ rows: [] });

    expect(screen.getByText('No Powershare signals received yet.')).toBeInTheDocument();
    // The section title always renders so the band is never hidden.
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
  });

  it('renders a loading state (no table) while the query is in flight', () => {
    renderPanel({ isLoading: true, rows: [] });

    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('No Powershare signals received yet.')).not.toBeInTheDocument();
    expect(screen.getByText('Signal Snapshot')).toBeInTheDocument();
  });

  it('surfaces an accessible retry that invokes onRetry when the query fails', () => {
    const { onRetry } = renderPanel({ error: new Error('boom'), rows: [] });

    // No stale table leaks through the error branch.
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
