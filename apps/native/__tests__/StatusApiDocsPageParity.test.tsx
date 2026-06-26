import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import StatusApiDocsPage from '../src/web-parity/features/system/pages/StatusApiDocsPage';

// StatusApiDocsPage is fully static (no data hook, no i18n on the web original),
// so these assertions mirror the web JSX directly: the title/subtitle scaffold,
// every documented /api/v1/status* endpoint path, the back-link in-app
// navigation, and the per-endpoint "Example response" disclosure (collapsed by
// default like a <details> without `open`, revealing the JSON payload on press).

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

const ENDPOINT_PATHS: readonly string[] = [
  '/api/v1/status',
  '/api/v1/status/components',
  '/api/v1/status/resources',
  '/api/v1/status/uptime',
  '/api/v1/status/incidents',
  '/api/v1/status/live',
];

async function render(
  onNavigate?: (to: string) => void,
): Promise<ReactTestRenderer.ReactTestRenderer> {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<StatusApiDocsPage onNavigate={onNavigate} />);
  });
  return tree as ReactTestRenderer.ReactTestRenderer;
}

test('renders the page title, subtitle, and overview', async () => {
  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  expect(raw).toContain('status-api-docs-page');
  expect(text).toContain('Status API');
  expect(text).toContain('Stable contract for external integrations');
  expect(text).toContain('Overview');
});

test('documents every /api/v1/status endpoint path', async () => {
  const tree = await render();
  const raw = rawOf(tree);
  const text = textOf(tree);

  for (const path of ENDPOINT_PATHS) {
    expect(raw).toContain(`status-api-endpoint-${path}`);
    expect(text).toContain(path);
  }
});

test('navigates back to system status when the back link is pressed', async () => {
  const onNavigate = jest.fn();
  const tree = await render(onNavigate);

  const backLink = tree.root.findByProps({testID: 'status-api-back-link'});
  await ReactTestRenderer.act(async () => {
    backLink.props.onPress();
  });

  expect(onNavigate).toHaveBeenCalledWith('/system-status');
});

test('keeps each example response collapsed until its toggle is pressed', async () => {
  const tree = await render();

  // Default-collapsed: the snapshot payload is not rendered yet.
  expect(textOf(tree)).not.toContain('operational');

  const toggle = tree.root.findByProps({
    testID: 'status-api-example-toggle-/api/v1/status',
  });
  await ReactTestRenderer.act(async () => {
    toggle.props.onPress();
  });

  // After expanding, the JSON.stringify(example) payload is revealed.
  expect(textOf(tree)).toContain('operational');
});

test('does not crash when no onNavigate is provided', async () => {
  const tree = await render();

  const backLink = tree.root.findByProps({testID: 'status-api-back-link'});
  expect(() => backLink.props.onPress()).not.toThrow();
});
