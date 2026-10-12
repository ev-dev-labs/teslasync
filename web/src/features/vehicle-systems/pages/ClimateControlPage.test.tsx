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
import { render, screen, within, fireEvent, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode, ComponentProps } from 'react';
import type { EmbeddedChartProps } from '@/components/charts';
import type { DataTable } from '@/components/ui';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';
import { formatDateTime } from '@/lib/dateFormat';
import { neonColorMap, typography } from '@/lib/tokens';
import { buildMobileTableRow } from '@/components/ui/MobileDataTableAdapter';

const presentationSpies = vi.hoisted(() => ({
  chart: vi.fn<(props: EmbeddedChartProps) => void>(),
  table: vi.fn<(props: ComponentProps<typeof DataTable<ClimateState>>) => void>(),
}));

vi.mock('@/components/charts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/charts')>();
  const { chartTestDoubles } = await import('@/test/chartTestDoubles');
  return {
    ...actual,
    ...chartTestDoubles,
    EmbeddedChart: (props: ComponentProps<typeof actual.EmbeddedChart>) => {
      presentationSpies.chart(props);
      return <chartTestDoubles.EmbeddedChart {...props} />;
    },
  };
});

vi.mock('@/components/ui', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return {
    ...actual,
    DataTable: (props: ComponentProps<typeof actual.DataTable<ClimateState>>) => {
      presentationSpies.table(props);
      return <actual.DataTable {...props} />;
    },
  };
});

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
      <MemoryRouter initialEntries={['/climate-control']}>
        <ClimateControlPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const metricLabelSelector = '[data-operational-metric] > div:first-child > div:first-child';

/** Scope the visible metric label, not its duplicate evidence description. */
function card(label: string): HTMLElement {
  const wrapper = screen.getByText(label, { selector: metricLabelSelector })
    .closest<HTMLElement>('[data-operational-metric]');
  if (!wrapper) throw new Error(`Canonical stat wrapper not found for "${label}"`);
  return wrapper;
}

function group(id: string): HTMLElement {
  const wrapper = document.querySelector<HTMLElement>(`[data-climate-group="${id}"]`);
  if (!wrapper) throw new Error(`Climate group not found: ${id}`);
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
  unitState.temp = 'C';
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
});

it('keeps temperature-delta classification raw while locale and precision change live', () => {
  setGlobalLocale('en-US');
  setGlobalPrecision(2);
  const latest = climate({ insideTemp: 22.2345, driverTempSetting: 21 });
  install({ latest, history: HISTORY });
  const view = renderPage();
  expect(within(card('Temp delta')).getByText('+1.23°C')).toBeInTheDocument();
  expect(screen.getByText('Above target')).toBeInTheDocument();
  try {
    act(() => setGlobalLocale('de-DE'));
    expect(within(card('Temp delta')).getByText('+1,23°C')).toBeInTheDocument();
    expect(screen.getByText('Above target')).toBeInTheDocument();
    act(() => setGlobalPrecision(0));
    expect(within(card('Temp delta')).getByText('+1°C')).toBeInTheDocument();
    expect(screen.getByText('Above target')).toBeInTheDocument();
    expect(screen.queryByText('Near target')).not.toBeInTheDocument();
    expect(latest.insideTemp).toBe(22.2345);
    expect(latest.driverTempSetting).toBe(21);
  } finally {
    view.unmount();
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
  }
});

