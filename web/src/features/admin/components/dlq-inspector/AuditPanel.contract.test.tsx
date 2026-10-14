import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BADGE_VARIANTS } from '@/components/ui';
import { downloadCSV, downloadJSON } from '@/lib/csvExport';
import type { DLQReplayAuditRecord, DLQReplayResult } from '@/types/admin-diagnostics';
import { AuditPanel } from './AuditPanel';

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value, format }: { value: string; format?: string }) => (
    <span data-testid="audit-time" data-format={format}>{value}</span>
  ),
}));

vi.mock('@/lib/csvExport', async () => ({
  ...await vi.importActual<typeof import('@/lib/csvExport')>('@/lib/csvExport'),
  downloadCSV: vi.fn(),
  downloadJSON: vi.fn(),
}));

const fields = ['Replayed at', 'Actor', 'DLQ ID', 'Result', 'Destination', 'Error', 'Trace ID'];
const keys = ['replayed_at', 'actor', 'dlq_id', 'result', 'dst_topic', 'error', 'trace_id'];
const observers: { element: Element; callback: ResizeObserverCallback }[] = [];

function makeRow(overrides: Partial<DLQReplayAuditRecord> = {}): DLQReplayAuditRecord {
  return {
    id: 1,
    replayed_at: '2026-10-01T12:00:00Z',
    actor: 'fixture-operator',
    actor_ip: '',
    dlq_id: 'fixture-dlq-one',
    src_topic: 'fixture/source',
    dst_topic: 'fixture/destination',
    payload: '',
    reason: 'fixture-reason',
    result: 'publish_failed',
    error: 'fixture-publish-error',
    trace_id: 'fixture-trace-one',
    ...overrides,
  };
}

