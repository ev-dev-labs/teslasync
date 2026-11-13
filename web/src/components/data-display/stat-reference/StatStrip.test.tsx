import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import { getFormatterPreferences, setGlobalPrecision } from '@/lib/numberFormat';
import type { StatPeriod } from '@/lib/metric-reference';
import { StatGroup, StatStrip } from './index';
import { getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';

vi.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (_key: string, fallback: string) => fallback,
}) }));
vi.mock('@/hooks/useUnits', () => ({ useUnits: () => ({
  unitPrefs: { distance: 'km', speed: 'km/h', temperature: '°C', pressure: 'kPa',
    energy: 'kWh', duration: 'h', power: 'kW', locale: 'en-US' },
}) }));
vi.mock('@/hooks/useFormatting', () => ({ useFormatting: () => ({ currencySymbol: '$' }) }));
vi.mock('@/components/ui', async importOriginal => {
  const actual = await importOriginal<typeof import('@/components/ui')>();
  return { ...actual, Tooltip: ({ content, children }: { content: ReactNode; children: ReactNode }) =>
    <span title={String(content)}>{children}</span> };
});
const period: StatPeriod = { kind: 'unknown', label: 'Unknown source window', reason: 'Unverified bounds' };
const metrics = [{ metricId: 'count', rawValue: 6 }, { metricId: 'energy', rawValue: 850 }] as const;
const initialPrecision = getFormatterPreferences().precision;
afterEach(() => { cleanup(); setGlobalPrecision(initialPrecision); });

