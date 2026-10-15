import { expect, type Page } from '@playwright/test';
import type { Trip, TripDetail } from '../../src/api/types';
import type { ChecklistRun, JourneyDetail, JourneyReport, JourneySession } from '../../src/api/hooks/useJourney';
import type { WaitOracleSite } from '../../src/api/hooks/useCharging';
import { fulfillApiFixture, mockAppSettings, type MockApiController } from '../mockApi';

export const TRIP_WINDOW = { start: '2026-08-01', end: '2026-08-26' } as const;
export const TRIP_ID = 601;
export const JOURNEY_ID = 701;
export const TRIP_LIST_PATH = `/trips?vehicle_id=7&from=${TRIP_WINDOW.start}&to=${TRIP_WINDOW.end}&size=2`;

export const trips = [
  {
    id: TRIP_ID, vehicle_id: 7, name: 'Recorded coastal trip',
    start_date: '2026-08-24T08:00:00Z', end_date: '2026-08-24T09:00:00Z',
    started_at: '2026-08-24T08:00:00Z', ended_at: '2026-08-24T09:00:00Z',
    total_distance_m: 40_000, total_energy_wh: 8_000, total_duration_s: 3_600,
    total_cost: 12, drive_count: 3, charge_count: 1, created_at: '2026-08-24T09:00:00Z',
  },
  {
    id: 602, vehicle_id: 7, name: 'Recorded valley trip',
    start_date: '2026-08-25T08:00:00Z', end_date: '2026-08-25T10:00:00Z',
    started_at: '2026-08-25T08:00:00Z', ended_at: '2026-08-25T10:00:00Z',
    total_distance_m: 60_000, total_energy_wh: 4_000, total_duration_s: 7_200,
    total_cost: 8, drive_count: 7, charge_count: 2, created_at: '2026-08-25T10:00:00Z',
  },
] satisfies Trip[];

export const nextPageTrips = [{
  ...trips[0], id: 603, name: 'Recorded final-window trip',
  start_date: '2026-08-26T08:00:00Z', end_date: '2026-08-26T08:10:00Z',
  started_at: '2026-08-26T08:00:00Z', ended_at: '2026-08-26T08:10:00Z',
  created_at: '2026-08-26T08:10:00Z',
  total_distance_m: 10_000, total_energy_wh: 2_000, total_duration_s: 600,
  total_cost: 2, drive_count: 1, charge_count: 0,
}] satisfies Trip[];

export const tripDetail = {
  ...trips[0], energy_used_wh: 8_000,
  drives: [
    {
      id: 101, started_at: trips[0].started_at, ended_at: '2026-08-24T08:20:00Z',
      distance_m: 13_000, energy_used_wh: 2_600, duration_s: 1_200,
      start_place: 'Origin', end_place: 'First stop',
    },
    {
      id: 102, started_at: '2026-08-24T08:20:00Z', ended_at: '2026-08-24T08:40:00Z',
      distance_m: 12_000, energy_used_wh: 2_400, duration_s: 1_200,
      start_place: 'First stop', end_place: 'Second stop',
    },
    {
      id: 103, started_at: '2026-08-24T08:40:00Z', ended_at: trips[0].ended_at,
      distance_m: 15_000, energy_used_wh: 3_000, duration_s: 1_200,
      start_place: 'Second stop', end_place: 'Destination',
    },
  ],
} satisfies TripDetail;

export const zeroTripDetail = {
  ...tripDetail, total_distance_m: 0, total_energy_wh: 0, energy_used_wh: 0,
  total_duration_s: 0, total_cost: 0, drive_count: 0, charge_count: 0, drives: [],
} satisfies TripDetail;

// The public type declares required totals; the display contract explicitly
// handles absent wire fields. Model that malformed payload without a type cast.
type MissingTripTotals = Omit<TripDetail,
  'total_distance_m' | 'total_energy_wh' | 'energy_used_wh' | 'total_duration_s' | 'total_cost' | 'drive_count' | 'charge_count'>;
export const missingTripDetail: MissingTripTotals = {
  id: TRIP_ID, vehicle_id: 7, name: 'Trip with unrecorded totals',
  start_date: trips[0].start_date, end_date: trips[0].end_date,
  started_at: trips[0].started_at, ended_at: trips[0].ended_at,
  created_at: trips[0].created_at, drives: [],
};

