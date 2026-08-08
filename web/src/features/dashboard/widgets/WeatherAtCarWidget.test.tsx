/**
 * WeatherAtCarWidget — behaviour + hardening coverage.
 *
 * The widget reads the vehicle's live SignalStore snapshot and surfaces the
 * outside temperature at the car: a condition icon (snow ≤0°C, sun ≥25°C, else
 * partly-cloudy), the temperature converted to the user's unit preference, and
 * — in the roomy (≥2-col) layout — an "Outside Temperature" label plus the
 * car's lat/long. It renders two layouts: compact (1×1, icon + big number, no
 * chrome) and standard (title + label + coords). Its public surface is the
 * default component plus one pure utility exported for direct testing,
 * `weatherConditionFor`, which is covered here.
 *
 * The suite doubles as the regression guard for two real bugs this elevation
 * fixes:
 *   - a NON-finite reading (NaN / ±Infinity, or a null/absent `outside_temp`)
 *     used to satisfy the loose `!= null` check and render through `fmtInt`,
 *     which coalesces NaN → 0 — so a malformed payload displayed a confident
 *     but fictional "0°". The fix routes any non-finite reading to the labelled
 *     empty state; the tests assert no "0°" leaks.
 *   - a genuine initial-load failure (no reading yet, query errored) used to
 *     render the misleading "No weather data" empty state as if the fetch had
 *     succeeded-but-empty. The fix surfaces a real error panel instead, while a
 *     background-refetch error that still has a cached reading stays a subtle
 *     freshness signal so valid data is never blanked out.
 *
 * It also locks in the icon branch (chosen from the SI °C value, NOT the
 * converted display value), the °C↔°F conversion + rounding at the display
 * boundary, the coordinate finite-guard, loading / empty states, the refresh
 * interaction, and vehicle-id resolution (prop → first-vehicle → 0).
 *
 * Network is never touched — `useVehicles` / `useVehicleState` are mocked and
 * driven per-test, `useUnits` is mocked so the temperature preference can be
 * flipped, and `react-i18next` is stubbed to echo fallback strings. The real
 * `WidgetShell` / `DataFreshness` / `QueryError` / `EmptyState` render, so those
 * surfaces are exercised for real. The real `convertTempFromSI` / `fmtInt`
 * (unmocked) prove the conversion + rounding maths end-to-end.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { VehicleState } from '@/api/types';
import type { WidgetProps } from './types';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) s = s.replace(`{{${k}}}`, String(v));
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── The data hooks — driven per test ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useVehicleState: vi.fn(),
}));

// ── Units — a mutable temperature preference so we can flip °C ↔ °F. The
// widget reads `unitPrefs.temperature` and applies the REAL convertTempFromSI,
// so the conversion maths below are exercised for real, not stubbed. ──
const unitsState = vi.hoisted(() => ({ temperature: '\u00B0C' as '\u00B0C' | '\u00B0F' }));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({ unitPrefs: { temperature: unitsState.temperature } }),
}));

import { useVehicles, useVehicleState } from '@/api/hooks/useVehicles';
import WeatherAtCarWidget, { weatherConditionFor } from './WeatherAtCarWidget';

const mockUseVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockUseVehicleState = useVehicleState as unknown as ReturnType<typeof vi.fn>;

// The degree sign (U+00B0), pinned so exact string matches never depend on the
// source file's byte encoding.
const DEG = '\u00B0';

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function makeState(over: Partial<VehicleState> = {}): VehicleState {
  return {
    vehicle_id: 1,
    state: 'online',
    latitude: 37.4219,
    longitude: -122.0841,
    speed: 0,
    power: 0,
    battery_level: 80,
    rated_range: 0,
    ideal_range: 0,
    odometer: 0,
    inside_temp: 21,
    outside_temp: 20,
    is_climate_on: false,
    is_charging: false,
    charger_power: 0,
    charge_rate: 0,
    time_to_full_charge: 0,
    is_locked: true,
    sentry_mode: false,
    software_version: '',
    ...over,
  };
}

/** Build a `useVehicleState`-shaped query result carrying `{ state, live }`. */
function stateQuery(
  state: VehicleState | undefined,
  over: Record<string, unknown> = {},
) {
  const data = state === undefined ? { state: undefined, live: false } : { state, live: true };
  return makeQuery({ data, ...over });
}

function renderWidget(props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <WeatherAtCarWidget size={{ cols: 2, rows: 2 }} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  unitsState.temperature = `${DEG}C` as '\u00B0C' | '\u00B0F';
  mockUseVehicles.mockReset();
  mockUseVehicleState.mockReset();
  mockUseVehicles.mockReturnValue({ data: [{ id: 1 }] });
  mockUseVehicleState.mockReturnValue(stateQuery(makeState()));
});

