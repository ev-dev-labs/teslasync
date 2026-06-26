import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import VehicleAccessWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/VehicleAccessWidget';

/**
 * Native parity contract for VehicleAccessWidget.
 *
 * The web widget reads the authorized drivers, pending invitations and the
 * mobile-access flag for the selected (or first) vehicle and renders one of two
 * layouts driven by the grid size:
 *   • Compact (cols <= 1): "{n} Drivers" + a status dot (enabled/disabled/
 *     unknown), or an EmptyState when there is no data at all.
 *   • Standard/Wide (cols >= 2): a "Mobile Access" Enabled/Disabled/Unknown
 *     badge, an "Authorized Drivers" detail list (Owner/Driver badges) and — only
 *     when present — a "Pending Invitations" list (Pending/Accepted/Expired).
 * The title ("Vehicle Access") is always shown by the shell. These tests mock
 * the drivers, invitations, mobile-enabled and vehicles hooks and assert the
 * ported behaviour.
 */

const mockUseVehicles = jest.fn();
const mockUseVehicleDrivers = jest.fn();
const mockUseVehicleInvitations = jest.fn();
const mockUseVehicleMobileEnabled = jest.fn();

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
  useVehicleMobileEnabled: (...args: unknown[]) =>
    mockUseVehicleMobileEnabled(...args),
}));

