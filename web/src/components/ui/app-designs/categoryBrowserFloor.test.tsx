import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createRef } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Map as LeafletMap } from 'leaflet';
import { MapContainer } from '@/components/maps';
import { TagInput } from '@/components/forms/TagInput';
import { PageLayout } from '@/components/layout/layout-reference/PageLayout';
import { Section } from '@/components/layout/layout-reference/Section';
import { Grid } from '@/components/layout/Grid';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from './designs';

const readSheet = (name: string) =>
  postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', `${name}.css`), 'utf8'));
const sheets = { controls: readSheet('controls'), maps: readSheet('maps'), shell: readSheet('shell') };
const releases: Array<() => void> = [];
const styles: HTMLStyleElement[] = [];

// Conservative source projection, not a Firefox emulator: discard entire :has
// rules and container-query branches rather than relying on JSDOM's support.
function floorRules(name: keyof typeof sheets) {
  const rules: Rule[] = [];
  sheets[name].walkRules(rule => {
    if (rule.selector.includes(':has(')) return;
    let parent = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' &&
        (parent.name === 'container' || (parent.name === 'media' && parent.params.includes('min-width:')))) return;
      parent = parent.parent;
    }
    rules.push(rule);
  });
  return rules;
}

function declarations(element: Element, rules: Rule[]) {
  return Object.fromEntries(rules.filter(rule => rule.selectors.some(selector => element.matches(selector)))
    .flatMap(rule => rule.nodes.flatMap(node => node.type === 'decl' ? [[node.prop, node.value]] : [])));
}

afterEach(() => {
  cleanup();
  for (const release of releases.splice(0)) release();
  for (const style of styles.splice(0)) style.remove();
  for (const name of Object.keys(getAppDesignAttributes('classic'))) document.documentElement.removeAttribute(name);
});

