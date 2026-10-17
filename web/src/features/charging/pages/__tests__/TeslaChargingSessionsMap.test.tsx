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
import { act, render, screen } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import React from 'react';

import type { TeslaChargingSession } from '@/api/hooks/useCharging';
import { setGlobalLocale, setGlobalPrecision } from '@/lib/numberFormat';

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
    setGlobalLocale('en-US');
    setGlobalPrecision(2);
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
    expect(captured.cluster!.defaultColor).toBe('var(--semantic-info)');
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

  it('uses the restrained DOM marker role without overriding populated points or popups', () => {
    render(<TeslaChargingSessionsMap sessions={[makeSession()]} />);

    expect(captured.cluster!.defaultColor).toBe('var(--semantic-info)');
    expect(captured.cluster!.maxClusterRadius).toBe(60);
    expect(captured.cluster!.points).toHaveLength(1);
    expect(captured.cluster!.points[0]).toEqual({
      id: 1000,
      lat: 37.7,
      lng: -122.4,
      popupHtml: expect.stringContaining('Supercharger SF'),
      ariaLabel: 'Supercharger SF charging session',
    });
    expect(captured.cluster!.points[0].popupHtml).toContain('53.50 kWh');
    expect(captured.cluster!.points[0].popupHtml).toContain('$12.50');
    expect(captured.cluster!.points[0].popupHtml).toContain('<p>v3</p>');
    expect(captured.cluster!.points[0]).not.toHaveProperty('color');
  });

  it('updates populated session points and popups while retaining shared marker paint', () => {
    const { rerender } = render(<TeslaChargingSessionsMap sessions={[makeSession()]} />);
    rerender(<TeslaChargingSessionsMap sessions={[
      makeSession({ session_id: 2000, site_location_name: 'Next site', latitude: 40, longitude: -70 }),
    ]} />);

    expect(captured.map!.center).toEqual([40, -70]);
    expect(captured.cluster!.defaultColor).toBe('var(--semantic-info)');
    expect(captured.cluster!.points).toHaveLength(1);
    expect(captured.cluster!.points[0]).toMatchObject({
      id: 2000, lat: 40, lng: -70, ariaLabel: 'Next site charging session',
    });
    expect(captured.cluster!.points[0].popupHtml).toContain('Next site');
    expect(captured.cluster!.points[0].popupHtml).not.toContain('Supercharger SF');
    expect(captured.cluster!.points[0].popupHtml).not.toMatch(/box-shadow|text-shadow|drop-shadow/);
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
    expect(point.popupHtml).toContain('53.50 kWh');
    expect(point.popupHtml).toContain('$12.50');
    expect(point.popupHtml).toContain('v3');
    expect(point.popupHtml).toContain('<p>v3</p>');
    expect(point.popupHtml).not.toContain('text-transform:uppercase');

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

  it('formats each recorded currency with effective locale and precision, preserving signs and IDs', () => {
    const sessions = [
      makeSession({ session_id: 41, currency_code: ' eur ', total_cost: -1234.5678 }),
      makeSession({ session_id: 42, currency_code: 'GBP', total_cost: 0 }),
    ];
    render(<TeslaChargingSessionsMap sessions={sessions} />);

    expect(captured.cluster!.points[0].popupHtml).toContain('-€1,234.57');
    expect(captured.cluster!.points[1].popupHtml).toContain('£0.00');

    act(() => {
      setGlobalLocale('de-DE');
      setGlobalPrecision(3);
    });

    expect(captured.cluster!.points.map(point => point.id)).toEqual([41, 42]);
    expect(captured.cluster!.points[0].popupHtml).toContain('-1.234,568\u00a0€');
    expect(captured.cluster!.points[1].popupHtml).toContain('0,000\u00a0£');
  });

  it.each([null, '', ' ', 'XXX', 'XTS', 'ZZZ', '<b>USD</b>'])(
    'qualifies unknown currency %s without assuming the user currency',
    currency_code => {
      render(<TeslaChargingSessionsMap sessions={[
        makeSession({ session_id: 55, currency_code, total_cost: -12.5 }),
      ]} />);

      const point = captured.cluster!.points[0];
      expect(point.id).toBe(55);
      expect(point.popupHtml).toContain('<p>-12.50 · Unknown currency</p>');
      expect(point.popupHtml).not.toContain('$');
      expect(point.popupHtml).not.toContain('<b>');
    },
  );

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
