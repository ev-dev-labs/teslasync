import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchWidgetHistory } from './_widgetHistory';

afterEach(() => vi.useRealTimers());

describe('fetchWidgetHistory', () => {
  it('uses rolling start and exclusive end bounds on every refresh', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
    const fetchPage = vi.fn(async (_params: URLSearchParams) => [{ id: 1 }]);

    await fetchWidgetHistory(42, { limit: 5, range: '7d' }, fetchPage);
    expect(Object.fromEntries(fetchPage.mock.calls[0][0])).toEqual({
      vehicle_id: '42',
      limit: '5',
      start: '2026-03-03T12:00:00.000Z',
      end: '2026-03-10T12:00:00.000Z',
    });

    vi.setSystemTime(new Date('2026-03-11T12:00:00.000Z'));
    await fetchWidgetHistory(42, { limit: 5, range: '7d' }, fetchPage);
    expect(fetchPage.mock.calls[1][0].get('start')).toBe('2026-03-04T12:00:00.000Z');
    expect(fetchPage.mock.calls[1][0].get('end')).toBe('2026-03-11T12:00:00.000Z');
  });

  it('loads every page of a bounded aggregate with identical range bounds', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-10T12:00:00.000Z'));
    const first = Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 }));
    const fetchPage = vi.fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce([{ id: 1001 }]);

    const rows = await fetchWidgetHistory(42, { limit: 60, range: '24h', completeRange: true }, fetchPage);
    expect(rows).toHaveLength(1001);
    const params = fetchPage.mock.calls.map(([value]) => Object.fromEntries(value as URLSearchParams));
    expect(params).toEqual([
      { vehicle_id: '42', limit: '1000', start: '2026-03-09T12:00:00.000Z', end: '2026-03-10T12:00:00.000Z', offset: '0' },
      { vehicle_id: '42', limit: '1000', start: '2026-03-09T12:00:00.000Z', end: '2026-03-10T12:00:00.000Z', offset: '1000' },
    ]);
  });

  it('rejects duplicate pages instead of displaying incomplete totals', async () => {
    const page = Array.from({ length: 1000 }, (_, index) => ({ id: index + 1 }));
    const fetchPage = vi.fn().mockResolvedValue(page);
    await expect(fetchWidgetHistory(42, { range: '90d', completeRange: true }, fetchPage))
      .rejects.toThrow('Widget history changed while loading; retry');
  });

  it('rejects unresolved vehicles and invalid ranges without requesting data', async () => {
    const fetchPage = vi.fn();
    await expect(fetchWidgetHistory(0, { range: '7d' }, fetchPage))
      .rejects.toThrow('Vehicle scope has not resolved');
    await expect(fetchWidgetHistory(42, { range: 'unexpected' }, fetchPage))
      .rejects.toThrow('Invalid widget time range');
    expect(fetchPage).not.toHaveBeenCalled();
  });
});
