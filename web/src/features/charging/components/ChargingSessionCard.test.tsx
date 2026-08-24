/**
 * ChargingSessionCard — behaviour, branch, interaction, a11y and null-safety
 * coverage for the file's three exports:
 *
 *   1. `getChargerCategory`  — re-exported pure classifier (null/super/dc/home/…);
 *   2. `formatDuration`      — re-exported minutes→"1h 30m" / "—" formatter;
 *   3. `ChargingSessionCard` — the slot-based history row itself.
 *
 * The component composes a shared `HistoryListRow` (which renders a Router
 * `<Link>` to `/charging/{id}`), a leading `ScoreBadge`, a `RouteDisplay`, a
 * `BatteryDelta`, and a set of `InlineMetric` chips. All the interesting logic
 * lives in the derivations: charger-category → label + badge variant, the
 * energy / free / anomaly badges, the battery-friendly score, and the metric
 * chips (peak / avg / duration / cost / cost-per-kWh / range-added).
 *
 * This file also pins the hardening pass's fixes:
 *   - the IN-PROGRESS DURATION regression — a session with no `ended_at` renders
 *     the universal "—" placeholder in the primary line instead of the pre-fix
 *     misleading "0m" (which implied a zero-length charge);
 *   - i18n — the "kW peak" / "kW avg" chips route their English through
 *     `t(key, fallback, { value })` rather than a hardcoded template literal;
 *   - null-safety — a session whose optional readings are all null renders the
 *     row (never a crash, never "NaN") and simply omits the score badge.
 *
 * Strategy: the component takes its session + formatter as props, so no network
 * data is fetched. `TimeStamp` reaches `useTimeFormatPreference` (a react-query
 * hook) transitively, so the tree is wrapped in a QueryClientProvider; the
 * `/settings` query has no data in jsdom and the preference falls back to
 * 'relative' — the timestamp text is therefore never asserted. Only
 * `react-i18next` is mocked so `t(key, fallback)` / `t(key, fallback, { vars }})`
 * render the English fallback (with {{var}} interpolation) deterministically.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { type ComponentProps } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

import type { ChargingSession } from '@/api/types';
import type { ChargingAnomaly } from '@/lib/chargingAggregation';
import { fmtNumber, fmtWithUnit, fmtInt } from '@/lib/numberFormat';

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

// i18n → return the developer fallback string, interpolating {{vars}} so the
// metric chips + score aria-label read as real English. Handles the call
// shapes the component (and the shared leaves) use: t(key, 'fallback') and
// t(key, 'fallback', { vars }). The namespace argument is ignored.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (template: string, vars?: Record<string, unknown>) =>
    vars
      ? template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        )
      : template;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        if (second && typeof second === 'object') {
          const opts = second as Record<string, unknown>;
          const template = typeof opts.defaultValue === 'string' ? opts.defaultValue : key;
          return interpolate(template, opts);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// `TimeStamp` reaches `useTimeFormatPreference`, which reads the react-query
// `useSettings` hook. Stub it to a data-less result so no real `/settings`
// fetch is issued (never hit the network); the preference then falls back to
// 'relative', which is all the timestamp needs — its text is never asserted.
vi.mock('@/api/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useSettings')>(
    '@/api/hooks/useSettings',
  );
  return { ...actual, useSettings: () => ({ data: undefined }) };
});

import { ChargingSessionCard, getChargerCategory, formatDuration } from './ChargingSessionCard';

type CardProps = ComponentProps<typeof ChargingSessionCard>;

/** Build one charging session; defaults describe a completed 30-min AC charge. */
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
    total_energy_added_wh: 40_000, // 40 kWh
    peak_power_w: 250_000, // 250 kW
    avg_power_w: null,
    cost_decimal: null,
    cost_currency: null,
    charger_type: null, // null → 'home' category
    cable_type: null,
    startedAt: '2024-06-01T12:00:00Z',
    duration_min: 30,
    ...over,
  };
}

function renderCard(over: Partial<CardProps> = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props: CardProps = {
    session: makeSession(),
    toDistanceDisplay: (km: number) => km,
    distanceUnit: 'km',
    ...over,
  };
  const utils = render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ChargingSessionCard {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...utils, props };
}

