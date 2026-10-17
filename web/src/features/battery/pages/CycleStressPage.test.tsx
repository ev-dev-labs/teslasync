import {
  QueryClient,
  QueryClientProvider,
} from '@tanstack/react-query';
import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { ToastProvider } from '@/components/feedback';
import { assertOperationalBriefDisclosure } from '@/test/operationalBriefAssertions';
import type { ChargingSession } from '@/types/charging';
import type { Drive } from '@/types/driving';

const FROZEN_NOW = Date.parse('2026-08-08T12:00:00.000Z');
const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  sessions: undefined as unknown,
  drives: undefined as unknown,
  chargingHook: vi.fn(),
  drivingHook: vi.fn(),
  timezoneHook: vi.fn(),
  timeZone: 'America/Los_Angeles',
}));
const refetchCharging = vi.fn();
const refetchDrives = vi.fn();

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>(
    'react-i18next',
  );
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: unknown) => {
        const text = typeof fallback === 'string' ? fallback : key;
        const values =
          options && typeof options === 'object'
            ? (options as Record<string, unknown>)
            : {};
        return text.replace(
          /\{\{\s*(\w+)\s*\}\}/g,
          (_match, name: string) =>
            values[name] != null ? String(values[name]) : '',
        );
      },
      i18n: { language: 'en-US', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useCharging', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useCharging')
  >();
  return {
    ...actual,
    useChargingHistory: (vehicleId?: string, limit?: number) => {
      h.chargingHook(vehicleId, limit);
      return h.sessions;
    },
  };
});

vi.mock('@/api/hooks/useDriving', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('@/api/hooks/useDriving')
  >();
  return {
    ...actual,
    useDriveHistory: (vehicleId?: string, limit?: number) => {
      h.drivingHook(vehicleId, limit);
      return h.drives;
    },
  };
});

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({
    vehicleId: h.vehicleId,
    vehicle: null,
    vehicles: [],
    setVehicleId: vi.fn(),
  }),
}));

vi.mock('@/lib/timezone', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/timezone')>();
  return {
    ...actual,
    useTimezone: (mode: string) => {
      h.timezoneHook(mode);
      return h.timeZone;
    },
  };
});

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

import CycleStressPage from './CycleStressPage';

let nextId = 1;

function session(
  start: string,
  end: string,
  startSoc: number,
  endSoc: number,
): ChargingSession {
  return {
    id: String(nextId++),
    vehicle_id: '7',
    charger_type: 'AC',
    start_soc_pct: startSoc,
    end_soc_pct: endSoc,
    total_energy_added_wh: 30_000,
    peak_power_w: null,
    cost_decimal: null,
    started_at: start,
    ended_at: end,
    start_ts: start,
    startedAt: start,
    duration_min: 60,
  };
}

function drive(
  start: string,
  end: string,
  startSoc: number,
  endSoc: number,
): Drive {
  return {
    id: nextId++,
    vehicleId: 7,
    startTs: start,
    endTs: end,
    durationS: (Date.parse(end) - Date.parse(start)) / 1_000,
    distanceM: 20_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: 37.1,
    startLon: -122.1,
    endLat: 37.2,
    endLon: -122.2,
    startBatteryPct: startSoc,
    endBatteryPct: endSoc,
    energyUsedWh: 4_000,
    regenEnergyWh: 300,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: 5_000,
    outsideTempAvgC: 20,
    insideTempAvgC: 21,
    score: null,
    endedStatus: 'completed',
    createdAt: start,
    updatedAt: end,
  };
}

function readyHistory() {
  return {
    sessions: [
      session(
        '2026-07-01T10:00:00.000Z',
        '2026-07-01T11:00:00.000Z',
        20,
        90,
      ),
      session(
        '2026-07-02T10:00:00.000Z',
        '2026-07-02T11:00:00.000Z',
        30,
        80,
      ),
      session(
        '2026-08-01T10:00:00.000Z',
        '2026-08-01T11:00:00.000Z',
        25,
        85,
      ),
    ],
    drives: [
      drive(
        '2026-07-01T12:00:00.000Z',
        '2026-07-01T13:00:00.000Z',
        89,
        30,
      ),
      drive(
        '2026-07-02T12:00:00.000Z',
        '2026-07-02T13:00:00.000Z',
        79,
        25,
      ),
      drive(
        '2026-08-01T12:00:00.000Z',
        '2026-08-01T13:00:00.000Z',
        84,
        20,
      ),
    ],
  };
}

