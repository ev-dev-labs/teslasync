import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

// The native useSettings hooks are mocked so the page resolves its queries
// synchronously without a QueryClientProvider, network/fetch, or Alert side
// effects (keeps the suite deterministic + free of open handles). Mirrors the
// ApiPlaygroundPage / SignalQueryControls mocking precedent. All referenced
// module variables are `mock`-prefixed so the jest.mock factory may close over
// them; their bodies read the latest value lazily at render time.
type QueryResult<T> = {data?: T};

type MockSettings = {api_suspended: boolean};
type MockPolling = Record<string, boolean | number>;
type MockCapture = {
  mongodb_enabled: boolean;
  total_documents: number;
  distinct_vins: string[];
};
type MockVersion = {
  chart_version: string;
  go_version: string;
  os: string;
  arch: string;
  endpoints: Record<string, string>;
};

function fullPolling(overrides: MockPolling = {}): MockPolling {
  return {
    vehicle_discovery: true,
    charge_state: true,
    climate_state: false,
    drive_state: true,
    location_data: false,
    vehicle_state: true,
    vehicle_config: false,
    on_demand_vehicle_discovery: false,
    on_demand_charge_state: false,
    on_demand_climate_state: false,
    on_demand_drive_state: false,
    on_demand_location_data: false,
    on_demand_vehicle_state: false,
    on_demand_vehicle_config: false,
    nearby_charging_sites: false,
    release_notes: false,
    recent_alerts: false,
    service_data: false,
    wake_up: false,
    commands: false,
    telemetry_capture: false,
    telemetry_capture_retention_days: 7,
    ...overrides,
  };
}

let mockSettings: QueryResult<MockSettings> = {data: {api_suspended: false}};
let mockPolling: QueryResult<MockPolling> = {data: fullPolling()};
let mockCapture: QueryResult<MockCapture> = {
  data: {mongodb_enabled: false, total_documents: 0, distinct_vins: []},
};
let mockVersion: QueryResult<MockVersion> = {
  data: {
    chart_version: '1.2.3',
    go_version: 'go1.25',
    os: 'linux',
    arch: 'amd64',
    endpoints: {
      api: 'http://api.local',
      web: 'http://web.local',
      oauth_callback: 'http://web.local/callback',
      tesla_api: 'https://fleet-api.tesla.com',
    },
  },
};
let mockSuspendMutate = jest.fn();
let mockPollingMutate = jest.fn();

jest.mock('../src/web-parity/api/hooks/useSettings', () => ({
  useSettings: () => mockSettings,
  usePollingConfig: () => mockPolling,
  useCaptureStats: () => mockCapture,
  useVersionInfo: () => mockVersion,
  useToggleAPISuspend: () => ({mutate: mockSuspendMutate}),
  useUpdatePollingConfig: () => ({mutate: mockPollingMutate, isPending: false}),
}));

import FleetAPIPage from '../src/web-parity/features/admin/pages/FleetAPIPage';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
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

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockSettings = {data: {api_suspended: false}};
  mockPolling = {data: fullPolling()};
  mockCapture = {data: {mongodb_enabled: false, total_documents: 0, distinct_vins: []}};
  mockVersion = {
    data: {
      chart_version: '1.2.3',
      go_version: 'go1.25',
      os: 'linux',
      arch: 'amd64',
      endpoints: {
        api: 'http://api.local',
        web: 'http://web.local',
        oauth_callback: 'http://web.local/callback',
        tesla_api: 'https://fleet-api.tesla.com',
      },
    },
  };
  mockSuspendMutate = jest.fn();
  mockPollingMutate = jest.fn();
});

/* ── scaffold ── */

test('renders the page scaffold with the title and subtitle', () => {
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-page')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Fleet API Settings');
  expect(text).toContain(
    'Control Tesla Fleet API polling, endpoint toggles, and telemetry capture',
  );
});

/* ── master suspend switch ── */

