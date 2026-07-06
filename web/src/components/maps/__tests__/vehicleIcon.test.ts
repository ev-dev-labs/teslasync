/**
 * Unit tests for `vehicleIcon` + its color-hardening helpers.
 *
 * `L.divIcon` is a pure options factory, but we mock leaflet (matching the
 * sibling MarkerCluster / GeofenceDrawer tests) so the returned icon exposes the
 * exact options object. That lets the tests assert on the generated marker HTML
 * — including the injection-safety guarantees — without touching the DOM.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('leaflet', () => {
  const divIcon = vi.fn((opts: Record<string, unknown>) => ({
    options: opts,
    _divIcon: true,
  }));
  const Lmod = { divIcon };
  return { default: Lmod, ...Lmod };
});

import L from 'leaflet';
import {
  vehicleIcon,
  sanitizeColor,
  DEFAULT_VEHICLE_COLOR,
} from '../vehicleIcon';

type IconOptions = {
  className: string;
  iconSize: [number, number];
  iconAnchor: [number, number];
  popupAnchor: [number, number];
  html: string;
};

function optionsOf(icon: unknown): IconOptions {
  return (icon as unknown as { options: IconOptions }).options;
}

describe('DEFAULT_VEHICLE_COLOR', () => {
  it('is the neon-cyan accent hex used across the map surfaces', () => {
    expect(DEFAULT_VEHICLE_COLOR).toBe('#00f0ff');
  });
});

describe('sanitizeColor', () => {
  it('falls back to the default for nullish / non-string input', () => {
    expect(sanitizeColor(undefined)).toBe(DEFAULT_VEHICLE_COLOR);
    expect(sanitizeColor(null)).toBe(DEFAULT_VEHICLE_COLOR);
    expect(sanitizeColor(0xff as unknown as string)).toBe(DEFAULT_VEHICLE_COLOR);
    expect(sanitizeColor({} as unknown as string)).toBe(DEFAULT_VEHICLE_COLOR);
  });

  it('falls back to the default for blank / whitespace-only strings', () => {
    expect(sanitizeColor('')).toBe(DEFAULT_VEHICLE_COLOR);
    expect(sanitizeColor('   ')).toBe(DEFAULT_VEHICLE_COLOR);
    expect(sanitizeColor('\t\n')).toBe(DEFAULT_VEHICLE_COLOR);
  });

  it.each([
    '#fff',
    '#ffff',
    '#00f0ff',
    '#00f0ffcc',
    '#ABCDEF',
    'rgb(0, 240, 255)',
    'rgba(0,240,255,0.5)',
    'hsl(187, 100%, 50%)',
    'hsla(187,100%,50%,0.5)',
    'red',
    'cornflowerblue',
  ])('passes through the valid CSS color %j unchanged', (color) => {
    expect(sanitizeColor(color)).toBe(color);
  });

  it('trims surrounding whitespace from an otherwise valid color', () => {
    expect(sanitizeColor('  #abcdef  ')).toBe('#abcdef');
    expect(sanitizeColor('\tred ')).toBe('red');
  });

  it.each([
    '#fff"></div><img src=x onerror=alert(1)>',
    'red;position:absolute;top:0',
    'url(javascript:alert(1))',
    'rgb(0,0,0)</style><script>alert(1)</script>',
    'expression(alert(1))',
    '#12',
    '#12345',
    '#1234567',
    'not a color!',
    '<b>',
  ])('rejects the unsafe / malformed value %j and uses the default', (bad) => {
    expect(sanitizeColor(bad)).toBe(DEFAULT_VEHICLE_COLOR);
  });
});

describe('vehicleIcon', () => {
  it('builds a DivIcon with the expected geometry options', () => {
    const opts = optionsOf(vehicleIcon());
    expect(opts.className).toBe('');
    expect(opts.iconSize).toEqual([28, 28]);
    expect(opts.iconAnchor).toEqual([14, 14]);
    expect(opts.popupAnchor).toEqual([0, -14]);
    expect(L.divIcon).toHaveBeenCalled();
  });

  it('embeds the default color and pulse animation when called with no args', () => {
    const { html } = optionsOf(vehicleIcon());
    expect(html).toContain(`background:${DEFAULT_VEHICLE_COLOR}`);
    expect(html).toContain(`box-shadow:0 0 10px ${DEFAULT_VEHICLE_COLOR}`);
    expect(html).toContain('@keyframes vehicle-pulse');
    expect(html).toContain('animation:vehicle-pulse 2s ease-in-out infinite');
  });

  it('embeds a supplied valid color at every paint site', () => {
    const { html } = optionsOf(vehicleIcon('#ff3366'));
    // two backgrounds + one box-shadow glow all use the supplied color
    expect(html.match(/#ff3366/g) ?? []).toHaveLength(3);
    expect(html).not.toContain(DEFAULT_VEHICLE_COLOR);
  });

  it('normalises an empty-string color back to the default', () => {
    const { html } = optionsOf(vehicleIcon(''));
    expect(html).toContain(`background:${DEFAULT_VEHICLE_COLOR}`);
    expect(html).not.toContain('background:;');
  });

  it('never lets an injection payload reach the marker HTML', () => {
    const payload = '#fff"></div><img src=x onerror=alert(1)>';
    const { html } = optionsOf(vehicleIcon(payload));
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('alert(1)');
    // falls back to the safe default instead of the attacker-controlled value
    expect(html).toContain(`background:${DEFAULT_VEHICLE_COLOR}`);
  });
});
