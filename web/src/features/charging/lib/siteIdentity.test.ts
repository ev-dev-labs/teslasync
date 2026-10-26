import { describe, expect, it } from 'vitest';
import { normalizePlaceGeoSite, type PlaceGeoSiteSession } from './siteIdentity';

describe('normalizePlaceGeoSite', () => {
  it('trims place names and lowercases the key', () => {
    expect(normalizePlaceGeoSite({
      start_place: '  Home Garage  ',
      start_lat: 37.1,
      start_lng: -122.1,
    })).toEqual({
      key: 'place:home garage',
      label: 'Home Garage',
    });
  });

  it('prefers a place over valid coordinates', () => {
    expect(normalizePlaceGeoSite({
      start_place: 'Supercharger',
      start_lat: 0,
      start_lng: 0,
    })).toEqual({
      key: 'place:supercharger',
      label: 'Supercharger',
    });
  });

  it('falls back to blank place names when whitespace is present', () => {
    expect(normalizePlaceGeoSite({
      start_place: ' \t ',
      start_lat: 51.50131,
      start_lng: -0.14201,
    })).toEqual({
      key: 'geo:51.50,-0.14',
      label: '51.50, -0.14',
    });
  });

  it('preserves valid zero coordinates in a geo cell', () => {
    expect(normalizePlaceGeoSite({ start_place: null, start_lat: 0, start_lng: 0 })).toEqual({
      key: 'geo:0.00,0.00',
      label: '0.00, 0.00',
    });
  });

  it.each([
    ['null latitude', null, -122.1],
    ['null longitude', 37.1, null],
    ['NaN latitude', Number.NaN, -122.1],
    ['NaN longitude', 37.1, Number.NaN],
    ['infinite latitude', Number.POSITIVE_INFINITY, -122.1],
    ['infinite longitude', 37.1, Number.NEGATIVE_INFINITY],
  ])('returns null for %s', (_caseName, startLat, startLng) => {
    const session: PlaceGeoSiteSession = {
      start_place: null,
      start_lat: startLat,
      start_lng: startLng,
    };
    expect(normalizePlaceGeoSite(session)).toBeNull();
  });

  it('uses Math.round negative-cell behavior and two-decimal labels', () => {
    expect(normalizePlaceGeoSite({ start_lat: -37.495, start_lng: -122.145 })).toEqual({
      key: 'geo:-37.49,-122.14',
      label: '-37.49, -122.14',
    });
  });

  it('handles rounding boundaries consistently with Math.round and toFixed', () => {
    expect(normalizePlaceGeoSite({ start_lat: 37.4949, start_lng: 37.496 })).toEqual({
      key: 'geo:37.49,37.50',
      label: '37.49, 37.50',
    });
    expect(normalizePlaceGeoSite({ start_lat: 37.495, start_lng: -122.145 })).toEqual({
      key: 'geo:37.49,-122.14',
      label: '37.49, -122.14',
    });
  });

  it('returns null when the place and location are missing', () => {
    expect(normalizePlaceGeoSite({})).toBeNull();
    expect(normalizePlaceGeoSite({ start_place: null, start_lat: null, start_lng: null })).toBeNull();
    expect(normalizePlaceGeoSite({ start_place: null, start_lat: 37.1 })).toBeNull();
    expect(normalizePlaceGeoSite({ start_place: null, start_lng: -122.1 })).toBeNull();
  });
});
