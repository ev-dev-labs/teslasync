import type { ReactNode } from 'react';
import { createInstance, type i18n } from 'i18next';
import { I18nextProvider, initReactI18next, useTranslation } from 'react-i18next';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import english from '@/i18n/en.json';
import { request } from '@/api/client';
import type { TeslaChargingSessionResponse } from '@/api/hooks/useCharging';
import { useVehicleState } from '@/api/hooks/useVehicles';
import type { OperationalBriefProps } from '@/components/data-display/OperationalBrief';
import { ToastProvider } from '@/components/feedback';
import { Text } from '@/components/ui';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import TeslaChargingSessionsPage from './TeslaChargingSessionsPage';
import ChargingListPage from './ChargingListPage';

vi.unmock('react-i18next');

vi.mock('@/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/api/client')>();
  return { ...actual, request: vi.fn() };
});

const captured = vi.hoisted(() => ({ brief: null as OperationalBriefProps | null }));

// Observe translated provenance at the page's real component boundary: the
// compact brief does not render this prop when a narrative is supplied.
vi.mock('@/components/data-display', async (importActual) => {
  const actual = await importActual<typeof import('@/components/data-display')>();
  return {
    ...actual,
    OperationalBrief: (props: OperationalBriefProps) => {
      if (props.testId === 'charging-operational-brief') captured.brief = props;
      return <actual.OperationalBrief {...props} />;
    },
  };
});

const returnedCopy = {
  sessionsLoading: 'Updating',
  returnedSessionsTitle: 'Cost, energy, and session evidence in one operating view',
  returnedSessionsDescription: 'The selected vehicle and date range drive charging totals, location analysis, and the supporting session history.',
  returnedSessionsProvenance: 'Derived from Tesla Fleet Charging session history, reported costs, and SI energy values converted only for display.',
} as const;

const history: TeslaChargingSessionResponse = {
  sessions: [{
    id: 1,
    session_id: 101,
    vin: 'VIN00000000000007',
    charger_id: null,
    site_location_name: 'Recorded charging site',
    charge_start_datetime: '2025-01-15T12:00:00Z',
    charge_stop_datetime: '2025-01-15T12:30:00Z',
    total_energy_added_wh: 20000,
    peak_power_kw: 120,
    max_charge_rate_kw: 150,
    charge_duration_s: 1800,
    charger_type: 'SUPERCHARGER',
    currency_code: 'USD',
    total_cost: 5,
    per_kwh_rate: 0.25,
    idle_fee: 0,
    congestion_fee: 0,
    latitude: null,
    longitude: null,
    fetched_at: '2025-01-16T00:00:00Z',
    created_at: '2025-01-16T00:00:00Z',
  }],
  summary: {
    total_sessions: 1,
    total_wh: 20000,
    total_cost: 5,
    avg_cost_per_kwh: 0.25,
    peak_power_kw: 120,
  },
};

const pending = () => new Promise<never>(() => {});
const mockedRequest = request as unknown as Mock<(path: string, options?: unknown) => Promise<unknown>>;
const clients: QueryClient[] = [];
let translations: i18n;
let historyPending: boolean;

class LocalIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null;
  readonly rootMargin: string;
  readonly thresholds: ReadonlyArray<number>;

  constructor(
    private readonly callback: IntersectionObserverCallback,
    options: IntersectionObserverInit = {},
  ) {
    this.root = options.root ?? null;
    this.rootMargin = options.rootMargin ?? '0px';
    this.thresholds = Array.isArray(options.threshold)
      ? options.threshold
      : [options.threshold ?? 0];
  }

  observe(target: Element) {
    // Sticky-header consumers need geometry as well as the visible-state flag.
    const boundingClientRect = target.getBoundingClientRect();
    this.callback([{
      boundingClientRect,
      intersectionRect: boundingClientRect,
      intersectionRatio: 1,
      isIntersecting: true,
      rootBounds: null,
      target,
      time: performance.now(),
    }], this);
  }

  unobserve() {}
  disconnect() {}
  takeRecords(): IntersectionObserverEntry[] { return []; }
}

function mount(children: ReactNode, route: string) {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  return render(
    <I18nextProvider i18n={translations}>
      <MemoryRouter initialEntries={[`${route}?vehicle_id=7&from=2000-01-01&to=2100-01-01`]}>
        <QueryClientProvider client={client}>
          <ToastProvider>
            <SelectedVehicleProvider>{children}</SelectedVehicleProvider>
          </ToastProvider>
        </QueryClientProvider>
      </MemoryRouter>
    </I18nextProvider>,
  );
}

// This probe exercises the actual pending vehicle-state hook with its existing
// loading key; it does not assert ChargingListPage renders this exact label.
function LiveQueryCopyProbe() {
  const query = useVehicleState(7);
  const { t } = useTranslation();
  return <Text role="status">{query.isLoading ? t('operations.status.loading') : 'Resolved'}</Text>;
}