export const journeySession = {
  id: JOURNEY_ID, vehicle_id: 7, name: 'Completed coastal journey',
  origin_name: 'Origin', dest_name: 'Destination',
  origin_lat: null, origin_lng: null, dest_lat: null, dest_lng: null,
  status: 'completed', plan_version: 5,
  created_at: '2026-08-24T07:00:00Z', updated_at: '2026-08-24T09:00:00Z',
  started_at: '2026-08-24T08:00:00Z', ended_at: '2026-08-24T09:00:00Z',
} satisfies JourneySession;

export const journeyDetail = {
  session: journeySession, next_statuses: [],
  plans: [{
    id: 801, session_id: JOURNEY_ID, version: 5, plan: { stops: [] },
    note: 'Recorded final plan', created_at: '2026-08-24T08:10:00Z',
  }],
} satisfies JourneyDetail;

export const journeyReport = {
  session_id: JOURNEY_ID, status: 'completed',
  started_at: journeySession.started_at, ended_at: journeySession.ended_at,
  distance_m: 40_000, duration_s: 3_600, detour: 1.25, fixes: 6,
  plans: 5, replans: 2, route_factor: 1.1, route_trips: 9,
  checklist: { ready: 3, total: 4 },
  evidence: ['Synthetic recorded report: nine historical route trips; four readiness checks.'],
} satisfies JourneyReport;

export const zeroJourneyReport = {
  ...journeyReport, distance_m: 0, duration_s: 0, detour: null,
  fixes: 0, plans: 0, replans: 0, route_factor: null, route_trips: 0,
  checklist: { ready: 0, total: 0 }, evidence: [],
} satisfies JourneyReport;

const checklist = {
  id: 901, session_id: JOURNEY_ID, run_at: '2026-08-24T07:55:00Z',
  items: [{ key: 'charge', status: 'ok', detail: 'Recorded readiness check.' }],
} satisfies ChecklistRun;

export async function installTripFixtures(
  page: Page,
  controller: MockApiController | null,
  theme: 'light' | 'dark',
  options: {
    list?: Trip[];
    detail?: TripDetail | MissingTripTotals;
    report?: JourneyReport;
  } = {},
): Promise<void> {
  if (!controller) throw new Error('OperationalBrief trip contracts require the strict mocked API harness');
  await page.route(url => url.pathname === '/api/v1/settings', route => {
    expect(route.request().method()).toBe('GET');
    return fulfillApiFixture(route, controller, { json: { ...mockAppSettings, mode: theme } });
  });
  await page.route(url => url.pathname === '/api/v1/trips', route => {
    const url = new URL(route.request().url());
    expect(route.request().method()).toBe('GET');
    expect(url.searchParams.get('vehicle_id')).toBe('7');
    expect(url.searchParams.get('start')).toBe(TRIP_WINDOW.start);
    expect(url.searchParams.get('end')).toBe(TRIP_WINDOW.end);
    expect(url.searchParams.get('limit')).toBe('2');
    const offset = url.searchParams.get('offset');
    expect([null, '2']).toContain(offset);
    expect([...url.searchParams.keys()].sort()).toEqual(offset === '2'
      ? ['end', 'limit', 'offset', 'start', 'vehicle_id']
      : ['end', 'limit', 'start', 'vehicle_id']);
    return fulfillApiFixture(route, controller, {
      json: offset === '2' ? nextPageTrips : options.list ?? trips,
    });
  });
  await page.route(url => url.pathname === `/api/v1/trips/${TRIP_ID}`, route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('');
    return fulfillApiFixture(route, controller, { json: options.detail ?? tripDetail });
  });
  await page.route(url => url.pathname === '/api/v1/journey/sessions', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('?vehicle_id=7');
    return fulfillApiFixture(route, controller, { json: [journeySession] });
  });
  const sites: WaitOracleSite[] = [];
  await page.route(url => url.pathname === '/api/v1/waitoracle/sites', route => {
    expect(route.request().method()).toBe('GET');
    expect(new URL(route.request().url()).search).toBe('');
    return fulfillApiFixture(route, controller, { json: sites });
  });
  const reads = [
    { suffix: '', json: journeyDetail },
    { suffix: '/report', json: options.report ?? journeyReport },
    { suffix: '/checklist', json: checklist },
  ];
  for (const fixture of reads) {
    await page.route(url => url.pathname === `/api/v1/journey/sessions/${JOURNEY_ID}${fixture.suffix}`, route => {
      expect(route.request().method()).toBe('GET');
      expect(new URL(route.request().url()).search).toBe('');
      return fulfillApiFixture(route, controller, { json: fixture.json });
    });
  }
}
