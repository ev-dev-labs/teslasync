import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useConnectionPool} from '../src/web-parity/api/hooks/useAdmin';
import {BackendStatusSection} from '../src/web-parity/features/system/components/status/BackendStatusSection';

// useQuery is mocked so the two ['system-status', …] queries return controlled
// data without a QueryClient / network; useConnectionPool + devtools are mocked
// so no real client is imported.
jest.mock('@tanstack/react-query', () => ({
  useQuery: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useAdmin', () => ({
  useConnectionPool: jest.fn(),
}));
jest.mock('../src/web-parity/api/devtools', () => ({
  getExtendedHealth: jest.fn(),
  getVersionInfo: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const {useQuery} = require('@tanstack/react-query');
const mockUseQuery = useQuery as unknown as jest.Mock;
const mockUseConnectionPool = useConnectionPool as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {props?: {testID?: string}; children?: JsonNode | JsonNode[]}
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
    return node.map(flattenText).join(' ');
  }
  return flattenText(node.children);
}

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

const EXT_HEALTH = {
  status: 'degraded',
  components: {
    redis: {
      status: 'ok',
      latency_ms: 1.23,
      consecutive_failures: 0,
      last_check: '2026-06-26T09:00:00Z',
    },
    mqtt: {
      status: 'degraded',
      latency_ms: 12.5,
      consecutive_failures: 2,
      last_check: '',
    },
  },
  database: {status: 'ok', latency_ms: 0.4},
  database_pool: {total_conns: 5, idle_conns: 3, acquired_conns: 2},
  system: {goroutines: 7, go_version: 'go1.25.0', uptime_seconds: 60},
};

const POOL = {
  maxOpen: 25,
  open: 5,
  inUse: 2,
  idle: 3,
  waitCount: 0,
  waitDurationMs: 0,
};

// 90061s = 1 day (86400) + 1h 1m 1s -> formatUptime "1d 1h 1m".
const VERSION = {
  app_version: '1.0.0',
  chart_version: '1.0.0',
  go_version: 'go1.25.1',
  os: 'linux',
  arch: 'amd64',
  uptime_seconds: 90061,
  goroutines: 42,
};

function setQueries(opts: {
  extHealth?: unknown;
  extLoading?: boolean;
  version?: unknown;
}) {
  mockUseQuery.mockImplementation((cfg: {queryKey: unknown[]}) => {
    const which = cfg.queryKey?.[1];
    if (which === 'extended-health') {
      return {data: opts.extHealth, isLoading: opts.extLoading ?? false};
    }
    if (which === 'version') {
      return {data: opts.version, isLoading: false};
    }
    return {data: undefined, isLoading: false};
  });
}

async function render(): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<BackendStatusSection />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

function findByTestID(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
) {
  return tree.root
    .findAllByProps({testID})
    .find(node => typeof node.props.onPress === 'function');
}

afterEach(() => {
  jest.clearAllMocks();
});

describe('BackendStatusSection (native parity)', () => {
  it('renders the loading skeletons while health/pool are loading', async () => {
    setQueries({extHealth: undefined, extLoading: true, version: undefined});
    mockUseConnectionPool.mockReturnValue({data: undefined, isLoading: true});

    const tree = await render();
    const text = textOf(tree);

    // Header always renders; the body is the skeleton branch (no table sections).
    expect(text).toContain('Backend Status');
    expect(text).not.toContain('Component Health');
    expect(text).not.toContain('Database Connection Pool');
  });

  it('renders the three sections with component table, pool stats and runtime', async () => {
    setQueries({extHealth: EXT_HEALTH, extLoading: false, version: VERSION});
    mockUseConnectionPool.mockReturnValue({data: POOL, isLoading: false});

    const tree = await render();
    const text = textOf(tree);

    // Accordion header + healthy badge (1 of 2 components is ok/healthy).
    expect(text).toContain('Backend Status');
    expect(text).toContain('1/2 healthy');

    // Component Health table: both component names, statuses and latencies.
    expect(text).toContain('Component Health');
    expect(text).toContain('redis');
    expect(text).toContain('mqtt');
    expect(text).toContain('ok');
    expect(text).toContain('degraded');
    expect(text).toContain('1.2 ms');
    expect(text).toContain('12.5 ms');

    // Database Connection Pool StatCards.
    expect(text).toContain('Database Connection Pool');
    expect(text).toContain('Max Open');
    expect(text).toContain('25');
    expect(text).toContain('In Use');
    expect(text).toContain('Wait Count');

    // System Runtime KVList (version response preferred over extHealth.system).
    expect(text).toContain('System Runtime');
    expect(text).toContain('Go Version');
    expect(text).toContain('go1.25.1');
    expect(text).toContain('Uptime');
    expect(text).toContain('1d 1h 1m');
    expect(text).toContain('Goroutines');
    expect(text).toContain('42');
    expect(text).toContain('OS / Arch');
    expect(text).toContain('linux / amd64');
  });

  it('collapses the body when the accordion header is pressed', async () => {
    setQueries({extHealth: EXT_HEALTH, extLoading: false, version: VERSION});
    mockUseConnectionPool.mockReturnValue({data: POOL, isLoading: false});

    const tree = await render();
    expect(textOf(tree)).toContain('Component Health');

    const header = findByTestID(tree, 'backend-status-accordion-header');
    expect(header).toBeDefined();
    await ReactTestRenderer.act(async () => {
      header?.props.onPress();
    });

    const text = textOf(tree);
    expect(text).toContain('Backend Status');
    expect(text).not.toContain('Component Health');
  });
});
