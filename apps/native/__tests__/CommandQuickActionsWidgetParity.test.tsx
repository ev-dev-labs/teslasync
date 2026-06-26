import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {useVehicleCommand} from '../src/web-parity/api/hooks/useVehicleCommand';
import {useVehicles} from '../src/web-parity/api/hooks/useVehicles';
import CommandQuickActionsWidget from '../src/web-parity/features/dashboard/widgets/CommandQuickActionsWidget';

jest.mock('../src/web-parity/api/hooks/useVehicleCommand', () => ({
  useVehicleCommand: jest.fn(),
}));
jest.mock('../src/web-parity/api/hooks/useVehicles', () => ({
  useVehicles: jest.fn(),
}));

const mockUseVehicleCommand = useVehicleCommand as unknown as jest.Mock;
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

function vehiclesStub() {
  return {
    data: [{id: 1}, {id: 2}],
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  };
}

function commandStub() {
  return {
    mutate: jest.fn(),
    isPending: false,
  };
}

let currentCommand: ReturnType<typeof commandStub>;

beforeEach(() => {
  currentCommand = commandStub();
  mockUseVehicles.mockReturnValue(vehiclesStub());
  mockUseVehicleCommand.mockReturnValue(currentCommand);
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

async function unmount(tree: ReactTestRenderer.ReactTestRenderer): Promise<void> {
  await ReactTestRenderer.act(async () => {
    tree.unmount();
  });
}

function findByTestID(
  tree: ReactTestRenderer.ReactTestRenderer,
  testID: string,
): ReactTestRenderer.ReactTestInstance {
  return tree.root.findByProps({testID});
}

const WIDE = {cols: 4, rows: 2};
const MEDIUM = {cols: 2, rows: 2};
const COMPACT = {cols: 1, rows: 1};

test('renders the wide layout with the title, all eight command tiles and freshness', async () => {
  const tree = await render(<CommandQuickActionsWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('command-quick-actions-widget');
  expect(text).toContain('Quick Actions');
  expect(raw).toContain('command-quick-actions-freshness');
  expect(raw).toContain('command-quick-actions-grid');

  // All eight commands are visible in the wide layout, each with its label.
  for (const id of [
    'lock',
    'unlock',
    'climate_on',
    'climate_off',
    'frunk',
    'honk',
    'flash',
    'trunk',
  ]) {
    expect(raw).toContain(`command-quick-actions-button-${id}`);
  }
  expect(text).toContain('Lock');
  expect(text).toContain('Unlock');
  expect(text).toContain('Climate On');
  expect(text).toContain('Climate Off');
  expect(text).toContain('Frunk');
  expect(text).toContain('Horn');
  expect(text).toContain('Flash');
  expect(text).toContain('Trunk');

  await unmount(tree);
});

test('renders only the first six tiles in the medium layout', async () => {
  const tree = await render(<CommandQuickActionsWidget size={MEDIUM} />);
  const raw = rawOf(tree);

  for (const id of ['lock', 'unlock', 'climate_on', 'climate_off', 'frunk', 'honk']) {
    expect(raw).toContain(`command-quick-actions-button-${id}`);
  }
  // flash + trunk (indices 6,7) are hidden when not wide.
  expect(raw).not.toContain('command-quick-actions-button-flash');
  expect(raw).not.toContain('command-quick-actions-button-trunk');

  await unmount(tree);
});

test('renders the compact layout title-less with the first four icon-only tiles', async () => {
  const tree = await render(<CommandQuickActionsWidget size={COMPACT} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('command-quick-actions-widget');
  // The compact shell is title-less, so the wide title is absent.
  expect(text).not.toContain('Quick Actions');
  // First four commands only.
  expect(raw).toContain('command-quick-actions-button-lock');
  expect(raw).toContain('command-quick-actions-button-climate_off');
  expect(raw).not.toContain('command-quick-actions-button-frunk');
  // Compact tiles are icon-only — no text labels rendered.
  expect(text).not.toContain('Climate Off');
  // Freshness is still wired (overlaid).
  expect(raw).toContain('command-quick-actions-freshness');

  await unmount(tree);
});

test('renders the empty state when no vehicle is available', async () => {
  mockUseVehicles.mockReturnValue({
    data: [],
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: jest.fn(),
  });

  const tree = await render(<CommandQuickActionsWidget size={WIDE} />);
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('command-quick-actions-empty');
  expect(raw).not.toContain('command-quick-actions-grid');
  expect(text).toContain('No vehicle selected');

  await unmount(tree);
});

test('dispatches the command mutation with the resolved vehicle id and shows the active spinner', async () => {
  const tree = await render(<CommandQuickActionsWidget size={WIDE} />);

  await ReactTestRenderer.act(async () => {
    findByTestID(tree, 'command-quick-actions-button-lock').props.onPress();
  });

  expect(currentCommand.mutate).toHaveBeenCalledTimes(1);
  expect(currentCommand.mutate.mock.calls[0][0]).toEqual({
    vehicleId: 1,
    command: 'lock',
  });
  expect(typeof currentCommand.mutate.mock.calls[0][1].onSettled).toBe(
    'function',
  );

  // While the command is active the lock tile shows a spinner and every tile
  // is disabled.
  const raw = rawOf(tree);
  expect(raw).toContain('command-quick-actions-spinner-lock');
  expect(findByTestID(tree, 'command-quick-actions-button-unlock').props.disabled).toBe(
    true,
  );

  await unmount(tree);
});

test('clears the active command when the mutation settles', async () => {
  const tree = await render(<CommandQuickActionsWidget size={WIDE} />);

  await ReactTestRenderer.act(async () => {
    findByTestID(tree, 'command-quick-actions-button-honk').props.onPress();
  });
  expect(rawOf(tree)).toContain('command-quick-actions-spinner-honk');

  // Invoke the onSettled callback the widget passed to mutate.
  await ReactTestRenderer.act(async () => {
    currentCommand.mutate.mock.calls[0][1].onSettled();
  });

  const raw = rawOf(tree);
  expect(raw).not.toContain('command-quick-actions-spinner-honk');
  expect(findByTestID(tree, 'command-quick-actions-button-unlock').props.disabled).toBe(
    false,
  );

  await unmount(tree);
});

test('falls back to the first vehicle id when no vehicleId prop is supplied', async () => {
  mockUseVehicles.mockReturnValue({
    ...vehiclesStub(),
    data: [{id: 7}, {id: 9}],
  });

  const tree = await render(<CommandQuickActionsWidget size={WIDE} />);

  await ReactTestRenderer.act(async () => {
    findByTestID(tree, 'command-quick-actions-button-flash').props.onPress();
  });

  expect(currentCommand.mutate.mock.calls[0][0]).toEqual({
    vehicleId: 7,
    command: 'flash_lights',
  });

  await unmount(tree);
});

test('uses the explicit vehicleId prop over the first vehicle', async () => {
  const tree = await render(
    <CommandQuickActionsWidget vehicleId={42} size={WIDE} />,
  );

  await ReactTestRenderer.act(async () => {
    findByTestID(tree, 'command-quick-actions-button-trunk').props.onPress();
  });

  expect(currentCommand.mutate.mock.calls[0][0]).toEqual({
    vehicleId: 42,
    command: 'actuate_trunk',
  });

  await unmount(tree);
});
