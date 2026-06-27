import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import MaintenanceTrackerWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/MaintenanceTrackerWidget';

/**
 * Native parity contract for MaintenanceTrackerWidget.
 *
 * The web widget reads the maintenance schedule (useMaintenance) and service
 * history (useServiceRecords) and renders one of two layouts driven by the grid
 * size:
 *   • Compact (cols <= 1): an amber wrench glyph, the soonest item's
 *     interval-months as a big number, a "months" caption and the item name —
 *     or an EmptyState when there is no maintenance data. No title in the shell.
 *   • Standard (cols >= 2): a "Next Service" card (soonest item + urgency Badge +
 *     name + "Every N mo" / interval-distance / optional cost) on top, and a
 *     "Recent Service" Timeline of the three most recent records below (or a
 *     "No service records yet" line). When neither items nor records exist the
 *     whole body is an EmptyState. The title ("Maintenance") is always shown.
 * These tests mock the maintenance, service-records and settings hooks and
 * assert the ported behaviour.
 */

const mockUseMaintenance = jest.fn();
const mockUseServiceRecords = jest.fn();
const mockUseSettings = jest.fn();

jest.mock('../src/web-parity/api/hooks/useVehicleSystems', () => ({
  useMaintenance: (...args: unknown[]) => mockUseMaintenance(...args),
  useServiceRecords: (...args: unknown[]) => mockUseServiceRecords(...args),
}));

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: (...args: unknown[]) => mockUseSettings(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const maintRefetch = jest.fn();
const recordsRefetch = jest.fn();

function maintQuery(
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
    refetch: maintRefetch,
    ...overrides,
  };
}

function recordsQuery(
  data: Array<Record<string, unknown>> | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 25, 12, 0, 0),
    refetch: recordsRefetch,
    ...overrides,
  };
}

// Three items: soonest-first by intervalMonths is m1 (2 -> "soon"), m3 (6),
// m2 (24). So nextItem = m1 "Tire Rotation" with a "Soon" badge and a cost.
const ITEMS = [
  {
    id: 'm1',
    name: 'Tire Rotation',
    description: '',
    intervalKm: 10000,
    intervalMonths: 2,
    category: 'tires',
    estimatedCostUsd: 80,
  },
  {
    id: 'm2',
    name: 'Brake Fluid',
    description: '',
    intervalKm: 40000,
    intervalMonths: 24,
    category: 'brakes',
    estimatedCostUsd: 0,
  },
  {
    id: 'm3',
    name: 'Cabin Air Filter',
    description: '',
    intervalKm: 30000,
    intervalMonths: 6,
    category: 'cabin',
    estimatedCostUsd: 50,
  },
];

// Newest-first by date: m1 (May), m2 (Apr), ghost (Mar). The ghost record's
// itemId is not in the maintenance map, so its timeline title falls back to the
// raw itemId.
const RECORDS = [
  {
    itemId: 'm1',
    date: '2026-05-01T00:00:00Z',
    odometerKm: 12000,
    notes: 'Rotated tires',
  },
  {
    itemId: 'm2',
    date: '2026-04-01T00:00:00Z',
    odometerKm: 11000,
    notes: '',
  },
  {
    itemId: 'ghost',
    date: '2026-03-01T00:00:00Z',
    odometerKm: 10000,
    notes: 'Misc service',
  },
];

const STANDARD: WidgetSize = {cols: 2, rows: 4};
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
  mockUseMaintenance.mockReturnValue(maintQuery(ITEMS));
  mockUseServiceRecords.mockReturnValue(recordsQuery(RECORDS));
  mockUseSettings.mockReturnValue({data: {locale: 'en-US'}});
});

test('standard layout shows the title, next-service card and recent-service timeline', async () => {
  const tree = await render(<MaintenanceTrackerWidget size={STANDARD} />);

  const serialized = json(tree);
  // Title (uppercased by the shell) is shown in the standard layout.
  expect(serialized).toContain('MAINTENANCE');
  // Next service card: soonest item, urgency label, "Every N mo", distance unit.
  expect(serialized).toContain('Next Service');
  expect(serialized).toContain('Tire Rotation');
  expect(serialized).toContain('Soon');
  expect(serialized).toContain('Every');
  expect(serialized).toContain('mo');
  expect(serialized).toContain('km');
  // Estimated cost (> 0) is rendered via formatCurrency.
  expect(serialized).toContain('$80.00');
  // Recent service timeline: three rows, names resolved by itemId (ghost falls
  // back to the raw itemId).
  expect(serialized).toContain('Recent Service');
  expect(serialized).toContain('Brake Fluid');
  expect(serialized).toContain('ghost');
  expect(hostsWithTestId(tree, 'timeline-item').length).toBe(3);
  expect(serialized).not.toContain('No maintenance data');
  expect(serialized).not.toContain('No service records yet');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout shows the soonest item months + name and no title or timeline', async () => {
  const tree = await render(<MaintenanceTrackerWidget size={COMPACT} />);

  const serialized = json(tree);
  // Compact shell receives no title.
  expect(serialized).not.toContain('MAINTENANCE');
  expect(serialized).not.toContain('Next Service');
  // Soonest item name + the "months" caption.
  expect(serialized).toContain('Tire Rotation');
  expect(serialized).toContain('months');
  // No timeline rows in compact mode.
  expect(hostsWithTestId(tree, 'timeline-item').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('standard layout shows "No service records yet" when there are items but no records', async () => {
  mockUseServiceRecords.mockReturnValue(recordsQuery([]));

  const tree = await render(<MaintenanceTrackerWidget size={STANDARD} />);

  const serialized = json(tree);
  // The next-service card still renders (items present).
  expect(serialized).toContain('Tire Rotation');
  expect(serialized).toContain('No service records yet');
  expect(hostsWithTestId(tree, 'timeline-item').length).toBe(0);
  expect(serialized).not.toContain('No maintenance data');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('standard layout shows the EmptyState when there is neither items nor records', async () => {
  mockUseMaintenance.mockReturnValue(maintQuery([]));
  mockUseServiceRecords.mockReturnValue(recordsQuery([]));

  const tree = await render(<MaintenanceTrackerWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('No maintenance data');
  expect(serialized).not.toContain('Tire Rotation');
  expect(serialized).not.toContain('Recent Service');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout shows the EmptyState when there are no maintenance items', async () => {
  mockUseMaintenance.mockReturnValue(maintQuery([]));

  const tree = await render(<MaintenanceTrackerWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).toContain('No maintenance data');
  expect(serialized).not.toContain('Tire Rotation');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders a loading Skeleton instead of the body while a query loads', async () => {
  mockUseMaintenance.mockReturnValue(maintQuery(undefined, {isLoading: true}));

  const tree = await render(<MaintenanceTrackerWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThanOrEqual(1);
  expect(json(tree)).not.toContain('Tire Rotation');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('refetches the maintenance query on the freshness press', async () => {
  const tree = await render(<MaintenanceTrackerWidget size={STANDARD} />);

  const chip = tree.root.find(
    n =>
      n.props?.testID === 'widget-freshness' &&
      typeof n.props?.onPress === 'function',
  );
  await ReactTestRenderer.act(async () => {
    chip.props.onPress();
  });
  expect(maintRefetch).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => tree.unmount());
});
