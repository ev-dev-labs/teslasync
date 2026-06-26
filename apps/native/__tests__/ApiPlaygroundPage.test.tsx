import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import type {ParsedEndpoint} from '../src/web-parity/features/admin/components/EndpointSidebar';

// useQuery is mocked so the page resolves its OpenAPI endpoint list
// synchronously without a QueryClientProvider, network/fetch, or YAML parsing
// (keeps the suite deterministic + free of open handles). Mirrors the
// SignalQueryControls test precedent.
type MockQuery = {
  data?: ParsedEndpoint[];
  isLoading: boolean;
  error: unknown;
};

let mockQuery: MockQuery = {data: [], isLoading: false, error: null};

jest.mock('@tanstack/react-query', () => ({
  useQuery: () => mockQuery,
}));

import ApiPlaygroundPage from '../src/web-parity/features/admin/pages/ApiPlaygroundPage';

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

function ep(extra: Partial<ParsedEndpoint> = {}): ParsedEndpoint {
  return {
    method: extra.method ?? 'GET',
    path: extra.path ?? '/vehicles',
    tag: extra.tag ?? 'Vehicles',
    summary: extra.summary ?? 'List vehicles',
    description: extra.description ?? '',
    operationId: extra.operationId ?? 'listVehicles',
    parameters: extra.parameters ?? [],
    requestBody: extra.requestBody,
    responses: extra.responses ?? {},
  };
}

afterEach(() => {
  mockQuery = {data: [], isLoading: false, error: null};
});

/* ── spec-loading / error scaffold states ── */

test('shows the loading indicator and hides the workspace while the spec loads', () => {
  mockQuery = {data: undefined, isLoading: true, error: null};
  const tree = render(<ApiPlaygroundPage />);
  expect(hasHost(tree, 'api-playground-loading')).toBe(true);
  expect(hasHost(tree, 'endpoint-sidebar')).toBe(false);
  expect(hasHost(tree, 'api-playground-empty')).toBe(false);
});

test('surfaces a spec fetch error with its message', () => {
  mockQuery = {data: undefined, isLoading: false, error: new Error('spec exploded')};
  const tree = render(<ApiPlaygroundPage />);
  expect(hasHost(tree, 'api-playground-error')).toBe(true);
  expect(allText(tree)).toContain('spec exploded');
  expect(hasHost(tree, 'endpoint-sidebar')).toBe(false);
});

/* ── loaded workspace ── */

test('renders the sidebar, the empty main panel, and the endpoint count', () => {
  mockQuery = {
    data: [ep({method: 'GET', path: '/vehicles'}), ep({method: 'POST', path: '/alerts', tag: 'Alerts'})],
    isLoading: false,
    error: null,
  };
  const tree = render(<ApiPlaygroundPage />);
  expect(hasHost(tree, 'endpoint-sidebar')).toBe(true);
  expect(hasHost(tree, 'api-playground-empty')).toBe(true);
  expect(allText(tree)).toContain('2 endpoints available');
  // Nothing selected yet -> no builder / response viewer.
  expect(hasHost(tree, 'request-builder')).toBe(false);
  expect(hasHost(tree, 'response-viewer')).toBe(false);
});

test('omits the endpoint count when there are zero endpoints', () => {
  mockQuery = {data: [], isLoading: false, error: null};
  const tree = render(<ApiPlaygroundPage />);
  expect(hasHost(tree, 'api-playground-empty')).toBe(true);
  expect(allText(tree)).not.toContain('endpoints available');
});

test('selecting an endpoint replaces the empty state with the builder + response viewer', () => {
  mockQuery = {
    data: [ep({method: 'GET', path: '/vehicles'})],
    isLoading: false,
    error: null,
  };
  const tree = render(<ApiPlaygroundPage />);
  expect(hasHost(tree, 'api-playground-empty')).toBe(true);

  press(tree, 'endpoint-sidebar-endpoint-GET-/vehicles');

  expect(hasHost(tree, 'api-playground-empty')).toBe(false);
  expect(hasHost(tree, 'request-builder')).toBe(true);
  expect(hasHost(tree, 'response-viewer')).toBe(true);
});
