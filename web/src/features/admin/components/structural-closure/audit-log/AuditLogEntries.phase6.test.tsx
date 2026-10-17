import { useEffect, useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { AuditLogRow } from '@/types/admin-operator-confidence';
import { useAuditLogPage } from '../../../hooks/useAuditLogPage';
import { AuditLogEntries } from './AuditLogEntries';
import { downloadCSV, downloadJSON, toCSV } from '@/lib/csvExport';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { ApiError } from '@/lib/resilience';

const H = vi.hoisted(() => ({
  rows: [] as AuditLogRow[],
  request: vi.fn<(path: string, init?: RequestInit) => Promise<unknown>>(),
  locale: 'en-US',
  tz: 'UTC',
}));

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: H.request };
});
vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return { ...actual, downloadCSV: vi.fn(), downloadJSON: vi.fn() };
});
vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ settings: { tz_display_default: 'user' }, locale: H.locale }),
}));
vi.mock('@/lib/timezone', async () => {
  const actual = await vi.importActual<typeof import('@/lib/timezone')>('@/lib/timezone');
  return { ...actual, useTimezone: () => H.tz };
});

const ROW: AuditLogRow = {
  id: 17,
  ts: '2026-10-05T18:00:00Z',
  actor: 'operator@example.test',
  category: 'vehicle',
  action: 'door_lock',
  entity_type: 'vehicle',
  entity_id: 0,
  detail: 'Complete detail\nwith multiple lines and a long identity',
  ip: '192.0.2.9',
  user_agent: '完整客户端身份 — long client identity',
  before: '{ "locked": false, "nested": { "value": 0 } }',
  after: 'unparseable raw after payload\nwith all evidence preserved',
  trace_id: 'complete-trace-0123456789',
  prev_row_hash: 'complete-previous-hash',
  row_hash: 'complete-current-hash',
  success: false,
};

function Harness({ initialOffset = 0 }: { initialOffset?: number }) {
  const controller = useAuditLogPage();
  const { setOffset } = controller;
  const appliedOffset = useRef<number | null>(null);
  useEffect(() => {
    if (appliedOffset.current === initialOffset) return;
    appliedOffset.current = initialOffset;
    setOffset(initialOffset);
  }, [initialOffset, setOffset]);
  return <AuditLogEntries controller={controller} />;
}

function mount(initialOffset = 0) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter><Harness initialOffset={initialOffset} /></MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, client };
}

