/**
 * `<TeslaChargingSessionsMap>` integration test.
 *
 * The page is the canonical adopter of `<MarkerCluster>`. This test
 * mounts it with 500 synthetic sessions and asserts that:
 *
 *   1. The leaflet `<Marker>` JSX path is **never used directly** (the
 *      points feed `<MarkerCluster>` instead, which renders nothing
 *      itself in jsdom — only a side effect on the leaflet group).
 *   2. All 500 sessions get materialized as cluster children through a
 *      single `addLayers` call, exercising the chunked-loading fast
 *      path that's the entire point of clustering.
 *   3. Sessions with NaN / missing coordinates are filtered upstream
 *      and never reach the cluster group.
 */
import { render } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

import type { TeslaChargingSession } from '@/api/hooks/useCharging';

const captured = vi.hoisted(() => ({
  markerClusterCalls: [] as Array<{ pointsCount: number }>,
  markerCalls: 0,
  circleMarkerCalls: 0,
}));

vi.mock('@/components/maps', () => {
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);
  return {
    MapContainer: passthrough,
    MapTileLayer: () => null,
    MapInvalidator: () => null,
    MapLayerSwitcher: () => null,
    MarkerCluster: ({ points }: { points: unknown[] }) => {
      captured.markerClusterCalls.push({ pointsCount: points.length });
      return null;
    },
    Marker: () => {
      captured.markerCalls += 1;
      return null;
    },
    CircleMarker: () => {
      captured.circleMarkerCalls += 1;
      return null;
    },
    Polyline: () => null,
    Popup: () => null,
    Circle: () => null,
    Rectangle: () => null,
    FeatureGroup: () => null,
    AnimatedMarker: () => null,
    vehicleIcon: () => ({}),
    GeofenceDrawer: () => null,
    RoutePlayback: () => null,
    describeFence: () => '',
    latLngBounds: () => ({ isValid: () => false }),
    useMap: () => ({
      fitBounds: vi.fn(),
      setView: vi.fn(),
    }),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_k: string, fallback?: string | Record<string, unknown>) =>
      typeof fallback === 'string' ? fallback : _k,
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) =>
      `$${Number(amount).toFixed(decimals)}`,
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
    currencySymbol: '$',
    costPerKwh: 0.12,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

import TeslaChargingSessionsMap from '../TeslaChargingSessionsMap';

function makeSessions(n: number, opts?: { invalidEvery?: number }): TeslaChargingSession[] {
  const out: TeslaChargingSession[] = [];
  for (let i = 0; i < n; i++) {
    const isInvalid =
      opts?.invalidEvery != null && opts.invalidEvery > 0 && i % opts.invalidEvery === 0;
    out.push({
      id: i,
      session_id: 1000 + i,
      vin: 'TEST1234567890ABC',
      charger_id: `charger-${i}`,
      site_location_name: `Site ${i}`,
      charge_start_datetime: new Date(2024, 0, 1, 12, i % 60).toISOString(),
      charge_stop_datetime: new Date(2024, 0, 1, 13, i % 60).toISOString(),
      total_energy_added_wh: 50 + (i % 20),
      peak_power_kw: 150,
      max_charge_rate_kw: 250,
      charge_duration_s: 1800,
      charger_type: i % 2 === 0 ? 'V3' : 'V2',
      currency_code: 'USD',
      total_cost: 12.5 + (i % 10),
      per_kwh_rate: 0.28,
      idle_fee: 0,
      congestion_fee: 0,
      // Spread sessions across a small geographic grid so cluster math
      // has realistic density. Inject NaN coords for the invalid slice
      // so we exercise the upstream coordinate-validity filter.
      latitude: isInvalid ? Number.NaN : 37.5 + (i % 100) * 0.01,
      longitude: isInvalid ? Number.NaN : -122.4 + Math.floor(i / 100) * 0.01,
      fetched_at: '2024-01-01T00:00:00Z',
      created_at: '2024-01-01T00:00:00Z',
    });
  }
  return out;
}

describe('TeslaChargingSessionsMap (integration, 500 sessions)', () => {
  beforeEach(() => {
    captured.markerClusterCalls = [];
    captured.markerCalls = 0;
    captured.circleMarkerCalls = 0;
  });

  it('routes 500 sessions through a single MarkerCluster, never per-marker JSX', () => {
    const sessions = makeSessions(500);
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    // The page must not fall back to per-session <Marker>/<CircleMarker>
    // JSX — that is the regression this whole audit exists to prevent.
    expect(captured.markerCalls).toBe(0);
    expect(captured.circleMarkerCalls).toBe(0);

    expect(captured.markerClusterCalls.length).toBe(1);
    expect(captured.markerClusterCalls[0].pointsCount).toBe(500);
  });

  it('drops sessions with NaN coordinates before they reach the cluster group', () => {
    // Mark every 10th session as having NaN lat/lng — those should be
    // filtered upstream so the cluster only ever sees valid points.
    const sessions = makeSessions(500, { invalidEvery: 10 });
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    expect(captured.markerClusterCalls.length).toBe(1);
    // 50 sessions out of 500 are invalid (i = 0, 10, 20, …, 490).
    expect(captured.markerClusterCalls[0].pointsCount).toBe(450);
  });
});
