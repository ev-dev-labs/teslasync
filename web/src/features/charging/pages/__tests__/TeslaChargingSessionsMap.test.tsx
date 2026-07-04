/**
 * `<TeslaChargingSessionsMap>` unit + hardening tests.
 *
 * The component is a pure presentational adapter: it turns a list of
 * `TeslaChargingSession`s into (a) a memoised map `center` and (b) an array
 * of `<MarkerCluster>` points with pre-built popup HTML. leaflet / react-leaflet
 * render nothing meaningful in jsdom, so `@/components/maps` is mocked at the
 * module boundary with prop-capturing fakes. That lets the assertions target
 * the component's OWN logic — centroid maths, coordinate validity filtering,
 * popup construction, HTML escaping, and i18n fallbacks — deterministically and
 * without touching the network.
 *
 * The centroid tests double as a regression guard: a null/NaN coordinate must
 * neither drag the centroid toward (0,0) nor poison it into a NaN center.
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

import type { TeslaChargingSession } from '@/api/hooks/useCharging';

interface CapturedPoint {
  id: number;
  lat: number;
  lng: number;
  popupHtml: string;
  ariaLabel: string;
}

interface CapturedMap {
  center: [number, number];
  zoom: number;
  scrollWheelZoom: boolean;
  className: string;
}

interface CapturedCluster {
  points: CapturedPoint[];
  defaultColor: string;
  maxClusterRadius: number;
}

const captured = vi.hoisted(() => ({
  map: null as CapturedMap | null,
  cluster: null as CapturedCluster | null,
}));

vi.mock('@/components/maps', () => ({
  MapContainer: ({
    children,
    center,
    zoom,
    scrollWheelZoom,
    className,
  }: {
    children?: React.ReactNode;
    center: [number, number];
    zoom: number;
    scrollWheelZoom?: boolean;
    className?: string;
  }) => {
    captured.map = {
      center,
      zoom,
      scrollWheelZoom: !!scrollWheelZoom,
      className: className ?? '',
    };
    return React.createElement('div', { 'data-testid': 'map' }, children);
  },
  MapTileLayer: () => null,
  MarkerCluster: ({
    points,
    defaultColor,
    maxClusterRadius,
  }: {
    points: CapturedPoint[];
    defaultColor?: string;
    maxClusterRadius?: number;
  }) => {
    captured.cluster = {
      points,
      defaultColor: defaultColor ?? '',
      maxClusterRadius: maxClusterRadius ?? 0,
    };
    return null;
  },
}));

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options object so assertions can target the rendered English copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/\{\{(\w+)\}\}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      return key;
    },
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    formatCurrency: (amount: number, decimals = 2) => `$${amount.toFixed(decimals)}`,
    formatEnergyCost: (kwh: number) => `$${(kwh * 0.12).toFixed(2)}`,
    currencySymbol: '$',
    costPerKwh: 0.12,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

import TeslaChargingSessionsMap from '../TeslaChargingSessionsMap';

const baseSession: TeslaChargingSession = {
  id: 1,
  session_id: 1000,
  vin: 'TEST1234567890ABC',
  charger_id: 'charger-1',
  site_location_name: 'Supercharger SF',
  charge_start_datetime: '2024-01-01T12:00:00Z',
  charge_stop_datetime: '2024-01-01T13:00:00Z',
  total_energy_added_wh: 53500,
  peak_power_kw: 150,
  max_charge_rate_kw: 250,
  charge_duration_s: 1800,
  charger_type: 'v3',
  currency_code: 'USD',
  total_cost: 12.5,
  per_kwh_rate: 0.28,
  idle_fee: 0,
  congestion_fee: 0,
  latitude: 37.7,
  longitude: -122.4,
  fetched_at: '2024-01-01T00:00:00Z',
  created_at: '2024-01-01T00:00:00Z',
};

function makeSession(overrides: Partial<TeslaChargingSession> = {}): TeslaChargingSession {
  return { ...baseSession, ...overrides };
}

describe('TeslaChargingSessionsMap', () => {
  beforeEach(() => {
    captured.map = null;
    captured.cluster = null;
  });

  it('renders an accessible map container with default structural props when there are no sessions', () => {
    render(<TeslaChargingSessionsMap sessions={[]} />);

    const app = screen.getByRole('application');
    expect(app).toHaveAttribute('aria-label', 'Charging sessions map');

    expect(captured.map).not.toBeNull();
    expect(captured.map!.center).toEqual([37.77, -122.42]);
    expect(captured.map!.zoom).toBe(5);
    expect(captured.map!.scrollWheelZoom).toBe(true);

    expect(captured.cluster).not.toBeNull();
    expect(captured.cluster!.points).toHaveLength(0);
    expect(captured.cluster!.defaultColor).toBe('#22d3ee');
    expect(captured.cluster!.maxClusterRadius).toBe(60);
  });

  it('centers on the centroid of the sessions that carry coordinates', () => {
    const sessions = [
      makeSession({ session_id: 1, latitude: 10, longitude: 20 }),
      makeSession({ session_id: 2, latitude: 30, longitude: 40 }),
    ];
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    expect(captured.map!.center).toEqual([20, 30]);
    expect(captured.cluster!.points).toHaveLength(2);
    expect(captured.cluster!.points.map((p) => p.id)).toEqual([1, 2]);
  });

  it('ignores null and NaN coordinates when computing the centroid and points (regression)', () => {
    const sessions = [
      makeSession({ session_id: 7, latitude: 40, longitude: -70 }),
      makeSession({ session_id: 8, latitude: null, longitude: null }),
      makeSession({ session_id: 9, latitude: Number.NaN, longitude: Number.NaN }),
    ];
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    // The bad coordinates must neither poison nor skew the centroid.
    expect(Number.isFinite(captured.map!.center[0])).toBe(true);
    expect(captured.map!.center).toEqual([40, -70]);

    expect(captured.cluster!.points).toHaveLength(1);
    expect(captured.cluster!.points[0].lat).toBe(40);
    expect(captured.cluster!.points[0].lng).toBe(-70);
  });

  it('falls back to the default center when no session is placeable', () => {
    const sessions = [
      makeSession({ session_id: 1, latitude: null, longitude: 5 }),
      makeSession({ session_id: 2, latitude: Number.NaN, longitude: Number.NaN }),
    ];
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    expect(Number.isNaN(captured.map!.center[0])).toBe(false);
    expect(captured.map!.center).toEqual([37.77, -122.42]);
    expect(captured.cluster!.points).toHaveLength(0);
  });

  it('builds a popup with the escaped site name, energy, cost and charger type', () => {
    render(<TeslaChargingSessionsMap sessions={[makeSession()]} />);

    const point = captured.cluster!.points[0];
    expect(point.id).toBe(1000);
    expect(point.lat).toBe(37.7);
    expect(point.lng).toBe(-122.4);

    expect(point.popupHtml).toContain('Supercharger SF');
    expect(point.popupHtml).toContain('53.5 kWh');
    expect(point.popupHtml).toContain('$12.50');
    expect(point.popupHtml).toContain('v3');
    expect(point.popupHtml).toContain('text-transform:uppercase');

    expect(point.ariaLabel).toBe('Supercharger SF charging session');
  });

  it('escapes HTML in the site name and charger type to prevent popup XSS', () => {
    const sessions = [
      makeSession({
        site_location_name: '<script>alert(1)</script>',
        charger_type: '<b>x</b>',
      }),
    ];
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    const html = captured.cluster!.points[0].popupHtml;
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;b&gt;');
  });

  it('falls back to "Unknown" when the session has no site name', () => {
    render(<TeslaChargingSessionsMap sessions={[makeSession({ site_location_name: '' })]} />);

    const point = captured.cluster!.points[0];
    expect(point.popupHtml).toContain('Unknown');
    expect(point.ariaLabel).toBe('Unknown charging session');
  });

  it('omits the energy, cost and charger rows when those fields are absent', () => {
    const withoutOptional = {
      ...makeSession({ total_cost: null, charger_type: null }),
      total_energy_added_wh: null,
    } as unknown as TeslaChargingSession;
    render(<TeslaChargingSessionsMap sessions={[withoutOptional]} />);

    const html = captured.cluster!.points[0].popupHtml;
    expect(html).toContain('Supercharger SF');
    expect(html).not.toContain('kWh');
    expect(html).not.toContain('$');
    expect(html).not.toContain('text-transform:uppercase');
  });
});
