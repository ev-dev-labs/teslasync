/**
 * SavingsCalculator — behaviour, hardening + regression cover.
 *
 * <SavingsCalculator … /> is the "Gas vs Electric Savings Calculator" band of
 * the Cost Analysis page. It has two columns that live inside one <CostSection>:
 *   1. INPUTS — three always-visible number fields (gas price, gas-car MPG,
 *      electricity rate) plus a "Reset Defaults" button. These stay editable in
 *      every query state so the user can tweak their assumptions.
 *   2. COMPARISON — self-manages its own loading / error / empty / data gate:
 *      a <Skeleton> while loading, a <QueryError> (with retry) on error, four
 *      <ComparisonCard>s when a `gasComparison` is present, and a localized
 *      empty state otherwise.
 * Its real work is *input parsing + per-column gating + currency formatting at
 * the display boundary* — not pixels.
 *
 * Strategy: unlike the sibling ForecastDetails / CostForecastSection tests (which
 * stub <CostSection> because THAT component owns their gating), this component
 * owns the gate itself, so the shared shells are rendered FOR REAL to exercise
 * the true branch precedence. Only two things are faked:
 *   - `react-i18next` → the repo's English-fallback `t()` with {{placeholder}}
 *     interpolation, so empty-state / label copy is directly assertable.
 *   - `@/hooks/useOnlineStatus` → pinned online so the error branch renders the
 *     deterministic network "Retry" CTA rather than the offline variant.
 * `useFormatting` runs for real; the global useSettings mock in test-setup pins
 * the currency symbol to "$", the locale to en-US, and precision to 2 — so the
 * exact formatted strings ("$1,200.50", "$0.156/km") are asserted verbatim.
 * The render is wrapped in <MemoryRouter> because <QueryError>/<EmptyState>
 * reach for router hooks. Nothing hits the network — the component is pure and
 * receives its data by prop.
 *
 * Covered facets:
 *   1. DATA      — the four comparison cards format each figure in the settings
 *                  currency with the right colour accent + per-distance / per-year
 *                  sub labels; inputs render alongside.
 *   2. EMPTY     — a null `gasComparison` (no loading / error) degrades to the
 *                  localized empty state; the inputs stay visible.
 *   3. LOADING   — a skeleton renders, the comparison region is marked aria-busy,
 *                  and loading takes precedence over present data.
 *   4. ERROR     — a QueryError surfaces with a working Retry that invokes onRetry;
 *                  error takes precedence over present data; inputs stay visible.
 *   5. PARSE     — each field parses its value and calls the right callback; the
 *                  divide-by-zero guard maps an empty MPG to 1 while gas/elec map
 *                  an empty field to 0.
 *   6. RESET      — the Reset button restores all three defaults on click.
 *   7. HARDENING — finite inputs pass through untouched; a NaN input is clamped to
 *                  the field default so the number field never receives NaN.
 *   8. UNIT-SAFE — a blank distanceUnit falls back to "km"; a real unit passes
 *                  through into the per-distance labels.
 *   9. A11Y      — inputs are labelled and the decorative calculator glyph is
 *                  hidden from assistive tech.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Pin online so the error branch renders the deterministic "Retry" CTA
// instead of the offline "Retry when online" (disabled) variant.
vi.mock('@/hooks/useOnlineStatus', () => ({
  useOnlineStatus: () => true,
}));

import { SavingsCalculator } from './SavingsCalculator';
import { DEFAULT_GAS_PRICE, DEFAULT_MPG, DEFAULT_ELECTRICITY_RATE } from './constants';
import type { GasComparison } from './types';

afterEach(cleanup);

type Props = ComponentProps<typeof SavingsCalculator>;

// Deliberately distinct magnitudes so every formatted string is unambiguous.
const BASE_GC: GasComparison = {
  gasCost: 1200.5,
  evCost: 750.25, // never displayed (card shows actualCost) — a regression pin.
  actualCost: 320.75,
  savings: 879.75,
  monthlySavings: 73.31,
  yearlySavings: 879.72,
  costPerMileGas: 0.156,
  costPerMileEV: 0.042,
};

function makeProps(over: Partial<Props> = {}): Props {
  return {
    gasComparison: BASE_GC,
    gasPrice: 3.5,
    mpg: 30,
    electricityRate: 0.13,
    onGasPriceChange: vi.fn(),
    onMpgChange: vi.fn(),
    onElectricityRateChange: vi.fn(),
    distanceUnit: 'km',
    isLoading: false,
    error: undefined,
    onRetry: vi.fn(),
    ...over,
  };
}

function renderCalc(over: Partial<Props> = {}) {
  const props = makeProps(over);
  const utils = render(
    <MemoryRouter>
      <SavingsCalculator {...props} />
    </MemoryRouter>,
  );
  return { props, ...utils };
}

/* ── 1. DATA ──────────────────────────────────────────────── */