beforeEach(async () => {
  vi.stubGlobal('IntersectionObserver', LocalIntersectionObserver);
  window.localStorage.clear();
  captured.brief = null;
  historyPending = false;
  mockedRequest.mockReset();
  mockedRequest.mockImplementation((path) => {
    if (path === '/vehicles') {
      return Promise.resolve([{
        id: 7,
        vehicle_id: 7,
        vin: 'VIN00000000000007',
        display_name: 'Model 3',
        model: 'Model 3',
        state: 'online',
        healthy: true,
        created_at: '2025-01-01T00:00:00Z',
        updated_at: '2025-01-01T00:00:00Z',
      }]);
    }
    if (path.startsWith('/tesla/charging/sessions')) {
      return historyPending ? pending() : Promise.resolve(history);
    }
    if (path.startsWith('/charging?')) return Promise.resolve([]);
    return pending();
  });
  translations = createInstance();
  await translations.use(initReactI18next).init({
    lng: 'en',
    fallbackLng: 'en',
    interpolation: { escapeValue: false },
    resources: { en: { translation: english } },
  });
  // Parent integrates these canonical leaves. Never seed approved strings into
  // the test resource or let source fallbacks masquerade as catalog evidence.
  for (const [leaf, value] of Object.entries(returnedCopy)) {
    const key = `operations.charging.${leaf}`;
    expect(translations.exists(key)).toBe(true);
    expect(translations.t(key)).toBe(value);
  }
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.unstubAllGlobals();
});

describe('Tesla charging history canonical copy isolation', () => {
  it('uses Updating for the pending history query without rewriting live-state or generic loading', async () => {
    historyPending = true;
    mount(<><TeslaChargingSessionsPage /><LiveQueryCopyProbe /></>, '/tesla/charging/sessions');

    const brief = await screen.findByTestId('charging-operational-brief');
    expect(within(brief).getByText('Updating')).toBeInTheDocument();
    expect(brief).toHaveAttribute('aria-busy', 'true');
    expect(within(brief).queryByText('Resolving live state')).not.toBeInTheDocument();
    expect(await screen.findByText('Resolving live state')).toBeInTheDocument();
    expect(translations.t('operations.status.loading')).toBe('Resolving live state');
    expect(translations.t('statCard.loading')).toBe('Loading');
    expect(translations.t('common.loading')).toBe('Loading...');
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledWith(
      expect.stringMatching(/^\/tesla\/charging\/sessions/), expect.anything(),
    ));
    expect(mockedRequest).toHaveBeenCalledWith('/vehicles/7/state', expect.anything());
  });

  it('renders returned-session title and description with historical, display-only SI provenance', async () => {
    mount(<TeslaChargingSessionsPage />, '/tesla/charging/sessions');
    const brief = await screen.findByTestId('charging-operational-brief');
    expect(within(brief).getByText(returnedCopy.returnedSessionsTitle)).toBeInTheDocument();
    expect(within(brief).getByText(returnedCopy.returnedSessionsDescription)).toBeInTheDocument();
    await waitFor(() => expect(brief).not.toHaveAttribute('aria-busy'));
    expect(captured.brief?.provenance).toBe(returnedCopy.returnedSessionsProvenance);
    expect(captured.brief?.provenance).not.toMatch(/live vehicle state|departure readiness/i);
    expect(captured.brief?.description).not.toMatch(/departure readiness|current charging state/i);
    expect(within(brief).getByLabelText('Historical')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh from Tesla' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Charging sessions table' })).toBeInTheDocument();
  });

  it('retains ChargingListPage live-state and departure copy independently of returned-session copy', async () => {
    mount(<ChargingListPage />, '/charging');
    const brief = await screen.findByTestId('charging-operational-brief');
    expect(within(brief).getByText('Cost, reliability, and battery-friendly behavior')).toBeInTheDocument();
    expect(within(brief).getByText(
      'Current charging state, departure readiness, cost exposure, and charger behavior are paired with the selected session history.',
    )).toBeInTheDocument();
    expect(captured.brief?.provenance).toBe(
      'Derived from live vehicle state, charging-session telemetry, configured cost data, and vehicle-local day boundaries.',
    );
    expect(within(brief).getByText('Checking')).toBeInTheDocument();
    expect(within(brief).queryByText(returnedCopy.returnedSessionsTitle)).not.toBeInTheDocument();
    expect(within(brief).queryByText(returnedCopy.returnedSessionsDescription)).not.toBeInTheDocument();
    expect(mockedRequest).toHaveBeenCalledWith('/vehicles/7/state', expect.anything());
  });
});
