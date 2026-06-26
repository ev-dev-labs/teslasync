import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useDrivingStats} from '../src/web-parity/api/hooks/useDriving';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {
  useVehicleState,
  useVehicles,
} from '../src/web-parity/api/hooks/useVehicles';
import OdometerCounterWidget from '../src/web-parity/features/dashboard/widgets/OdometerCounterWidget';

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
  useVehicleState: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useDriving', () => ({
  useDrivingStats: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseVehicleState = useVehicleState as unknown as jest.Mock;
const mockUseDrivingStats = useDrivingStats as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

function flattenText(node: JsonNode): string {
  if (node == null) {
    return '';
  }
  if (typeof node === 'string') {
    return node;
  }
  if (typeof node === 'number') {
    return String(node);
  }
  if (Array.isArray(node)) {
    return node.map(flattenText).join('');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

// odometer is stored in SI metres; the widget converts via convertDistanceFromSI.
function stateStub(odometer: number | null = 50_000) {
  return {
    data: {
      state:
        odometer == null
          ? undefined
          : {
              vehicle_id: 1,
              state: 'online',
              latitude: 0,
              longitude: 0,
              speed: 0,
              power: 0,
              battery_level: 85,
              rated_range: 0,
              ideal_range: 0,
              odometer,
              inside_temp: 0,
              outside_temp: 0,
              is_climate_on: false,
              is_charging: false,
              charger_power: 0,
              charge_rate: 0,
              time_to_full_charge: 0,
              is_locked: true,
              sentry_mode: false,
              software_version: '',
            },
      live: true,
    },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

function statsStub(totalDistanceKm = 150_000) {
  return {
    data: {
      totalDrives: 10,
      totalDistanceKm,
      totalDurationS: 0,
      avgEfficiencyWhKm: 0,
      avgSpeedKmh: 0,
      topSpeedKmh: 0,
      regenRatio: 0,
      regenEnergyWh: 0,
      co2SavedKg: 0,
    },
    isLoading: false,
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseVehicleState.mockReturnValue(stateStub());
  mockUseDrivingStats.mockReturnValue(statsStub());
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'km'}});
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  element: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function unmount(
  tree: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const COMPACT = {cols: 1, rows: 1};
const STANDARD = {cols: 1, rows: 2};
const WIDE = {cols: 2, rows: 2};

test('renders a loading skeleton while the vehicle state query is loading', async () => {
  mockUseVehicleState.mockReturnValue({
    ...stateStub(),
    data: undefined,
    isLoading: true,
    isFetching: true,
    dataUpdatedAt: 0,
  });

  const tree = await render(<OdometerCounterWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('odometer-counter-loading');
  expect(raw).not.toContain('odometer-counter-widget');

  await unmount(tree);
});

test('renders the loading skeleton while the driving-stats query is loading', async () => {
  mockUseDrivingStats.mockReturnValue({data: undefined, isLoading: true});

  const tree = await render(<OdometerCounterWidget size={WIDE} />);
  const raw = rawOf(tree);

  expect(raw).toContain('odometer-counter-loading');
  expect(raw).not.toContain('odometer-counter-widget');

  await unmount(tree);
});

test('renders the title-less compact view with the converted odometer + unit', async () => {
  mockUseVehicleState.mockReturnValue(stateStub(50_000));

  const tree = await render(<OdometerCounterWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('odometer-counter-widget');
  expect(raw).toContain('odometer-counter-compact');
  // 50,000 m -> 50 km, fixed 0 decimals.
  expect(text).toContain('50');
  expect(text).toContain('km');
  // The compact branch is title-less: no "Odometer" header, no expanded view.
  expect(text).not.toContain('Odometer');
  expect(raw).not.toContain('odometer-counter-expanded');
  // Freshness chip is wired (overlaid for the title-less layout).
  expect(raw).toContain('odometer-counter-freshness');

  await unmount(tree);
});

test('renders the expanded (non-wide) view without the metric breakdown grid', async () => {
  mockUseVehicleState.mockReturnValue(stateStub(200_000));

  const tree = await render(<OdometerCounterWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('odometer-counter-widget');
  expect(raw).toContain('odometer-counter-expanded');
  // Header title + caption + the odometer reading with the unit suffix.
  expect(text).toContain('Odometer');
  expect(text).toContain('Total Odometer');
  expect(text).toContain('200 km');
  // Not wide -> no metric cards.
  expect(raw).not.toContain('odometer-counter-metric-total-driven');
  expect(raw).not.toContain('odometer-counter-metric-unit');

  await unmount(tree);
});

test('renders the wide view with the total-driven and unit metric cards', async () => {
  mockUseVehicleState.mockReturnValue(stateStub(200_000));
  mockUseDrivingStats.mockReturnValue(statsStub(150_000));

  const tree = await render(<OdometerCounterWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('odometer-counter-expanded');
  expect(text).toContain('200 km');
  // Wide -> both metric cards render.
  expect(raw).toContain('odometer-counter-metric-total-driven');
  expect(raw).toContain('odometer-counter-metric-unit');
  expect(text).toContain('Total Driven');
  expect(text).toContain('Unit');
  // totalDistanceKm (150,000 m -> 150 km) + the unit value chip.
  expect(text).toContain('150 km');

  await unmount(tree);
});

test('shows an em dash for total driven when there are no driving stats', async () => {
  mockUseVehicleState.mockReturnValue(stateStub(200_000));
  mockUseDrivingStats.mockReturnValue({data: undefined, isLoading: false});

  const tree = await render(<OdometerCounterWidget size={WIDE} />);
  const text = textOf(tree);

  expect(text).toContain('Total Driven');
  expect(text).toContain('\u2014');

  await unmount(tree);
});

test('converts the odometer to miles when the length preference is mi', async () => {
  mockUseVehicleState.mockReturnValue(stateStub(160_934.4));
  mockUseSettings.mockReturnValue({data: {unit_of_length: 'mi'}});

  const tree = await render(<OdometerCounterWidget size={STANDARD} />);
  const text = textOf(tree);

  // 160,934.4 m / 1609.344 -> 100 mi.
  expect(text).toContain('100 mi');
  expect(text).not.toContain('km');

  await unmount(tree);
});

test('renders the empty state inside the shell when there is no odometer', async () => {
  mockUseVehicleState.mockReturnValue(stateStub(null));

  const tree = await render(<OdometerCounterWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('odometer-counter-widget');
  expect(text).toContain('No odometer data');
  // The section is never hidden; the odometer views are absent.
  expect(raw).not.toContain('odometer-counter-compact');
  expect(raw).not.toContain('odometer-counter-expanded');

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<OdometerCounterWidget size={WIDE} />);

  expect(mockUseVehicleState).toHaveBeenCalledWith(7);
  expect(mockUseDrivingStats).toHaveBeenCalledWith('7');

  await unmount(tree);
});

test('passes the explicit vehicleId prop to the data hooks', async () => {
  const tree = await render(<OdometerCounterWidget vehicleId={42} size={WIDE} />);

  expect(mockUseVehicleState).toHaveBeenCalledWith(42);
  expect(mockUseDrivingStats).toHaveBeenCalledWith('42');

  await unmount(tree);
});

test('disables the driving-stats query (undefined id) when there is no vehicle', async () => {
  mockUseVehicles.mockReturnValue({data: []});
  mockUseVehicleState.mockReturnValue(stateStub(null));

  const tree = await render(<OdometerCounterWidget size={WIDE} />);

  expect(mockUseVehicleState).toHaveBeenCalledWith(0);
  expect(mockUseDrivingStats).toHaveBeenCalledWith(undefined);

  await unmount(tree);
});
