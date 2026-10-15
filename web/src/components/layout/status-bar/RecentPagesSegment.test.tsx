import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __resetRecentPagesForTests,
  recordPageView,
} from '@/lib/recentPages';
import { prefetchRoute } from '@/lib/routePrefetch';
import { RecentPagesSegment } from './RecentPagesSegment';
import { resolve } from 'node:path';
import postcss, { type Root } from 'postcss';
import tailwindcss from 'tailwindcss';
import loadConfig from 'tailwindcss/loadConfig';
import resolveConfig from 'tailwindcss/resolveConfig';
import { cn } from '@/lib/cn';
import type { RecentPageKind } from '@/lib/recentPages';

vi.mock('@/lib/routePrefetch', () => ({
  prefetchRoute: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOptions?: string | Record<string, unknown>) => {
      if (typeof fallbackOrOptions === 'string') return fallbackOrOptions;
      const fallback =
        typeof fallbackOrOptions?.defaultValue === 'string'
          ? fallbackOrOptions.defaultValue
          : _key;
      return Object.entries(fallbackOrOptions ?? {}).reduce(
        (text, [key, value]) => text.replace(`{{${key}}}`, String(value)),
        fallback,
      );
    },
  }),
}));

function renderSegment(iconOnly = false) {
  return render(
    <MemoryRouter>
      <RecentPagesSegment iconOnly={iconOnly} />
    </MemoryRouter>,
  );
}

