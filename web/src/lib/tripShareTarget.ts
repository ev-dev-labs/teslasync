import { cacheName } from '../sw/buildContract';
import type { TripLocation } from '../types/driving';

export const TRIP_SHARE_TARGET_PATH = '/share-target';
export const TRIP_SHARE_DESTINATION_PATH = '/trip-planner';
export const TRIP_SHARE_CACHE_URL = '/__teslasync__/trip-share-target';

const TRIP_SHARE_MAX_AGE_MS = 10 * 60 * 1000;
const MAX_TITLE_LENGTH = 240;
const MAX_TEXT_LENGTH = 2_000;
const MAX_URL_LENGTH = 2_048;
const COORDINATE_PAIR =
  /(?:^|[^\d.-])(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)(?:$|[^\d.])/;

export interface StoredTripSharePayload {
  version: 1;
  title: string;
  text: string;
  url: string;
  captured_at: number;
}

export interface ParsedTripShareDestination {
  text: string;
  location: TripLocation | null;
}

function normalizeField(value: unknown, maxLength: number): string {
  if (typeof value !== 'string') return '';
  let sanitized = '';
  for (const character of value) {
    const code = character.charCodeAt(0);
    const isUnsafeControl =
      code <= 8
      || code === 11
      || code === 12
      || (code >= 14 && code <= 31)
      || (code >= 127 && code <= 159);
    if (!isUnsafeControl) sanitized += character;
  }
  return sanitized.replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

export function createStoredTripSharePayload(
  fields: { title?: unknown; text?: unknown; url?: unknown },
  capturedAt = Date.now(),
): StoredTripSharePayload | null {
  const payload: StoredTripSharePayload = {
    version: 1,
    title: normalizeField(fields.title, MAX_TITLE_LENGTH),
    text: normalizeField(fields.text, MAX_TEXT_LENGTH),
    url: normalizeField(fields.url, MAX_URL_LENGTH),
    captured_at: capturedAt,
  };

  return payload.title || payload.text || payload.url ? payload : null;
}

function isStoredTripSharePayload(value: unknown): value is StoredTripSharePayload {
  if (value == null || typeof value !== 'object') return false;
  const candidate = value as Partial<StoredTripSharePayload>;
  return (
    candidate.version === 1
    && typeof candidate.title === 'string'
    && typeof candidate.text === 'string'
    && typeof candidate.url === 'string'
    && typeof candidate.captured_at === 'number'
    && Number.isFinite(candidate.captured_at)
  );
}

function validLocation(lat: number, lng: number, name: string): TripLocation | null {
  if (
    !Number.isFinite(lat)
    || !Number.isFinite(lng)
    || lat < -90
    || lat > 90
    || lng < -180
    || lng > 180
  ) {
    return null;
  }
  return { lat, lng, name };
}

function parseCoordinatePair(value: string, name: string): TripLocation | null {
  const match = COORDINATE_PAIR.exec(` ${value} `);
  if (!match) return null;
  return validLocation(Number(match[1]), Number(match[2]), name);
}

function parseURLDetails(value: string): {
  location: TripLocation | null;
  label: string;
} {
  if (!value) return { location: null, label: '' };

  if (value.toLowerCase().startsWith('geo:')) {
    const coordinateText = value.slice(4).split(/[?;]/, 1)[0] ?? '';
    return {
      location: parseCoordinatePair(coordinateText, coordinateText),
      label: '',
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { location: null, label: '' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { location: null, label: '' };
  }

  const queryCandidates = ['query', 'q', 'll', 'daddr', 'destination']
    .map((key) => normalizeField(parsed.searchParams.get(key), MAX_TEXT_LENGTH))
    .filter(Boolean);
  const label = queryCandidates.find(
    (candidate) => parseCoordinatePair(candidate, candidate) == null,
  ) ?? '';

  for (const candidate of queryCandidates) {
    const location = parseCoordinatePair(candidate, label || candidate);
    if (location) return { location, label };
  }

  const pathMatch = /@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)/.exec(
    parsed.pathname,
  );
  if (pathMatch) {
    return {
      location: validLocation(
        Number(pathMatch[1]),
        Number(pathMatch[2]),
        label || `${pathMatch[1]}, ${pathMatch[2]}`,
      ),
      label,
    };
  }

  return { location: null, label };
}

function textWithoutURL(value: string): string {
  return normalizeField(
    value.replace(/\bhttps?:\/\/\S+/gi, ' '),
    MAX_TEXT_LENGTH,
  );
}

export function parseTripShareDestination(
  payload: StoredTripSharePayload,
): ParsedTripShareDestination | null {
  const cleanTitle = normalizeField(payload.title, MAX_TITLE_LENGTH);
  const cleanText = textWithoutURL(payload.text);
  const urlDetails = parseURLDetails(payload.url);
  const label = cleanText || urlDetails.label || cleanTitle;
  const coordinateName = label || payload.url;

  const location =
    (urlDetails.location
      ? { ...urlDetails.location, name: coordinateName || urlDetails.location.name }
      : null)
    ?? parseCoordinatePair(payload.text, coordinateName || payload.text)
    ?? parseCoordinatePair(payload.title, coordinateName || payload.title);

  if (location) {
    return {
      text: location.name || `${location.lat}, ${location.lng}`,
      location,
    };
  }

  const text = label || normalizeField(payload.url, MAX_URL_LENGTH);
  return text ? { text, location: null } : null;
}

export async function storeTripSharePayload(
  storage: CacheStorage,
  payload: StoredTripSharePayload,
): Promise<void> {
  const cache = await storage.open(cacheName('share-target'));
  await cache.put(
    TRIP_SHARE_CACHE_URL,
    new Response(JSON.stringify(payload), {
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json',
      },
    }),
  );
}

export async function discardTripSharePayload(storage: CacheStorage): Promise<void> {
  await storage.delete(cacheName('share-target'));
}

export async function consumeTripSharePayload(
  storage: CacheStorage,
  now = Date.now(),
): Promise<StoredTripSharePayload | null> {
  const cache = await storage.open(cacheName('share-target'));
  const response = await cache.match(TRIP_SHARE_CACHE_URL);
  if (!response) return null;

  await cache.delete(TRIP_SHARE_CACHE_URL);
  const value: unknown = await response.json();
  if (!isStoredTripSharePayload(value)) {
    throw new Error('stored trip share payload is invalid');
  }
  if (
    value.captured_at > now + 60_000
    || now - value.captured_at > TRIP_SHARE_MAX_AGE_MS
  ) {
    throw new Error('stored trip share payload has expired');
  }
  return value;
}

export async function handleTripShareTargetRequest(
  request: Request,
  storage: CacheStorage,
  origin: string,
  capturedAt = Date.now(),
): Promise<Response> {
  const destination = new URL(TRIP_SHARE_DESTINATION_PATH, origin);
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    await discardTripSharePayload(storage);
    destination.searchParams.set('share_target', 'empty');
    return Response.redirect(destination.href, 303);
  }

  const payload = createStoredTripSharePayload(
    {
      title: form.get('title'),
      text: form.get('text'),
      url: form.get('url'),
    },
    capturedAt,
  );

  destination.searchParams.set('share_target', payload ? '1' : 'empty');
  if (payload) {
    await storeTripSharePayload(storage, payload);
  } else {
    await discardTripSharePayload(storage);
  }

  return Response.redirect(destination.href, 303);
}