describe('weatherConditionFor (utility)', () => {
  it('maps the temperature to the freezing / mild / warm bands', () => {
    expect(weatherConditionFor(-10)).toBe('freezing');
    expect(weatherConditionFor(12)).toBe('mild');
    expect(weatherConditionFor(30)).toBe('warm');
  });

  it('treats the 0°C and 25°C boundaries as inclusive band edges', () => {
    // 0 is <= 0 → freezing; just above is mild.
    expect(weatherConditionFor(0)).toBe('freezing');
    expect(weatherConditionFor(0.1)).toBe('mild');
    // 25 is >= 25 → warm; just below is mild.
    expect(weatherConditionFor(25)).toBe('warm');
    expect(weatherConditionFor(24.9)).toBe('mild');
  });

  it('coalesces non-finite input to the neutral "mild" band, never an extreme', () => {
    // Regression guard: a malformed reading must not pick snow/sun or throw.
    expect(weatherConditionFor(Number.NaN)).toBe('mild');
    expect(weatherConditionFor(Number.POSITIVE_INFINITY)).toBe('mild');
    expect(weatherConditionFor(Number.NEGATIVE_INFINITY)).toBe('mild');
  });
});

describe('WeatherAtCarWidget — standard (≥2 col) layout', () => {
  it('renders the temperature, the label, and the vehicle coordinates', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ outside_temp: 20, latitude: 37.4219, longitude: -122.0841 })),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByRole('heading', { name: 'Weather at Car' })).toBeInTheDocument();
    expect(screen.getByText(`20${DEG}C`)).toBeInTheDocument();
    expect(screen.getByText('Outside Temperature')).toBeInTheDocument();
    // Coordinates are rendered to two decimals.
    expect(screen.getByText(`37.42${DEG}, -122.08${DEG}`)).toBeInTheDocument();
  });

  it('rounds the displayed temperature to a whole number', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 21.6 })));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText(`22${DEG}C`)).toBeInTheDocument();
    expect(screen.queryByText(`21.6${DEG}C`)).not.toBeInTheDocument();
  });

  it('renders a negative temperature verbatim (no NaN, no dropped sign)', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: -6 })));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText(`-6${DEG}C`)).toBeInTheDocument();
  });
});

describe('WeatherAtCarWidget — compact (1×1) layout', () => {
  it('renders the temperature but drops the title, label, and coords', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ outside_temp: 18, latitude: 37.4219, longitude: -122.0841 })),
    );
    renderWidget({ size: { cols: 1, rows: 1 } });

    expect(screen.getByText(`18${DEG}C`)).toBeInTheDocument();
    // Compact chrome is stripped: no header title, no descriptive label,
    // no coordinate line.
    expect(screen.queryByRole('heading', { name: 'Weather at Car' })).not.toBeInTheDocument();
    expect(screen.queryByText('Outside Temperature')).not.toBeInTheDocument();
    expect(screen.queryByText(`37.42${DEG}, -122.08${DEG}`)).not.toBeInTheDocument();
  });
});

describe('WeatherAtCarWidget — condition icon (driven by the SI °C value)', () => {
  it('shows the snow icon at or below 0°C', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 0 })));
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    expect(container.querySelector('.lucide-cloud-snow')).not.toBeNull();
    expect(container.querySelector('.lucide-sun')).toBeNull();
    expect(container.querySelector('.lucide-cloud-sun')).toBeNull();
    expect(screen.getByText(`0${DEG}C`)).toBeInTheDocument();
  });

  it('shows the sun icon at or above 25°C', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 31 })));
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    expect(container.querySelector('.lucide-sun')).not.toBeNull();
    expect(container.querySelector('.lucide-cloud-snow')).toBeNull();
  });

  it('shows the partly-cloudy icon for mild temperatures', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 14 })));
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    expect(container.querySelector('.lucide-cloud-sun')).not.toBeNull();
    expect(container.querySelector('.lucide-sun')).toBeNull();
    expect(container.querySelector('.lucide-cloud-snow')).toBeNull();
  });

  it('picks the icon from the SI °C value, not the converted display value', () => {
    // 20°C is "mild"; if the icon were (incorrectly) chosen from the 68°F
    // display value it would flip to the "warm" sun. It must stay cloud-sun.
    unitsState.temperature = `${DEG}F` as '\u00B0C' | '\u00B0F';
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 20 })));
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    expect(container.querySelector('.lucide-cloud-sun')).not.toBeNull();
    expect(container.querySelector('.lucide-sun')).toBeNull();
    expect(screen.getByText(`68${DEG}F`)).toBeInTheDocument();
  });

  it('marks the decorative icon aria-hidden (the number carries the data)', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 5 })));
    const { container } = renderWidget({ size: { cols: 1, rows: 1 } });

    const icon = container.querySelector('.lucide-cloud-sun');
    expect(icon).not.toBeNull();
    expect(icon).toHaveAttribute('aria-hidden');
  });
});

