import {
  DEFAULT_NOTIFICATION_BADGE,
  DEFAULT_NOTIFICATION_CLICK_URL,
  DEFAULT_NOTIFICATION_TITLE,
  FALLBACK_NOTIFICATION_CLICK_URL,
  NAVIGATION_CACHE,
  RUNTIME_CACHE_ROUTES,
  SW_UNAVAILABLE_REASON,
  buildNotification,
  buildPushNotification,
  getServiceWorkerRuntimeStatus,
  handleServiceWorkerMessage,
  isGoogleFontsStylesheet,
  isGoogleFontsWebfont,
  isMapTile,
  parsePushPayload,
  registerTeslaSyncServiceWorker,
  resolveNotificationClickUrl,
} from '../src/web-parity/sw/sw';
import type {
  PushMessageDataLike,
  UrlLike,
} from '../src/web-parity/sw/sw';

function messageData(value: unknown, text = ''): PushMessageDataLike {
  return {
    json: () => value,
    text: () => text,
  };
}

function throwingData(text: string): PushMessageDataLike {
  return {
    json: () => {
      throw new Error('not json');
    },
    text: () => text,
  };
}

function url(parts: Partial<UrlLike>): UrlLike {
  return {origin: '', host: '', pathname: '', ...parts};
}

describe('native service-worker parity — notification builder', () => {
  test('pins source defaults and never sets icon for a typical info payload', () => {
    const {title, options} = buildNotification({
      title: 'Drive Started',
      body: 'Roadster is moving',
      url: '/drives/42',
      tag: 'drive-42',
      severity: 'info',
    });

    expect(title).toBe('Drive Started');
    expect(options.body).toBe('Roadster is moving');
    expect(options.badge).toBe(DEFAULT_NOTIFICATION_BADGE);
    expect(options.tag).toBe('drive-42');
    expect(options.data).toEqual({url: '/drives/42'});
    expect(options.requireInteraction).toBe(false);
    // Duplicate-icon regression contract: the builder must never populate icon.
    expect(Object.keys(options)).not.toContain('icon');
  });

  test('falls back to TeslaSync title, empty body, default badge and click url', () => {
    const {title, options} = buildNotification({});

    expect(title).toBe(DEFAULT_NOTIFICATION_TITLE);
    expect(options.body).toBe('');
    expect(options.badge).toBe(DEFAULT_NOTIFICATION_BADGE);
    expect(options.tag).toBeUndefined();
    expect(options.data).toEqual({url: DEFAULT_NOTIFICATION_CLICK_URL});
    expect(options.requireInteraction).toBe(false);
  });

  test('critical severity requires interaction; warn does not', () => {
    expect(
      buildNotification({severity: 'critical'}).options.requireInteraction,
    ).toBe(true);
    expect(
      buildNotification({severity: 'warn'}).options.requireInteraction,
    ).toBe(false);
  });

  test('respects an explicit badge override', () => {
    expect(
      buildNotification({badge: '/icons/badge-alt.png'}).options.badge,
    ).toBe('/icons/badge-alt.png');
  });
});

describe('native service-worker parity — push payload parsing', () => {
  test('uses the JSON body when present', () => {
    expect(parsePushPayload(messageData({title: 'Hi', body: 'There'}))).toEqual(
      {title: 'Hi', body: 'There'},
    );
  });

  test('collapses a null JSON body to an empty payload', () => {
    expect(parsePushPayload(messageData(null))).toEqual({});
  });

  test('falls back to the raw text body when JSON parsing throws', () => {
    expect(parsePushPayload(throwingData('wake up'))).toEqual({body: 'wake up'});
  });

  test('treats a payload-less push (no data) as an empty payload', () => {
    expect(parsePushPayload(null)).toEqual({});
    expect(parsePushPayload(undefined)).toEqual({});
  });

  test('buildPushNotification parses then builds end-to-end', () => {
    const {title, options} = buildPushNotification(
      messageData({title: 'Critical alert', severity: 'critical'}),
    );

    expect(title).toBe('Critical alert');
    expect(options.requireInteraction).toBe(true);
    expect(options.badge).toBe(DEFAULT_NOTIFICATION_BADGE);
    expect(Object.keys(options)).not.toContain('icon');
  });
});

