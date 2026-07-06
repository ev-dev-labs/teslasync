/**
 * SessionDetailPanel — behaviour, branch, a11y, and null-safety coverage for
 * the file's sole export (the default `SessionDetailPanel`).
 *
 * The component is a presentational leaf: given one `ChargingSession` it derives
 * an ordered list of label/value rows and feeds them to a shared <KVList>
 * (rendered as a <dl> of <dt>/<dd> pairs) inside a labelled <GlassPanel> region.
 * All the interesting logic lives in that derivation — the always-present base
 * rows (Date / Charger Type / SOC Range / Energy Added / Peak Power / Duration),
 * the three conditionally-appended rows (Avg Power / Cost / Location), the
 * Wh→kWh and W→kW display conversions, the `getChargerLabel` branches, and the
 * null-safety guards — so every assertion reads a value straight back out of the
 * rendered <dd> for the row it targets.
 *
 * This file pins the hardening pass's fixes:
 *   1. the SOC-RANGE regression — a missing reading must render the universal
 *      "—" placeholder on BOTH sides instead of the pre-fix inconsistent
 *      "0% → ?%" (start defaulted to a misleading 0, end to a stray "?");
 *   2. the DURATION regression — an in-progress session (no `ended_at`) must
 *      show "—" (unknown), not the pre-fix "0.00 min" silent-zero;
 *   3. NULL-SAFETY — an absent energy / peak-power reading must coerce to a
 *      finite "0.00" unit string, never "NaN";
 *   4. a11y — the panel is exposed as a `region` landmark whose accessible name
 *      is its "Session Details" heading.
 *
 * Strategy: the component takes its session as a prop, so no network is touched.
 * The global test-setup already stubs `useSettings` (metric units, "$", precision
 * 2), which is all `useFormatting` / `useUnits` need — so the real currency
 * formatter runs unmocked. Only `react-i18next` is mocked, so `t(key, fallback)`
 * renders the English fallback deterministically. `formatDateTime` is imported
 * from the real lib so the Date-row assertion is timezone-independent (it
 * compares the row against the same formatter the component uses).
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ChargingSession } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';

// jsdom lacks matchMedia; shared UI can reach framer-motion's useReducedMotion
// transitively. Install a benign stub before any shared module evaluates.
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

// i18n → return the developer fallback string so labels read as real English.
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

import SessionDetailPanel from './SessionDetailPanel';

/** Build one charging session; every field defaults to a completed AC session. */
function makeSession(over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id: 1,
    vehicle_id: 1,
    started_at: '2024-06-01T12:00:00Z',
    ended_at: '2024-06-01T12:30:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: null,
    total_energy_added_wh: 40_000,
    peak_power_w: 11_000,
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null,
    cable_type: null,
    startedAt: '2024-06-01T12:00:00Z',
    duration_min: 30,
    ...over,
  };
}

function renderPanel(session: ChargingSession) {
  return render(<SessionDetailPanel session={session} />);
}

/** The <dd> text of the KVList row whose <dt> label is `label`. */
function rowValue(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.parentElement?.querySelector('dd');
  if (!dd) throw new Error(`no value cell for row "${label}"`);
  return dd.textContent ?? '';
}

/** Count of rendered KVList rows (one <dd> per row). */
function rowCount(): number {
  return document.querySelectorAll('dl dd').length;
}

