import React from 'react';
import {StyleSheet} from 'react-native';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import EndpointSidebar, {
  MethodBadge,
  type ParsedEndpoint,
} from '../src/web-parity/features/admin/components/EndpointSidebar';
import {colors} from '../src/theme/tokens';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

function countHostPrefix(tree: Renderer, prefix: string): number {
  return tree.root.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' &&
      typeof node.props.testID === 'string' &&
      node.props.testID.startsWith(prefix),
  ).length;
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

function setSearch(tree: Renderer, value: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === 'endpoint-sidebar-search' &&
      typeof node.props.onChangeText === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onChangeText(value);
  });
}

function ep(
  method: ParsedEndpoint['method'],
  path: string,
  tag: string,
  extra: Partial<ParsedEndpoint> = {},
): ParsedEndpoint {
  return {
    method,
    path,
    tag,
    summary: extra.summary ?? `${method} ${path}`,
    description: extra.description ?? '',
    operationId: extra.operationId ?? `${method.toLowerCase()}${path}`,
    parameters: [],
    responses: {},
  };
}

const ENDPOINTS: ParsedEndpoint[] = [
  ep('GET', '/vehicles', 'Vehicles', {
    summary: 'List vehicles',
    operationId: 'listVehicles',
  }),
  ep('POST', '/vehicles', 'Vehicles', {
    summary: 'Create vehicle',
    operationId: 'createVehicle',
  }),
  ep('GET', '/charging', 'Charging', {
    summary: 'List charging sessions',
    operationId: 'listCharging',
  }),
];

/* ── MethodBadge ── */

test('MethodBadge resolves the per-method colour and renders the label', () => {
  const tree = render(<MethodBadge method="GET" />);
  const badge = hostByTestID(tree, 'endpoint-method-badge-GET');
  const flat = StyleSheet.flatten(badge.props.style);
  expect(flat.backgroundColor).toBe('rgba(34, 197, 94, 0.2)');
  const label = badge.findAll(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.children === 'GET',
  );
  expect(label.length).toBeGreaterThan(0);
});

test('MethodBadge falls back to the gray chip for an unknown method', () => {
  const tree = render(<MethodBadge method="WEIRD" />);
  const badge = hostByTestID(tree, 'endpoint-method-badge-WEIRD');
  const flat = StyleSheet.flatten(badge.props.style);
  expect(flat.backgroundColor).toBe('rgba(107, 114, 128, 0.2)');
});

/* ── render + grouping ── */

test('renders search, count, every tag group and every endpoint row', () => {
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={() => {}} selected={null} />,
  );
  expect(hasHost(tree, 'endpoint-sidebar-search')).toBe(true);
  expect(hasHost(tree, 'endpoint-sidebar-count')).toBe(true);
  // 2 distinct tags -> <= 5 groups so every group is default-open.
  expect(countHostPrefix(tree, 'endpoint-sidebar-tag-toggle-')).toBe(2);
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(3);
  expect(hasHost(tree, 'endpoint-sidebar-empty')).toBe(false);
});

/* ── search filter ── */

test('case-insensitive path filter narrows the list', () => {
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={() => {}} selected={null} />,
  );
  setSearch(tree, 'VEHICLES');
  expect(countHostPrefix(tree, 'endpoint-sidebar-tag-toggle-')).toBe(1);
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(2);
  expect(hasHost(tree, 'endpoint-sidebar-tag-toggle-Vehicles')).toBe(true);
});

test('filter matches the summary field', () => {
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={() => {}} selected={null} />,
  );
  setSearch(tree, 'sessions');
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(1);
  expect(hasHost(tree, 'endpoint-sidebar-endpoint-GET-/charging')).toBe(true);
});

test('filter matches the operationId field', () => {
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={() => {}} selected={null} />,
  );
  setSearch(tree, 'createvehicle');
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(1);
  expect(hasHost(tree, 'endpoint-sidebar-endpoint-POST-/vehicles')).toBe(true);
});

test('a non-matching search shows the empty state and no rows', () => {
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={() => {}} selected={null} />,
  );
  setSearch(tree, 'zzzzzz');
  expect(countHostPrefix(tree, 'endpoint-sidebar-tag-toggle-')).toBe(0);
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(0);
  expect(hasHost(tree, 'endpoint-sidebar-empty')).toBe(true);
});

/* ── accordion ── */

test('each tag group toggles its rows independently', () => {
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={() => {}} selected={null} />,
  );
  // both default-open: 3 rows visible.
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(3);

  press(tree, 'endpoint-sidebar-tag-toggle-Vehicles');
  // Vehicles collapsed -> only the single Charging row remains.
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(1);
  expect(hasHost(tree, 'endpoint-sidebar-endpoint-GET-/charging')).toBe(true);

  press(tree, 'endpoint-sidebar-tag-toggle-Vehicles');
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(3);
});

test('with more than 5 groups every group starts collapsed', () => {
  const many: ParsedEndpoint[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'].map(tag =>
    ep('GET', `/${tag}`, tag),
  );
  const tree = render(
    <EndpointSidebar endpoints={many} onSelect={() => {}} selected={null} />,
  );
  expect(countHostPrefix(tree, 'endpoint-sidebar-tag-toggle-')).toBe(6);
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(0);

  press(tree, 'endpoint-sidebar-tag-toggle-G3');
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(1);
  expect(hasHost(tree, 'endpoint-sidebar-endpoint-GET-/G3')).toBe(true);
});

test('the group holding the selection is default-open even past 5 groups', () => {
  const many: ParsedEndpoint[] = ['G1', 'G2', 'G3', 'G4', 'G5', 'G6'].map(tag =>
    ep('GET', `/${tag}`, tag),
  );
  const tree = render(
    <EndpointSidebar endpoints={many} onSelect={() => {}} selected={many[2]} />,
  );
  expect(countHostPrefix(tree, 'endpoint-sidebar-endpoint-')).toBe(1);
  expect(hasHost(tree, 'endpoint-sidebar-endpoint-GET-/G3')).toBe(true);
});

/* ── selection ── */

test('the selected row is flagged via accessibilityState', () => {
  const tree = render(
    <EndpointSidebar
      endpoints={ENDPOINTS}
      onSelect={() => {}}
      selected={ENDPOINTS[0]}
    />,
  );
  const selectedRow = hostByTestID(tree, 'endpoint-sidebar-endpoint-GET-/vehicles');
  expect(selectedRow.props.accessibilityState.selected).toBe(true);
  const flat = StyleSheet.flatten(selectedRow.props.style);
  expect(flat.borderLeftColor).toBe(colors.accent);

  const otherRow = hostByTestID(tree, 'endpoint-sidebar-endpoint-POST-/vehicles');
  expect(otherRow.props.accessibilityState.selected).toBe(false);
});

test('pressing an endpoint row fires onSelect with that endpoint', () => {
  const onSelect = jest.fn();
  const tree = render(
    <EndpointSidebar endpoints={ENDPOINTS} onSelect={onSelect} selected={null} />,
  );
  press(tree, 'endpoint-sidebar-endpoint-GET-/charging');
  expect(onSelect).toHaveBeenCalledTimes(1);
  expect(onSelect).toHaveBeenCalledWith(
    expect.objectContaining({method: 'GET', path: '/charging'}),
  );
});