test('hides the suspended banner and toggling fires the suspend mutation when active', () => {
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-suspended-banner')).toBe(false);
  expect(allText(tree)).toContain('Vehicle data is being polled from Tesla');

  press(tree, 'fleet-api-suspend-toggle');
  expect(mockSuspendMutate).toHaveBeenCalledTimes(1);
  // mutate(!api_suspended) -> suspends (true) when currently active.
  expect(mockSuspendMutate.mock.calls[0][0]).toBe(true);
});

test('shows the suspended banner + explanatory copy when api_suspended is true', () => {
  mockSettings = {data: {api_suspended: true}};
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-suspended-banner')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('All Tesla Fleet API calls are suspended');
  expect(text).toContain('Token refresh continues');
});

/* ── endpoint controls ── */

test('renders endpoint toggles and the enabled count, and a toggle fires the polling mutation', () => {
  const tree = render(<FleetAPIPage />);
  // A polling, on-demand, command, and the telemetry-capture toggle all render.
  expect(hasHost(tree, 'fleet-api-endpoint-toggle-vehicle_discovery')).toBe(true);
  expect(hasHost(tree, 'fleet-api-endpoint-toggle-on_demand_charge_state')).toBe(true);
  expect(hasHost(tree, 'fleet-api-endpoint-toggle-wake_up')).toBe(true);
  expect(hasHost(tree, 'fleet-api-endpoint-toggle-telemetry_capture')).toBe(true);
  // 4 of the 21 endpoint keys are enabled in the fixture.
  expect(allText(tree)).toContain('(4/21 enabled)');

  press(tree, 'fleet-api-endpoint-toggle-vehicle_discovery');
  expect(mockPollingMutate).toHaveBeenCalledTimes(1);
  expect(mockPollingMutate.mock.calls[0][0]).toMatchObject({vehicle_discovery: false});
});

test('omits the endpoint controls body when the polling config is unavailable', () => {
  mockPolling = {data: undefined};
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-endpoint-toggle-vehicle_discovery')).toBe(false);
  expect(allText(tree)).not.toContain('enabled)');
});

/* ── telemetry capture ── */

test('shows the MongoDB "Not Configured" badge and dims when capture is disabled', () => {
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-mongo-badge')).toBe(true);
  expect(allText(tree)).toContain('MongoDB Not Configured');
  // Retention select is gated behind telemetry_capture + mongodb_enabled.
  expect(hasHost(tree, 'fleet-api-retention-select')).toBe(false);
});

test('reveals the retention select + capture stats once capture is on and MongoDB is connected', () => {
  mockPolling = {data: fullPolling({telemetry_capture: true})};
  mockCapture = {
    data: {mongodb_enabled: true, total_documents: 12345, distinct_vins: ['VIN1', 'VIN2']},
  };
  const tree = render(<FleetAPIPage />);
  const text = allText(tree);
  expect(text).toContain('MongoDB Connected');
  expect(hasHost(tree, 'fleet-api-retention-select')).toBe(true);
  // fmtInt groups thousands; two distinct vins -> plural "vehicles".
  expect(text).toContain('12,345');
  expect(text).toContain('2 vehicles');

  press(tree, 'fleet-api-retention-select-option-30');
  expect(mockPollingMutate).toHaveBeenCalledTimes(1);
  expect(mockPollingMutate.mock.calls[0][0]).toMatchObject({
    telemetry_capture_retention_days: 30,
  });
});

/* ── configured endpoints ── */

test('lists the configured endpoints from the version info', () => {
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-endpoint-api')).toBe(true);
  expect(hasHost(tree, 'fleet-api-endpoint-tesla_api')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('https://fleet-api.tesla.com');
  expect(text).toContain('v1.2.3 · go1.25 · linux/amd64');
  expect(hasHost(tree, 'fleet-api-endpoints-empty')).toBe(false);
});

test('falls back to the empty state when no endpoints are configured', () => {
  mockVersion = {
    data: {
      chart_version: '1.2.3',
      go_version: 'go1.25',
      os: 'linux',
      arch: 'amd64',
      endpoints: {},
    },
  };
  const tree = render(<FleetAPIPage />);
  expect(hasHost(tree, 'fleet-api-endpoints-empty')).toBe(true);
  expect(allText(tree)).toContain('No data available');
});