describe('category browser-floor source-to-consumer contracts (not historical-browser certification)', () => {
  it.each(['v2', 'classic', 'v3', 'v6'] as const)(
    '%s preserves real TagInput validation, recovery and disabled paint without :has',
    pack => {
      const onChange = vi.fn();
      const view = (disabled = false) => (
        <section data-app-design-preview {...getAppDesignAttributes(pack)}>
          <TagInput label="Tags" value={['retained']} onChange={onChange}
            validateTag={tag => tag.length < 3 ? 'Too short' : null} disabled={disabled} />
        </section>
      );
      const mounted = render(view());
      releases.push(observeAppDesignScopes(mounted.container));
      const input = screen.getByRole('textbox', { name: /tags/i });
      const surface = input.closest('[data-app-field-surface]')!;
      const rules = floorRules('controls');
      expect(declarations(surface, rules)['border-color']).toBe('var(--control-border)');
      fireEvent.change(input, { target: { value: 'ab' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).not.toHaveBeenCalled();
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(screen.getByText('Too short')).toBeVisible();
      expect(declarations(surface, rules)['border-color']).toBe('var(--semantic-danger)');
      expect(surface).toHaveClass('border-red-500');
      expect(surface).not.toHaveAttribute('data-invalid');
      expect(surface).not.toHaveAttribute('aria-invalid');
      expect(surface).toHaveAttribute('data-app-design-owner', expect.stringContaining(`controls-${APPLICATION_DESIGNS[pack].controls}`));
      input.focus();
      expect(rules.some(rule => surface.matches(rule.selector) &&
        rule.nodes.some(node => node.type === 'decl' && node.prop === 'outline'))).toBe(true);

      fireEvent.change(input, { target: { value: 'recovered' } });
      expect(input).not.toHaveAttribute('aria-invalid');
      expect(declarations(surface, rules)['border-color']).toBe('var(--control-border)');
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(onChange).toHaveBeenLastCalledWith(['retained', 'recovered']);
      fireEvent.change(input, { target: { value: 'ab' } });
      fireEvent.keyDown(input, { key: 'Enter' });
      mounted.rerender(view(true));
      expect(input).toBeDisabled();
      expect(screen.getByRole('button', { name: /remove retained/i })).toBeDisabled();
      expect(declarations(surface, rules)).toMatchObject({
        'border-color': 'var(--semantic-danger)', cursor: 'not-allowed',
      });
      surface.removeAttribute('data-app-design-owner');
      expect(declarations(surface, rules)).toEqual({});
      expect(input).toHaveAttribute('aria-invalid', 'true');
    },
  );

  it.each(['v1', 'atlas', 'quiet', 'classic'] as const)(
    '%s bounds both real Leaflet attribution corners without :has and retains complete links',
    async pack => {
      const map = createRef<LeafletMap>();
      const mounted = render(
        <section data-app-design-preview {...getAppDesignAttributes(pack)}>
          <MapContainer ref={map} center={[51, -1]} zoom={4} />
        </section>,
      );
      const leaflet = map.current;
      if (!leaflet) throw new Error('Leaflet did not mount');
      leaflet.attributionControl.addAttribution(
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors with complete long provider credits</a>',
      );
      releases.push(observeAppDesignScopes(mounted.container));
      const rules = floorRules('maps');
      const center = leaflet.getCenter();
      for (const position of ['bottomright', 'bottomleft'] as const) {
        leaflet.attributionControl.setPosition(position);
        const attribution = mounted.container.querySelector('.leaflet-control-attribution')!;
        await waitFor(() => expect(attribution).toHaveAttribute('data-app-design-owner'));
        const corner = attribution.parentElement!;
        expect(corner).toHaveClass('leaflet-bottom', position === 'bottomright' ? 'leaflet-right' : 'leaflet-left');
        expect(declarations(corner, rules)['max-inline-size']).toBe('100%');
        expect(declarations(attribution, rules)).toMatchObject({
          'max-inline-size': '100%', 'white-space': 'normal', 'overflow-wrap': 'anywhere',
        });
        expect(attribution.textContent).toContain('complete long provider credits');
        expect(attribution.querySelector('a[href="https://www.openstreetmap.org/copyright"]')).not.toBeNull();
        expect(attribution.querySelector('a[href="https://leafletjs.com"]')).not.toBeNull();
        expect(leaflet.getCenter()).toEqual(center);
        expect(leaflet.getZoom()).toBe(4);
        corner.removeAttribute('data-app-design-owner');
        expect(declarations(corner, rules)).toEqual({});
      }
    },
  );

  it('retains the real stacked Section fallback and authored Grid when size queries are unavailable', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const mounted = render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/drives']}>
          <section data-app-design-preview {...getAppDesignAttributes('v1')}>
            <PageLayout title="Drive report" announce={false}>
              <Section id="floor-evidence" title="Measured evidence" description="Source and period">
                <Grid><div>Retained chart</div><div>Retained records</div></Grid>
              </Section>
            </PageLayout>
          </section>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    releases.push(observeAppDesignScopes(mounted.container));
    const section = screen.getByRole('region', { name: 'Measured evidence' });
    const content = section.parentElement!;
    const grid = section.querySelector('[data-app-part~="grid"]')!;
    const config = loadConfig(resolve('tailwind.config.js'));
    const generated = (await postcss([tailwindcss({
      ...config, content: [{ raw: mounted.container.innerHTML, extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root;
    generated.walkAtRules('container', rule => { rule.remove(); });
    const style = document.createElement('style');
    style.textContent = generated.toString() + floorRules('shell').map(rule => rule.toString()).join('\n');
    document.head.append(style);
    styles.push(style);
    const floor = floorRules('shell');
    for (const width of ['18rem', '80rem']) {
      content.parentElement!.style.inlineSize = width;
      expect(getComputedStyle(section).display).toBe('block');
      expect(getComputedStyle(content).flexDirection).toBe('column');
      expect(getComputedStyle(grid).display).toBe('grid');
      expect(getComputedStyle(grid).gridTemplateColumns).toBe('repeat(1, minmax(0, 1fr))');
      expect(Array.from(section.children)).toEqual([section.querySelector('header'), grid]);
      expect(grid.textContent).toBe('Retained chartRetained records');
      for (const element of [section, section.querySelector('header')!, grid]) {
        const applied = declarations(element, floor);
        expect(applied).not.toHaveProperty('grid-template-columns');
        expect(applied).not.toHaveProperty('grid-column');
        expect(applied).not.toHaveProperty('min-inline-size', '12rem');
      }
    }
    const enhanced: Rule[] = [];
    sheets.shell.walkAtRules('container', container => {
      container.walkRules(rule => { enhanced.push(rule); });
    });
    expect(declarations(section, enhanced)['grid-template-columns']).toBe('minmax(12rem, 1fr) minmax(0, 4fr)');
    section.removeAttribute('data-app-design-owner');
    expect(declarations(section, enhanced)).toEqual({});
  });

  it('requires final-target ownership and correct axis tokens in every category rule', () => {
    for (const [name, sheet] of Object.entries(sheets)) {
      let count = 0;
      sheet.walkAtRules('scope', () => { throw new Error(`Native scope in ${name}`); });
      sheet.walkRules(rule => {
        count++;
        for (const selector of rule.selectors) {
          expect(selector).toMatch(/\[data-app-design-owner(?:~="[^"]+")?\]\)(?:::[\w-]+)?$|\[data-app-design-owner(?:~="[^"]+")?\]$/);
          for (const axis of ['controls', 'data', 'map']) {
            const mode = new RegExp(`\\[data-app-${axis}="([^"]+)"\\]`).exec(selector)?.[1];
            if (mode) expect(selector).toMatch(new RegExp(`\\[data-app-design-owner~="${axis}-${mode}"\\]\\)(?:::[\\w-]+)?$`));
          }
        }
      });
      console.log(`RAW category ${name}: ${count} rules; final owner/axis guards checked`);
    }
  });
});
