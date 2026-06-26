import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {CodeBlock} from '../src/web-parity/features/system/components/chatbot/CodeBlock';

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return JSON.stringify(tree?.toJSON());
}

test('renders the language label, the raw text, and a copy control', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CodeBlock language="ts" text="const a = 1;" />,
    );
  });

  const serialized = serialize(tree);

  expect(serialized).toContain('ts');
  expect(serialized).toContain('const a = 1;');
  expect(serialized).toContain('code-block-copy');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('falls back to the "text" label when the language is blank', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<CodeBlock language="   " text="echo hi" />);
  });

  const lang = tree?.root
    .findAllByProps({testID: 'code-block-lang'})
    .find(node => typeof node.props.children === 'string');
  expect(lang?.props.children).toBe('text');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('prefers pre-rendered children over the raw text for display', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(
      <CodeBlock text="RAW_CLIPBOARD_PAYLOAD">RENDERED_CHILDREN</CodeBlock>,
    );
  });

  const serialized = serialize(tree);
  expect(serialized).toContain('RENDERED_CHILDREN');
  expect(serialized).not.toContain('RAW_CLIPBOARD_PAYLOAD');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('reports an unavailable copy state when no clipboard is present', async () => {
  const originalNavigator = (globalThis as {navigator?: unknown}).navigator;
  (globalThis as {navigator?: unknown}).navigator = {};

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  try {
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<CodeBlock language="bash" text="ls -la" />);
    });

    const copy = tree?.root
      .findAllByProps({testID: 'code-block-copy'})
      .find(node => typeof node.props.onPress === 'function');
    expect(copy).toBeDefined();

    await ReactTestRenderer.act(async () => {
      await copy?.props.onPress();
    });

    const copyAfter = tree?.root
      .findAllByProps({testID: 'code-block-copy'})
      .find(node => typeof node.props.accessibilityHint === 'string');
    expect(copyAfter?.props.accessibilityHint).toContain('unavailable');
  } finally {
    await ReactTestRenderer.act(async () => {
      tree?.unmount();
    });
    (globalThis as {navigator?: unknown}).navigator = originalNavigator;
  }
});
