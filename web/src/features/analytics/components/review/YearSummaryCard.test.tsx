/**
 * YearSummaryCard — behaviour, unit-conversion, branch, hardening + a11y cover.
 *
 * Single export: <YearSummaryCard data={YearReview} />. It renders a
 * screenshot-friendly recap of the year:
 *   - a level-3 heading carrying the year, a "Year in Review" caption, and the
 *     vehicle's display name + model,
 *   - a five-row highlights list (drives / distance / energy / charges / CO₂),
 *     each row an icon + an <AnimatedNumber> + a label,
 *   - a conditional "💰 Saved {{amount}} vs. gas" footnote shown only when the
 *     year produced positive savings,
 *   - a helper caption prompting the user to screenshot the card.
 *
 * Facets covered:
 *   1. HEADER     — the year renders as a level-3 heading alongside the review
 *                   caption, vehicle identity, and the screenshot helper.
 *   2. METRIC     — all five rows render; the distance row round-trips the SI
 *                   kilometres and is labelled "km" for a metric user.
 *   3. IMPERIAL   — the same payload converts the distance to miles and swaps
 *                   the row label to "mi" while non-distance rows are untouched.
 *   4. SAVINGS+   — a positive gas_savings renders the formatted footnote.
 *   5. SAVINGS-   — a zero gas_savings hides the footnote (never a "$0" brag)
 *                   while the highlights stay visible.
 *   6. HARDENING  — null / undefined / NaN stats coerce to 0 (safeNumber) so no
 *                   row blanks out or prints "NaN", and a null vehicle falls back
 *                   to the em-dash / empty placeholders.
 *   7. NON-FINITE — an Infinity gas_savings is coerced to 0 and the footnote is
 *                   suppressed (regression guard: plain `?? 0` would have let
 *                   `Infinity > 0` through and rendered a bogus "$0" footnote).
 *   8. A11Y       — every stat icon is decorative (aria-hidden) and the five
 *                   rows are exposed as a single labelled list.
 *
 * `react-i18next` is stubbed to the English fallback (with {{amount}}
 * interpolation) so copy is deterministic. `@/hooks/useSettings` (the leaf that
 * `useUnits()` + `useFormatting()` both read) is mocked per-test so the metric /
 * imperial preference can be toggled while the real conversion + currency libs
 * run underneath — the asserted numbers are therefore genuine. No network is
 * touched: the review payload is passed straight in as a prop, and
 * `requestAnimationFrame` is stubbed so <AnimatedNumber> settles on its final
 * value synchronously.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, within, cleanup } from '@testing-library/react';
import type { YearReview } from '@/api/types';

const { mockUseSettings } = vi.hoisted(() => ({ mockUseSettings: vi.fn() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, opts?: unknown) => {
        if (typeof opts === 'string') return opts;
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          let out = typeof o.defaultValue === 'string' ? o.defaultValue : key;
          for (const [k, v] of Object.entries(o)) {
            if (k === 'defaultValue') continue;
            out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
          }
          return out;
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return { ...actual, useSettings: mockUseSettings };
});

import { YearSummaryCard } from './YearSummaryCard';

/** Minimal settings bag — `useUnits()`/`useFormatting()` only read these fields. */
function settingsFor(length: 'km' | 'mi') {
  return {
    settings: {
      unit_of_length: length,
      unit_of_temp: 'C',
      unit_of_pressure: 'bar',
      locale: 'en-US',
      decimal_precision: 2,
      currency_symbol: '$',
      base_cost_per_kwh: 0.12,
      gas_price_per_unit: 0,
      gas_unit: 'gallon',
      gas_efficiency_mpg: 25,
    },
  };
}

/** A full, well-formed review with overridable fields (cast to skip the ~30 unused keys). */
function makeReview(overrides: Partial<YearReview> = {}): YearReview {
  return {
    year: 2024,
    vehicle: { id: 1, display_name: 'Model 3 Performance', model: 'model3' },
    total_drives: 128,
    total_distance_km: 500,
    total_energy_kwh: 842,
    total_charge_sessions: 36,
    gas_savings: 640,
    co2_offset_kg: 275,
    ...overrides,
  } as unknown as YearReview;
}

/** Read the <AnimatedNumber> value rendered in the row whose label is `label`. */
function readRow(label: string): string {
  const li = screen.getByText(label).closest('li');
  if (!li) throw new Error(`no <li> row for label "${label}"`);
  // Row order is: <svg icon> · <AnimatedNumber span> · <label span>, so the
  // first span holds the (settled) numeric value.
  return li.querySelector('span')?.textContent?.trim() ?? '';
}

