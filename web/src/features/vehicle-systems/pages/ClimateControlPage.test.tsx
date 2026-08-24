/**
 * ClimateControlPage — orchestration, unit-boundary, resilience & a11y tests.
 *
 * ClimateControlPage fans three hooks (`useClimate`, `useClimateHistory`,
 * `useChargingTelemetryLatest`) into a full climate dashboard: an HVAC status
 * banner, temperature gauges + thermal-comfort derivation, a climate-systems
 * metric grid, protection cards, seat-heater / cooling cards, efficiency stats,
 * history charts, and a sortable history table. Every temperature is stored SI
 * (°C) and converted at the render boundary via `useUnits()` + `convertTempFromSI`.
 *
 * Strategy:
 *   - The three data hooks + `useSelectedVehicle` are mocked at the hook
 *     boundary so every branch (active / empty / loading / error) is
 *     deterministic and no network is touched.
 *   - `useUnits` renders for real; a file-level `useSettings` mock with a
 *     flippable temperature preference exercises BOTH the °C and °F display
 *     branches through the real `convertTempFromSI` boundary.
 *   - The AI recommender is replaced with a prop-surfacing double so the page's
 *     own wiring (selected vehicle id + SI cabin/outside/target temps) is
 *     asserted without pulling in the AI-off contract machinery (covered by its
 *     own suite).
 *
 * This suite also guards a real bug fixed alongside it: `heatStyle` did not
 * round its level (unlike `coolStyle`), so a fractional Fleet-Telemetry heat
 * level produced `undefined` and crashed the card reading `.color`/`.label`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: echo the fallback when present, else the key (the page's keys are
// the English strings themselves), so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown) =>
      typeof fallback === 'string' ? fallback : key,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// Flippable temperature preference so one file exercises both the metric (°C)
// and imperial (°F) display-conversion branches. Hoisted so the settings
// factory can close over it.
const unitState = vi.hoisted(() => ({ temp: 'C' as 'C' | 'F' }));

// File-level useSettings mock (overrides the global test-setup stub) so the
// real `useUnits()` derives its temperature pref from a flippable preference.
vi.mock('@/hooks/useSettings', () => {
  const settings = () => ({
    unit_of_length: 'km' as const,
    unit_of_temp: unitState.temp,
    unit_of_pressure: 'bar' as const,
    preferred_range: 'rated' as const,
    language: 'en',
    base_cost_per_kwh: 0.12,
    api_suspended: false,
    theme: 'neon-cyan',
    mode: 'dark' as const,
    custom_primary: '#00b4d8',
    custom_accent: '#e63946',
    gas_price_per_unit: 0,
    gas_unit: 'gallon' as const,
    gas_efficiency_mpg: 25,
    decimal_precision: 2,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    alert_digest_mode: 'instant' as const,
    currency_symbol: '$',
    locale: 'en-US',
    tz_display_default: 'vehicle' as const,
    timezone_user: '',
    tab_badge_enabled: true,
    critical_flash_enabled: true,
    ui_density: 'comfortable' as const,
    time_format_default: 'relative' as const,
    chart_palette: 'cb_safe' as const,
    ai_mode: 'off' as const,
    ai_features: {},
    ai_provider_config: {},
    ai_cost_cap_cents: 0,
  });
  return {
    useSettings: () => ({
      settings: settings(),
      isMiles: false,
      isFahrenheit: unitState.temp === 'F',
      isPSI: false,
      decimals: 2,
      locale: 'en-US',
      density: 'comfortable' as const,
      rangeType: 'rated' as const,
    }),
  };
});

// Data hooks + selection mocked at the boundary. `...actual` keeps every
// non-overridden export intact for transitive importers.
vi.mock('@/api/hooks/useVehicleSystems', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicleSystems')>();
  return { ...actual, useClimate: vi.fn(), useClimateHistory: vi.fn() };
});
vi.mock('@/api/hooks/useVehicles', async (importActual) => {
  const actual = await importActual<typeof import('@/api/hooks/useVehicles')>();
  return { ...actual, useChargingTelemetryLatest: vi.fn() };
});
vi.mock('@/hooks/useSelectedVehicle', async (importActual) => {
  const actual = await importActual<typeof import('@/hooks/useSelectedVehicle')>();
  return { ...actual, useSelectedVehicle: vi.fn() };
});

// AI recommender double — surfaces the props the page computes so the wiring
// (selected vehicle + SI cabin/outside/target temps) can be asserted directly.
vi.mock('@/components/ai/AIPreheatPrecoolRecommender', () => ({
  AIPreheatPrecoolRecommender: (p: {
    vehicleId?: number;
    currentCabinTempC: number | null;
    outsideTempC: number | null;
    targetCabinTempC: number;
    departBy: string;
  }) => (
    <div
      data-testid="ai-recommender"
      data-vehicle={String(p.vehicleId)}
      data-cabin={String(p.currentCabinTempC)}
      data-outside={String(p.outsideTempC)}
      data-target={String(p.targetCabinTempC)}
      data-depart={p.departBy}
    />
  ),
}));

// jsdom lacks matchMedia; framer-motion (via <FadeIn>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

import { useClimate, useClimateHistory } from '@/api/hooks/useVehicleSystems';
import { useChargingTelemetryLatest } from '@/api/hooks/useVehicles';
import { useSelectedVehicle } from '@/hooks/useSelectedVehicle';
import type { ClimateState } from '@/types/vehicle-systems';
import ClimateControlPage from './ClimateControlPage';

const mockClimate = vi.mocked(useClimate);
const mockClimateHistory = vi.mocked(useClimateHistory);
const mockCharging = vi.mocked(useChargingTelemetryLatest);
const mockSelectedVehicle = vi.mocked(useSelectedVehicle);

/** Minimal `UseQueryResult`-shaped stub (incl. DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isError: false,
    isStale: false,
    isFetching: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

/** An "active HVAC" climate snapshot with every branch populated. */
function climate(over: Partial<ClimateState> = {}): ClimateState {
  return {
    id: 1,
    timestamp: '2025-06-15T12:00:00Z',
    insideTemp: 22,
    outsideTemp: 15,
    driverTempSetting: 21,
    passengerTempSetting: 20,
    hvacPower: true,
    isAcOn: true,
    hvacAutoMode: 'On',
    fanSpeed: 5,
    hvacFanStatus: 3,
    climateKeeperMode: 'Dog Mode',
    defrostMode: 'Normal',
    defrostForPreconditioning: true,
    rearDefrostEnabled: true,
    wiperHeatEnabled: true,
    rearDisplayHvacEnabled: true,
    batteryHeater: true,
    overheatProtection: 'On',
    cabinOverheatProtectionTempLimit: '40',
    hvacSteeringWheelHeatAuto: true,
    hvacSteeringWheelHeatLevel: 2,
    seatHeaterLeft: 3,
    seatHeaterRight: 2,
    seatHeaterRearLeft: 1,
    seatHeaterRearCenter: 0,
    seatHeaterRearRight: 1,
    autoSeatClimateLeft: true,
    autoSeatClimateRight: false,
    climateSeatCoolingFrontLeft: 2,
    climateSeatCoolingFrontRight: 0,
    seatVentEnabled: true,
    ...over,
  };
}

