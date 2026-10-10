import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AuditLogRow } from '@/types/admin-operator-confidence';

const { mockedRequest } = vi.hoisted(() => ({
  mockedRequest: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockedRequest };
});

import AuditLogPage from './AuditLogPage';

const ROW: AuditLogRow = {
  id: 17, ts: '2026-10-05T18:00:00Z', actor: 'operator@example.test',
  category: 'vehicle', action: 'door_lock', entity_type: 'vehicle', entity_id: 42,
  detail: 'A complete retained audit detail', ip: '192.0.2.8', user_agent: 'Long operator client identity',
  trace_id: 'full-trace-identity-0123456789', row_hash: 'full-row-hash-0123456789',
  before: '{"locked":false}', after: '{"locked":true}', success: true,
};

function install({ failLog = false, failVerify = false } = {}) {
  mockedRequest.mockImplementation(async (path) => {
    if (path.startsWith('/admin/audit-log/verify')) {
      if (failVerify) throw new Error('verify unavailable');
      return { intact: true, first_bad_id: 0, rows_checked: 1000, since: '', limit: 1000 };
    }
    if (path === '/admin/audit-log/categories') return { categories: ['vehicle'] };
    if (path === '/admin/audit-log/actions') return { actions: ['door_lock'] };
    if (path.startsWith('/admin/audit-log?')) {
      if (failLog) throw new Error('log unavailable');
      return { rows: [ROW], limit: 100 };
    }
    throw new Error(`Unexpected read: ${path}`);
  });
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter><AuditLogPage /></MemoryRouter></QueryClientProvider>);
  return { ...rendered, client };
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('AuditLogPage presentation preservation', () => {
  it('renders the actual OperationalBrief for all six independently scoped audit counts', async () => {
    install();
    const { container } = renderPage();
    await screen.findByText('operator@example.test');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Review details' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Audit overview details' });
    expect(within(details).getByText('Entries shown')).toBeInTheDocument();
    expect(within(details).getByText('Categories')).toBeInTheDocument();
    expect(details).toHaveTextContent('Current filtered page only; not the full ledger');
    expect(details).toHaveTextContent('Queried category catalog; not limited to this page');
  });

  it('uses the canonical six-metric strip with honest page and independent catalog scope', async () => {
    install();
    const { container } = renderPage();
    await screen.findByText('operator@example.test');
    const strip = screen.getByTestId('admin-audit-summary');
    const metrics = [...strip.querySelectorAll('[data-operational-metric]')];
    expect(metrics).toHaveLength(6);
    expect(metrics.map(metric => metric.querySelector('[data-operational-value]')?.previousElementSibling?.textContent))
      .toEqual(['Entries shown', 'OK (in view)', 'Failed (in view)', 'Actors (in view)', 'Categories', 'Action types']);
    expect(metrics.map(metric => metric.querySelector('[data-operational-value]')?.textContent))
      .toEqual(['1', '1', '0', '1', '1', '1']);
    expect(strip).toHaveTextContent('Current filtered page and queried catalogs');
    expect(strip).toHaveTextContent('No full-ledger period is implied.');
    expect(metrics[0]).toHaveTextContent('Current filtered page only; not the full ledger');
    expect(metrics[4]).toHaveTextContent('Queried category catalog; not limited to this page');
    expect(metrics[5]).toHaveTextContent('Queried action catalog; not limited to this page');
    expect(container.querySelectorAll('[data-operational-brief]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-stat-strip]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Verify chain' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Actor' })).toBeInTheDocument();
  });

  it('keeps entries, expanded exact evidence and the integrity result after refresh errors', async () => {
    install();
    const { client } = renderPage();
    await screen.findByText('operator@example.test');
    expect(mockedRequest.mock.calls.some(([path]) => path.startsWith('/admin/audit-log/verify'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await screen.findByText('Chain intact');
    expect(mockedRequest.mock.calls.some(([path]) => path === '/admin/audit-log/verify?limit=1000')).toBe(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'Details' })[0]!);
    const before = await screen.findByRole('group', { name: 'Before' });
    const after = screen.getByRole('group', { name: 'After' });
    expect(within(before).getByText('{\n  "locked": false\n}', { exact: true, normalizer: (value) => value })).toBeInTheDocument();
    expect(within(after).getByText('{\n  "locked": true\n}', { exact: true, normalizer: (value) => value })).toBeInTheDocument();
    install({ failLog: true, failVerify: true });
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll().some((query) => query.state.error !== null)).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await waitFor(() => expect(mockedRequest.mock.calls.filter(([path]) => path.startsWith('/admin/audit-log/verify')).length).toBeGreaterThan(1));
    await waitFor(() => expect(client.getQueryState(['admin', 'audit-log', 'verify', null, 1000])?.error).toBeInstanceOf(Error));
    expect(screen.getByText('Chain intact')).toBeInTheDocument();
    expect(screen.getByText('operator@example.test')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Before' })).toBeInTheDocument();
    expect(screen.getByText(ROW.trace_id ?? '')).toBeInTheDocument();
  });

  it('sends actor/category/date changes through the existing bounded server query', async () => {
    install();
    renderPage();
    await screen.findByText('operator@example.test');
    fireEvent.change(screen.getByRole('textbox', { name: 'Actor' }), { target: { value: 'reviewer' } });
    await waitFor(() => expect(mockedRequest.mock.calls.some(([path]) => path.includes('actors=reviewer') && path.includes('offset=0'))).toBe(true));
    fireEvent.change(screen.getByRole('combobox', { name: 'Category' }), { target: { value: 'vehicle' } });
    fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-10-04T08:00' } });
    fireEvent.change(screen.getByLabelText('Until'), { target: { value: '2026-10-05T08:00' } });
    await waitFor(() => expect(mockedRequest.mock.calls.some(([path]) => {
      const params = new URLSearchParams(path.split('?')[1]);
      return params.get('actors') === 'reviewer' && params.get('categories') === 'vehicle'
        && params.get('since') === new Date('2026-10-04T08:00').toISOString()
        && params.get('until') === new Date('2026-10-05T08:00').toISOString();
    })).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Actor' })).toHaveValue(''));
    expect(mockedRequest.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
});
