import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  CommandSelectDialog,
  type CommandDef,
} from '../src/web-parity/features/system/components/CommandSelectDialog';

const def: CommandDef = {
  labelKey: 'commands.charging.chargePort',
  labelFallback: 'Charge Port',
  iconName: 'charging',
  selectConfig: {
    paramName: 'state',
    options: [
      {
        value: 'open',
        labelKey: 'commands.charging.open',
        labelFallback: 'Open',
        description: 'Unlatch the charge port',
      },
      {
        value: 'close',
        labelKey: 'commands.charging.close',
        labelFallback: 'Close',
      },
    ],
  },
};

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

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
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

test('renders the header label, every option (with description), and Cancel', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandSelectDialog def={def} onClose={jest.fn()} onSelect={jest.fn()} open />,
    );
  });

  const serialized = serialize(tree);
  expect(serialized).toContain('Charge Port');
  expect(serialized).toContain('Open');
  expect(serialized).toContain('Unlatch the charge port');
  expect(serialized).toContain('Close');
  expect(serialized).toContain('Cancel');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('tapping an option fires onSelect with its value', async () => {
  const onSelect = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandSelectDialog def={def} onClose={jest.fn()} onSelect={onSelect} open />,
    );
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'command-select-option-open');
  });

  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith('open');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('tapping Cancel fires onClose', async () => {
  const onClose = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandSelectDialog def={def} onClose={onClose} onSelect={jest.fn()} open />,
    );
  });

  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'command-select-cancel');
  });

  expect(onClose).toHaveBeenCalledTimes(1);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('loading disables the option buttons so a tap cannot double-submit', async () => {
  const onSelect = jest.fn();
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CommandSelectDialog
        def={def}
        loading
        onClose={jest.fn()}
        onSelect={onSelect}
        open
      />,
    );
  });

  const option = tree?.root
    .findAllByProps({testID: 'command-select-option-open'})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(option?.props.disabled).toBe(true);
  expect(option?.props.accessibilityState).toEqual({disabled: true});

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
