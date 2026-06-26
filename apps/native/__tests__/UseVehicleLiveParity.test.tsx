import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { useVehicleLive } from '../src/web-parity/hooks/useVehicleLive';

// Control the one-shot REST hydration the hook reads via react-query. The whole
// telemetry module is mocked so no QueryClientProvider / network is required.
let mockInitialLiveSignals: { signals?: Record<string, unknown> } | undefined;

jest.mock('../src/web-parity/api/hooks/useTelemetry', () => ({
  useVehicleLiveSignals: () => ({ data: mockInitialLiveSignals }),
}));

type FakeListener = (event: { data?: unknown }) => void;

/**
 * Minimal stand-in for a host-provided global EventSource polyfill so the
 * self-contained native vehicle_update stream can be driven deterministically.
 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static lastUrl = '';

  readonly url: string;
  closed = false;
  private readonly listeners: Record<string, FakeListener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.lastUrl = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, fn: FakeListener): void {
    const list = this.listeners[type] ?? (this.listeners[type] = []);
    list.push(fn);
  }

  removeEventListener(type: string, fn: FakeListener): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter(l => l !== fn);
  }

  close(): void {
    this.closed = true;
  }

  emit(type: string, event: { data?: unknown } = {}): void {
    for (const fn of this.listeners[type] ?? []) fn(event);
  }
}

type GlobalWithEventSource = { EventSource?: unknown };
const globalRef = globalThis as GlobalWithEventSource;
const originalEventSource = globalRef.EventSource;

beforeEach(() => {
  FakeEventSource.instances = [];
  FakeEventSource.lastUrl = '';
  mockInitialLiveSignals = undefined;
});

afterEach(() => {
  globalRef.EventSource = originalEventSource;
});

function Probe({ vehicleId }: { vehicleId?: number }) {
  const { state, connected } = useVehicleLive(vehicleId);
  return (
    <Text>
      {JSON.stringify({
        connected,
        speed: state.speed,
        battery: state.batteryLevel,
        odometer: state.odometer,
        locked: state.locked,
        gear: state.gear,
        signalCount: state.signalCount,
        updated: state.lastUpdated !== null,
      })}
    </Text>
  );
}

type JsonNode =
  | string
  | number
  | null
  | undefined
  | { children?: JsonNode | JsonNode[] }
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

function reading(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
): Record<string, unknown> {
  return JSON.parse(flattenText(tree?.toJSON() as JsonNode)) as Record<
    string,
    unknown
  >;
}

async function mount(
  vehicleId?: number,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<Probe vehicleId={vehicleId} />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function unmount(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
}

test('hydrates the always-complete state from the one-shot live-signals query', async () => {
  // No polyfill -> the SSE stream is unavailable, so this isolates the REST path.
  globalRef.EventSource = undefined;
  mockInitialLiveSignals = {
    signals: {
      VehicleSpeed: { value: 42, timestamp: '2024-01-01T00:00:00Z' },
      BatteryLevel: { value: 83.6 },
      Odometer: { value: 12345 },
      Locked: { value: true },
    },
  };

  const tree = await mount(9);
  const r = reading(tree);

  expect(r.speed).toBe(42);
  expect(r.battery).toBe(84); // Math.round(83.6)
  expect(r.odometer).toBe(12345);
  expect(r.locked).toBe(true);
  expect(r.signalCount).toBe(4);
  expect(r.updated).toBe(true);
  // Unavailable EventSource -> connected stays false, no source is opened.
  expect(r.connected).toBe(false);
  expect(FakeEventSource.instances).toHaveLength(0);

  await unmount(tree);
});

test('merges live vehicle_update SSE events and tracks the connected lifecycle', async () => {
  globalRef.EventSource = FakeEventSource;

  const tree = await mount(7);
  let r = reading(tree);
  expect(r.connected).toBe(false);
  expect(r.speed).toBe(0);

  // Exactly one shared connection is opened, pointed at /api/v1/events.
  expect(FakeEventSource.instances).toHaveLength(1);
  expect(FakeEventSource.lastUrl).toContain('/api/v1/events');
  const es = FakeEventSource.instances[0];

  // Server `connected` event flips the live pipe on.
  await ReactTestRenderer.act(async () => {
    es.emit('connected', { data: JSON.stringify({ client_id: 'abc' }) });
  });
  expect(reading(tree).connected).toBe(true);

  // A matching vehicle_update merges into the always-complete state.
  await ReactTestRenderer.act(async () => {
    es.emit('vehicle_update', {
      data: JSON.stringify({
        vehicle_id: 7,
        signals: { VehicleSpeed: 30, BatteryLevel: 90 },
      }),
    });
  });
  r = reading(tree);
  expect(r.speed).toBe(30);
  expect(r.battery).toBe(90);
  expect(r.signalCount).toBe(2);
  expect(r.updated).toBe(true);

  // An error transition drops connected back to false.
  await ReactTestRenderer.act(async () => {
    es.emit('error', {});
  });
  expect(reading(tree).connected).toBe(false);

  await unmount(tree);
  // Unsubscribe tears down the shared source (and clears any reconnect timer).
  expect(es.closed).toBe(true);
});

test('prefers the complete state envelope over partial signals in an update', async () => {
  globalRef.EventSource = FakeEventSource;

  const tree = await mount(7);
  const es = FakeEventSource.instances[0];

  await ReactTestRenderer.act(async () => {
    es.emit('vehicle_update', {
      data: JSON.stringify({
        vehicle_id: 7,
        state: { Gear: 'D' },
        signals: { Gear: 'P' },
      }),
    });
  });

  // raw = update.state || update.signals -> state wins.
  expect(reading(tree).gear).toBe('D');

  await unmount(tree);
});

test('ignores vehicle_update events addressed to a different vehicle', async () => {
  globalRef.EventSource = FakeEventSource;

  const tree = await mount(7);
  const es = FakeEventSource.instances[0];

  await ReactTestRenderer.act(async () => {
    es.emit('vehicle_update', {
      data: JSON.stringify({
        vehicle_id: 999,
        signals: { VehicleSpeed: 55 },
      }),
    });
  });

  const r = reading(tree);
  expect(r.speed).toBe(0); // filtered out by the vehicleId guard
  expect(r.updated).toBe(false); // no merge happened

  await unmount(tree);
});

test('still hydrates from REST when the SSE polyfill is unavailable', async () => {
  globalRef.EventSource = undefined;
  mockInitialLiveSignals = {
    signals: { Gear: { value: 'P' }, ChargeAmps: { value: 16 } },
  };

  const tree = await mount(3);
  const r = reading(tree);

  // Explicit unavailable state: never connected, never throws, but the REST
  // hydration still populates the always-complete state.
  expect(r.connected).toBe(false);
  expect(r.gear).toBe('P');
  expect(r.signalCount).toBe(2);
  expect(r.updated).toBe(true);
  expect(FakeEventSource.instances).toHaveLength(0);

  await unmount(tree);
});