describe('native service-worker parity — notification click url', () => {
  test('returns the stored url', () => {
    expect(resolveNotificationClickUrl({url: '/drives/7'})).toBe('/drives/7');
  });

  test('falls back to root when no url is present', () => {
    expect(resolveNotificationClickUrl({})).toBe(FALLBACK_NOTIFICATION_CLICK_URL);
    expect(resolveNotificationClickUrl(null)).toBe('/');
    expect(resolveNotificationClickUrl(undefined)).toBe('/');
  });
});

describe('native service-worker parity — runtime cache matchers', () => {
  test('matches Google Fonts stylesheet and webfont origins', () => {
    expect(
      isGoogleFontsStylesheet(url({origin: 'https://fonts.googleapis.com'})),
    ).toBe(true);
    expect(
      isGoogleFontsStylesheet(url({origin: 'https://fonts.gstatic.com'})),
    ).toBe(false);
    expect(
      isGoogleFontsWebfont(url({origin: 'https://fonts.gstatic.com'})),
    ).toBe(true);
  });

  test('matches map tiles by host or by /tiles?/ pathname', () => {
    expect(isMapTile(url({host: 'a.tile.openstreetmap.org'}))).toBe(true);
    expect(isMapTile(url({pathname: '/styles/v1/tiles/3/4/5'}))).toBe(true);
    expect(isMapTile(url({pathname: '/api/v1/tile/3/4/5'}))).toBe(true);
    expect(
      isMapTile(url({host: 'example.com', pathname: '/static/logo.png'})),
    ).toBe(false);
  });
});

describe('native service-worker parity — cache configuration parity', () => {
  test('navigation cache mirrors the NetworkFirst route', () => {
    expect(NAVIGATION_CACHE).toEqual({
      cacheName: 'navigations',
      strategy: 'NetworkFirst',
      networkTimeoutSeconds: 3,
      cacheableStatuses: [200],
      maxEntries: 10,
      maxAgeSeconds: 60 * 60 * 24 * 7,
    });
  });

  test('runtime cache routes preserve names, caps and TTLs in order', () => {
    expect(RUNTIME_CACHE_ROUTES.map(r => r.cacheName)).toEqual([
      'google-fonts-stylesheets',
      'google-fonts-webfonts',
      'map-tiles',
    ]);
    const tiles = RUNTIME_CACHE_ROUTES[2];
    expect(tiles.maxEntries).toBe(500);
    expect(tiles.maxAgeSeconds).toBe(60 * 60 * 24 * 30);
    expect(tiles.cacheableStatuses).toEqual([0, 200]);
    // The stylesheets bucket had no CacheableResponsePlugin in the source.
    expect(RUNTIME_CACHE_ROUTES[0].cacheableStatuses).toBeUndefined();
  });
});

describe('native service-worker parity — explicit unavailable runtime', () => {
  test('runtime status is unavailable with a documented reason', () => {
    const status = getServiceWorkerRuntimeStatus();
    expect(status.available).toBe(false);
    expect(status.reason).toBe(SW_UNAVAILABLE_REASON);
    expect(registerTeslaSyncServiceWorker().available).toBe(false);
  });

  test('SKIP_WAITING message reports unavailable; other messages are ignored', () => {
    expect(handleServiceWorkerMessage({type: 'SKIP_WAITING'})?.available).toBe(
      false,
    );
    expect(handleServiceWorkerMessage({type: 'OTHER'})).toBeNull();
    expect(handleServiceWorkerMessage(null)).toBeNull();
  });
});
