import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type Rule } from 'postcss';
import ts from 'typescript';
import { createElement } from 'react';
import { render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { applyFontCSS, type FontPrefs } from '@/components/ui/FontProvider';
import { AppDesignPortal } from '@/components/ui/AppDesignPortal';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';

const rules: Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'maps.css'), 'utf8'))
  .walkRules(rule => { rules.push(rule); });
const releases: Array<() => void> = [];
const originalStyle = document.documentElement.getAttribute('style');

const paths = {
  overview: resolve('src', 'features', 'maps', 'pages', 'MapOverviewPage.tsx'),
  replay: resolve('src', 'features', 'trips', 'pages', 'TripReplayPage.tsx'),
  route: resolve('src', 'features', 'driving', 'components', 'drive-detail', 'RouteMapSection.tsx'),
  replayMap: resolve('src', 'features', 'trips', 'components', 'TripReplayMap.tsx'),
  location: resolve('src', 'features', 'dashboard', 'widgets', 'LocationMapWidget.tsx'),
};
const openings = Object.fromEntries(Object.entries(paths).map(([name, path]) => {
  const file = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const attributes: Array<Record<string, string>> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const values: Record<string, string> = {};
      for (const attribute of node.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer)) {
          values[attribute.name.getText(file)] = attribute.initializer.text;
        }
      }
      attributes.push(values);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [name, attributes];
}));

// Use the shipped attributes/classes, not an invented marker fixture. This
// projects the documented static slots only; it does not render page queries,
// Leaflet, portal lifecycle or browser layout.
function slot(source: keyof typeof paths, part: string, match: (attributes: Record<string, string>) => boolean = () => true) {
  const attributes = openings[source].find(values => values['data-app-part']?.split(/\s+/).includes(part) && match(values));
  if (!attributes) throw new Error(`Missing production map slot: ${source}/${part}`);
  const element = document.createElement(attributes.as ?? 'div');
  for (const [name, value] of Object.entries(attributes)) {
    if (name !== 'as') element.setAttribute(name === 'className' ? 'class' : name, value);
  }
  return element;
}

function profile(host: HTMLElement, pack: PackId) {
  for (const [name, value] of Object.entries(getAppDesignAttributes(pack))) host.setAttribute(name, value);
}

function preview(pack: PackId) {
  const host = document.createElement('section');
  host.setAttribute('data-app-design-preview', '');
  profile(host, pack);
  return host;
}

function consumers(host: HTMLElement) {
  const overviewStage = slot('overview', 'map-stage');
  const overviewSplit = slot('overview', 'map-split');
  const overviewMap = slot('overview', 'map');
  const overviewDetails = slot('overview', 'map-details');
  const overviewHeading = slot('overview', 'list-heading');
  const mode = slot('overview', 'map-toolbar', values => values['data-map-control'] === 'mode');
  overviewStage.append(mode, overviewSplit);
  overviewSplit.append(overviewMap, overviewDetails);
  overviewDetails.append(overviewHeading);

  const replayStage = slot('replay', 'map-stage');
  const replaySplit = slot('replay', 'map-split');
  const replayMap = slot('replay', 'map');
  const replayDetails = slot('replay', 'map-details');
  const replayHeading = slot('replay', 'map-toolbar', values => values['data-map-control'] === 'sources');
  const transport = slot('replay', 'map-toolbar', values => values['data-map-control'] === 'playback');
  replayStage.append(replaySplit, transport);
  replaySplit.append(replayMap, replayDetails);
  replayDetails.append(replayHeading);

  const routeStage = slot('route', 'map-stage');
  const routeMap = slot('route', 'map');
  const provenance = slot('route', 'map-provenance');
  const legends = [
    slot('route', 'map-legend', values => values['data-map-legend'] === 'fsd-evidence'),
    slot('route', 'map-legend', values => values['data-map-legend'] === 'speed'),
    slot('route', 'map-legend', values => values['data-map-legend'] === 'endpoints'),
    slot('replayMap', 'map-legend'),
    slot('location', 'map-legend'),
  ];
  routeStage.append(routeMap, ...legends);
  routeMap.append(provenance);
  host.append(overviewStage, replayStage, routeStage);
  return {
    stages: [overviewStage, replayStage, routeStage],
    splits: [overviewSplit, replaySplit],
    maps: [overviewMap, replayMap, routeMap],
    details: [overviewDetails, replayDetails],
    headings: [overviewHeading, replayHeading, mode],
    provenance, transport, legends,
  };
}

function familyRules(element: Element) {
  return rules.filter(rule => rule.selector.includes('[data-app-map="') && element.matches(rule.selector));
}

