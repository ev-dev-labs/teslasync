import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { APICallLog } from '@/api/types';
import { ApiLogsEvidenceTable, type ApiLogsServerFilters } from './ApiLogsEvidenceTable';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss from 'postcss';
import { getAppDesignAttributes, observeAppDesignScopes } from '@/components/ui/app-designs/designs';
import type { PackId } from '@/features/dashboard/widgets/designPacks/types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | Record<string, unknown>, options?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : String(fallback?.defaultValue ?? key);
      const variables = options ?? (typeof fallback === 'object' ? fallback : {});
      return text.replace(/{{(\w+)}}/g, (_, name: string) => String(variables[name] ?? `{{${name}}}`));
    },
    i18n: { language: 'en' },
  }),
}));

const emptyFilters: ApiLogsServerFilters = {
  method: '', status: '', endpoint: '', service: '', client: '', key: '',
};
const log: APICallLog = {
  id: 1, ts: '2026-01-02T03:04:05Z', vehicle_id: 1, service: 'tesla-api',
  http_method: 'GET', endpoint: '/vehicles', status_code: 200, duration_ms: 12,
  rate_limited: false, error_message: null, request_body: null, response_body: '{"ok":true}',
  request_headers: { 'App-Key-ID': '42', 'App-Key-Name': 'tablet' }, response_headers: null,
};
const onFilterChange = vi.fn();
const onFiltersClear = vi.fn();

function renderTable(filters = emptyFilters, logs = [log], pack?: PackId) {
  const props = {
    logs,
    filters,
    onFilterChange,
    onFiltersClear,
    serviceConfig: (service: string) => ({ label: service, variant: 'info' as const }),
    installationFor: () => null,
    toolbarHeading: 'Evidence',
    toolbarActions: null,
    methodOptions: [{ value: '', label: 'All methods' }, { value: 'POST', label: 'POST' }],
    statusOptions: [{ value: '', label: 'All status' }, { value: '5xx', label: '5xx server error' }],
    serviceOptions: [{ value: '', label: 'All services' }, { value: 'notify-generic', label: 'Notifications' }],
  };
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const table = <ApiLogsEvidenceTable {...props} />;
  return render(
    <QueryClientProvider client={client}>
      {pack ? <div data-app-design-preview="" {...getAppDesignAttributes(pack)}>{table}</div> : table}
    </QueryClientProvider>,
  );
}

