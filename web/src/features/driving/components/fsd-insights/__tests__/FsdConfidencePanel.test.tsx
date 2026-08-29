/**
 * FsdConfidencePanel — trust metadata + methodology surface.
 *
 * The panel is the page's honesty contract, so these tests pin the behaviour
 * that matters: a healthy period has a usable counter basis, reset / missing
 * baseline / missing denominator states reduce confidence and say why, sparse
 * change-feed activity does not masquerade as a connectivity score, the
 * clamped-share caveat only appears when the API reported it, and the "what
 * this telemetry cannot tell you" copy is never conditional.
 */
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { FsdConfidencePanel } from '../FsdConfidencePanel';
import { fsdDrivingOnlyInsights, fsdInsights } from './fixtures';
import type { FsdSectionState } from '../types';

function state(overrides: Partial<FsdSectionState> = {}): FsdSectionState {
  return { isLoading: false, error: null, onRetry: vi.fn(), noVehicle: false, ...overrides };
}

function renderPanel(node: ReactNode) {
  return render(<MemoryRouter>{node}</MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  unitsMock.mockReturnValue({
    unitPrefs: {
      distance: 'km',
      speed: 'km/h',
      temperature: '°C',
      pressure: 'kPa',
      energy: 'kWh',
      duration: 'h',
      power: 'kW',
      locale: 'en-US',
    },
    formatDistance: () => '',
    formatSpeed: () => '',
    formatTemperature: () => '',
    formatPressure: () => '',
    formatEnergy: () => '',
    formatDuration: () => '',
    formatPower: () => '',
  });
});

