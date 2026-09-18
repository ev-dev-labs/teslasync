// usePhysicsLedger hook tests.
//
// Covers the ledger fetch contract:
//   - window/park URLs carry snake_case vehicle_id/start/end and no /api/v1 prefix;
//   - drive/charge URLs embed the session id in the path;
//   - the `enabled` gate blocks queries without an id.
//
// Network is faked at the `@/api/client` boundary so no real fetch happens.

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createElement, type ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: requestMock };
});

import {
  physicsLedgerKeys,
  readPhysicsLedger,
  usePhysicsLedger,
  useDriveLedger,
  useChargeLedger,
  useParkLedger,
} from './usePhysicsLedger';

function makeWrapper() {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return createElement(QueryClientProvider, { client: qc }, children);
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('usePhysicsLedger', () => {
  it('requests the window ledger with snake_case params', async () => {
    requestMock.mockResolvedValueOnce({ kind: 'range' });
    const { result } = renderHook(
      () => usePhysicsLedger({ vehicleId: '1', start: '2026-09-13T12:00:00Z', end: '2026-09-14T12:00:00Z' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(requestMock.mock.calls[0][0]);
    expect(url).not.toContain('/api/v1');
    expect(url).toContain('/physics/ledger');
    expect(url).toContain('vehicle_id=1');
    expect(url).toContain('start=');
    expect(url).toContain('end=');
    expect(url).not.toMatch(/vehicleId|camelCase/);
  });

  it('does not fetch without a vehicle id', () => {
    renderHook(() => usePhysicsLedger({ vehicleId: undefined }), { wrapper: makeWrapper() });
    expect(requestMock).not.toHaveBeenCalled();
  });

  it('requests the drive ledger by path id', async () => {
    requestMock.mockResolvedValueOnce({ kind: 'drive' });
    const { result } = renderHook(() => useDriveLedger('7'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(requestMock.mock.calls[0][0])).toBe('/physics/drives/7/ledger');
  });

  it('requests the charge ledger by path id', async () => {
    requestMock.mockResolvedValueOnce({ kind: 'charge' });
    const { result } = renderHook(() => useChargeLedger('9'), { wrapper: makeWrapper() });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(String(requestMock.mock.calls[0][0])).toBe('/physics/charging/9/ledger');
  });

  it('requests the park ledger with snake_case params', async () => {
    requestMock.mockResolvedValueOnce({ kind: 'park' });
    const { result } = renderHook(
      () => useParkLedger({ vehicleId: '1', start: '2026-09-13T12:00:00Z', end: '2026-09-14T12:00:00Z' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const url = String(requestMock.mock.calls[0][0]);
    expect(url).toContain('/physics/park/ledger');
    expect(url).toContain('vehicle_id=1');
  });

  it('unwraps a legacy {data: ledger} envelope so panels are not empty', async () => {
    requestMock.mockResolvedValueOnce({
      data: { kind: 'range', honesty: 'Predicted vs measured', drive: { honesty: 'Drive energy' } },
    });
    const { result } = renderHook(
      () => usePhysicsLedger({ vehicleId: '1', start: '2026-09-13T12:00:00Z', end: '2026-09-14T12:00:00Z' }),
      { wrapper: makeWrapper() },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.kind).toBe('range');
    expect(result.current.data?.drive).toEqual({ honesty: 'Drive energy' });
  });

  it('builds distinct cache keys per scope', () => {
    const a = physicsLedgerKeys.window({ vehicleId: '1' });
    const b = physicsLedgerKeys.window({ vehicleId: '2' });
    expect(a).not.toEqual(b);
    expect(physicsLedgerKeys.drive('7')).not.toEqual(physicsLedgerKeys.charge('7'));
  });
});

describe('readPhysicsLedger', () => {
  it('returns a root ledger unchanged', () => {
    const ledger = { kind: 'drive', honesty: 'Drive energy' };
    expect(readPhysicsLedger(ledger)).toBe(ledger);
  });

  it('unwraps {data: ledger} when the root has no kind', () => {
    const inner = { kind: 'range', honesty: 'Predicted vs measured' };
    expect(readPhysicsLedger({ data: inner })).toBe(inner);
  });
});
