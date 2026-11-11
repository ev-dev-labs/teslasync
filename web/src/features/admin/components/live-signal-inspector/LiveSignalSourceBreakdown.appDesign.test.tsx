import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ComponentProps } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it, vi } from 'vitest';

import {
  APPLICATION_DESIGNS,
  getAppDesignAttributes,
  observeAppDesignScopes,
} from '@/components/ui/app-designs/designs';
import { PACK_IDS, type PackId } from '@/features/dashboard/widgets/designPacks/types';
import { LiveSignalSourceBreakdown } from './LiveSignalSourceBreakdown';
import { computeStats, type LiveSignalStats } from './liveSignalStats';

vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({
    i18n: { language: 'en-US' },
    t: (key: string, fallback?: unknown, values?: Record<string, unknown>) =>
      (typeof fallback === 'string' ? fallback : key).replace(
        /\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? ''),
      ),
  }),
}));

function rules(name: string): Rule[] {
  const result: Rule[] = [];
  postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', name), 'utf8'))
    .walkRules(rule => { result.push(rule); });
  return result;
}

const feedbackRules = rules('feedback.css');
const baseRules = rules('base.css');
const packRules = new Map(PACK_IDS.map(pack => [pack, rules(`packs\\${pack}.css`)] as const));

function selectors(rule: Rule): string[] {
  const parent = rule.parent;
  return parent?.type === 'rule'
    ? selectors(parent).flatMap(scope => rule.selectors.map(selector => selector.replaceAll('&', scope)))
    : rule.selectors;
}

function consumes(node: Element, sheet: readonly Rule[], slot: string, property: string) {
  return sheet.some(rule => rule.nodes.some(declaration => declaration.type === 'decl' && declaration.prop === property)
    && selectors(rule).some(selector => selector.includes(slot) && node.matches(selector)));
}

const stats = computeStats([
  ...Array.from({ length: 4 }, (_, index) => ({ name: `live-${index}`, source: 'l1', value: index })),
  ...Array.from({ length: 3 }, (_, index) => ({ name: `stale-${index}`, source: 'stale', value: index })),
  ...Array.from({ length: 2 }, (_, index) => ({ name: `legacy-${index}`, source: 'l2', value: index })),
  { name: 'unknown', value: false },
]);

type Props = ComponentProps<typeof LiveSignalSourceBreakdown>;
function breakdown(overrides: Partial<Props> = {}) {
  return <LiveSignalSourceBreakdown stats={stats} status="ready" error={null} onRetry={vi.fn()} {...overrides} />;
}

function mount(overrides: Partial<Props> = {}, pack?: PackId) {
  return render(<MemoryRouter>
    {pack
      ? <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{breakdown(overrides)}</div>
      : breakdown(overrides)}
  </MemoryRouter>);
}

function fills(track: Element): HTMLElement[] {
  return Array.from(track.querySelectorAll<HTMLElement>(':scope > [data-metric-fill]'));
}

function assertNativeConsumers(track: Element, pack: PackId) {
  const mode = APPLICATION_DESIGNS[pack].data;
  expect(consumes(track, feedbackRules, `[data-app-data="${mode}"]`, 'outline')).toBe(true);
  for (const fill of fills(track)) {
    expect(consumes(fill, feedbackRules, '[data-metric-fill]', 'box-sizing')).toBe(true);
    expect(consumes(fill, feedbackRules, '[data-metric-fill]', 'min-inline-size')).toBe(true);
  }
  for (const node of [track, ...fills(track)]) {
    for (const rule of [...baseRules, ...feedbackRules, ...packRules.get(pack)!]) {
      if (!selectors(rule).some(selector => node.matches(selector))) continue;
      for (const declaration of rule.nodes) {
        if (declaration.type !== 'decl') continue;
        expect(declaration.prop).not.toMatch(
          /^(display|flex|gap|width|height|inline-size|block-size|background|color|padding|border|transform)(-|$)/,
        );
      }
    }
  }
}

