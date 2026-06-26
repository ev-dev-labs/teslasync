import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useCreateVehicleInvitation,
  useRefreshVehicleDrivers,
  useRefreshVehicleInvitations,
  useRemoveVehicleDriver,
  useRevokeVehicleInvitation,
  useVehicleDrivers,
  useVehicleInvitations,
  type VehicleDriver,
  type VehicleInvitation,
} from '../src/web-parity/api/hooks/useVehicleAccess';
import {useVehicle, useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import {useSettings} from '../src/web-parity/api/hooks/useSettings';
import VehicleAccessPage from '../src/web-parity/features/vehicles/pages/VehicleAccessPage';

jest.mock('../src/web-parity/api/hooks/useVehicleAccess', () => ({
  useVehicleDrivers: jest.fn(),
  useVehicleInvitations: jest.fn(),
  useRefreshVehicleDrivers: jest.fn(),
  useRefreshVehicleInvitations: jest.fn(),
  useRemoveVehicleDriver: jest.fn(),
  useCreateVehicleInvitation: jest.fn(),
  useRevokeVehicleInvitation: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
  useVehicle: jest.fn(),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: jest.fn(),
}));

const mockUseVehicleDrivers = useVehicleDrivers as unknown as jest.Mock;
const mockUseVehicleInvitations = useVehicleInvitations as unknown as jest.Mock;
const mockUseRefreshDrivers = useRefreshVehicleDrivers as unknown as jest.Mock;
const mockUseRefreshInvitations =
  useRefreshVehicleInvitations as unknown as jest.Mock;
const mockUseRemoveDriver = useRemoveVehicleDriver as unknown as jest.Mock;
const mockUseCreateInvitation = useCreateVehicleInvitation as unknown as jest.Mock;
const mockUseRevokeInvitation = useRevokeVehicleInvitation as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;
const mockUseVehicle = useVehicle as unknown as jest.Mock;
const mockUseSettings = useSettings as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text renders as adjacent text segments, so flatten every
// text leaf into one string before asserting.
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

function mutationStub(overrides: Record<string, unknown> = {}) {
  return {mutate: jest.fn(), isPending: false, ...overrides};
}

function queryStub<T>(data: T[] | undefined, isLoading: boolean) {
  return {data, isLoading};
}

const driver: VehicleDriver = {
  id: 7,
  vehicle_id: 1,
  share_user_id: 42,
  driver_email: 'ada@example.com',
  driver_name: 'Ada Driver',
  role: 'driver',
  fetched_at: '2026-01-01T00:00:00Z',
};

const invitation: VehicleInvitation = {
  id: 9,
  vehicle_id: 1,
  invitation_id: 'inv-9',
  invite_url: 'https://tesla.example/inv-9',
  status: 'pending',
  expires_at: '2026-12-31T00:00:00Z',
  created_by: 'owner@example.com',
  fetched_at: '2026-01-01T00:00:00Z',
  created_at: '2026-01-01T00:00:00Z',
};

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<VehicleAccessPage vehicleId="1" />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

beforeEach(() => {
  mockUseRefreshDrivers.mockReturnValue(mutationStub());
  mockUseRefreshInvitations.mockReturnValue(mutationStub());
  mockUseRemoveDriver.mockReturnValue(mutationStub());
  mockUseCreateInvitation.mockReturnValue(mutationStub());
  mockUseRevokeInvitation.mockReturnValue(mutationStub());
  mockUseVehicles.mockReturnValue({data: []});
  mockUseVehicle.mockReturnValue({data: {display_name: 'My Tesla'}});
  mockUseSettings.mockReturnValue({data: undefined});
});

afterEach(() => {
  jest.clearAllMocks();
});

test('renders the title and a centered spinner while access data loads', async () => {
  mockUseVehicleDrivers.mockReturnValue(queryStub<VehicleDriver>(undefined, true));
  mockUseVehicleInvitations.mockReturnValue(
    queryStub<VehicleInvitation>(undefined, false),
  );

  const tree = await render();
  const raw = rawOf(tree);

  expect(textOf(tree)).toContain('Vehicle Access');
  expect(raw).toContain('vehicle-access-page');
  expect(raw).toContain('vehicle-access-loading');
  // While loading, both section bodies are gated off, exactly like web.
  expect(raw).not.toContain('vehicle-access-drivers-table');
  expect(raw).not.toContain('vehicle-access-invitations-table');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders empty states for both drivers and invitations', async () => {
  mockUseVehicleDrivers.mockReturnValue(queryStub<VehicleDriver>([], false));
  mockUseVehicleInvitations.mockReturnValue(
    queryStub<VehicleInvitation>([], false),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('vehicle-access-drivers-empty');
  expect(raw).toContain('vehicle-access-invitations-empty');
  expect(text).toContain('No drivers found. Refresh to sync from Tesla.');
  expect(text).toContain(
    'No invitations yet. Create one to share vehicle access.',
  );
  // Section titles + the refresh / invite actions are always present.
  expect(text).toContain('Drivers');
  expect(text).toContain('Share Invitations');
  expect(text).toContain('Invite Driver');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders a driver row with name, email, role, and a remove action', async () => {
  mockUseVehicleDrivers.mockReturnValue(queryStub<VehicleDriver>([driver], false));
  mockUseVehicleInvitations.mockReturnValue(
    queryStub<VehicleInvitation>([], false),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('vehicle-access-drivers-table');
  expect(raw).toContain('vehicle-access-driver-row-7');
  expect(raw).toContain('vehicle-access-driver-remove-7');
  expect(text).toContain('Ada Driver');
  expect(text).toContain('ada@example.com');
  expect(text).toContain('driver');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});

test('renders a pending invitation with status, copy, and revoke actions', async () => {
  mockUseVehicleDrivers.mockReturnValue(queryStub<VehicleDriver>([], false));
  mockUseVehicleInvitations.mockReturnValue(
    queryStub<VehicleInvitation>([invitation], false),
  );

  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('vehicle-access-invitations-table');
  expect(raw).toContain('vehicle-access-invitation-row-9');
  expect(raw).toContain('vehicle-access-invitation-copy-9');
  expect(raw).toContain('vehicle-access-invitation-revoke-9');
  // pending -> online -> capitalised "Online" status label (web StatusBadge).
  expect(text).toContain('Online');
  expect(text).toContain('owner@example.com');

  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
});
