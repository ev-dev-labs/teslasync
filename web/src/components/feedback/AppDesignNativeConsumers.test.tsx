import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/api/client';
import { exportKeys, type ExportJobSummary } from '@/api/hooks/useExports';
import { Button } from '../ui/Button';
import { MetricCard } from '../data-display/MetricCard';
import { StatCard } from '../data-display/StatCard';
import { JobProgressDrawer } from './JobProgressDrawer';
import {
  APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes,
} from '../ui/app-designs/designs';
import { WidgetBigNumber } from '@/features/dashboard/widgets/shared/WidgetBigNumber';
import { WidgetComparisonCard } from '@/features/dashboard/widgets/shared/WidgetComparisonCard';
import { WidgetRankedList } from '@/features/dashboard/widgets/shared/WidgetRankedList';
import { WidgetGaugeHero } from '@/features/dashboard/widgets/shared/WidgetGaugeHero';
import LineTelemetryLayout from '@/features/dashboard/widgets/designPacks/families/LineTelemetryLayout';
import InstrumentLayout from '@/features/dashboard/widgets/designPacks/families/InstrumentLayout';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';

vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn(),
}));
vi.mock('react-i18next', async () => ({
  ...await vi.importActual<typeof import('react-i18next')>('react-i18next'),
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
      const template = typeof fallback === 'string' ? fallback : key;
      return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(options?.[name] ?? ''));
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const rules: Rule[] = [];
postcss.parse(readFileSync(
  resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8',
)).walkRules(rule => { rules.push(rule); });
const modePacks: PackId[] = ['classic', 'blueprint', 'v2', 'v1'];

function matchingRules(node: Element, contract = '', mobile = false) {
  return rules.filter(rule => {
    let parent = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && parent.name === 'media'
        && parent.params === '(max-width: 30rem)' && !mobile) return false;
      parent = parent.parent;
    }
    return rule.selector.includes(contract) && rule.selectors.some(selector => node.matches(selector));
  });
}

function declarations(matching: Rule[]) {
  const result: Record<string, string> = {};
  matching.forEach(rule => rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; }));
  return result;
}

function expectModeConsumer(node: Element, pack: PackId, contract: string) {
  const mode = APPLICATION_DESIGNS[pack].data;
  const matching = matchingRules(node, contract).filter(rule => rule.selector.includes('[data-app-data='));
  expect(matching.length, `${mode}: ${contract}`).toBeGreaterThan(0);
  const axis = `[data-app-design-owner~="data-${mode}"]`;
  for (const rule of matching) {
    expect(rule.selectors.filter(selector => node.matches(selector)).every(selector => selector.endsWith(`:where(${axis})`))).toBe(true);
  }
  const owner = node.getAttribute('data-app-design-owner')!;
  node.setAttribute('data-app-design-owner', owner.split(' ').filter(token => token !== `data-${mode}`).join(' '));
  try {
    expect(matchingRules(node, contract).filter(rule => rule.selector.includes('[data-app-data='))).toHaveLength(0);
  } finally {
    node.setAttribute('data-app-design-owner', owner);
  }
}

afterEach(() => {
  localStorage.removeItem('teslasync.exportDrawer.state');
});

