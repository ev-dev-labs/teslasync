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

function optionsOf(icon: L.DivIcon) {
  const { html } = icon.options;
  if (typeof html !== 'string') throw new Error('Expected marker HTML string');
  return { ...icon.options, html };
}

describe('DEFAULT_VEHICLE_COLOR', () => {
  it('intentionally replaces the old cyan default with the trusted DOM info role', () => {
    expect(DEFAULT_VEHICLE_COLOR).toBe('var(--semantic-info)');
  });
});

describe('sanitizeColor', () => {
  it('falls back to the default for nullish / non-string input', () => {
    expect(sanitizeColor(undefined)).toBe(DEFAULT_VEHICLE_COLOR);
    expect(sanitizeColor(null)).toBe(DEFAULT_VEHICLE_COLOR);
    expect(Reflect.apply(sanitizeColor, undefined, [0xff])).toBe(DEFAULT_VEHICLE_COLOR);
    expect(Reflect.apply(sanitizeColor, undefined, [{}])).toBe(DEFAULT_VEHICLE_COLOR);
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

  it.each([
    'var(--caller-paint)',
    'var(--semantic-info, red)',
    'var(--semantic-info);background:url(javascript:alert(1))',
  ])('rejects untrusted CSS reference %j without broadening the grammar', (bad) => {
    expect(sanitizeColor(bad)).toBe('var(--semantic-info)');
    expect(optionsOf(vehicleIcon(bad)).html).not.toContain(bad);
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

  it('embeds the default color without ambient animation or glow', () => {
    const { html } = optionsOf(vehicleIcon());
    expect(html).toContain(`background:${DEFAULT_VEHICLE_COLOR}`);
    expect(html.match(/background:var\(--semantic-info\)/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('box-shadow');
    expect(html).not.toContain('<style');
    expect(html).not.toContain('animation:');
    expect(html).toContain('border:2px solid var(--surface-1)');
    expect(html).not.toContain('solid white');
  });

  it('embeds a supplied valid color at every paint site', () => {
    const { html } = optionsOf(vehicleIcon('#ff3366'));
    // Both backgrounds retain the supplied color without a decorative glow.
    expect(html.match(/#ff3366/g) ?? []).toHaveLength(2);
    expect(html).not.toContain(DEFAULT_VEHICLE_COLOR);
  });

  it('normalises an empty-string color back to the default', () => {
    const { html } = optionsOf(vehicleIcon(''));
    expect(html).toContain(`background:${DEFAULT_VEHICLE_COLOR}`);
    expect(html).not.toContain('background:;');
  });

  it('retains the marker DOM, fixed geometry and static halo', () => {
    const host = document.createElement('div');
    host.innerHTML = optionsOf(vehicleIcon('#abcdef')).html;
    const root = host.firstElementChild;
    expect(host.children).toHaveLength(1);
    expect(root?.tagName).toBe('DIV');
    expect(root?.getAttribute('style')).toBe('width:28px;height:28px;position:relative');
    expect(root?.children).toHaveLength(2);
    const halo = root?.children[0];
    const dot = root?.children[1];
    expect(halo?.tagName).toBe('DIV');
    expect(halo?.getAttribute('style')).toContain('position:absolute;inset:0;border-radius:50%');
    expect(halo?.getAttribute('style')).toContain('background:#abcdef;opacity:0.25');
    expect(dot?.tagName).toBe('DIV');
    expect(dot?.getAttribute('style')).toContain('position:absolute;inset:5px;border-radius:50%');
    expect(dot?.getAttribute('style')).toContain('background:#abcdef;border:2px solid var(--surface-1)');
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

  it.each([
    undefined,
    null,
    '',
    ' \t\n ',
    '#12',
    '#fff"></div><img src=x onerror=alert(1)>',
    'var(--caller-paint)',
    DEFAULT_VEHICLE_COLOR,
  ])('uses only the trusted info default at both paint sites for %j', (color) => {
    const icon = Reflect.apply(vehicleIcon, undefined, [color]);
    const { html } = optionsOf(icon);
    expect(html.match(/background:var\(--semantic-info\)/g) ?? []).toHaveLength(2);
    expect(html).not.toContain('#00f0ff');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('--caller-paint');
    expect(html).not.toContain('animation:');
    expect(html).not.toContain('box-shadow');
    expect(html).toContain('opacity:0.25');
    expect(html).toContain('border:2px solid var(--surface-1)');
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
  ])('preserves explicit physical/custom paint %j exactly at both sites', (color) => {
    const { html } = optionsOf(vehicleIcon(color));
    expect(html.split(`background:${color}`).length - 1).toBe(2);
    expect(html).not.toContain('var(--semantic-info)');
  });
});