describe('SavingsCalculator — comparison cards', () => {
  it('formats every figure in the settings currency with the right colour accent', () => {
    renderCalc();

    // Section title (rendered through the real CostSection shell).
    expect(screen.getByText('Gas vs Electric Savings Calculator')).toBeInTheDocument();

    const gasCost = screen.getByText('$1,200.50');
    expect(gasCost).toHaveClass('text-rose-300');
    const evCost = screen.getByText('$320.75');
    expect(evCost).toHaveClass('text-cyan-300');
    const totalSavings = screen.getByText('$879.75');
    expect(totalSavings).toHaveClass('text-emerald-300');
    const monthlySavings = screen.getByText('$73.31');
    expect(monthlySavings).toHaveClass('text-emerald-300');

    // The EV card is the ACTUAL spend (actualCost), not the hypothetical evCost.
    expect(screen.queryByText('$750.25')).toBeNull();
  });

  it('labels each card and renders the per-distance and per-year sub copy', () => {
    renderCalc();

    expect(screen.getByText('Gas Cost (equivalent)')).toBeInTheDocument();
    expect(screen.getByText('EV Cost (actual)')).toBeInTheDocument();
    expect(screen.getByText('Total Savings')).toBeInTheDocument();
    expect(screen.getByText('Monthly Savings')).toBeInTheDocument();

    // Per-distance sub labels use the display distance unit at 3-dp.
    expect(screen.getByText('$0.156/km')).toBeInTheDocument();
    expect(screen.getByText('$0.042/km')).toBeInTheDocument();
    expect(screen.getByText('over selected period')).toBeInTheDocument();
    // ~ prefix + yearly at 0-dp + interpolated "/ year" fallback.
    expect(screen.getByText('~$880 / year')).toBeInTheDocument();
  });

  it('renders the editable inputs alongside the cards and is not marked busy', () => {
    const { container } = renderCalc();

    expect(screen.getByLabelText(/Gas Price/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Gas Car MPG/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Electricity Rate/i)).toBeInTheDocument();

    // No loading / error / empty leaking into the data view.
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
    expect(screen.queryByText('Not enough data for comparison')).toBeNull();
    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });
});

/* ── 2. EMPTY ─────────────────────────────────────────────── */

describe('SavingsCalculator — empty comparison', () => {
  it('shows the localized empty state when gasComparison is null', () => {
    renderCalc({ gasComparison: null });

    expect(screen.getByText('Not enough data for comparison')).toBeInTheDocument();
    // No cards.
    expect(screen.queryByText('$1,200.50')).toBeNull();
    // Inputs remain visible so users can still adjust assumptions.
    expect(screen.getByLabelText(/Gas Price/i)).toBeInTheDocument();
  });
});

/* ── 3. LOADING ───────────────────────────────────────────── */

