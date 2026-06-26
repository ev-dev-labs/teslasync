import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// react-query's useQuery and the devtools client are mocked so the section
// resolves its two reads synchronously without a QueryClientProvider, network/
// fetch, or the refetchInterval timers (keeps the suite deterministic + free of
// open handles under --detectOpenHandles). Mirrors the RedisSignalViewerPage
// mocking precedent: mutable `mock`-prefixed vars read lazily at call time.
type TelemetryShape = {
  enabled: boolean;
  mode: string;
  endpoint: string;
  protocol: string;
  speed_comparison?: {
    fleet_telemetry_latency: string;
    fleet_api_polling: string;
    speedup: string;
  };
};

type ExtHealthShape = {
  database_pool?: {
    total_conns: number;
    idle_conns: number;
    acquired_conns: number;
  };
};

let mockTelemetry: TelemetryShape | undefined;
let mockExtHealth: ExtHealthShape | undefined;

jest.mock('@tanstack/react-query', () => ({
  useQuery: (opts: {queryKey: unknown}) => {
    const sub = Array.isArray(opts.queryKey) ? opts.queryKey[1] : opts.queryKey;
    if (sub === 'extended-health') {
      return {data: mockExtHealth};
    }
    return {data: mockTelemetry};
  },
}));

jest.mock('../src/web-parity/api/devtools', () => ({
  getTelemetryStatus: jest.fn(),
  getExtendedHealth: jest.fn(),
}));

import {InfrastructureSection} from '../src/web-parity/features/system/components/status/InfrastructureSection';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<InfrastructureSection />);
  });
  return tree!;
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

function hasHost(tree: Renderer, testID: string): boolean {
  return (
    tree.root.findAll(
      (node: ReactTestInstance) =>
        typeof node.type === 'string' && node.props.testID === testID,
    ).length > 0
  );
}

function press(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function connectedTelemetry(): TelemetryShape {
  return {
    enabled: true,
    mode: 'streaming',
    endpoint: 'wss://fleet.example/stream',
    protocol: 'Fleet Telemetry',
    speed_comparison: {
      fleet_telemetry_latency: '120ms',
      fleet_api_polling: '15s',
      speedup: '125x',
    },
  };
}

beforeEach(() => {
  mockTelemetry = connectedTelemetry();
  mockExtHealth = {
    database_pool: {total_conns: 1500, idle_conns: 7, acquired_conns: 18},
  };
});

describe('InfrastructureSection (native parity)', () => {
  it('renders the accordion header collapsed with the Connected badge', () => {
    const tree = render();

    expect(hasHost(tree, 'infrastructure-accordion-header')).toBe(true);
    expect(hasText(tree, 'Infrastructure')).toBe(true);
    expect(
      hasText(tree, 'SSE connections and polling engine diagnostics'),
    ).toBe(true);
    expect(hasText(tree, 'Connected')).toBe(true);
    // Body stays mounted only after the header is pressed (defaultOpen=false).
    expect(hasHost(tree, 'infrastructure-accordion-body')).toBe(false);
    expect(hasText(tree, 'SSE Connection')).toBe(false);
  });

  it('shows the Disconnected badge when telemetry is not enabled', () => {
    mockTelemetry = {...connectedTelemetry(), enabled: false, mode: 'unknown'};
    const tree = render();

    expect(hasText(tree, 'Disconnected')).toBe(true);
  });

  it('expands to reveal both cards, KV rows, and falls back to em dashes', () => {
    mockTelemetry = {
      enabled: true,
      mode: 'streaming',
      endpoint: 'wss://fleet.example/stream',
      protocol: 'Fleet Telemetry',
      // No speed_comparison -> the polling KV rows fall back to "—".
    };
    const tree = render();
    press(tree, 'infrastructure-accordion-header');

    expect(hasHost(tree, 'infrastructure-accordion-body')).toBe(true);
    expect(hasText(tree, 'SSE Connection')).toBe(true);
    expect(hasText(tree, 'Polling Engine')).toBe(true);
    expect(hasText(tree, 'wss://fleet.example/stream')).toBe(true);
    expect(hasText(tree, 'Fleet Telemetry')).toBe(true);
    // Standby (mode !== 'polling') + missing speed_comparison fallbacks.
    expect(hasText(tree, 'Standby')).toBe(true);
    expect(hasText(tree, '\u2014')).toBe(true);
  });

  it('renders Active + the Polling fallback label when mode is polling', () => {
    mockTelemetry = {...connectedTelemetry(), mode: 'polling'};
    const tree = render();
    press(tree, 'infrastructure-accordion-header');

    expect(hasText(tree, 'Active')).toBe(true);
    expect(hasText(tree, 'Yes \u2014 Polling')).toBe(true);
  });

  it('renders the database-pool metrics with fmtInt separators when present', () => {
    const tree = render();
    press(tree, 'infrastructure-accordion-header');

    expect(hasText(tree, 'Total Conns')).toBe(true);
    expect(hasText(tree, 'Acquired')).toBe(true);
    expect(hasText(tree, 'Idle')).toBe(true);
    // fmtInt(1500) -> "1,500" (en-US grouping separator preserved).
    expect(hasText(tree, '1,500')).toBe(true);
  });

  it('omits the database-pool row when extended health has no pool', () => {
    mockExtHealth = {};
    const tree = render();
    press(tree, 'infrastructure-accordion-header');

    expect(hasText(tree, 'Total Conns')).toBe(false);
  });
});
