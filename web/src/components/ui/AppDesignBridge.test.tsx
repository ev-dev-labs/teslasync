import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { StrictMode } from 'react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse } from 'postcss';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import { getAppDesignAttributes, observeAppDesignScopes } from './app-designs/designs';
import { AppDesignBridge } from './AppDesignBridge';

const selection = vi.hoisted((): { packId: PackId; appWide: boolean; isReady: boolean } => ({
  packId: 'brutal', appWide: false, isReady: true,
}));
vi.mock('@/hooks/useWidgetDesignPack', () => ({ useWidgetDesignPack: () => selection }));

const attributeNames = [
  'data-app-design-pack', 'data-app-navigation', 'data-app-header', 'data-app-content',
  'data-app-controls', 'data-app-data', 'data-app-chart', 'data-app-map', 'data-app-feedback',
] as const;
const preferenceProperties = ['--font-scale', '--font-sans', '--theme-accent', '--semantic-success', '--chart-1'];
const initialDensity = document.body.getAttribute('data-density');
const scopeReleases: Array<() => void> = [];
const styles: HTMLStyleElement[] = [];
const packDirectory = resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs');
const motorsportStyles = readFileSync(resolve(packDirectory, 'motorsport.css'), 'utf8');
const quietStyles = readFileSync(resolve(packDirectory, 'quiet.css'), 'utf8');
const designSources = [
  ...['base', 'shell', 'controls', 'charts', 'maps', 'feedback'].map(name =>
    readFileSync(resolve(packDirectory, '..', `${name}.css`), 'utf8')),
  ...PACK_IDS.map(id => readFileSync(resolve(packDirectory, `${id}.css`), 'utf8')),
];

function installStyles(text: string) {
  const style = document.createElement('style');
  style.textContent = text;
  document.head.append(style);
  styles.push(style);
}

function titleRule(css: string) {
  let title = '';
  parse(css).walkRules(rule => {
    if (!title && rule.selector.includes('[data-app-part~="page-title"]')) title = rule.toString();
  });
  expect(title).not.toBe('');
  return title;
}

function expectNeutral() {
  for (const name of attributeNames) expect(document.documentElement).not.toHaveAttribute(name);
  expect(document.documentElement).not.toHaveAttribute('data-app-design-owner');
}

function expectComposition(packId: PackId) {
  for (const [name, value] of Object.entries(getAppDesignAttributes(packId))) {
    expect(document.documentElement).toHaveAttribute(name, value);
  }
}

afterEach(() => {
  cleanup();
  for (const release of scopeReleases.splice(0)) release();
  for (const style of styles.splice(0)) style.remove();
  for (const name of attributeNames) document.documentElement.removeAttribute(name);
  for (const name of preferenceProperties) document.documentElement.style.removeProperty(name);
  if (initialDensity === null) document.body.removeAttribute('data-density');
  else document.body.setAttribute('data-density', initialDensity);
  Object.assign(selection, { packId: 'brutal', appWide: false, isReady: true });
  vi.restoreAllMocks();
});