describe('SessionDetailPanel — chrome + a11y', () => {
  it('exposes a labelled region landmark named by its heading', () => {
    renderPanel(makeSession());

    const region = screen.getByRole('region', { name: 'Session Details' });
    expect(region).toBeInTheDocument();
    const heading = screen.getByRole('heading', { level: 3, name: 'Session Details' });
    expect(heading).toBeInTheDocument();
    // The heading must actually be the element that names the region.
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    expect(heading.id).not.toBe('');
  });

  it('renders every base row label exactly once', () => {
    renderPanel(makeSession());

    for (const label of ['Date', 'Charger Type', 'SOC Range', 'Energy Added', 'Peak Power', 'Duration']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // A minimal completed session has exactly the six always-present rows.
    expect(rowCount()).toBe(6);
  });
});

describe('SessionDetailPanel — value formatting', () => {
  it('formats the base metrics of a completed session', () => {
    const session = makeSession({
      started_at: '2024-06-01T12:00:00Z',
      ended_at: '2024-06-01T12:30:00Z',
      start_soc_pct: 20,
      end_soc_pct: 80,
      total_energy_added_wh: 40_000, // 40 kWh
      peak_power_w: 250_000, // 250 kW
    });
    renderPanel(session);

    // Date is rendered through the shared formatter (timezone-independent
    // because we compare against that same formatter, not a hardcoded string).
    expect(rowValue('Date')).toBe(formatDateTime('2024-06-01T12:00:00Z'));
    expect(rowValue('Date')).not.toContain('T12:00:00Z'); // not the raw ISO
    expect(rowValue('SOC Range')).toBe('20% → 80%');
    expect(rowValue('Energy Added')).toBe('40.00 kWh');
    expect(rowValue('Peak Power')).toBe('250.00 kW');
    expect(rowValue('Duration')).toBe('30.00 min');
  });

  it('appends Avg Power, Cost, and Location when their data is present', () => {
    const session = makeSession({
      avg_power_w: 150_000, // 150 kW
      cost_decimal: 12.5,
      start_place: 'Home Garage',
    });
    renderPanel(session);

    expect(rowValue('Avg Power')).toBe('150.00 kW');
    // Cost routes through useFormatting().formatCurrency — "$" + precision 2.
    expect(rowValue('Cost')).toBe('$12.50');
    expect(rowValue('Location')).toBe('Home Garage');
    // Nine rows total: six base + the three optional ones.
    expect(rowCount()).toBe(9);
  });

  it('omits the optional rows when their data is absent', () => {
    renderPanel(makeSession({ avg_power_w: null, cost_decimal: null, start_place: null }));

    expect(screen.queryByText('Avg Power')).toBeNull();
    expect(screen.queryByText('Cost')).toBeNull();
    expect(screen.queryByText('Location')).toBeNull();
    // The always-present rows survive.
    expect(screen.getByText('Energy Added')).toBeInTheDocument();
    expect(rowCount()).toBe(6);
  });
});

describe('SessionDetailPanel — charger label branches', () => {
  it('labels a Tesla charger as Supercharger', () => {
    renderPanel(makeSession({ charger_type: 'Tesla', peak_power_w: 250_000 }));
    expect(rowValue('Charger Type')).toBe('Supercharger');
  });

  it('labels a non-Tesla charger_type as DC Fast', () => {
    renderPanel(makeSession({ charger_type: 'EVgo', peak_power_w: 100_000 }));
    expect(rowValue('Charger Type')).toBe('DC Fast');
  });

  it('labels an untyped but high-power session as DC Fast', () => {
    renderPanel(makeSession({ charger_type: null, peak_power_w: 120_000 }));
    expect(rowValue('Charger Type')).toBe('DC Fast');
  });

  it('labels a low-power untyped session as Home / AC', () => {
    renderPanel(makeSession({ charger_type: null, peak_power_w: 7_000 }));
    expect(rowValue('Charger Type')).toBe('Home / AC');
  });
});

describe('SessionDetailPanel — null safety + regressions', () => {
  it('placeholders both SOC ends when readings are missing (regression: no "0% → ?%")', () => {
    renderPanel(
      makeSession({
        start_soc_pct: null as unknown as number,
        end_soc_pct: null,
      }),
    );

    const soc = rowValue('SOC Range');
    expect(soc).toBe('— → —');
    // Pin the pre-fix behaviour: neither the misleading start "0%" nor the
    // stray end "?" may resurface.
    expect(soc).not.toContain('0%');
    expect(soc).not.toContain('?');
  });

  it('keeps a known start SOC while placeholdering an unknown end SOC', () => {
    renderPanel(makeSession({ start_soc_pct: 15, end_soc_pct: null }));
    expect(rowValue('SOC Range')).toBe('15% → —');
  });

  it('coerces missing energy and peak power to zeroed readings without NaN', () => {
    renderPanel(
      makeSession({
        total_energy_added_wh: undefined as unknown as number,
        peak_power_w: null,
      }),
    );

    expect(rowValue('Energy Added')).toBe('0.00 kWh');
    expect(rowValue('Energy Added')).not.toContain('NaN');
    expect(rowValue('Peak Power')).toBe('0.00 kW');
  });

  it('shows an em-dash duration for an in-progress session (regression: no "0.00 min")', () => {
    renderPanel(makeSession({ ended_at: null }));

    expect(rowValue('Duration')).toBe('—');
    expect(rowValue('Duration')).not.toBe('0.00 min');
  });

  it('renders without crashing when every optional field is null', () => {
    expect(() =>
      renderPanel(
        makeSession({
          ended_at: null,
          start_soc_pct: null as unknown as number,
          end_soc_pct: null,
          delta_soc_pct: null,
          total_energy_added_wh: null as unknown as number,
          peak_power_w: null,
          avg_power_w: null,
          cost_decimal: null,
          start_place: null,
        }),
      ),
    ).not.toThrow();
    // The panel is never blank — the base rows always render.
    expect(screen.getByRole('region', { name: 'Session Details' })).toBeInTheDocument();
    expect(rowValue('SOC Range')).toBe('— → —');
    expect(rowValue('Duration')).toBe('—');
  });
});