describe('settled native data consumers (source selector evidence, not mounted acceptance)', () => {
  it.each(modePacks)('%s composes actual headlines, nested comparison and definition dd readings', pack => {
    const refresh = vi.fn();
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)} dir="rtl">
        <WidgetBigNumber value={0} unit="km" label="Observed distance" animated={false} align="center"
          subtitle="Retained source context" delta={{ text: 'Measured zero', tone: 'neutral' }} />
        <WidgetBigNumber value={null} unit="Wh" label="Unknown energy" size="secondary" animated={false}
          subtitle="Unknown remains unknown" delta={{ text: 'Must not appear' }} />
        <WidgetComparisonCard metrics={[
          { label: 'Previous reading remains in heading', current: 0, previous: 10, formattedCurrent: '0',
            formattedPrevious: '10 km', unit: 'km', tone: 'good' },
          { label: 'Unknown comparison', current: Number.NaN, previous: 0, formattedCurrent: '—', unit: 'Wh' },
        ]} />
        <LineTelemetryLayout appearance="pixel" compact={false} context={<span>Source observation</span>}
          headline={{ label: 'Telemetry headline', value: '0', unit: 'W' }}
          details={[
            { label: 'Observed fact', value: '0', unit: 's' },
            { label: 'Unknown fact', value: null, unit: 's' },
          ]}
          chart={<Button onClick={refresh}>Recover this source</Button>}
          sourceBoundary={content => <section aria-label="Original source boundary">{content}</section>} />
      </div>,
    );
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const headlines = host.querySelectorAll('[data-app-metric="headline"]');
      expect(headlines).toHaveLength(3);
      for (const headline of headlines) {
        expectModeConsumer(headline, pack, '[data-app-metric="headline"]');
        const reading = headline.querySelector(':scope > [data-app-part~="metric-reading"]')!;
        expectModeConsumer(reading, pack, '[data-app-metric="headline"]');
        const styles = declarations(matchingRules(headline));
        expect(styles).not.toHaveProperty('font-size');
        expect(styles).not.toHaveProperty('padding');
        expect(styles).not.toHaveProperty('min-block-size');
      }
      expect(headlines[0]).toHaveClass('h-full', 'flex-col', 'justify-center', 'items-center', 'text-center');
      expect(headlines[0].querySelector('[data-app-part~="metric-value"]')).toHaveTextContent('0');
      expect(headlines[0].querySelector('[data-app-part~="metric-unit"]')).toHaveTextContent('km');
      expect(headlines[1]).toHaveTextContent('—');
      expect(headlines[1].querySelector('[data-app-part~="metric-unit"]')).toBeNull();
      expect(headlines[1].querySelector('[data-app-part~="metric-comparison"]')).toBeNull();
      expect(headlines[1]).toHaveTextContent('Unknown remains unknown');

      const comparisons = host.querySelectorAll('[data-app-metric="comparison"]');
      for (const row of comparisons) {
        expect(row).toHaveClass('flex', 'items-center', 'gap-3', 'py-2');
        expect(row.children).toHaveLength(2);
        const heading = row.querySelector(':scope > [data-app-part~="metric-heading"]')!;
        const readoutGroup = heading.nextElementSibling!;
        const reading = readoutGroup.querySelector('[data-app-part~="metric-reading"]')!;
        const delta = readoutGroup.querySelector('[data-app-part~="metric-comparison"]')!;
        expect(reading.parentElement).toBe(readoutGroup);
        expect(delta.parentElement?.parentElement).toBe(readoutGroup);
        expectModeConsumer(readoutGroup, pack, '[data-app-metric="comparison"]');
        expectModeConsumer(reading, pack, '[data-app-metric="comparison"]');
        expect(declarations(matchingRules(row))).not.toHaveProperty('padding');
      }
      expect(comparisons[0].querySelector('[data-app-part~="metric-heading"]')).toHaveTextContent('Last week 10 km');
      expect(comparisons[0].querySelector('[data-app-part~="metric-comparison"]')).toHaveClass('text-rose-400');
      expect(comparisons[1].querySelector('[data-app-part~="metric-unit"]')).toHaveTextContent('Wh');
      expect(comparisons[1].querySelector('[data-app-part~="metric-comparison"]')).toHaveTextContent('—');

      const facts = host.querySelector('[data-app-list="definitions"]')!;
      expect(facts.tagName).toBe('DL');
      expect([...facts.children].map(row => row.firstElementChild?.textContent)).toEqual(['Observed fact', 'Unknown fact']);
      for (const row of facts.children) {
        expectModeConsumer(row, pack, '[data-app-list="definitions"]');
        const reading = row.querySelector(':scope > dd[data-app-part~="metric-reading"]')!;
        expectModeConsumer(reading, pack, '[data-app-list="definitions"]');
        const styles = declarations(matchingRules(reading));
        expect(styles.display).toBe('flex');
        expect(styles['justify-content']).toBe(APPLICATION_DESIGNS[pack].data === 'cards' ? 'flex-start' : 'flex-end');
      }
      expect(facts.children[0].querySelector('[data-app-part~="metric-unit"]')).toHaveTextContent('s');
      expect(facts.children[1].querySelector('[data-app-part~="metric-unit"]')).toBeNull();
      const pixel = host.querySelector('svg[viewBox="0 0 16 16"]')!;
      expect(pixel).not.toHaveAttribute('data-app-part');
      expect(host.querySelector('section[aria-label="Original source boundary"]')).toContainElement(facts);
      expect(screen.getByText('Source observation').closest('section')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Recover this source' }));
      expect(refresh).toHaveBeenCalledOnce();
    } finally {
      release();
    }
  });

  it.each(modePacks)('%s keeps the real ranked two-cell flex rhythm and nested evidence in all viewport rules', pack => {
    const select = vi.fn();
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <WidgetRankedList order="source" items={[
          { id: 'zero', label: 'Observed zero', value: 0, formattedValue: '0 km (source format)',
            sublabel: 'Complete label context', hint: 'Complete value hint', status: 'warning',
            labelContent: <Button onClick={select}>Open observed zero</Button>, badge: { text: 'Measured', variant: 'neutral' } },
          { id: 'unknown', label: 'Unknown', value: null, formattedValue: '—', sublabel: 'Unavailable source' },
          { id: 'negative', label: 'Valid negative', value: -2, formattedValue: '−2 Wh/km' },
        ]} />
      </div>,
    );
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const list = host.querySelector('[data-app-list="ranked"]')!;
      expect([...list.children].map(row => row.querySelector('[data-app-part~="metric-value"]')?.textContent))
        .toEqual(['0 km (source format)', '—', '−2 Wh/km']);
      for (const mobile of [false, true]) {
        expect(declarations(matchingRules(list, '', mobile)).display).toBe('flex');
        for (const row of list.children) {
          expect(row.children).toHaveLength(2);
          expectModeConsumer(row, pack, '[data-app-list="ranked"]');
          const styles = declarations(matchingRules(row, '', mobile));
          expect(styles.display).toBe('flex');
          expect(styles['flex-direction']).toBe('row');
          expect(styles.gap).toBe('0.625rem');
          expect(styles['min-block-size']).toBe('2rem');
          expect(styles['padding-block']).toBe('0.5rem');
          for (const cell of row.children) {
            expectModeConsumer(cell, pack, '[data-app-list="ranked"]');
          }
        }
      }
      const contexts = list.querySelectorAll('[data-app-part~="metric-context"]');
      expect(contexts).toHaveLength(3);
      for (const context of contexts) {
        expect(context.parentElement?.parentElement).not.toBe(list);
        expect(declarations(matchingRules(context))).not.toHaveProperty('grid-column');
      }
      expect(list.querySelector('[aria-hidden="true"]')).toHaveClass('bg-[var(--semantic-warning)]');
      expect(list.querySelector('[data-app-part~="metric-unit"], [data-metric-fill], [role="meter"]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Open observed zero' }));
      expect(select).toHaveBeenCalledOnce();
    } finally {
      release();
    }
  });

  it.each(modePacks)('%s retains ordinary card consumers without claiming specialized content inside an icon', pack => {
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <MetricCard label="Original metric card" value="8" subtitle="Original metric context" />
        <StatCard label="Original card" value="8" icon={
          <InstrumentLayout appearance="studio" family="ring" headline={
            <WidgetBigNumber value={0} animated={false} label="Nested headline" subtitle="Nested context" />
          } reading={{ value: 25, max: 100, label: 'Actual radial', color: 'var(--semantic-warning)' }}
            details={<WidgetComparisonCard metrics={[
              { label: 'Nested comparison', current: 0, previous: 10, formattedCurrent: '0',
                formattedPrevious: '10 km', unit: 'km' },
            ]} />} />
        } />
      </div>,
    );
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const ring = host.querySelector('[data-app-metric="ring"]')!;
      const headline = ring.querySelector('[data-app-metric="headline"]')!;
      const comparison = host.querySelector('[data-app-metric="comparison"]')!;
      const specialized = [ring, headline, ...headline.querySelectorAll('[data-app-part]'),
        comparison, ...comparison.querySelectorAll('[data-app-part]')];
      for (const node of specialized) {
        expect(matchingRules(node).filter(rule => rule.selector.includes('[data-app-metric="stat-card"]'))).toHaveLength(0);
      }
      const ordinary = host.querySelector('[data-role="metric-card"]')!;
      expectModeConsumer(ordinary, pack, '[data-app-metric="card"]');
      const body = ordinary.querySelector(':scope > [data-app-part~="metric-frame"] > [data-app-part~="metric-body"]')!;
      expect(body).toHaveTextContent('Original metric card8Original metric context');
      if (APPLICATION_DESIGNS[pack].data !== 'cards') expectModeConsumer(body, pack, '[data-app-metric="card"]');
      const gauge = ring.querySelector('svg[data-chart-family="radial-gauge"]')!;
      expect(gauge).toHaveAttribute('viewBox', '0 0 100 100');
      expect(gauge.querySelector('[data-chart-gauge-fill]')).toHaveAttribute('stroke-dasharray', '25 100');
      expect(gauge.querySelector('[data-chart-gauge-fill]')).toHaveAttribute('stroke', 'var(--semantic-warning)');
      expect(declarations(matchingRules(headline.querySelector('[data-app-part~="metric-value"]')!)))
        .not.toHaveProperty('font-size');
    } finally {
      release();
    }
  });

  it('uses the nearest complete native profile and leaves default, neutral and incomplete sources untouched', async () => {
    const view = render(
      <div>
        <WidgetBigNumber value={0} animated={false} label="Widget-only default" />
        <div data-app-design-preview="" {...getAppDesignAttributes('v1')}>
          <WidgetBigNumber value={0} animated={false} label="Outer source" />
          <div data-app-design-preview="" {...getAppDesignAttributes('blueprint')} data-testid="nested-native">
            <WidgetBigNumber value={0} animated={false} label="Nested source" />
          </div>
          <div data-app-design-preview="" data-app-design-pack="v1">
            <WidgetBigNumber value={null} animated={false} label="Incomplete source" />
          </div>
          <div data-app-design-preview="">
            <WidgetBigNumber value={null} animated={false} label="Neutral source" />
          </div>
        </div>
      </div>,
    );
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      for (const label of ['Widget-only default', 'Incomplete source', 'Neutral source']) {
        const headline = screen.getByText(label).closest('[data-app-metric="headline"]')!;
        expect(headline).not.toHaveAttribute('data-app-design-owner');
        expect(matchingRules(headline)).toHaveLength(0);
      }
      const outer = screen.getByText('Outer source').closest('[data-app-metric="headline"]')!;
      const nested = screen.getByText('Nested source').closest('[data-app-metric="headline"]')!;
      expectModeConsumer(outer, 'v1', '[data-app-metric="headline"]');
      expectModeConsumer(nested, 'blueprint', '[data-app-metric="headline"]');
      const preview = screen.getByTestId('nested-native');
      for (const [name, value] of Object.entries(getAppDesignAttributes('v2'))) preview.setAttribute(name, value);
      await waitFor(() => expect(nested.getAttribute('data-app-design-owner')).toContain('data-cards'));
      expectModeConsumer(nested, 'v2', '[data-app-metric="headline"]');
      expectModeConsumer(outer, 'v1', '[data-app-metric="headline"]');
    } finally {
      release();
    }
  });

  it.each(modePacks)('%s leaves the real native-gauge bank out of desktop and mobile grid composers', pack => {
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <WidgetGaugeHero gauge={{ value: 0, max: 100, label: 'Measured capacity', unit: '%',
          color: 'var(--semantic-warning)', preserveReadingAndScale: true }}
          stats={[{ label: 'Supplied statistic', value: '0', unit: 'whole unit' }]}>
          <Button>Original child action</Button>
        </WidgetGaugeHero>
      </div>,
    );
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const native = host.querySelector('[data-app-metric-grid="native-gauge"]')!;
      expect(native).toHaveClass('flex', 'flex-col', 'h-full', 'items-center', 'justify-center');
      for (const mobile of [false, true]) {
        const styles = declarations(matchingRules(native, '', mobile));
        expect(Object.keys(styles)).toEqual(['min-inline-size']);
      }
      const meter = screen.getByRole('meter', { name: 'Measured capacity' });
      expect(meter).toHaveAttribute('aria-valuenow', '0');
      const fill = meter.querySelector('[data-chart-gauge-fill]');
      expect(fill).toHaveStyle({ width: '0%' });
      expect(native).toHaveTextContent('0whole unit');
      expect(native.querySelector('[data-app-part~="metric-unit"]')).toBeNull();
      expect(screen.getByRole('button', { name: 'Original child action' })).toBeEnabled();
    } finally {
      release();
    }
  });

  it.each(modePacks)('%s binds opened real export records without inventing progress or recasting chronology', async pack => {
    const jobs: ExportJobSummary[] = [
      { id: 'queued', type: 'drives', format: 'Unmodified format', status: 'queued', created_at: '2026-01-03T00:00:00Z' },
      { id: 'zero', type: 'charging', format: 'csv', status: 'ready', file_size: 0, created_at: '2026-01-02T00:00:00Z' },
      { id: 'processing', type: 'account', format: 'json', status: 'processing', created_at: '2026-01-04T00:00:00Z' },
      { id: 'missing', type: 'backup', format: 'json', status: 'ready', created_at: '2026-01-01T00:00:00Z' },
      { id: 'failed', type: 'analytics', format: 'csv', status: 'failed', error_message: 'Full original source diagnostic', created_at: '2025-12-31T00:00:00Z' },
      { id: 'expired', type: 'drives', format: 'csv', status: 'expired', file_size: Number.NaN, created_at: '2025-12-30T00:00:00Z' },
    ];
    vi.mocked(request).mockResolvedValue(jobs);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    client.setQueryData(exportKeys.jobs, jobs);
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
        <QueryClientProvider client={client}><MemoryRouter><JobProgressDrawer /></MemoryRouter></QueryClientProvider>
      </div>,
    );
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      fireEvent.click(screen.getByRole('button', { name: /Show export jobs/ }));
      const drawer = await screen.findByRole('region', { name: 'Export job progress' });
      const rows = drawer.querySelectorAll('[data-app-list="export-jobs"] > [data-app-record-kind="export-job"]');
      await waitFor(() => expect(rows[0]).toHaveAttribute('data-app-design-owner'));
      expect([...rows].map(row => row.getAttribute('data-app-job-status'))).toEqual([
        'queued', 'processing', 'ready', 'ready', 'failed', 'expired',
      ]);
      for (const row of rows) {
        expectModeConsumer(row, pack, '[data-app-list="export-jobs"]');
        for (const slot of ['job-body', 'job-label', 'job-format', 'job-context']) {
          expectModeConsumer(row.querySelector(`[data-app-part~="${slot}"]`)!, pack, '[data-app-record-kind="export-job"]');
        }
      }
      expect(rows[0].querySelector('[data-app-part~="job-format"]')).toHaveTextContent('Unmodified format');
      expect(rows[2].querySelector('[data-app-part~="job-context"]')).toHaveTextContent(/^0 B · /);
      for (const index of [3, 5]) {
        expect(rows[index].querySelector('[data-app-part~="job-context"]')).toHaveTextContent(/^— · /);
      }
      const error = rows[4].querySelector('[data-app-part~="job-error"]')!;
      expect(error).toHaveTextContent('Full original source diagnostic');
      expect(error).toHaveClass('text-[var(--semantic-danger)]');
      expectModeConsumer(error, pack, '[data-app-record-kind="export-job"]');
      expect(declarations(matchingRules(error))).not.toHaveProperty('color');
      expect(within(drawer).getAllByRole('link').map(link => link.getAttribute('href'))).toEqual([
        '/api/v1/export/jobs/zero/download', '/api/v1/export/jobs/missing/download',
      ]);
      expect(drawer.querySelector('[data-app-part~="metric"], [role="progressbar"]')).toBeNull();
      fireEvent.click(within(drawer).getByRole('button', { name: 'Minimize' }));
      expect(localStorage.getItem('teslasync.exportDrawer.state')).toBe('minimized');
    } finally {
      release();
      client.clear();
    }
  });
});