describe('single StatStrip renderer contract', () => {
  it.each(PACK_IDS)('activates the %s standalone frame consumer without adding embedded chrome or changing metric banks', packId => {
    const sourceMetrics = Array.from({ length: 6 }, (_, index) => ({
      metricId: 'count' as const, rawValue: index, label: `Source ${index}`,
    }));
    const { container } = render(<div data-app-design-preview="" {...getAppDesignAttributes(packId)}>
      <StatStrip id="standalone" metrics={sourceMetrics} period={period} secondary="Source context" footer="Source footer" />
      <StatStrip id="embedded" variant="embedded" metrics={sourceMetrics} period={period} />
      <div data-app-design-preview=""><StatStrip id="unowned" metrics={sourceMetrics} period={period} /></div>
    </div>);
    const release = observeAppDesignScopes(container);
    try {
      const standalone = container.querySelector('#standalone');
      const embedded = container.querySelector('#embedded');
      const unowned = container.querySelector('#unowned');
      if (!standalone || !embedded || !unowned) throw new Error('Missing stat strip');
      const surfaceSelectors: string[] = [];
      postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[packId]), 'utf8'))
        .walkRules(rule => {
          surfaceSelectors.push(...rule.selectors.filter(selector => selector.includes('[data-app-part~="panel"]')));
        });
      expect(surfaceSelectors.some(selector => standalone.matches(selector))).toBe(true);
      expect(surfaceSelectors.some(selector => embedded.matches(selector))).toBe(false);
      expect(surfaceSelectors.some(selector => unowned.matches(selector))).toBe(false);
      expect([...standalone.querySelectorAll('[data-stat-bank]')].map(bank => bank.children.length)).toEqual([3, 3]);
      expect(standalone.querySelector('[data-stat-secondary]')).toHaveTextContent('Source context');
      expect(standalone.querySelector('[data-stat-footer]')).toHaveTextContent('Source footer');
      expect(standalone.querySelector('[data-state="value"] [data-stat-value]')).toHaveTextContent('0');
      expect(embedded.querySelectorAll('[data-state="value"]')).toHaveLength(6);
      expect(sourceMetrics.map(metric => metric.rawValue)).toEqual([0, 1, 2, 3, 4, 5]);
    } finally {
      release();
    }
  });
  it('owns only the standalone frame while preserving embedded content and neutral previews', () => {
    const { container, rerender } = render(<div data-app-design-preview="" {...getAppDesignAttributes('terminal')}>
      <StatStrip id="owned-strip" metrics={metrics} period={period} retained error="Retained failure" footer="Existing footer" />
      <div data-app-design-preview=""><StatStrip id="neutral-strip" metrics={metrics} period={period} /></div>
    </div>);
    const release = observeAppDesignScopes(container);
    try {
      const strip = container.querySelector('#owned-strip');
      expect(strip?.tagName).toBe('SECTION');
      expect(strip).toHaveAttribute('data-app-part', 'section panel');
      expect(strip).toHaveAttribute('data-surface-variant', 'standalone');
      expect(strip?.getAttribute('data-app-design-owner')).toContain('pack-terminal');
      expect(container.querySelector('#neutral-strip')).not.toHaveAttribute('data-app-design-owner');
      expect(strip?.querySelectorAll('[data-stat]')).toHaveLength(2);
      expect(strip?.querySelector('[data-stat-footer]')).toHaveTextContent('Existing footer');
      expect(screen.getByRole('alert')).toHaveTextContent('Retained failure');
      rerender(<StatStrip id="owned-strip" variant="embedded" metrics={metrics} period={period}
        retained error="Retained failure" footer="Existing footer" />);
      const embedded = container.querySelector('#owned-strip');
      expect(embedded).toHaveAttribute('data-surface-variant', 'embedded');
      expect(embedded).not.toHaveClass('border', 'bg-[var(--surface-1)]');
      expect(embedded?.querySelectorAll('[data-state="value"]')).toHaveLength(2);
      expect(embedded?.querySelector('[data-stat-footer]')).toHaveTextContent('Existing footer');
    } finally {
      release();
    }
  });
  it('renders label above value, period, missing reason and meaningful zero', () => {
    const { container } = render(<StatStrip metrics={[
      { metricId: 'energy', rawValue: 0 }, { metricId: 'duration', rawValue: null, missingReason: 'No completed records' },
    ]} period={period} />);
    const tiles = container.querySelectorAll('[data-stat]');
    expect(tiles).toHaveLength(2);
    expect(tiles[0]?.querySelector('[data-stat-label]')?.textContent).toBe('Energy');
    expect(tiles[0]?.getAttribute('data-state')).toBe('value');
    expect(tiles[1]?.getAttribute('data-missing-reason')).toBe('No completed records');
    expect(screen.getByText('No completed records')).toBeInTheDocument();
    expect(screen.getByText(period.label)).toBeInTheDocument();
    expect(container.querySelector('[data-stat-delta]')).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
  });
  it('links the whole tile with an accessible label and focus styling', () => {
    render(<MemoryRouter><StatStrip metrics={[{ metricId: 'distance', rawValue: 14500, href: '/dev/stats' }]}
      period={period} /></MemoryRouter>);
    const link = screen.getByRole('link', { name: /Distance: / });
    expect(link).toHaveAttribute('href', '/dev/stats');
    expect(link).toHaveAttribute('data-stat');
    expect(link.className).toContain('focus-visible:ring-2');
  });
  it('retains source errors and old values while refreshing; skeletons preserve tile count', () => {
    const { container, rerender } = render(<StatStrip metrics={metrics} period={period} loading error="Refresh failed" />);
    expect(container.querySelectorAll('[data-state="loading"]')).toHaveLength(2);
    expect(screen.getAllByText('Loading measurements')).toHaveLength(2);
    expect(screen.getByRole('alert')).toHaveTextContent('Refresh failed');
    rerender(<StatStrip metrics={metrics} period={period} loading retained error="Refresh failed" />);
    expect(container.querySelectorAll('[data-state="value"]')).toHaveLength(2);
    expect(screen.queryByText('Loading measurements')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Showing retained measurements');
  });
  it('composes identical StatGroup tiles and only inherits an explicit visible owning header', () => {
    const { container, rerender } = render(<StatGroup metrics={metrics} period={period} periodInHeader />);
    expect(container.querySelector('[data-stat-period]')).not.toBeNull();
    rerender(<><p id="owner-period">{period.label}</p>
      <StatGroup metrics={metrics} period={period} periodInHeader periodHeaderId="owner-period" /></>);
    const group = container.querySelector('[data-stat-strip]');
    expect(group?.getAttribute('aria-describedby')).toBe('owner-period');
    expect(group?.querySelector('[data-stat-period]')).toBeNull();
    expect(group?.querySelectorAll('[data-stat]')).toHaveLength(2);
  });
  it.each(['analysis', 'alltime', 'event', 'snapshot', 'unknown'] as const)('exposes %s source period mode', kind => {
    const candidate = { kind, label: 'Explicit source period', start: '2026-10-01',
      endExclusive: '2026-10-02', end: null, timezone: 'UTC', completeness: 'unknown',
      provenance: 'fixture', observedAt: null, eventId: 'fixture' } as StatPeriod;
    const { container } = render(<StatStrip metrics={metrics} period={candidate} />);
    expect(container.querySelector('[data-period-kind]')).toHaveAttribute('data-period-kind', kind);
    expect(container.querySelector(kind === 'snapshot' ? '[data-stat-freshness]' : '[data-stat-period]')).not.toBeNull();
  });
  it('handles empty, single status, odd counts and desktop column cap without fake metrics', () => {
    const { container, rerender } = render(<StatStrip metrics={[]} period={period} />);
    expect(screen.getByText('No metrics supplied')).toBeInTheDocument();
    expect(container.querySelector('[data-stat-strip]')).not.toBeNull();
    rerender(<StatStrip metrics={[{ metricId: 'status', rawValue: 'Recorded status' }]} period={period} />);
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(1);
    expect(container.querySelector('[data-columns]')).toHaveAttribute('data-columns', '1');
    rerender(<StatStrip metrics={[...metrics, { metricId: 'duration', rawValue: 60 }]} period={period} />);
    expect(container.querySelector('[data-columns]')).toHaveAttribute('data-columns', '3');
    rerender(<StatStrip metrics={[...metrics, ...metrics, ...metrics, { metricId: 'duration', rawValue: 60 }]} period={period} />);
    expect(container.querySelectorAll('[data-stat]')).toHaveLength(7);
    expect(container.querySelectorAll('[data-stat-bank]')).toHaveLength(3);
    expect(container.querySelectorAll('[data-stat-bank]')[0]).toHaveAttribute('data-columns', '3');
    expect([...container.querySelectorAll('[data-stat-bank]')].map(bank => bank.querySelectorAll('[data-stat]').length))
      .toEqual([3, 2, 2]);
  });
  it('limits six metrics to two balanced three-tile rows', () => {
    const { container } = render(<StatStrip metrics={Array.from({ length: 6 }, (_, index) => ({
      metricId: 'count' as const, rawValue: index, label: `Metric ${index + 1}`,
    }))} period={period} maxPerRow={3} />);
    expect([...container.querySelectorAll('[data-stat-bank]')].map(bank => bank.querySelectorAll('[data-stat]').length))
      .toEqual([3, 3]);
  });
  it('preserves supplied comparisons and breakdown facts and updates precision mounted', () => {
    setGlobalPrecision(2);
    const { container } = render(<StatStrip period={period}
      metrics={[{ metricId: 'energy', rawValue: 26340, comparison: {
        metricId: 'percent', rawValue: -4, period, label: 'Versus prior source window',
      } }]} breakdown={['4 home', '2 Supercharger', 'Recorded cost']} />);
    expect(container.querySelector('[data-stat-delta]')).toHaveTextContent('-4.00%');
    expect(container.querySelector('[data-stat-breakdown]')).toHaveTextContent('4 home · 2 Supercharger · Recorded cost');
    expect(container.querySelector('[data-stat-value]')).toHaveTextContent('26.34');
    act(() => setGlobalPrecision(4));
    expect(container.querySelector('[data-stat-value]')).toHaveTextContent('26.3400');
  });
});
