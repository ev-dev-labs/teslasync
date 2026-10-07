/**
 * FsdKpiBand — executive KPI band behaviour.
 *
 * Asserts the four states the band has to survive (complete, unavailable
 * share, no-vehicle, loading/error) and — critically — that SI meters are
 * converted at the render boundary through the REAL `lib/unitConversion`
 * formatter rather than being printed raw or pre-converted upstream.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  formatDistance as libFormatDistance,
  type DistanceUnitPref,
  type UnitPref,
} from '@/lib/unitConversion';

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

const { unitsMock } = vi.hoisted(() => ({ unitsMock: vi.fn() }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => unitsMock() }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const template = typeof fallback === 'string' ? fallback : key;
        const vars = (opts && typeof opts === 'object' ? opts : undefined) as
          | Record<string, unknown>
          | undefined;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

import { FsdKpiBand } from '../FsdKpiBand';
import { fsdDrivingOnlyInsights, fsdInsights } from './fixtures';
import type { FsdSectionState } from '../types';

function prefsFor(distance: DistanceUnitPref): UnitPref {
  return {
    distance,
    speed: 'km/h',
    temperature: '°C',
    pressure: 'kPa',
    energy: 'kWh',
    duration: 'h',
    power: 'kW',
    locale: 'en-US',
  };
}

function useUnitsValue(distance: DistanceUnitPref) {
  const unitPrefs = prefsFor(distance);
  return {
    unitPrefs,
    formatDistance: (value: number | null | undefined, options?: { precision?: number }) =>
      libFormatDistance(value, unitPrefs, options),
    formatSpeed: () => '',
    formatTemperature: () => '',
    formatPressure: () => '',
    formatEnergy: () => '',
    formatDuration: () => '',
    formatPower: () => '',
  };
}

function state(overrides: Partial<FsdSectionState> = {}): FsdSectionState {
  return { isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false, ...overrides };
}

function renderBand(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  unitsMock.mockReturnValue(useUnitsValue('km'));
});

describe('FsdKpiBand', () => {
  it('renders every KPI from the complete payload', () => {
    renderBand(<FsdKpiBand insights={fsdInsights()} state={state()} />);

    expect(screen.getByText('Supervised self-driving distance')).toBeInTheDocument();
    // 16 093.44 m → 16.1 km at 1 dp.
    expect(screen.getByText('16.1 km')).toBeInTheDocument();
    expect(screen.getByText('25.0%')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('of 28 measured days')).toBeInTheDocument();
    // Best day: 8 046.72 m → 8.0 km.
    expect(screen.getByText('8.0 km')).toBeInTheDocument();
  });

  it('converts SI meters to the operator display unit (km ↔ mi)', () => {
    const { unmount } = renderBand(<FsdKpiBand insights={fsdInsights()} state={state()} />);
    expect(screen.getByText('16.1 km')).toBeInTheDocument();
    unmount();

    unitsMock.mockReturnValue(useUnitsValue('mi'));
    renderBand(<FsdKpiBand insights={fsdInsights()} state={state()} />);
    // 16 093.44 m is exactly 10 miles.
    expect(screen.getByText('10.0 mi')).toBeInTheDocument();
    expect(screen.queryByText('16.1 km')).not.toBeInTheDocument();
  });

  it('shows an em dash and the reason when the share denominator is unavailable', () => {
    const insights = fsdInsights({
      totals: {
        ...fsdInsights().totals,
        driving_distance_m: null,
        fsd_share_pct: null,
      },
    });

    renderBand(<FsdKpiBand insights={insights} state={state()} />);

    expect(screen.getByText('Observed-driving counter not reported')).toBeInTheDocument();
    // The distance KPI is unaffected — only the share is unknown.
    expect(screen.getByText('16.1 km')).toBeInTheDocument();
  });

  it('does not divide standalone distances accumulated over different spans', () => {
    const base = fsdInsights();
    const insights = fsdInsights({
      totals: { ...base.totals, fsd_share_pct: null },
      quality: { ...base.quality, share_basis_available: false },
    });

    renderBand(<FsdKpiBand insights={insights} state={state()} />);

    expect(
      screen.getByText('Counter spans do not align for a trustworthy share'),
    ).toBeInTheDocument();
    expect(screen.getByText('16.1 km')).toBeInTheDocument();
  });

  it('never formats a zero when the self-driving counter did not report', () => {
    // The regression this exists for: a vehicle streaming MilesSinceReset with
    // no SelfDrivingMilesSinceReset used to render "0.0 km" of supervised
    // self-driving — a measurement the telemetry never supported.
    renderBand(<FsdKpiBand insights={fsdDrivingOnlyInsights()} state={state()} />);

    expect(screen.queryByText('0.0 km')).not.toBeInTheDocument();
    expect(screen.queryByText('0.0 mi')).not.toBeInTheDocument();
    expect(
      screen.getByText('Self-driving counter not reported in this period'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Needs the self-driving counter, which was not reported'),
    ).toBeInTheDocument();
    expect(screen.getByText('No day could be measured')).toBeInTheDocument();
    expect(screen.getByText('Nothing measured in this period')).toBeInTheDocument();

    // Four KPI cards, and every value is the unknown marker.
    const values = screen.getAllByText('—');
    expect(values.length).toBe(4);
  });

  it('renders a measured zero as a real zero, not as "not reported"', () => {
    // Baseline + an in-window unchanged sample: the counter reported and did
    // not move. That IS a measurement and must read as one.
    const base = fsdInsights();
    const insights = fsdInsights({
      totals: {
        ...base.totals,
        fsd_distance_m: 0,
        fsd_share_pct: 0,
        active_days: 0,
        measured_days: 30,
        avg_measured_day_fsd_distance_m: 0,
        avg_active_day_fsd_distance_m: null,
        best_day: null,
      },
    });

    renderBand(<FsdKpiBand insights={insights} state={state()} />);

    expect(screen.getByText('0.0 km')).toBeInTheDocument();
    expect(screen.getByText('0.0%')).toBeInTheDocument();
    expect(screen.getByText('of 30 measured days')).toBeInTheDocument();
    expect(
      screen.queryByText('Self-driving counter not reported in this period'),
    ).not.toBeInTheDocument();
    // No best day, but the reason is "nothing accumulated", not "unmeasured".
    expect(screen.getByText('No day accumulated distance yet')).toBeInTheDocument();
  });

  it('keeps the shell mounted with no best day when nothing accumulated', () => {
    const insights = fsdInsights({
      totals: { ...fsdInsights().totals, active_days: 0, best_day: null },
    });

    renderBand(<FsdKpiBand insights={insights} state={state()} />);

    expect(screen.getByText('Best day')).toBeInTheDocument();
    expect(screen.getByText('No day accumulated distance yet')).toBeInTheDocument();
  });

  it('renders the no-vehicle recovery CTA instead of fabricated zeros', () => {
    renderBand(<FsdKpiBand insights={undefined} state={state({ noVehicle: true })} />);

    expect(
      screen.getByText('Select a vehicle to see supervised self-driving telemetry.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a vehicle' })).toHaveAttribute('href', '/vehicles');
    expect(screen.queryByText('Best day')).not.toBeInTheDocument();
  });

  it('announces the loading state without unmounting the section', () => {
    renderBand(<FsdKpiBand insights={undefined} state={state({ isLoading: true })} />);

    expect(screen.getByTestId('fsd-kpis')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName(
      'Loading supervised self-driving telemetry',
    );
  });

  it('offers a retry when the query failed', () => {
    const onRetry = vi.fn();
    renderBand(
      <FsdKpiBand
        insights={undefined}
        state={state({ error: new Error('fsd unavailable'), onRetry })}
      />,
    );

    // The section shell stays mounted; only its body swaps to the recovery
    // surface, which owns its own (status-aware) copy.
    expect(screen.getByTestId('fsd-kpis')).toBeInTheDocument();
    expect(screen.queryByText('Best day')).not.toBeInTheDocument();
    const retry = screen.getAllByRole('button').find((el) => /retry|try again/i.test(el.textContent ?? ''));
    expect(retry).toBeDefined();
    fireEvent.click(retry as HTMLElement);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