function openFilter(label: string) {
  if (!screen.queryByRole('button', { name: `${label} filter` })) {
    const menu = screen.getByRole('button', { name: 'Reorder or hide columns' });
    fireEvent.click(menu);
    fireEvent.click(screen.getByRole('checkbox', { name: `Show or hide ${label}` }));
    fireEvent.click(menu);
  }
  const trigger = screen.getByRole('button', { name: `${label} filter` });
  fireEvent.click(trigger);
  return { trigger, dialog: screen.getByRole('dialog', { name: `${label} filter` }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.removeItem('teslasync.table.admin:api-logs.columns');
  localStorage.removeItem('teslasync.table.admin:api-logs.visible');
});

describe('ApiLogsEvidenceTable server column filters', () => {
  it.each(['classic', 'v3', 'v2', 'v1'] as const)('%s paints the actual opened record surface while preserving evidence order', pack => {
    const raw = 'z first\n  a second\n0 is a measured duration';
    const view = renderTable(emptyFilters, [{ ...log, duration_ms: 0, response_body: raw }], pack);
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    const release = observeAppDesignScopes(view.container.firstElementChild!);
    try {
      const surface = view.container.querySelector('[data-expanded-content="true"] > td > [data-app-part="panel"]')!;
      const selectors: string[] = [];
      postcss.parse(readFileSync(resolve(process.cwd(), 'src', 'components', 'ui', 'app-designs', 'packs', `${pack}.css`), 'utf8')).walkRules(rule => {
        for (const selector of rule.selectors) {
          if (selector.includes('[data-surface-variant="standalone"]') &&
            [...document.querySelectorAll(selector)].includes(surface)) selectors.push(selector);
        }
      });
      expect(selectors.length).toBeGreaterThan(0);
      for (const selector of selectors) expect(selector).toContain(`[data-app-design-owner~="pack-${pack}"]`);
      expect([...surface.querySelectorAll('pre code')].at(-1)?.textContent).toBe(raw);
      expect(surface).toHaveTextContent('Duration: 0ms');
      expect(surface).toHaveTextContent('App key: tablet (#42)');
      expect(surface).toHaveTextContent('Missing fields on older records cannot be recovered.');
      fireEvent.click(screen.getByRole('button', { name: /Collapse row/ }));
      expect(view.container.querySelector('[data-expanded-content="true"]')).toBeNull();
    } finally { release(); }
  });

  it.each([
    ['Method', 'method', 'POST'],
    ['Status', 'status', '5xx'],
    ['Endpoint', 'endpoint', '/unloaded'],
    ['Service', 'service', 'notify-generic'],
    ['App installation', 'client', 'android'],
    ['App key', 'key', 'Living room'],
  ] as const)('uses the shared %s popover to dispatch a server predicate, never a loaded-row checklist', (label, key, value) => {
    renderTable();
    const { trigger, dialog } = openFilter(label);
    expect(trigger.closest('th')).not.toBeNull();
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
    expect(onFilterChange).toHaveBeenCalledWith(key, value);
    expect(within(dialog).queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog', { name: `${label} filter` })).not.toBeInTheDocument();
  });

  it('reflects URL-owned active predicates without silently filtering mismatching server rows', () => {
    renderTable({ ...emptyFilters, method: 'POST', endpoint: '/unloaded', key: 'unloaded-key' });
    expect(screen.getByText('/vehicles')).toBeInTheDocument();
    const { trigger, dialog } = openFilter('Method');
    expect(trigger).toHaveAttribute('aria-pressed', 'true');
    expect(within(dialog).getByLabelText('Method')).toHaveValue('POST');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Clear' }));
    expect(onFilterChange).toHaveBeenCalledWith('method', '');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onFiltersClear).toHaveBeenCalledOnce();
  });

  it('keeps reset and filter headers reachable on empty data and makes filterable columns mobile-visible', () => {
    renderTable({ ...emptyFilters, client: 'android' }, []);
    const table = screen.getByRole('table', { name: 'API call log' });
    for (const label of ['Method', 'Status', 'Endpoint', 'Service', 'App installation']) {
      const { trigger, dialog } = openFilter(label);
      expect(trigger.closest('th')).not.toHaveClass('hidden');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    }
    const { trigger, dialog } = openFilter('App key');
    expect(trigger.closest('th')).not.toHaveClass('hidden');
    expect(table).toContainElement(trigger);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    expect(screen.getByRole('button', { name: 'Clear' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onFiltersClear).toHaveBeenCalledOnce();
  });

  it('owns the opened request enclosure without dropping raw diagnostics or metadata', () => {
    const raw = 'not-json\n  exact diagnostic order: z, a';
    const { container } = renderTable(emptyFilters, [{ ...log, status_code: 503,
      duration_ms: 0, error_message: 'first error\nsecond error', response_body: raw }]);
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    const surface = container.querySelector('[data-expanded-content="true"] > td > [data-app-part="panel"]')!;
    expect(surface).toHaveAttribute('data-surface-variant', 'standalone');
    expect(surface).toHaveClass('bg-[var(--surface-2)]', 'p-3', 'sm:p-4');
    expect(surface).toHaveTextContent('App key: tablet (#42)');
    expect(surface).toHaveTextContent('Duration: 0ms');
    expect(within(surface as HTMLElement).getByText('first error second error', { exact: false }).textContent)
      .toBe('first error\nsecond error');
    expect(surface.querySelector('pre code')?.textContent).toContain('"App-Key-ID": "42"');
    expect(within(surface as HTMLElement).getByText(/exact diagnostic order/).textContent).toBe(raw);
    expect(surface).toHaveTextContent('Missing fields on older records cannot be recovered.');
    fireEvent.click(screen.getByRole('button', { name: /Collapse row/ }));
    expect(container.querySelector('[data-expanded-content="true"]')).toBeNull();
  });
});
