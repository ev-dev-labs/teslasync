import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import RequestBuilder from '../src/web-parity/features/admin/components/RequestBuilder';
import {type ParsedEndpoint} from '../src/web-parity/features/admin/components/EndpointSidebar';

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

function setText(tree: Renderer, testID: string, value: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID &&
      typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onChangeText(value);
  });
}

function textOf(node: ReactTestInstance): string {
  const {children} = node.props as {children: unknown};
  return (Array.isArray(children) ? children : [children])
    .map(c => (c == null || c === false ? '' : String(c)))
    .join('');
}

function urlText(tree: Renderer): string {
  return textOf(hostByTestID(tree, 'request-builder-url'));
}

function param(
  name: string,
  where: 'path' | 'query',
  extra: Partial<ParsedEndpoint['parameters'][number]> = {},
): ParsedEndpoint['parameters'][number] {
  return {
    name,
    in: where,
    required: extra.required ?? false,
    type: extra.type ?? 'string',
    description: extra.description ?? '',
    default: extra.default,
  };
}

function ep(extra: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    method: extra.method ?? 'GET',
    path: extra.path ?? '/vehicles',
    tag: extra.tag ?? 'Vehicles',
    summary: extra.summary ?? '',
    description: extra.description ?? '',
    operationId: extra.operationId ?? 'op',
    parameters: extra.parameters ?? [],
    requestBody: extra.requestBody,
    responses: extra.responses ?? {},
  };
}

/* ── URL building ── */

test('prefixes /api/v1 and shows the raw path when there are no params', () => {
  const tree = render(
    <RequestBuilder endpoint={ep()} loading={false} onSend={() => {}} />,
  );
  expect(urlText(tree)).toBe('/api/v1/vehicles');
});

test('substitutes a path parameter and assembles an encoded query string', () => {
  const endpoint = ep({
    path: '/vehicles/{vehicleID}/state',
    parameters: [
      param('vehicleID', 'path', {required: true}),
      param('q', 'query'),
    ],
  });
  const tree = render(
    <RequestBuilder endpoint={endpoint} loading={false} onSend={() => {}} />,
  );
  // Unfilled path param keeps its {placeholder}; empty query param is omitted.
  expect(urlText(tree)).toBe('/api/v1/vehicles/{vehicleID}/state');

  setText(tree, 'request-builder-path-input-vehicleID', '42');
  setText(tree, 'request-builder-query-input-q', 'a b');
  expect(urlText(tree)).toBe('/api/v1/vehicles/42/state?q=a%20b');
});

test('seeds query params from their default value on mount', () => {
  const endpoint = ep({
    path: '/drives',
    parameters: [param('limit', 'query', {default: '50'})],
  });
  const tree = render(
    <RequestBuilder endpoint={endpoint} loading={false} onSend={() => {}} />,
  );
  expect(urlText(tree)).toBe('/api/v1/drives?limit=50');
});

/* ── send (non-destructive GET) ── */

test('a GET sends immediately with no confirmation and no body/headers', () => {
  const onSend = jest.fn();
  const tree = render(
    <RequestBuilder endpoint={ep()} loading={false} onSend={onSend} />,
  );
  press(tree, 'request-builder-send');
  expect(hasHost(tree, 'request-builder-confirm')).toBe(false);
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith('/vehicles', 'GET', undefined, {});
});

test('a non-empty API key is forwarded as the X-API-Key header (trimmed)', () => {
  const onSend = jest.fn();
  const tree = render(
    <RequestBuilder endpoint={ep()} loading={false} onSend={onSend} />,
  );
  setText(tree, 'request-builder-apikey', '  secret-token  ');
  press(tree, 'request-builder-send');
  expect(onSend).toHaveBeenCalledWith('/vehicles', 'GET', undefined, {
    'X-API-Key': 'secret-token',
  });
});

/* ── destructive confirm flow ── */

test('a non-GET method requires a second confirmed tap before sending', () => {
  const onSend = jest.fn();
  const tree = render(
    <RequestBuilder
      endpoint={ep({method: 'POST', path: '/vehicles'})}
      loading={false}
      onSend={onSend}
    />,
  );
  expect(hasHost(tree, 'request-builder-confirm')).toBe(false);

  // First tap only opens the confirmation strip.
  press(tree, 'request-builder-send');
  expect(onSend).not.toHaveBeenCalled();
  expect(hasHost(tree, 'request-builder-confirm')).toBe(true);
  expect(textOf(hostByTestID(tree, 'request-builder-confirm'))).not.toContain(
    '{{method}}',
  );

  // Confirming sends and closes the strip.
  press(tree, 'request-builder-confirm-yes');
  expect(onSend).toHaveBeenCalledTimes(1);
  expect(onSend).toHaveBeenCalledWith('/vehicles', 'POST', undefined, {});
  expect(hasHost(tree, 'request-builder-confirm')).toBe(false);
});

