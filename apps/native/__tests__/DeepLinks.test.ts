import {
  parseDeepLink,
  pathFromDeepLinkURL,
  queryParamsFromDeepLinkURL,
} from '../src/platform/deepLinks';

describe('native deep-link route parsing', () => {
  test('normalizes custom scheme, HTTPS, and path-only URLs', () => {
    expect(pathFromDeepLinkURL('teslasync://notifications/inbox')).toBe(
      'notifications/inbox',
    );
    expect(
      pathFromDeepLinkURL('teslasync:///vehicles/42/access?from=push'),
    ).toBe('vehicles/42/access');
    expect(pathFromDeepLinkURL('https://teslasync.example.test/settings')).toBe(
      'settings',
    );
    expect(pathFromDeepLinkURL('/')).toBe('/');
  });

  test('maps notification links to the alerts native target', () => {
    const parsed = parseDeepLink(
      'teslasync://notifications/inbox?notification_id=21&from=push',
    );

    expect(parsed).toEqual(
      expect.objectContaining({
        matched: true,
        sourcePath: 'notifications/inbox',
        webPath: '/notifications/inbox',
        routeId: 'alerts',
        label: 'Notifications Inbox',
        implementationStatus: 'implemented',
        queryParams: {
          notification_id: '21',
          from: 'push',
        },
      }),
    );
  });

  test('extracts query params separately from route params for push handoffs', () => {
    expect(
      queryParamsFromDeepLinkURL(
        'teslasync://vehicles/42/access?notification_id=21&from=push#details',
      ),
    ).toEqual({
      notification_id: '21',
      from: 'push',
    });
  });

  test('extracts dynamic route params while preserving implemented parity status', () => {
    const parsed = parseDeepLink('teslasync://vehicles/42/access');

    expect(parsed.matched).toBe(true);
    expect(parsed.routeId).toBe('vehicles');
    expect(parsed.params).toEqual({ id: '42' });
    expect(parsed.implementationStatus).toBe('implemented');
    expect(parsed.reason).toMatch(/^Implemented:/);
  });

  test('maps shared-drive token links to implemented native driving parity', () => {
    const parsed = parseDeepLink('teslasync://s/public-drive-token');

    expect(parsed).toEqual(
      expect.objectContaining({
        matched: true,
        sourcePath: 's/public-drive-token',
        webPath: '/s/:token',
        routeId: 'driving',
        label: 'Shared Drive',
        implementationStatus: 'implemented',
        params: { token: 'public-drive-token' },
      }),
    );
    expect(parsed.reason).toMatch(/^Implemented:/);
  });

  test('returns unmatched status for unknown paths instead of redirecting silently', () => {
    const parsed = parseDeepLink('teslasync://not-a-route');

    expect(parsed.matched).toBe(false);
    expect(parsed.routeId).toBeNull();
    expect(parsed.implementationStatus).toBe('unmatched');
    expect(parsed.reason).toContain('No route manifest entry');
  });
});
