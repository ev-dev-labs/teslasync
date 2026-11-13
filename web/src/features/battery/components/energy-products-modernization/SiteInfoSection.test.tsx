import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import postcss from 'postcss';
import { APPLICATION_DESIGNS, getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import { PACK_IDS } from '@/features/dashboard/widgets/designPacks/types';
import type { TeslaEnergySiteInfoResponse } from '@/types/energy';
import { SiteInfoSection } from './SiteInfoSection';

type SiteInfoTestResponse = Omit<TeslaEnergySiteInfoResponse, 'data'> & { data: Record<string, unknown> };

const consumers: string[] = [];
postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'feedback.css'), 'utf8'))
  .walkRules(rule => {
    if (rule.nodes.some(node => node.type === 'decl')) consumers.push(...rule.selectors);
  });
function expectAppDesignDataMode(node: Element, mode: string, contract: string) {
  expect(consumers.some(selector => selector.includes(`[data-app-data="${mode}"]`)
    && selector.includes(contract) && node.matches(selector))).toBe(true);
  expect(node.getAttribute('data-app-design-owner')?.split(' ')).toContain(`data-${mode}`);
}

const h = vi.hoisted(() => ({
  response: undefined as SiteInfoTestResponse | undefined,
  loading: false, error: null as Error | null, refreshError: false, pending: false,
  retry: vi.fn(), refresh: vi.fn(), update: vi.fn(),
}));
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
vi.mock('@/api/hooks/useEnergy', async importOriginal => ({
  ...await importOriginal<typeof import('@/api/hooks/useEnergy')>(),
  useTeslaEnergySiteInfo: () => ({
    data: h.response, isLoading: h.loading, isSuccess: !h.loading && !h.error,
    isError: Boolean(h.error), error: h.error, refetch: h.retry, fetchStatus: 'idle',
    isRefetchError: h.refreshError, dataUpdatedAt: h.response ? Date.parse('2026-06-01T12:00:00Z') : 0,
  }),
  useRefreshTeslaEnergySiteInfo: () => ({ mutate: h.refresh, isPending: h.pending }),
  useUpdateTOUSettings: () => ({ mutate: h.update, isPending: false }),
}));
function tree(pack: typeof PACK_IDS[number] = 'blueprint', touCapable = true) {
  return <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>
    <SiteInfoSection siteId={555} touCapable={touCapable} />
  </div>;
}
function mount(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { enabled: false, retry: false } } });
  const wrap = (node: ReactNode) => <QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>;
  const view = render(wrap(children));
  return { ...view, client, rerenderSection: (node: ReactNode) => view.rerender(wrap(node)) };
}
beforeEach(() => {
  vi.clearAllMocks();
  h.loading = false; h.error = null; h.refreshError = false; h.pending = false;
  h.response = { fetched_at: '2026-06-01T12:00:00Z', data: {
    default_real_mode: 'autonomous', backup_reserve_percent: 0, battery_count: 2,
    nameplate_power: 5000, nameplate_energy: 13_500, version: '23.44.0',
    components: { tou_capable: true, backup: false, solar: true },
    tou_settings: { tariff_content_v2: { name: 'Nested source tariff — full unabridged name' } },
  } };
});

