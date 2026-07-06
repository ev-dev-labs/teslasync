/**
 * Unit tests for `<AnimatedMarker>`.
 *
 * The component talks straight to Leaflet (`L.divIcon`, `L.latLng`, the marker
 * instance, and the map) via react-leaflet, none of which is jsdom-friendly.
 * We therefore mock:
 *   - `leaflet`        → inspectable `divIcon` / `latLng` fakes.
 *   - `react-leaflet`  → a `Marker` stub that captures the `icon` prop and wires
 *                        the forwarded ref to a fake marker, plus a fake `useMap`.
 *   - `useMotionPreference` / `react-i18next` → deterministic, jsdom-safe stubs.
 *
 * A hoisted cell (`h`) is the shared channel between the mock factories and the
 * test bodies (per vitest hoisting semantics).
 */
import { render, cleanup } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';

type FakeLatLng = { lat: number; lng: number };
type FakeIcon = {
  html?: string;
  iconSize?: [number, number];
  iconAnchor?: [number, number];
};
type PanCall = { latlng: FakeLatLng; opts: { animate: boolean; duration: number } };

const h = vi.hoisted(() => ({
  /** Every icon passed to `<Marker icon={...}>`, newest last. */
  icons: [] as FakeIcon[],
  /** Coordinates handed to the fake marker's `setLatLng`. */
  setLatLngCalls: [] as FakeLatLng[],
  /** Icons handed to the fake marker's `setIcon`. */
  setIconCalls: [] as FakeIcon[],
  /** Result the fake map's `bounds.contains()` returns. */
  containsResult: true,
  /** Every `map.panTo(...)` invocation. */
  panToCalls: [] as PanCall[],
  /** Reduced-motion preference surfaced to the component. */
  reduce: false,
  reset() {
    this.icons.length = 0;
    this.setLatLngCalls.length = 0;
    this.setIconCalls.length = 0;
    this.containsResult = true;
    this.panToCalls.length = 0;
    this.reduce = false;
  },
}));

vi.mock('leaflet', () => {
  const divIcon = (opts: Record<string, unknown>) => ({ ...opts, _divIcon: true });
  const latLng = (lat: number, lng: number): FakeLatLng => ({ lat, lng });
  return { default: { divIcon, latLng }, divIcon, latLng };
});

vi.mock('react-leaflet', () => {
  const marker = {
    setLatLng(target: FakeLatLng) {
      h.setLatLngCalls.push({ lat: target.lat, lng: target.lng });
      return this;
    },
    setIcon(icon: FakeIcon) {
      h.setIconCalls.push(icon);
      return this;
    },
  };
  const Marker = React.forwardRef(
    (props: { icon?: FakeIcon; position?: unknown }, ref: React.Ref<unknown>) => {
      h.icons.push((props.icon ?? {}) as FakeIcon);
      if (typeof ref === 'function') ref(marker);
      else if (ref && typeof ref === 'object') {
        (ref as { current: unknown }).current = marker;
      }
      return null;
    },
  );
  const useMap = () => ({
    getBounds: () => ({ contains: () => h.containsResult }),
    panTo: (latlng: FakeLatLng, opts: { animate: boolean; duration: number }) => {
      h.panToCalls.push({ latlng, opts });
    },
  });
  return { Marker, useMap };
});

vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: h.reduce, durationMs: h.reduce ? 0 : 250 }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback?: string) => fallback ?? _key }),
}));

import { AnimatedMarker } from '../AnimatedMarker';

/** The icon most recently handed to `<Marker>` (post-effect). */
const latestIconHtml = () => h.icons[h.icons.length - 1]?.html ?? '';