function resize(width: number) {
  act(() => observers.forEach(({ element, callback }) => callback(
    [{ target: element, contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  )));
}

function mountMobile(rows: DLQReplayAuditRecord[], extra: {
  loading?: boolean;
  scopedDlqId?: DLQReplayAuditRecord['dlq_id'];
} = {}) {
  const view = render(<AuditPanel rows={rows} loading={false} {...extra} />);
  resize(375);
  expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
  expect(screen.queryByRole('table')).toBeNull();
  return view;
}

function detailValue(dialog: HTMLElement, label: string) {
  const term = within(dialog).getByText(label, { selector: 'dt' });
  const value = term.nextElementSibling;
  expect(value?.tagName).toBe('DD');
  return value;
}

beforeEach(() => {
  localStorage.clear();
  observers.length = 0;
  vi.clearAllMocks();
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(element: Element) { observers.push({ element, callback: this.callback }); }
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('AuditPanel mobile field preservation', () => {
  it('opens all seven original fields even when saved column visibility hides evidence', () => {
    localStorage.setItem('teslasync.table.admin:dlq-audit.columns', JSON.stringify({
      order: keys,
      hidden: ['dlq_id', 'dst_topic', 'error', 'trace_id'],
    }));
    const rows = [makeRow(), makeRow({ id: 2, dlq_id: 'fixture-dlq-two', trace_id: 'fixture-trace-two' })];
    const before = structuredClone(rows);
    mountMobile(rows);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[1]);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('term').map(term => term.textContent)).toEqual(fields);
    expect(detailValue(dialog, 'Replayed at')).toHaveTextContent('2026-10-01T12:00:00Z');
    expect(within(dialog).getByTestId('audit-time')).toHaveAttribute('data-format', 'absolute');
    expect(detailValue(dialog, 'Actor')).toHaveTextContent('fixture-operator');
    expect(detailValue(dialog, 'DLQ ID')?.textContent).toBe('fixture-dlq-two');
    expect(detailValue(dialog, 'Result')).toHaveTextContent('publish_failed');
    expect(within(dialog).getByText('publish_failed')).toHaveClass('bg-[var(--semantic-danger-bg)]');
    expect(detailValue(dialog, 'Destination')).toHaveTextContent('fixture/destination');
    expect(detailValue(dialog, 'Error')).toHaveTextContent('fixture-publish-error');
    expect(detailValue(dialog, 'Trace ID')).toHaveTextContent('fixture-trace-two');
    expect(within(dialog).queryByText('fixture-trace-one')).toBeNull();
    expect(rows).toEqual(before);
    expect(screen.queryByRole('button', { name: /replay|select$/i })).toBeNull();
  });

  it.each([
    { case: 'Enter', key: '{Enter}' },
    { case: 'Space', key: ' ' },
  ])('supports $case detail activation, Escape dismissal and focus restoration', async ({ key }) => {
    mountMobile([makeRow()]);
    const user = userEvent.setup();
    const card = screen.getByRole('button', { name: 'fixture-operator' });
    card.focus();
    await user.keyboard(key);
    const dialog = screen.getByRole('dialog');
    expect(detailValue(dialog, 'DLQ ID')?.textContent).toBe('fixture-dlq-one');
    expect(detailValue(dialog, 'Trace ID')).toHaveTextContent('fixture-trace-one');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(card).toHaveFocus();
  });

  it('preserves zero row identity and an unknown outcome without inventing success', () => {
    mountMobile([makeRow({
      id: 0, dlq_id: '0', result: 'fixture-unknown' as DLQReplayResult,
      actor: '', dst_topic: '', error: '', trace_id: '',
    })]);
    expect(screen.getByRole('button', { name: '—' })).toHaveTextContent('0');
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    expect(detailValue(dialog, 'DLQ ID')?.textContent).toBe('0');
    expect(detailValue(dialog, 'Result')?.textContent).toBe('fixture-unknown');
    expect(within(dialog).getByText('fixture-unknown')).toHaveClass(BADGE_VARIANTS.neutral);
    for (const label of ['Actor', 'Destination', 'Error', 'Trace ID']) {
      expect(detailValue(dialog, label)?.textContent).toBe('—');
    }
  });

  it('retains all seven labels with explicit unknowns for null wire fields', () => {
    // Wire-shape nullability is assigned to the integration owner, not this display-only fix.
    const row = makeRow(Object.fromEntries(keys.map(key => [key, null])) as unknown as Partial<DLQReplayAuditRecord>);
    mountMobile([row]);
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getAllByRole('term').map(term => term.textContent)).toEqual(fields);
    for (const label of fields) expect(detailValue(dialog, label)?.textContent).toBe('—');
    expect(within(dialog).queryByTestId('audit-time')).toBeNull();
  });

  it('keeps every contained column available between the mobile and md boundaries', () => {
    const view = mountMobile([makeRow()]);
    resize(740);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    const table = screen.getByRole('table', { name: 'dlq-audit' });
    expect(within(table).getAllByRole('columnheader').map(header => header.textContent)).toEqual(fields);
    for (const header of within(table).getAllByRole('columnheader')) expect(header).not.toHaveClass('hidden');
    for (const cell of within(table).getAllByRole('cell')) expect(cell).not.toHaveClass('hidden');
    expect(within(table).getByText('fixture-trace-one')).toBeInTheDocument();
  });

  it('retains loaded search and closes details when their row leaves the filtered view', async () => {
    mountMobile([makeRow(), makeRow({ id: 2, actor: 'fixture-other', trace_id: 'fixture-trace-two' })]);
    fireEvent.click(screen.getAllByRole('button', { name: 'Quick view' })[0]);
    fireEvent.click(within(screen.getByRole('dialog')).getByText('Close', { selector: 'button' }));
    const search = screen.getByRole('searchbox', { name: 'Search loaded rows' });
    fireEvent.change(search, { target: { value: 'fixture-trace-two' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(detailValue(screen.getByRole('dialog'), 'Trace ID')).toHaveTextContent('fixture-trace-two');
    fireEvent.change(search, { target: { value: 'fixture-no-match' } });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByRole('button', { name: 'Quick view' })).toBeNull();
    fireEvent.change(search, { target: { value: '' } });
    await waitFor(() => expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(2));
  });

  it('preserves loaded exports, reveal paging and the original scoped table preference key', async () => {
    localStorage.setItem('teslasync.table.admin:dlq-audit-scoped.page-size', '25');
    const rows = Array.from({ length: 26 }, (_, index) => makeRow({
      id: index + 1, dlq_id: `fixture-dlq-${index}`, actor: `fixture-operator-${index}`,
    }));
    const view = mountMobile(rows, { scopedDlqId: 'fixture-dlq-scope' });
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(25);
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    expect(screen.queryByRole('menuitemradio', { name: /Selected/ })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(1));
    const jsonRows = vi.mocked(downloadJSON).mock.calls[0][1];
    expect(jsonRows).toEqual(rows.map(row => ({
      replayed_at: row.replayed_at, actor: row.actor, dlq_id: row.dlq_id, result: row.result,
      dst_topic: row.dst_topic, error: row.error, trace_id: row.trace_id,
    })));
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as CSV' }));
    await waitFor(() => expect(downloadCSV).toHaveBeenCalledTimes(1));
    const csv = vi.mocked(downloadCSV).mock.calls[0][1];
    expect(csv.split('\r\n')[0]).toBe(fields.join(','));
    expect(csv).toContain('fixture-operator-25');
    expect(csv).toContain('fixture-trace-one');
    fireEvent.click(screen.getByRole('button', { name: 'Load 1 more' }));
    expect(screen.getAllByRole('button', { name: 'Quick view' })).toHaveLength(26);
    resize(1024);
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    expect(within(screen.getByRole('table')).getAllByRole('row')).toHaveLength(26);
    expect(localStorage.getItem('teslasync.table.admin:dlq-audit-scoped.page-size')).toBe('25');
    expect(localStorage.getItem('teslasync.table.admin:dlq-audit.page-size')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Export list' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Download as JSON' }));
    await waitFor(() => expect(downloadJSON).toHaveBeenCalledTimes(2));
    expect(vi.mocked(downloadJSON).mock.calls[1]).toEqual(vi.mocked(downloadJSON).mock.calls[0]);
  });

  it('keeps retained rows inspectable during loading and preserves source-empty branches', () => {
    const view = mountMobile([makeRow()], { loading: true });
    fireEvent.click(screen.getByRole('button', { name: 'Quick view' }));
    expect(detailValue(screen.getByRole('dialog'), 'Error')).toHaveTextContent('fixture-publish-error');
    view.rerender(<AuditPanel rows={[]} loading />);
    resize(375);
    expect(screen.queryByRole('button', { name: 'Quick view' })).toBeNull();
    expect(view.container.querySelector('[data-mobile-table]')).not.toBeNull();
    view.rerender(<AuditPanel rows={null} loading={false} />);
    expect(screen.getByText('No replay attempts yet')).toBeInTheDocument();
    expect(screen.getByText(/Replay attempts will appear here/)).toBeInTheDocument();
    expect(view.container.querySelector('[data-mobile-table]')).toBeNull();
    view.rerender(<AuditPanel rows={undefined} loading={false} scopedDlqId="fixture-dlq-one" />);
    expect(screen.getByText(/This entry has not been replayed/)).toBeInTheDocument();
    expect(screen.queryByText(/Replay attempts will appear here/)).toBeNull();
  });
});
