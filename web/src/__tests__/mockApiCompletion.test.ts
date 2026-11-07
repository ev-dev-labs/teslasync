import { beforeEach, expect, it, vi } from 'vitest';
import type { Page } from '@playwright/test';
import { assertMockApiComplete, type ApiRequestRecord, type MockApiController } from '../../e2e/mockApi';

const polling = vi.hoisted(() => ({ poll: vi.fn() }));

vi.mock('@playwright/test', async () => {
  const { expect } = await import('vitest');
  return {
    expect: Object.assign((value: unknown, message?: string) => expect(value, message), {
      poll: polling.poll,
    }),
  };
});
vi.mock('../../e2e/mockSseServer', () => ({
  ensureMockSseServer: vi.fn(),
  closeMockSseServer: vi.fn(),
}));

beforeEach(() => { polling.poll.mockReset(); });

it('awaits a routed poll that starts while collecting final beacon evidence', async () => {
  const request: ApiRequestRecord = {
    method: 'GET', origin: 'http://localhost:4189', path: '/api/v1/export/jobs',
    resourceType: 'fetch', disposition: 'fulfilled',
  };
  const controller: MockApiController = {
    unmatched: new Set(), seen: new Set(), sse: new Set(), delayed: new Set(),
    sseRequests: 0, pending: 0, lastActivityAt: 0, requests: [request],
    requestIndex: new WeakMap(), invalidRum: [], navPins: [], nextNavPinId: 1,
  };
  const page = {
    url: () => 'http://localhost:4189/',
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockImplementationOnce(async () => {
        request.disposition = 'pending';
        controller.pending = 1;
        return [];
      })
      .mockResolvedValue(undefined),
  };
  polling.poll.mockImplementation((read: () => unknown) => ({
    toEqual: async (expected: unknown) => {
      if (controller.pending > 0) {
        controller.pending = 0;
        request.disposition = 'fulfilled';
      }
      expect(read()).toEqual(expected);
    },
  }));

  await expect(assertMockApiComplete(page as unknown as Page, controller)).resolves.toBeUndefined();
  expect(request.disposition).toBe('fulfilled');
});
