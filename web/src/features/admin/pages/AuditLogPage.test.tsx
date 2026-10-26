import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AuditLogRow } from '@/types/admin-operator-confidence';
import { ApiError } from '@/lib/resilience';
import { SHARED_RANGE_STORAGE_KEY } from '@/hooks/useRangeState';
import { toDateTimeInput, toIsoOrUndefined } from '../components/structural-closure/audit-log/helpers';

const { mockedRequest, preferences } = vi.hoisted(() => ({
  mockedRequest: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  preferences: { timezone: '', headerRange: false },
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockedRequest };
});

vi.mock('@/hooks/useSettings', async () => {
  const actual = await vi.importActual<typeof import('@/hooks/useSettings')>('@/hooks/useSettings');
  return { ...actual, useSettings: () => {
    const current = actual.useSettings();
    return { ...current, settings: { ...current.settings, timezone_user: preferences.timezone, tz_display_default: 'user' } };
  } };
});

vi.mock('@/lib/workspaceScope', async () => {
  const actual = await vi.importActual<typeof import('@/lib/workspaceScope')>('@/lib/workspaceScope');
  return { ...actual, getWorkspaceRouteScope: (path: string) => ({
    ...actual.getWorkspaceRouteScope(path),
    ...(path === '/admin/audit-log' ? { range: preferences.headerRange } : {}),
  }) };
});

