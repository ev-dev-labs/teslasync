import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {usePinned, useTogglePin} from '../src/web-parity/api/hooks/usePinned';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import {
  useClimateLatest,
  useVehicles,
} from '../src/web-parity/api/hooks/useVehicles';
import ClimateControlPanelWidget from '../src/web-parity/features/dashboard/widgets/ClimateControlPanelWidget';

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
  useClimateLatest: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/usePinned', () => ({
  usePinned: jest.fn(),
  useTogglePin: jest.fn(),
}));

const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseClimateLatest = useClimateLatest as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;
const mockUsePinned = usePinned as unknown as jest.Mock;
const mockUseTogglePin = useTogglePin as unknown as jest.Mock;

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

// climate snapshots are stored in SI (degC); the widget converts via
// convertTempFromSI at the display boundary.
function climateStub(overrides: Record<string, unknown> = {}) {
  return {
    data: {
      vehicle_id: 1,
      ts: '2024-01-01T00:00:00Z',
      inside_temp: 21,
      outside_temp: 15,
      hvac_power: 2.5,
      hvac_ac_enabled: true,
      hvac_fan_speed: 4,
      hvac_steering_wheel_heat_level: 2,
      seat_heater_left: 3,
      seat_heater_right: 0,
      seat_heater_rear_left: 0,
      seat_heater_rear_center: 0,
      seat_heater_rear_right: 0,
      defrost_mode: 'Front',
      battery_heater_on: true,
      source: 'test',
      ...overrides,
    },
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseClimateLatest.mockReturnValue(climateStub());
  mockUseSettings.mockReturnValue({data: {unit_of_temp: 'C'}});
  mockUsePinned.mockReturnValue({data: []});
  mockUseTogglePin.mockReturnValue({mutate: jest.fn(), isPending: false});
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
const STANDARD = {cols: 2, rows: 2};

const DEG_C = '\u00B0C';
const DEG_F = '\u00B0F';

test('renders the widget-shell skeleton while the climate query is loading', async () => {
  mockUseClimateLatest.mockReturnValue({
    ...climateStub(),
    data: undefined,
    isLoading: true,
    isFetching: true,
    dataUpdatedAt: 0,
  });

  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);
  const raw = rawOf(tree);

  expect(raw).toContain('widget-shell-skeleton');
  expect(raw).not.toContain('climate-control-panel-full');
  expect(raw).not.toContain('climate-control-panel-compact');

  await unmount(tree);
});

test('renders the title-less compact view with the converted cabin temperature', async () => {
  const tree = await render(<ClimateControlPanelWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('climate-control-panel-compact');
  // 21 degC, fixed 0 decimals, with the degC unit suffix.
  expect(text).toContain(`21${DEG_C}`);
  // Compact branch is title-less: no header title, no full view.
  expect(text).not.toContain('Climate Control');
  expect(raw).not.toContain('climate-control-panel-full');

  await unmount(tree);
});

test('renders every section of the full view', async () => {
  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('climate-control-panel-full');
  // Header title.
  expect(text).toContain('Climate Control');
  // HVAC status badge + live power.
  expect(text).toContain('HVAC On');
  expect(text).toContain('2.5 kW');
  // Temperature pair.
  expect(text).toContain('Cabin');
  expect(text).toContain(`21${DEG_C}`);
  expect(text).toContain('Outside');
  expect(text).toContain(`15${DEG_C}`);
  // Fan speed + wheel heat.
  expect(text).toContain('Fan Speed');
  expect(text).toContain('Wheel Heat');
  expect(text).toContain('2/3');
  // Seat-heater + defrost + battery-heater chips.
  expect(raw).toContain('climate-control-panel-seat-FL');
  expect(text).toContain('FL 3/3');
  expect(text).toContain('Defrost');
  expect(text).toContain('Bat Heater');

  await unmount(tree);
});

test('shows HVAC Off, no power read-out, and the no-seat-heaters fallback', async () => {
  mockUseClimateLatest.mockReturnValue(
    climateStub({
      hvac_power: null,
      hvac_ac_enabled: false,
      seat_heater_left: 0,
      defrost_mode: 'Off',
      battery_heater_on: false,
      hvac_steering_wheel_heat_level: 0,
    }),
  );

  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(text).toContain('HVAC Off');
  expect(text).not.toContain('kW');
  expect(text).toContain('No seat heaters active');
  // Wheel heat off, defrost off -> no defrost chip.
  expect(text).toContain('Off');
  expect(raw).not.toContain('climate-control-panel-defrost');
  expect(raw).not.toContain('climate-control-panel-batheater');

  await unmount(tree);
});

test('renders the empty state inside the shell when there is no climate data', async () => {
  mockUseClimateLatest.mockReturnValue({...climateStub(), data: null});

  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('widget-shell');
  expect(raw).toContain('climate-control-panel-empty');
  expect(text).toContain('No climate data');
  expect(raw).not.toContain('climate-control-panel-full');
  expect(raw).not.toContain('climate-control-panel-compact');

  await unmount(tree);
});

test('converts temperatures to Fahrenheit when the preference is F', async () => {
  mockUseClimateLatest.mockReturnValue(
    climateStub({inside_temp: 20, outside_temp: 0}),
  );
  mockUseSettings.mockReturnValue({data: {unit_of_temp: 'F'}});

  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);
  const text = textOf(tree);

  // 20 degC -> 68 degF, 0 degC -> 32 degF.
  expect(text).toContain(`68${DEG_F}`);
  expect(text).toContain(`32${DEG_F}`);
  expect(text).not.toContain(DEG_C);

  await unmount(tree);
});

test('falls back to the first vehicle id and polls climate every 5s', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);

  expect(mockUseClimateLatest).toHaveBeenCalledWith(7, 5000);

  await unmount(tree);
});

test('passes the explicit vehicleId prop to the climate hook', async () => {
  const tree = await render(
    <ClimateControlPanelWidget vehicleId={42} size={STANDARD} />,
  );

  expect(mockUseClimateLatest).toHaveBeenCalledWith(42, 5000);

  await unmount(tree);
});

test('uses id 0 (disabled) when there is no vehicle', async () => {
  mockUseVehicles.mockReturnValue({data: []});

  const tree = await render(<ClimateControlPanelWidget size={STANDARD} />);

  expect(mockUseClimateLatest).toHaveBeenCalledWith(0, 5000);

  await unmount(tree);
});