describe('getChargerCategory (re-export)', () => {
  it('classifies raw charger_type strings into coarse categories', () => {
    expect(getChargerCategory(null)).toBe('home'); // null historically means home AC
    expect(getChargerCategory('Tesla Supercharger')).toBe('supercharger');
    expect(getChargerCategory('CCS')).toBe('dc');
    expect(getChargerCategory('Wall Connector')).toBe('home');
    expect(getChargerCategory('mystery-plug')).toBe('unknown');
  });
});

describe('formatDuration (re-export)', () => {
  it('formats whole/compound minutes and placeholders bad input', () => {
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(-5)).toBe('—');
  });
});

describe('ChargingSessionCard — primary line + badges', () => {
  it('renders the charger label, energy badge, score and a link to the detail page', () => {
    renderCard({ session: makeSession({ charger_type: 'Tesla Supercharger' }) });

    // supercharger category → "Supercharger" label chip.
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
    // energy badge shows the SI-converted kWh.
    expect(screen.getByText(fmtWithUnit(40, 'kWh'))).toBeInTheDocument();
    // start 20 / end 80 → battery-friendly score 100 → grade A+.
    expect(screen.getByText('A+')).toBeInTheDocument();
    expect(
      screen.getByLabelText('Battery-friendly score: 100'),
    ).toBeInTheDocument();
    // whole row is a single navigable link.
    expect(screen.getByRole('link')).toHaveAttribute('href', '/charging/1');
  });

  it('shows the "Free" badge only when the charge added energy at no cost', () => {
    renderCard({
      session: makeSession({ charger_type: null, cost_decimal: null, total_energy_added_wh: 12_000 }),
    });

    expect(screen.getByText('Home / AC')).toBeInTheDocument();
    expect(screen.getByText('Free')).toBeInTheDocument();
  });

  it('hides the energy + free badges when no energy was added', () => {
    renderCard({ session: makeSession({ total_energy_added_wh: 0, cost_decimal: null }) });

    expect(screen.queryByText('Free')).toBeNull();
    expect(screen.queryByText(fmtWithUnit(0, 'kWh'))).toBeNull();
    // The charger label still renders — the primary line is never blank.
    expect(screen.getByText('Home / AC')).toBeInTheDocument();
  });

  it('labels an unclassified charger as the generic "Charger" and renders the anomaly badge', () => {
    const anomaly: ChargingAnomaly = {
      session: makeSession(),
      kind: 'expensive',
      message: 'Expensive charge ($0.75/kWh)',
      actionLabel: 'Compare',
    };
    renderCard({ session: makeSession({ charger_type: 'mystery-plug' }), anomaly });

    expect(screen.getByText('Charger')).toBeInTheDocument();
    expect(screen.getByText('Expensive charge ($0.75/kWh)')).toBeInTheDocument();
  });

  it('opens the quick preview without nesting the action in the detail link', () => {
    const onPreview = vi.fn();
    renderCard({ onPreview });

    const action = screen.getByRole('button', {
      name: 'Quick view charging session',
    });
    fireEvent.click(action);

    expect(onPreview).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
    expect(screen.getByRole('link')).not.toContainElement(action);
  });
});

