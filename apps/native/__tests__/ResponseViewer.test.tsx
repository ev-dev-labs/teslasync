import React from 'react';
import {StyleSheet} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import ResponseViewer, {
  SnippetPanel,
  type ApiResponse,
  type HistoryEntry,
} from '../src/web-parity/features/admin/components/ResponseViewer';

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

function hostByTestID(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
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

function textOf(node: ReactTestInstance): string {
  const {children} = node.props as {children: unknown};
  return (Array.isArray(children) ? children : [children])
    .map(c => (c == null || c === false ? '' : String(c)))
    .join('');
}

function allText(tree: Renderer): string {
  return tree.root
    .findAll((node: ReactTestInstance) => typeof node.type === 'string')
    .map(textOf)
    .join('\n');
}

function styleOf(node: ReactTestInstance): Record<string, unknown> {
  return (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;
}

function resp(extra: Partial<ApiResponse> = {}): ApiResponse {
  return {
    status: extra.status ?? 200,
    statusText: extra.statusText ?? 'OK',
    headers: extra.headers ?? {},
    body: extra.body ?? {ok: true},
    bodyText: extra.bodyText ?? '{"ok":true}',
    duration: extra.duration ?? 12,
    size: extra.size ?? 2048,
    contentType: extra.contentType ?? 'application/json',
  };
}

const noop = () => {};

/* ── loading / empty / response states ── */

test('shows the loading skeleton and hides the empty + response while loading', () => {
  const tree = render(
    <ResponseViewer response={null} loading={true} history={[]} onReplay={noop} />,
  );
  expect(hasHost(tree, 'response-viewer-loading')).toBe(true);
  expect(hasHost(tree, 'response-viewer-empty')).toBe(false);
  expect(hasHost(tree, 'response-viewer-status')).toBe(false);
});

test('shows the empty state before the first response', () => {
  const tree = render(
    <ResponseViewer response={null} loading={false} history={[]} onReplay={noop} />,
  );
  expect(hasHost(tree, 'response-viewer-empty')).toBe(true);
  expect(hasHost(tree, 'response-viewer-status')).toBe(false);
});

test('pretty-prints a JSON body and renders the status line', () => {
  const tree = render(
    <ResponseViewer
      response={resp({status: 200, statusText: 'OK', body: {ok: true}})}
      loading={false}
      history={[]}
      onReplay={noop}
    />,
  );
  expect(hasHost(tree, 'response-viewer-status')).toBe(true);
  expect(textOf(hostByTestID(tree, 'response-viewer-body'))).toBe(
    JSON.stringify({ok: true}, null, 2),
  );
  expect(allText(tree)).toContain('200 OK');
});

test('renders the raw bodyText when the content type is not JSON', () => {
  const tree = render(
    <ResponseViewer
      response={resp({contentType: 'text/plain', body: 'hello', bodyText: 'hello'})}
      loading={false}
      history={[]}
      onReplay={noop}
    />,
  );
  expect(textOf(hostByTestID(tree, 'response-viewer-body'))).toBe('hello');
});

test('formats the byte size in the status meta', () => {
  const kb = render(
    <ResponseViewer
      response={resp({size: 2048})}
      loading={false}
      history={[]}
      onReplay={noop}
    />,
  );
  expect(allText(kb)).toContain('2.0 KB');

  const bytes = render(
    <ResponseViewer
      response={resp({size: 512})}
      loading={false}
      history={[]}
      onReplay={noop}
    />,
  );
  expect(allText(bytes)).toContain('512 B');
});

test('tints the status bar green for 2xx, amber for 3xx, and red for 4xx', () => {
  const ok = render(
    <ResponseViewer response={resp({status: 200})} loading={false} history={[]} onReplay={noop} />,
  );
  expect(styleOf(hostByTestID(ok, 'response-viewer-status')).backgroundColor).toBe(
    'rgba(34, 197, 94, 0.1)',
  );

  const redirect = render(
    <ResponseViewer response={resp({status: 304})} loading={false} history={[]} onReplay={noop} />,
  );
  expect(styleOf(hostByTestID(redirect, 'response-viewer-status')).backgroundColor).toBe(
    'rgba(245, 158, 11, 0.1)',
  );

  const error = render(
    <ResponseViewer response={resp({status: 404})} loading={false} history={[]} onReplay={noop} />,
  );
  expect(styleOf(hostByTestID(error, 'response-viewer-status')).backgroundColor).toBe(
    'rgba(239, 68, 68, 0.1)',
  );
});

/* ── response headers toggle ── */

test('hides the response-headers toggle when there are no headers', () => {
  const tree = render(
    <ResponseViewer
      response={resp({headers: {}})}
      loading={false}
      history={[]}
      onReplay={noop}
    />,
  );
  expect(hasHost(tree, 'response-headers-toggle')).toBe(false);
});

test('expands the response headers on toggle', () => {
  const tree = render(
    <ResponseViewer
      response={resp({headers: {'content-type': 'application/json'}})}
      loading={false}
      history={[]}
      onReplay={noop}
    />,
  );
  expect(hasHost(tree, 'response-headers-list')).toBe(false);
  press(tree, 'response-headers-toggle');
  expect(hasHost(tree, 'response-headers-list')).toBe(true);
  expect(allText(tree)).toContain('content-type');
});

/* ── history strip ── */

test('hides the history strip when empty and replays a chip when present', () => {
  const onReplay = jest.fn();
  const history: HistoryEntry[] = [
    {method: 'GET', path: '/vehicles', status: 200, duration: 10, timestamp: 't0'},
    {method: 'POST', path: '/alerts', status: 201, duration: 22, timestamp: 't1'},
  ];

  const empty = render(
    <ResponseViewer response={null} loading={false} history={[]} onReplay={onReplay} />,
  );
  expect(hasHost(empty, 'request-history')).toBe(false);

  const tree = render(
    <ResponseViewer response={null} loading={false} history={history} onReplay={onReplay} />,
  );
  expect(hasHost(tree, 'request-history')).toBe(true);
  expect(hasHost(tree, 'request-history-item-0')).toBe(true);
  expect(hasHost(tree, 'request-history-item-1')).toBe(true);

  press(tree, 'request-history-item-1');
  expect(onReplay).toHaveBeenCalledWith(history[1]);
});

/* ── snippet panel ── */

test('the snippet panel is collapsed until toggled', () => {
  const tree = render(<SnippetPanel method="GET" url="http://x/api/v1/vehicles" />);
  expect(hasHost(tree, 'snippet-panel-body')).toBe(false);
  press(tree, 'snippet-panel-toggle');
  expect(hasHost(tree, 'snippet-panel-body')).toBe(true);
  expect(hasHost(tree, 'snippet-copy')).toBe(true);
});

test('the snippet switches language and reflects the request', () => {
  const tree = render(
    <SnippetPanel method="POST" url="http://x/api/v1/alerts" body='{"a":1}' />,
  );
  press(tree, 'snippet-panel-toggle');

  // Default cURL snippet includes the method, URL and the body payload.
  let snippet = textOf(hostByTestID(tree, 'snippet-pre'));
  expect(snippet).toContain("curl -X POST 'http://x/api/v1/alerts'");
  expect(snippet).toContain(`-d '{"a":1}'`);

  press(tree, 'snippet-format-python');
  snippet = textOf(hostByTestID(tree, 'snippet-pre'));
  expect(snippet).toContain('import requests');
  expect(snippet).toContain('requests.post');

  press(tree, 'snippet-format-go');
  snippet = textOf(hostByTestID(tree, 'snippet-pre'));
  expect(snippet).toContain('http.NewRequest("POST"');
});

test('the GET go snippet uses http.Get', () => {
  const tree = render(<SnippetPanel method="GET" url="http://x/api/v1/vehicles" />);
  press(tree, 'snippet-panel-toggle');
  press(tree, 'snippet-format-go');
  expect(textOf(hostByTestID(tree, 'snippet-pre'))).toContain('http.Get("http://x/api/v1/vehicles")');
});
