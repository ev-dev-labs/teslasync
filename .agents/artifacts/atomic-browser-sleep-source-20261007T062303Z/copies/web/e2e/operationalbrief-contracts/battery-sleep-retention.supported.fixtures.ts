import { expect, type Page } from '@playwright/test';
import {
  fulfillApiFixture, type ApiRequestRecord, type MockApiController,
} from '../mockApi';
import { sleepTransitionOnly, sleepWithDwell } from './battery.fixtures';

export const sleepRetentionPath = '/sleep-efficiency?from=2026-08-04&to=2026-08-06';
export const sleepRetentionEndpoint = '/api/v1/analytics/sleep';
export const sleepRetentionParams = {
  vehicle_id: '7', days: '3', start: '2026-08-04', end: '2026-08-06',
} as const;

type ResponsePhase = 'initial' | 'failed-refresh' | 'recovered';

export interface SleepRetentionRead {
  phase: ResponsePhase;
  status: 200 | 503;
  url: string;
  record: ApiRequestRecord;
}

export async function installSleepRetentionSource(page: Page, mocks: MockApiController) {
  let phase: ResponsePhase = 'initial';
  const reads: SleepRetentionRead[] = [];
  await page.route(url => url.pathname === sleepRetentionEndpoint, async route => {
    const request = route.request();
    const url = new URL(request.url());
    expect(request.method(), 'sleep source is a read-only GET').toBe('GET');
    expect(Object.fromEntries(url.searchParams), 'exact vehicle and inclusive calendar scope')
      .toEqual(sleepRetentionParams);
    expect([...url.searchParams.keys()], 'no duplicate or additional query parameters').toHaveLength(4);
    const requestPhase = phase;
    const status = requestPhase === 'failed-refresh' ? 503 : 200;
    await fulfillApiFixture(route, mocks, {
      status,
      json: requestPhase === 'failed-refresh'
        ? { error: 'Synthetic sleep evidence refresh unavailable' }
        : requestPhase === 'initial' ? sleepTransitionOnly : sleepWithDwell,
    });
    const record = mocks.requestIndex.get(request);
    if (!record) throw new Error('Sleep response escaped the strict mockApi request ledger');
    reads.push({ phase: requestPhase, status, url: url.href, record });
  });
  return {
    reads,
    failRefresh: () => { phase = 'failed-refresh'; },
    restore: () => { phase = 'recovered'; },
  };
}

export function assertSleepRetentionLedger(mocks: MockApiController, reads: readonly SleepRetentionRead[]) {
  const sourceRecords = mocks.requests.filter(record => record.path === sleepRetentionEndpoint);
  expect(sourceRecords, 'every sleep request has an attributable response')
    .toEqual(reads.map(read => read.record));
  for (const read of reads) {
    const url = new URL(read.url);
    expect(read.record.method).toBe('GET');
    expect(read.record.path).toBe(sleepRetentionEndpoint);
    expect(read.record.disposition, 'fulfilled failures are not escaped or aborted requests').toBe('fulfilled');
    expect(Object.fromEntries(url.searchParams)).toEqual(sleepRetentionParams);
    expect(mocks.seen.has(`GET /analytics/sleep${url.search}`)).toBe(true);
  }
}
