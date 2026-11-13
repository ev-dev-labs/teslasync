import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import postcss, { type Rule } from 'postcss';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { request } from '@/api/client';
import { Stepper, type OnboardingStep } from '@/features/onboarding/components/Stepper';
import { ProviderStatusPanel } from '@/features/action-center/components/ProviderStatusPanel';
import CommandHistoryPage from '@/features/system/pages/CommandHistoryPage';
import { SelectedVehicleProvider } from '@/store/selectedVehicle';
import { setLowBandwidthMode } from '@/hooks/useLowBandwidthMode';
import { severityTokens } from '@/lib/tokens';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import { ComboboxMulti } from '../../forms/ComboboxMulti';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes, APP_DESIGN_PACK_FILES } from './designs';

const deferredSearch = vi.hoisted(() => ({ held: null as string | null }));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return {
    ...actual,
    useDeferredValue: (value: unknown) => {
      const deferred = actual.useDeferredValue(value);
      return typeof value === 'string' && deferredSearch.held != null ? deferredSearch.held : deferred;
    },
  };
});
vi.mock('@/api/client', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/client')>(),
  request: vi.fn(),
}));

const rules: Rule[] = [];
postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => { rules.push(rule); });

function matching(node: Element, contract = '', wide = false) {
  return rules.filter(rule => {
    if (!rule.selector.includes(contract)) return false;
    let parent = rule.parent;
    while (parent) {
      if (parent.type === 'atrule' && parent.name === 'media'
        && parent.params === '(min-width: 40rem)' && !wide) return false;
      parent = parent.parent;
    }
    return rule.selectors.some(selector => node.matches(selector));
  });
}

function declarations(matches: Rule[]) {
  const result: Record<string, string> = {};
  matches.forEach(rule => rule.walkDecls(declaration => { result[declaration.prop] = declaration.value; }));
  return result;
}

function expectOwnedConsumer(node: Element, axis: string, contract: string) {
  const matches = matching(node, contract).filter(rule => rule.selector.includes(`[data-app-${axis.split('-')[0]}=`));
  expect(matches.length, `${axis}: ${contract}`).toBeGreaterThan(0);
  for (const rule of matches) {
    expect(rule.selectors.filter(selector => node.matches(selector))
      .every(selector => selector.endsWith(`:where([data-app-design-owner~="${axis}"])`))).toBe(true);
  }
  const owner = node.getAttribute('data-app-design-owner')!;
  node.setAttribute('data-app-design-owner', owner.split(' ').filter(token => token !== axis).join(' '));
  try {
    expect(matches.some(rule => rule.selectors.some(selector => node.matches(selector)))).toBe(false);
  } finally { node.setAttribute('data-app-design-owner', owner); }
}

const steps = (onClick = vi.fn()): OnboardingStep[] => [
  { key: 'done', title: 'Confirmed anchor', description: 'Source-confirmed setup', done: true },
  { key: 'current', title: 'Current anchor', description: 'Explicit work only', done: false,
    cta: { label: 'Recover anchor', onClick } },
  { key: 'pending', title: 'Later anchor', description: 'Not started', done: false },
  { key: 'unknown', title: 'Unknown anchor', description: 'No completion evidence', done: null },
];

beforeEach(() => {
  deferredSearch.held = null;
  vi.mocked(request).mockReset();
});
afterEach(() => {
  deferredSearch.held = null;
  act(() => { setLowBandwidthMode('auto'); });
});