interface QueryStub {
  data: unknown;
  isLoading: boolean;
  isFetching: boolean;
  isSuccess: boolean;
  isError: boolean;
  error: unknown;
  fetchStatus?: 'fetching' | 'paused' | 'idle';
  refetch: () => void;
}

function query(
  refetch: () => void,
  overrides: Partial<QueryStub> = {},
): QueryStub {
  const isLoading = overrides.isLoading ?? false;
  const isError = overrides.isError ?? false;
  return {
    data: undefined,
    isLoading,
    isFetching: overrides.isFetching ?? isLoading,
    isSuccess: overrides.isSuccess ?? (!isLoading && !isError),
    isError,
    error: null,
    refetch,
    ...overrides,
  };
}

function tree(client: QueryClient) {
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={['/cycle-stress']}>
          <CycleStressPage />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const view = render(tree(client));
  return {
    ...view,
    rerenderPage: () => view.rerender(tree(client)),
  };
}

const sectionIds = [
  'cycle-stress-kpis',
  'cycle-stress-depth-distribution',
  'cycle-stress-month-trend',
  'cycle-stress-threshold-sensitivity',
  'cycle-stress-exponent-sensitivity',
  'cycle-stress-mean-soc-profile',
  'cycle-stress-duration-profile',
  'cycle-stress-composition',
  'cycle-stress-turning-points',
  'cycle-stress-directory',
  'cycle-stress-source-coverage',
  'cycle-stress-continuity',
  'cycle-stress-evidence-support',
  'cycle-stress-accounting',
  'cycle-stress-methodology',
] as const;

function expectEverySection(): void {
  for (const testId of sectionIds) {
    expect(screen.getByTestId(testId)).toBeInTheDocument();
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  nextId = 1;
  h.vehicleId = 7;
  h.timeZone = 'America/Los_Angeles';
  const history = readyHistory();
  h.sessions = query(refetchCharging, { data: history.sessions });
  h.drives = query(refetchDrives, { data: history.drives });
  vi.spyOn(Date, 'now').mockReturnValue(FROZEN_NOW);
});

