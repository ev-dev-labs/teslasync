import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';
import {Alert} from 'react-native';

// The native region hooks are mocked so the page resolves its query
// synchronously without a QueryClientProvider, network/fetch, or Alert side
// effects (keeps the suite deterministic + free of open handles). Mirrors the
// FleetAPIPage / ApiPlaygroundPage mocking precedent. All referenced module
// variables are `mock`-prefixed so the jest.mock factory may close over them.
type RegionEnvelope = {
  data?: {region?: string; fleet_api_base_url?: string};
  fetched_at?: string | null;
};
type QueryResult = {data?: RegionEnvelope};

let mockRegion: QueryResult = {
  data: {
    data: {
      region: 'NA',
      fleet_api_base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
    },
    fetched_at: '2026-04-04T09:30:00Z',
  },
};
let mockRefreshMutate = jest.fn();
let mockRefreshPending = false;

jest.mock('../src/web-parity/api/hooks/useUser', () => ({
  useTeslaUserRegion: () => mockRegion,
  useRefreshTeslaRegion: () => ({
    mutate: mockRefreshMutate,
    isPending: mockRefreshPending,
  }),
}));

import TeslaRegionPage from '../src/web-parity/features/admin/pages/TeslaRegionPage';

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

function nodeByTestID(tree: Renderer, testID: string): ReactTestInstance {
  return tree.root.find(
    (node: ReactTestInstance) =>
      typeof node.type === 'string' && node.props.testID === testID,
  );
}

function textOf(node: ReactTestInstance): string {
  const {children} = node.props as {children: unknown};
  return (Array.isArray(children) ? children : [children])
    .map(c => (c == null || c === false ? '' : String(c)))
    .join('');
}

function pressByTestID(tree: Renderer, testID: string): void {
  const target = tree.root.find(
    (node: ReactTestInstance) =>
      node.props.testID === testID && typeof node.props.onPress === 'function',
  );
  ReactTestRenderer.act(() => {
    target.props.onPress();
  });
}

function allText(tree: Renderer): string {
  return JSON.stringify(tree.toJSON());
}

afterEach(() => {
  mockRegion = {
    data: {
      data: {
        region: 'NA',
        fleet_api_base_url: 'https://fleet-api.prd.na.vn.cloud.tesla.com',
      },
      fetched_at: '2026-04-04T09:30:00Z',
    },
  };
  mockRefreshMutate = jest.fn();
  mockRefreshPending = false;
  jest.restoreAllMocks();
});

/* ── scaffold ── */

test('renders the page scaffold with the title and subtitle', () => {
  const tree = render(<TeslaRegionPage />);
  expect(hasHost(tree, 'tesla-region-page')).toBe(true);
  const text = allText(tree);
  expect(text).toContain('Region & API');
  expect(text).toContain('Tesla account region and Fleet API endpoint');
});

/* ── region + fleet-API-URL cards ── */

test('renders the region code and fleet API base URL cards when data is present', () => {
  const tree = render(<TeslaRegionPage />);
  expect(hasHost(tree, 'tesla-region-code')).toBe(true);
  expect(hasHost(tree, 'tesla-region-fleet-url')).toBe(true);
  expect(hasHost(tree, 'tesla-region-empty')).toBe(false);
  expect(textOf(nodeByTestID(tree, 'tesla-region-code'))).toBe('NA');
  expect(textOf(nodeByTestID(tree, 'tesla-region-fleet-url'))).toBe(
    'https://fleet-api.prd.na.vn.cloud.tesla.com',
  );
  const text = allText(tree);
  expect(text).toContain('Region');
  expect(text).toContain('Fleet API Base URL');
});

/* ── last-synced label ── */

test('shows the last-synced label when fetched_at is present', () => {
  const tree = render(<TeslaRegionPage />);
  expect(hasHost(tree, 'tesla-region-last-synced')).toBe(true);
  const label = textOf(nodeByTestID(tree, 'tesla-region-last-synced'));
  expect(label).toContain('Synced');
  // The formatted timestamp is rendered, never the "—" placeholder.
  expect(label).not.toContain('—');
});

/* ── empty state ── */

test('renders the Info empty state and hides the cards + last-synced when region data is absent', () => {
  mockRegion = {data: undefined};
  const tree = render(<TeslaRegionPage />);
  expect(hasHost(tree, 'tesla-region-empty')).toBe(true);
  expect(hasHost(tree, 'tesla-region-code')).toBe(false);
  expect(hasHost(tree, 'tesla-region-fleet-url')).toBe(false);
  expect(hasHost(tree, 'tesla-region-last-synced')).toBe(false);
  expect(allText(tree)).toContain(
    'No region data yet. Click Refresh to fetch from Tesla.',
  );
});

/* ── refresh mutation + toast callbacks ── */

test('refreshing fires the region-refresh mutation and the success/error toasts', () => {
  const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const tree = render(<TeslaRegionPage />);

  pressByTestID(tree, 'tesla-region-refresh');
  expect(mockRefreshMutate).toHaveBeenCalledTimes(1);
  expect(mockRefreshMutate.mock.calls[0][0]).toBeUndefined();

  const options = mockRefreshMutate.mock.calls[0][1] as {
    onSuccess: () => void;
    onError: (err: Error) => void;
  };
  expect(typeof options.onSuccess).toBe('function');
  expect(typeof options.onError).toBe('function');

  ReactTestRenderer.act(() => {
    options.onSuccess();
  });
  expect(alertSpy).toHaveBeenCalledWith('Region info refreshed', undefined);

  ReactTestRenderer.act(() => {
    options.onError(new Error('boom'));
  });
  expect(alertSpy).toHaveBeenCalledWith('Failed to refresh region', 'boom');
});

/* ── pending state ── */

test('disables the refresh button while the refresh mutation is pending', () => {
  mockRefreshPending = true;
  const tree = render(<TeslaRegionPage />);
  const button = nodeByTestID(tree, 'tesla-region-refresh');
  expect(button.props.accessibilityState).toEqual({disabled: true});
});