async function exportAs(format: 'CSV' | 'JSON') {
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
  fireEvent.click(screen.getByRole('menuitem', { name: `Download as ${format}` }));
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  H.rows = [ROW];
  H.locale = 'en-US';
  H.tz = 'UTC';
  H.request.mockImplementation(async (path) => {
    if (path === '/admin/audit-log/categories') return { categories: ['vehicle'] };
    if (path === '/admin/audit-log/actions') return { actions: ['door_lock'] };
    if (path.startsWith('/admin/audit-log?')) return { rows: H.rows, limit: 100 };
    throw new Error(`Unexpected request: ${path}`);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuditLogEntries phase6 independent contracts', () => {
  it.each([0, 100, 200])('uses 0–0 for authoritative empty rows at offset %i', async (offset) => {
    H.rows = [];
    mount(offset);
    await screen.findByText('No audit entries');
    expect(screen.getByText('Showing 0–0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Previous' })).toHaveProperty('disabled', offset === 0);
  });

  it('retains zero-based caller offsets and loaded row ordinals without compensating for backend overlap', async () => {
    mount(100);
    await screen.findByText('Showing 101–101');
    expect(H.request.mock.calls.some(([path]) => path.includes('offset=100'))).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Previous' }));
    await screen.findByText('Showing 1–1');
  });

  it('exports all raw loaded evidence in JSON regardless of visible-column preferences', async () => {
    localStorage.setItem('teslasync.table.admin:audit-log.visible', JSON.stringify(['action']));
    mount();
    await screen.findByText(ROW.action);
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledWith(expect.stringMatching(/^audit-log-/), [ROW]));
    const exported = vi.mocked(downloadJSON).mock.calls[0]?.[1] as AuditLogRow[];
    expect(Object.keys(exported[0] ?? {})).toHaveLength(16);
    expect(exported[0]?.before).toBe(ROW.before);
    expect(exported[0]?.after).toBe(ROW.after);
    expect(exported[0]?.entity_id).toBe(0);
    expect(exported[0]?.success).toBe(false);
    expect(H.request.mock.calls.every(([path]) => !path.includes('export'))).toBe(true);
  });

  it('exports CSV through the existing safe utility with all fields and full raw before/after', async () => {
    mount();
    await screen.findByText(ROW.actor);
    await exportAs('CSV');
    const keys = [
      'id', 'ts', 'actor', 'category', 'action', 'entity_type', 'entity_id', 'detail',
      'ip', 'user_agent', 'before', 'after', 'trace_id', 'success', 'prev_row_hash', 'row_hash',
    ];
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledWith(
      expect.stringMatching(/^audit-log-/),
      toCSV([ROW], keys.map(key => ({ key }))),
    ));
    expect(vi.mocked(downloadCSV).mock.calls[0]?.[1]).toContain('before,after,trace_id');
  });

  it('consumes raw evidence strings through the normal client and success envelope without exporting alias fields', async () => {
    const { request } = await vi.importActual<typeof import('@/api/client')>('@/api/client');
    const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(
      JSON.stringify({ data: { rows: [ROW], limit: 100 } }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    ));
    const fixtures = H.request.getMockImplementation()!;
    H.request.mockImplementation((path, init) =>
      path.startsWith('/admin/audit-log?') ? request(path, init) : fixtures(path, init));
    mount();
    await screen.findByText(ROW.actor);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/v1\/admin\/audit-log\?/),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    expect(screen.getByRole('group', { name: 'Before' })).toHaveTextContent('"locked": false');
    expect(screen.getByRole('group', { name: 'After' })).toHaveTextContent('with all evidence preserved');
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledWith(expect.any(String), [ROW]));
    await exportAs('CSV');
    const csv = vi.mocked(downloadCSV).mock.calls[0]?.[1];
    expect(csv).toContain('before,after,trace_id,success,prev_row_hash,row_hash');
    expect(csv).toContain('unparseable raw after payload\nwith all evidence preserved');
    expect(csv).toContain('""locked"": false');
  });

  it('exports only matching loaded rows, never an implied full ledger', async () => {
    H.rows = [ROW, { ...ROW, id: 18, actor: 'another@example.test', action: 'unlock' }];
    mount();
    await screen.findByText('another@example.test');
    fireEvent.change(screen.getByRole('searchbox', { name: /search/i }), { target: { value: ROW.actor } });
    await waitFor(() => expect(screen.queryByText('another@example.test')).not.toBeInTheDocument());
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledWith(expect.any(String), [ROW]));
    expect(H.request.mock.calls.filter(([path]) => path.startsWith('/admin/audit-log?'))).toHaveLength(1);
  });

  it('retains null, empty raw evidence, false and zero distinctly in JSON exports', async () => {
    const sparse: AuditLogRow = {
      id: 0, ts: ROW.ts, actor: '', action: 'unknown', entity_type: '', entity_id: 0,
      before: '', after: null, success: null,
    };
    H.rows = [sparse];
    mount();
    await screen.findByText(sparse.action);
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalled());
    const exported = vi.mocked(downloadJSON).mock.calls[0]?.[1] as AuditLogRow[];
    expect(exported[0]).toMatchObject({
      id: 0, entity_id: 0, before: '', after: null, success: null, trace_id: null, row_hash: null,
    });
  });

  it('uses one shared disclosure with localized guidance and complete narrow-screen evidence', async () => {
    const { container } = mount();
    await screen.findByText(ROW.actor);
    expect(screen.getByText('Use “Expand row” to view complete entry details.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Details' })).not.toBeInTheDocument();
    const expand = screen.getByRole('button', { name: /Expand row/ });
    expect(expand).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(expand);
    expect(screen.getByRole('button', { name: /Collapse row/ })).toHaveAttribute('aria-expanded', 'true');
    const detail = container.querySelector('dl')!;
    expect(detail.closest('.hidden')).toBeNull();
    for (const value of [ROW.actor, '#0', ROW.ip, ROW.user_agent, ROW.trace_id, ROW.row_hash, ROW.prev_row_hash]) {
      expect(within(detail as HTMLElement).getByText(value ?? '', { exact: true })).toBeInTheDocument();
    }
    // Category and entity type share the value 'vehicle'; both fields render it.
    expect(within(detail as HTMLElement).getAllByText('vehicle', { exact: true })).toHaveLength(2);
    expect(within(detail as HTMLElement).getByText(/Complete detail/)).toHaveTextContent('with multiple lines');
    expect(screen.getByRole('group', { name: 'Before' })).toHaveTextContent('"locked": false');
    expect(screen.getByRole('group', { name: 'After' })).toHaveTextContent('with all evidence preserved');
    fireEvent.click(screen.getByRole('button', { name: /Collapse row/ }));
    expect(screen.queryByRole('group', { name: 'Before' })).not.toBeInTheDocument();
  });

  it('retains full trace/hash and before/after clipboard actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const { container } = mount();
    await screen.findByText(ROW.actor);
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    const trace = within(container.querySelector('dl') as HTMLElement).getByText(ROW.trace_id ?? '');
    fireEvent.click(within(trace.parentElement as HTMLElement).getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ROW.trace_id));
    for (const hash of [ROW.row_hash, ROW.prev_row_hash]) {
      const value = within(container.querySelector('dl') as HTMLElement).getByText(hash ?? '');
      fireEvent.click(within(value.parentElement as HTMLElement).getByRole('button'));
      await waitFor(() => expect(writeText).toHaveBeenCalledWith(hash));
    }
    fireEvent.click(within(screen.getByRole('group', { name: 'Before' })).getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(JSON.stringify(JSON.parse(ROW.before ?? ''), null, 2)));
    fireEvent.click(within(screen.getByRole('group', { name: 'After' })).getByRole('button'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(ROW.after));
  });

  it('binds timestamp columns to saved locale/timezone and updates without mutating raw instants', async () => {
    H.locale = 'de-DE';
    H.tz = 'Pacific/Auckland';
    const view = mount();
    const options = { locale: H.locale, tz: H.tz };
    await screen.findByText(formatDateTime(ROW.ts, options));
    expect(screen.getByText(formatRelative(ROW.ts, options))).toBeInTheDocument();
    H.locale = 'fr-FR';
    H.tz = 'America/New_York';
    view.rerender(
      <QueryClientProvider client={view.client}>
        <MemoryRouter><Harness /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(screen.getByText(formatDateTime(ROW.ts, { locale: H.locale, tz: H.tz }))).toBeInTheDocument();
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledWith(expect.any(String), [ROW]));
  });

  it.each(['de-DE', 'fr-FR'])('localizes recent relative timestamps with saved %s preferences', async (locale) => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-10-05T18:05:00Z'));
    H.locale = locale;
    H.tz = 'Pacific/Auckland';
    const expected = new Intl.RelativeTimeFormat(locale, { style: 'narrow', numeric: 'always' })
      .format(-5, 'minute');
    mount();
    await screen.findByText(expected);
    expect(screen.queryByText(new Intl.RelativeTimeFormat('en-US', { style: 'narrow', numeric: 'always' })
      .format(-5, 'minute'))).not.toBeInTheDocument();
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledWith(expect.any(String), [ROW]));
  });

  it('keeps populated rows, expansion and export after a retained refresh failure', async () => {
    const { client } = mount();
    await screen.findByText(ROW.actor);
    fireEvent.click(screen.getByRole('button', { name: /Expand row/ }));
    const success = H.request.getMockImplementation()!;
    H.request.mockImplementation(async (path, init) => {
      if (path.startsWith('/admin/audit-log?')) throw new ApiError('Refresh unavailable', 500);
      return success(path, init);
    });
    await client.invalidateQueries();
    await waitFor(() => expect(client.getQueryCache().getAll().some(query => query.state.error)).toBe(true));
    expect(screen.getByRole('group', { name: 'After' })).toHaveTextContent('with all evidence preserved');
    await exportAs('JSON');
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledWith(expect.any(String), [ROW]));
  });
});
