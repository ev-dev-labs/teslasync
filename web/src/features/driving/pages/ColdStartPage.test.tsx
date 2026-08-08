import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

const { useDrivesMock, selectedVehicleMock, pageTitleMock } = vi.hoisted(() => ({
  useDrivesMock: vi.fn(),
  selectedVehicleMock: vi.fn(),
  pageTitleMock: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, values?: Record<string, unknown>) =>
      Object.entries(values ?? {}).reduce(
        (text, [name, value]) =>
          text.replace(new RegExp(`{{${name}}}`, 'g'), String(value)),
        fallback,
      ),
  }),
}));

vi.mock('@/api/hooks/useDriving', () => ({
  useDrives: (...args: unknown[]) => useDrivesMock(...args),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleMock(),
}));

vi.mock('@/hooks/usePageTitle', () => ({
  usePageTitle: (title: string) => pageTitleMock(title),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: 0.2,
    formatCurrency: (value: number) => `$${value.toFixed(2)}`,
  }),
}));

vi.mock('@/hooks/useRangeState', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    useRangeState: () => {
      const [range, setRange] = React.useState({
        start: '2026-01-01',
        end: '2026-08-07',
      });
      return { ...range, setRange };
    },
  };
});

vi.mock('@/components/forms', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    VehicleSelect: () => React.createElement('div', { 'data-testid': 'vehicle-select' }),
    RangePicker: (props: {
      value: { start: string; end: string };
      onChange: (range: { start: string; end: string }) => void;
      triggerTestId?: string;
    }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': props.triggerTestId,
          'data-range': `${props.value.start}:${props.value.end}`,
          onClick: () =>
            props.onChange({ start: '2026-07-01', end: '2026-07-31' }),
        },
        'range',
      ),
  };
});

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

vi.mock('../components/cold-start', () => {
  const status = (state: { isLoading: boolean; error: unknown }) =>
    state.isLoading ? 'loading' : state.error ? 'error' : 'ready';
  const section = (testId: string, state: { isLoading: boolean; error: unknown }) => (
    <section data-testid={testId}>{status(state)}</section>
  );
  return {
    ColdStartKpis: (props: { isLoading: boolean; error: unknown }) =>
      section('cold-start-kpis', props),
    ColdWarmComparison: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-comparison', props.state),
    ColdStartMethodology: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-method', props.state),
    MonthlyColdStartChart: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-monthly', props.state),
    ParkingGapDistribution: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-gaps', props.state),
    TemperatureEfficiencyChart: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-temperature', props.state),
    ColdStartOpportunities: (props: { state: { isLoading: boolean; error: unknown } }) =>
      section('cold-start-opportunities', props.state),
  };
});

import ColdStartPage from './ColdStartPage';

function query(overrides: Record<string, unknown> = {}) {
  return {
    data: [],
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: 1,
    refetch: vi.fn(),
    ...overrides,
  };
}

const SECTION_IDS = [
  'cold-start-kpis',
  'cold-start-comparison',
  'cold-start-method',
  'cold-start-monthly',
  'cold-start-gaps',
  'cold-start-temperature',
  'cold-start-opportunities',
];

beforeEach(() => {
  vi.clearAllMocks();
  selectedVehicleMock.mockReturnValue({ vehicleId: 42 });
  useDrivesMock.mockReturnValue(query());
});

describe('ColdStartPage', () => {
  it('mounts every analysis section and requests the selected server window', () => {
    render(<ColdStartPage />);

    expect(screen.getByRole('heading', { name: 'Cold Start Cost' })).toBeInTheDocument();
    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent('ready');
    }
    expect(useDrivesMock).toHaveBeenCalledWith('42', {
      start: '2026-01-01',
      end: '2026-08-07',
      limit: 1000,
    });
  });

  it('re-queries with the newly selected range', async () => {
    render(<ColdStartPage />);
    fireEvent.click(screen.getByTestId('cold-start-range'));

    await waitFor(() =>
      expect(useDrivesMock).toHaveBeenLastCalledWith('42', {
        start: '2026-07-01',
        end: '2026-07-31',
        limit: 1000,
      }),
    );
  });

  it.each([
    ['loading', query({ isLoading: true })],
    ['error', query({ isError: true, error: new Error('unavailable') })],
  ])('threads the %s state to every mounted section', (expected, result) => {
    useDrivesMock.mockReturnValue(result);
    render(<ColdStartPage />);

    for (const id of SECTION_IDS) {
      expect(screen.getByTestId(id)).toHaveTextContent(expected);
    }
  });

  it('preserves the no-vehicle selection state', () => {
    selectedVehicleMock.mockReturnValue({ vehicleId: null });
    render(<ColdStartPage />);

    expect(screen.getByTestId('no-vehicle')).toHaveTextContent('Cold Start Cost');
    expect(screen.queryByTestId('cold-start-comparison')).not.toBeInTheDocument();
  });
});
