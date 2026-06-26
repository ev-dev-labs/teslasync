import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {Toggle} from '../src/web-parity/components/ui/Toggle';

function findSwitch(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
): ReactTestRenderer.ReactTestInstance {
  const node = tree?.root
    .findAll(
      candidate =>
        candidate.props.accessibilityRole === 'switch' &&
        typeof candidate.props.onPress === 'function',
    )
    .at(0);
  expect(node).toBeDefined();
  return node as ReactTestRenderer.ReactTestInstance;
}

test('renders a switch reflecting the checked state and label', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Toggle checked label="Dark mode" onChange={() => {}} />,
    );
  });

  const node = findSwitch(tree);
  expect(node.props.accessibilityState).toEqual({checked: true});
  expect(node.props.accessibilityLabel).toBe('Dark mode');
  expect(JSON.stringify(tree?.toJSON())).toContain('Dark mode');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('reports the flipped boolean when toggled on press', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  const changes: boolean[] = [];

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Toggle checked={false} onChange={next => changes.push(next)} />,
    );
  });

  await ReactTestRenderer.act(async () => {
    findSwitch(tree).props.onPress();
  });
  expect(changes).toEqual([true]);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('flips the track tint and thumb offset between off and on', async () => {
  const TRACK_ON = '#0891b2';
  const TRACK_OFF = '#4b5563';

  // The md (default) thumb shifts from left:3 (off) to left:23 (3 + translate 20).
  const renderState = async (checked: boolean) => {
    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <Toggle checked={checked} onChange={() => {}} />,
      );
    });
    return tree;
  };

  const offTree = await renderState(false);
  const offJson = JSON.stringify(offTree?.toJSON());
  expect(offJson).toContain(TRACK_OFF);
  expect(offJson).toContain('"left":3');

  const onTree = await renderState(true);
  const onJson = JSON.stringify(onTree?.toJSON());
  expect(onJson).toContain(TRACK_ON);
  expect(onJson).toContain('"left":23');

  await ReactTestRenderer.act(async () => {
    offTree?.unmount();
    onTree?.unmount();
  });
});

test('omits the label node when no label is supplied', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <Toggle checked={false} onChange={() => {}} testID="bare-toggle" />,
    );
  });

  const node = findSwitch(tree);
  expect(node.props.testID).toBe('bare-toggle');
  expect(node.props.accessibilityLabel).toBeUndefined();

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