describe('native feedback followup (source selectors, not browser geometry acceptance)', () => {
  it.each(PACK_IDS)('%s composes real steps without repainting or resizing state geometry', pack => {
    const recover = vi.fn();
    const view = render(
      <div data-app-design-preview="" {...getAppDesignAttributes(pack)} dir="rtl">
        <Stepper steps={steps(recover)} />
      </div>,
    );
    const host = view.container.firstElementChild!;
    const release = observeAppDesignScopes(host);
    try {
      const list = screen.getByRole('list', { name: 'Onboarding steps' });
      expect(list).toHaveClass('flex', 'flex-col', 'gap-5', 'sm:gap-6');
      expect(declarations(matching(list))['row-gap']).toBe('1.25rem');
      expect(declarations(matching(list, '', true))['row-gap']).toBe('1.5rem');
      const rows = within(list).getAllByRole('listitem');
      expect(rows.map(row => row.getAttribute('data-step-id'))).toEqual(['done', 'current', 'pending', 'unknown']);
      expect(rows.map(row => row.getAttribute('data-state'))).toEqual(['done', 'current', 'pending', 'unknown']);
      expect(rows[1]).toHaveAttribute('aria-current', 'step');
      expect(rows[3]).not.toHaveAttribute('aria-current');
      for (const row of rows) {
        expectOwnedConsumer(row, `data-${APPLICATION_DESIGNS[pack].data}`, '[data-app-step-kind="onboarding"]');
        const rowStyles = declarations(matching(row));
        expect(rowStyles).toHaveProperty('outline');
        for (const property of ['display', 'gap', 'padding', 'border', 'height', 'width', 'order', 'color', 'background']) {
          expect(rowStyles).not.toHaveProperty(property);
        }
        const body = row.querySelector('[data-app-part="step-body"]')!;
        expectOwnedConsumer(body, `feedback-${APPLICATION_DESIGNS[pack].feedback}`, '[data-app-step-kind="onboarding"]');
        for (const copy of body.querySelectorAll(':scope > [data-app-part="step-title"], :scope > [data-app-part="step-description"]')) {
          expectOwnedConsumer(copy, `feedback-${APPLICATION_DESIGNS[pack].feedback}`, '[data-app-step-kind="onboarding"]');
        }
        const indicator = row.querySelector('[data-app-part="step-indicator"]')!;
        expect(indicator).toHaveAttribute('aria-hidden', 'true');
        expect(indicator).toHaveClass('h-9', 'w-9', 'rounded-full');
        expect(matching(indicator)).toHaveLength(0);
      }
      const connectors = list.querySelectorAll('[data-app-part="step-connector"]');
      expect(connectors).toHaveLength(3);
      for (const connector of connectors) {
        expect(connector).toHaveClass('w-px', 'flex-1', 'min-h-[28px]');
        expect(matching(connector)).toHaveLength(0);
      }
      expect(rows[0].querySelector('[data-app-part="step-indicator"]')).toHaveClass(...severityTokens.success.fg.split(' '));
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(host.querySelector('[role="meter"], [role="progressbar"], [data-metric-track]')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Recover anchor' }));
      expect(recover).toHaveBeenCalledOnce();
    } finally { release(); }
  });

  it.each(['default', 'widget-only', 'incomplete'] as const)('%s leaves real steps and records unowned', scope => {
    const view = render(<div data-app-design-preview="">
      <Stepper steps={steps()} />
      <ProviderStatusPanel providers={[{ source_feature: 'active_alerts', status: 'available', item_count: 0, limitations: [] }]} loading={false} />
    </div>);
    const host = view.container.firstElementChild!;
    if (scope === 'widget-only') host.setAttribute('data-widget-pack', 'v2');
    if (scope === 'incomplete') {
      Object.entries(getAppDesignAttributes('v2')).forEach(([name, value]) => host.setAttribute(name, value));
      host.removeAttribute('data-app-chart');
    }
    const release = observeAppDesignScopes(host);
    try {
      for (const element of host.querySelectorAll('[data-app-step-kind], [data-app-card-kind="record"], [data-app-part="step-body"]')) {
        expect(element).not.toHaveAttribute('data-app-design-owner');
        expect(matching(element)).toHaveLength(0);
      }
    } finally { release(); }
  });

  it('uses the nearest complete mode for nested actual steps and keeps incomplete islands neutral', async () => {
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes('classic')}>
      <Stepper steps={steps()} />
      <section data-app-design-preview="" {...getAppDesignAttributes('v2')} aria-label="Nested source">
        <Stepper steps={steps()} />
      </section>
    </div>);
    const host = view.container.firstElementChild!;
    const nested = screen.getByRole('region', { name: 'Nested source' });
    const release = observeAppDesignScopes(host);
    try {
      const row = nested.querySelector('[data-app-step-kind="onboarding"]')!;
      expect(matching(row, '[data-app-data="table"]')).toHaveLength(0);
      expectOwnedConsumer(row, 'data-cards', '[data-app-step-kind="onboarding"]');
      nested.removeAttribute('data-app-controls');
      await waitFor(() => expect(row).not.toHaveAttribute('data-app-design-owner'));
      expect(matching(row)).toHaveLength(0);
    } finally { release(); }
  });

  it.each(['classic', 'blueprint', 'v2', 'v1'] as const)('%s reuses generic real record consumers without a kind engine', pack => {
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
      <ProviderStatusPanel providers={[
        { source_feature: 'active_alerts', status: 'available', item_count: 0, limitations: [] },
        { source_feature: 'battery_health', status: 'unavailable', item_count: 2, limitations: ['Retained; freshness unknown.'] },
      ]} loading={false} />
    </div>);
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const records = view.container.querySelectorAll('[data-app-record-kind="action-provider"]');
      expect(records).toHaveLength(2);
      for (const record of records) {
        expectOwnedConsumer(record, `data-${APPLICATION_DESIGNS[pack].data}`, '[data-app-card-kind="record"]');
        expect(declarations(matching(record)).display).toBe('flex');
        expect(record).toHaveClass('p-3');
        expect(declarations(matching(record))).not.toHaveProperty('padding');
        const body = record.querySelector(':scope > [data-app-part~="record-body"]')!;
        expect(declarations(matching(body))).toHaveProperty('grid-column', '1 / -1');
      }
      expect(screen.getByText('0 findings')).toBeInTheDocument();
      expect(screen.getByText('Retained; freshness unknown.')).toBeInTheDocument();
      expect(screen.getByText('unavailable')).toHaveClass('text-[var(--semantic-danger)]');
    } finally { release(); }
  });

  it('accepts the real implicit-live Combobox ring without altering its separate hidden status or chips', () => {
    const item = { id: 'retained', name: 'Retained selection' };
    const props = {
      label: 'Selected records', value: [item], options: [item], onChange: vi.fn(),
      getOptionLabel: (option: typeof item) => option.name,
      getOptionKey: (option: typeof item) => option.id,
    };
    const view = render(<div data-app-design-preview="" {...getAppDesignAttributes('classic')}>
      <ComboboxMulti {...props} loading />
    </div>);
    const host = view.container.firstElementChild!;
    const ring = screen.getByRole('status', { name: 'Loading' });
    const input = screen.getByRole('combobox', { name: 'Selected records' });
    const hiddenStatus = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(ring).toHaveAttribute('data-app-part', 'loading-indicator');
    expect(ring).toHaveAttribute('data-app-feedback-kind', 'inline-spinner');
    expect(ring).not.toHaveAttribute('aria-live');
    expect(ring).not.toHaveAttribute('aria-hidden');
    expect(ring).toHaveClass('h-3', 'w-3', 'animate-spin', 'rounded-full', 'border-2', 'border-[var(--text-muted)]', 'border-t-transparent');
    expect(input).toHaveAccessibleDescription('Loading');
    expect(hiddenStatus).toBeInTheDocument();
    expect(hiddenStatus).not.toHaveAttribute('hidden');
    expect(hiddenStatus).not.toHaveAttribute('aria-hidden');
    expect(hiddenStatus).not.toHaveAttribute('role');
    expect(hiddenStatus).not.toHaveAttribute('aria-live');
    expect(hiddenStatus).toHaveTextContent('Loading');
    expect(hiddenStatus).not.toBe(ring);
    for (const pack of PACK_IDS) {
      Object.entries(getAppDesignAttributes(pack)).forEach(([name, value]) => host.setAttribute(name, value));
      const release = observeAppDesignScopes(host);
      try {
        expectOwnedConsumer(ring, `feedback-${APPLICATION_DESIGNS[pack].feedback}`, '[data-app-feedback-kind="inline-spinner"]');
        const intrinsic = declarations(matching(ring, '[data-app-feedback-kind="inline-spinner"]'));
        expect(intrinsic).toEqual({ 'pointer-events': 'none', 'user-select': 'none' });
        expect(ring).not.toHaveAttribute('aria-live');
        expect(hiddenStatus).toHaveTextContent('Loading');
        expect(input).toHaveAccessibleDescription('Loading');
        expect(input).toHaveAttribute('aria-busy', 'true');
        expect(screen.getByRole('button', { name: 'Remove Retained selection' })).toBeInTheDocument();
      } finally { release(); }
    }
    view.rerender(<div data-app-design-preview="" {...getAppDesignAttributes('classic')}>
      <ComboboxMulti {...props} loading={false} />
    </div>);
    expect(screen.queryByRole('status', { name: 'Loading' })).toBeNull();
    expect(document.getElementById(input.getAttribute('aria-describedby')!)).toBe(hiddenStatus);
    expect(hiddenStatus).toBeEmptyDOMElement();
    expect(input).toHaveAccessibleDescription('');
    expect(input).not.toHaveAttribute('aria-busy');
    expect(props.onChange).not.toHaveBeenCalled();
  });

  it('consumes the real pending ring in all27 without block-loader geometry, paint or motion', async () => {
    vi.mocked(request).mockImplementation(async path => {
      if (String(path).includes('/commands/history')) return [{
        id: 1, vehicle_id: 10, command: 'lock', params: '', status: 'success', error: '',
        created_at: new Date().toISOString(),
      }];
      if (String(path).includes('/vehicles')) return [{ id: 10, vin: 'TEST_ONLY', display_name: 'Test vehicle', state: 'online' }];
      return {};
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(<QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/command-history']}>
        <SelectedVehicleProvider><CommandHistoryPage /></SelectedVehicleProvider>
      </MemoryRouter>
    </QueryClientProvider>);
    await screen.findByText('1 commands');
    expect(screen.queryByRole('status', { name: 'Filtering…' })).toBeNull();
    deferredSearch.held = '';
    fireEvent.change(screen.getByRole('textbox', { name: 'Search commands' }), { target: { value: 'wake' } });
    const ring = screen.getByRole('status', { name: 'Filtering…' });
    expect(ring).toHaveAttribute('aria-live', 'polite');
    expect(ring).toHaveClass('absolute', 'end-3', 'top-1/2', '-translate-y-1/2', 'h-3', 'w-3', 'border-2', 'animate-spin');
    view.container.setAttribute('data-app-design-preview', '');
    for (const pack of PACK_IDS) {
      Object.entries(getAppDesignAttributes(pack)).forEach(([name, value]) => view.container.setAttribute(name, value));
      const release = observeAppDesignScopes(view.container);
      try {
        expectOwnedConsumer(ring, `feedback-${APPLICATION_DESIGNS[pack].feedback}`, '[data-app-feedback-kind="inline-spinner"]');
        const styles = declarations(matching(ring));
        expect(styles).toHaveProperty('pointer-events', 'none');
        for (const property of Object.keys(styles)) {
          expect(property).not.toMatch(/^(?:padding|border|display|position|width|height|inline-size|block-size|color|background|animation|transition|transform|inset|top|right|left|bottom)/);
        }
        const identity: Rule[] = [];
        postcss.parse(readFileSync(resolve('src', 'components', 'ui', 'app-designs', 'packs', APP_DESIGN_PACK_FILES[pack]), 'utf8'))
          .walkRules(rule => { if (rule.selector.includes('[data-app-part~="loading"]')) identity.push(rule); });
        expect(identity.length).toBeGreaterThan(0);
        expect(identity.some(rule => rule.selectors.some(selector => ring.matches(selector)))).toBe(false);
      } finally { release(); }
    }
    act(() => { setLowBandwidthMode('on'); });
    expect(ring).not.toHaveClass('animate-spin');
    expect(screen.getByText('1 commands')).toBeInTheDocument();
    deferredSearch.held = null;
    fireEvent.change(screen.getByRole('textbox', { name: 'Search commands' }), { target: { value: 'lock' } });
    await waitFor(() => expect(screen.queryByRole('status', { name: 'Filtering…' })).toBeNull());
    view.unmount();
    client.clear();
  });
});