describe('ChargingSessionCard — metric chips', () => {
  it('renders peak, average, duration and battery-delta chips (comfortable density)', () => {
    renderCard({ session: makeSession() });

    // peak 250 kW, avg = 40 kWh / 0.5 h = 80 kW — both routed through i18n.
    expect(screen.getByText(`${fmtNumber(250)} kW peak`)).toBeInTheDocument();
    expect(screen.getByText(`~${fmtNumber(80)} kW avg`)).toBeInTheDocument();
    // 20 → 80 % battery delta is exposed with an accessible label.
    expect(screen.getByLabelText('Battery 20% to 80%')).toBeInTheDocument();
  });

  it('renders cost, cost-per-kWh and range-added chips and converts distance at the edge', () => {
    const toDistanceDisplay = vi.fn((km: number) => km);
    const { container } = renderCard({
      session: makeSession({
        charger_type: 'CCS',
        cost_decimal: 12.5,
        start_odometer_m: 0,
        end_odometer_m: 100_000, // +100 km added
      }),
      toDistanceDisplay,
      distanceUnit: 'km',
    });

    expect(screen.getByText('DC Fast')).toBeInTheDocument();
    expect(screen.getByText('$12.50')).toBeInTheDocument();
    // cost / (40 kWh) = $0.31/kWh, shown parenthesised.
    expect(container.textContent).toContain('($0.31/kWh)');
    // distance conversion happens at the display edge in km (100000 m → 100 km).
    expect(toDistanceDisplay).toHaveBeenCalledWith(100);
    expect(container.textContent).toContain(`+${fmtInt(100)} km`);
  });

  it('drops every metric chip in compact density while keeping the primary line', () => {
    renderCard({ session: makeSession(), density: 'compact' });

    expect(screen.queryByText(`${fmtNumber(250)} kW peak`)).toBeNull();
    expect(screen.queryByLabelText('Battery 20% to 80%')).toBeNull();
    // Primary chrome survives: only one "30m" (the primary duration, no chip).
    expect(screen.getAllByText('30m')).toHaveLength(1);
    expect(screen.getByText('Home / AC')).toBeInTheDocument();
  });
});

describe('ChargingSessionCard — selection', () => {
  it('omits the checkbox when no selection handler is supplied', () => {
    renderCard({ session: makeSession() });
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('renders a labelled checkbox and reports the toggled id when clicked', () => {
    const onToggleSelect = vi.fn();
    renderCard({ session: makeSession({ id: 7 }), onToggleSelect, selected: false });

    const box = screen.getByRole('checkbox', { name: 'Select charging session' });
    expect(box).not.toBeChecked();

    fireEvent.click(box);
    expect(onToggleSelect).toHaveBeenCalledWith(7, true);
  });

  it('reflects the selected prop as the checked state', () => {
    const onToggleSelect = vi.fn();
    renderCard({ session: makeSession(), onToggleSelect, selected: true });
    expect(screen.getByRole('checkbox', { name: 'Select charging session' })).toBeChecked();
  });
});

describe('ChargingSessionCard — route line', () => {
  it('renders the resolved charger location', () => {
    renderCard({ session: makeSession({ start_place: 'Fremont Supercharger' }) });
    expect(screen.getByText('Fremont Supercharger')).toBeInTheDocument();
  });

  it('falls back to the "No location data" placeholder when the charger has no place', () => {
    renderCard({ session: makeSession({ start_place: null, start_lat: null, start_lng: null }) });
    expect(screen.getByText('No location data')).toBeInTheDocument();
  });
});

describe('ChargingSessionCard — null safety + regressions', () => {
  it('placeholders the primary duration for an in-progress session (regression: no "0m")', () => {
    renderCard({
      session: makeSession({
        ended_at: null,
        start_soc_pct: 30,
        end_soc_pct: 45,
        peak_power_w: null,
        avg_power_w: null,
        total_energy_added_wh: 5_000,
        start_place: 'Home',
      }),
    });

    // In-progress → unknown duration → universal placeholder, not "0m".
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('0m')).toBeNull();
    // The battery delta still renders its own value (not a placeholder).
    expect(screen.getByLabelText('Battery 30% to 45%')).toBeInTheDocument();
  });

  it('omits the score badge when a SOC endpoint is missing', () => {
    const { container } = renderCard({
      session: makeSession({ start_soc_pct: null as unknown as number, end_soc_pct: null }),
    });
    expect(container.querySelector('[aria-label^="Battery-friendly score"]')).toBeNull();
  });

  it('renders the row without crashing or "NaN" when every optional reading is null', () => {
    const { container } = renderCard({
      session: makeSession({
        ended_at: null,
        start_soc_pct: null as unknown as number,
        end_soc_pct: null,
        delta_soc_pct: null,
        start_odometer_m: null,
        end_odometer_m: null,
        start_lat: null,
        start_lng: null,
        start_place: null,
        total_energy_added_wh: null as unknown as number,
        peak_power_w: null,
        avg_power_w: null,
        cost_decimal: null,
        charger_type: null,
      }),
    });

    expect(screen.getByRole('link')).toHaveAttribute('href', '/charging/1');
    expect(screen.getByText('No location data')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/NaN/);
  });
});
