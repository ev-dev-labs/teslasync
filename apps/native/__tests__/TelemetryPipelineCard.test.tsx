import React from 'react';
import ReactTestRenderer, { type ReactTestInstance } from 'react-test-renderer';

// react-query's useQuery is mocked so the card resolves both reads (the
// ['system-status','polling-status'] poll AND the useMQTTStatus ['mqtt-status']
// read, which internally calls the same useQuery) synchronously without a
// QueryClientProvider, network/fetch, or refetchInterval timers. Mirrors the
// InfrastructureSection mocking precedent: mutable `mock`-prefixed vars read
// lazily at call time, branching on the queryKey.
type PollingShape = {
  enabled: boolean;
  vehicles: Record<
    string,
    {
      activity: string;
      profile: string;
      consec_idle: number;
      last_poll_time: string;
      next_poll_after: string;
      battery_level: number;
      last_decision: null;
    }
  >;
};

type MqttShape = {
  connected: boolean;
  vehicles: Array<{
    vin: string;
    lastReceived?: string;
    signalCount: number;
    batchCount: number;
  }>;
};

let mockPolling: PollingShape | undefined;
let mockMqtt: MqttShape | undefined;

jest.mock('@tanstack/react-query', () => ({
  useQuery: (opts: { queryKey: unknown }) => {
    const key = opts.queryKey;
    const head = Array.isArray(key) ? key[0] : key;
    const sub = Array.isArray(key) ? key[1] : key;
    if (head === 'mqtt-status') {
      return { data: mockMqtt };
    }
    if (sub === 'polling-status') {
      return { data: mockPolling };
    }
    return { data: undefined };
  },
}));

import { TelemetryPipelineCard } from '../src/web-parity/features/system/components/status/TelemetryPipelineCard';
import type { Vehicle } from '../src/web-parity/api/types';

type Renderer = ReactTestRenderer.ReactTestRenderer;

const NOW = Date.parse('2026-06-26T10:00:00.000Z');
const VIN_A = '5YJ3E1EA7KF000111';
const VIN_B = '5YJSA1E2XHF000222';

function makeVehicle(
  partial: Partial<Vehicle> & { id: number; vin: string },
): Vehicle {
  return {
    vehicle_id: partial.id,
    display_name: '',
    model: 'model3',
    trim_badging: 'p',
    exterior_color: 'black',
    wheel_type: 'performance',
    state: 'online',
    healthy: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...partial,
  };
}

function connectedMqtt(): MqttShape {
  return {
    connected: true,
    // VIN_A streamed 1 min ago -> sending via stream.
    vehicles: [
      {
        vin: VIN_A,
        lastReceived: '2026-06-26T09:59:00.000Z',
        signalCount: 240,
        batchCount: 4,
      },
    ],
  };
}

function enabledPolling(): PollingShape {
  return {
    enabled: true,
    vehicles: {
      // VIN_B polled 2 min ago -> sending via poll (no stream entry).
      [VIN_B]: {
        activity: 'idle',
        profile: 'balanced',
        consec_idle: 0,
        last_poll_time: '2026-06-26T09:58:00.000Z',
        next_poll_after: '2026-06-26T10:02:00.000Z',
        battery_level: 15,
        last_decision: null,
      },
    },
  };
}

function render(
  props: Partial<React.ComponentProps<typeof TelemetryPipelineCard>> = {},
): Renderer {
  const merged: React.ComponentProps<typeof TelemetryPipelineCard> = {
    vehicles: [
      makeVehicle({ id: 1, vin: VIN_A, display_name: 'Model 3 Performance' }),
      makeVehicle({ id: 2, vin: VIN_B, display_name: '', state: 'asleep' }),
    ],
    positionCount: 12345,
    drivesCount: 42,
    chargingSessionsCount: 7,
    signalLogCount: 999999,
    now: NOW,
    ...props,
  };
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<TelemetryPipelineCard {...merged} />);
  });
  return tree!;
}

function hasText(tree: Renderer, text: string): boolean {
  return JSON.stringify(tree.toJSON()).includes(text);
}

function findByTestID(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) => node.props.testID === testID,
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

beforeEach(() => {
  mockMqtt = connectedMqtt();
  mockPolling = enabledPolling();
});