// Two history samples: fan 4/6 (avg 5, peak 6), AC on/off (50% duty),
// inside 18/20 → distinctive `.0` cells for unit-boundary assertions.
const HISTORY: ClimateState[] = [
  climate({
    id: 10,
    timestamp: '2025-06-15T10:00:00Z',
    insideTemp: 18,
    outsideTemp: 12,
    driverTempSetting: 21,
    fanSpeed: 4,
    isAcOn: true,
    climateKeeperMode: undefined,
  }),
  climate({
    id: 11,
    timestamp: '2025-06-15T11:00:00Z',
    insideTemp: 20,
    outsideTemp: 14,
    driverTempSetting: 21,
    fanSpeed: 6,
    isAcOn: false,
    climateKeeperMode: undefined,
  }),
];

interface Install {
  latest?: ClimateState;
  latestOpts?: Record<string, unknown>;
  history?: ClimateState[];
  historyOpts?: Record<string, unknown>;
  charging?: unknown;
}

function install({ latest, latestOpts, history, historyOpts, charging }: Install = {}) {
  mockSelectedVehicle.mockReturnValue({
    vehicleId: 1,
    vehicle: null,
    vehicles: [{ id: 1, display_name: 'Test Car', vin: 'VIN1' }] as any,
    setVehicleId: vi.fn(),
  });
  mockClimate.mockReturnValue(qr({ data: latest, ...latestOpts }));
  mockClimateHistory.mockReturnValue(qr({ data: history, ...historyOpts }));
  mockCharging.mockReturnValue(qr({ data: charging ?? null }));
}