describe('AnimatedMarker', () => {
  beforeEach(() => h.reset());
  afterEach(() => cleanup());

  it('renders a Marker whose icon embeds the default color and the replay-pulse keyframes', () => {
    render(<AnimatedMarker position={[37.7749, -122.4194]} />);

    const icon = h.icons[0];
    expect(icon).toBeDefined();
    // Default color from the component's default prop.
    expect(icon.html).toContain('#00b4d8');
    // Regression guard: the pulse animation is referenced but was never
    // declared globally — the keyframes MUST ship inside the icon markup.
    expect(icon.html).toContain('animation:replay-pulse');
    expect(icon.html).toContain('@keyframes replay-pulse');
    // Icon geometry is preserved.
    expect(icon.iconSize).toEqual([24, 24]);
    expect(icon.iconAnchor).toEqual([12, 12]);
  });

  it('honors a custom marker color', () => {
    render(<AnimatedMarker position={[1, 2]} color="#ff0000" />);
    expect(latestIconHtml()).toContain('#ff0000');
    expect(latestIconHtml()).not.toContain('#00b4d8');
  });

  it('exposes an accessible role + default translated label on the icon', () => {
    render(<AnimatedMarker position={[1, 2]} />);
    expect(latestIconHtml()).toContain('role="img"');
    expect(latestIconHtml()).toContain('aria-label="Vehicle position"');
  });

  it('lets callers override the accessible label', () => {
    render(<AnimatedMarker position={[1, 2]} ariaLabel="Model 3 live position" />);
    expect(latestIconHtml()).toContain('aria-label="Model 3 live position"');
  });

  it('rotates the marker to the supplied heading', () => {
    render(<AnimatedMarker position={[1, 2]} heading={90} />);
    expect(latestIconHtml()).toContain('rotate(90deg)');
  });

  it('rotates to 0deg for a zero heading but omits rotation entirely when heading is absent', () => {
    render(<AnimatedMarker position={[1, 2]} heading={0} />);
    expect(latestIconHtml()).toContain('rotate(0deg)');

    h.reset();
    render(<AnimatedMarker position={[1, 2]} />);
    expect(latestIconHtml()).not.toContain('rotate(');
  });

  it('does not emit a rotation for a non-finite heading', () => {
    render(<AnimatedMarker position={[1, 2]} heading={Number.NaN} />);
    expect(latestIconHtml()).not.toContain('rotate(');
  });

  it('pushes the position to the Leaflet marker via setLatLng on mount', () => {
    render(<AnimatedMarker position={[37.7749, -122.4194]} />);
    expect(h.setLatLngCalls).toHaveLength(1);
    expect(h.setLatLngCalls[0]).toEqual({ lat: 37.7749, lng: -122.4194 });
    // The memoized icon is reused for the imperative Leaflet swap.
    expect(h.setIconCalls[0]).toBe(h.icons[0]);
  });

  it('pans the map when the target falls outside the current bounds', () => {
    h.containsResult = false;
    render(<AnimatedMarker position={[10, 20]} />);
    expect(h.panToCalls).toHaveLength(1);
    expect(h.panToCalls[0].latlng).toEqual({ lat: 10, lng: 20 });
    expect(h.panToCalls[0].opts.animate).toBe(true);
    expect(h.panToCalls[0].opts.duration).toBe(0.3);
  });

  it('does not pan when the target is already within the viewport', () => {
    h.containsResult = true;
    render(<AnimatedMarker position={[10, 20]} />);
    expect(h.panToCalls).toHaveLength(0);
  });

  it('recenters without animation when reduced motion is requested', () => {
    h.reduce = true;
    h.containsResult = false;
    render(<AnimatedMarker position={[10, 20]} />);
    expect(h.panToCalls).toHaveLength(1);
    expect(h.panToCalls[0].opts.animate).toBe(false);
    expect(h.panToCalls[0].opts.duration).toBe(0);
  });

  it('skips the map update entirely for non-finite coordinates', () => {
    h.containsResult = false;
    render(<AnimatedMarker position={[Number.NaN, Number.NaN]} />);
    expect(h.setLatLngCalls).toHaveLength(0);
    expect(h.panToCalls).toHaveLength(0);
  });

  it('re-applies setLatLng when the position prop changes', () => {
    const { rerender } = render(<AnimatedMarker position={[1, 1]} />);
    expect(h.setLatLngCalls[h.setLatLngCalls.length - 1]).toEqual({ lat: 1, lng: 1 });

    rerender(<AnimatedMarker position={[2, 3]} />);
    expect(h.setLatLngCalls[h.setLatLngCalls.length - 1]).toEqual({ lat: 2, lng: 3 });
  });
});
