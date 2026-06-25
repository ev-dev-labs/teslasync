import React from 'react';
import {Linking} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import {VersionSegment} from '../src/web-parity/components/layout/status-bar/VersionSegment';

/**
 * Native parity contract for VersionSegment.
 *
 * The web component is a footer status-bar segment: a Tag + version label (+ git
 * SHA) trigger wrapped in a hover Tooltip that opens an "About this build" Modal
 * with a provenance <dl>, an "update available" banner, and three actions
 * (What's new / Release notes / Close). It pulls /system/version and
 * /system/update-check via TanStack Query and folds in localStorage-backed
 * unseen-changelog state. The native port keeps the trigger + version
 * resolution, renders the panel as a RN <Modal>, routes the changelog open
 * through an onOpenChangelog callback, and opens the releases page via
 * Linking.openURL. These tests assert the behaviour the web suite would: the
 * version label + dev-SHA suppression, the unknown->dev fallback, iconOnly, the
 * update-available dot + banner, the provenance rows, and the three modal
 * actions.
 *
 * useQuery is mocked so the suite is deterministic and network-free; the two
 * queries are dispatched by their queryKey.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

const mockState: {versionInfo: unknown; updateCheck: unknown} = {
  versionInfo: undefined,
  updateCheck: undefined,
};

jest.mock('@tanstack/react-query', () => ({
  useQuery: ({queryKey}: {queryKey: unknown[]}) => {
    const key = Array.isArray(queryKey) ? queryKey[0] : queryKey;
    if (key === 'version-info') {
      return {data: mockState.versionInfo};
    }
    if (key === 'update-check') {
      return {data: mockState.updateCheck};
    }
    return {data: undefined};
  },
}));

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

// React Native yields a composite + host instance for a testID; grab the first.
function byTestId(tree: Tree, id: string) {
  return tree.root.findAllByProps({testID: id})[0];
}

function presentCount(tree: Tree, id: string): number {
  return tree.root.findAllByProps({testID: id}).length > 0 ? 1 : 0;
}

function press(tree: Tree, id: string): void {
  ReactTestRenderer.act(() => {
    byTestId(tree, id).props.onPress();
  });
}

function expanded(tree: Tree): boolean {
  return byTestId(tree, 'version-segment-trigger').props.accessibilityState.expanded;
}

function serialize(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  mockState.versionInfo = undefined;
  mockState.updateCheck = undefined;
});

afterEach(() => {
  jest.restoreAllMocks();
});

test('renders the version label from /system/version with no dots when up to date', () => {
  mockState.versionInfo = {app_version: '1.2.3', uptime_seconds: 0};
  const tree = render(<VersionSegment />);

  expect(presentCount(tree, 'version-segment-trigger')).toBe(1);
  expect(serialize(tree)).toContain('v1.2.3');
  // BUILD_SHA defaults to 'dev', so the "· {sha}" segment is suppressed.
  expect(serialize(tree)).not.toContain('\u00B7 dev');
  expect(presentCount(tree, 'version-segment-update-dot')).toBe(0);
  expect(presentCount(tree, 'version-segment-unseen-dot')).toBe(0);
  expect(expanded(tree)).toBe(false);

  ReactTestRenderer.act(() => tree.unmount());
});

test('falls back to the dev build version when app_version is "unknown"', () => {
  mockState.versionInfo = {app_version: 'unknown'};
  const tree = render(<VersionSegment />);

  expect(serialize(tree)).toContain('vdev');

  ReactTestRenderer.act(() => tree.unmount());
});

test('iconOnly hides the version text and renders just the tag glyph', () => {
  mockState.versionInfo = {app_version: '9.9.9'};

  // Sanity: the full (non-iconOnly) trigger renders the visible version label.
  const full = render(<VersionSegment />);
  expect(presentCount(full, 'version-segment-version-text')).toBe(1);
  ReactTestRenderer.act(() => full.unmount());

  const tree = render(<VersionSegment iconOnly />);
  expect(presentCount(tree, 'version-segment-trigger')).toBe(1);
  // The visible version label is hidden; the aria label still describes it.
  expect(presentCount(tree, 'version-segment-version-text')).toBe(0);
  expect(byTestId(tree, 'version-segment-trigger').props.accessibilityLabel).toBe(
    'TeslaSync version: v9.9.9',
  );

  ReactTestRenderer.act(() => tree.unmount());
});

test('shows the update dot and, in the modal, the update banner with latest + message', () => {
  mockState.versionInfo = {
    app_version: '1.2.3',
    go_version: 'go1.25',
    os: 'linux',
    arch: 'amd64',
    uptime_seconds: 90_061,
  };
  mockState.updateCheck = {
    current: '1.2.3',
    latest: '1.3.0',
    update_available: true,
    message: 'Upgrade soon',
  };
  const tree = render(<VersionSegment />);

  // Closed: the update dot is visible on the trigger.
  expect(presentCount(tree, 'version-segment-update-dot')).toBe(1);
  expect(expanded(tree)).toBe(false);

  press(tree, 'version-segment-trigger');
  expect(expanded(tree)).toBe(true);
  expect(presentCount(tree, 'version-segment-modal')).toBe(1);

  const serialized = serialize(tree);
  // Provenance rows.
  expect(serialized).toContain('App version');
  expect(serialized).toContain('v1.2.3');
  expect(serialized).toContain('go1.25');
  expect(serialized).toContain('linux/amd64');
  // uptimeLabel(90061) -> "1d 1h".
  expect(serialized).toContain('1d 1h');
  // Update banner. The title + ": v{latest}" render as adjacent text spans.
  expect(presentCount(tree, 'version-segment-update-banner')).toBe(1);
  expect(serialized).toContain('A newer release is available');
  expect(serialized).toContain(': v1.3.0');
  expect(serialized).toContain('Upgrade soon');

  ReactTestRenderer.act(() => tree.unmount());
});

test('"Release notes" opens the GitHub releases page via Linking', () => {
  const openURLSpy = jest
    .spyOn(Linking, 'openURL')
    .mockResolvedValue(true as unknown as void);
  mockState.versionInfo = {app_version: '1.2.3'};
  const tree = render(<VersionSegment />);

  press(tree, 'version-segment-trigger');
  press(tree, 'version-segment-release-notes');

  expect(openURLSpy).toHaveBeenCalledTimes(1);
  expect(openURLSpy).toHaveBeenCalledWith(
    'https://github.com/ev-dev-labs/teslasync/releases',
  );

  ReactTestRenderer.act(() => tree.unmount());
});

test('"What\'s new" fires onOpenChangelog and closes the modal', () => {
  const onOpenChangelog = jest.fn();
  mockState.versionInfo = {app_version: '1.2.3'};
  const tree = render(<VersionSegment onOpenChangelog={onOpenChangelog} />);

  press(tree, 'version-segment-trigger');
  expect(expanded(tree)).toBe(true);

  press(tree, 'version-segment-whats-new');

  expect(onOpenChangelog).toHaveBeenCalledTimes(1);
  expect(expanded(tree)).toBe(false);

  ReactTestRenderer.act(() => tree.unmount());
});

test('the modal close button and primary Close action both dismiss the modal', () => {
  mockState.versionInfo = {app_version: '1.2.3'};
  const tree = render(<VersionSegment />);

  // Header close (✕).
  press(tree, 'version-segment-trigger');
  expect(expanded(tree)).toBe(true);
  press(tree, 'version-segment-modal-close');
  expect(expanded(tree)).toBe(false);

  // Footer primary Close button.
  press(tree, 'version-segment-trigger');
  expect(expanded(tree)).toBe(true);
  press(tree, 'version-segment-close');
  expect(expanded(tree)).toBe(false);

  ReactTestRenderer.act(() => tree.unmount());
});
