import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

import {EventHistoryTable} from '../src/web-parity/features/admin/components/security-access/EventHistoryTable';
import type {SecurityEvent} from '../src/web-parity/api/hooks/useAdmin';

/**
 * Native parity contract for EventHistoryTable.
 *
 * The web component renders the admin "Security Event History" panel: a heading,
 * a Skeleton while loading, and otherwise a DataTable of SecurityEvent rows with
 * Time / Lock / Sentry / Doors / Windows columns. Lock is a success/danger Badge
 * (Locked/Unlocked), Sentry a success/neutral Badge driven by the raw truthiness
 * of `sentryMode` (On/Off), Doors green/amber DoorState text, and Windows a
 * green/amber "All Closed" / "N Open/Venting" summary. The native port keeps that
 * structure with inlined native-safe Badge/TimeStamp/DataTable substitutions.
 */

type Tree = ReactTestRenderer.ReactTestRenderer;

function render(node: React.ReactElement): Tree {
  let tree!: Tree;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(node);
  });
  return tree;
}

function json(tree: Tree): string {
  return JSON.stringify(tree.toJSON());
}

function makeEvent(overrides: Partial<SecurityEvent>): SecurityEvent {
  return {
    id: 'evt-1',
    locked: true,
    sentryMode: 'SentryModeStateOn',
    doorState: 'Closed',
    fdWindow: 'Closed',
    fpWindow: 'Closed',
    rdWindow: 'Closed',
    rpWindow: 'Closed',
    homelinkNearby: false,
    guestMode: false,
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
    createdAt: '2026-01-02T03:04:05.000Z',
    ...overrides,
  };
}

test('loading state renders the heading + a Skeleton and no data rows', () => {
  const tree = render(<EventHistoryTable history={[]} isLoading />);

  expect(json(tree)).toContain('Security Event History');
  expect(
    tree.root.findAll(n => n.props?.testID === 'skeleton').length,
  ).toBeGreaterThan(0);
  // The empty-table message must NOT appear while loading.
  expect(json(tree)).not.toContain('No security events recorded yet.');

  ReactTestRenderer.act(() => tree.unmount());
});

test('loaded with no events renders the empty message', () => {
  const tree = render(<EventHistoryTable history={[]} isLoading={false} />);

  expect(json(tree)).toContain('No security events recorded yet.');
  expect(tree.root.findAll(n => n.props?.testID === 'skeleton').length).toBe(0);

  ReactTestRenderer.act(() => tree.unmount());
});

test('a locked + sentry-on row renders Locked / On / Closed / All Closed', () => {
  const tree = render(
    <EventHistoryTable
      history={[makeEvent({id: 'a', locked: true})]}
      isLoading={false}
    />,
  );

  const body = json(tree);
  expect(body).toContain('Locked');
  expect(body).toContain('On');
  // DoorState string surfaces verbatim; all four windows closed -> summary.
  expect(body).toContain('Closed');
  expect(body).toContain('All Closed');

  ReactTestRenderer.act(() => tree.unmount());
});

test('an unlocked + sentry-off row with an open window renders Unlocked / Off / N Open/Venting', () => {
  const tree = render(
    <EventHistoryTable
      history={[
        makeEvent({
          id: 'b',
          locked: false,
          sentryMode: false,
          doorState: 'Open',
          fdWindow: 'Open',
        }),
      ]}
      isLoading={false}
    />,
  );

  const body = json(tree);
  expect(body).toContain('Unlocked');
  expect(body).toContain('Off');
  expect(body).toContain('Open');
  // Exactly one of the four windows is open.
  expect(body).toContain('1 Open/Venting');

  ReactTestRenderer.act(() => tree.unmount());
});

test('the column headers render for Time, Lock, Sentry, Doors, and Windows', () => {
  const tree = render(
    <EventHistoryTable history={[makeEvent({id: 'c'})]} isLoading={false} />,
  );

  const body = json(tree);
  expect(body).toContain('Time');
  expect(body).toContain('Lock');
  expect(body).toContain('Sentry');
  expect(body).toContain('Doors');
  expect(body).toContain('Windows');

  ReactTestRenderer.act(() => tree.unmount());
});

test('more than one page of events surfaces the Prev/Next pager', () => {
  const history = Array.from({length: 51}, (_, i) =>
    makeEvent({id: `evt-${i}`}),
  );
  const tree = render(
    <EventHistoryTable history={history} isLoading={false} />,
  );

  const body = json(tree);
  // pageSize is 50, so 51 events span two pages.
  expect(body).toContain('Page 1 of 2');
  expect(body).toContain('Prev');
  expect(body).toContain('Next');

  ReactTestRenderer.act(() => tree.unmount());
});
