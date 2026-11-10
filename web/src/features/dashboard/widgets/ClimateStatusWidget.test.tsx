/**
 * ClimateStatusWidget — behaviour + hardening coverage.
 *
 * After redesign (Phase 2, widget-id climate-status): the widget renders the
 * latest climate/HVAC reading for the first (or explicitly selected) vehicle
 * inside a WidgetShell as one headline metric — the inside (cabin) temperature
 * via WidgetBigNumber (label "Inside") — plus a quieter "Outside <temp>" line
 * and a single HVAC status pill ("HVAC on" / "HVAC off" / "HVAC unknown").
 * The former OperationalBrief summary and the defrost / battery-heater status
 * grid are dropped per the After card; those fields no longer drive any UI.
 * Temperatures are converted to the user's unit at the render boundary. Every
 * data hook is mocked so the network is never touched, and `useUnits` is
 * stubbed with a deterministic temperature preference so the real
 * `convertTempFromSI` + `fmtInt` display math is exercised end-to-end.
 *
 * Facets covered:
 *   - populated render: Inside headline, Outside line, HVAC pill.
 *   - unit conversion: the same SI Celsius values render in °F when the
 *     preference flips, and the unit follows the preference (not the source).
 *   - designer drop: defrost / battery-heater chips never render, whatever the
 *     `defrost_mode` / `battery_heater` (or legacy `battery_heater_on`) fields
 *     say — the After card has no such elements.
 *   - hvac-power regression (R2): canonical boolean state renders as
 *     "HVAC on"/"HVAC off"; malformed non-boolean payloads collapse to
 *     "HVAC unknown".
 *   - null-safety: missing temps collapse to "—" without crashing or
 *     fabricating a zero.
 *   - empty state: the "No climate data" EmptyState (role="status") with the
 *     data rows withheld.
 *   - loading: WidgetShell skeleton with all content (header + body) withheld.
 *   - refresh: the freshness control refetches the climate query (a11y — the
 *     control is exposed as a button named "Refresh").
 *   - vehicle-id resolution: explicit prop, first-vehicle fallback, and the
 *     disabled (id 0) query when no vehicle exists — always with the 5s poll.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

// ── i18n stub: return the English fallback (2nd arg) or the key. ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, def?: string) => (typeof def === 'string' ? def : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── Data hooks + the display-boundary unit bridge, driven per test. ──
vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: vi.fn(),
  useClimateLatest: vi.fn(),
}));
vi.mock('@/hooks/useUnits', () => ({
  useUnits: vi.fn(),
}));

import { useVehicles, useClimateLatest } from '@/api/hooks/useVehicles';
import { useUnits } from '@/hooks/useUnits';
import ClimateStatusWidget from './ClimateStatusWidget';

const mockVehicles = useVehicles as unknown as ReturnType<typeof vi.fn>;
const mockClimate = useClimateLatest as unknown as ReturnType<typeof vi.fn>;
const mockUnits = useUnits as unknown as ReturnType<typeof vi.fn>;


function makeQuery(over: Record<string, unknown> = {}) {
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

// Mirrors the flat map the climate/latest handler emits (signal → field). The
// spread lets each test override individual fields, including intentionally
// wrong-typed values to lock in boundary hardening. Temperatures are SI °C.
function makeClimate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    inside_temp: 20,
    outside_temp: 10,
    hvac_power: true,
    defrost_mode: 'Normal',
    battery_heater: true,
    ...over,
  };
}

const STANDARD = { cols: 2, rows: 3 };

function setup(
  opts: {
    vehicles?: ReturnType<typeof makeQuery>;
    climate?: ReturnType<typeof makeQuery>;
    tempPref?: '°C' | '°F';
  } = {},
) {
  mockVehicles.mockReturnValue(opts.vehicles ?? makeQuery({ data: [{ id: 42 }] }));
  mockClimate.mockReturnValue(opts.climate ?? makeQuery({ data: makeClimate() }));
  mockUnits.mockReturnValue({ unitPrefs: { temperature: opts.tempPref ?? '°C' } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('ClimateStatusWidget — rendering', () => {
  it('animates verified active HVAC only until its observation becomes stale', () => {
    vi.useFakeTimers();
    try {
      setup({ climate: makeQuery({ data: makeClimate({ ts: new Date().toISOString() }) }) });
      const { container } = render(<ClimateStatusWidget size={STANDARD} />);
      expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'active');
      expect(container.querySelectorAll('.widget-airflow-motion')).toHaveLength(5);
      act(() => vi.advanceTimersByTime(120_001));
      expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
      expect(container.querySelectorAll('.widget-airflow-motion')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    { data: makeClimate({ hvac_power: false, ts: new Date().toISOString() }) },
    { data: makeClimate({ hvac_power: null, ts: new Date().toISOString() }) },
    { data: makeClimate({ ts: new Date(Date.now() - 180_000).toISOString() }) },
    { data: makeClimate({ ts: 'invalid' }) },
    { data: makeClimate({ ts: new Date().toISOString() }), isError: true, error: new Error('unavailable') },
  ])('does not imply active airflow for off, unknown, stale or failed source %#', climate => {
    setup({ climate: makeQuery(climate) });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);
    expect(container.querySelector('[data-climate-airflow]')).toHaveAttribute('data-climate-airflow', 'static');
  });

  it('renders the Inside headline, measured zero and negative Outside temp with the HVAC pill', () => {
    setup({ climate: makeQuery({ data: makeClimate({ inside_temp: 0, outside_temp: -10 }) }) });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);
    expect(screen.getByText('Inside')).toBeInTheDocument();
    expect(container).toHaveTextContent('0°C');
    expect(container).toHaveTextContent('Outside -10°C');
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    // The former OperationalBrief summary is gone in the After design.
    expect(screen.queryByTestId('dashboard-climate-temperatures-brief')).toBeNull();
  });

  it('retains temperatures and HVAC during a failed cached refresh', () => {
    setup({ climate: makeQuery({ data: makeClimate(), isError: true, error: new Error('refresh failed') }) });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);
    expect(container).toHaveTextContent('20°C');
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('renders the Inside headline, Outside line and HVAC pill (°C)', () => {
    setup({ climate: makeQuery({ data: makeClimate() }) });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('Climate')).toBeInTheDocument();
    expect(screen.getByText('Inside')).toBeInTheDocument();
    expect(container).toHaveTextContent('20°C');
    expect(container).toHaveTextContent('Outside 10°C');
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
  });

  it('renders "HVAC off" when the HVAC state is inactive', () => {
    setup({ climate: makeQuery({ data: makeClimate({ hvac_power: false }) }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('HVAC off')).toBeInTheDocument();
    expect(screen.queryByText('HVAC on')).not.toBeInTheDocument();
  });

  it('converts the SI Celsius readings to °F and labels them with the user preference', () => {
    // 20°C → 68°F, 10°C → 50°F. The unit follows the preference, never the
    // source unit, so no °C string survives.
    setup({
      climate: makeQuery({ data: makeClimate({ inside_temp: 20, outside_temp: 10 }) }),
      tempPref: '°F',
    });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);

    expect(container).toHaveTextContent('68°F');
    expect(container).toHaveTextContent('Outside 50°F');
    expect(container.textContent).not.toContain('°C');
  });

  it('never renders defrost or heater chips, whatever the legacy fields say', () => {
    // Designer drop: the After card has no defrost/heater elements, so neither
    // the canonical `battery_heater` field nor the legacy `battery_heater_on`
    // alias (nor an active defrost mode) may resurrect them.
    setup({
      climate: makeQuery({
        data: makeClimate({ battery_heater: true, battery_heater_on: true, defrost_mode: 'Normal' }),
      }),
    });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.queryByText('Defrost')).not.toBeInTheDocument();
    expect(screen.queryByText('Heater')).not.toBeInTheDocument();
    expect(screen.queryByText('Bat heater')).not.toBeInTheDocument();
  });

  it('collapses a non-boolean HVAC payload to "HVAC unknown"', () => {
    setup({
      climate: makeQuery({
        data: makeClimate({ inside_temp: 21, outside_temp: 11, hvac_power: 'On' }),
      }),
    });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);

    // Only the HVAC pill loses its state; both temps still render.
    expect(screen.getByText('HVAC unknown')).toBeInTheDocument();
    expect(container).toHaveTextContent('21°C');
    expect(container).toHaveTextContent('Outside 11°C');
  });

  it('renders null-safe placeholders for missing temps and power without crashing', () => {
    setup({
      climate: makeQuery({
        data: makeClimate({
          inside_temp: null,
          outside_temp: null,
          hvac_power: null,
          defrost_mode: null,
          battery_heater: null,
        }),
      }),
    });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);

    // Missing readings stay unknown ("—"), never a fabricated zero.
    expect(container).toHaveTextContent('—');
    expect(container.textContent).not.toContain('0°C');
    expect(screen.getByText('HVAC unknown')).toBeInTheDocument();
    expect(screen.queryByText('Defrost')).not.toBeInTheDocument();
    expect(screen.queryByText('Heater')).not.toBeInTheDocument();
  });

  it('shows the "No climate data" empty state when the endpoint returns nothing', () => {
    setup({ climate: makeQuery({ data: null }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(screen.getByText('No climate data')).toBeInTheDocument();
    // EmptyState is a semantic status region for screen readers.
    expect(screen.getByRole('status')).toBeInTheDocument();
    // The data rows are withheld entirely.
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    expect(screen.queryByText('HVAC on')).not.toBeInTheDocument();
  });

  it('shows a loading skeleton and withholds header + content while data loads', () => {
    setup({ climate: makeQuery({ isLoading: true, data: undefined }) });
    const { container } = render(<ClimateStatusWidget size={STANDARD} />);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('Climate')).toBeInTheDocument();
    expect(screen.queryByText('No climate data')).not.toBeInTheDocument();
  });

  it('refetches the climate query when the freshness control is activated', () => {
    const refetch = vi.fn();
    setup({ climate: makeQuery({ data: makeClimate(), refetch }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    // The freshness indicator is exposed as an accessible "Refresh" button.
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('ClimateStatusWidget — vehicle resolution', () => {
  it('passes the explicit vehicleId prop to the climate query with the 5s poll', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 42 }] }) });
    const { container } = render(<ClimateStatusWidget vehicleId={7} size={STANDARD} />);

    expect(mockClimate).toHaveBeenCalledWith(7, 5000);
    // The resolved data is what gets rendered.
    expect(container).toHaveTextContent('20°C');
  });

  it('falls back to the first vehicle id when no vehicleId prop is supplied', () => {
    setup({ vehicles: makeQuery({ data: [{ id: 3 }, { id: 9 }] }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(mockClimate).toHaveBeenCalledWith(3, 5000);
  });

  it('keys the climate query on 0 (disabled) when there is no vehicle to resolve', () => {
    setup({ vehicles: makeQuery({ data: [] }), climate: makeQuery({ data: null }) });
    render(<ClimateStatusWidget size={STANDARD} />);

    expect(mockClimate).toHaveBeenCalledWith(0, 5000);
    // With no vehicle and no data, the widget degrades to the empty state.
    expect(screen.getByText('No climate data')).toBeInTheDocument();
  });
});

async function expectPackPresentation(container: HTMLElement, packId: PackId) {
  expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
  if (packId !== 'classic') {
    await waitFor(() => {
      expect(container.querySelector(`[data-climate-appearance="${PACK_APPEARANCES[packId]}"]`)).not.toBeNull();
    });
  }
}

describe.each(PACK_IDS)('ClimateStatusWidget — %s integration', packId => {
  it('keeps measured temperatures, display preferences, active airflow and refresh when the pack changes', async () => {
    const refetch = vi.fn();
    const data = makeClimate({
      inside_temp_c: 0,
      outside_temp_c: -10,
      driver_setpoint_c: 22,
      ts: new Date().toISOString(),
    });
    setup({ climate: makeQuery({ data, refetch }) });
    const { container, rerender } = render(
      <PackBoundary requestedPackId="classic"><ClimateStatusWidget vehicleId={7} size={{ cols: 2, rows: 2 }} /></PackBoundary>,
    );
    expect(container).toHaveTextContent('0°C');
    expect(container).toHaveTextContent('Outside -10°C');

    setup({ climate: makeQuery({ data, refetch }), tempPref: '°F' });
    rerender(
      <PackBoundary requestedPackId={packId}><ClimateStatusWidget vehicleId={7} size={{ cols: 2, rows: 2 }} /></PackBoundary>,
    );
    await expectPackPresentation(container, packId);
    expect(container).toHaveTextContent('32°F');
    expect(container).toHaveTextContent('Outside 14°F');
    if (packId !== 'classic') expect(container).toHaveTextContent('set 72°F');
    expect(container).not.toHaveTextContent('°C');
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    expect(container.querySelector('[data-climate-airflow="active"]')).toHaveClass('h-4');
    expect(mockClimate).toHaveBeenLastCalledWith(7, 5_000);
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('preserves initial loading, fatal error, empty and recovered content without a classic fallback', async () => {
    const widget = <PackBoundary requestedPackId={packId}><ClimateStatusWidget size={STANDARD} /></PackBoundary>;
    setup({ climate: makeQuery({ data: undefined, dataUpdatedAt: 0, isLoading: true, isFetching: true }) });
    const { container, rerender } = render(widget);
    expect(container.querySelector('[data-data-state="initial"]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();
    expect(screen.queryByText('No climate data')).not.toBeInTheDocument();

    const refetch = vi.fn();
    setup({ climate: makeQuery({ data: undefined, dataUpdatedAt: 0, isError: true, error: new Error('unavailable'), refetch }) });
    rerender(<PackBoundary requestedPackId={packId}><ClimateStatusWidget size={STANDARD} /></PackBoundary>);
    expect(container.querySelector('[data-data-state="initialFailure"]')).not.toBeNull();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.queryByText('No climate data')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);

    setup({ climate: makeQuery({ data: null }) });
    rerender(<PackBoundary requestedPackId={packId}><ClimateStatusWidget size={STANDARD} /></PackBoundary>);
    expect(screen.getByText('No climate data')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByText('Inside')).not.toBeInTheDocument();

    const data = makeClimate({ ts: new Date().toISOString() });
    setup({ climate: makeQuery({ data }) });
    rerender(<PackBoundary requestedPackId={packId}><ClimateStatusWidget size={STANDARD} /></PackBoundary>);
    await expectPackPresentation(container, packId);
    expect(container).toHaveTextContent('20°C');
    expect(screen.queryByText('No climate data')).not.toBeInTheDocument();

    setup({ climate: makeQuery({ data, isError: true, error: new Error('refresh failed') }) });
    rerender(<PackBoundary requestedPackId={packId}><ClimateStatusWidget size={STANDARD} /></PackBoundary>);
    await expectPackPresentation(container, packId);
    expect(container).toHaveTextContent('20°C');
    expect(container).toHaveTextContent('Outside 10°C');
    expect(screen.getByText('HVAC on')).toBeInTheDocument();
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(container.querySelector('[data-climate-airflow="static"]')).not.toBeNull();
    expect(container.querySelector('[data-motion-suppressed="true"]')).not.toBeNull();
  });

  it('keeps invalid measurements unknown and inactive HVAC static independently of valid readings', async () => {
    setup({ climate: makeQuery({ data: makeClimate({
      inside_temp_c: Number.NaN,
      outside_temp_c: -10,
      driver_setpoint_c: Number.POSITIVE_INFINITY,
      hvac_power: false,
      ts: new Date().toISOString(),
    }) }) });
    const { container } = render(
      <PackBoundary requestedPackId={packId}><ClimateStatusWidget size={STANDARD} /></PackBoundary>,
    );
    await expectPackPresentation(container, packId);
    expect(container).toHaveTextContent('—');
    expect(container).toHaveTextContent('Outside -10°C');
    if (packId !== 'classic') expect(container).toHaveTextContent('set —');
    expect(container.textContent).not.toMatch(/NaN|Infinity|(?:^|\s)0°C/);
    expect(screen.getByText('HVAC off')).toBeInTheDocument();
    expect(container.querySelector('[data-climate-airflow="static"]')).not.toBeNull();
    expect(container.querySelector('.widget-airflow-motion')).toBeNull();
  });
});