jest.mock('../src/web-parity/api/hooks/useVehicleAccess', () => ({
  useVehicleDrivers: (...args: unknown[]) => mockUseVehicleDrivers(...args),
  useVehicleInvitations: (...args: unknown[]) =>
    mockUseVehicleInvitations(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const refetchDrivers = jest.fn();
const refetchInvitations = jest.fn();
const refetchMobile = jest.fn();

function listQuery(
  data: Array<Record<string, unknown>> | undefined,
  refetch: jest.Mock,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    refetch,
    ...overrides,
  };
}

function mobileQuery(
  enabled: boolean | null,
  overrides: Record<string, unknown> = {},
) {
  return {
    data:
      enabled === null
        ? {data: null, fetched_at: null}
        : {data: {enabled}, fetched_at: '2026-06-26T12:00:00Z'},
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    refetch: refetchMobile,
    ...overrides,
  };
}

const DRIVERS = [
  {
    id: 1,
    vehicle_id: 7,
    share_user_id: null,
    driver_email: 'owner@example.com',
    driver_name: 'Ada Owner',
    role: 'owner',
    fetched_at: '2026-06-20T10:00:00Z',
  },
  {
    id: 2,
    vehicle_id: 7,
    share_user_id: 99,
    driver_email: 'driver@example.com',
    driver_name: 'Bob Driver',
    role: 'driver',
    fetched_at: '2026-06-21T10:00:00Z',
  },
];

const INVITATIONS = [
  {
    id: 10,
    vehicle_id: 7,
    invitation_id: 'inv-pending',
    invite_url: null,
    status: 'pending',
    expires_at: null,
    created_by: 'Carol Invitee',
    fetched_at: '2026-06-22T10:00:00Z',
    created_at: '2026-06-22T10:00:00Z',
  },
];

const STANDARD: WidgetSize = {cols: 2, rows: 2};
const COMPACT: WidgetSize = {cols: 1, rows: 2};

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

beforeEach(() => {
  jest.clearAllMocks();
  mockUseVehicles.mockReturnValue({data: [{id: 7}]});
  mockUseVehicleDrivers.mockReturnValue(listQuery(DRIVERS, refetchDrivers));
  mockUseVehicleInvitations.mockReturnValue(
    listQuery(INVITATIONS, refetchInvitations),
  );
  mockUseVehicleMobileEnabled.mockReturnValue(mobileQuery(true));
});

test('standard layout renders the title, mobile badge, drivers and invitations', async () => {
  const tree = await render(<VehicleAccessWidget size={STANDARD} />);

  const serialized = json(tree);
  // Title (uppercased by the shell) is always shown.
  expect(serialized).toContain('VEHICLE ACCESS');
  // Mobile access enabled -> "Enabled" badge + the section label.
  expect(serialized).toContain('Mobile Access');
  expect(serialized).toContain('Enabled');
  // Driver names + Owner/Driver badges.
  expect(serialized).toContain('Ada Owner');
  expect(serialized).toContain('Bob Driver');
  expect(serialized).toContain('Owner');
  expect(serialized).toContain('Driver');
  // Invitations section: creator + Pending badge.
  expect(serialized).toContain('Pending Invitations');
  expect(serialized).toContain('Carol Invitee');
  expect(serialized).toContain('Pending');
  // 2 driver rows + 1 invitation row = 3 detail rows; not the empty state.
  expect(hostsWithTestId(tree, 'widget-detail-row').length).toBe(3);
  expect(serialized).not.toContain('No access data available');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout shows the driver count, a status dot and the title', async () => {
  const tree = await render(<VehicleAccessWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).toContain('VEHICLE ACCESS');
  // "{count} Drivers" (two drivers in the fixture).
  expect(serialized).toContain('Drivers');
  expect(serialized).toContain('2');
  // Status dot renders; no detail rows in compact mode.
  expect(hostsWithTestId(tree, 'vehicle-access-mobile-dot').length).toBe(1);
  expect(hostsWithTestId(tree, 'widget-detail-row').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('mobile badge reflects disabled and unknown states', async () => {
  mockUseVehicleMobileEnabled.mockReturnValue(mobileQuery(false));
  let tree = await render(<VehicleAccessWidget size={STANDARD} />);
  expect(json(tree)).toContain('Disabled');
  await ReactTestRenderer.act(async () => tree.unmount());

  // Unknown mobile flag but drivers still present -> "Unknown" badge.
  mockUseVehicleMobileEnabled.mockReturnValue(mobileQuery(null));
  tree = await render(<VehicleAccessWidget size={STANDARD} />);
  expect(json(tree)).toContain('Unknown');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('hides the invitations section when there are no invitations', async () => {
  mockUseVehicleInvitations.mockReturnValue(listQuery([], refetchInvitations));

  const tree = await render(<VehicleAccessWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).not.toContain('Pending Invitations');
  // Only the 2 driver rows remain.
  expect(hostsWithTestId(tree, 'widget-detail-row').length).toBe(2);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the no-data EmptyState when every source is empty/unknown', async () => {
  mockUseVehicleDrivers.mockReturnValue(listQuery([], refetchDrivers));
  mockUseVehicleInvitations.mockReturnValue(listQuery([], refetchInvitations));
  mockUseVehicleMobileEnabled.mockReturnValue(mobileQuery(null));

  const tree = await render(<VehicleAccessWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No access data available');
  expect(hostsWithTestId(tree, 'widget-detail-row').length).toBe(0);
  expect(serialized).not.toContain('Ada Owner');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders a loading Skeleton instead of the body while a query loads', async () => {
  mockUseVehicleDrivers.mockReturnValue(
    listQuery(undefined, refetchDrivers, {isLoading: true}),
  );

  const tree = await render(<VehicleAccessWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThanOrEqual(1);
  expect(json(tree)).not.toContain('Ada Owner');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('falls back to the first vehicle id (stringified) and refetches all three sources', async () => {
  const tree = await render(<VehicleAccessWidget size={STANDARD} />);

  // vehicleId omitted -> each hook called with the first vehicle id '7'.
  expect(mockUseVehicleDrivers).toHaveBeenCalledWith('7');
  expect(mockUseVehicleInvitations).toHaveBeenCalledWith('7');
  expect(mockUseVehicleMobileEnabled).toHaveBeenCalledWith('7');

  const chip = tree.root.find(
    n =>
      n.props?.testID === 'widget-freshness' &&
      typeof n.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    chip.props.onPress();
  });
  expect(refetchDrivers).toHaveBeenCalledTimes(1);
  expect(refetchInvitations).toHaveBeenCalledTimes(1);
  expect(refetchMobile).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('uses the explicit vehicleId when provided', async () => {
  const tree = await render(
    <VehicleAccessWidget size={STANDARD} vehicleId={42} />,
  );

  expect(mockUseVehicleDrivers).toHaveBeenCalledWith('42');
  expect(mockUseVehicleInvitations).toHaveBeenCalledWith('42');
  expect(mockUseVehicleMobileEnabled).toHaveBeenCalledWith('42');

  await ReactTestRenderer.act(async () => tree.unmount());
});
