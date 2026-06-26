import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import LiveSignalsWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/LiveSignalsWidget';

/**
 * Native parity contract for LiveSignalsWidget.
 *
 * The web widget polls the motor / climate / security / tire-pressure "latest"
 * snapshots (every 5s) for the selected (or first) vehicle and renders a
 * 2-column four-section grid (Motor, Climate, Tires, Security). Each section
 * falls back to a Skeleton while its own snapshot is still null; the widget
 * shows an EmptyState only when every snapshot is missing. Freshness + refresh
 * are driven solely by the motor query. SI snapshots (°C, kPa) are converted to
 * the user's display units at the boundary. These tests assert that behaviour
 * against the native port by mocking the four snapshot hooks, the vehicles hook
 * and the settings hook.
 */

const mockUseVehicles = jest.fn();
const mockUseMotorLatest = jest.fn();
const mockUseClimateLatest = jest.fn();
const mockUseSecurityLatest = jest.fn();
const mockUseLatestTirePressure = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
  useMotorLatest: (...args: unknown[]) => mockUseMotorLatest(...args),
  useClimateLatest: (...args: unknown[]) => mockUseClimateLatest(...args),
  useSecurityLatest: (...args: unknown[]) => mockUseSecurityLatest(...args),
  useLatestTirePressure: (...args: unknown[]) =>
    mockUseLatestTirePressure(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const refetchMotor = jest.fn();

function motorQuery(
  data: Record<string, unknown> | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    refetch: refetchMotor,
    ...overrides,
  };
}

const MOTOR = {
  di_torque: 250,
  di_stator_temp: 45,
  gear: 'D',
  ts: '2026-06-26T12:00:00Z',
  created_at: '2026-06-26T12:00:00Z',
};

const CLIMATE = {
  vehicle_id: 7,
  ts: '2026-06-26T12:00:00Z',
  inside_temp: 21,
  outside_temp: 15,
  hvac_power: 2.5,
  source: 'test',
};

const SECURITY = {
  vehicle_id: 7,
  ts: '2026-06-26T12:00:00Z',
  event_type: 'state',
  doors_open: null,
  windows_open: null,
  locked: true,
  sentry_mode: false,
  source: 'test',
  created_at: '2026-06-26T12:00:00Z',
};

const TIRES = {
  id: 1,
  vehicle_id: 7,
  front_left: 290,
  front_right: 290,
  rear_left: 280,
  rear_right: 280,
  created_at: '2026-06-26T12:00:00Z',
};

async function render(node: React.ReactElement): Promise<Tree> {
  let tree!: Tree;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

function hostsWithTestId(tree: Tree, testID: string) {
  return tree.root.findAll(
    n => n.props?.testID === testID && typeof n.type === 'string',
  );
}

const STANDARD: WidgetSize = {cols: 2, rows: 2};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseVehicles.mockReturnValue({data: [{id: 7}]});
  mockUseMotorLatest.mockReturnValue(motorQuery(MOTOR));
  mockUseClimateLatest.mockReturnValue({data: CLIMATE});
  mockUseSecurityLatest.mockReturnValue({data: SECURITY});
  mockUseLatestTirePressure.mockReturnValue({data: TIRES});
  mockUseSettings.mockReturnValue({
    data: {unit_of_temp: 'C', unit_of_pressure: 'bar', locale: 'en-US'},
  });
});

test('renders the title and all four sections with metric-unit values', async () => {
  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('LIVE SIGNALS');
  // Section headers (uppercased).
  expect(serialized).toContain('MOTOR');
  expect(serialized).toContain('CLIMATE');
  expect(serialized).toContain('TIRES');
  expect(serialized).toContain('SECURITY');
  // Motor: raw torque interpolation, SI °C temp, cleaned gear.
  expect(serialized).toContain('250 Nm');
  expect(serialized).toContain('45°C');
  expect(serialized).toContain('D');
  // Climate: cabin/outside temps + HVAC kW.
  expect(serialized).toContain('21°C');
  expect(serialized).toContain('15°C');
  expect(serialized).toContain('2.5 kW');
  // Tires: kPa -> bar (290/100 = 2.9, 280/100 = 2.8).
  expect(serialized).toContain('2.9 bar');
  expect(serialized).toContain('2.8 bar');
  // Security: locked -> "Locked", sentry off -> "Off".
  expect(serialized).toContain('Locked');
  expect(serialized).toContain('Off');
  // No EmptyState and no Skeleton fallbacks when every snapshot is present.
  expect(serialized).not.toContain('No live signal data');
  expect(hostsWithTestId(tree, 'skeleton').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('cleans Go "<nil>" gear strings to the em-dash placeholder', async () => {
  mockUseMotorLatest.mockReturnValue(
    motorQuery({...MOTOR, gear: '<nil>', di_torque: null, di_stator_temp: null}),
  );

  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const serialized = json(tree);
  // di_torque/di_stator_temp null and gear "<nil>" all collapse to "—".
  expect(serialized).toContain('—');
  expect(serialized).not.toContain('<nil>');
  expect(serialized).not.toContain('250 Nm');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState (and no section values) when every snapshot is missing', async () => {
  mockUseMotorLatest.mockReturnValue(motorQuery(null));
  mockUseClimateLatest.mockReturnValue({data: null});
  mockUseSecurityLatest.mockReturnValue({data: null});
  mockUseLatestTirePressure.mockReturnValue({data: null});

  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No live signal data');
  expect(serialized).not.toContain('250 Nm');
  expect(serialized).not.toContain('MOTOR');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('falls back to a per-section Skeleton when only one snapshot is present', async () => {
  // Only security present — the widget still renders (hasData) and the motor,
  // climate and tires sections each show their own Skeleton.
  mockUseMotorLatest.mockReturnValue(motorQuery(null));
  mockUseClimateLatest.mockReturnValue({data: null});
  mockUseLatestTirePressure.mockReturnValue({data: null});

  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const serialized = json(tree);
  // Not the whole-widget empty state.
  expect(serialized).not.toContain('No live signal data');
  // Security still renders its badges.
  expect(serialized).toContain('Locked');
  // Three sections fall back to Skeletons; the motor values are absent.
  expect(hostsWithTestId(tree, 'skeleton').length).toBe(3);
  expect(serialized).not.toContain('250 Nm');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the freshness affordance triggers the motor refetch on press', async () => {
  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const chip = tree.root.find(
    n =>
      n.props?.testID === 'widget-freshness' &&
      typeof n.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    chip.props.onPress();
  });
  expect(refetchMotor).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('honours imperial unit preferences (°F / psi)', async () => {
  mockUseSettings.mockReturnValue({
    data: {unit_of_temp: 'F', unit_of_pressure: 'psi', locale: 'en-US'},
  });

  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const serialized = json(tree);
  // 45°C -> 113°F (45 * 9/5 + 32).
  expect(serialized).toContain('113°F');
  expect(serialized).not.toContain('45°C');
  // 290 kPa -> 42.1 psi (290 / 6.894757, 1 decimal).
  expect(serialized).toContain('42.1 psi');
  expect(serialized).not.toContain('2.9 bar');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('reflects unlocked + active-sentry security state', async () => {
  mockUseSecurityLatest.mockReturnValue({
    data: {...SECURITY, locked: false, sentry_mode: true},
  });

  const tree = await render(<LiveSignalsWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('Unlocked');
  expect(serialized).toContain('Active');

  await ReactTestRenderer.act(async () => tree.unmount());
});
