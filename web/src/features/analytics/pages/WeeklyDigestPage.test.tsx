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
 * This suite replaces the digest hook and AI boundary. Transparent spies
 * observe current panel props while rendering their REAL shared subtree.
 * Loading, error, retry and navigation assertions inspect that real UI.
 * The real page layout
 * renders the page landmarks without duplicating the application header's
 * vehicle picker. Network is never touched.
 *
 * Facets covered:
 *   - scaffolding/a11y: page heading + subtitle, labelled region landmarks,
 *     no redundant vehicle combobox, and every section + AI surface mount.
 *   - document title via usePageTitle.
 *   - summary aggregation: `summaryLoading = drivesLoading || chargingLoading`
 *     and `summaryError = drivesError ?? chargingError` (both halves + the
 *     drives-wins precedence) drive the two summary bands.
 *   - per-domain wiring: driving↔drives, charging↔charging, battery↔charging
 *     (shared domain), alerts↔alerts — each surfaces its own error and retries
 *     its own query without cross-contaminating healthy panels.
 *   - summary retry re-invokes refetchAll for both summary bands.
 *   - week navigation callbacks + label/current wiring.
 *   - vehicle scope select updates the shared numeric vehicle context.
 *   - AI vehicle id boundary: numeric id forwarded, `0` preserved, empty →
 *     undefined, and a non-numeric id is dropped instead of forwarding NaN.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

import type { DigestMetrics } from '../components/weekly-digest/types';

const selectedVehicleContext = vi.hoisted(() => ({
  setVehicleId: vi.fn(),
}));
const sectionCaptures = vi.hoisted(() => ({} as Record<string, {
  isLoading?: boolean;
  isError?: boolean;
  error?: unknown;
}>));

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

// ── AI narration: reflect the numeric vehicle id the page derived ──
vi.mock('@/components/ai/AIDigestNarration', () => ({
  AIDigestNarration: ({ vehicleId }: { vehicleId?: number }) => (
    <div data-testid="ai-narration" data-vehicle-id={vehicleId ?? 'none'} />
  ),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: 7,
    vehicle: null,
    vehicles: [
      { id: 7, display_name: 'My Model 3', vin: 'VIN7' },
      { id: 9, display_name: 'My Model Y', vin: 'VIN9' },
    ],
    setVehicleId: selectedVehicleContext.setVehicleId,
  }),
}));

vi.mock('../components/weekly-digest', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/weekly-digest')>();
  return {
    ...actual,
    useWeeklyDigest: vi.fn(),
    useFsdWeeklyDigestNotification: vi.fn(),
  };
});

vi.mock('../components/weekly-digest-modernization', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../components/weekly-digest-modernization')>();
  return {
    ...actual,
    DigestSummary: (props: Parameters<typeof actual.DigestSummary>[0]) => {
      sectionCaptures[props.comparison ? 'wow-summary' : 'summary-hero'] = props;
      return <actual.DigestSummary {...props} />;
    },
    DrivingPanel: (props: Parameters<typeof actual.DrivingPanel>[0]) => {
      sectionCaptures['driving-section'] = props;
      return <actual.DrivingPanel {...props} />;
    },
    ChargingPanel: (props: Parameters<typeof actual.ChargingPanel>[0]) => {
      sectionCaptures['charging-section'] = props;
      return <actual.ChargingPanel {...props} />;
    },
    BatteryPanel: (props: Parameters<typeof actual.BatteryPanel>[0]) => {
      sectionCaptures['battery-section'] = props;
      return <actual.BatteryPanel {...props} />;
    },
    AlertsPanel: (props: Parameters<typeof actual.AlertsPanel>[0]) => {
      sectionCaptures['alerts-section'] = props;
      return <actual.AlertsPanel {...props} />;
    },
    FsdPanel: (props: Parameters<typeof actual.FsdPanel>[0]) => {
      sectionCaptures['fsd-section'] = props;
      return <actual.FsdPanel {...props} />;
    },
  };
});

import { useWeeklyDigest } from '../components/weekly-digest';
import WeeklyDigestPage from './WeeklyDigestPage';

const mockHook = vi.mocked(useWeeklyDigest);
type HookReturn = ReturnType<typeof useWeeklyDigest>;

const baseMetrics: DigestMetrics = {
  totalDistanceM: 0,
  prevDistanceM: 0,
  totalDrives: 0,
  prevDriveCount: 0,
  energyUsedWh: 0,
  prevEnergyWh: 0,
  chargingCost: 0,
  prevChargingCost: 0,
  co2Saved: 0,
  prevCo2: 0,
  avgEfficiencyWhPerM: 0,
  prevAvgEfficiencyWhPerM: 0,
  totalDurationS: 0,
  topDrive: undefined,
  chargeEnergyAddedWh: 0,
  prevChargeEnergyWh: 0,
  avgChargePowerW: 0,
  chargingSessionCount: 0,
  batteryStart: 0,
  batteryEnd: 0,
  alertsByType: {},
  alertTotal: 0,
};