beforeEach(() => {
  mockUseSettings.mockReturnValue(settingsFor('km'));
  // Collapse <AnimatedNumber>'s ease-out onto its final frame so the rendered
  // value is deterministic and available synchronously after render().
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(1e9);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('YearSummaryCard', () => {
  it('renders the year as a level-3 heading with the review caption, vehicle identity, and helper', () => {
    render(<YearSummaryCard data={makeReview()} />);

    expect(screen.getByRole('heading', { level: 3, name: '2024' })).toBeInTheDocument();
    expect(screen.getByText('Year in Review')).toBeInTheDocument();
    expect(screen.getByText('Model 3 Performance')).toBeInTheDocument();
    expect(screen.getByText('model3')).toBeInTheDocument();
    expect(screen.getByText('Screenshot to share your year')).toBeInTheDocument();
  });

  it('renders all five highlight rows with metric values and a "km" distance label', () => {
    render(<YearSummaryCard data={makeReview()} />);

    // 500 km → 500000 m → back to 500 km (round-trip through convertDistanceFromSI).
    expect(readRow('km')).toBe('500');
    expect(readRow('Drives')).toBe('128');
    expect(readRow('kWh')).toBe('842');
    expect(readRow('Charges')).toBe('36');
    expect(readRow('kg CO₂ saved')).toBe('275');
    // The imperial label must not appear for a metric user.
    expect(screen.queryByText('mi')).not.toBeInTheDocument();
  });

  it('converts the distance to miles and swaps the label when the user prefers imperial units', () => {
    mockUseSettings.mockReturnValue(settingsFor('mi'));
    render(<YearSummaryCard data={makeReview()} />);

    // 500 km = 500000 m ÷ 1609.344 = 310.69 → 311 mi at zero decimals.
    expect(readRow('mi')).toBe('311');
    expect(screen.queryByText('km')).not.toBeInTheDocument();
    // Non-distance rows are unit-agnostic and stay put across the unit switch.
    expect(readRow('Drives')).toBe('128');
    expect(readRow('kWh')).toBe('842');
  });

  it('renders the gas-savings footnote when the year produced positive savings', () => {
    render(<YearSummaryCard data={makeReview({ gas_savings: 640 })} />);

    // formatCurrency(640, 0) → "$640", interpolated into the fallback copy.
    expect(screen.getByText(/Saved \$640 vs\. gas/)).toBeInTheDocument();
  });

  it('omits the gas-savings footnote when there are no savings but keeps the highlights', () => {
    render(<YearSummaryCard data={makeReview({ gas_savings: 0 })} />);

    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
    // The core highlights still render — the panel never blanks out.
    expect(readRow('Drives')).toBe('128');
    expect(screen.getByRole('heading', { level: 3, name: '2024' })).toBeInTheDocument();
  });

  it('coerces null / undefined / NaN stats to 0 and a null vehicle to placeholders (no "NaN")', () => {
    const { container } = render(
      <YearSummaryCard
        data={makeReview({
          total_drives: null as unknown as number,
          total_distance_km: Number.NaN,
          total_energy_kwh: undefined as unknown as number,
          total_charge_sessions: null as unknown as number,
          co2_offset_kg: Number.NaN,
          gas_savings: null as unknown as number,
          vehicle: null as unknown as YearReview['vehicle'],
        })}
      />,
    );

    expect(readRow('km')).toBe('0');
    expect(readRow('Drives')).toBe('0');
    expect(readRow('kWh')).toBe('0');
    expect(readRow('Charges')).toBe('0');
    expect(readRow('kg CO₂ saved')).toBe('0');
    // The lying payload never leaks a "NaN" into the DOM…
    expect(container.textContent).not.toContain('NaN');
    // …and the missing vehicle degrades to the em-dash placeholder, not a crash.
    expect(screen.getByText('—')).toBeInTheDocument();
    // A null gas_savings must not render the footnote.
    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
  });

  it('suppresses the footnote for a non-finite gas-savings value instead of rendering a bogus "$0"', () => {
    render(<YearSummaryCard data={makeReview({ gas_savings: Number.POSITIVE_INFINITY })} />);

    // safeNumber(Infinity) === 0, so `0 > 0` is false and the footnote is gone.
    // With the previous `?? 0`, `Infinity > 0` was true and printed "Saved $0".
    expect(screen.queryByText(/Saved/)).not.toBeInTheDocument();
    expect(screen.queryByText(/\$0/)).not.toBeInTheDocument();
  });

  it('marks every stat icon as decorative and exposes the five rows as one labelled list', () => {
    const { container } = render(<YearSummaryCard data={makeReview()} />);

    const icons = container.querySelectorAll('svg');
    expect(icons).toHaveLength(5);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));

    const list = screen.getByRole('list', { name: 'Year highlights' });
    expect(list).toHaveAttribute('aria-label', 'Year highlights');
    expect(within(list).getAllByRole('listitem')).toHaveLength(5);
  });
});