describe('site configuration native info tiles and rate-plan record (source-only)', () => {
  it.each(PACK_IDS)('%s owns actual mode/reserve/plan surfaces while preserving the original zero gauge scale and controls', pack => {
    const before = JSON.stringify(h.response);
    const view = mount(tree(pack));
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const records = view.container.querySelectorAll('[data-app-card-kind="record"]');
      expect(records).toHaveLength(3);
      for (const record of records) {
        expectAppDesignDataMode(record, APPLICATION_DESIGNS[pack].data, '[data-app-card-kind="record"]');
        expectAppDesignDataMode(record.querySelector('[data-app-part~="record-header"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-part~="record-header"]');
        expect(record.querySelector('[data-app-part~="record-title"]')).not.toBeEmptyDOMElement();
      }
      expect(records[0]).toHaveTextContent('Operation ModeTime-Based Control');
      for (const record of [records[0], records[1]]) {
        expectAppDesignDataMode(record.querySelector('[data-app-part="record-body"]')!,
          APPLICATION_DESIGNS[pack].data, '[data-app-part~="record-body"]');
      }
      const gauge = within(records[1] as HTMLElement).getByRole('meter', { name: 'Backup Reserve' });
      expect(gauge).toHaveAttribute('aria-valuenow', '0');
      expect(gauge).toHaveAttribute('aria-valuemin', '0');
      expect(gauge).toHaveAttribute('aria-valuemax', '100');
      const fill = gauge.querySelector('[data-chart-gauge-fill]')!;
      expect(fill).toHaveStyle({ width: '0%', backgroundColor: 'var(--semantic-info)' });
      expect(records[2]).toHaveTextContent('Nested source tariff — full unabridged name');
      expectAppDesignDataMode(records[2].querySelector('[data-app-part="record-context"]')!,
        APPLICATION_DESIGNS[pack].data, '[data-app-part~="record-context"]');
      expect(within(records[2] as HTMLElement).getByRole('button', { name: 'Update rate plan' }))
        .toHaveAttribute('data-app-part', 'button');
      fireEvent.click(screen.getByRole('button', { name: 'Refresh site info' }));
      expect(h.refresh).toHaveBeenCalledExactlyOnceWith(555);
      expect(screen.getByText('Firmware: 23.44.0')).toBeInTheDocument();
      expect(screen.getByText(/Site info fetched/)).toBeInTheDocument();
      expect(JSON.stringify(h.response)).toBe(before);
    } finally { release(); view.unmount(); view.client.clear(); }
  });

  it('retains the actual TOU modal action and top-level/nested/no-plan lookup without inventing eligibility', () => {
    const view = mount(tree());
    fireEvent.click(screen.getByRole('button', { name: 'Update rate plan' }));
    const dialog = screen.getByRole('dialog', { name: 'Update Rate Plan' });
    expect(within(dialog).getByRole('tab', { name: 'Preset Tariff' })).toBeInTheDocument();
    expect(h.update).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    h.response = { ...h.response!, data: { ...h.response!.data, tariff_content_v2: { name: 'Top-level tariff' } } };
    view.rerenderSection(tree());
    expect(screen.getByText('Top-level tariff')).toBeInTheDocument();
    h.response = { ...h.response, data: { ...h.response.data, tariff_content_v2: undefined, tou_settings: undefined, components: {} } };
    view.rerenderSection(tree());
    expect(screen.getByText('No rate plan configured')).toBeInTheDocument();
    view.rerenderSection(tree('blueprint', false));
    expect(screen.queryByRole('button', { name: 'Update rate plan' })).not.toBeInTheDocument();
    expect(view.container.querySelectorAll('[data-app-card-kind="record"]')).toHaveLength(2);
    view.unmount(); view.client.clear();
  });

  it.each([null, Number.NaN])('keeps unknown reserve %s distinct from zero and retains usable data on a refresh error', reserve => {
    h.response = { ...h.response!, data: { ...h.response!.data, backup_reserve_percent: reserve } };
    h.error = new Error('Retained configuration refresh failed'); h.refreshError = true;
    const view = mount(tree());
    expect(screen.queryByRole('meter')).not.toBeInTheDocument();
    const reserveTile = view.container.querySelectorAll('[data-app-card-kind="record"]')[1];
    expect(reserveTile).toHaveTextContent('Backup Reserve—');
    expect(screen.getByText('Time-Based Control')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Update rate plan' })).toBeInTheDocument();
    view.unmount(); view.client.clear();
  });

  it('keeps loading, fatal error retry, empty recovery and refresh-pending controls independent of painted records', () => {
    h.response = undefined; h.loading = true;
    const view = mount(tree());
    expect(view.container.querySelector('[data-app-part~="skeleton"]')).not.toBeNull();
    expect(view.container.querySelector('[data-app-card-kind]')).toBeNull();
    h.loading = false; h.error = new Error('No configuration');
    view.rerenderSection(tree());
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(h.retry).toHaveBeenCalledOnce();
    h.error = null; h.pending = true;
    view.rerenderSection(tree());
    expect(screen.getByText(/No site configuration loaded yet/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh site info' })).toBeDisabled();
    expect(view.container.querySelector('[data-app-card-kind]')).toBeNull();
    view.unmount(); view.client.clear();
  });
});