describe('ClimateControlPage — structure, wiring & a11y', () => {
  it('renders the title/subtitle and wires shared vehicle context to the hooks', () => {
    install({ latest: climate(), history: HISTORY });
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: 'Climate control' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('HVAC status, temperatures, and seat heaters'),
    ).toBeInTheDocument();
    expect(document.title).toContain('Climate control');

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();

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

    expect(within(group('climate-status')).getByRole('heading', { name: 'HVAC system' }))
      .toBeInTheDocument();
    // keeper appears in the banner chip AND the climate-systems card.
    expect(screen.getAllByText('Dog mode').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Defrost')).toBeInTheDocument();
    // battery-heater appears in the banner chip AND the protection card.
    expect(screen.getAllByText('Battery heater').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Insufficient power to heat')).toBeInTheDocument();
  });

  it('renders climate-system + protection metrics from the latest state', () => {
    renderPage();

    expect(within(card('HVAC power')).getByText('On')).toBeInTheDocument();
    expect(within(card('HVAC power')).getByText('State: On')).toBeInTheDocument();
    expect(within(card('Fan speed')).getByText('5')).toBeInTheDocument();
    // heatStyle(2) → "Medium" for the steering-wheel heat level.
    expect(within(card('Steering wheel heat level')).getByText('Medium')).toBeInTheDocument();
    expect(within(card('Overheat protection')).getByText('On')).toBeInTheDocument();
    // passenger set temp converts + carries the °C suffix.
    expect(within(card('Passenger setting')).getByText('20.00°C')).toBeInTheDocument();
  });

  it('renders seat-heater levels, cooling ventilation and auto-climate chips', () => {
    renderPage();
    const region = group('climate-seats');

    // Front-left seat heater at level 3 → "High (3/3)".
    expect(within(region).getByText('High (3/3)')).toBeInTheDocument();
    expect(within(region).getByText(/Ventilation:\s*On/)).toBeInTheDocument();

    // Auto-climate: left is auto, right is manual.
    const leftChip = within(region).getByText('Auto climate (left)').closest('div')!;
    expect(within(leftChip).getByText('Auto')).toBeInTheDocument();
    const rightChip = within(region).getByText('Auto climate (right)').closest('div')!;
    expect(within(rightChip).getByText('Manual')).toBeInTheDocument();
  });

  it('derives comfort score/delta and history-driven efficiency stats', () => {
    renderPage();
    const overview = group('climate-comfort');
    const efficiency = group('climate-efficiency');

    // inside 22, set 21 → |Δ|=1 → score 90, delta +1, near target, excellent.
    expect(within(overview).getByText('90.00')).toBeInTheDocument();
    expect(within(overview).getByText('+1.00°C')).toBeInTheDocument();
    expect(within(overview).getByText('Near target')).toBeInTheDocument();
    expect(within(overview).getByText('Excellent')).toBeInTheDocument();

    // efficiency: avg fan 5.0, peak 6.0, AC-on 50%, comfort 90%.
    expect(within(efficiency).getByText('5.00')).toBeInTheDocument();
    expect(within(efficiency).getByText('6.00')).toBeInTheDocument();
    expect(within(efficiency).getByText('50.00%')).toBeInTheDocument();
    expect(within(efficiency).getByText('90.00%')).toBeInTheDocument();
  });

  it('renders the history table with °C-converted cells', () => {
    renderPage();
    const table = screen.getByRole('table');
    expect(within(table).getByText('18.00')).toBeInTheDocument(); // inside row (10:00)
    expect(within(table).getByText('14.00')).toBeInTheDocument(); // outside row (11:00)
    expect(screen.getByRole('button', { name: 'Inside °C' })).toBeInTheDocument();
  });
});

describe('ClimateControlPage — imperial (°F) unit boundary', () => {
  it('converts temperatures to °F at the display boundary only', () => {
    unitState.temp = 'F';
    install({ latest: climate(), history: HISTORY });
    renderPage();

    // 20 °C → 68 °F on the passenger card (suffix flips with the preference).
    expect(within(card('Passenger setting')).getByText('68.00°F')).toBeInTheDocument();
    // history: 18 °C → 64.4 °F cell; header unit flips to °F.
    const table = screen.getByRole('table');
    expect(within(table).getByText('64.40')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { level: 1, name: 'Climate control' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Climate systems' })).toBeInTheDocument();
    // …but its metric cards are replaced by static source-shaped skeletons.
    expect(screen.queryByText('HVAC power')).not.toBeInTheDocument();
    expect(container.querySelectorAll('[class*="--skeleton-bg"]').length).toBeGreaterThan(0);
  });

  it('renders placeholders (never a blank panel) when latest resolves empty', () => {
    install({ latest: undefined, history: [] });
    renderPage();

    expect(screen.getByRole('heading', { name: 'Climate systems' })).toBeInTheDocument();
    // Missing measurements are unknown, not observed off/zero values.
    expect(within(card('HVAC power')).getByText('—')).toBeInTheDocument();
    expect(within(card('Fan speed')).getByText('—')).toBeInTheDocument();
    expect(within(card('HVAC power')).queryByText('Off')).not.toBeInTheDocument();
    expect(within(card('Fan speed')).queryByText('0')).not.toBeInTheDocument();
    // Gauges + charts + table show their own empty states.
    const overview = group('climate-temperature');
    expect(within(overview).getByText('Inside temp')).toBeInTheDocument();
    expect(screen.getByText('No temperature history has been recorded.')).toBeInTheDocument();
    expect(screen.getByText(/Cabin, ambient, and set-point trends/)).toBeInTheDocument();
    expect(screen.getByText('No HVAC operating history has been recorded.')).toBeInTheDocument();
    expect(screen.getByText(/AC state and fan-speed trends/)).toBeInTheDocument();
    expect(screen.getByText('No climate history has been recorded.')).toBeInTheDocument();
    expect(screen.getByText(/Climate snapshots accumulate/)).toBeInTheDocument();
    // AI boundary receives null cabin/outside temps when there is no snapshot.
    expect(screen.getByTestId('ai-recommender')).toHaveAttribute('data-cabin', 'null');
  });

  it('surfaces a query-error banner without gating the rest of the page', () => {
    const retry = vi.fn();
    install({
      latest: undefined,
      latestOpts: { error: new Error('boom'), isError: true, refetch: retry },
      history: HISTORY,
    });
    renderPage();

    const systems = within(group('climate-systems'));
    const banner = systems.getByText(/Failed to load climate data/);
    expect(banner).toBeInTheDocument();
    expect(systems.getByText("Can't reach server")).toBeInTheDocument();
    fireEvent.click(systems.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    // Only the failed source is replaced; independent history remains visible.
    expect(systems.queryByText('HVAC power', { selector: metricLabelSelector }))
      .not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(within(card('Avg fan speed')).getByText('5.00')).toBeInTheDocument();
  });

  it('preserves measured zero and false values rather than replacing them with unknown', () => {
    install({
      latest: climate({ hvacPower: false, isAcOn: false, fanSpeed: 0, passengerTempSetting: 0 }),
      history: HISTORY,
    });
    renderPage();

    expect(within(card('HVAC power')).getByText('Off')).toBeInTheDocument();
    expect(within(card('HVAC power')).getByText('State: Off')).toBeInTheDocument();
    expect(within(card('Fan speed')).getByText('0')).toBeInTheDocument();
    expect(within(card('Passenger setting')).getByText('0.00°C')).toBeInTheDocument();
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
    expect(firstInsideCell()).toHaveTextContent('10.00');

    // Sort by "Inside" → desc puts the hottest (30) on top.
    fireEvent.click(screen.getByRole('button', { name: 'Inside °C' }));
    expect(firstInsideCell()).toHaveTextContent('30.00');
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
    const swCard = card('Steering wheel heat level');
    expect(within(swCard).getByText('High')).toBeInTheDocument();
    expect(within(swCard).getByText('Level 3')).toBeInTheDocument();
    // Front-right seat heater 1.6 → 2 → "Medium (2/3)".
    expect(screen.getByText('Medium (2/3)')).toBeInTheDocument();
  });
});

describe('ClimateControlPage — independent charging source registry', () => {
  function chargingSourceRow(): HTMLElement {
    const row = screen.getByText('Charging telemetry', { selector: 'li > span' }).closest('li');
    if (!row) throw new Error('Charging telemetry source row not found');
    return row;
  }

  it('reports charging loading independently while climate readings and history stay visible', () => {
    install({ latest: climate(), history: HISTORY });
    mockCharging.mockReturnValue(qr({
      isLoading: true,
      isPending: true,
      isFetching: true,
      fetchStatus: 'fetching',
    }));
    const { container } = renderPage();

    expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
    expect(within(chargingSourceRow()).getByText('Loading')).toBeInTheDocument();
    expect(within(chargingSourceRow()).queryByRole('button')).not.toBeInTheDocument();
    expect(within(card('HVAC power')).getByText('On')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });

  describe('ClimateControlPage — restrained complete presentation', () => {
    it('keeps all eleven sections and every read-only action through a retained refresh failure', () => {
      const retry = vi.fn();
      const latest = climate();
      install({
        latest,
        latestOpts: { isError: true, error: new Error('refresh failed'), refetch: retry },
        history: HISTORY,
        historyOpts: { isError: true, error: new Error('history refresh failed') },
      });
      const { container } = renderPage();

      expect(Array.from(container.querySelectorAll('[data-climate-group]'), node =>
        node.getAttribute('data-climate-group'))).toEqual([
        'climate-ai', 'climate-status', 'climate-temperature', 'climate-comfort',
        'climate-systems', 'climate-protection', 'climate-seats', 'climate-efficiency',
        'climate-temperature-history', 'climate-hvac-history', 'climate-history-table',
      ]);
      expect(within(card('HVAC power')).getByText('On')).toBeInTheDocument();
      expect(within(card('Passenger setting')).getByText('20.00°C')).toBeInTheDocument();
      expect(within(group('climate-seats')).getByText('High (3/3)')).toBeInTheDocument();
      expect(screen.getByRole('table', { name: 'Climate history' })).toBeInTheDocument();
      expect(screen.getAllByTestId('embedded-chart')).toHaveLength(2);
      expect(within(group('climate-status')).getByText(/Showing retained measurements/)).toBeInTheDocument();
      fireEvent.click(screen.getByText('Refresh').closest('button')!);
      expect(retry).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: /apply|start climate|stop climate/i })).not.toBeInTheDocument();
      expect(latest.insideTemp).toBe(22);
      expect(latest.hvacPower).toBe(true);
    });

    it('uses container-aware comfort and seat grids without dropping positions or metadata', () => {
      install({ latest: climate(), history: HISTORY });
      renderPage();

      const comfortGrid = group('climate-comfort').querySelector('.grid')!;
      expect(comfortGrid).toHaveClass('grid-cols-1', '@2xl:grid-cols-3');
      const seatGrids = group('climate-seats').querySelectorAll('.grid');
      expect(seatGrids[0]).toHaveClass('grid-cols-1', '@sm:grid-cols-2', '@3xl:grid-cols-5');
      expect(seatGrids[0].children).toHaveLength(5);
      expect(seatGrids[1]).toHaveClass('grid-cols-1', '@lg:grid-cols-2');
      expect(seatGrids[2]).toHaveClass('grid-cols-1', '@sm:grid-cols-2');
      expect(seatGrids[2].children).toHaveLength(2);
      expect(within(group('climate-seats')).getByText('Rear center')).toBeInTheDocument();
      expect(within(group('climate-seats')).getByText('Auto climate (right)')).toBeInTheDocument();
      expect(within(group('climate-seats')).getByText(/Ventilation:\s*On/)).toBeInTheDocument();
      expect(within(group('climate-seats')).getByText('3 — High')).toBeInTheDocument();
    });

    it('uses neutral decorative icons and semantic heat levels instead of fixed saturated paint', () => {
      install({ latest: climate(), history: HISTORY });
      const { container } = renderPage();

      expect(card('Fan speed').querySelector('svg')).toHaveClass(typography.color.secondary);
      expect(card('Overheat protection').querySelector('svg')).toHaveClass(typography.color.secondary);
      const hotSeat = within(group('climate-seats')).getByText('High (3/3)').parentElement!;
      expect(hotSeat.querySelector('svg')).toHaveClass(neonColorMap.red.text);
      expect(hotSeat.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('[class*="text-cyan-400"], [class*="text-amber-400"], [class*="text-red-400"]'))
        .not.toBeInTheDocument();
      expect(screen.getByText('Refresh').closest('button')).toHaveClass('min-h-11', 'min-w-11');
      expect(within(card('HVAC power')).queryByText(/\d+\s*(W|kW)\b/)).not.toBeInTheDocument();
    });

    it('provides exact chronological temperature and HVAC alternatives with unknown AC gaps and measured zero', () => {
      const rows = [
        climate({ id: 33, timestamp: '2025-06-15T12:00:00Z', insideTemp: null, isAcOn: undefined, fanSpeed: 0 }),
        ...HISTORY,
      ];
      install({ latest: climate(), history: rows });
      renderPage();

      const charts = presentationSpies.chart.mock.calls.map(([props]) => props);
      const temperatures = charts.find(props => props.chartKey === 'climate-temp-history')!;
      const hvac = charts.find(props => props.chartKey === 'climate-hvac-history')!;
      expect(temperatures.dataColumns!.map(column => column.key))
        .toEqual(['timestamp', 'insideTemp', 'outsideTemp', 'driverTempSetting']);
      expect(hvac.dataColumns!.map(column => column.key))
        .toEqual(['timestamp', 'acActive', 'fanSpeed']);
      expect(temperatures.data!.map(row => row.insideTemp))
        .toEqual([18, 20, null]);
      expect(hvac.data!.map(row => row.acActive))
        .toEqual([1, 0, null]);
      expect(hvac.data!.map(row => row.fanSpeed)).toEqual([4, 6, 0]);
      const acFormat = hvac.dataColumns![1].format!;
      expect(acFormat(1)).toBe('On');
      expect(acFormat(0)).toBe('Off');
      expect(acFormat(null)).toBe('—');
      expect(rows[0].isAcOn).toBeUndefined();
      expect(rows[0].insideTemp).toBeNull();
      expect(rows.map(row => row.id)).toEqual([33, 10, 11]);
    });

    it('converts chart alternatives and complete mobile details to Fahrenheit without changing SI rows', () => {
      unitState.temp = 'F';
      install({ latest: climate(), history: HISTORY });
      renderPage();

      const props = presentationSpies.table.mock.lastCall![0];
      expect(props.tableId).toBe('vehicle-systems:climate-history');
      expect(props.enableValueFilters).toBe(true);
      expect(props.pagination).toBe(true);
      const mobile = buildMobileTableRow(HISTORY[0], 10, props.columns, props.mobilePresentation!, 'Climate history');
      expect(mobile.details).toEqual([
        { key: 'timestamp', label: 'Time', value: formatDateTime(HISTORY[0].timestamp!) },
        { key: 'insideTemp', label: 'Inside °F', value: '64.40 °F' },
        { key: 'outsideTemp', label: 'Outside °F', value: '53.60 °F' },
        { key: 'driverTempSetting', label: 'Set temp °F', value: '69.80 °F' },
        { key: 'fanSpeed', label: 'Fan', value: '4' },
        { key: 'isAcOn', label: 'HVAC', value: 'On' },
        { key: 'climateKeeperMode', label: 'Climate keeper', value: '—' },
      ]);
      const chart = presentationSpies.chart.mock.calls.find(([chartProps]) =>
        chartProps.chartKey === 'climate-temp-history')![0];
      expect(chart.data![0].insideTemp).toBe(64.4);
      expect(chart.dataColumns![1].label).toBe('Inside temp °F');
      expect(HISTORY[0].insideTemp).toBe(18);
      expect(screen.getByTestId('ai-recommender')).toHaveAttribute('data-cabin', '22');
    });

    it('keeps unknown mobile operating fields distinct from measured off and zero', () => {
      const history = [
        climate({ isAcOn: null, fanSpeed: null, driverTempSetting: null, climateKeeperMode: null }),
        climate({ id: 2, isAcOn: false, fanSpeed: 0, driverTempSetting: 0, climateKeeperMode: 'Off' }),
      ];
      install({ history });
      renderPage();
      const props = presentationSpies.table.mock.lastCall![0];
      const details = history.map(row => buildMobileTableRow(row, row.id!, props.columns,
        props.mobilePresentation!, 'Climate history').details.slice(3).map(field => field.value));
      expect(details[0]).toEqual(['—', '—', '—', '—']);
      expect(details[1]).toEqual(['0.00 °C', '0', 'Off', 'Off']);
    });
  });

  it('names an initial charging failure and retries only that source without replacing climate content', () => {
    const chargingRetry = vi.fn();
    const climateRetry = vi.fn();
    const historyRetry = vi.fn();
    install({
      latest: climate(),
      latestOpts: { refetch: climateRetry },
      history: HISTORY,
      historyOpts: { refetch: historyRetry },
    });
    mockCharging.mockReturnValue(qr({
      error: new Error('charging unavailable'),
      isError: true,
      refetch: chargingRetry,
    }));
    const { container } = renderPage();

    expect(container.querySelector('[data-data-state="partial"]')).toBeInTheDocument();
    expect(within(chargingSourceRow()).getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Latest climate state', { selector: 'li > span' }).closest('li'))
      .toHaveTextContent('Ready');
    expect(screen.getByText('Climate history', { selector: 'li > span' }).closest('li'))
      .toHaveTextContent('Ready');
    expect(within(card('HVAC power')).getByText('On')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(within(chargingSourceRow()).getByRole('button', {
      name: 'Retry unavailable sources: Charging telemetry',
    }));
    expect(chargingRetry).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources', exact: true }));
    expect(chargingRetry).toHaveBeenCalledTimes(2);
    expect(climateRetry).not.toHaveBeenCalled();
    expect(historyRetry).not.toHaveBeenCalled();
  });

  it('retains the heating-power warning and reports cached charging data when its refresh fails', () => {
    const chargingRetry = vi.fn();
    const climateRetry = vi.fn();
    const historyRetry = vi.fn();
    const retained = { not_enough_power_to_heat: true };
    install({
      latest: climate(),
      latestOpts: { refetch: climateRetry },
      history: HISTORY,
      historyOpts: { refetch: historyRetry },
    });
    mockCharging.mockReturnValue(qr({
      data: retained,
      dataUpdatedAt: Date.parse('2025-06-15T12:00:00Z'),
      error: new Error('charging refresh failed'),
      isError: true,
      refetch: chargingRetry,
    }));
    const { container } = renderPage();

    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(within(chargingSourceRow()).getByText('Cached · refresh failed')).toBeInTheDocument();
    expect(within(group('climate-status')).getByText('Insufficient power to heat')).toBeInTheDocument();
    expect(within(card('HVAC power')).getByText('On')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(within(chargingSourceRow()).getByRole('button', {
      name: 'Retry unavailable sources: Charging telemetry',
    }));
    expect(chargingRetry).toHaveBeenCalledTimes(1);
    expect(climateRetry).not.toHaveBeenCalled();
    expect(historyRetry).not.toHaveBeenCalled();
    expect(retained).toEqual({ not_enough_power_to_heat: true });
  });

  it('reports a retained charging refresh in flight separately from delayed climate history', () => {
    install({
      latest: climate(),
      historyOpts: { isLoading: true, isFetching: true, fetchStatus: 'fetching' },
    });
    mockCharging.mockReturnValue(qr({
      data: { not_enough_power_to_heat: true },
      isFetching: true,
      fetchStatus: 'fetching',
    }));
    renderPage();

    expect(within(chargingSourceRow()).getByText('Refreshing')).toBeInTheDocument();
    expect(within(chargingSourceRow()).queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('Climate history', { selector: 'li > span' }).closest('li'))
      .toHaveTextContent('Loading');
    expect(within(group('climate-status')).getByText('Insufficient power to heat')).toBeInTheDocument();
    expect(within(card('HVAC power')).getByText('On')).toBeInTheDocument();
  });

  it('identifies paused charging refreshes while keeping the retained heating-power warning', () => {
    const chargingRetry = vi.fn();
    install({ latest: climate(), history: HISTORY });
    mockCharging.mockReturnValue(qr({
      data: { not_enough_power_to_heat: true },
      fetchStatus: 'paused',
      refetch: chargingRetry,
    }));
    const { container } = renderPage();

    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
    expect(within(chargingSourceRow()).getByText('Paused offline')).toBeInTheDocument();
    expect(within(group('climate-status')).getByText('Insufficient power to heat')).toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
    fireEvent.click(within(chargingSourceRow()).getByRole('button', {
      name: 'Retry unavailable sources: Charging telemetry',
    }));
    expect(chargingRetry).toHaveBeenCalledTimes(1);
  });

  it('omits the disabled charging source for a nonpositive vehicle without retrying it', () => {
    const chargingRetry = vi.fn();
    const climateRetry = vi.fn();
    install({
      latestOpts: { isError: true, error: new Error('climate unavailable'), refetch: climateRetry },
      history: HISTORY,
    });
    mockSelectedVehicle.mockReturnValue({
      vehicleId: 0,
      vehicle: null,
      vehicles: [],
      setVehicleId: vi.fn(),
    });
    mockCharging.mockReturnValue(qr({
      isError: true,
      error: new Error('disabled charging query'),
      refetch: chargingRetry,
    }));
    renderPage();

    expect(mockCharging).toHaveBeenCalledWith(0);
    expect(screen.queryByText('Charging telemetry')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', {
      name: 'Retry unavailable sources: Charging telemetry',
    })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources', exact: true }));
    expect(climateRetry).toHaveBeenCalledTimes(1);
    expect(chargingRetry).not.toHaveBeenCalled();
  });
});
