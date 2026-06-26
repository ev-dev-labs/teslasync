import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import SystemHealthWidget, {
  type WidgetSize,
} from '../src/web-parity/features/dashboard/widgets/SystemHealthWidget';

/**
 * Native parity contract for SystemHealthWidget.
 *
 * The web widget reads three admin queries — system health, DB stats and the
 * connection pool / runtime info — and renders either a compact overall-status
 * summary (1 col: StatusBadge + Healthy/Degraded/Down label + healthy/total
 * services caption) or a standard layout (>=2 cols: a 2-column service status
 * grid above a 2-column StatCard grid of DB Size / Active Conns / Memory /
 * Goroutines). It shows an EmptyState when the health query has no data, a
 * Skeleton while loading and an inline error block on error; freshness +
 * refresh are driven solely by the health query. These tests assert that
 * behaviour against the native port by mocking the three admin query hooks.
 */

const mockUseSystemHealth = jest.fn();
const mockUseDBStats = jest.fn();
const mockUseConnectionPool = jest.fn();

jest.mock('../src/web-parity/api/hooks/useAdmin', () => ({
  useSystemHealth: (...args: unknown[]) => mockUseSystemHealth(...args),
  useDBStats: (...args: unknown[]) => mockUseDBStats(...args),
  useConnectionPool: (...args: unknown[]) => mockUseConnectionPool(...args),
}));

type Tree = ReactTestRenderer.ReactTestRenderer;

const refetch = jest.fn();

function healthQuery(
  data: Record<string, unknown> | undefined,
  overrides: Record<string, unknown> = {},
) {
  return {
    data,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.UTC(2026, 5, 26, 12, 0, 0),
    refetch,
    ...overrides,
  };
}

const HEALTH = {
  status: 'healthy',
  components: {
    database: {status: 'healthy'},
    mqtt: {status: 'healthy'},
    tesla_api: {status: 'degraded'},
    fleet_telemetry: {status: 'unhealthy'},
  },
  databaseSize: '1.2 GB',
  tableCount: 42,
};

const POOL = {maxOpen: 25, open: 5, inUse: 3, idle: 2, goroutines: 87, memoryMB: 128};

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

const STANDARD: WidgetSize = {cols: 2, rows: 4};
const COMPACT: WidgetSize = {cols: 1, rows: 2};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseSystemHealth.mockReturnValue(healthQuery(HEALTH));
  mockUseDBStats.mockReturnValue({data: {databaseSize: '1.2 GB'}});
  mockUseConnectionPool.mockReturnValue({data: POOL});
});

test('standard layout renders the title, service grid and stat cards', async () => {
  const tree = await render(<SystemHealthWidget size={STANDARD} />);

  const serialized = json(tree);
  expect(serialized).toContain('SYSTEM HEALTH');
  // Service rows (i18n fallbacks computed from the service keys).
  expect(hostsWithTestId(tree, 'system-health-services').length).toBe(1);
  expect(serialized).toContain('Database');
  expect(serialized).toContain('Mqtt');
  expect(serialized).toContain('Tesla Api');
  expect(serialized).toContain('Fleet Telemetry');
  // Stat cards.
  expect(hostsWithTestId(tree, 'system-health-stats').length).toBe(1);
  expect(serialized).toContain('DB Size');
  expect(serialized).toContain('1.2 GB');
  expect(serialized).toContain('Active Conns');
  // inUse 3 / maxOpen 25 -> '3/25'.
  expect(serialized).toContain('3/25');
  expect(serialized).toContain('Memory');
  expect(serialized).toContain('128 MB');
  expect(serialized).toContain('Goroutines');
  expect(serialized).toContain('87');
  // Compact summary is not rendered on the standard layout.
  expect(hostsWithTestId(tree, 'system-health-compact').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('falls back to dbStats databaseSize and bare inUse when pool max is 0', async () => {
  mockUseSystemHealth.mockReturnValue(
    healthQuery({...HEALTH, databaseSize: undefined}),
  );
  mockUseConnectionPool.mockReturnValue({
    data: {maxOpen: 0, inUse: 4, goroutines: undefined, memoryMB: undefined},
  });

  const tree = await render(<SystemHealthWidget size={STANDARD} />);

  const serialized = json(tree);
  // databaseSize falls through to the dbStats query value.
  expect(serialized).toContain('1.2 GB');
  // maxOpen 0 -> bare fmtInt(inUse) without the "/max" suffix.
  expect(serialized).toContain('"4"');
  expect(serialized).not.toContain('4/');
  // Missing memory / goroutines -> em dash placeholder.
  expect(serialized).toContain('—');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('compact layout is title-less and shows the overall badge + summary', async () => {
  const tree = await render(<SystemHealthWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).not.toContain('SYSTEM HEALTH');
  expect(hostsWithTestId(tree, 'system-health-compact').length).toBe(1);
  // healthy -> 'Online' badge + 'Healthy' label.
  expect(hostsWithTestId(tree, 'system-health-overall-badge').length).toBe(1);
  expect(serialized).toContain('Online');
  expect(serialized).toContain('Healthy');
  // 2 of 4 components are healthy (database + mqtt). The `{count}/{total}`
  // interpolation renders as separate Text children: ["2","/","4"," ","services"].
  expect(serialized).toContain('"2","/","4"');
  expect(serialized).toContain('services');
  // The standard service/stat grids are not rendered.
  expect(hostsWithTestId(tree, 'system-health-services').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('degraded overall status maps to the "away" badge and "Degraded" label', async () => {
  mockUseSystemHealth.mockReturnValue(
    healthQuery({...HEALTH, status: 'degraded'}),
  );

  const tree = await render(<SystemHealthWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).toContain('Away');
  expect(serialized).toContain('Degraded');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('unhealthy overall status maps to the "offline" badge and "Down" label', async () => {
  mockUseSystemHealth.mockReturnValue(
    healthQuery({...HEALTH, status: 'unhealthy'}),
  );

  const tree = await render(<SystemHealthWidget size={COMPACT} />);

  const serialized = json(tree);
  expect(serialized).toContain('Offline');
  expect(serialized).toContain('Down');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('shows the EmptyState (and no grids) when there is no health data', async () => {
  mockUseSystemHealth.mockReturnValue(healthQuery(undefined));

  const tree = await render(<SystemHealthWidget size={STANDARD} />);

  expect(json(tree)).toContain('No system health data');
  expect(hostsWithTestId(tree, 'system-health-services').length).toBe(0);
  expect(hostsWithTestId(tree, 'system-health-stats').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('keeps the shell visible with a Skeleton while loading', async () => {
  mockUseSystemHealth.mockReturnValue(
    healthQuery(undefined, {isLoading: true, isFetching: true}),
  );

  const tree = await render(<SystemHealthWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'skeleton').length).toBeGreaterThan(0);
  expect(hostsWithTestId(tree, 'system-health-services').length).toBe(0);

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('renders an inline error block instead of hiding the widget on error', async () => {
  mockUseSystemHealth.mockReturnValue(
    healthQuery(undefined, {
      error: new Error('health unavailable'),
      isError: true,
    }),
  );

  const tree = await render(<SystemHealthWidget size={STANDARD} />);

  expect(hostsWithTestId(tree, 'widget-error').length).toBe(1);
  expect(json(tree)).toContain('health unavailable');

  await ReactTestRenderer.act(async () => tree.unmount());
});

test('the freshness affordance triggers refetch on press', async () => {
  const tree = await render(<SystemHealthWidget size={STANDARD} />);

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