describe('LiveSignalSourceBreakdown native segmented distribution', () => {
  it.each(PACK_IDS)('%s adopts the original segmented track without changing distribution semantics or tiles', pack => {
    const before = JSON.stringify(stats);
    const view = mount({}, pack);
    const release = observeAppDesignScopes(view.container.querySelector('[data-app-design-preview]')!);
    try {
      const track = screen.getByRole('img', {
        name: 'Signal source-layer distribution: 4 live, 3 stale, 2 legacy, 1 unknown',
      });
      assertNativeConsumers(track, pack);
      expect(track).toHaveAttribute('data-app-part', 'metric');
      expect(track).toHaveAttribute('data-app-metric', 'bar');
      expect(track).toHaveAttribute('data-metric-track');
      expect(track).toHaveClass('flex', 'h-3', 'overflow-hidden', 'rounded-full', 'bg-white/[0.05]');
      expect(track).not.toHaveAttribute('aria-valuenow');
      expect(track).not.toHaveAttribute('aria-valuemin');
      expect(track).not.toHaveAttribute('aria-valuemax');
      expect(track).not.toHaveAttribute('aria-live');
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();

      const segments = fills(track);
      expect(segments).toHaveLength(4);
      expect(track.children).toHaveLength(4);
      expect(segments.map(fill => fill.style.width)).toEqual(['40%', '30%', '20%', '10%']);
      expect(segments.map(fill => fill.title)).toEqual([
        'Live · L1: 4 (40%)', 'Stale: 3 (30%)', 'Legacy · L2: 2 (20%)', 'Unknown: 1 (10%)',
      ]);
      for (const [index, fill] of segments.entries()) {
        expect(fill).toHaveClass('h-full', [
          'bg-emerald-500', 'bg-amber-500', 'bg-theme-accent', 'bg-slate-500',
        ][index]);
        expect(fill).not.toHaveAttribute('role');
      }

      const tiles = view.container.querySelectorAll('[data-app-metric="tile"]');
      expect(tiles).toHaveLength(4);
      expect([...tiles].map(tile => tile.querySelector('[data-app-part~="metric-value"]')?.textContent))
        .toEqual(['4', '3', '2', '1']);
      expect([...tiles].map(tile => tile.querySelector('[data-app-part~="metric-label"]')?.textContent))
        .toEqual(['Live · L1', 'Stale', 'Legacy · L2', 'Unknown']);
      expect(screen.getAllByTestId('source-layer-badge').map(badge => badge.getAttribute('data-source')))
        .toEqual(['l1', 'stale', 'l2', 'unknown']);
      expect(screen.getAllByTestId('source-layer-badge')[1]).toHaveClass('text-[var(--semantic-warning)]');
      expect(screen.getAllByTestId('source-layer-badge')[0]).toHaveClass('text-[var(--text-secondary)]');
      expect(JSON.stringify(stats)).toBe(before);
    } finally { release(); }
  });

  it('is neutral without a complete profile and resolves the nearest boundary when profiles change', async () => {
    const view = render(<MemoryRouter>
      <div data-app-design-preview="" {...getAppDesignAttributes('terminal')}>
        <div data-app-design-preview="" data-testid="neutral-boundary">{breakdown()}</div>
      </div>
    </MemoryRouter>);
    const host = view.container.querySelector('[data-app-design-preview]')!;
    const boundary = screen.getByTestId('neutral-boundary');
    const release = observeAppDesignScopes(host);
    try {
      const track = screen.getByRole('img');
      const originalTrack = track.outerHTML;
      const assertNeutral = () => {
        for (const node of [track, ...fills(track)]) {
          expect(node).not.toHaveAttribute('data-app-design-owner');
          expect(consumes(node, feedbackRules, '[data-metric-track]', 'outline')).toBe(false);
          expect(consumes(node, feedbackRules, '[data-metric-fill]', 'box-sizing')).toBe(false);
        }
      };
      assertNeutral();
      boundary.setAttribute('data-app-design-pack', 'v2');
      await waitFor(assertNeutral);
      for (const [name, value] of Object.entries(getAppDesignAttributes('v2'))) boundary.setAttribute(name, value);
      await waitFor(() => expect(track).toHaveAttribute('data-app-design-owner', expect.stringContaining('pack-v2')));
      assertNativeConsumers(track, 'v2');
      expect(consumes(track, feedbackRules, '[data-app-data="ledger"]', 'outline')).toBe(false);
      boundary.removeAttribute('data-app-data');
      await waitFor(assertNeutral);
      expect(track.outerHTML).toBe(originalTrack);
      view.rerender(<MemoryRouter>{breakdown()}</MemoryRouter>);
      const standaloneTrack = screen.getByRole('img');
      expect(standaloneTrack).not.toHaveAttribute('data-app-design-owner');
      expect(consumes(standaloneTrack, feedbackRules, '[data-metric-track]', 'outline')).toBe(false);
      expect(fills(standaloneTrack).map(fill => fill.style.width)).toEqual(['40%', '30%', '20%', '10%']);
    } finally { release(); }
  });

  it.each([
    { name: 'partial sum', total: 20, bySource: { l1: 4, stale: 0, l2: 2, unknown: 0 },
      widths: ['20%', '10%'], titles: ['Live · L1: 4 (20%)', 'Legacy · L2: 2 (10%)'], counts: ['4', '0', '2', '0'] },
    { name: 'overfull sum', total: 4, bySource: { l1: 8, stale: 3, l2: 2, unknown: 1 },
      widths: ['100%', '75%', '50%', '25%'],
      titles: ['Live · L1: 8 (100%)', 'Stale: 3 (75%)', 'Legacy · L2: 2 (50%)', 'Unknown: 1 (25%)'],
      counts: ['8', '3', '2', '1'] },
    { name: 'negative count', total: 4, bySource: { l1: -2, stale: 0, l2: 1, unknown: 0 },
      widths: ['25%'], titles: ['Legacy · L2: 1 (25%)'], counts: ['0', '0', '1', '0'] },
    { name: 'zero total', total: 0, bySource: { l1: 4, stale: 0, l2: 2, unknown: 0 },
      widths: [], titles: [], counts: ['4', '0', '2', '0'] },
    { name: 'negative total', total: -1, bySource: { l1: 4, stale: 0, l2: 2, unknown: 0 },
      widths: [], titles: [], counts: ['4', '0', '2', '0'] },
  ])('keeps the original clamp and omitted segments without renormalizing a $name', ({ total, bySource, widths, titles, counts }) => {
    const input = { ...stats, total, bySource };
    const before = JSON.stringify(input);
    const view = mount({ stats: input }, 'classic');
    const release = observeAppDesignScopes(view.container.querySelector('[data-app-design-preview]')!);
    try {
      const track = screen.getByRole('img');
      assertNativeConsumers(track, 'classic');
      expect(track).toHaveAttribute('aria-label',
        `Signal source-layer distribution: ${bySource.l1} live, ${bySource.stale} stale, ${bySource.l2} legacy, ${bySource.unknown} unknown`);
      expect(track.children).toHaveLength(widths.length);
      expect(fills(track).map(fill => fill.style.width)).toEqual(widths);
      expect(fills(track).map(fill => fill.title)).toEqual(titles);
      expect([...view.container.querySelectorAll('[data-app-metric="tile"] [data-app-part~="metric-value"]')]
        .map(value => value.textContent)).toEqual(counts);
      expect(JSON.stringify(input)).toBe(before);
    } finally { release(); }
  });

  it('does not invent segments for missing counts and preserves fractional source widths', () => {
    const view = mount({ stats: { ...stats, total: undefined, bySource: undefined } as unknown as LiveSignalStats });
    expect(fills(screen.getByRole('img'))).toHaveLength(0);
    expect(view.container.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(4);
    view.rerender(<MemoryRouter>{breakdown({
      stats: { ...stats, total: 3, bySource: { l1: 1, l2: 2 } } as LiveSignalStats,
    })}</MemoryRouter>);
    const segments = fills(screen.getByRole('img'));
    expect(segments.map(fill => fill.style.width)).toEqual([`${(1 / 3) * 100}%`, `${(2 / 3) * 100}%`]);
    expect(segments.map(fill => fill.title)).toEqual(['Live · L1: 1 (33%)', 'Legacy · L2: 2 (67%)']);
    expect(view.container.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(4);
  });

  it('keeps retained evidence and retry separate from fatal, empty and initial sources', () => {
    const onRetry = vi.fn();
    const content = (status: Props['status'], error: unknown = null) =>
      <MemoryRouter>{breakdown({ status, error, onRetry })}</MemoryRouter>;
    const view = render(content('retained', new Error('refresh failed')));
    const retainedTrack = screen.getByRole('img');
    expect(fills(retainedTrack)).toHaveLength(4);
    expect(screen.getByRole('status')).toHaveTextContent('Previously loaded data remains visible while affected sources recover.');
    screen.getByRole('button', { name: 'Retry' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    view.rerender(content('ready'));
    expect(screen.getByRole('img')).toBe(retainedTrack);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    for (const status of ['loading', 'no-vehicle', 'empty', 'retained-empty', 'error'] as const) {
      view.rerender(content(status, status === 'error' ? new Error('first load failed') : null));
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
      expect(view.container.querySelector('[data-metric-track]')).toBeNull();
      expect(view.container.querySelectorAll('[data-app-metric="tile"]')).toHaveLength(0);
      expect(screen.getByRole('heading', { name: 'Source layers' })).toBeInTheDocument();
    }
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
