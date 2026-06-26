import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import SoftwareUpdateHistoryWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/SoftwareUpdateHistoryWidget';

/**
 * Native parity contract for SoftwareUpdateHistoryWidget.
 *
 * The web widget reads the software-update history for the selected (or first)
 * vehicle and renders one of two layouts driven by the grid size:
 *   • Compact (cols <= 1): the latest version + a status Badge ("Current" when
 *     installed, otherwise the raw status), or an EmptyState when empty.
 *   • Standard/Wide (cols >= 2): a WidgetEventFeed timeline (newest first, max
 *     15) of the updates — each row a tinted status glyph, the version, a
 *     "Current"/status subtitle and a relative timestamp — or an EmptyState.
 * The title ("Update History") is always shown by the shell. These tests mock
 * the vehicles, software-updates and settings hooks and assert the ported
 * behaviour.
 */

const mockUseVehicles = jest.fn();
const mockUseSoftwareUpdates = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: (...args: unknown[]) => mockUseVehicles(...args),
}));

jest.mock('../src/web-parity/api/hooks/useVehicleSystems', () => ({
  useSoftwareUpdates: (...args: unknown[]) => mockUseSoftwareUpdates(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const refetch = jest.fn();

function updatesQuery(
  data: Array<Record<string, unknown>> | undefined,
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

// Three updates: idx 0 is the newest installed build (-> "Current"), then an
// installing and a scheduled update with strictly older timestamps so the
// newest-first feed order is installed -> installing -> scheduled.
const UPDATES = [
  {
    id: 'u3',
    vehicleId: '7',
    version: '2026.20.5',
    status: 'installed',
    installedAt: '2026-06-26T05:00:00Z',
    scheduledAt: null,
    createdAt: '2026-06-25T00:00:00Z',
  },
  {
    id: 'u2',
    vehicleId: '7',
    version: '2026.18.2',
    status: 'installing',
    installedAt: null,
    scheduledAt: null,
    createdAt: '2026-06-20T00:00:00Z',
  },
  {
    id: 'u1',
    vehicleId: '7',
    version: '2026.16.1',
    status: 'scheduled',
    installedAt: null,
    scheduledAt: '2026-06-10T00:00:00Z',
    createdAt: '2026-06-09T00:00:00Z',
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
  mockUseSoftwareUpdates.mockReturnValue(updatesQuery(UPDATES));
  mockUseSettings.mockReturnValue({data: {locale: 'en-US', unit_of_temp: 'C'}});
});

test('renders the title and a feed of update versions with status subtitles', async () => {
  const tree = await render(<SoftwareUpdateHistoryWidget size={STANDARD} />);

  const serialized = json(tree);
  // Title (uppercased by the shell) is always shown.
  expect(serialized).toContain('UPDATE HISTORY');
  // Every version renders in the feed.
  expect(serialized).toContain('2026.20.5');
  expect(serialized).toContain('2026.18.2');
  expect(serialized).toContain('2026.16.1');
  // Newest installed build is highlighted as "Current"; the rest show status.
  expect(serialized).toContain('Current');
  expect(serialized).toContain('installing');
  expect(serialized).toContain('scheduled');
  // The feed container renders (3 timeline rows), not the empty state.
  expect(hostsWithTestId(tree, 'software-update-feed').length).toBe(1);
  expect(hostsWithTestId(tree, 'timeline-item').length).toBe(3);
  expect(serialized).not.toContain('No update history');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout shows the latest version and a Current badge with the title', async () => {
  const tree = await render(<SoftwareUpdateHistoryWidget size={COMPACT} />);

  const serialized = json(tree);
  // Title is still rendered in compact mode (shell always receives it).
  expect(serialized).toContain('UPDATE HISTORY');
  // Latest version + "Current" badge (status installed).
  expect(serialized).toContain('2026.20.5');
  expect(serialized).toContain('Current');
  // No timeline feed in compact mode.
  expect(hostsWithTestId(tree, 'software-update-feed').length).toBe(0);
  expect(hostsWithTestId(tree, 'timeline-item').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact badge shows the raw status when the latest build is not installed', async () => {
  mockUseSoftwareUpdates.mockReturnValue(
    updatesQuery([
      {
        id: 'u9',
        vehicleId: '7',
        version: '2026.22.1',
        status: 'installing',
        installedAt: null,
        scheduledAt: null,
        createdAt: '2026-06-26T11:00:00Z',
      },
    ]),
  );

  const tree = await render(<SoftwareUpdateHistoryWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).toContain('2026.22.1');
  // t('widget.updateStatus', latestStatus) falls back to the status string.
  expect(serialized).toContain('installing');
  expect(serialized).not.toContain('Current');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState in compact mode when there is no history', async () => {
  mockUseSoftwareUpdates.mockReturnValue(updatesQuery([]));

  const tree = await render(<SoftwareUpdateHistoryWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).toContain('No update history');
  expect(serialized).not.toContain('2026.20.5');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the feed EmptyState (and no rows) when there is no history', async () => {
  mockUseSoftwareUpdates.mockReturnValue(updatesQuery([]));

  const tree = await render(<SoftwareUpdateHistoryWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No update history');
  expect(hostsWithTestId(tree, 'timeline-item').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders a loading Skeleton instead of the feed while the query loads', async () => {
  mockUseSoftwareUpdates.mockReturnValue(
    updatesQuery(undefined, {isLoading: true}),
  );

  const tree = await render(<SoftwareUpdateHistoryWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThanOrEqual(1);
  expect(json(tree)).not.toContain('2026.20.5');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('falls back to the first vehicle id (stringified) and refetches on the freshness press', async () => {
  const tree = await render(<SoftwareUpdateHistoryWidget size={STANDARD} />);

  // vehicleId omitted -> useSoftwareUpdates called with the first vehicle id '7'.
  expect(mockUseSoftwareUpdates).toHaveBeenCalledWith('7');

  const chip = tree.root.find(
    n =>
      n.props?.testID === 'widget-freshness' &&
      typeof n.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    chip.props.onPress();
  });
  expect(refetch).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('uses the explicit vehicleId when provided', async () => {
  const tree = await render(
    <SoftwareUpdateHistoryWidget size={STANDARD} vehicleId={42} />,
  );

  expect(mockUseSoftwareUpdates).toHaveBeenCalledWith('42');

  await ReactTestRenderer.act(async () => tree.unmount());
});
