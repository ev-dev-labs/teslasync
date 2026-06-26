import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  useSignalCatalog,
  useSignalObservations,
} from '../src/web-parity/api/hooks/useTelemetry';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import SignalCatalogWidget from '../src/web-parity/features/dashboard/widgets/SignalCatalogWidget';

jest.mock('../src/web-parity/api/hooks/useTelemetry', () => ({
  useSignalCatalog: jest.fn(),
  useSignalObservations: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

const mockUseSignalCatalog = useSignalCatalog as unknown as jest.Mock;
const mockUseSignalObservations = useSignalObservations as unknown as jest.Mock;
const mockUseVehicles = useVehicles as unknown as jest.Mock;

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
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

function textOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function rawOf(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

function catalogEntry(
  name: string,
  sourceModule: string,
  unit: string | null = null,
  description: string | null = null,
) {
  return {
    name,
    value_type: 'numeric' as const,
    source_module: sourceModule,
    unit,
    description,
    first_seen_at: '2026-01-01T00:00:00Z',
    last_seen_at: '2026-06-01T00:00:00Z',
  };
}

function observation(signalName: string) {
  return {
    vehicle_id: 1,
    ts: '2026-06-01T00:00:00Z',
    signal_name: signalName,
    value_numeric: 1,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry' as const,
  };
}

function catalogStub(
  entries = [
    catalogEntry('battery_level', 'energy', '%', 'State of charge'),
    catalogEntry('vehicle_speed', 'drive', 'mps'),
    catalogEntry('odometer', 'drive', 'm'),
  ],
) {
  return {
    data: entries,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

function observationsStub(
  rows = [
    observation('battery_level'),
    observation('battery_level'),
    observation('vehicle_speed'),
  ],
) {
  return {data: rows};
}

beforeEach(() => {
  mockUseVehicles.mockReturnValue({data: [{id: 1}]});
  mockUseSignalCatalog.mockReturnValue(catalogStub());
  mockUseSignalObservations.mockReturnValue(observationsStub());
});

afterEach(() => {
  jest.clearAllMocks();
});

async function render(
  element: React.ReactElement,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(element);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

async function unmount(
  tree: ReactTestRenderer.ReactTestRenderer,
): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

const COMPACT = {cols: 1, rows: 1};
const STANDARD = {cols: 2, rows: 2};

test('renders a loading skeleton while the catalog query is loading', async () => {
  mockUseSignalCatalog.mockReturnValue({
    ...catalogStub(),
    data: undefined,
    isLoading: true,
    isFetching: true,
    dataUpdatedAt: 0,
  });

  const tree = await render(<SignalCatalogWidget size={STANDARD} />);
  const raw = rawOf(tree);

  expect(raw).toContain('signal-catalog-loading');
  expect(raw).not.toContain('signal-catalog-widget');

  await unmount(tree);
});

test('renders the title-less compact view with the signal count', async () => {
  const tree = await render(<SignalCatalogWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-catalog-widget');
  expect(raw).toContain('signal-catalog-compact');
  // 3 catalog entries -> "3" + "signals available".
  expect(text).toContain('3');
  expect(text).toContain('signals available');
  // The compact branch is title-less: no "Signal Catalog" header, no list.
  expect(text).not.toContain('Signal Catalog');
  expect(raw).not.toContain('signal-catalog-list');
  // Freshness chip is wired (overlaid for the title-less layout).
  expect(raw).toContain('signal-catalog-freshness');

  await unmount(tree);
});

test('renders the standard view with the title, search box, and grouped signals', async () => {
  const tree = await render(<SignalCatalogWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-catalog-widget');
  expect(text).toContain('Signal Catalog');
  expect(raw).toContain('signal-catalog-search');
  expect(raw).toContain('signal-catalog-list');

  // Categories are derived from source_module and sorted alphabetically:
  // "drive" before "energy".
  expect(raw).toContain('signal-catalog-group-drive');
  expect(raw).toContain('signal-catalog-group-energy');
  const driveIdx = raw.indexOf('signal-catalog-group-drive');
  const energyIdx = raw.indexOf('signal-catalog-group-energy');
  expect(driveIdx).toBeGreaterThanOrEqual(0);
  expect(driveIdx).toBeLessThan(energyIdx);

  // Signal rows render with their names.
  expect(raw).toContain('signal-catalog-signal-battery_level');
  expect(raw).toContain('signal-catalog-signal-vehicle_speed');
  expect(raw).toContain('signal-catalog-signal-odometer');

  // The category header shows its child count; "drive" has 2 signals.
  expect(text).toContain('(2)');

  await unmount(tree);
});

test('renders the unit badge and the per-signal observation count', async () => {
  const tree = await render(<SignalCatalogWidget size={STANDARD} />);
  const text = textOf(tree);

  // battery_level has a "%" unit and 2 observations; vehicle_speed has 1.
  expect(text).toContain('%');
  expect(text).toContain('2');
  expect(text).toContain('1');
  // odometer has no observations -> 0.
  expect(text).toContain('0');

  await unmount(tree);
});

test('filters the catalog by the search query and shows the no-results empty state', async () => {
  const tree = await render(<SignalCatalogWidget size={STANDARD} />);

  const root = tree.root;
  const input = root.findByProps({testID: 'signal-catalog-search'});

  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('battery');
  });

  let raw = rawOf(tree);
  expect(raw).toContain('signal-catalog-signal-battery_level');
  expect(raw).not.toContain('signal-catalog-signal-vehicle_speed');

  // A query that matches nothing -> the no-results EmptyState (inside shell).
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('zzz-no-match');
  });

  raw = rawOf(tree);
  const text = textOf(tree);
  expect(raw).toContain('signal-catalog-no-results');
  expect(text).toContain('No matching signals');
  expect(raw).not.toContain('signal-catalog-list');

  await unmount(tree);
});

test('filters by description and source_module, not just the signal name', async () => {
  const tree = await render(<SignalCatalogWidget size={STANDARD} />);
  const root = tree.root;
  const input = root.findByProps({testID: 'signal-catalog-search'});

  // "State of charge" is battery_level's description.
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('state of charge');
  });
  let raw = rawOf(tree);
  expect(raw).toContain('signal-catalog-signal-battery_level');
  expect(raw).not.toContain('signal-catalog-signal-odometer');

  // "drive" is the source_module for vehicle_speed + odometer.
  await ReactTestRenderer.act(async () => {
    input.props.onChangeText('drive');
  });
  raw = rawOf(tree);
  expect(raw).toContain('signal-catalog-signal-vehicle_speed');
  expect(raw).toContain('signal-catalog-signal-odometer');
  expect(raw).not.toContain('signal-catalog-signal-battery_level');

  await unmount(tree);
});

test('renders the no-data empty state inside the shell when the catalog is empty', async () => {
  mockUseSignalCatalog.mockReturnValue(catalogStub([]));

  const tree = await render(<SignalCatalogWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  // The shell still renders; the section is never hidden.
  expect(raw).toContain('signal-catalog-widget');
  expect(raw).toContain('signal-catalog-empty');
  expect(text).toContain('No signals in catalog');
  expect(raw).not.toContain('signal-catalog-list');
  expect(raw).not.toContain('signal-catalog-search');

  await unmount(tree);
});

test('groups uncategorized signals when source_module is blank', async () => {
  mockUseSignalCatalog.mockReturnValue(
    catalogStub([catalogEntry('mystery_signal', '')]),
  );

  const tree = await render(<SignalCatalogWidget size={STANDARD} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('signal-catalog-group-Uncategorized');
  expect(text).toContain('Uncategorized');

  await unmount(tree);
});

test('falls back to the first vehicle id for the observations query', async () => {
  mockUseVehicles.mockReturnValue({data: [{id: 7}, {id: 9}]});

  const tree = await render(<SignalCatalogWidget size={STANDARD} />);

  expect(mockUseSignalObservations).toHaveBeenCalledWith(7);

  await unmount(tree);
});

test('passes the explicit vehicleId prop to the observations query', async () => {
  const tree = await render(
    <SignalCatalogWidget vehicleId={42} size={STANDARD} />,
  );

  expect(mockUseSignalObservations).toHaveBeenCalledWith(42);

  await unmount(tree);
});

test('uses 0 as the vehicle id when there are no vehicles', async () => {
  mockUseVehicles.mockReturnValue({data: []});

  const tree = await render(<SignalCatalogWidget size={STANDARD} />);

  expect(mockUseSignalObservations).toHaveBeenCalledWith(0);

  await unmount(tree);
});
