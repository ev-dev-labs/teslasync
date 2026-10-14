import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { FeatureFlagChange, FeatureFlagEntry } from '@/types/admin-diagnostics';
import { downloadCSV, downloadJSON, escapeCell } from '@/lib/csvExport';
import { request } from '@/api/client';
import { FlagsTable, previewValue } from './FlagsTable';
import { ChangesPanel } from './ChangesPanel';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, options?: Record<string, unknown>) => {
        const vars = typeof fallback === 'object' && fallback !== null
          ? fallback as Record<string, unknown> : options;
        const template = typeof fallback === 'string' ? fallback
          : typeof vars?.defaultValue === 'string' ? vars.defaultValue : key;
        return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) =>
          vars && name in vars ? String(vars[name]) : match);
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return {
    ...actual,
    request: vi.fn(async (_path: string, options?: { method?: string }) => {
      if (options?.method && options.method !== 'GET') throw new Error('Read-only fixture');
      return {};
    }),
  };
});

vi.mock('@/lib/csvExport', async () => {
  const actual = await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport');
  return { ...actual, downloadCSV: vi.fn(), downloadJSON: vi.fn() };
});

const oldValue = `before,"quoted"\n${'x'.repeat(250)} END-OLD`;
const newValue = `after,"quoted"\n${'y'.repeat(250)} END-NEW`;
const change: FeatureFlagChange = {
  id: 901,
  changed_at: '2026-10-13T12:30:00Z',
  actor: 'synthetic-operator',
  actor_ip: '192.0.2.1',
  flag_key: 'synthetic.audit.flag',
  operation: 'delete',
  old_value: oldValue,
  new_value: newValue,
  reason: 'Synthetic audit-only reason',
  trace_id: 'synthetic-trace',
};
const flags: FeatureFlagEntry[] = [{ key: 'synthetic.registry.flag', value: oldValue }];
const clients: QueryClient[] = [];

function mount(content: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  clients.push(client);
  const wrap = (children: ReactNode) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const result = render(wrap(content));
  return { ...result, update: (children: ReactNode) => result.rerender(wrap(children)) };
}

function registry(rows = flags, loading = false, onEdit = vi.fn(), onAskDelete = vi.fn()) {
  return <FlagsTable rows={rows} loading={loading} onEdit={onEdit} onAskDelete={onAskDelete} />;
}

async function exportAs(format: 'CSV' | 'JSON') {
  fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
  fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(format) }));
  await waitFor(() => expect(format === 'CSV' ? downloadCSV : downloadJSON).toHaveBeenCalledTimes(1));
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  expect(vi.mocked(request).mock.calls.every(([, options]) =>
    options?.method === undefined || options.method === 'GET')).toBe(true);
});

