import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {QuickLinksSection} from '../src/web-parity/features/vehicles/components/vehicle-detail/QuickLinksSection';

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

async function render() {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<QuickLinksSection />);
  });
  return tree;
}

async function unmount(tree: ReactTestRenderer.ReactTestRenderer | undefined) {
  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
}

test('renders the section header and every quick-link label', async () => {
  const tree = await render();
  const text = textOf(tree);
  const raw = rawOf(tree);

  expect(raw).toContain('quick-links-section');
  expect(text).toContain('Quick Links');

  // All six i18n labels are preserved verbatim.
  expect(text).toContain('Drives');
  expect(text).toContain('Charging');
  expect(text).toContain('Battery');
  expect(text).toContain('Climate');
  expect(text).toContain('Efficiency');
  expect(text).toContain('Settings');

  await unmount(tree);
});

test('preserves every link destination path on its Pressable', async () => {
  const tree = await render();
  const raw = rawOf(tree);

  // accessibilityValue.text === the route the web <Link to> targeted.
  for (const path of [
    '/drives',
    '/charging',
    '/battery',
    '/climate',
    '/efficiency',
    '/settings',
  ]) {
    expect(raw).toContain(`${path}"`);
    expect(raw).toContain(`quick-links-link-${path}`);
  }

  await unmount(tree);
});

test('exposes the tiles as accessibility links', async () => {
  const tree = await render();
  const raw = rawOf(tree);

  expect(raw).toContain('"accessibilityRole":"link"');

  await unmount(tree);
});
