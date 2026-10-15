import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { APICallLog } from '@/api/types';
import { ApiLogsEvidenceTable, type ApiLogsServerFilters } from './ApiLogsEvidenceTable';

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

function renderTable(filters = emptyFilters, logs = [log]) {
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
  return render(
    <QueryClientProvider client={client}>
      <ApiLogsEvidenceTable {...props} />
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
});
