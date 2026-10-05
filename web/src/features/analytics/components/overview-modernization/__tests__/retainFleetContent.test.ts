import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { describe, expect, it } from 'vitest';
import type { FleetAnalytics } from '@/api/types';
import { retainFleetContent } from '../retainFleetContent';
import { fleetFixture } from './fleetFixture';

function observer(initialData?: FleetAnalytics) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const source = new QueryObserver<FleetAnalytics, Error>(client, {
    queryKey: ['analytics-modernization-retention'],
    queryFn: async () => { throw new Error('Refresh unavailable'); },
    initialData,
    retry: false,
  });
  return { client, source };
}

describe('retained analytics content view', () => {
  it('keeps pending, successful and initial-failure query objects unchanged', async () => {
    const pending = observer();
    const initial = pending.source.getCurrentResult();
    expect(initial.isPending).toBe(true);
    expect(retainFleetContent(initial)).toBe(initial);
    const failed = await pending.source.refetch();
    expect(failed.isError).toBe(true);
    expect(failed.data).toBeUndefined();
    expect(retainFleetContent(failed)).toBe(failed);
    pending.client.clear();

    const ready = observer(fleetFixture());
    const successful = ready.source.getCurrentResult();
    expect(retainFleetContent(successful)).toBe(successful);
    ready.client.clear();
  });

  it('keeps every retained measurement and nested source by identity after an actual query rejection', async () => {
    const fixture = fleetFixture();
    const { client, source } = observer(fixture);
    const failed = await source.refetch();
    expect(failed.isRefetchError).toBe(true);
    expect(failed.data).toBe(fixture);
    const original = Object.freeze(failed);
    const view = retainFleetContent(original);

    expect(view).not.toBe(original);
    expect(view.data).toBe(original.data);
    expect(view.data?.drive_analytics).toBe(original.data?.drive_analytics);
    expect(view.data?.charging_analytics).toBe(original.data?.charging_analytics);
    expect(view.data?.battery_trend).toBe(original.data?.battery_trend);
    expect(view.data?.vehicle_comparison).toBe(original.data?.vehicle_comparison);
    expect(view.data?.total_distance_km).toBe(1234.567);
    expect(view.data?.total_energy_kwh).toBe(100.25);
    expect(view.data?.avg_efficiency_wh_km).toBe(160.125);
    expect(view.status).toBe('success');
    expect(view.isError).toBe(false);
    expect(view.isLoading).toBe(false);
    expect(view.error).toBeNull();

    // Header/source metadata still receive the unmodified original result.
    expect(original.isError).toBe(true);
    expect(original.error?.message).toBe('Refresh unavailable');
    expect(view.dataUpdatedAt).toBe(original.dataUpdatedAt);
    expect(view.errorUpdatedAt).toBe(original.errorUpdatedAt);
    expect(view.failureCount).toBe(original.failureCount);
    expect(view.failureReason).toBe(original.failureReason);
    expect(view.fetchStatus).toBe(original.fetchStatus);
    expect(view.refetch).toBe(original.refetch);
    expect(client.getQueryData(['analytics-modernization-retention'])).toBe(fixture);
    expect(client.getQueryState(['analytics-modernization-retention'])?.status).toBe('error');
    client.clear();
  });

  it('does not label an empty retained response as lifetime or fabricate missing nested sections', async () => {
    const fixture = fleetFixture();
    fixture.vehicle_comparison = [];
    fixture.battery_trend = [];
    fixture.drive_analytics.daily_trend = [];
    fixture.charging_analytics.monthly_trend = [];
    const { client, source } = observer(fixture);
    const failed = await source.refetch();
    const view = retainFleetContent(failed);
    expect(view.data).toBe(fixture);
    expect(view.data?.vehicle_comparison).toEqual([]);
    expect(view.data?.battery_trend).toEqual([]);
    expect(view.data?.period_days).toBe(30);
    client.clear();
  });
});