test('cancelling closes the confirmation strip without sending', () => {
  const onSend = jest.fn();
  const tree = render(
    <RequestBuilder
      endpoint={ep({method: 'DELETE', path: '/drives/{id}'})}
      loading={false}
      onSend={onSend}
    />,
  );
  press(tree, 'request-builder-send');
  expect(hasHost(tree, 'request-builder-confirm')).toBe(true);
  press(tree, 'request-builder-confirm-cancel');
  expect(hasHost(tree, 'request-builder-confirm')).toBe(false);
  expect(onSend).not.toHaveBeenCalled();
});

/* ── request body ── */

test('seeds the body from the requestBody example and sends it', () => {
  const onSend = jest.fn();
  const endpoint = ep({
    method: 'POST',
    path: '/alerts/rules',
    requestBody: {contentType: 'application/json', example: {name: 'x'}},
  });
  const tree = render(
    <RequestBuilder endpoint={endpoint} loading={false} onSend={onSend} />,
  );
  const bodyInput = hostByTestID(tree, 'request-builder-body-input');
  expect(bodyInput.props.value).toBe(JSON.stringify({name: 'x'}, null, 2));

  press(tree, 'request-builder-send');
  press(tree, 'request-builder-confirm-yes');
  expect(onSend).toHaveBeenCalledWith(
    '/alerts/rules',
    'POST',
    JSON.stringify({name: 'x'}, null, 2),
    {},
  );
});

test('an endpoint with a body but no example seeds the empty JSON template', () => {
  const tree = render(
    <RequestBuilder
      endpoint={ep({
        method: 'PUT',
        path: '/settings',
        requestBody: {contentType: 'application/json'},
      })}
      loading={false}
      onSend={() => {}}
    />,
  );
  expect(hostByTestID(tree, 'request-builder-body-input').props.value).toBe(
    '{\n  \n}',
  );
});

/* ── conditional panels ── */

test('only the panels the endpoint needs are rendered', () => {
  const tree = render(
    <RequestBuilder endpoint={ep()} loading={false} onSend={() => {}} />,
  );
  // Plain GET, no params, no body -> only the always-present auth panel.
  expect(hasHost(tree, 'request-builder-path-params')).toBe(false);
  expect(hasHost(tree, 'request-builder-query-params')).toBe(false);
  expect(hasHost(tree, 'request-builder-body')).toBe(false);
  expect(hasHost(tree, 'request-builder-auth')).toBe(true);

  const full = render(
    <RequestBuilder
      endpoint={ep({
        method: 'POST',
        path: '/vehicles/{id}',
        parameters: [param('id', 'path'), param('q', 'query')],
        requestBody: {contentType: 'application/json'},
      })}
      loading={false}
      onSend={() => {}}
    />,
  );
  expect(hasHost(full, 'request-builder-path-params')).toBe(true);
  expect(hasHost(full, 'request-builder-query-params')).toBe(true);
  expect(hasHost(full, 'request-builder-body')).toBe(true);
});

/* ── summary / description ── */

test('renders summary and a distinct description, hiding a duplicate description', () => {
  const withBoth = render(
    <RequestBuilder
      endpoint={ep({summary: 'List vehicles', description: 'All of them'})}
      loading={false}
      onSend={() => {}}
    />,
  );
  expect(hasHost(withBoth, 'request-builder-summary')).toBe(true);
  expect(hasHost(withBoth, 'request-builder-description')).toBe(true);

  const duplicate = render(
    <RequestBuilder
      endpoint={ep({summary: 'Same', description: 'Same'})}
      loading={false}
      onSend={() => {}}
    />,
  );
  expect(hasHost(duplicate, 'request-builder-summary')).toBe(true);
  expect(hasHost(duplicate, 'request-builder-description')).toBe(false);
});

/* ── loading state ── */

test('the send button is disabled and relabelled while loading', () => {
  const onSend = jest.fn();
  const tree = render(
    <RequestBuilder endpoint={ep()} loading={true} onSend={onSend} />,
  );
  const send = hostByTestID(tree, 'request-builder-send');
  expect(send.props.accessibilityState.disabled).toBe(true);
  expect(send.props.accessibilityLabel).toBe('Sending...');
});