describe('SavingsCalculator — loading', () => {
  it('renders a skeleton, marks the comparison region busy, and hides cards + empty', () => {
    const { container } = renderCalc({ isLoading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByText('$1,200.50')).toBeNull();
    expect(screen.queryByText('Not enough data for comparison')).toBeNull();
    // Inputs stay editable while data loads.
    expect(screen.getByLabelText(/Gas Price/i)).toBeInTheDocument();
  });

  it('lets loading take precedence over an already-present comparison', () => {
    renderCalc({ isLoading: true, gasComparison: BASE_GC });
    // Cards must not render while loading even though data is present.
    expect(screen.queryByText('$1,200.50')).toBeNull();
    expect(screen.queryByText('$879.75')).toBeNull();
  });
});

/* ── 4. ERROR ─────────────────────────────────────────────── */

describe('SavingsCalculator — error', () => {
  it('surfaces a QueryError with a working Retry and hides the cards', () => {
    const onRetry = vi.fn();
    renderCalc({ error: new Error('boom'), gasComparison: BASE_GC, onRetry });

    // Error branch renders an alert-role banner + a Retry CTA.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);

    // Error takes precedence over the present comparison data.
    expect(screen.queryByText('$1,200.50')).toBeNull();
    // Inputs remain visible.
    expect(screen.getByLabelText(/Electricity Rate/i)).toBeInTheDocument();
  });
});

/* ── 5. PARSE ─────────────────────────────────────────────── */

describe('SavingsCalculator — input parsing', () => {
  it('parses a typed gas price and forwards the numeric value', () => {
    const { props } = renderCalc();
    fireEvent.change(screen.getByLabelText(/Gas Price/i), { target: { value: '4.25' } });
    expect(props.onGasPriceChange).toHaveBeenCalledWith(4.25);
  });

  it('maps an empty MPG to 1 (divide-by-zero guard) but empty gas/elec to 0', () => {
    const { props } = renderCalc();

    fireEvent.change(screen.getByLabelText(/Gas Price/i), { target: { value: '' } });
    expect(props.onGasPriceChange).toHaveBeenCalledWith(0);

    fireEvent.change(screen.getByLabelText(/Gas Car MPG/i), { target: { value: '' } });
    expect(props.onMpgChange).toHaveBeenCalledWith(1);

    fireEvent.change(screen.getByLabelText(/Electricity Rate/i), { target: { value: '' } });
    expect(props.onElectricityRateChange).toHaveBeenCalledWith(0);
  });
});

/* ── 6. RESET ─────────────────────────────────────────────── */

describe('SavingsCalculator — reset', () => {
  it('restores all three defaults when Reset Defaults is activated', () => {
    const { props } = renderCalc({ gasPrice: 9, mpg: 12, electricityRate: 0.99 });

    fireEvent.click(screen.getByRole('button', { name: /reset defaults/i }));

    expect(props.onGasPriceChange).toHaveBeenCalledWith(DEFAULT_GAS_PRICE);
    expect(props.onMpgChange).toHaveBeenCalledWith(DEFAULT_MPG);
    expect(props.onElectricityRateChange).toHaveBeenCalledWith(DEFAULT_ELECTRICITY_RATE);
  });
});

/* ── 7. HARDENING: non-finite input guard ─────────────────── */

describe('SavingsCalculator — non-finite input guard', () => {
  it('passes finite input values straight through to the number fields', () => {
    renderCalc({ gasPrice: 7.5, mpg: 42, electricityRate: 0.21 });

    expect((screen.getByLabelText(/Gas Price/i) as HTMLInputElement).value).toBe('7.5');
    expect((screen.getByLabelText(/Gas Car MPG/i) as HTMLInputElement).value).toBe('42');
    expect((screen.getByLabelText(/Electricity Rate/i) as HTMLInputElement).value).toBe('0.21');
  });

  it('clamps a NaN input to the field default so the field never receives NaN', () => {
    renderCalc({ gasPrice: NaN, mpg: NaN, electricityRate: NaN });

    expect((screen.getByLabelText(/Gas Price/i) as HTMLInputElement).value).toBe(
      String(DEFAULT_GAS_PRICE),
    );
    expect((screen.getByLabelText(/Gas Car MPG/i) as HTMLInputElement).value).toBe(
      String(DEFAULT_MPG),
    );
    expect((screen.getByLabelText(/Electricity Rate/i) as HTMLInputElement).value).toBe(
      String(DEFAULT_ELECTRICITY_RATE),
    );
  });
});

/* ── 8. UNIT-SAFE: distanceUnit fallback ──────────────────── */

describe('SavingsCalculator — distance-unit fallback', () => {
  it('falls back to "km" when distanceUnit is blank', () => {
    renderCalc({ distanceUnit: '   ' });
    expect(screen.getByText('$0.156/km')).toBeInTheDocument();
    expect(screen.getByText('$0.042/km')).toBeInTheDocument();
  });

  it('passes a real distance unit through into the per-distance labels', () => {
    renderCalc({ distanceUnit: 'mi' });
    expect(screen.getByText('$0.156/mi')).toBeInTheDocument();
    expect(screen.getByText('$0.042/mi')).toBeInTheDocument();
  });
});

/* ── 9. A11Y ──────────────────────────────────────────────── */

describe('SavingsCalculator — accessibility', () => {
  it('labels every input and hides the decorative calculator glyph', () => {
    const { container } = renderCalc();

    // Each field has an accessible name via its <label>.
    expect(screen.getByLabelText(/Gas Price/i)).toHaveAttribute('type', 'number');
    expect(screen.getByLabelText(/Gas Car MPG/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Electricity Rate/i)).toBeInTheDocument();

    // The leading calculator icon is decorative — hidden from assistive tech.
    const icon = container.querySelector('h3 svg');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden', 'true');
  });
});
