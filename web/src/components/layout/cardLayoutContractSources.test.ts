import { describe, expect, it } from 'vitest';
import { cardLayoutContractPaths, resolveCardLayoutContractSource } from '../../../e2e/cardLayoutContractSources';
import { cardLayoutSupplementalPaths, resolveCardLayoutSupplementalSource } from '../../../e2e/cardLayoutSupplementalSources';

const resolve = (path: string) => resolveCardLayoutContractSource(new URL(`http://127.0.0.1/api/v1${path}`));

describe('strict card-layout synthetic source contracts', () => {
  it.each(cardLayoutContractPaths)('supplies the reviewed exact endpoint %s', path => {
    const url = new URL(`http://127.0.0.1/api/v1${path}`);
    url.searchParams.set('vehicle_id', '7');
    if (path === '/exports/columns') url.searchParams.set('type', 'drives');
    if (path === '/mileage/daily') {
      url.searchParams.set('days', '90');
      url.searchParams.set('timezone', 'UTC');
    }
    if (path === '/chatbot/history') url.searchParams.set('session_id', '00000000-0000-4000-8000-000000000701');
    if (path === '/vehicles/7/time-machine') url.searchParams.set('at', '2026-08-26T16:00:00.000Z');
    if (path === '/system/api-usage/history') {
      url.searchParams.set('start', '2026-08-01T00:00:00.000Z');
      url.searchParams.set('end', '2026-08-27T00:00:00.000Z');
      url.searchParams.set('bucket', 'day');
    }
    expect(resolveCardLayoutContractSource(url)).toBeDefined();
  });

  describe('reviewed supplemental route contracts', () => {
    it.each(cardLayoutSupplementalPaths)('supplies the exact reviewed endpoint %s', path => {
      const url = new URL(`http://127.0.0.1/api/v1${path}`);
      url.searchParams.set('vehicle_id', '7');
      if (path === '/chatbot/history') url.searchParams.set('session_id', '00000000-0000-4000-8000-000000000701');
      if (path === '/vehicles/7/time-machine') url.searchParams.set('at', '2026-08-26T16:00:00.000Z');
      expect(resolveCardLayoutSupplementalSource(url)).toBeDefined();
    });

    it('does not invent a chat history or a future observation for an unknown session or past instant', () => {
      expect(resolveCardLayoutSupplementalSource(new URL('http://127.0.0.1/api/v1/chatbot/history?session_id=unknown'))).toBeUndefined();
      expect(resolveCardLayoutSupplementalSource(new URL('http://127.0.0.1/api/v1/vehicles/7/time-machine?at=2026-08-24T00:00:00Z'))).toBeUndefined();
      expect(resolveCardLayoutSupplementalSource(new URL('http://127.0.0.1/api/v1/not-reviewed'))).toBeUndefined();
    });
  });

  it('does not absorb unknown endpoints, vehicles, catalogs or invalid pagination', () => {
    for (const path of [
      '/unknown', '/climate?vehicle_id=8', '/exports/columns?type=invented',
      '/advanced-intelligence/firmware-canary?limit=101',
      '/advanced-intelligence/charging-forensics?offset=-1',
    ]) expect(resolve(path)).toBeUndefined();
  });

  it('emits the backend climate wire names and actual observations', () => {
    expect(resolve('/climate?vehicle_id=7')).toEqual([
      expect.objectContaining({ inside_temp: 22, outside_temp: 18 }),
      expect.objectContaining({ inside_temp: 21, outside_temp: 18 }),
    ]);
  });

  it('distinguishes certificate envelopes and maintenance schedules from similarly named widget payloads', () => {
    expect(resolve('/analytics/battery-health/certificate?vehicle_id=7')).toEqual(
      expect.objectContaining({
        certificate: expect.objectContaining({ vehicle_id: 7, current_soh: expect.any(Number) }),
        signature: expect.any(String),
      }),
    );
    expect(resolve('/maintenance?vehicle_id=7')).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: expect.any(Number), current_mileage: expect.any(Number),
        status: expect.stringMatching(/^(good|soon|overdue|completed)$/),
      }),
    ]));
    expect(resolve('/maintenance/records?vehicle_id=7')).toEqual([]);
  });

  it('uses the producer calendar date for public shares and does not invent charge telemetry', () => {
    expect(resolve('/share/e2e-token')).toEqual(expect.objectContaining({
      drive: expect.objectContaining({ date: '2026-08-26' }),
    }));
    expect(resolve('/charging/201/telemetry')).toEqual([]);
    expect(resolve('/physics/charging/201/ledger')).toEqual(expect.objectContaining({
      charge: null, unknown_hours: 1, unknown_intervals: [expect.objectContaining({ duration_s: 3600 })],
    }));
  });

  it.each(['90', '366'])('keeps the reviewed mileage request for %s days independent from widget-only assertions', days => {
    expect(resolve(`/mileage/daily?days=${days}&timezone=UTC&vehicle_id=7`)).toEqual({
      vehicle_id: 7,
      days: [{ date: '2026-08-26', drive_count: 1, total_km: 17.4, end_odometer_km: 32100 }],
    });
  });

  it('does not absorb unknown mileage ranges, vehicles, zones or query parameters', () => {
    for (const query of [
      '', 'days=1&timezone=UTC&vehicle_id=7', 'days=90&timezone=UTC&vehicle_id=8',
      'days=90&timezone=America/Los_Angeles&vehicle_id=7',
      'days=90&timezone=UTC&vehicle_id=7&extra=1',
      'days=90&days=366&timezone=UTC&vehicle_id=7',
    ]) expect(resolve(`/mileage/daily?${query}`)).toBeUndefined();
  });

  it('keeps usage history inside the requested bounds and rejects malformed windows', () => {
    const start = '2026-08-01T00:00:00.000Z';
    const end = '2026-08-27T00:00:00.000Z';
    expect(resolve(`/system/api-usage/history?start=${start}&end=${end}&bucket=week`))
      .toEqual(expect.objectContaining({
        start, end, bucket: 'week',
        total: expect.objectContaining({ start, end }),
        points: [expect.objectContaining({ bucket_start: start })],
      }));
    for (const query of [
      '', `start=${end}&end=${start}&bucket=day`,
      `start=${start}&end=${end}&bucket=hour`,
    ]) expect(resolve(`/system/api-usage/history?${query}`)).toBeUndefined();
  });

  it('preserves truthful pagination rather than repeating the first populated page', () => {
    for (const path of cardLayoutContractPaths.filter(path => path.startsWith('/advanced-intelligence/'))) {
      expect(resolve(`${path}?vehicle_id=7&limit=12&offset=1`))
        .toEqual(expect.objectContaining({ total: 1, limit: 12, offset: 1, items: [] }));
    }
  });

  it('publishes the canonical drive-column catalog, not a generic successful payload', () => {
    expect(resolve('/exports/columns?type=drives')).toEqual({
      type: 'drives', supports_selection: true,
      columns: [
        { name: 'id', label: 'ID', always_included: true },
        { name: 'vehicle_id', label: 'Vehicle ID', always_included: true },
        { name: 'start_date', label: 'Start date', always_included: false },
        { name: 'end_date', label: 'End date', always_included: false },
        { name: 'distance_m', label: 'Distance (m)', always_included: false },
        { name: 'duration_s', label: 'Duration (s)', always_included: false },
        { name: 'max_speed_mps', label: 'Max speed (m/s)', always_included: false },
      ],
    });
  });
});
