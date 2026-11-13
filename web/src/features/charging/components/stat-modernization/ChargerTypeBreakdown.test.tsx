import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { expectAppDesignDataMode, matchesAppDesignCss, setAppDesignTestProfile } from '@/components/feedback/appDesignCss.test-utils';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { ChargerTypeData } from '../cost-analysis/types';
import { ChargerTypeBreakdown } from './ChargerTypeBreakdown';

const period = {
  kind: 'unknown', label: 'Selected source period', reason: 'Loaded source rows only',
} as const;
const row: ChargerTypeData = { name: 'Home', cost: 37.125, energy: 50, sessions: 2, color: '#123456' };

function renderBreakdown(props: Partial<Parameters<typeof ChargerTypeBreakdown>[0]> = {}) {
  return render(<MemoryRouter><ChargerTypeBreakdown
    data={[row]} totalCost={100} period={period} {...props}
  /></MemoryRouter>);
}

function stat(container: HTMLElement, label: string) {
  const found = [...container.querySelectorAll('[data-stat]')]
    .find(node => node.querySelector('[data-stat-label]')?.textContent === label);
  expect(found, label).toBeDefined();
  return found!;
}

describe('ChargerTypeBreakdown native source cost-share ownership', () => {
  it('activates the original tracks/fills for all complete designs and preserves five readings, source order and period', () => {
    const data = [row, { ...row, name: 'DC', cost: 125, energy: 0, sessions: 0, color: '#abcdef' }];
    const original = structuredClone(data);
    const { container } = renderBreakdown({ data });
    const tracks = [...container.querySelectorAll<HTMLElement>('[data-metric-track]')];
    expect(tracks).toHaveLength(2);
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(10);
    for (const [index, track] of tracks.entries()) {
      expect(track).toHaveAttribute('data-app-part', 'metric');
      expect(track).toHaveAttribute('data-app-metric', 'bar');
      expect(track).toHaveClass('h-2', 'overflow-hidden', 'rounded-full', 'bg-[var(--surface-2)]');
      expect(track.previousElementSibling).toHaveTextContent(data[index].name);
      expect(track.childElementCount).toBe(1);
      expect(track.firstElementChild).toHaveAttribute('data-metric-fill');
      expect(track.firstElementChild).toHaveClass('h-full', 'rounded-full', 'transition-all');
      expect(track.firstElementChild).toHaveStyle({ backgroundColor: data[index].color });
      expect(track).not.toHaveAttribute('role');
      expect(track).not.toHaveAttribute('aria-valuenow');
      expect(matchesAppDesignCss(track, '[data-metric-track]')).toEqual([]);
    }
    const readings = [...container.querySelectorAll('[data-stat-value]')].map(node => node.textContent);
    expect(stat(container, 'Share (%)')).toHaveTextContent('37.13');
    expect(screen.getByText(period.label)).toBeInTheDocument();
    expect(screen.getByText(period.reason)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Pie chart of charging cost by charger type.' })).toBeInTheDocument();
    container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      setAppDesignTestProfile(container, pack);
      const release = observeAppDesignScopes(container);
      try {
        for (const track of tracks) {
          expectAppDesignDataMode(track, getAppDesignAttributes(pack)['data-app-data'], '[data-metric-track]');
          const selected = matchesAppDesignCss(track.firstElementChild!, '[data-metric-fill]');
          expect(selected.length).toBeGreaterThan(0);
          for (const { declarations } of selected) {
            expect(declarations).toEqual({ 'box-sizing': 'border-box', 'min-inline-size': '0' });
          }
          for (const { declarations } of matchesAppDesignCss(track, '[data-metric-track]')) {
            expect(Object.keys(declarations)).toEqual(['outline', 'outline-offset']);
          }
        }
        expect(tracks.map(track => (track.firstElementChild as HTMLElement).style.width)).toEqual(['37.125%', '100%']);
        expect([...container.querySelectorAll('[data-stat-value]')].map(node => node.textContent)).toEqual(readings);
      } finally { release(); }
    }
    expect(data).toEqual(original);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByRole('meter')).toBeNull();
  });

  it.each([
    { cost: 0, totalCost: 100, width: '0%', state: 'value' },
    { cost: -25, totalCost: 100, width: '0%', state: 'value' },
    { cost: 125, totalCost: 100, width: '100%', state: 'value' },
    { cost: 25, totalCost: 0, width: '0%', state: 'value' },
    { cost: 25, totalCost: -1, width: '0%', state: 'value' },
    { cost: 25, totalCost: NaN, width: '0%', state: 'value' },
    { cost: 25, totalCost: Infinity, width: '0%', state: 'value' },
    { cost: NaN, totalCost: 100, width: '', state: 'invalid' },
    { cost: Infinity, totalCost: 100, width: '100%', state: 'invalid' },
    { cost: -Infinity, totalCost: 100, width: '0%', state: 'invalid' },
  ])('preserves the native clamp and independent raw metric validation for $cost/$totalCost', ({ cost, totalCost, width, state }) => {
    const { container } = renderBreakdown({ data: [{ ...row, cost }], totalCost });
    const track = container.querySelector('[data-metric-track]')!;
    expect((track.firstElementChild as HTMLElement).style.width).toBe(width);
    expect(stat(container, 'Cost')).toHaveAttribute('data-state', state);
    expect(track).not.toHaveAttribute('aria-valuenow');
  });

  it.each([null, undefined])('keeps missing source cost %s distinct from its original zero-width track', cost => {
    const entry = { ...row, cost } as unknown as ChargerTypeData;
    const { container } = renderBreakdown({ data: [entry] });
    expect((container.querySelector('[data-metric-fill]') as HTMLElement).style.width).toBe('0%');
    expect(stat(container, 'Cost')).toHaveAttribute('data-state', 'missing');
    expect(stat(container, 'Share (%)')).toHaveAttribute('data-state', 'missing');
    expect(stat(container, 'Cost')).toHaveTextContent('—');
  });

  it('keeps default/widget-only/incomplete profiles neutral and resolves nearest complete nested profiles', () => {
    const panel = <ChargerTypeBreakdown data={[row]} totalCost={100} period={period} />;
    const { container } = render(<MemoryRouter>
      <section>{panel}</section>
      <section data-widget-pack="v1">{panel}</section>
      <section data-app-design-preview {...getAppDesignAttributes('v1')}>
        {panel}
        <section data-app-design-preview data-app-design-pack="v2">
          {panel}
          <section data-app-design-preview {...getAppDesignAttributes('v3')}>{panel}</section>
        </section>
      </section>
    </MemoryRouter>);
    const tracks = [...container.querySelectorAll('[data-metric-track]')];
    expect(tracks).toHaveLength(5);
    const release = observeAppDesignScopes(container);
    try {
      for (const index of [0, 1, 3]) {
        for (const node of [tracks[index], tracks[index].firstElementChild!]) {
          expect(node).not.toHaveAttribute('data-app-design-owner');
          expect(matchesAppDesignCss(node, '[data-metric-')).toEqual([]);
        }
      }
      expectAppDesignDataMode(tracks[2], 'instrument', '[data-metric-track]');
      expectAppDesignDataMode(tracks[4], 'ledger', '[data-metric-track]');
    } finally { release(); }
  });

  it('retains the real section and retry behavior without fabricating bars in initial/empty states', () => {
    const retry = vi.fn();
    const { container, rerender } = renderBreakdown({ error: new Error('Refresh failed'), onRetry: retry });
    expect(container.querySelectorAll('[data-metric-track]')).toHaveLength(1);
    expect(screen.getByText('Showing retained measurements')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledOnce();
    rerender(<MemoryRouter><ChargerTypeBreakdown data={[row]} totalCost={100} period={period} isLoading /></MemoryRouter>);
    expect(container.querySelectorAll('[data-metric-track]')).toHaveLength(1);
    for (const props of [
      { data: [], isLoading: true },
      { data: [], error: new Error('Initial failure'), onRetry: retry },
      { data: [] },
      { data: null as unknown as ChargerTypeData[] },
      { data: undefined as unknown as ChargerTypeData[] },
    ]) {
      rerender(<MemoryRouter><ChargerTypeBreakdown totalCost={100} period={period} {...props} /></MemoryRouter>);
      expect(container.querySelector('[data-metric-track]')).toBeNull();
      expect(screen.getByRole('heading', { name: 'Cost by Charger Type' })).toBeInTheDocument();
      expect(screen.getByText(period.label)).toBeInTheDocument();
    }
    expect(within(container).queryByRole('progressbar')).toBeNull();
  });
});
