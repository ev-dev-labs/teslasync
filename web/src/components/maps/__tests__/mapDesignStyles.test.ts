import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import { afterEach, describe, expect, it } from 'vitest';
import * as nativeMaps from 'react-leaflet';
import * as sharedMaps from '../index';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';

const css = readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'maps.css'), 'utf8');
const sheet = postcss.parse(css);
const rules: Rule[] = [];
sheet.walkRules(rule => { rules.push(rule); });
const releases: Array<() => void> = [];

afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  for (const attribute of Object.keys(getAppDesignAttributes('classic'))) {
    document.documentElement.removeAttribute(attribute);
  }
});

describe('application map design boundary', () => {
  it('retains the native container, layer, popup and hook identities', () => {
    for (const name of ['MapContainer', 'Marker', 'Popup', 'Polyline', 'CircleMarker', 'useMap'] as const) {
      expect(sharedMaps[name]).toBe(nativeMaps[name]);
    }
  });

  it('keeps every style opt-in, screen-only and outside OS forced colors', () => {
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule.selector).toMatch(/^:is\(:root, \[data-app-design-preview\]\)/);
      expect(rule.selector).toContain('[data-app-design-pack]');
      expect(rule.selector).toMatch(/:where\(\[data-app-design-owner(?:~="[^"]+")?\]\)(?:::[\w-]+)?$/);
      expect(rule.selector).not.toContain(':scope');
      let node = rule.parent;
      while (node?.parent) node = node.parent;
      expect(node).toBe(sheet);
      let ancestor = rule.parent;
      while (ancestor?.parent !== sheet) ancestor = ancestor?.parent;
      expect(ancestor).toMatchObject({ name: 'media', params: 'screen and (forced-colors: none)' });
    }
    sheet.walkAtRules(atRule => {
      expect(atRule.name).not.toBe('scope');
    });
  });

  it('activates only the nearest complete profile, not an ancestor root or sibling preview', () => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(getAppDesignAttributes('v1'))) root.setAttribute(name, value);
    const hosts: Array<{ host: HTMLElement; family: string }> = [{ host: root, family: 'instrument' }];
    for (const pack of ['atlas', 'quiet', 'classic'] as const) {
      const host = document.createElement('section');
      host.setAttribute('data-app-design-preview', '');
      for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
      document.body.appendChild(host);
      hosts.push({ host, family: APPLICATION_DESIGNS[pack].map });
    }
    // Include a preview inside another preview, not just sibling hosts.
    hosts[1].host.appendChild(hosts[3].host);
    for (const { host } of hosts) {
      const toolbar = document.createElement('div');
      toolbar.setAttribute('data-map-control', 'layers');
      (host === root ? document.body : host).appendChild(toolbar);
    }
    releases.push(observeAppDesignScopes(root));
    for (const { host, family } of hosts) {
      const toolbar = (host === root ? document.body : host).lastElementChild!;
      const families = new Set(
        rules.filter(rule =>
          rule.selector.includes('[data-app-map="') &&
          toolbar.matches(rule.selector),
        ).map(rule => /\[data-app-map="([^"]+)"\]/.exec(rule.selector)?.[1]),
      );
      expect([...families]).toEqual([family]);
      toolbar.removeAttribute('data-app-design-owner');
      expect(rules.some(rule => toolbar.matches(rule.selector))).toBe(false);
    }
  });

  it('gives all 27 packs structural layer, popup, marker, legend and playback compositions', () => {
    expect(Object.keys(APPLICATION_DESIGNS)).toHaveLength(27);
    for (const family of new Set(Object.values(APPLICATION_DESIGNS).map(design => design.map))) {
      const familyRules = rules.filter(rule => rule.selector.includes(`[data-app-map="${family}"]`));
      for (const part of [
        '[data-map-control="layers"]', '.leaflet-popup-content-wrapper',
        '[data-map-marker="cluster"]', '[data-app-part~="map-legend"]',
        '[data-map-control="playback"]', '.leaflet-draw-toolbar',
      ]) {
        expect(familyRules.some(rule =>
          rule.selector.includes(part) && rule.nodes.some(node =>
            node.type === 'decl' && /^(?:display|gap|padding|border|outline|grid-template)/.test(node.prop))),
        ).toBe(true);
      }
    }
  });

  it('requires vendor descendants and pseudo-element origins to own their nearest profile themselves', () => {
    for (const [name, value] of Object.entries(getAppDesignAttributes('v1'))) document.documentElement.setAttribute(name, value);
    const host = document.createElement('section');
    host.setAttribute('data-app-design-preview', '');
    for (const [name, value] of Object.entries(getAppDesignAttributes('atlas'))) host.setAttribute(name, value);
    host.innerHTML = '<div class="leaflet-container"><div class="leaflet-popup-content-wrapper"><div class="leaflet-popup-content"><span>Observation</span></div></div><a class="leaflet-control-layers-toggle"></a><div class="leaflet-control-attribution"><a>Provider credits</a></div><div class="leaflet-draw-toolbar"><a class="leaflet-draw-draw-polygon"></a></div></div>';
    document.body.append(host);
    releases.push(observeAppDesignScopes(host));
    for (const element of host.querySelectorAll('.leaflet-container *')) {
      const applicable = rules.filter(rule => element.matches(rule.selector.replace(/::[\w-]+$/, '')));
      expect(applicable.length).toBeGreaterThan(0);
      for (const rule of applicable.filter(candidate => candidate.selector.includes('[data-app-map="'))) {
        expect(rule.selector).toContain('[data-app-map="atlas"]');
      }
      element.removeAttribute('data-app-design-owner');
      expect(rules.some(rule => element.matches(rule.selector.replace(/::[\w-]+$/, '')))).toBe(false);
    }
  });

  it('never rewrites tile filters, geographic transforms, path paint, images or visibility', () => {
    for (const rule of rules) {
      expect(rule.selector).not.toMatch(/leaflet-(?:tile|pane|overlay-pane)|\b(?:img|video)\b.*(?:filter|opacity)/);
      rule.walkDecls(declaration => {
        expect(declaration.prop).not.toMatch(/^(?:filter|transform|translate|rotate|stroke|fill|opacity|visibility|clip-path|z-index)$/);
        expect(declaration.prop).not.toMatch(/^--/);
        expect(declaration).not.toMatchObject({ prop: 'display', value: 'none' });
      });
    }
  });

  it('reserves selection, focus and explicit trust states without inferring vehicle state', () => {
    for (const selector of [
      ':hover', ':focus-visible', '[aria-pressed="true"]', ':disabled',
      '[data-map-state="stale"]', '[data-map-state="error"]',
      '[data-map-state="loading"]', '[data-map-state="empty"]',
      '[data-map-state="unavailable"]', '.leaflet-edit-marker-selected',
    ]) {
      expect(rules.some(rule => rule.selector.includes(selector))).toBe(true);
    }
    expect(rules.some(rule => rule.selector.includes('[data-state="online"]'))).toBe(false);
    const descriptors = rules.filter(rule => rule.selector.includes('[data-app-map="'));
    for (const rule of descriptors) {
      expect(rule.selector).toContain(':where([data-app-map=');
    }
  });

  it('keeps attribution readable, bounded and linked rather than hiding or fading credits', () => {
    const attribution = rules.find(rule =>
      rule.selector.endsWith(' .leaflet-control-attribution:where([data-app-design-owner])'));
    const declarations = Object.fromEntries(
      (attribution?.nodes ?? []).flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : []),
    );
    expect(declarations).toMatchObject({
      'white-space': 'normal', 'overflow-wrap': 'anywhere',
      'max-inline-size': '100%', background: 'var(--surface-1)',
    });
    expect(rules.some(rule =>
      rule.selector.endsWith('.leaflet-control-attribution a:where([data-app-design-owner])'))).toBe(true);
  });

  it('uses the actual user leading and weight roles without replacing centered control glyphs', () => {
    const readable = [
      '.leaflet-container', '.leaflet-popup-content', '.leaflet-tooltip',
      '.leaflet-draw-tooltip', '.leaflet-control-attribution', '.leaflet-control-scale-line',
      '.leaflet-draw-actions a',
    ];
    for (const selector of readable) {
      expect(rules.some(rule =>
        rule.selector.endsWith(` ${selector}:where([data-app-design-owner])`) &&
        rule.nodes.some(node => node.type === 'decl' && node.prop === 'line-height' && node.value === 'var(--leading)'),
      )).toBe(true);
    }
    sheet.walkDecls('line-height', declaration => {
      expect(['var(--leading)', '2.75rem']).toContain(declaration.value);
    });
    sheet.walkDecls('font-weight', declaration => {
      expect(['var(--font-weight-normal)', 'var(--font-weight-medium)', 'var(--font-weight-bold)']).toContain(declaration.value);
    });
    expect(rules.some(rule =>
      rule.selector.includes('.leaflet-bar a') &&
      rule.nodes.some(node => node.type === 'decl' && node.prop === 'line-height' && node.value === '2.75rem'),
    )).toBe(true);
  });
});
