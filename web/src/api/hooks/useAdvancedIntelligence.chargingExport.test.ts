import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChargingForensicsItem } from '@/types/advancedIntelligence';

vi.mock('../client', () => ({ request: vi.fn() }));
vi.mock('./_toastHelpers', () => ({ useMutationToast: vi.fn() }));

import { request } from '../client';
import {
  fetchAllChargingForensics,
  IncompleteChargingForensicsExportError,
} from './useAdvancedIntelligence';

const mockedRequest = vi.mocked(request);
const item: ChargingForensicsItem = {
  session_id: 1,
  started_at: '2026-10-14T00:00:00Z',
  ended_at: null,
  vehicle_energy_wh: 12_000,
  meter_energy_wh: 13_000,
  estimated_loss_wh: 1_000,
  estimated_loss_low_wh: 800,
  estimated_loss_high_wh: 1_200,
  recorded_cost_minor: 500,
  expected_cost_minor: 450,
  cost_discrepancy_minor: 50,
  currency: 'USD',
  status: 'reconciled',
  evidence: [],
  limitations: [],
};
const rows = (count: number, offset = 0) =>
  Array.from({ length: count }, (_, index) => ({ ...item, session_id: offset + index + 1 }));

beforeEach(() => mockedRequest.mockReset());

describe('charging forensics full-packet export', () => {
  it('preserves populated rows, array callers, pagination and cancellation', async () => {
    const first = rows(100);
    const last = rows(2, 100);
    mockedRequest.mockResolvedValueOnce({ items: first, total: 102 });
    mockedRequest.mockResolvedValueOnce({ items: last, total: 102 });
    const signal = new AbortController().signal;
    const result = await fetchAllChargingForensics(42, signal);

    expect(result.map(row => row)).toEqual([...first, ...last]);
    expect(result).toMatchObject({
      complete: true, limitReached: false, fetchedRows: 102, total: 102,
    });
    expect(mockedRequest.mock.calls).toEqual([
      ['/advanced-intelligence/charging-forensics?vehicle_id=42&limit=100&offset=0', { signal }],
      ['/advanced-intelligence/charging-forensics?vehicle_id=42&limit=100&offset=100', { signal }],
    ]);
  });

  it('accepts a complete empty dataset', async () => {
    mockedRequest.mockResolvedValueOnce({ items: null, total: 0 });
    const result = await fetchAllChargingForensics(42);
    expect(result).toHaveLength(0);
    expect(result.complete).toBe(true);
    expect(result.total).toBe(0);
  });

  it.each([[], rows(1), null])('rejects a premature short page (%j)', async items => {
    mockedRequest.mockResolvedValueOnce({ items, total: 200 });
    await expect(fetchAllChargingForensics(42)).rejects.toMatchObject({
      name: 'IncompleteChargingForensicsExportError',
      evidence: {
        complete: false, limitReached: false, fetchedRows: items?.length ?? 0, total: 200,
      },
    });
  });

  it('does not treat a missing total on a full page as completion', async () => {
    mockedRequest.mockResolvedValueOnce({ items: rows(100) });
    mockedRequest.mockResolvedValueOnce({ items: rows(1, 100) });
    const result = await fetchAllChargingForensics(42);
    expect(result).toHaveLength(101);
    expect(result).toMatchObject({ complete: true, limitReached: false, total: null });
    expect(mockedRequest).toHaveBeenCalledTimes(2);
  });

  it('does not infer completion from missing items and total', async () => {
    mockedRequest.mockResolvedValueOnce({ items: null });
    await expect(fetchAllChargingForensics(42)).rejects.toMatchObject({
      evidence: { complete: false, limitReached: false, fetchedRows: 0, total: null },
    });
  });

  it('rejects a safety-limited packet instead of allowing a full export', async () => {
    mockedRequest.mockResolvedValue({ items: rows(100), total: 10_001 });
    const download = vi.fn();
    const exportPacket = async () => download((await fetchAllChargingForensics(42)).map(row => row));
    await expect(exportPacket()).rejects.toBeInstanceOf(IncompleteChargingForensicsExportError);
    expect(download).not.toHaveBeenCalled();
    expect(mockedRequest).toHaveBeenCalledTimes(100);
    await expect(fetchAllChargingForensics(42)).rejects.toMatchObject({
      evidence: { complete: false, limitReached: true, fetchedRows: 10_000, total: 10_001 },
    });
  });

  it('accepts exactly 10,000 rows when the total confirms completion', async () => {
    mockedRequest.mockResolvedValue({ items: rows(100), total: 10_000 });
    const result = await fetchAllChargingForensics(42);
    expect(result).toHaveLength(10_000);
    expect(result).toMatchObject({ complete: true, limitReached: false, total: 10_000 });
    expect(mockedRequest).toHaveBeenCalledTimes(100);
  });

  it('rejects an unconfirmed full packet at the safety limit', async () => {
    mockedRequest.mockResolvedValue({ items: rows(100) });
    await expect(fetchAllChargingForensics(42)).rejects.toMatchObject({
      evidence: { complete: false, limitReached: true, fetchedRows: 10_000, total: null },
    });
  });

  it('preserves request failures rather than returning a partial success', async () => {
    const error = new Error('Request failed');
    mockedRequest.mockResolvedValueOnce({ items: rows(100), total: 101 });
    mockedRequest.mockRejectedValueOnce(error);
    await expect(fetchAllChargingForensics(42)).rejects.toBe(error);
  });
});