function makeHook(over: Partial<HookReturn> = {}): HookReturn {
  const base: HookReturn = {
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
    fsdInsights: undefined,
    fsdLoading: false,
    fsdError: null,
    refetchFsd: vi.fn(),
    weekStart: new Date(2026, 2, 2),
    refetchAll: vi.fn(),
    freshnessQueries: [],
  };
  return { ...base, ...over };
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

const panelTitles: Record<string, string> = {
  'summary-hero': 'Week summary',
  'wow-summary': 'Week-over-week comparison',
  'driving-section': 'Daily distance',
  'charging-section': 'Daily energy added',
  'battery-section': 'Battery health',
  'alerts-section': 'Alerts',
  'fsd-section': 'Supervised driving',
};
function section(id: string): HTMLElement {
  const heading = screen.getAllByRole('heading', { name: panelTitles[id], level: 3 })
    .find(element => element.hasAttribute('data-card-title'));
  const card = heading?.closest('[data-card]');
  if (!(card instanceof HTMLElement)) throw new Error(`Missing real panel: ${id}`);
  return card;
}
const loadingAttr = (id: string) =>
  section(id).querySelector('[data-state="loading"], [aria-busy="true"], .animate-pulse') ? 'true' : 'false';
const errorAttr = (id: string) =>
  within(section(id)).queryByRole('alert') ? 'true' : 'false';
function errorMessage(id: string): string {
  const error = sectionCaptures[id]?.error;
  if (error) expect(within(section(id)).getByRole('alert')).toBeInTheDocument();
  return error instanceof Error ? error.message : error != null ? String(error) : '';
}
const retryButton = (id: string) =>
  within(section(id)).getByRole('button', { name: 'Retry' });

beforeEach(() => {
  mockHook.mockReset();
  mockHook.mockReturnValue(makeHook());
  selectedVehicleContext.setVehicleId.mockReset();
  for (const id of Object.keys(sectionCaptures)) delete sectionCaptures[id];
});

describe('WeeklyDigestPage — scaffolding + a11y', () => {
  it('renders the page header and every digest surface without a redundant vehicle picker', () => {
    renderPage();

    expect(screen.getByRole('heading', { level: 1, name: 'Weekly digest' })).toBeInTheDocument();
    expect(
      screen.getByText('Your driving and charging summary for the week'),
    ).toBeInTheDocument();

    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();

    for (const id of [
      'summary-hero',
      'driving-section',
      'charging-section',
      'battery-section',
      'alerts-section',
      'fsd-section',
      'wow-summary',
    ]) {
      expect(section(id)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: 'Previous' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByTestId('ai-narration')).toBeInTheDocument();
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
    expect(document.title).toContain('Weekly digest');
  });
});

describe('WeeklyDigestPage — summary aggregation (drives + charging)', () => {
  it('renders measured SI totals and source chart rows through the real shared renderers', () => {
    mockHook.mockReturnValue(makeHook({
      metrics: {
        ...baseMetrics,
        totalDistanceM: 120000,
        totalDrives: 12,
        energyUsedWh: 18000,
        chargingCost: 36,
        co2Saved: 24,
        chargingSessionCount: 3,
        chargeEnergyAddedWh: 20000,
        avgChargePowerW: 7000,
        batteryStart: 20,
        batteryEnd: 80,
        totalDurationS: 7200,
      },
      dailyDistanceData: [{ day: 'Mon', distanceM: 120000 }],
      dailyEnergyData: [{ day: 'Mon', energyWh: 20000 }],
    }));
    renderPage();
    const summary = section('summary-hero');
    expect(within(summary).getByText(/^120(?:\.00)? km$/)).toBeInTheDocument();
    expect(within(summary).getByText('12')).toBeInTheDocument();
    expect(within(summary).getByText(/^18(?:\.00)? kWh$/)).toBeInTheDocument();
    expect(within(summary).getByText('$36.00')).toBeInTheDocument();
    expect(within(summary).getByText(/^24(?:\.00)? kg$/)).toBeInTheDocument();
    expect(within(section('driving-section')).getByRole('table')).toHaveTextContent('120');
    expect(within(section('charging-section')).getByRole('table')).toHaveTextContent('20');
    expect(section('battery-section')).toHaveTextContent('60');
    expect(section('battery-section')).toHaveTextContent('110');
  });

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

  it('wires the FSD section to the FSD query and retries only FSD', () => {
    const refetchFsd = vi.fn();
    mockHook.mockReturnValue(makeHook({ fsdError: new Error('fsd down'), refetchFsd }));
    renderPage();

    expect(errorAttr('fsd-section')).toBe('true');
    expect(errorMessage('fsd-section')).toBe('fsd down');

    fireEvent.click(retryButton('fsd-section'));
    expect(refetchFsd).toHaveBeenCalledTimes(1);
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

    expect(screen.getByText('Jul 1 – Jul 7', { selector: '[title]' })).toBeInTheDocument();
    expect(screen.queryByText('Current')).toBeNull();
    expect(screen.getByRole('button', { name: 'Next' })).not.toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(goToPrevWeek).toHaveBeenCalledTimes(1);
    expect(goToNextWeek).toHaveBeenCalledTimes(1);
  });
});

describe('WeeklyDigestPage — shared vehicle scope', () => {
  it('consumes the shared numeric vehicle context without modifying it', () => {
    renderPage();
    expect(screen.queryByRole('combobox', { name: 'Select vehicle' })).not.toBeInTheDocument();
    expect(selectedVehicleContext.setVehicleId).not.toHaveBeenCalled();
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
