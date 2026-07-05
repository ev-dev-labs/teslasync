/**
 * CostSavingsPanel — cost/savings math + branch coverage.
 *
 * The panel derives four display facets from an SI drive + computed stats:
 *   1. Trip cost         — energy (Wh→kWh) × cost-per-kWh.
 *   2. Cost per distance  — trip cost ÷ user-preferred distance unit
 *                           (hidden when distance is 0).
 *   3. Gas comparison     — equivalent gas cost, absolute savings, and
 *                           savings % (only shown when gas is configured AND
 *                           the EV actually saves money, i.e. savings > 0).
 *
 * These tests drive the REAL useFormatting / useUnits hooks (they read a
 * per-file useSettings mock) so the currency + unit-conversion math is
 * exercised end-to-end, and pin the exact rendered strings so a regression
 * in any formula (e.g. dividing savings % by the wrong denominator, or
 * double-converting meters) fails loudly. They also cover the null-safety
 * hardening (undefined energy/distance render "$0.00" without throwing) and
 * the decorative-icon a11y contract.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { DriveDetail } from '@/types/driving';
import type { DriveStats } from './types';

// ── Mutable settings backing the useSettings mock. `vi.hoisted` makes the
// container reachable from the hoisted vi.mock factory below. Tests mutate
// `H.current`; every render reads the latest value. ──
const H = vi.hoisted(() => {
  const base: Record<string, unknown> = {
    unit_of_length: 'km',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    preferred_range: 'rated',
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark',
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon',
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant',
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle',
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable',
    time_format_default: 'relative',
    chart_palette: 'cb_safe',
    ai_mode: 'off',
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  };
  return { base, current: { ...base } as Record<string, unknown> };
});

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return {
    ...actual,
    useSettings: () => {
      const s = H.current;
      return {
        settings: s,
        isMiles: s.unit_of_length === 'mi',
        isFahrenheit: s.unit_of_temp === 'F',
        isPSI: (s.unit_of_pressure ?? 'bar') === 'psi',
        decimals: (s.decimal_precision as number) ?? 2,
        locale: (s.locale as string) ?? 'en-US',
        density: 'comfortable',
        rangeType: 'rated',
      };
    },
  };
});

// i18n stub that resolves the `defaultValue`/fallback AND interpolates the
// `{{token}}` placeholders so we can assert on real user-visible text.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, opts: Record<string, unknown>) =>
    tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (k in opts ? String(opts[k]) : `{{${k}}}`));
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          const tpl = typeof o.defaultValue === 'string' ? o.defaultValue : key;
          return interpolate(tpl, o);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { CostSavingsPanel } from './CostSavingsPanel';

function applySettings(overrides: Record<string, unknown>) {
  H.current = { ...H.base, ...overrides };
}

// Minimal fixtures — the panel only reads `drive.distanceM` and
// `stats.energyWh`; every other field is irrelevant to its output.
function makeDrive(distanceM: number | null | undefined): DriveDetail {
  return { distanceM } as unknown as DriveDetail;
}
function makeStats(energyWh: number | null | undefined): DriveStats {
  return { energyWh } as unknown as DriveStats;
}

beforeEach(() => {
  H.current = { ...H.base };
});

describe('CostSavingsPanel', () => {
  it('renders trip cost + rate + cost-per-km and hides gas comparison when gas is not configured', () => {
    // Default settings: km, gas_price_per_unit = 0 (gas disabled).
    // 10 kWh × $0.12 = $1.20 trip cost; 50 km → $1.20 / 50 = $0.024 per km.
    render(<CostSavingsPanel drive={makeDrive(50_000)} stats={makeStats(10_000)} />);

    expect(screen.getByRole('heading', { name: /Cost & Savings/i })).toBeInTheDocument();
    expect(screen.getByText('Trip Cost')).toBeInTheDocument();
    expect(screen.getByText('$1.20')).toBeInTheDocument();
    expect(screen.getByText('at $0.12/kWh')).toBeInTheDocument();
    expect(screen.getByText('Cost / km')).toBeInTheDocument();
    expect(screen.getByText('$0.024')).toBeInTheDocument();

    // Gas comparison is entirely absent when gas price is unset.
    expect(screen.queryByText('Gas Cost (equiv)')).toBeNull();
    expect(screen.queryByText('vs Gas Savings')).toBeNull();
    expect(screen.queryByText('Savings %')).toBeNull();
  });

  it('hides the cost-per-distance tile (and gas comparison) when distance is zero', () => {
    render(<CostSavingsPanel drive={makeDrive(0)} stats={makeStats(10_000)} />);

    // Trip cost still shows — the panel is never blank.
    expect(screen.getByText('$1.20')).toBeInTheDocument();
    // No divide-by-zero tile.
    expect(screen.queryByText(/^Cost \//)).toBeNull();
    expect(screen.queryByText('Gas Cost (equiv)')).toBeNull();
  });

  it('renders the full gas comparison in miles when gas is configured and the EV wins', () => {
    // 40233.6 m = 25 mi exactly. mpg 25 → 1 gal → $4.00 gas cost.
    // EV: 10 kWh × $0.12 = $1.20. Savings $2.80 = 70% of $4.00.
    applySettings({
      unit_of_length: 'mi',
      gas_price_per_unit: 4,
      gas_efficiency_mpg: 25,
      gas_unit: 'gallon',
    });
    render(<CostSavingsPanel drive={makeDrive(40_233.6)} stats={makeStats(10_000)} />);

    // Trip + per-mile facets in the user's chosen unit.
    expect(screen.getByText('$1.20')).toBeInTheDocument();
    expect(screen.getByText('Cost / mi')).toBeInTheDocument();
    expect(screen.getByText('$0.048')).toBeInTheDocument();

    // Gas comparison facets.
    expect(screen.getByText('Gas Cost (equiv)')).toBeInTheDocument();
    expect(screen.getByText('$4.00')).toBeInTheDocument();
    expect(screen.getByText('at 25 MPG')).toBeInTheDocument();
    expect(screen.getByText('vs Gas Savings')).toBeInTheDocument();
    expect(screen.getByText('$2.80')).toBeInTheDocument();
    expect(screen.getByText('Savings %')).toBeInTheDocument();
    expect(screen.getByText('70%')).toBeInTheDocument();
  });

  it('hides the gas comparison when the EV costs more than the equivalent gas (savings <= 0)', () => {
    // Efficient gas car (100 mpg) + cheap gas ($1) → only $0.25 gas cost,
    // while 100 kWh × $0.12 = $12.00 EV cost → negative savings.
    applySettings({ gas_price_per_unit: 1, gas_efficiency_mpg: 100, gas_unit: 'gallon' });
    render(<CostSavingsPanel drive={makeDrive(40_233.6)} stats={makeStats(100_000)} />);

    expect(screen.getByText('$12.00')).toBeInTheDocument();
    expect(screen.queryByText('Gas Cost (equiv)')).toBeNull();
    expect(screen.queryByText('vs Gas Savings')).toBeNull();
    expect(screen.queryByText('Savings %')).toBeNull();
  });

  it('is null-safe: undefined energy and distance render $0.00 without throwing', () => {
    expect(() =>
      render(<CostSavingsPanel drive={makeDrive(undefined)} stats={makeStats(undefined)} />),
    ).not.toThrow();

    // energyWh ?? 0 → $0.00 trip cost; distanceM ?? 0 → per-distance + gas hidden.
    expect(screen.getByText('$0.00')).toBeInTheDocument();
    expect(screen.queryByText(/^Cost \//)).toBeNull();
    expect(screen.queryByText('Gas Cost (equiv)')).toBeNull();
    expect(screen.getByRole('heading', { name: /Cost & Savings/i })).toBeInTheDocument();
  });

  it('marks the decorative dollar icon aria-hidden and exposes an accessible heading', () => {
    const { container } = render(
      <CostSavingsPanel drive={makeDrive(50_000)} stats={makeStats(10_000)} />,
    );

    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');
    // The heading's accessible name comes from text only (icon is hidden).
    expect(screen.getByRole('heading', { name: 'Cost & Savings' })).toBeInTheDocument();
  });
});
