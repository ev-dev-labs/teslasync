import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {
  TourLauncher,
  dispatchTourLauncherOpen,
  hasSeenTourList,
  isTourCompleted,
  listTours,
  markTourCompleted,
  resetAllTours,
  subscribeTourEvent,
  TOUR_START_EVENT,
} from '../src/web-parity/features/onboarding/TourLauncher';

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

function serialize(tree: ReactTestRenderer.ReactTestRenderer | undefined): string {
  return flattenText(tree?.toJSON() as JsonNode);
}

function pressByTestId(
  tree: ReactTestRenderer.ReactTestRenderer | undefined,
  testID: string,
) {
  const node = tree?.root
    .findAllByProps({testID})
    .find(candidate => typeof candidate.props.onPress === 'function');
  expect(node).toBeDefined();
  node?.props.onPress();
}

beforeEach(() => {
  resetAllTours();
});

test('the registry mirror lists all eight tours in display order', () => {
  expect(listTours().map(d => d.id)).toEqual([
    'main',
    'vehicles',
    'drives',
    'charging',
    'alerts',
    'automations',
    'settings',
    'debugger',
  ]);
});

test('stays closed until the global launcher event, then renders every section', async () => {
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<TourLauncher pageRoute="/charging" />);
  });

  // The self-opening modal starts closed (visible={false} -> renders null).
  expect(serialize(tree)).not.toContain('Take a tour');
  expect(hasSeenTourList()).toBe(false);

  // Any caller can pop it open via the global event (palette / help button).
  await ReactTestRenderer.act(async () => {
    dispatchTourLauncherOpen();
  });

  const serialized = serialize(tree);

  expect(serialized).toContain('Take a tour');
  expect(serialized).toContain(
    'Bite-sized walkthroughs of each area. Replay any tour anytime.',
  );
  // Every tour row.
  expect(serialized).toContain('Welcome to TeslaSync');
  expect(serialized).toContain('Vehicles & sharing');
  expect(serialized).toContain('Drives & replay');
  expect(serialized).toContain('Charging & cost analysis');
  expect(serialized).toContain('Alerts & Alert Studio');
  expect(serialized).toContain('Automations');
  expect(serialized).toContain('Settings');
  expect(serialized).toContain('State machine debugger');
  // Footer controls.
  expect(serialized).toContain('Reset all tours');
  expect(serialized).toContain('Close');
  // Fresh tours show Start, none are marked Completed yet.
  expect(serialized).toContain('Start');
  expect(serialized).not.toContain('Completed');
  // The charging route surfaces exactly the charging tour as recommended.
  expect(serialized).toContain('Recommended for this page');

  // Opening records the launcher-seen marker (parity with markTourListSeen()).
  expect(hasSeenTourList()).toBe(true);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('a completed tour renders the Completed badge + Replay control', async () => {
  // main tour is version 2 in the registry.
  markTourCompleted('main', 2);
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<TourLauncher pageRoute="/" />);
  });
  await ReactTestRenderer.act(async () => {
    dispatchTourLauncherOpen();
  });

  const serialized = serialize(tree);
  expect(serialized).toContain('Completed');
  expect(serialized).toContain('Replay');
  // Other tours remain startable.
  expect(serialized).toContain('Start');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('starting a tour dispatches TOUR_START with its id and closes the launcher', async () => {
  const startSpy = jest.fn();
  const unsubscribe = subscribeTourEvent(TOUR_START_EVENT, startSpy);
  let tree: ReactTestRenderer.ReactTestRenderer | undefined;

  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<TourLauncher pageRoute="/" />);
  });
  await ReactTestRenderer.act(async () => {
    dispatchTourLauncherOpen();
  });

  jest.useFakeTimers();
  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'tour-launch-main');
  });
  // The dispatch is deferred one tick (setTimeout 0) so the close settles first.
  await ReactTestRenderer.act(async () => {
    jest.runOnlyPendingTimers();
  });
  jest.useRealTimers();
  unsubscribe();

  expect(startSpy).toHaveBeenCalledTimes(1);
  expect(startSpy).toHaveBeenCalledWith({id: 'main'});
  // The launcher closed itself before dispatching.
  expect(serialize(tree)).not.toContain('Take a tour');

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});

test('Reset all tours clears every stored completion flag', async () => {
  markTourCompleted('main', 2);
  markTourCompleted('drives', 1);
  expect(isTourCompleted('main', 2)).toBe(true);
  expect(isTourCompleted('drives', 1)).toBe(true);

  let tree: ReactTestRenderer.ReactTestRenderer | undefined;
  await ReactTestRenderer.act(async () => {
    tree = ReactTestRenderer.create(<TourLauncher pageRoute="/" />);
  });
  await ReactTestRenderer.act(async () => {
    dispatchTourLauncherOpen();
  });
  await ReactTestRenderer.act(async () => {
    pressByTestId(tree, 'tour-reset-all');
  });

  expect(isTourCompleted('main', 2)).toBe(false);
  expect(isTourCompleted('drives', 1)).toBe(false);

  await ReactTestRenderer.act(async () => {
    tree?.unmount();
  });
});