describe('CycleStressPage', () => {
  it.each(['no vehicle', 'loading', 'paused initial', 'failure', 'empty', 'unqualified'] as const)(
    'CSQA-03 excludes generated chart alternatives for %s while preserving every shell',
    (sourceState) => {
      if (sourceState === 'no vehicle') h.vehicleId = null;
      if (sourceState === 'loading') {
        h.sessions = query(refetchCharging, { isLoading: true });
        h.drives = query(refetchDrives, { isLoading: true });
      }
      if (sourceState === 'paused initial') {
        h.sessions = query(refetchCharging, { fetchStatus: 'paused', isSuccess: false });
        h.drives = query(refetchDrives, { fetchStatus: 'paused', isSuccess: false });
      }
      if (sourceState === 'failure') {
        h.sessions = query(refetchCharging, { isError: true });
        h.drives = query(refetchDrives, { isError: true });
      }
      if (sourceState === 'empty' || sourceState === 'unqualified') {
        const history = readyHistory();
        h.sessions = query(refetchCharging, {
          data: sourceState === 'empty' ? [] : [{ ...history.sessions[0], end_soc_pct: null }],
        });
        h.drives = query(refetchDrives, { data: [] });
      }
      renderPage();
      expectEverySection();
      for (const id of ['depth-distribution', 'threshold-sensitivity', 'exponent-sensitivity',
        'mean-soc-profile', 'duration-profile']) {
        const section = screen.getByTestId(`cycle-stress-${id}`);
        expect(section.querySelector('figcaption table')).toBeNull();
        expect(section.querySelector('figcaption')).toHaveTextContent(
          /Select a vehicle|Loading Cycle Stress|Both source histories|has not resolved|No drive or charging|No returned row/,
        );
      }
    },
  );

  it('CSQA-03 retains all raw chart alternatives and real zero bins with available cycles', () => {
    h.drives = query(refetchDrives, { isLoading: true });
    renderPage();
    for (const [id, rowCount] of [
      ['depth-distribution', 5], ['threshold-sensitivity', 5], ['exponent-sensitivity', 4],
      ['mean-soc-profile', 5], ['duration-profile', 4],
    ] as const) {
      const table = screen.getByTestId(`cycle-stress-${id}`).querySelector('figcaption table');
      expect(table).not.toBeNull();
      expect(table?.querySelectorAll('tbody tr')).toHaveLength(rowCount);
    }
    const depthTable = screen.getByTestId('cycle-stress-depth-distribution')
      .querySelector('figcaption table');
    // First histogram bin per HISTOGRAM_EDGES [0, 10, 25, 50, 75, 100]
    // (unchanged since the lib was created; the old '0-20%' label never
    // matched production). Zero bins stay explicit, never blank.
    expect(depthTable?.querySelector('tbody tr')).toHaveTextContent('0-10%000');
  });

  it('CSQA-04/06 keeps every diagnostic label and caption wrapping with neutral decorative icons', () => {
    renderPage();
    for (const [id, count] of [
      ['source-coverage', 8], ['continuity', 10], ['composition', 6], ['evidence-support', 6],
    ] as const) {
      const section = screen.getByTestId(`cycle-stress-${id}`);
      expect(section.querySelectorAll('[data-role="metric-card"]')).toHaveLength(count);
      for (const caption of section.querySelectorAll('[data-role="metric-subtitle"]')) {
        expect(caption).toHaveClass('whitespace-normal', 'break-words');
        expect(caption).not.toHaveClass('truncate');
      }
      for (const label of section.querySelectorAll('[data-role="metric-label"]')) {
        expect(label).not.toHaveClass('truncate');
        expect(label.firstElementChild).toHaveClass('break-words');
      }
      for (const icon of section.querySelectorAll('[data-role="metric-icon"]')) {
        expect(icon).toHaveAttribute('data-color', 'neutral');
      }
    }
  });

  it.each(['cap', 'unqualified', 'thin'] as const)(
    'CSQA-07 keeps the %s caveat beside available evidence with an ordinary pending neighbor',
    (caveat) => {
      const history = readyHistory();
      h.sessions = query(refetchCharging, {
        data: caveat === 'cap'
          ? Array.from({ length: 1_000 }, (_, index) => ({ ...history.sessions[0], id: String(index) }))
          : caveat === 'unqualified'
            ? [{ ...history.sessions[0], end_soc_pct: null }]
            : [history.sessions[0]],
      });
      h.drives = query(refetchDrives, { isLoading: true });
      const view = renderPage();
      const text = caveat === 'cap' ? /1,000-row cap/
        : caveat === 'unqualified' ? /no complete, valid/ : /Thin support/;
      expect(screen.getByTestId('cycle-stress-retained-caveat')).toHaveTextContent(text);
      h.drives = query(refetchDrives, { data: [] });
      view.rerenderPage();
      expect(screen.queryByTestId('cycle-stress-retained-caveat')).not.toBeInTheDocument();
      expect(within(screen.getByTestId('cycle-stress-kpis')).getAllByText(text)).toHaveLength(1);
    },
  );

  it('CSQA-01 wires cached paused trust into both summary and accounting', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, { data: history.sessions, fetchStatus: 'paused' });
    renderPage();
    // The retained marker moved off the face into the summary drawer's
    // status badge.
    assertOperationalBriefDisclosure(
      screen.getByTestId('cycle-stress-kpis'),
      'Retained source evidence',
      { contains: true },
    );
    // Accounting renders no brief: paused trust surfaces as retained numbers
    // (never a blanked section) while the marker lives in the summary drawer.
    // (The old accounting text assertion never matched production and is
    // replaced by this retained-content check.)
    const accounting = screen.getByTestId('cycle-stress-accounting');
    expect(within(accounting).getByText('Known rows returned')).toBeInTheDocument();
    expect(within(accounting).queryByText('No accounting categories are available.')).not.toBeInTheDocument();
  });

  it('renders all fifteen analytical shells with both capped hooks', () => {
    renderPage();

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Cycle Stress',
      }),
    ).toBeInTheDocument();
    expectEverySection();
    expect(h.chargingHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.drivingHook).toHaveBeenLastCalledWith('7', 1_000);
    expect(h.timezoneHook).toHaveBeenCalledWith('vehicle');
  });

  it('recomputes threshold and exponent descriptions from both selectors', () => {
    renderPage();

    fireEvent.change(
      screen.getByRole('combobox', { name: 'Deep-cycle lens' }),
      { target: { value: '80' } },
    );
    fireEvent.change(
      screen.getByRole('combobox', { name: 'Depth exponent' }),
      { target: { value: '2' } },
    );

    const kpisBand = screen.getByTestId('cycle-stress-kpis');
    const kpis = within(kpisBand);
    expect(kpis.getByText('80%+ cycle share')).toBeInTheDocument();
    // Metric context moved off the face into the drawer's per-metric groups.
    fireEvent.click(kpis.getByRole('button', { name: 'Review details' }));
    const kpisDrawer = screen.getByRole('dialog');
    expect(within(kpisDrawer).getByRole('group', { name: 'Depth-weighted index' }))
      .toHaveTextContent('illustrative exponent 2');
    fireEvent.keyDown(kpisDrawer, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId('cycle-stress-methodology')).getByText(
        /raised to exponent 2/i,
      ),
    ).toBeInTheDocument();
  });

  it('freezes recency across source updates', () => {
    const view = renderPage();
    const support = within(
      screen.getByTestId('cycle-stress-evidence-support'),
    );
    const recencyBefore = support.getByText(/days$/).textContent;

    vi.mocked(Date.now).mockReturnValue(
      FROZEN_NOW + 30 * 86_400_000,
    );
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: [...history.sessions],
    });
    h.drives = query(refetchDrives, {
      data: [...history.drives],
    });
    view.rerenderPage();

    expect(
      within(
        screen.getByTestId('cycle-stress-evidence-support'),
      ).getByText(recencyBefore ?? ''),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible while both sources load', () => {
    h.sessions = query(refetchCharging, { isLoading: true });
    h.drives = query(refetchDrives, { isLoading: true });

    renderPage();

    expectEverySection();
    expect(
      screen.getByRole('status', {
        name: 'Loading Cycle Stress evidence',
      }),
    ).toBeInTheDocument();
  });

  it('keeps every shell visible without a selected vehicle', () => {
    h.vehicleId = null;
    h.sessions = query(refetchCharging);
    h.drives = query(refetchDrives);

    renderPage();

    expectEverySection();
    expect(h.chargingHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(h.drivingHook).toHaveBeenLastCalledWith(undefined, 1_000);
    expect(
      screen.getByText(
        'Select a vehicle to analyze its returned charge and drive history.',
      ),
    ).toBeInTheDocument();
  });

  it('offers independently scoped retries when both histories fail', () => {
    h.sessions = query(refetchCharging, {
      isError: true,
      error: new Error('charging failed'),
    });
    h.drives = query(refetchDrives, {
      isError: true,
      error: new Error('drives failed'),
    });

    renderPage();

    expectEverySection();
    const retries = screen.getAllByRole('button', { name: /^Retry / });
    expect(retries).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Charging history' }));
    expect(refetchCharging).toHaveBeenCalledTimes(1);
    expect(refetchDrives).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Drive history' }));
    expect(refetchDrives).toHaveBeenCalledTimes(1);
  });

  it('shows usable partial evidence and one retry when one source fails', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      isError: true,
      error: new Error('charging failed'),
    });
    h.drives = query(refetchDrives, { data: history.drives });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'Partial evidence is shown while these sources are unavailable or pending: Charging history.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: /^Retry / }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Charging history' }));
    expect(refetchCharging).toHaveBeenCalledTimes(1);
    expect(refetchDrives).not.toHaveBeenCalled();
  });

  it('retains cached evidence through a refresh error', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: history.sessions,
      isError: true,
      isSuccess: false,
      error: new Error('refresh failed'),
    });

    renderPage();

    expectEverySection();
    expect(
      screen.getByText(
        'One or more histories could not refresh. Showing the most recently loaded evidence.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getAllByRole('button', { name: 'Retry Charging history' }),
    ).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry Charging history' }));
    expect(refetchCharging).toHaveBeenCalledTimes(1);
    expect(refetchDrives).not.toHaveBeenCalled();
  });

  it('keeps all shells and exact accounting for empty success', () => {
    h.sessions = query(refetchCharging, { data: [] });
    h.drives = query(refetchDrives, { data: [] });

    renderPage();

    expectEverySection();
    expect(
      within(screen.getByTestId('cycle-stress-kpis')).getByText(
        'No drive or charging history was returned for this vehicle.',
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId('cycle-stress-accounting')).getByText(
        '0 known returned = 0 included + 0 excluded. Missing completion times are never synthesized from duration, and missing SoC is never imputed.',
      ),
    ).toBeInTheDocument();
  });

  it.each([
    { name: 'retained refresh failure', partial: false },
    { name: 'independent source failure', partial: true },
  ])('keeps the history-cap caveat alongside $name', ({ partial }) => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: Array.from({ length: 1_000 }, (_, index) => ({
        ...history.sessions[0],
        id: String(index + 1),
      })),
      isError: !partial,
      error: partial ? null : new Error('refresh failed'),
    });
    if (partial) {
      h.drives = query(refetchDrives, {
        isError: true,
        error: new Error('drives failed'),
      });
    }

    renderPage();

    expectEverySection();
    expect(screen.getByTestId('cycle-stress-retained-caveat')).toHaveTextContent(
      'At least one source returned exactly its 1,000-row cap. Older matching history may be omitted, and the two source spans may differ.',
    );
    expect(screen.getAllByRole('button', {
      name: partial ? 'Retry Drive history' : 'Retry Charging history',
    })).toHaveLength(1);
    const unaffectedRetry = partial ? refetchCharging : refetchDrives;
    fireEvent.click(screen.getByRole('button', {
      name: partial ? 'Retry Drive history' : 'Retry Charging history',
    }));
    expect(unaffectedRetry).not.toHaveBeenCalled();
  });

  it('retains qualification limits alongside a paused source without inventing zero SoC', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: [{ ...history.sessions[0], end_soc_pct: null }],
      fetchStatus: 'paused',
    });
    h.drives = query(refetchDrives, { data: [] });

    renderPage();

    expectEverySection();
    expect(screen.getByTestId('cycle-stress-retained-caveat')).toHaveTextContent(
      'Returned rows contained no complete, valid, non-future interval with direction-consistent SoC endpoints.',
    );
    expect(screen.getByText(
      'Charging history is paused while offline. Previously loaded evidence, if available, is retained.',
    )).toBeInTheDocument();
    assertOperationalBriefDisclosure(
      screen.getByTestId('cycle-stress-kpis'),
      'Retained source evidence',
      { contains: true },
    );
    expect(screen.getAllByRole('button', { name: 'Retry Charging history' })).toHaveLength(1);
  });

  it('keeps thin-support limits visible with retained history and avoids duplicate normal notices', () => {
    const history = readyHistory();
    h.sessions = query(refetchCharging, {
      data: [history.sessions[0]],
      fetchStatus: 'paused',
    });
    h.drives = query(refetchDrives, { data: [] });
    const view = renderPage();

    expectEverySection();
    expect(screen.getByTestId('cycle-stress-retained-caveat')).toHaveTextContent(
      'Thin support: interpret cycle summaries as limited reconstructed evidence.',
    );

    h.sessions = query(refetchCharging, { data: [history.sessions[0]] });
    view.rerenderPage();

    expect(screen.queryByTestId('cycle-stress-retained-caveat')).not.toBeInTheDocument();
    expect(screen.getAllByText(
      'Thin support: interpret cycle summaries as limited reconstructed evidence.',
    )).toHaveLength(1);
  });
});
