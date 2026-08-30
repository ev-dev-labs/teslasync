import { describe, expect, it } from 'vitest';
import {
  consumeTripSharePayload,
  createStoredTripSharePayload,
  parseTripShareDestination,
  storeTripSharePayload,
} from './tripShareTarget';

function createMemoryCacheStorage(): CacheStorage {
  const buckets = new Map<string, Map<string, Response>>();
  const keyOf = (request: RequestInfo | URL) =>
    typeof request === 'string' ? request : request instanceof URL ? request.href : request.url;

  return {
    async delete(name) {
      return buckets.delete(name);
    },
    async has(name) {
      return buckets.has(name);
    },
    async keys() {
      return [...buckets.keys()];
    },
    async match(request, options) {
      for (const cache of buckets.values()) {
        const response = await cacheFor(cache).match(request, options);
        if (response) return response;
      }
      return undefined;
    },
    async open(name) {
      let bucket = buckets.get(name);
      if (!bucket) {
        bucket = new Map();
        buckets.set(name, bucket);
      }
      return cacheFor(bucket);
    },
  };

  function cacheFor(entries: Map<string, Response>): Cache {
    return {
      async add() {
        throw new Error('not implemented');
      },
      async addAll() {
        throw new Error('not implemented');
      },
      async delete(request) {
        return entries.delete(keyOf(request));
      },
      async keys() {
        return [...entries.keys()].map((url) => new Request(url, { method: 'GET' }));
      },
      async match(request) {
        return entries.get(keyOf(request))?.clone();
      },
      async matchAll(request) {
        if (!request) return [...entries.values()].map((response) => response.clone());
        const response = entries.get(keyOf(request));
        return response ? [response.clone()] : [];
      },
      async put(request, response) {
        entries.set(keyOf(request), response.clone());
      },
    };
  }
}

describe('trip share target parsing', () => {
  it('extracts coordinates from common map query parameters', () => {
    const payload = createStoredTripSharePayload({
      title: 'Service Center',
      url: 'https://www.google.com/maps/search/?api=1&query=37.3947%2C-122.1503',
    }, 100);

    expect(payload).not.toBeNull();
    expect(parseTripShareDestination(payload!)).toEqual({
      text: 'Service Center',
      location: {
        lat: 37.3947,
        lng: -122.1503,
        name: 'Service Center',
      },
    });
  });

  it('extracts coordinates from map path markers and preserves a shared label', () => {
    const payload = createStoredTripSharePayload({
      text: 'Tesla Fremont Factory https://maps.google.com/maps/@37.4947,-121.9448,14z',
      url: 'https://maps.google.com/maps/@37.4947,-121.9448,14z',
    }, 100);

    expect(parseTripShareDestination(payload!)).toEqual({
      text: 'Tesla Fremont Factory',
      location: {
        lat: 37.4947,
        lng: -121.9448,
        name: 'Tesla Fremont Factory',
      },
    });
  });

  it('returns a text-only destination when coordinates are unavailable', () => {
    const payload = createStoredTripSharePayload({
      text: '  Tesla   Fremont\nFactory  ',
      url: 'https://maps.app.goo.gl/example',
    }, 100);

    expect(parseTripShareDestination(payload!)).toEqual({
      text: 'Tesla Fremont Factory',
      location: null,
    });
  });

  it('rejects out-of-range coordinate pairs instead of importing them', () => {
    const payload = createStoredTripSharePayload({
      text: 'Impossible 120.1, -200.2',
    }, 100);

    expect(parseTripShareDestination(payload!)).toEqual({
      text: 'Impossible 120.1, -200.2',
      location: null,
    });
  });

  it('bounds and sanitizes data before writing it to Cache Storage', () => {
    const payload = createStoredTripSharePayload({
      title: `\u0000  ${'x'.repeat(300)}`,
      text: '',
      url: '',
    }, 100);

    expect(payload?.title).toHaveLength(240);
    expect(payload?.title).not.toContain('\u0000');
    expect(createStoredTripSharePayload({}, 100)).toBeNull();
  });

  it('consumes a cached destination once', async () => {
    const storage = createMemoryCacheStorage();
    const payload = createStoredTripSharePayload({ text: 'Service Center' }, 100);
    expect(payload).not.toBeNull();

    await storeTripSharePayload(storage, payload!);

    await expect(consumeTripSharePayload(storage, 200)).resolves.toEqual(payload);
    await expect(consumeTripSharePayload(storage, 200)).resolves.toBeNull();
  });

  it('deletes and rejects expired cached destinations', async () => {
    const storage = createMemoryCacheStorage();
    const payload = createStoredTripSharePayload({ text: 'Service Center' }, 100);
    expect(payload).not.toBeNull();

    await storeTripSharePayload(storage, payload!);

    await expect(consumeTripSharePayload(storage, 10 * 60 * 1000 + 101)).rejects.toThrow(
      'stored trip share payload has expired',
    );
    await expect(consumeTripSharePayload(storage, 200)).resolves.toBeNull();
  });
});
