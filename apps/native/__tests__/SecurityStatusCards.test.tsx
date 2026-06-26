import React from 'react';
import ReactTestRenderer, {type ReactTestInstance} from 'react-test-renderer';

import {
  SecurityStatusCards,
  type SecurityEvent,
} from '../src/web-parity/features/admin/components/security-access/SecurityStatusCards';

type Renderer = ReactTestRenderer.ReactTestRenderer;

function render(element: React.ReactElement): Renderer {
  let tree: Renderer | undefined;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(element);
  });
  return tree!;
}

async function flush(): Promise<void> {
  await ReactTestRenderer.act(async () => {});
}

function unmount(tree: Renderer): void {
  ReactTestRenderer.act(() => {
    tree.unmount();
  });
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

function valueText(tree: Renderer, key: string): string {
  const node = tree.root.find(
    (n: ReactTestInstance) =>
      typeof n.type === 'string' &&
      n.props.testID === `security-status-card-${key}-value`,
  );
  return node.props.children as string;
}

function makeEvent(overrides: Partial<SecurityEvent> = {}): SecurityEvent {
  return {
    id: 'evt-1',
    locked: null,
    sentryMode: null,
    doorState: null,
    fdWindow: null,
    fpWindow: null,
    rdWindow: null,
    rpWindow: null,
    homelinkNearby: null,
    guestMode: null,
    homelinkDeviceCount: null,
    guestModeMobileAccessState: null,
    driverSeatOccupied: null,
    centerDisplay: null,
    speedLimitMode: null,
    valetModeEnabled: null,
    serviceMode: null,
    pairedPhoneKeyCount: null,
    lightsHazardsActive: null,
    lightsHighBeams: null,
    lightsTurnSignal: null,
    driverSeatBelt: null,
    passengerSeatBelt: null,
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const CARD_KEYS = ['lock', 'sentry', 'doors', 'windows', 'homelink', 'guest'];

/* ── loading ── */

test('isLoading renders the six skeleton placeholders and no cards', async () => {
  const tree = render(<SecurityStatusCards isLoading latest={undefined} />);
  await flush();

  expect(hasHost(tree, 'security-status-cards-skeleton')).toBe(true);
  expect(countHostPrefix(tree, 'security-status-card-skeleton-')).toBe(6);
  expect(hasHost(tree, 'security-status-cards')).toBe(false);

  unmount(tree);
});

/* ── render: every card present ── */

test('renders all six security cards once loaded', async () => {
  const tree = render(
    <SecurityStatusCards isLoading={false} latest={makeEvent()} />,
  );
  await flush();

  expect(hasHost(tree, 'security-status-cards')).toBe(true);
  for (const key of CARD_KEYS) {
    expect(hasHost(tree, `security-status-card-${key}`)).toBe(true);
  }

  unmount(tree);
});

/* ── secure event -> positive values ── */

test('a fully-secure event maps to the locked/active/closed/nearby values', async () => {
  const tree = render(
    <SecurityStatusCards
      isLoading={false}
      latest={makeEvent({
        locked: true,
        sentryMode: 'SentryModeStateArmed',
        doorState: 'Closed',
        fdWindow: 'Closed',
        fpWindow: 'Closed',
        rdWindow: 'Closed',
        rpWindow: 'Closed',
        homelinkNearby: true,
        guestMode: false,
      })}
    />,
  );
  await flush();

  expect(valueText(tree, 'lock')).toBe('Locked');
  expect(valueText(tree, 'sentry')).toBe('Active');
  expect(valueText(tree, 'doors')).toBe('Closed');
  expect(valueText(tree, 'windows')).toBe('All Closed');
  expect(valueText(tree, 'homelink')).toBe('Nearby');
  expect(valueText(tree, 'guest')).toBe('Disabled');

  unmount(tree);
});

/* ── unlocked / inactive / away ── */

test('an unlocked event maps to the unlocked/inactive/away values', async () => {
  const tree = render(
    <SecurityStatusCards
      isLoading={false}
      latest={makeEvent({
        locked: false,
        sentryMode: false,
        homelinkNearby: false,
        guestMode: true,
      })}
    />,
  );
  await flush();

  expect(valueText(tree, 'lock')).toBe('Unlocked');
  expect(valueText(tree, 'sentry')).toBe('Inactive');
  expect(valueText(tree, 'homelink')).toBe('Away');
  expect(valueText(tree, 'guest')).toBe('Enabled');

  unmount(tree);
});

/* ── door-state raw-string passthrough (non-closed string) ── */

test('an open door surfaces the raw doorState string', async () => {
  const tree = render(
    <SecurityStatusCards
      isLoading={false}
      latest={makeEvent({doorState: 'DriverFront'})}
    />,
  );
  await flush();

  // doorClosed('DriverFront') === false -> asNonEmptyString passthrough.
  expect(valueText(tree, 'doors')).toBe('DriverFront');

  unmount(tree);
});

/* ── window summary open/venting count ── */

test('partly-open windows surface the open/venting count summary', async () => {
  const tree = render(
    <SecurityStatusCards
      isLoading={false}
      latest={makeEvent({
        fdWindow: 'Open',
        fpWindow: 'Vent',
        rdWindow: 'Closed',
        rpWindow: 'Closed',
      })}
    />,
  );
  await flush();

  expect(valueText(tree, 'windows')).toBe('2 Open/Venting');

  unmount(tree);
});

/* ── undefined latest -> safe defaults ── */

test('an undefined latest renders safe default values', async () => {
  const tree = render(
    <SecurityStatusCards isLoading={false} latest={undefined} />,
  );
  await flush();

  expect(valueText(tree, 'lock')).toBe('Unlocked');
  expect(valueText(tree, 'sentry')).toBe('Inactive');
  expect(valueText(tree, 'doors')).toBe('Closed');
  expect(valueText(tree, 'windows')).toBe('—');
  expect(valueText(tree, 'homelink')).toBe('Away');
  expect(valueText(tree, 'guest')).toBe('Disabled');

  unmount(tree);
});
