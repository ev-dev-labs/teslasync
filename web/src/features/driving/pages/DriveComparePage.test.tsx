import type { ChangeEvent, ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import type { DriveDetail } from '@/types/driving';

const {
  pageTitleMock,
  selectedVehicleMock,
  useDriveMock,
  useDrivesMock,
} = vi.hoisted(() => ({
  pageTitleMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  useDriveMock: vi.fn(),
  useDrivesMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) => text.replaceAll(`{{${name}}}`, String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
  useDrive: (...args: unknown[]) => useDriveMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDistance: (value: number) => `${value} m`,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
}));

vi.mock('@/components/ui', () => ({
  Select: ({
    'aria-label': ariaLabel,
    value,
    onChange,
    options,
  }: {
    'aria-label': string;
    value: string;
    onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select aria-label={ariaLabel} value={value} onChange={onChange}>
      {options.map((option) => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  ),
}));

vi.mock('@/components/layout', () => ({
  PageContainer: ({
    title,
    subtitle,
    actions,
    children,
  }: {
    title: string;
    subtitle: string;
    actions: ReactNode;
    children: ReactNode;
  }) => (
    <main>
      <h1>{title}</h1>
      <p>{subtitle}</p>
      {actions}
      {children}
    </main>
  ),
  Grid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle">{pageTitle}</div>
  ),
}));

vi.mock('../components/drive-compare', () => {
  type State = { isLoading: boolean; error: unknown; emptyMessage: string | null };
  const status = (state: State) =>
    state.error ? 'error' : state.isLoading ? 'loading' : state.emptyMessage ?? 'ready';
  return {
    ComparisonVerdict: ({ state }: { state: State }) => (
      <section data-testid="compare-verdict">{status(state)}</section>
    ),
    AdvantageBreakdown: ({ state }: { state: State }) => (
      <section data-testid="compare-breakdown">{status(state)}</section>
    ),
    DriveIdentityCard: ({ side, state }: { side: string; state: State }) => (
      <section data-testid={`compare-identity-${side}`}>{status(state)}</section>
    ),
    SpeedComparisonChart: ({ state }: { state: State }) => (
      <section data-testid="compare-speed">{status(state)}</section>
    ),
    BatteryComparisonChart: ({ state }: { state: State }) => (
      <section data-testid="compare-battery">{status(state)}</section>
    ),
    HeadToHeadGrid: ({ state }: { state: State }) => (
      <section data-testid="compare-grid">{status(state)}</section>
    ),
  };
});

import DriveComparePage from './DriveComparePage';

function renderPage(initialEntry = '/drive-compare') {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <DriveComparePage />
    </MemoryRouter>,
  );
}

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...overrides,
  };
}

function detail(id: number): DriveDetail {
  return {
    id,
    vehicleId: 42,
    startTs: `2026-08-0${id}T08:00:00Z`,
    endTs: `2026-08-0${id}T08:30:00Z`,
    durationS: 1_800,
    distanceM: id * 10_000,
    startAddress: 'Home',
    endAddress: 'Office',
    startLat: null,
    startLon: null,
    endLat: null,
    endLon: null,
    startBatteryPct: 80,
    endBatteryPct: 70,
    energyUsedWh: 2_000,
    regenEnergyWh: 400,
    avgSpeedMps: 15,
    maxSpeedMps: 30,
    avgPowerW: null,
    outsideTempAvgC: 20,
    insideTempAvgC: null,
    score: 80,
    endedStatus: 'completed',
    createdAt: '',
    updatedAt: '',
    telemetry: [],
    positions: [],
  };
}

const driveA = detail(1);
const driveB = detail(2);
const SECTION_IDS = [
  'compare-verdict',
  'compare-breakdown',
  'compare-identity-a',
  'compare-identity-b',
  'compare-speed',
  'compare-battery',
  'compare-grid',
];

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query({ data: [driveA, driveB] }));
  useDriveMock.mockImplementation((id: string) =>
    query({ data: id === '1' ? driveA : driveB }));
});

describe('DriveComparePage', () => {
  it('mounts the complete workspace and requests the API maximum history', () => {
    renderPage();

    expect(screen.getByRole('heading', { name: 'Drive Compare' })).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', { limit: 1000 });
    expect(useDriveMock).toHaveBeenCalledWith('1');
    expect(useDriveMock).toHaveBeenCalledWith('2');
  });

  it('initializes both detail queries from list preselection parameters', () => {
    renderPage('/drive-compare?drive_a=2&drive_b=1');

    expect(useDriveMock).toHaveBeenCalledWith('2');
    expect(useDriveMock).toHaveBeenCalledWith('1');
    expect(screen.getByLabelText('Choose drive A')).toHaveValue('2');
    expect(screen.getByLabelText('Choose drive B')).toHaveValue('1');
  });

  it('surfaces a detail-query error instead of leaving comparison sections loading', () => {
    useDriveMock.mockImplementation((id: string) =>
      id === '1'
        ? query({ isError: true, error: new Error('detail failed') })
        : query({ data: driveB }));

    renderPage();

    expect(screen.getByTestId('compare-identity-a')).toHaveTextContent('error');
    expect(screen.getByTestId('compare-identity-b')).toHaveTextContent('ready');
    for (const id of ['compare-verdict', 'compare-breakdown', 'compare-speed', 'compare-battery', 'compare-grid']) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
      expect(screen.getByTestId(id)).not.toHaveTextContent('loading');
    }
  });

  it('keeps every section mounted with clear recovery copy for the same drive', () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Choose drive B'), { target: { value: '1' } });

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(
        'Pick two different drives with the A and B selectors above to continue.',
      );
    }
  });

  it('threads a list-query error to every mounted section', () => {
    useDrivesMock.mockReturnValue(query({ isError: true, error: new Error('list failed') }));
    useDriveMock.mockReturnValue(query());

    renderPage();

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('error');
    }
  });

  it('preserves the no-vehicle recovery state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });

    renderPage();

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Drive Compare');
    expect(screen.queryByTestId('compare-verdict')).not.toBeInTheDocument();
  });
});
