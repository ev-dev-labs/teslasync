import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  SignalConfigModal,
  type CategoryDef,
} from '../src/web-parity/components/ui/SignalConfigModal';

const categories: CategoryDef[] = [
  {category: 'Driving', fields: ['vehicle_speed', 'odometer']},
  {category: 'Charging', fields: ['battery_level']},
];

type JsonNode =
  | string
  | number
  | null
  | undefined
  | {children?: JsonNode | JsonNode[]}
  | JsonNode[];

// Interpolated JSX text (e.g. `{count} / {total} signals selected`) renders as
// several adjacent text segments, so JSON.stringify would break the contiguous
// string. Flattening every text leaf into one string lets us assert on the
// rendered copy regardless of how React split the interpolations.
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

function serialize(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function pressByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  const node = tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(node).toBeDefined();
  node?.props.onPress();
}

test('renders the open dialog with categories, signals, and the initial count', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SignalConfigModal
        categories={categories}
        initialInterval={10}
        initialSelected={['vehicle_speed']}
        onClose={() => undefined}
        onSubmit={() => undefined}
        open
      />,
    );
  });

  const serialized = serialize(tree);

  expect(serialized).toContain('Fleet Telemetry Signal Configuration');
  expect(serialized).toContain('Driving');
  expect(serialized).toContain('Charging');
  expect(serialized).toContain('vehicle_speed');
  expect(serialized).toContain('odometer');
  expect(serialized).toContain('battery_level');
  // 1 of 3 signals selected by initialSelected.
  expect(serialized).toContain('1 / 3 signals selected');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('submits only the initially-selected signal with the initial interval', async () => {
  const onSubmit = jest.fn();
  const onClose = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SignalConfigModal
        categories={categories}
        initialInterval={10}
        initialSelected={['vehicle_speed']}
        onClose={onClose}
        onSubmit={onSubmit}
        open
      />,
    );
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'signal-config-submit');
  });

  expect(onSubmit).toHaveBeenCalledTimes(1);
  expect(onSubmit).toHaveBeenCalledWith([
    {name: 'vehicle_speed', interval: 10},
  ]);
  expect(onClose).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('Select All selects every signal and Subscribe reports them all', async () => {
  const onSubmit = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SignalConfigModal
        categories={categories}
        initialInterval={10}
        initialSelected={[]}
        onClose={() => undefined}
        onSubmit={onSubmit}
        open
      />,
    );
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'signal-config-select-all');
  });

  // Submit button label reflects all three signals now selected.
  expect(serialize(tree)).toContain('Subscribe 3 Signals');

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'signal-config-submit');
  });

  expect(onSubmit).toHaveBeenCalledTimes(1);
  const reported = onSubmit.mock.calls[0][0] as Array<{
    name: string;
    interval: number;
  }>;
  expect(reported.map(s => s.name).sort()).toEqual(
    ['battery_level', 'odometer', 'vehicle_speed'].sort(),
  );
  expect(reported.every(s => s.interval === 10)).toBe(true);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('applies a preset transform to the signal list', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <SignalConfigModal
        categories={categories}
        initialInterval={10}
        initialSelected={[]}
        onClose={() => undefined}
        onSubmit={() => undefined}
        open
      />,
    );
  });

  // The Low Power preset selects everything at 60s.
  const preset = tree?.root
    .findAllByProps({accessibilityLabel: '🔋 Low Power'})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(preset).toBeDefined();

  await ReactTestRenderer.act(async () => {
    preset?.props.onPress();
  });

  expect(serialize(tree)).toContain('Subscribe 3 Signals');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