describe('AuditLogPage deployment capability evidence', () => {
  it.each([
    { name: 'uncoded service outage', status: 503, code: undefined },
    { name: 'coded service outage', status: 503, code: 'UPSTREAM_UNAVAILABLE' },
    { name: 'non-503 capability code', status: 500, code: 'SUBSYSTEM_NOT_CONFIGURED' },
  ])('keeps entry retry and independent sections for $name', async ({ status, code }) => {
    install();
    const success = mockedRequest.getMockImplementation()!;
    mockedRequest.mockImplementation(async (path, init) => {
      if (path.startsWith('/admin/audit-log?')) throw new ApiError('Ledger temporarily unavailable', status, code);
      return success(path, init);
    });
    const { container, client } = renderPage();
    await waitFor(() => expect(client.getQueryCache().getAll()
      .find(query => query.queryKey[2] === 'list')?.state.error).toBeInstanceOf(ApiError));
    expect(screen.queryByText('The audit log subsystem is not configured on this deployment.')).not.toBeInTheDocument();
    const entries = [...container.querySelectorAll('[data-card]')]
      .find(card => card.querySelector('[data-card-title]')?.textContent === 'Entries')!;
    expect(within(entries as HTMLElement).getByRole('button', { name: /retry/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Actor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify chain' })).toBeInTheDocument();
    const strip = screen.getByTestId('admin-audit-summary');
    // The failed entries source omits its four page counts from the face
    // (never zero-filled); the independent catalog counts stay visible.
    expect(strip.querySelectorAll('[data-operational-metric]')).toHaveLength(2);
    expect(strip.querySelector('[data-operational-metric="entries"]')).toBeNull();
    expect(strip.querySelector('[data-operational-metric="ok"]')).toBeNull();
    expect(strip.querySelector('[data-operational-metric="failed"]')).toBeNull();
    expect(strip.querySelector('[data-operational-metric="actors"]')).toBeNull();
    fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Audit overview details' }))
      .toHaveTextContent('4 empty fields are hidden.');
    install();
    fireEvent.click(within(entries as HTMLElement).getByRole('button', { name: /retry/i }));
    await screen.findByText(ROW.actor);
  });

  it('shows the unsupported notice only for explicit missing-subsystem evidence', async () => {
    install();
    const success = mockedRequest.getMockImplementation()!;
    mockedRequest.mockImplementation(async (path, init) => {
      if (path.startsWith('/admin/audit-log?')) {
        throw new ApiError('Audit viewer not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED');
      }
      return success(path, init);
    });
    const { container } = renderPage();
    await screen.findByText('The audit log subsystem is not configured on this deployment.');
    expect([...container.querySelectorAll('[data-card-title]')].map(title => title.textContent))
      .toEqual(['Filters', 'Hash chain integrity', 'Entries']);
    expect(screen.getByRole('textbox', { name: 'Actor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Verify chain' })).toBeInTheDocument();
  });

  it('retains exact entries on a missing-subsystem refresh error without declaring unsupported', async () => {
    install();
    const { client } = renderPage();
    await screen.findByText(ROW.actor);
    const success = mockedRequest.getMockImplementation()!;
    mockedRequest.mockImplementation(async (path, init) => {
      if (path.startsWith('/admin/audit-log?')) {
        throw new ApiError('Audit viewer not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED');
      }
      return success(path, init);
    });
    await act(async () => { await client.invalidateQueries(); });
    await waitFor(() => expect(client.getQueryCache().getAll()
      .find(query => query.queryKey[2] === 'list')?.state.error).toBeInstanceOf(ApiError));
    expect(screen.queryByText('The audit log subsystem is not configured on this deployment.')).not.toBeInTheDocument();
    expect(screen.getByText(ROW.actor)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Expand row:/ }));
    expect(await screen.findByRole('group', { name: 'Before' })).toHaveTextContent('"locked": false');
    expect(screen.getByRole('group', { name: 'After' })).toHaveTextContent('"locked": true');
    expect(screen.getByText(ROW.trace_id ?? '')).toBeInTheDocument();
  });
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

function renderPage(initialEntries = ['/'], client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })) {
  const rendered = render(<QueryClientProvider client={client}><MemoryRouter initialEntries={initialEntries}><AuditLogPage /></MemoryRouter></QueryClientProvider>);
  return { ...rendered, client };
}

beforeEach(() => {
  mockedRequest.mockReset();
  preferences.timezone = '';
  preferences.headerRange = false;
  localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
  localStorage.removeItem(SHARED_RANGE_STORAGE_KEY);
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

  describe('AuditLogPage bounded verification and unresolved sources', () => {
    function receipt(data: { intact: boolean; rows_checked: number; first_bad_id: number }, updatedAt = Date.now() - 60_000) {
      install();
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
      client.setQueryData(['admin', 'audit-log', 'verify', null, 1000],
        { ...data, since: '2026-09-01T12:34:00Z', limit: 1000 }, { updatedAt });
      return renderPage(['/admin/audit-log'], client);
    }

    it.each([0, -1, NaN, Infinity])('never calls an intact result with %s checked rows verification evidence', async (rows_checked) => {
      receipt({ intact: true, rows_checked, first_bad_id: 0 });
      await screen.findByText(ROW.actor);
      expect(screen.getByText('No verification evidence')).toBeInTheDocument();
      expect(screen.queryByText('Chain intact')).not.toBeInTheDocument();
      expect(screen.getByText(/Bounded row-hash proof only/)).toHaveTextContent('not adjacency proof');
      expect(mockedRequest.mock.calls.some(([path]) => path.startsWith('/admin/audit-log/verify'))).toBe(false);
    });

    it('retains the bounded receipt lower bound, cap, age and exact broken-row evidence', async () => {
      receipt({ intact: false, rows_checked: 10, first_bad_id: 17 });
      await screen.findByText(ROW.actor);
      expect(screen.getByText('Chain broken')).toBeInTheDocument();
      expect(screen.getByText('First bad row: #17')).toBeInTheDocument();
      expect(screen.getByText('10 rows checked')).toBeInTheDocument();
      expect(screen.getByText('Receipt since: 2026-09-01T12:34:00Z')).toBeInTheDocument();
      expect(screen.getByText('Receipt limit: 1000')).toBeInTheDocument();
      expect(screen.getByText(/Receipt: .*seconds old/)).toBeInTheDocument();
    });

    it('keeps an initial paused list unknown and records explicit paused verification rather than idle', async () => {
      install();
      onlineManager.setOnline(false);
      renderPage();
      expect(screen.queryByText('No audit entries')).not.toBeInTheDocument();
      expect(screen.getByText('Entries have not been received; no empty ledger has been established.')).toBeInTheDocument();
      expect(screen.getByText(/Read-only GET re-derives at most/)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
      expect(await screen.findByText('Verification was requested but is paused. No verification receipt has been received.')).toBeInTheDocument();
      expect(screen.queryByText(/Read-only GET re-derives at most/)).not.toBeInTheDocument();
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(screen.getByRole('textbox', { name: 'Actor' })).toBeInTheDocument();
    });

    it('shows a real empty list only after a successful response', async () => {
      install();
      const success = mockedRequest.getMockImplementation()!;
      mockedRequest.mockImplementation(async (path, init) => path.startsWith('/admin/audit-log?')
        ? { rows: [], limit: 100 } : success(path, init));
      renderPage();
      expect(await screen.findByText('No audit entries')).toBeInTheDocument();
      expect(screen.queryByText('Entries have not been received; no empty ledger has been established.')).not.toBeInTheDocument();
    });

    it('keeps explicitly requested verification pending until the read-only receipt arrives', async () => {
      install();
      const success = mockedRequest.getMockImplementation()!;
      let finishVerification!: (value: unknown) => void;
      const pendingReceipt = new Promise<unknown>((resolve) => { finishVerification = resolve; });
      mockedRequest.mockImplementation((path, init) => path.startsWith('/admin/audit-log/verify')
        ? pendingReceipt : success(path, init));
      renderPage();
      await screen.findByText(ROW.actor);
      expect(mockedRequest.mock.calls.some(([path]) => path.startsWith('/admin/audit-log/verify'))).toBe(false);
      fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
      expect(await screen.findByRole('button', { name: 'Verifying…' })).toBeDisabled();
      expect(screen.queryByText(/Read-only GET re-derives at most/)).not.toBeInTheDocument();
      expect(screen.queryByText('Chain intact')).not.toBeInTheDocument();
      expect(mockedRequest.mock.calls.some(([path, init]) =>
        path === '/admin/audit-log/verify?limit=1000' && (!init?.method || init.method === 'GET'))).toBe(true);
      await act(async () => {
        finishVerification({ intact: true, first_bad_id: 0, rows_checked: 4, since: '', limit: 1000 });
        await pendingReceipt;
      });
      expect(await screen.findByText('4 rows checked')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Verify chain' })).toBeEnabled();
    });
  });

  describe('AuditLogPage shared and minute-level range consumers', () => {
    it('uses the registered workspace range capability without adding vehicle scope', async () => {
      const { getWorkspaceRouteScope } = await vi.importActual<typeof import('@/lib/workspaceScope')>('@/lib/workspaceScope');
      expect(getWorkspaceRouteScope('/admin/audit-log')).toMatchObject({ range: true, vehicle: false });
      preferences.headerRange = true;
      install();
      renderPage(['/admin/audit-log?from=2026-10-01&to=2026-10-02']);
      await screen.findByText(ROW.actor);
      expect(screen.queryByLabelText('Since')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Until')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /vehicle/i })).not.toBeInTheDocument();
    });

    it('keeps fresh ledger access unbounded without manufacturing a seven-day default', async () => {
      install();
      renderPage(['/admin/audit-log']);
      await screen.findByText(ROW.actor);
      const listCalls = mockedRequest.mock.calls.filter(([path]) => path.startsWith('/admin/audit-log?'));
      expect(listCalls).not.toHaveLength(0);
      expect(listCalls.every(([path]) => !new URLSearchParams(path.split('?')[1]).has('since')
        && !new URLSearchParams(path.split('?')[1]).has('until'))).toBe(true);
    });

    it('consumes custom workspace URL dates in the saved zone with both full server bounds and no duplicate controls', async () => {
      install();
      preferences.timezone = 'America/Los_Angeles';
      preferences.headerRange = true;
      renderPage(['/admin/audit-log?from=2026-03-08&to=2026-03-08']);
      await waitFor(() => expect(mockedRequest.mock.calls.some(([path]) => {
        const params = new URLSearchParams(path.split('?')[1]);
        return path.startsWith('/admin/audit-log?') && params.get('since') === '2026-03-08T08:00:00.000Z'
          && params.get('until') === '2026-03-09T07:00:00.000Z';
      })).toBe(true));
      expect(screen.queryByLabelText('Since')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Until')).not.toBeInTheDocument();
      expect(screen.queryByRole('combobox', { name: /vehicle/i })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByText('Filters use your selected time zone.')).toBeInTheDocument();
      expect(screen.queryByText(/America\/Los_Angeles/)).not.toBeInTheDocument();
    });

    it('restores the existing saved shared range instead of inventing another preference', async () => {
      install();
      preferences.timezone = 'UTC';
      localStorage.setItem(SHARED_RANGE_STORAGE_KEY, JSON.stringify({
        version: 2, start: '2026-10-01', end: '2026-10-02',
      }));
      renderPage(['/admin/audit-log']);
      await waitFor(() => expect(mockedRequest.mock.calls.some(([path]) => {
        const params = new URLSearchParams(path.split('?')[1]);
        return params.get('since') === '2026-10-01T00:00:00.000Z' && params.get('until') === '2026-10-03T00:00:00.000Z';
      })).toBe(true));
      expect(JSON.parse(localStorage.getItem(SHARED_RANGE_STORAGE_KEY) ?? 'null')).toEqual({
        version: 2, start: '2026-10-01', end: '2026-10-02',
      });
    });

    it('restores exact minute-level URL instants and retains the selected row limit on reset', async () => {
      install();
      preferences.timezone = 'America/Los_Angeles';
      renderPage(['/admin/audit-log?since=2026-10-04T15%3A30%3A00Z&until=2026-10-05T15%3A45%3A00Z']);
      await screen.findByText(ROW.actor);
      expect(screen.getByLabelText('Since')).toHaveValue('2026-10-04T08:30');
      expect(screen.getByLabelText('Until')).toHaveValue('2026-10-05T08:45');
      fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), { target: { value: '250' } });
      fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
      expect(screen.getByRole('combobox', { name: 'Rows per page' })).toHaveValue('250');
      expect(screen.getByLabelText('Since')).toHaveValue('');
      expect(screen.getByLabelText('Until')).toHaveValue('');
    });

    it('keeps minute-level editing available until the actual header capability exists', async () => {
      install();
      preferences.timezone = 'UTC';
      renderPage(['/admin/audit-log?from=2026-10-01&to=2026-10-02']);
      await screen.findByText(ROW.actor);
      expect(screen.getByLabelText('Since')).toHaveValue('2026-10-01T00:00');
      fireEvent.change(screen.getByLabelText('Since'), { target: { value: '2026-10-01T08:30' } });
      await waitFor(() => expect(mockedRequest.mock.calls.some(([path]) => {
        const params = new URLSearchParams(path.split('?')[1]);
        return params.get('since') === '2026-10-01T08:30:00.000Z'
          && params.get('until') === '2026-10-03T00:00:00.000Z';
      })).toBe(true));
    });

    it('interprets civil minutes in the supplied zone, including DST gaps and repeated minutes', () => {
      expect(toIsoOrUndefined('2026-10-04T08:30', 'America/Los_Angeles')).toBe('2026-10-04T15:30:00.000Z');
      expect(toIsoOrUndefined('2026-03-08T02:30', 'America/Los_Angeles')).toBeUndefined();
      expect(toIsoOrUndefined('2026-11-01T01:30', 'America/Los_Angeles')).toBe('2026-11-01T08:30:00.000Z');
      expect(toIsoOrUndefined('bad', 'UTC')).toBeUndefined();
      expect(toDateTimeInput('2026-10-04T15:30:00Z', 'America/Los_Angeles')).toBe('2026-10-04T08:30');
    });
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
    // Scope and per-metric captions moved from the face to the Review-details drawer.
    expect(strip).not.toHaveTextContent('Current filtered page and queried catalogs');
    expect(strip).not.toHaveTextContent('No full-ledger period is implied.');
    fireEvent.click(within(strip).getByRole('button', { name: 'Review details' }));
    const details = screen.getByRole('dialog', { name: 'Audit overview details' });
    expect(details).toHaveTextContent('Current filtered page and queried catalogs');
    expect(details).toHaveTextContent('No full-ledger period is implied.');
    expect(details).toHaveTextContent('Current filtered page only; not the full ledger');
    expect(details).toHaveTextContent('Queried category catalog; not limited to this page');
    expect(details).toHaveTextContent('Queried action catalog; not limited to this page');
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
    fireEvent.click(screen.getByRole('button', { name: /^Expand row:/ }));
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
    // The retained actor renders twice: the entries-table cell plus the
    // expanded detail list — both must survive the refresh errors.
    expect(screen.getAllByText('operator@example.test')).toHaveLength(2);
    expect(screen.getByRole('group', { name: 'Before' })).toBeInTheDocument();
    expect(screen.getByText(ROW.trace_id ?? '')).toBeInTheDocument();
  });

  it('sends actor/category/date changes through the existing bounded server query', async () => {
    // Wall inputs convert in the saved zone (October = EDT, UTC-4), never
    // the host zone, so the bounds are host-independent.
    preferences.timezone = 'America/New_York';
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
        && params.get('since') === '2026-10-04T12:00:00.000Z'
        && params.get('until') === '2026-10-05T12:00:00.000Z';
    })).toBe(true));
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Actor' })).toHaveValue(''));
    expect(mockedRequest.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
  });
});