describe('RecentPagesSegment', () => {
  beforeEach(() => {
    __resetRecentPagesForTests();
    vi.mocked(prefetchRoute).mockClear();
  });

  afterEach(() => {
    __resetRecentPagesForTests();
  });

  it('keeps an empty recent-pages affordance in the status bar', () => {
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 0 saved',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('dialog', { name: 'Recently viewed' })).toBeInTheDocument();
    expect(screen.getByTestId('status-bar-recent-empty')).toHaveTextContent(
      'Pages you visit will appear here for quick access.',
    );
  });

  it('opens the most recently visited pages in newest-first order', () => {
    recordPageView({ path: '/vehicles/1', title: 'Model 3', kind: 'vehicle' });
    recordPageView({ path: '/drives/42', title: 'Drive 42', kind: 'drive' });
    recordPageView({ path: '/charging/7', title: 'Charge 7', kind: 'charging' });
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 3 saved',
    });
    expect(trigger).toHaveTextContent('Recent');
    expect(trigger).not.toHaveTextContent('3');
    fireEvent.click(trigger);

    const list = screen.getByTestId('status-bar-recent-list');
    const rows = within(list).getAllByRole('link');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('Charge 7');
    expect(rows[1]).toHaveTextContent('Drive 42');
    expect(rows[2]).toHaveTextContent('Model 3');
    expect(rows[0]).toHaveAttribute('href', '/charging/7');

    fireEvent.mouseEnter(rows[0]);
    expect(prefetchRoute).toHaveBeenCalledWith('/charging/7');
  });

  it('caps the popover at five entries while retaining the full saved count', () => {
    for (let index = 0; index < 12; index += 1) {
      recordPageView({
        path: `/vehicles/${index}`,
        title: `Vehicle ${index}`,
        kind: 'vehicle',
      });
    }
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 12 saved',
    });
    fireEvent.click(trigger);

    expect(within(screen.getByTestId('status-bar-recent-list')).getAllByRole('link')).toHaveLength(5);
    expect(screen.getByText('12 pages')).toBeInTheDocument();
  });

  it('updates live when navigation records another page', () => {
    renderSegment();
    expect(
      screen.getByRole('button', { name: 'Open recently viewed pages, 0 saved' }),
    ).toBeInTheDocument();

    act(() => {
      recordPageView({ path: '/trips/9', title: 'Weekend trip', kind: 'trip' });
    });

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 1 saved',
    });
    fireEvent.click(trigger);
    expect(screen.getByText('Weekend trip')).toBeInTheDocument();
  });

  it('closes after navigation and restores trigger focus on Escape', () => {
    recordPageView({ path: '/drives/55', title: 'Drive 55', kind: 'drive' });
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 1 saved',
    });
    fireEvent.click(trigger);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Recently viewed' })).toBeNull();
    expect(trigger).toHaveFocus();

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId('status-bar-recent-row-/drives/55'));
    expect(screen.queryByRole('dialog', { name: 'Recently viewed' })).toBeNull();
  });

  it('closes on an outside pointer interaction', () => {
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 0 saved',
    });
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog', { name: 'Recently viewed' })).toBeInTheDocument();

    fireEvent.pointerDown(document.body);

    expect(screen.queryByRole('dialog', { name: 'Recently viewed' })).toBeNull();
    expect(trigger).toHaveFocus();
  });

  it('collapses to an icon-only trigger without losing its accessible name', () => {
    renderSegment(true);

    expect(screen.queryByText('Recent')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'Open recently viewed pages, 0 saved' }),
    ).toBeInTheDocument();
  });

  it('uses the generic page icon branch for uncategorized routes', () => {
    recordPageView({ path: '/system', title: 'System', kind: 'page' });
    renderSegment();

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Open recently viewed pages, 1 saved',
      }),
    );

    expect(screen.getByTestId('status-bar-recent-row-/system')).toHaveAttribute(
      'href',
      '/system',
    );
    expect(
      screen.getByTestId('status-bar-recent-row-/system').querySelector('[data-page-kind="page"]'),
    ).toBeInTheDocument();
  });

  it('keeps long RTL titles readable and keyboard prefetch available', () => {
    const title = 'رحلة طويلة '.repeat(30);
    recordPageView({ path: '/trips/99', title, kind: 'trip' });
    renderSegment();

    const trigger = screen.getByRole('button', {
      name: 'Open recently viewed pages, 1 saved',
    });
    fireEvent.click(trigger);

    const content = screen.getByTestId('status-bar-recent-popover');
    expect(trigger).toHaveAttribute('aria-controls', content.id);
    const link = within(content).getByRole('link');
    expect(link).toHaveAttribute('href', '/trips/99');
    expect(link).toHaveClass('min-h-11', 'md:min-h-10');
    expect(within(link).getByText(title.trim())).toHaveClass('break-words');
    expect(within(link).getByText(title.trim())).not.toHaveClass('truncate');
    expect(within(link).getByText('Just now')).toHaveClass('text-xs');
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false');

    fireEvent.focus(link);
    expect(prefetchRoute).toHaveBeenCalledWith('/trips/99');
    expect(link).toHaveClass('focus-visible:outline-2', 'forced-colors:focus-visible:outline-[Highlight]');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('keeps named viewport width, fixed original scroll cap and mobile row geometry', () => {
    recordPageView({ path: '/vehicles/1', title: 'Model 3', kind: 'vehicle' });
    renderSegment();
    fireEvent.click(screen.getByTestId('status-bar-recent-trigger'));

    expect(screen.getByRole('dialog')).toHaveClass('w-recent-pages', 'p-2');
    expect(screen.getByTestId('status-bar-recent-list')).toHaveClass(
      'max-h-alerts-preview', 'overflow-y-auto',
    );
    expect(screen.getByRole('link')).toHaveClass('min-h-11', 'md:min-h-10');
    const config = resolveConfig(loadConfig(resolve('tailwind.config.js')));
    expect(config.theme.width['recent-pages']).toBe('min(92vw, 360px)');
    expect(config.theme.maxHeight['alerts-preview']).toBe('320px');
  });

  const kinds: { kind: RecentPageKind; glyph: string }[] = [
    { kind: 'vehicle', glyph: 'lucide-car' },
    { kind: 'drive', glyph: 'lucide-route' },
    { kind: 'charging', glyph: 'lucide-battery-charging' },
    { kind: 'trip', glyph: 'lucide-compass' },
    { kind: 'geofence', glyph: 'lucide-map-pinned' },
    { kind: 'year-review', glyph: 'lucide-calendar-days' },
    { kind: 'page', glyph: 'lucide-file-text' },
  ];

  it.each(kinds)('preserves $kind page identity, title and glyph', ({ kind, glyph }) => {
    const path = `/preserved/${kind}`;
    const title = `Original ${kind} title`;
    recordPageView({ path, title, kind });
    renderSegment();
    fireEvent.click(screen.getByTestId('status-bar-recent-trigger'));
    const link = screen.getByTestId(`status-bar-recent-row-${path}`);
    expect(link).toHaveAttribute('href', path);
    expect(link).toHaveTextContent(title);
    expect(link.querySelector('[data-page-kind]')).toHaveAttribute('data-page-kind', kind);
    expect(link.querySelector('svg')).toHaveClass(glyph);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false');
  });

  it('keeps the current-page destination as a native link without inventing selection metadata', () => {
    recordPageView({ path: '/drives/55', title: 'Drive 55', kind: 'drive' });
    render(
      <MemoryRouter initialEntries={['/drives/55']}>
        <RecentPagesSegment iconOnly />
      </MemoryRouter>,
    );
    const trigger = screen.getByTestId('status-bar-recent-trigger');
    expect(trigger).toHaveAttribute('type', 'button');
    fireEvent.click(trigger);
    const link = screen.getByRole('link', { name: /Drive 55/ });
    expect(link).toHaveAttribute('href', '/drives/55');
    expect(link).not.toHaveAttribute('aria-current');
    fireEvent.focus(link);
    expect(prefetchRoute).toHaveBeenCalledWith('/drives/55');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(trigger).toHaveFocus();
  });

  it('generates exactly the original geometry and honors both caller merge orders', async () => {
    const config = loadConfig(resolve('tailwind.config.js'));
    const pairs = [
      { old: 'w-[min(92vw,360px)]', named: 'w-recent-pages', ordinary: 'w-full', alternate: 'w-[400px]' },
      { old: 'max-h-[320px]', named: 'max-h-alerts-preview', ordinary: 'max-h-none', alternate: 'max-h-[400px]' },
    ];
    const variants = ['', 'sm:', 'md:', 'xl:'];
    const classes = variants.flatMap(variant =>
      pairs.flatMap(pair => [pair.old, pair.named].map(value => `${variant}${value}`)),
    );
    const css = (await postcss([tailwindcss({
      ...config, content: [{ raw: classes.join(' '), extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root;

    function signature(root: Root, className: string) {
      const found: { context: string[]; declarations: [string, string, boolean][] }[] = [];
      root.walkRules(rule => {
        const selector = rule.selector
          .replace(/\\([\da-f]{1,6})\s?/gi, (_, hex: string) =>
            String.fromCodePoint(Number.parseInt(hex, 16)))
          .replace(/\\(.)/g, '$1');
        if (selector !== `.${className}`) return;
        const declarations: [string, string, boolean][] = [];
        rule.walkDecls(decl => {
          declarations.push([decl.prop, decl.value, Boolean(decl.important)]);
        });
        const context: string[] = [];
        let parent: typeof rule.parent | Root['parent'] = rule.parent;
        while (parent) {
          if (parent.type === 'atrule') context.unshift(`@${parent.name} ${parent.params}`);
          parent = parent.parent;
        }
        found.push({ context, declarations });
      });
      return found;
    }

    console.log('RAW RECENT PAGES GEOMETRY CSS\n' + css.toString());
    for (const variant of variants) {
      for (const pair of pairs) {
        const old = signature(css, `${variant}${pair.old}`);
        expect(old).toHaveLength(1);
        expect(signature(css, `${variant}${pair.named}`)).toEqual(old);
        for (const alternative of [pair.old, pair.ordinary, pair.alternate]) {
          expect(cn(`${variant}${pair.named}`, `${variant}${alternative}`))
            .toBe(`${variant}${alternative}`);
          expect(cn(`${variant}${alternative}`, `${variant}${pair.named}`))
            .toBe(`${variant}${pair.named}`);
        }
      }
    }
    expect(signature(css, 'w-recent-pages')[0].declarations)
      .toEqual([['width', 'min(92vw, 360px)', false]]);
    expect(signature(css, 'max-h-alerts-preview')[0].declarations)
      .toEqual([['max-height', '320px', false]]);
    expect(cn('w-recent-pages max-h-alerts-preview md:w-full'))
      .toBe('w-recent-pages max-h-alerts-preview md:w-full');
  });

  it.each([false, true])('allocates the mobile touch target and restores desktop density (iconOnly=%s)', async iconOnly => {
    renderSegment(iconOnly);
    const trigger = screen.getByTestId('status-bar-recent-trigger');
    expect(trigger).toHaveClass(
      'h-11', 'min-h-11', 'min-w-11', 'shrink-0',
      'md:h-5', 'md:min-h-0', 'md:min-w-0', 'md:shrink',
      'gap-1', 'px-1.5', 'py-0',
      'focus-visible:outline-2', 'focus-visible:outline-offset-2',
    );
    expect(trigger).not.toHaveClass('h-5', 'h-9', 'min-h-0');
    expect(trigger).toHaveAttribute('type', 'button');
    expect(trigger).toHaveAttribute('aria-label', 'Open recently viewed pages, 0 saved');

    const config = loadConfig(resolve('tailwind.config.js'));
    const css = (await postcss([tailwindcss({
      ...config, content: [{ raw: trigger.className, extension: 'html' }],
    })]).process('@tailwind utilities;', { from: undefined })).root;
    const properties = ['height', 'min-height', 'min-width', 'flex-shrink', 'outline-width', 'outline-offset'];
    function densityAt(width: number) {
      const values: Record<string, string> = {};
      css.walkRules(rule => {
        const selector = rule.selector.replace(/\\(.)/g, '$1');
        const className = selector.slice(1).split(':focus-visible')[0];
        if (!trigger.classList.contains(className)) return;
        let parent: typeof rule.parent | Root['parent'] = rule.parent;
        while (parent) {
          if (parent.type === 'atrule' && parent.name === 'media') {
            const minWidth = /min-width:\s*(\d+)px/.exec(parent.params);
            if (!minWidth || width < Number(minWidth[1])) return;
          }
          parent = parent.parent;
        }
        rule.walkDecls(decl => {
          if (properties.includes(decl.prop)) values[decl.prop] = decl.value;
        });
      });
      return values;
    }
    console.log('RAW MOBILE RECENT TRIGGER CSS\n' + css.toString());
    console.log('RAW 767/768 DENSITY', densityAt(767), densityAt(768));
    expect(densityAt(767)).toEqual({
      height: '2.75rem', 'min-height': '2.75rem', 'min-width': '2.75rem',
      'flex-shrink': '0', 'outline-width': '2px', 'outline-offset': '2px',
    });
    expect(densityAt(768)).toEqual({
      height: '1.25rem', 'min-height': '0px', 'min-width': '0px',
      'flex-shrink': '1', 'outline-width': '2px', 'outline-offset': '2px',
    });
    for (const [mobile, desktop] of [
      ['h-11', 'h-5'], ['min-h-11', 'min-h-0'], ['min-w-11', 'min-w-0'],
    ]) {
      expect(cn(mobile, desktop)).toBe(desktop);
      expect(cn(desktop, mobile)).toBe(mobile);
      expect(cn(`md:${mobile}`, `md:${desktop}`)).toBe(`md:${desktop}`);
      expect(cn(`md:${desktop}`, `md:${mobile}`)).toBe(`md:${mobile}`);
      expect(cn(mobile, `md:${desktop}`)).toBe(`${mobile} md:${desktop}`);
    }
    // The adopted frame supplies 4px clearance on both sides of each 56px row.
    expect(44 + 2 * (2 + 2)).toBeLessThanOrEqual(112 / 2);
  });
});