describe('FsdConfidencePanel', () => {
  it('reports the observation window, coverage, and sample accounting', () => {
    renderPanel(<FsdConfidencePanel insights={fsdInsights()} state={state()} />);

    expect(screen.getByText('Observation window')).toBeInTheDocument();
    expect(
      screen.getByText('Feb 2, 2026 – Mar 3, 2026 (America/Los_Angeles)'),
    ).toBeInTheDocument();
    expect(screen.getByText('28 of 30 (93.3%)')).toBeInTheDocument();
    expect(screen.getByText('12 self-driving / 14 driving')).toBeInTheDocument();
    expect(screen.getByText('Yes — distance is derivable')).toBeInTheDocument();
    expect(screen.getByText('28 of 30')).toBeInTheDocument();
    expect(screen.getByText('Usable counter basis')).toBeInTheDocument();
  });

  it('never claims a usable basis when the self-driving counter never reported', () => {
    // The regression: a vehicle streaming MilesSinceReset all period has
    // excellent telemetry coverage and ZERO self-driving evidence. The badge
    // must not launder the former into the latter.
    renderPanel(<FsdConfidencePanel insights={fsdDrivingOnlyInsights()} state={state()} />);

    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
    expect(screen.queryByText('Usable counter basis')).not.toBeInTheDocument();
    expect(
      screen.getByText(
        'No — nothing was reported inside this period, so every self-driving distance is unavailable',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText('0 of 30')).toBeInTheDocument();
    expect(screen.getByText(/every supervised self-driving distance on this page/i)).toBeInTheDocument();
    expect(
      screen.getByText(
        /Absence of a derivable counter reading is not evidence of zero supervised self-driving distance/,
      ),
    ).toBeInTheDocument();
  });

  it('explains a counter that reported once but could not be differenced', () => {
    const base = fsdInsights();
    renderPanel(
      <FsdConfidencePanel
        insights={fsdInsights({
          quality: {
            ...base.quality,
            fsd_reported_in_period: true,
            fsd_distance_derivable: false,
            fsd_baseline_available: false,
            fsd_measured_days: 0,
          },
        })}
        state={state()}
      />,
    );

    expect(
      screen.getByText('Reported once, but no second reading to difference against'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
  });

  it('flags reduced confidence when a counter reset was observed', () => {
    const base = fsdInsights();
    const insights = fsdInsights({
      quality: { ...base.quality, fsd_reset_count: 2 },
    });

    renderPanel(<FsdConfidencePanel insights={insights} state={state()} />);

    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
    expect(screen.queryByText('Usable counter basis')).not.toBeInTheDocument();
    expect(
      screen.getByText(/A counter reset was detected in this period/),
    ).toBeInTheDocument();
  });

  it('flags reduced confidence when the pre-window baseline is missing', () => {
    const base = fsdInsights();
    const insights = fsdInsights({
      quality: { ...base.quality, fsd_baseline_available: false },
    });

    renderPanel(<FsdConfidencePanel insights={insights} state={state()} />);

    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
    expect(
      screen.getByText('Missing — the first observation is not counted as distance'),
    ).toBeInTheDocument();
  });

  it('explains an unavailable denominator instead of implying zero driving', () => {
    const base = fsdInsights();
    const insights = fsdInsights({
      quality: { ...base.quality, driving_denominator_available: false },
    });

    renderPanel(<FsdConfidencePanel insights={insights} state={state()} />);

    expect(
      screen.getByText('Not reported — usage share is unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
  });

  it('flags a missing observed-driving baseline independently', () => {
    const base = fsdInsights();
    renderPanel(
      <FsdConfidencePanel
        insights={fsdInsights({
          quality: {
            ...base.quality,
            driving_baseline_available: false,
            share_basis_available: false,
          },
        })}
        state={state()}
      />,
    );

    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
    expect(screen.getByText('Observed-driving pre-window baseline')).toBeInTheDocument();
    expect(
      screen.getByText(/standalone distances remain visible, but usage share is unavailable/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/begin from different provable points/i)).toBeInTheDocument();
  });

  it('surfaces legacy observations excluded by the normalization guard', () => {
    const base = fsdInsights();
    renderPanel(
      <FsdConfidencePanel
        insights={fsdInsights({
          quality: {
            ...base.quality,
            fsd_untrusted_sample_count: 3,
            driving_untrusted_sample_count: 2,
          },
        })}
        state={state()}
      />,
    );

    expect(screen.getByText('Reduced confidence')).toBeInTheDocument();
    expect(
      screen.getByText('Active — 5 legacy observations with unknown unit provenance were excluded'),
    ).toBeInTheDocument();
    expect(screen.getByText(/5 legacy distance-counter observations were excluded/i)).toBeInTheDocument();
  });

  it('does not treat sparse change-feed days as a telemetry outage', () => {
    const base = fsdInsights();
    const insights = fsdInsights({
      quality: {
        ...base.quality,
        counter_observation_days: 1,
        days_without_counter_observation: 29,
        counter_observation_day_pct: 3.33,
      },
    });

    renderPanel(<FsdConfidencePanel insights={insights} state={state()} />);

    expect(screen.getByText('1 of 30 (3.3%)')).toBeInTheDocument();
    expect(screen.getByText('Usable counter basis')).toBeInTheDocument();
  });

  it('only shows the clamped-share caveat when the API reported one', () => {
    const base = fsdInsights();
    renderPanel(<FsdConfidencePanel insights={fsdInsights()} state={state()} />);
    expect(screen.queryByText(/capped at 100%/)).not.toBeInTheDocument();

    renderPanel(
      <FsdConfidencePanel
        insights={fsdInsights({ quality: { ...base.quality, share_clamped: true } })}
        state={state()}
      />,
    );
    expect(screen.getAllByText(/capped at 100%/).length).toBeGreaterThan(0);
  });

  it('always states the limits of the underlying field', () => {
    renderPanel(<FsdConfidencePanel insights={fsdInsights()} state={state()} />);

    expect(
      screen.getByText(
        /cannot describe interventions, disengagements, safety performance, or per-drive attribution/,
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/No intervention, disengagement, safety, or autonomy-quality metric/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Only signal-history rows carrying a proven canonical normalization version/),
    ).toBeInTheDocument();
  });

  it('keeps the panel shell and the limits copy in the no-vehicle state', () => {
    renderPanel(<FsdConfidencePanel insights={undefined} state={state({ noVehicle: true })} />);

    expect(screen.getByTestId('fsd-confidence')).toBeInTheDocument();
    expect(screen.getByText('Data confidence & methodology')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Choose a vehicle' })).toHaveAttribute(
      'href',
      '/vehicles',
    );
    expect(
      screen.getByText(
        /cannot describe interventions, disengagements, safety performance, or per-drive attribution/,
      ),
    ).toBeInTheDocument();
  });

  it('keeps the panel shell while loading', () => {
    renderPanel(<FsdConfidencePanel insights={undefined} state={state({ isLoading: true })} />);

    expect(screen.getByTestId('fsd-confidence')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveAccessibleName(
      'Loading supervised self-driving telemetry',
    );
  });
});