function renderPage() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <ClimateControlPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** Scope a MetricCard by its (unique) label. */
function card(label: string): HTMLElement {
  const wrapper = screen.getByText(label).closest('[data-role="metric-card"]');
  if (!wrapper) throw new Error(`MetricCard wrapper not found for "${label}"`);
  return wrapper as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  unitState.temp = 'C';
});

describe('ClimateControlPage — structure, wiring & a11y', () => {
  it('renders the title/subtitle/vehicle picker and wires hooks with snake_case-safe ids', () => {
    install({ latest: climate(), history: HISTORY });
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Climate Control' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('HVAC status, temperatures, and seat heaters'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Climate Control');

    // VehicleSelect renders a labelled combobox (fleet has ≥1 vehicle).
    expect(screen.getByRole('combobox', { name: 'Select vehicle' })).toBeInTheDocument();

    // Climate hooks take the string id; charging telemetry takes the numeric id.
    expect(mockClimate).toHaveBeenCalledWith('1');
    expect(mockClimateHistory).toHaveBeenCalledWith('1');
    expect(mockCharging).toHaveBeenCalledWith(1);
  });

  it('passes the selected vehicle + SI cabin/outside/target temps to the AI recommender', () => {
    install({ latest: climate({ insideTemp: 22, outsideTemp: 15, driverTempSetting: 21 }) });
    renderPage();

    const ai = screen.getByTestId('ai-recommender');
    expect(ai).toHaveAttribute('data-vehicle', '1');
    expect(ai).toHaveAttribute('data-cabin', '22'); // raw SI °C — no conversion at the AI boundary
    expect(ai).toHaveAttribute('data-outside', '15');
    expect(ai).toHaveAttribute('data-target', '21');
    expect(ai.getAttribute('data-depart')).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('ClimateControlPage — active HVAC (happy path)', () => {
  beforeEach(() => {
    install({
      latest: climate(),
      history: HISTORY,
      charging: { not_enough_power_to_heat: true },
    });
  });

  it('shows the active HVAC banner with keeper / defrost / battery-heater / power chips', () => {
    renderPage();

    expect(screen.getByText('HVAC System')).toBeInTheDocument();
    // keeper appears in the banner chip AND the climate-systems card.
    expect(screen.getAllByText('Dog Mode').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    // battery-heater appears in the banner chip AND the protection card.
    expect(screen.getAllByText('Battery Heater').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Insufficient Power to Heat')).toBeInTheDocument();
  });

  it('renders climate-system + protection metrics from the latest state', () => {
    renderPage();

    expect(within(card('HVAC Power')).getByText('On')).toBeInTheDocument();
    expect(within(card('HVAC Power')).getByText('State: On')).toBeInTheDocument();
    expect(within(card('Fan Speed')).getByText('5')).toBeInTheDocument();
    // heatStyle(2) → "Medium" for the steering-wheel heat level.
    expect(within(card('Steering Wheel Heat Level')).getByText('Medium')).toBeInTheDocument();
    expect(within(card('Overheat Protection')).getByText('On')).toBeInTheDocument();
    // passenger set temp converts + carries the °C suffix.
    expect(within(card('Passenger Setting')).getByText('20.0°C')).toBeInTheDocument();
  });

  it('renders seat-heater levels, cooling ventilation and auto-climate chips', () => {
    renderPage();
    const region = screen.getByRole('region', { name: 'Comfort & Efficiency' });

    // Front-left seat heater at level 3 → "High (3/3)".
    expect(within(region).getByText('High (3/3)')).toBeInTheDocument();
    expect(within(region).getByText(/Ventilation:\s*On/)).toBeInTheDocument();

    // Auto-climate: left is auto, right is manual.
    const leftChip = within(region).getByText('Auto Climate (Left)').closest('div')!;
    expect(within(leftChip).getByText('Auto')).toBeInTheDocument();
    const rightChip = within(region).getByText('Auto Climate (Right)').closest('div')!;
    expect(within(rightChip).getByText('Manual')).toBeInTheDocument();
  });

  it('derives comfort score/delta and history-driven efficiency stats', () => {
    renderPage();
    const overview = screen.getByRole('region', { name: 'Climate Overview' });
    const efficiency = screen.getByRole('region', { name: 'Comfort & Efficiency' });

    // inside 22, set 21 → |Δ|=1 → score 90, delta +1, near target, excellent.
    expect(within(overview).getByText('90')).toBeInTheDocument();
    expect(within(overview).getByText('+1')).toBeInTheDocument();
    expect(within(overview).getByText('Near Target')).toBeInTheDocument();
    expect(within(overview).getByText('Excellent')).toBeInTheDocument();

    // efficiency: avg fan 5.0, peak 6.0, AC-on 50%, comfort 90%.
    expect(within(efficiency).getByText('5.0')).toBeInTheDocument();
    expect(within(efficiency).getByText('6.0')).toBeInTheDocument();
    expect(within(efficiency).getByText('50%')).toBeInTheDocument();
    expect(within(efficiency).getByText('90%')).toBeInTheDocument();
  });

  it('renders the history table with °C-converted cells', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByText('18.0')).toBeInTheDocument(); // inside row (10:00)
    expect(within(table).getByText('14.0')).toBeInTheDocument(); // outside row (11:00)
    expect(screen.getByRole('button', { name: 'Inside °C' })).toBeInTheDocument();
  });
});

describe('ClimateControlPage — imperial (°F) unit boundary', () => {
  it('converts temperatures to °F at the display boundary only', () => {
    unitState.temp = 'F';
    install({ latest: climate(), history: HISTORY });
    renderPage();

    // 20 °C → 68 °F on the passenger card (suffix flips with the preference).
    expect(within(card('Passenger Setting')).getByText('68.0°F')).toBeInTheDocument();
    // history: 18 °C → 64.4 °F cell; header unit flips to °F.
    const table = screen.getByRole('table');
    expect(within(table).getByText('64.4')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Inside °F' })).toBeInTheDocument();
    // The AI boundary still receives raw SI °C, regardless of display prefs.
    expect(screen.getByTestId('ai-recommender')).toHaveAttribute('data-cabin', '22');
  });
});

describe('ClimateControlPage — loading, empty & error states', () => {
  it('shows skeletons (and no metric cards) while latest is loading', () => {
    install({ latestOpts: { isLoading: true }, historyOpts: { isLoading: true } });
    const { container } = renderPage();

    // Shell still renders; the section heading stays put so layout doesn't jump.
    expect(screen.getByRole('heading', { level: 1, name: 'Climate Control' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Climate Systems' })).toBeInTheDocument();
    // …but its metric cards are replaced by pulse skeletons.
    expect(screen.queryByText('HVAC Power')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
  });

  it('renders placeholders (never a blank panel) when latest resolves empty', () => {
    install({ latest: undefined, history: [] });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Climate Systems' })).toBeInTheDocument();
    // Nullish values collapse to explicit off/zero placeholders — no crash.
    expect(within(card('HVAC Power')).getByText('Off')).toBeInTheDocument();
    expect(within(card('Fan Speed')).getByText('0')).toBeInTheDocument();
    // Gauges + charts + table show their own empty states.
    const overview = screen.getByRole('region', { name: 'Climate Overview' });
    expect(within(overview).getByText('Inside Temp')).toBeInTheDocument();
    expect(screen.getByText('No temperature history available.')).toBeInTheDocument();
    expect(screen.getByText('No HVAC history available.')).toBeInTheDocument();
    expect(screen.getByText('No history records found.')).toBeInTheDocument();
    // AI boundary receives null cabin/outside temps when there is no snapshot.
    expect(screen.getByTestId('ai-recommender')).toHaveAttribute('data-cabin', 'null');
  });

  it('surfaces a query-error banner without gating the rest of the page', () => {
    install({ latest: undefined, latestOpts: { error: new Error('boom'), isError: true } });
    renderPage();

    const banner = screen.getByText(/Failed to load climate data/);
    expect(banner).toBeInTheDocument();
    expect(banner.textContent).toContain('boom');
    // The deterministic bands still render beneath the error banner.
    expect(within(card('HVAC Power')).getByText('Off')).toBeInTheDocument();
  });
});

describe('ClimateControlPage — interactions', () => {
  it('refetches the latest snapshot when Refresh is clicked', () => {
    const refetch = vi.fn();
    install({ latest: climate(), latestOpts: { refetch }, history: HISTORY });
    renderPage();

    // The page's own Refresh <button> carries visible text; the freshness chip
    // shares the "Refresh" accessible name but has no visible label.
    fireEvent.click(screen.getByText('Refresh').closest('button') as HTMLButtonElement);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('re-sorts the history table when a sortable header is clicked', () => {
    const sortRows: ClimateState[] = [
      climate({ id: 20, timestamp: '2025-06-15T09:00:00Z', insideTemp: 30 }),
      climate({ id: 21, timestamp: '2025-06-15T12:00:00Z', insideTemp: 10 }),
    ];
    install({ latest: climate(), history: sortRows });
    renderPage();

    const table = screen.getByRole('table');
    const firstInsideCell = () =>
      within(within(table).getAllByRole('row')[1]).getAllByRole('cell')[1];

    // Default sort = timestamp desc → 12:00 sample (inside 10) is first.
    expect(firstInsideCell()).toHaveTextContent('10.0');

    // Sort by "Inside" → desc puts the hottest (30) on top.
    fireEvent.click(screen.getByRole('button', { name: 'Inside °C' }));
    expect(firstInsideCell()).toHaveTextContent('30.0');
  });
});

describe('ClimateControlPage — heatStyle rounding (regression)', () => {
  it('rounds fractional heat levels instead of returning undefined (no crash)', () => {
    // Before the fix `heatStyle(2.6)` indexed HEAT_LEVELS[2.6] === undefined and
    // crashed on `.label`; the card would vanish behind the error boundary.
    install({
      latest: climate({ hvacSteeringWheelHeatLevel: 2.6, seatHeaterRight: 1.6 }),
      history: HISTORY,
    });
    renderPage();

    // 2.6 → 3 → "High"; subtitle rounds too (Level 3).
    const swCard = card('Steering Wheel Heat Level');
    expect(within(swCard).getByText('High')).toBeInTheDocument();
    expect(within(swCard).getByText('Level 3')).toBeInTheDocument();
    // Front-right seat heater 1.6 → 2 → "Medium (2/3)".
    expect(screen.getByText('Medium (2/3)')).toBeInTheDocument();
  });
});