describe('phase6 feature flag full values and mobile disclosure (source/class proof, not native)', () => {
  it('keeps all seven audit fields reachable through a controlled read-only disclosure', () => {
    const { container } = mount(<ChangesPanel rows={[change]} loading={false} />);
    const table = screen.getByRole('table', { name: 'flag-changes' });
    const row = within(table).getAllByRole('row')[1];
    for (const key of ['flag_key', 'old_value', 'new_value', 'reason']) {
      expect(row.querySelector(`[data-column-key="${key}"]`)).toHaveClass('hidden', 'md:table-cell');
    }
    const trigger = within(row).getByRole('button', { name: 'Expand row' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveClass('h-11', 'w-11');
    expect(trigger.closest('td')).not.toHaveClass('hidden');
    trigger.focus();
    expect(trigger).toHaveFocus();
    fireEvent.keyDown(row, { key: 'Enter' });
    expect(trigger).toHaveAttribute('aria-expanded', 'true');

    const detail = container.querySelector('[data-expanded-content="true"]') as HTMLElement;
    expect(detail).not.toHaveClass('hidden');
    expect(detail.querySelectorAll('dt')).toHaveLength(7);
    expect(Array.from(detail.querySelectorAll('dt'), node => node.textContent))
      .toEqual(['Changed at', 'Actor', 'Key', 'Op', 'Old', 'New', 'Reason']);
    expect(within(detail).getByText(change.actor)).toBeInTheDocument();
    expect(within(detail).getByText(change.flag_key)).toBeInTheDocument();
    expect(within(detail).getByText(change.operation)).toBeInTheDocument();
    expect(within(detail).getByText(change.reason)).toBeInTheDocument();
    expect(detail.querySelector('dd')?.textContent)
      .toBe(row.querySelector('[data-column-key="changed_at"]')?.textContent);
    expect(within(detail).getByText(JSON.stringify(oldValue))).toBeInTheDocument();
    expect(within(detail).getByText(JSON.stringify(newValue))).toBeInTheDocument();
    expect(detail.querySelectorAll('input, textarea, select, button')).toHaveLength(0);
    expect(within(detail).getByText(JSON.stringify(oldValue))).toHaveClass('whitespace-pre-wrap', 'break-all');

    fireEvent.keyDown(row, { key: 'Enter' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(container.querySelector('[data-expanded-content="true"]')).toBeNull();
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('exports complete opaque registry strings with CSV escaping, not JSON quoting or preview ellipses', async () => {
    mount(registry());
    expect(screen.getByText(previewValue(oldValue))).toBeInTheDocument();
    await exportAs('CSV');
    const csv = vi.mocked(downloadCSV).mock.calls[0][1];
    expect(csv).toContain(escapeCell(oldValue));
    expect(csv).toContain('END-OLD');
    expect(csv).not.toContain('…');
  });

  it('exports both full historical values and retains raw JSON export independently', async () => {
    mount(<ChangesPanel rows={[change]} loading={false} />);
    await exportAs('CSV');
    const csv = vi.mocked(downloadCSV).mock.calls[0][1];
    expect(csv).toContain(escapeCell(oldValue));
    expect(csv).toContain(escapeCell(newValue));
    expect(csv).toContain(change.actor);
    expect(csv).toContain(change.flag_key);
    expect(csv).toContain(change.reason);
    expect(csv).not.toContain('…');
    await exportAs('JSON');
    const exported = vi.mocked(downloadJSON).mock.calls[0][1] as Record<string, unknown>[];
    expect(exported[0].old_value).toBe(oldValue);
    expect(exported[0].new_value).toBe(newValue);
  });

  it('keeps structured values structured in JSON and complete in CSV', async () => {
    const nested = { payload: 'z'.repeat(250), tail: 'STRUCTURED-END' };
    mount(<ChangesPanel rows={[{ ...change, old_value: nested, new_value: [false, 0] }]} loading={false} />);
    await exportAs('CSV');
    expect(vi.mocked(downloadCSV).mock.calls[0][1]).toContain(escapeCell(nested));
    await exportAs('JSON');
    const exported = vi.mocked(downloadJSON).mock.calls[0][1] as Record<string, unknown>[];
    expect(exported[0].old_value).toEqual(nested);
    expect(exported[0].new_value).toEqual([false, 0]);
  });

  it('preserves false, zero, unknown values and structured historical tails without parsing opaque strings', () => {
    const nested = { note: 'z'.repeat(250), tail: 'STRUCTURED-END' };
    const { container, update } = mount(
      <ChangesPanel rows={[{ ...change, old_value: false, new_value: 0 }]} loading={false} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Expand row' }));
    let detail = container.querySelector('[data-expanded-content="true"]') as HTMLElement;
    expect(within(detail).getByText('false')).toBeInTheDocument();
    expect(within(detail).getByText('0')).toBeInTheDocument();
    update(<ChangesPanel rows={[{ ...change, old_value: null, new_value: nested }]} loading={false} />);
    detail = container.querySelector('[data-expanded-content="true"]') as HTMLElement;
    expect(within(detail).getByText('—')).toBeInTheDocument();
    expect(within(detail).getByText(JSON.stringify(nested))).toBeInTheDocument();
    update(<ChangesPanel rows={[{ ...change, old_value: '{"opaque":true}', new_value: undefined }]} loading={false} />);
    detail = container.querySelector('[data-expanded-content="true"]') as HTMLElement;
    expect(within(detail).getByText(JSON.stringify('{"opaque":true}'))).toBeInTheDocument();
    expect(within(detail).getByText('—')).toBeInTheDocument();
  });

  it('retains exact registry action records and sort order', () => {
    const onEdit = vi.fn();
    const onDelete = vi.fn();
    const rows = [...flags, { key: 'alpha', value: '0' }];
    mount(registry(rows, false, onEdit, onDelete));
    const table = screen.getByRole('table', { name: 'feature-flags' });
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent('alpha');
    fireEvent.click(screen.getByRole('button', { name: `Edit flag ${flags[0].key}` }));
    fireEvent.click(screen.getByRole('button', { name: `Delete flag ${flags[0].key}` }));
    expect(onEdit).toHaveBeenCalledWith(flags[0]);
    expect(onDelete).toHaveBeenCalledWith(flags[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Flag key' }));
    expect(within(table).getAllByRole('row')[1]).toHaveTextContent(flags[0].key);
  });
});

describe('phase6 independent source loading and retained trust (local contract fixture)', () => {
  it.each(['fetching', 'paused', 'idle'] as const)(
    'keeps cold %s sources contextual and busy, never authoritatively empty',
    (fetchStatus) => {
      const source: DataStateSource<FeatureFlagEntry[]> = {
        data: undefined,
        isPending: true,
        isLoading: fetchStatus === 'fetching',
        fetchStatus,
      };
      const state = deriveDataState(source);
      expect(state.status).toBe('initial');
      const { update } = mount(registry([], state.status === 'initial'));
      expect(screen.getByRole('region', { name: 'Loading flags…' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
      expect(screen.queryByRole('table')).toBeNull();
      expect(screen.queryByText('No feature flags are set on this server.')).toBeNull();
      update(<ChangesPanel rows={[]} loading={state.status === 'initial'} />);
      expect(screen.getByRole('region', { name: 'Loading audit log…' })).toHaveAttribute('aria-busy', 'true');
      expect(screen.getByTestId('table-skeleton')).toBeInTheDocument();
      expect(screen.queryByText('No flag changes yet')).toBeNull();
    },
  );

  it('keeps populated registry and audit tables during loading and refresh failures', () => {
    const { update } = mount(registry(flags, true));
    expect(screen.getByRole('table', { name: 'feature-flags' }).closest('[aria-busy]'))
      .toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('button', { name: `Edit flag ${flags[0].key}` })).toBeInTheDocument();
    expect(screen.queryByTestId('table-skeleton')).toBeNull();
    const retained = deriveDataState({ data: [change], error: new Error('Synthetic refresh failure') });
    expect(retained.status).toBe('stale');
    expect(retained.fatalError).toBeNull();
    update(<ChangesPanel rows={retained.data ?? []} loading={true} />);
    expect(screen.getByRole('table', { name: 'flag-changes' }).closest('[aria-busy]'))
      .toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText(change.actor)).toBeInTheDocument();
    expect(screen.queryByTestId('table-skeleton')).toBeNull();
    update(<ChangesPanel rows={[change]} loading={false} />);
    expect(screen.getByRole('table', { name: 'flag-changes' }).closest('[aria-busy]')).toBeNull();
  });

  it('preserves settled scoped/global empty copy and independent registry actions', () => {
    const { update } = mount(<ChangesPanel rows={[]} loading={false} scopedKey="synthetic.scope" />);
    expect(screen.getByText(/No audit rows for "synthetic.scope"/)).toBeInTheDocument();
    update(<ChangesPanel rows={[]} loading={false} />);
    expect(screen.getByText(/Flag changes will appear here once an operator edits a value/)).toBeInTheDocument();
    update(<>{registry()}<ChangesPanel rows={[]} loading={true} /></>);
    expect(screen.getByRole('table', { name: 'feature-flags' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Loading audit log…' })).toBeInTheDocument();
  });
});