describe('nearest design boundary isolation', () => {
  it('explicitly resets every assigned app-owned property without resetting preference namespaces', () => {
    const assigned = new Set<string>();
    for (const source of designSources) {
      parse(source).walkDecls(declaration => {
        if (declaration.prop.startsWith('--app-') || /^--panel-(radius|shadow|shadow-hover)$/.test(declaration.prop)) {
          assigned.add(declaration.prop);
        }
      });
    }
    const reset = new Set<string>();
    parse(designSources[0]).walkRules(rule => {
      if (!rule.selectors.includes('[data-app-design-preview]')) return;
      rule.walkDecls(declaration => { reset.add(declaration.prop); });
    });
    expect([...assigned].filter(property => !reset.has(property))).toEqual([]);
    expect([...reset].filter(property =>
      !property.startsWith('--app-') && !/^--panel-(radius|shadow|shadow-hover)$/.test(property))).toEqual([]);
  });

  it('keeps actual Quiet boundary variables stable under contrasting active outer identities', () => {
    const inheritedRules: string[] = [];
    for (const source of designSources) {
      parse(source).walkRules(rule => {
        const custom = rule.nodes.filter(node => node.type === 'decl' && node.prop.startsWith('--'));
        if (!custom.length) return;
        const inherited = rule.clone({ nodes: custom.map(node => node.clone()) });
        inheritedRules.push(inherited.toString());
      });
    }
    installStyles(inheritedRules.join('\n'));
    selection.appWide = true;
    selection.packId = 'ambient';
    const view = render(<>
      <AppDesignBridge />
      <section data-testid="quiet-variables" data-app-design-preview {...getAppDesignAttributes('quiet')} />
    </>);
    const boundary = view.getByTestId('quiet-variables');
    const snapshot = () => {
      const style = getComputedStyle(boundary);
      return ['--app-border-width', '--app-nav-radius', '--app-shadow', '--panel-radius',
        '--panel-shadow', '--panel-shadow-hover', '--app-feedback-signal']
        .map(property => [property, style.getPropertyValue(property)]);
    };
    expect(getComputedStyle(document.documentElement).getPropertyValue('--panel-radius')).toBe('var(--radius-xl)');
    expect(getComputedStyle(boundary).getPropertyValue('--app-nav-radius')).toBe('var(--radius-sm)');
    expect(getComputedStyle(boundary).getPropertyValue('--app-border-width')).toBe('1px');
    const first = snapshot();
    selection.packId = 'bauhaus';
    view.rerender(<>
      <AppDesignBridge />
      <section data-testid="quiet-variables" data-app-design-preview {...getAppDesignAttributes('quiet')} />
    </>);
    expect(getComputedStyle(document.documentElement).getPropertyValue('--panel-radius')).toBe('0px');
    expect(getComputedStyle(document.documentElement).getPropertyValue('--app-border-width')).toBe('2px');
    expect(snapshot()).toEqual(first);
  });

  it.each([false, true])('isolates real Motorsport/Quiet title rules in either source order (reversed: %s)', reversed => {
    selection.packId = 'motorsport';
    selection.appWide = true;
    const rules = [titleRule(motorsportStyles), titleRule(quietStyles)];
    installStyles((reversed ? rules.reverse() : rules).join('\n'));
    // Evaluate the concrete selectors without @scope, as required at the
    // supported browser floor. Quiet deliberately does not reset font-style.
    const view = render(<>
      <AppDesignBridge />
      <div data-app-part="page-title" data-testid="outer-title" />
      <section data-app-design-preview {...getAppDesignAttributes('quiet')}>
        <div data-app-part="page-title" data-testid="quiet-title" />
        <section data-app-design-preview {...getAppDesignAttributes('motorsport')}>
          <div data-app-part="page-title" data-testid="nested-title" />
        </section>
      </section>
    </>);
    expect(getComputedStyle(view.getByTestId('outer-title')).fontStyle).toBe('italic');
    expect(getComputedStyle(view.getByTestId('quiet-title')).fontStyle).not.toBe('italic');
    expect(getComputedStyle(view.getByTestId('nested-title')).fontStyle).toBe('italic');
  });

  it('updates inserted and reparented content using the nearest profile, with incomplete boundaries neutral', async () => {
    installStyles('[data-app-design-owner~="pack-quiet"][data-app-part~="panel"] { transform: translateX(3px); }');
    selection.packId = 'motorsport';
    selection.appWide = true;
    const view = render(<>
      <AppDesignBridge />
      <section data-testid="quiet" data-app-design-preview {...getAppDesignAttributes('quiet')} />
      <section data-testid="neutral" data-app-design-preview>
        <div data-app-part="panel" data-testid="widget" />
      </section>
    </>);
    const quiet = view.getByTestId('quiet');
    const panel = document.createElement('div');
    panel.setAttribute('data-app-part', 'panel');
    quiet.append(panel);
    await waitFor(() => expect(panel).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-quiet')));
    expect(getComputedStyle(panel).transform).toBe('translateX(3px)');
    view.getByTestId('neutral').append(panel);
    await waitFor(() => expect(panel).not.toHaveAttribute('data-app-design-owner'));
    expect(getComputedStyle(panel).transform).not.toBe('translateX(3px)');
    expect(view.getByTestId('widget')).not.toHaveAttribute('data-app-design-owner');
    for (const [name, value] of Object.entries(getAppDesignAttributes('classic'))) quiet.setAttribute(name, value);
    quiet.append(panel);
    await waitFor(() => expect(panel).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-classic')));
    quiet.removeAttribute('data-app-chart');
    await waitFor(() => expect(panel).not.toHaveAttribute('data-app-design-owner'));
    panel.remove();
    await waitFor(() => expect(panel).not.toHaveAttribute('data-app-design-owner'));
  });

  it('shares lifecycle with independently mounted previews and removes all private markers on last release', () => {
    const view = render(<section data-testid="preview" data-app-design-preview {...getAppDesignAttributes('quiet')}>
      <div data-app-part="panel" data-testid="panel" />
    </section>);
    const preview = view.getByTestId('preview');
    const releasePreview = observeAppDesignScopes(preview);
    scopeReleases.push(releasePreview);
    expect(view.getByTestId('panel')).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-quiet'));
    selection.packId = 'motorsport';
    selection.appWide = true;
    const bridge = render(<AppDesignBridge />);
    bridge.unmount();
    expectNeutral();
    expect(view.getByTestId('panel')).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-quiet'));
    releasePreview();
    expect(document.querySelector('[data-app-design-owner]')).toBeNull();
    releasePreview();
  });
});

describe('application design scope lifecycle', () => {
  it('does not start a scope observer for default/widget-only selections and disconnects on opt-out', () => {
    const observe = vi.spyOn(window.MutationObserver.prototype, 'observe');
    const disconnect = vi.spyOn(window.MutationObserver.prototype, 'disconnect');
    const view = render(<AppDesignBridge />);
    expect(observe).not.toHaveBeenCalled();
    selection.appWide = true;
    view.rerender(<AppDesignBridge />);
    expect(observe).toHaveBeenCalledTimes(1);
    selection.appWide = false;
    view.rerender(<AppDesignBridge />);
    expect(disconnect).toHaveBeenCalledTimes(1);
    expectNeutral();
    selection.isReady = false;
    view.rerender(<AppDesignBridge />);
    expect(observe).toHaveBeenCalledTimes(1);
  });

  it('requires verified opt-in and clears all portal-wide attributes on revocation and unmount', () => {
    const view = render(<AppDesignBridge />);
    expectNeutral();
    selection.appWide = true;
    view.rerender(<AppDesignBridge />);
    expectComposition('brutal');
    selection.isReady = false;
    view.rerender(<AppDesignBridge />);
    expectNeutral();
    selection.isReady = true;
    selection.packId = 'material';
    view.rerender(<AppDesignBridge />);
    expectComposition('material');
    view.unmount();
    expectNeutral();
  });

  it('applies explicit app-wide Classic and restores neutral widget-only scope without changing preferences', () => {
    const root = document.documentElement;
    root.style.setProperty('--font-scale', '1.2');
    root.style.setProperty('--font-sans', 'system-ui');
    root.style.setProperty('--theme-accent', '#123456');
    root.style.setProperty('--semantic-success', '#abcdef');
    root.style.setProperty('--chart-1', '#456789');
    document.body.dataset.density = 'compact';
    const preferences = root.getAttribute('style');
    selection.appWide = true;
    const view = render(<AppDesignBridge />);
    selection.appWide = false;
    view.rerender(<AppDesignBridge />);
    expectNeutral();
    selection.appWide = true;
    selection.packId = 'classic';
    view.rerender(<AppDesignBridge />);
    expectComposition('classic');
    expect(root.getAttribute('style')).toBe(preferences);
    expect(document.body).toHaveAttribute('data-density', 'compact');
    selection.appWide = false;
    view.rerender(<AppDesignBridge />);
    expectNeutral();
    expect(root.getAttribute('style')).toBe(preferences);
    expect(document.body).toHaveAttribute('data-density', 'compact');
  });

  it('only owns root attributes, leaving an independently selected preview host unchanged', () => {
    selection.appWide = true;
    const previewAttributes = getAppDesignAttributes('warm');
    const content = <><AppDesignBridge /><section data-app-design-preview {...previewAttributes} data-testid="preview" /></>;
    const view = render(content);
    const preview = view.getByTestId('preview');
    expectComposition('brutal');
    selection.appWide = false;
    view.rerender(<><AppDesignBridge /><section data-app-design-preview {...previewAttributes} data-testid="preview" /></>);
    expectNeutral();
    for (const [name, value] of Object.entries(previewAttributes)) expect(preview).toHaveAttribute(name, value);
    view.unmount();
    expectNeutral();
  });

  it('replaces every descriptor when switching packs under StrictMode, leaving no stale slots', () => {
    selection.appWide = true;
    const view = render(<StrictMode><AppDesignBridge /></StrictMode>);
    for (const packId of PACK_IDS) {
      selection.packId = packId;
      view.rerender(<StrictMode><AppDesignBridge /></StrictMode>);
      expectComposition(packId);
    }
    view.unmount();
    expectNeutral();
  });

  it('clears stale attributes while a changed scope is unverified and keeps non-layout routes neutral', () => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(getAppDesignAttributes('cyber'))) {
      root.setAttribute(name, value);
    }
    selection.isReady = false;
    selection.appWide = true;
    const view = render(<AppDesignBridge />);
    expectNeutral();
    selection.isReady = true;
    view.rerender(<AppDesignBridge />);
    expectComposition('brutal');
    view.rerender(<></>);
    expectNeutral();
    selection.packId = 'classic';
    view.rerender(<AppDesignBridge />);
    expectComposition('classic');
    selection.isReady = false;
    view.rerender(<AppDesignBridge />);
    expectNeutral();
  });
});
