/**
 * WeeklyDigestPage — orchestration behaviour + hardening coverage.
 *
 * WeeklyDigestPage exposes a single default export (the page). It is a thin
 * orchestrator: `useWeeklyDigest()` owns the data/derivation, the
 * `weekly-digest` section components own their own rendering, and the page's
 * job is to wire per-domain loading/error/retry state to the right section,
 * aggregate the drive+charge domains for the two summary bands, scope the
 * vehicle, and hand the numeric vehicle id to the opt-in AI narration.
 *
 * This suite drives that orchestration by mocking the `weekly-digest` barrel
 * (the hook + section spies that reflect their props as data-attributes), the
 * AI narration surface, the motion wrapper, and i18n. The real `PageContainer`
 * and `Select` render so the page's landmarks + vehicle combobox are exercised
 * for real. Network is never touched.
 *
 * Facets covered:
 *   - scaffolding/a11y: page heading + subtitle, labelled region landmarks,
 *     the vehicle combobox, and every section + AI surface mount.
 *   - document title via usePageTitle.
 *   - summary aggregation: `summaryLoading = drivesLoading || chargingLoading`
 *     and `summaryError = drivesError ?? chargingError` (both halves + the
 *     drives-wins precedence) drive the two summary bands.
 *   - per-domain wiring: driving↔drives, charging↔charging, battery↔charging
 *     (shared domain), alerts↔alerts — each surfaces its own error and retries
 *     its own query without cross-contaminating healthy panels.
 *   - summary retry re-invokes refetchAll for both summary bands.
 *   - week navigation callbacks + label/current wiring.
 *   - vehicle scope select onChange forwards the raw string value.
 *   - AI vehicle id boundary: numeric id forwarded, `0` preserved, empty →
 *     undefined, and a non-numeric id is dropped instead of forwarding NaN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { DigestMetrics } from '../components/weekly-digest/types';

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

// ── motion: render children inline (no animation frames in jsdom) ──
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));

// ── AI narration: reflect the numeric vehicle id the page derived ──
vi.mock('@/components/ai/AIDigestNarration', () => ({
  AIDigestNarration: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-narration" data-vehicle-id={vehicleId ?? 'none'} />
  ),
}));

// ── weekly-digest barrel: mock the hook + reflect each section's props ──
vi.mock('../components/weekly-digest', () => {
  type SpyProps = {
    isLoading?: boolean;
    isError?: boolean;
    error?: unknown;
    onRetry?: () => void;
  };
  const sectionSpy = (testId: string) => {
    const Spy = ({ isLoading, isError, error, onRetry }: SpyProps) => (
      <div
        data-testid={testId}
        data-loading={isLoading ? 'true' : 'false'}
        data-error={isError ? 'true' : 'false'}
        data-error-message={
          error instanceof Error ? error.message : error != null ? String(error) : ''
        }
      >
        <button type="button" aria-label={`retry ${testId}`} onClick={() => onRetry?.()}>
          retry
        </button>
      </div>
    );
    Spy.displayName = `Spy(${testId})`;
    return Spy;
  };

  type WeekSelectorProps = {
    weekLabel: string;
    isCurrentWeek: boolean;
    onPrevWeek: () => void;
    onNextWeek: () => void;
  };

  return {
    useWeeklyDigest: vi.fn(),
    WeekSelector: ({ weekLabel, isCurrentWeek, onPrevWeek, onNextWeek }: WeekSelectorProps) => (
      <div
        data-testid="week-selector"
        data-week-label={weekLabel}
        data-current-week={isCurrentWeek ? 'true' : 'false'}
      >
        <button type="button" aria-label="previous week" onClick={onPrevWeek}>
          prev
        </button>
        <button type="button" aria-label="next week" onClick={onNextWeek}>
          next
        </button>
      </div>
    ),
    SummaryHeroCards: sectionSpy('summary-hero'),
    DrivingSection: sectionSpy('driving-section'),
    ChargingSection: sectionSpy('charging-section'),
    BatteryHealthSection: sectionSpy('battery-section'),
    AlertsSection: sectionSpy('alerts-section'),
    WeekOverWeekSummary: sectionSpy('wow-summary'),
  };
});

import { useWeeklyDigest } from '../components/weekly-digest';
import WeeklyDigestPage from './WeeklyDigestPage';

const mockHook = useWeeklyDigest as unknown as ReturnType<typeof vi.fn>;
type HookReturn = ReturnType<typeof useWeeklyDigest>;

const baseMetrics: DigestMetrics = {
  totalDistance: 0,
  prevDistance: 0,
  totalDrives: 0,
  prevDriveCount: 0,
  energyUsed: 0,
  prevEnergy: 0,
  chargingCost: 0,
  prevChargingCost: 0,
  co2Saved: 0,
  prevCo2: 0,
  avgEfficiency: 0,
  prevAvgEfficiency: 0,
  totalDuration: 0,
  topDrive: undefined,
  chargeEnergyAdded: 0,
  prevChargeEnergy: 0,
  avgChargeRate: 0,
  chargingSessionCount: 0,
  batteryStart: 0,
  batteryEnd: 0,
  alertsByType: {},
  alertTotal: 0,
};

function makeHook(over: Record<string, unknown> = {}): HookReturn {
  const base = {
    weekLabel: 'Jun 24 – Jun 30',
    isCurrentWeek: true,
    isLoading: false,
    error: null,
    hasData: true,
    metrics: baseMetrics,
    dailyDistanceData: [],
    dailyEnergyData: [],
    alertPieData: [],
    funFact: undefined,
    goToPrevWeek: vi.fn(),
    goToNextWeek: vi.fn(),
    vehicleOptions: [
      { value: '7', label: 'My Model 3' },
      { value: '9', label: 'My Model Y' },
    ],
    selectedVehicleId: '7',
    setVehicleId: vi.fn(),
    drivesLoading: false,
    drivesError: null,
    refetchDrives: vi.fn(),
    chargingLoading: false,
    chargingError: null,
    refetchCharging: vi.fn(),
    alertsLoading: false,
    alertsError: null,
    refetchAlerts: vi.fn(),
    refetchAll: vi.fn(),
    freshnessQueries: [],
  };
  return { ...base, ...over } as unknown as HookReturn;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <WeeklyDigestPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

const loadingAttr = (id: string) => screen.getByTestId(id).getAttribute('data-loading');
const errorAttr = (id: string) => screen.getByTestId(id).getAttribute('data-error');
const errorMessage = (id: string) => screen.getByTestId(id).getAttribute('data-error-message');
const retryButton = (id: string) =>
  within(screen.getByTestId(id)).getByRole('button', { name: `retry ${id}` });

beforeEach(() => {
  mockHook.mockReset();
  mockHook.mockReturnValue(makeHook());
});

describe('WeeklyDigestPage — scaffolding + a11y', () => {
  it('renders the page header, vehicle combobox, and every digest surface', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Weekly Digest' })).toBeInTheDocument();
    expect(
      screen.getByText('Your driving and charging summary for the week'),
    ).toBeInTheDocument();

    const select = screen.getByRole('combobox', { name: 'Select vehicle' });
    expect(select).toHaveValue('7');

    for (const id of [
      'week-selector',
      'summary-hero',
      'driving-section',
      'charging-section',
      'battery-section',
      'alerts-section',
      'wow-summary',
      'ai-narration',
    ]) {
      expect(screen.getByTestId(id)).toBeInTheDocument();
    }
  });

  it('exposes labelled region landmarks for the activity and battery/alerts bentos', () => {
    renderPage();

    expect(
      screen.getByRole('region', { name: 'Driving & charging activity' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Battery health & alerts' }),
    ).toBeInTheDocument();
  });

  it('sets the document title via usePageTitle', () => {
    renderPage();
    expect(document.title).toContain('Weekly Digest');
  });
});

describe('WeeklyDigestPage — summary aggregation (drives + charging)', () => {
  it('marks both summary bands loading when the drives query is loading', () => {
    mockHook.mockReturnValue(makeHook({ drivesLoading: true, chargingLoading: false }));
    renderPage();

    expect(loadingAttr('summary-hero')).toBe('true');
    expect(loadingAttr('wow-summary')).toBe('true');
    // Only the drives-backed section loads; charging stays idle.
    expect(loadingAttr('driving-section')).toBe('true');
    expect(loadingAttr('charging-section')).toBe('false');
  });

  it('marks both summary bands loading when the charging query is loading', () => {
    mockHook.mockReturnValue(makeHook({ drivesLoading: false, chargingLoading: true }));
    renderPage();

    expect(loadingAttr('summary-hero')).toBe('true');
    expect(loadingAttr('wow-summary')).toBe('true');
    expect(loadingAttr('charging-section')).toBe('true');
    expect(loadingAttr('driving-section')).toBe('false');
  });

  it('leaves both summary bands idle when neither domain is loading', () => {
    mockHook.mockReturnValue(makeHook({ drivesLoading: false, chargingLoading: false }));
    renderPage();

    expect(loadingAttr('summary-hero')).toBe('false');
    expect(loadingAttr('wow-summary')).toBe('false');
  });

  it('surfaces the drives error on both summary bands', () => {
    mockHook.mockReturnValue(makeHook({ drivesError: new Error('drives down') }));
    renderPage();

    expect(errorAttr('summary-hero')).toBe('true');
    expect(errorMessage('summary-hero')).toBe('drives down');
    expect(errorMessage('wow-summary')).toBe('drives down');
  });

  it('falls back to the charging error when drives are healthy', () => {
    mockHook.mockReturnValue(
      makeHook({ drivesError: null, chargingError: new Error('charge down') }),
    );
    renderPage();

    expect(errorAttr('summary-hero')).toBe('true');
    expect(errorMessage('summary-hero')).toBe('charge down');
  });

  it('prefers the drives error over the charging error when both fail', () => {
    mockHook.mockReturnValue(
      makeHook({ drivesError: new Error('drives down'), chargingError: new Error('charge down') }),
    );
    renderPage();

    expect(errorMessage('summary-hero')).toBe('drives down');
    expect(errorMessage('wow-summary')).toBe('drives down');
  });

  it('keeps both summary bands healthy when both domains are fine', () => {
    mockHook.mockReturnValue(makeHook({ drivesError: null, chargingError: null }));
    renderPage();

    expect(errorAttr('summary-hero')).toBe('false');
    expect(errorMessage('summary-hero')).toBe('');
  });

  it('retries every domain from both summary bands', () => {
    const refetchAll = vi.fn();
    mockHook.mockReturnValue(makeHook({ drivesError: new Error('x'), refetchAll }));
    renderPage();

    fireEvent.click(retryButton('summary-hero'));
    fireEvent.click(retryButton('wow-summary'));
    expect(refetchAll).toHaveBeenCalledTimes(2);
  });
});

describe('WeeklyDigestPage — per-domain wiring', () => {
  it('wires the driving section to the drives query and retries only drives', () => {
    const refetchDrives = vi.fn();
    mockHook.mockReturnValue(makeHook({ drivesError: new Error('d'), refetchDrives }));
    renderPage();

    expect(errorAttr('driving-section')).toBe('true');
    expect(errorMessage('driving-section')).toBe('d');
    // Healthy sibling is unaffected.
    expect(errorAttr('charging-section')).toBe('false');

    fireEvent.click(retryButton('driving-section'));
    expect(refetchDrives).toHaveBeenCalledTimes(1);
  });

  it('wires the charging section to the charging query and retries only charging', () => {
    const refetchCharging = vi.fn();
    mockHook.mockReturnValue(makeHook({ chargingError: new Error('c'), refetchCharging }));
    renderPage();

    expect(errorAttr('charging-section')).toBe('true');
    expect(errorMessage('charging-section')).toBe('c');

    fireEvent.click(retryButton('charging-section'));
    expect(refetchCharging).toHaveBeenCalledTimes(1);
  });

  it('drives the battery section from the charging query (shared domain state)', () => {
    const refetchCharging = vi.fn();
    mockHook.mockReturnValue(makeHook({ chargingError: new Error('c'), refetchCharging }));
    renderPage();

    expect(errorAttr('battery-section')).toBe('true');
    expect(errorMessage('battery-section')).toBe('c');

    fireEvent.click(retryButton('battery-section'));
    expect(refetchCharging).toHaveBeenCalledTimes(1);
  });

  it('shows the battery section loading while the charging query loads', () => {
    mockHook.mockReturnValue(makeHook({ chargingLoading: true }));
    renderPage();
    expect(loadingAttr('battery-section')).toBe('true');
  });

  it('wires the alerts section to the alerts query and retries only alerts', () => {
    const refetchAlerts = vi.fn();
    mockHook.mockReturnValue(makeHook({ alertsError: new Error('a'), refetchAlerts }));
    renderPage();

    expect(errorAttr('alerts-section')).toBe('true');
    expect(errorMessage('alerts-section')).toBe('a');

    fireEvent.click(retryButton('alerts-section'));
    expect(refetchAlerts).toHaveBeenCalledTimes(1);
  });
});

describe('WeeklyDigestPage — week navigation', () => {
  it('passes the label + current flag and fires the nav callbacks', () => {
    const goToPrevWeek = vi.fn();
    const goToNextWeek = vi.fn();
    mockHook.mockReturnValue(
      makeHook({ weekLabel: 'Jul 1 – Jul 7', isCurrentWeek: false, goToPrevWeek, goToNextWeek }),
    );
    renderPage();

    const selector = screen.getByTestId('week-selector');
    expect(selector).toHaveAttribute('data-week-label', 'Jul 1 – Jul 7');
    expect(selector).toHaveAttribute('data-current-week', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'previous week' }));
    fireEvent.click(screen.getByRole('button', { name: 'next week' }));
    expect(goToPrevWeek).toHaveBeenCalledTimes(1);
    expect(goToNextWeek).toHaveBeenCalledTimes(1);
  });
});

describe('WeeklyDigestPage — vehicle scope select', () => {
  it('forwards the raw string value to setVehicleId on change', () => {
    const setVehicleId = vi.fn();
    mockHook.mockReturnValue(makeHook({ setVehicleId }));
    renderPage();

    fireEvent.change(screen.getByRole('combobox', { name: 'Select vehicle' }), {
      target: { value: '9' },
    });
    expect(setVehicleId).toHaveBeenCalledTimes(1);
    expect(setVehicleId).toHaveBeenCalledWith('9');
  });
});

describe('WeeklyDigestPage — AI narration vehicle id boundary', () => {
  it('forwards the numeric selected vehicle id to the AI narration', () => {
    mockHook.mockReturnValue(makeHook({ selectedVehicleId: '9' }));
    renderPage();
    expect(screen.getByTestId('ai-narration')).toHaveAttribute('data-vehicle-id', '9');
  });

  it('preserves a zero vehicle id (0 is a valid id, not "empty")', () => {
    mockHook.mockReturnValue(makeHook({ selectedVehicleId: '0' }));
    renderPage();
    expect(screen.getByTestId('ai-narration')).toHaveAttribute('data-vehicle-id', '0');
  });

  it('passes no vehicle id when none is selected', () => {
    mockHook.mockReturnValue(makeHook({ selectedVehicleId: '' }));
    renderPage();
    expect(screen.getByTestId('ai-narration')).toHaveAttribute('data-vehicle-id', 'none');
  });

  it('drops a non-numeric selected vehicle id instead of forwarding NaN', () => {
    mockHook.mockReturnValue(makeHook({ selectedVehicleId: 'not-a-number' }));
    renderPage();
    expect(screen.getByTestId('ai-narration')).toHaveAttribute('data-vehicle-id', 'none');
  });
});