describe('TelemetryPipelineCard (native parity)', () => {
  it('renders the fleet rollup grid with fmtCount-formatted values', () => {
    const tree = render();

    expect(findByTestID(tree, 'telemetry-pipeline-card-root')).toBeDefined();
    expect(hasText(tree, '2 connected')).toBe(true); // two vehicles
    expect(hasText(tree, 'GPS positions')).toBe(true);
    expect(hasText(tree, '12,345')).toBe(true); // fmtInt grouping
    expect(hasText(tree, '999,999')).toBe(true); // signal log
    expect(hasText(tree, 'Charging sessions')).toBe(true);
  });

  it('falls back to em dashes when counts are undefined', () => {
    const tree = render({
      chargingSessionsCount: undefined,
      signalLogCount: undefined,
    });

    expect(hasText(tree, '\u2014')).toBe(true);
  });

  it('shows the empty-state panel and routes the Tesla account link', () => {
    const onNavigate = jest.fn();
    const tree = render({ vehicles: [], onNavigate });

    expect(findByTestID(tree, 'telemetry-empty-state')).toBeDefined();
    expect(hasText(tree, 'No vehicles configured yet')).toBe(true);
    // No vehicles -> no liveness summary chips.
    expect(() => findByTestID(tree, 'telemetry-liveness-summary')).toThrow();

    press(tree, 'telemetry-link-tesla-account');
    expect(onNavigate).toHaveBeenCalledWith('/tesla-account');
  });

  it('renders a per-vehicle row for each vehicle with name fallback + VIN tail', () => {
    const tree = render();

    expect(findByTestID(tree, 'telemetry-vehicle-1')).toBeDefined();
    expect(findByTestID(tree, 'telemetry-vehicle-2')).toBeDefined();
    expect(hasText(tree, 'Model 3 Performance')).toBe(true);
    // Vehicle 2 has an empty display_name -> "Vehicle 2" fallback.
    expect(hasText(tree, 'Vehicle 2')).toBe(true);
    expect(hasText(tree, 'VIN')).toBe(true);
    expect(hasText(tree, '0111')).toBe(true);
    expect(hasText(tree, '0222')).toBe(true);
    // VIN_B battery 15% via polling.
    expect(hasText(tree, '15%')).toBe(true);
    expect(hasText(tree, 'next:')).toBe(true);
  });

  it('routes a vehicle name link to /vehicles/{id}', () => {
    const onNavigate = jest.fn();
    const tree = render({ onNavigate });

    press(tree, 'telemetry-vehicle-link-1');
    expect(onNavigate).toHaveBeenCalledWith('/vehicles/1');
  });

  it('summarises liveness and shows the Fleet Telemetry connected chip', () => {
    const tree = render();

    expect(findByTestID(tree, 'telemetry-liveness-summary')).toBeDefined();
    expect(hasText(tree, 'Liveness:')).toBe(true);
    // Both vehicles are fresh (< 5 min) -> "2 sending".
    expect(hasText(tree, 'sending')).toBe(true);
    expect(findByTestID(tree, 'telemetry-mqtt-connected')).toBeDefined();
    expect(hasText(tree, 'Fleet Telemetry connected')).toBe(true);
  });

  it('warns when the broker is disconnected and polling is disabled', () => {
    mockMqtt = { connected: false, vehicles: [] };
    mockPolling = { enabled: false, vehicles: {} };
    const tree = render();

    expect(findByTestID(tree, 'telemetry-mqtt-disconnected')).toBeDefined();
    expect(hasText(tree, 'MQTT broker disconnected')).toBe(true);
    expect(findByTestID(tree, 'telemetry-polling-disabled')).toBeDefined();
    expect(hasText(tree, 'polling engine disabled')).toBe(true);
  });

  it('treats disabled polling as informational while MQTT streams', () => {
    mockPolling = { enabled: false, vehicles: {} };
    const tree = render();

    expect(findByTestID(tree, 'telemetry-polling-off')).toBeDefined();
    expect(hasText(tree, 'polling engine off (streaming-only)')).toBe(true);
  });

  it('routes every footer link through the navigation bridge', () => {
    const onNavigate = jest.fn();
    const tree = render({ onNavigate });

    press(tree, 'telemetry-link-coverage');
    press(tree, 'telemetry-link-mqtt');
    press(tree, 'telemetry-link-vehicles');

    expect(onNavigate).toHaveBeenNthCalledWith(1, '/admin/telemetry/coverage');
    expect(onNavigate).toHaveBeenNthCalledWith(2, '/mqtt-inspector');
    expect(onNavigate).toHaveBeenNthCalledWith(3, '/vehicles');
  });
});
