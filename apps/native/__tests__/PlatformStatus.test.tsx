import React, { useEffect } from 'react';
import {
  AppState,
  Linking,
  type AppStateStatus,
  type EmitterSubscription,
} from 'react-native';
import ReactTestRenderer from 'react-test-renderer';

import { parseDeepLink } from '../src/platform/deepLinks';
import {
  buildPlatformIntegrationStatus,
  getPlatformCapabilities,
  getPlatformLaunchActions,
  usePlatformIntegrationStatus,
  type PlatformIntegrationStatus,
} from '../src/platform/status';

function latestStatus(
  statuses: readonly PlatformIntegrationStatus[],
): PlatformIntegrationStatus {
  const status = statuses[statuses.length - 1];
  if (!status) {
    throw new Error('No platform status was observed.');
  }
  return status;
}

function StatusHarness({
  onStatus,
}: {
  onStatus: (status: PlatformIntegrationStatus) => void;
}) {
  const status = usePlatformIntegrationStatus();

  useEffect(() => {
    onStatus(status);
  }, [onStatus, status]);

  return null;
}

function mockSubscription(remove: () => void): EmitterSubscription {
  const subscription = {
    context: undefined,
    emitter: undefined,
    eventType: 'test',
    key: 0,
    listener: undefined,
    remove,
    subscriber: undefined,
  };

  return subscription as unknown as EmitterSubscription;
}

describe('platform integration status', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('reports configured, available, and unavailable capabilities honestly by platform', () => {
    const androidCapabilities = getPlatformCapabilities('android');
    const macosCapabilities = getPlatformCapabilities('macos');
    const androidDeepLinks = androidCapabilities.find(
      capability => capability.id === 'deep-links',
    );
    const androidPush = androidCapabilities.find(
      capability => capability.id === 'push-registration',
    );
    const lifecycle = androidCapabilities.find(
      capability => capability.id === 'lifecycle',
    );

    expect(androidDeepLinks).toEqual(
      expect.objectContaining({
        state: 'configured',
      }),
    );
    expect(androidDeepLinks?.evidence).toContain('AndroidManifest.xml');
    expect(lifecycle).toEqual(
      expect.objectContaining({
        state: 'available',
      }),
    );
    expect(androidPush).toEqual(
      expect.objectContaining({
        state: 'unavailable',
      }),
    );
    expect(androidPush?.detail).toContain('no push delivery success is claimed');
    expect(
      macosCapabilities.find(capability => capability.id === 'deep-links'),
    ).toEqual(
      expect.objectContaining({
        state: 'unavailable',
      }),
    );
  });

  test('builds launch actions as unavailable deep-link handoffs', () => {
    const actions = getPlatformLaunchActions('windows');
    const inboxAction = actions.find(
      action => action.id === 'notifications-inbox',
    );

    expect(inboxAction).toEqual(
      expect.objectContaining({
        routeId: 'alerts',
        sourcePath: 'notifications/inbox',
        deepLinkURL: 'teslasync://notifications/inbox',
        state: 'unavailable',
      }),
    );
    expect(inboxAction?.detail).toContain('taskbar jump list');
    expect(inboxAction?.evidence).toContain('no OS shortcut installer');
  });

  test('builds a lifecycle status snapshot with parsed deep-link context', () => {
    const initialDeepLink = parseDeepLink('teslasync:///account/sessions');
    const lastDeepLink = parseDeepLink(
      'teslasync://notifications/inbox?notification_id=21',
    );
    const status = buildPlatformIntegrationStatus(
      'background',
      initialDeepLink,
      lastDeepLink,
      'activation failed',
    );

    expect(status).toEqual(
      expect.objectContaining({
        appState: 'background',
        initialDeepLink,
        lastDeepLink,
        deepLinkError: 'activation failed',
      }),
    );
    expect(status.initialDeepLink?.routeId).toBe('auth');
    expect(status.lastDeepLink?.routeId).toBe('alerts');
    expect(status.capabilities.length).toBeGreaterThan(0);
    expect(status.launchActions.length).toBeGreaterThan(0);
    expect(Number.isNaN(new Date(status.lifecycleObservedAt).getTime())).toBe(
      false,
    );
  });

  test('observes initial URLs, URL events, app-state changes, and cleanup', async () => {
    const removeLinkListener = jest.fn();
    const removeAppStateListener = jest.fn();
    let linkListener: ((event: { url: string }) => void) | undefined;
    let appStateListener: ((state: AppStateStatus) => void) | undefined;
    const linkSubscription = mockSubscription(removeLinkListener);
    const appStateSubscription = mockSubscription(removeAppStateListener);
    const observed: PlatformIntegrationStatus[] = [];
    const recordStatus = (status: PlatformIntegrationStatus) => {
      observed.push(status);
    };

    jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('teslasync://notifications/inbox?from=start');
    jest
      .spyOn(Linking, 'addEventListener')
      .mockImplementation((_event, listener) => {
        linkListener = listener as typeof linkListener;
        return linkSubscription;
      });
    jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((_event, listener) => {
        appStateListener = listener as typeof appStateListener;
        return appStateSubscription;
      });

    let tree: ReactTestRenderer.ReactTestRenderer | undefined;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(
        <StatusHarness onStatus={recordStatus} />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(latestStatus(observed).initialDeepLink?.routeId).toBe('alerts');

    await ReactTestRenderer.act(async () => {
      appStateListener?.('background');
    });
    expect(latestStatus(observed).appState).toBe('background');

    await ReactTestRenderer.act(async () => {
      linkListener?.({ url: 'teslasync://settings' });
    });
    expect(latestStatus(observed).lastDeepLink?.routeId).toBe('settings');

    ReactTestRenderer.act(() => {
      tree?.unmount();
    });
    expect(removeLinkListener).toHaveBeenCalledTimes(1);
    expect(removeAppStateListener).toHaveBeenCalledTimes(1);
  });
});