describe('WeatherAtCarWidget — unit conversion at the display boundary', () => {
  it('converts SI Celsius to Fahrenheit with the °F suffix', () => {
    unitsState.temperature = `${DEG}F` as '\u00B0C' | '\u00B0F';
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 0 })));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 0°C → 32°F, and the Celsius reading is never shown.
    expect(screen.getByText(`32${DEG}F`)).toBeInTheDocument();
    expect(screen.queryByText(`0${DEG}C`)).not.toBeInTheDocument();
  });

  it('applies the conversion to a warm reading as well', () => {
    unitsState.temperature = `${DEG}F` as '\u00B0C' | '\u00B0F';
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 25 })));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // 25°C → 77°F.
    expect(screen.getByText(`77${DEG}F`)).toBeInTheDocument();
  });
});

describe('WeatherAtCarWidget — coordinate finite-guard', () => {
  it('omits the coordinate line when latitude/longitude are non-finite', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(
        makeState({ outside_temp: 12, latitude: Number.NaN, longitude: Number.NaN }),
      ),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Temperature still renders; the coord line is dropped rather than
    // printing "NaN°, NaN°".
    expect(screen.getByText(`12${DEG}C`)).toBeInTheDocument();
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
  });
});

describe('WeatherAtCarWidget — loading / empty / error', () => {
  it('shows a skeleton while loading (no temperature, no empty state)', () => {
    mockUseVehicleState.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    const { container } = renderWidget({ size: { cols: 2, rows: 2 } });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No weather data')).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Weather at Car' })).not.toBeInTheDocument();
  });

  it('shows the labelled empty state (not a blank panel) when no state has arrived', () => {
    mockUseVehicleState.mockReturnValue(stateQuery(undefined));
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Title still renders; the body degrades to a labelled empty state.
    expect(screen.getByRole('heading', { name: 'Weather at Car' })).toBeInTheDocument();
    expect(screen.getByText('No weather data')).toBeInTheDocument();
  });

  it('treats a non-finite reading as no-data instead of rendering a fictional 0°', () => {
    // Regression guard: NaN used to coalesce through fmtInt to a confident "0°".
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: Number.NaN })));
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No weather data')).toBeInTheDocument();
    expect(screen.queryByText(`0${DEG}C`)).not.toBeInTheDocument();
  });

  it('treats a null reading as no-data (state present but temp missing)', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ outside_temp: null as unknown as number })),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    expect(screen.getByText('No weather data')).toBeInTheDocument();
  });

  it('surfaces a real error panel instead of the empty state on initial-load failure', () => {
    mockUseVehicleState.mockReturnValue(
      makeQuery({ data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Honest error panel from WidgetShell (QueryError), not "No weather data".
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No weather data')).not.toBeInTheDocument();
  });

  it('keeps a cached reading on screen when a background refetch errors', () => {
    mockUseVehicleState.mockReturnValue(
      stateQuery(makeState({ outside_temp: 17 }), { isError: true, error: new Error('boom') }),
    );
    renderWidget({ size: { cols: 2, rows: 2 } });

    // Data present → the error is a subtle freshness signal, not a full panel.
    expect(screen.getByText(`17${DEG}C`)).toBeInTheDocument();
    expect(screen.queryByText("Can't reach server")).not.toBeInTheDocument();
  });
});

describe('WeatherAtCarWidget — refresh + vehicle resolution', () => {
  it('refetches vehicle state when the refresh control is activated', () => {
    const refetch = vi.fn();
    mockUseVehicleState.mockReturnValue(stateQuery(makeState({ outside_temp: 20 }), { refetch }));
    renderWidget({ size: { cols: 2, rows: 2 } });

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('queries state for the vehicleId prop (with the 30s live interval)', () => {
    renderWidget({ vehicleId: 7 });
    expect(mockUseVehicleState).toHaveBeenCalledWith(7, { refetchInterval: 30_000 });
  });

  it('falls back to the first vehicle id when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue({ data: [{ id: 42 }] });
    renderWidget();
    expect(mockUseVehicleState).toHaveBeenCalledWith(42, { refetchInterval: 30_000 });
  });

  it('passes id 0 (disabling the query) when no vehicle is available', () => {
    mockUseVehicles.mockReturnValue({ data: [] });
    renderWidget();
    expect(mockUseVehicleState).toHaveBeenCalledWith(0, { refetchInterval: 30_000 });
  });
});