function properties(rule: Rule) {
  return Object.fromEntries(rule.nodes.flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : []));
}

afterEach(() => {
  for (const release of releases.splice(0)) release();
  document.body.replaceChildren();
  for (const name of Object.keys(getAppDesignAttributes('classic'))) document.documentElement.removeAttribute(name);
  if (originalStyle === null) document.documentElement.removeAttribute('style');
  else document.documentElement.setAttribute('style', originalStyle);
});

describe('guarded map compositions at adopted feature slots', () => {
  it.each(PACK_IDS)('connects %s to real stage, split/details, source, provenance and transport consumers', pack => {
    const mode = APPLICATION_DESIGNS[pack].map;
    profile(document.documentElement, mode === 'instrument' ? 'quiet' : 'v1');
    const host = preview(pack);
    const overlay = preview(pack);
    const sources = slot('overview', 'map-sources');
    overlay.append(sources);
    document.body.append(host, overlay);
    const slots = consumers(host);
    releases.push(observeAppDesignScopes(host), observeAppDesignScopes(overlay));
    for (const element of [...slots.stages, ...slots.details, ...slots.headings, slots.provenance, slots.transport, ...slots.legends, sources]) {
      const matched = familyRules(element);
      expect(matched.length, element.outerHTML).toBeGreaterThan(0);
      expect(new Set(matched.map(rule => /\[data-app-map="([^"]+)"\]/.exec(rule.selector)?.[1]))).toEqual(new Set([mode]));
      expect(matched.some(rule => Object.keys(properties(rule)).some(property =>
        /^(?:border|outline|box-shadow|background|padding)/.test(property),
      ))).toBe(true);
    }
    for (const details of slots.details) {
      expect(familyRules(details).some(rule => rule.selector.includes('[data-app-part~="map-split"] >'))).toBe(true);
    }
  });

  it('switches nested and body-overlay profiles without borrowing an ancestor or accepting a partial profile', async () => {
    profile(document.documentElement, 'v1');
    const parent = preview('atlas');
    const nested = preview('quiet');
    const sibling = preview('classic');
    const overlay = preview('quiet');
    parent.append(nested);
    document.body.append(parent, sibling, overlay);
    const stage = consumers(nested).stages[0];
    const siblingStage = consumers(sibling).stages[0];
    const source = slot('overview', 'map-sources');
    overlay.append(source);
    releases.push(observeAppDesignScopes(document.documentElement), observeAppDesignScopes(parent), observeAppDesignScopes(overlay));
    const modes = (element: Element) => new Set(familyRules(element).map(rule =>
      /\[data-app-map="([^"]+)"\]/.exec(rule.selector)?.[1]));
    expect(modes(stage)).toEqual(new Set(['minimal']));
    expect(modes(source)).toEqual(new Set(['minimal']));
    expect(modes(siblingStage)).toEqual(new Set(['framed']));
    profile(nested, 'classic');
    await waitFor(() => expect(modes(stage)).toEqual(new Set(['framed'])));
    expect(modes(source)).toEqual(new Set(['minimal']));
    nested.removeAttribute('data-app-map');
    await waitFor(() => expect(stage).not.toHaveAttribute('data-app-design-owner'));
    expect(rules.some(rule => stage.matches(rule.selector))).toBe(false);
    source.removeAttribute('data-app-design-owner');
    expect(rules.some(rule => source.matches(rule.selector))).toBe(false);
    expect(modes(siblingStage)).toEqual(new Set(['framed']));
  });

  it('activates the source composition through the real body portal and retains the node across profile changes', async () => {
    profile(document.documentElement, 'v1');
    const source = slot('overview', 'map-sources');
    const attributes = Object.fromEntries([...source.attributes].map(attribute =>
      [attribute.name === 'class' ? 'className' : attribute.name, attribute.value]));
    const view = (pack: PackId) => createElement('section',
      { 'data-app-design-preview': '', ...getAppDesignAttributes(pack) },
      createElement(AppDesignPortal, { children: createElement('div', attributes, 'Complete source explanation') }));
    const mounted = render(view('atlas'));
    try {
      const bodySource = document.querySelector('[data-app-design-portal] [data-app-part~="map-sources"]')!;
      expect(mounted.container.contains(bodySource)).toBe(false);
      await waitFor(() => expect(bodySource).toHaveAttribute('data-app-design-owner', expect.stringContaining('map-atlas')));
      expect(familyRules(bodySource).every(rule => rule.selector.includes('[data-app-map="atlas"]'))).toBe(true);
      expect(familyRules(bodySource).length).toBeGreaterThan(0);
      mounted.rerender(view('quiet'));
      await waitFor(() => expect(bodySource).toHaveAttribute('data-app-design-owner', expect.stringContaining('map-minimal')));
      expect(document.querySelector('[data-app-design-portal] [data-app-part~="map-sources"]')).toBe(bodySource);
      expect(familyRules(bodySource).every(rule => rule.selector.includes('[data-app-map="minimal"]'))).toBe(true);
      expect(familyRules(bodySource).length).toBeGreaterThan(0);
    } finally {
      mounted.unmount();
    }
  });

  it('keeps the four feature chrome compositions distinct rather than aliasing a single skin', () => {
    const signatures = new Set<string>();
    for (const pack of ['v1', 'atlas', 'quiet', 'classic'] as const) {
      const host = preview(pack);
      const slots = consumers(host);
      const source = slot('overview', 'map-sources');
      host.append(source);
      document.body.append(host);
      releases.push(observeAppDesignScopes(host));
      signatures.add(JSON.stringify([slots.stages[0], slots.details[0], slots.headings[0], slots.provenance, source]
        .map(element => familyRules(element).map(properties))));
    }
    expect(signatures.size).toBe(4);
  });

  it('never boxes mobile contents, changes tracks/order/heights or consumes map viewport space in any state', () => {
    profile(document.documentElement, 'v1');
    const host = preview('v1');
    document.body.append(host);
    const slots = consumers(host);
    releases.push(observeAppDesignScopes(host));
    const protectedElements = [...slots.stages, ...slots.splits, ...slots.maps, ...slots.details];
    for (const element of protectedElements) {
      for (const [mode, pack] of [
        ['instrument', 'v1'], ['atlas', 'atlas'], ['minimal', 'quiet'], ['framed', 'classic'],
      ] as const) {
        profile(host, pack);
        element.setAttribute('data-app-design-owner', `map-${mode}`);
        for (const state of ['loading', 'empty', 'error', 'stale', 'unavailable']) {
          element.setAttribute('data-map-state', state);
          for (const rule of rules.filter(candidate => element.matches(candidate.selector))) {
            for (const property of Object.keys(properties(rule))) {
              expect(property).not.toMatch(/^(?:display|order|grid.*|flex.*|gap|(?:min-|max-)?(?:height|block-size)|padding.*|margin.*|position|inset.*|border(?:-(?:block|inline)(?:-(?:start|end))?)?(?:-(?:width|style))?)$/);
            }
          }
        }
      }
    }
    expect(slots.splits[1]).toHaveClass('contents', 'lg:order-first', 'lg:grid', 'lg:grid-cols-[minmax(0,2fr)_minmax(280px,1fr)]');
    expect(slots.maps[1]).toHaveClass('order-first', 'h-[55vh]', 'lg:order-none', 'lg:min-h-[440px]');
    expect(slots.details[1]).toHaveClass('order-last', 'lg:order-none');
    expect(slots.splits[0]).toHaveClass('grid-cols-1', 'lg:grid-cols-[minmax(0,13fr)_minmax(300px,7fr)]');
  });

  it('honors user leading on readable popup, tooltip and feature text, not just unchanged root variables', () => {
    profile(document.documentElement, 'v1');
    const host = preview('atlas');
    document.body.append(host);
    const slots = consumers(host);
    const sources = slot('overview', 'map-sources');
    const popup = document.createElement('div');
    const tooltip = document.createElement('div');
    popup.className = 'leaflet-popup-content';
    tooltip.className = 'leaflet-tooltip';
    host.append(sources, popup, tooltip);
    const readable = [popup, tooltip, sources, slots.provenance, ...slots.details].map(parent => {
      const text = document.createElement('span');
      text.className = 'leading-snug';
      text.textContent = 'A complete observation timestamp and provenance';
      parent.append(text);
      return text;
    });
    releases.push(observeAppDesignScopes(host));
    const prefs: FontPrefs = {
      sans: 'system', mono: 'system', customSans: '', customMono: '',
      scale: 1.35, leading: 1.9, tracking: '0.01em', headingWeight: 800,
    };
    applyFontCSS(prefs);
    for (const element of [popup, tooltip, ...readable]) {
      const matched = rules.filter(rule => element.matches(rule.selector));
      expect(matched.some(rule => properties(rule)['line-height'] === 'var(--leading)')).toBe(true);
      expect(matched.some(rule => properties(rule)['line-height'] === '1.5')).toBe(false);
    }
    expect(document.documentElement.style.getPropertyValue('--leading')).toBe('1.9');
    expect(document.documentElement.style.getPropertyValue('--font-weight-bold')).toBe('800');
    // jsdom does not prove variable resolution, text metrics or geometry.
  });
});
