import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps, ReactNode } from 'react';
import type { DataStateSource } from '@/api/dataState';
import type { DLQEntryFull, DLQEntrySummary } from '@/types/admin-diagnostics';
import type { EntryDrawer } from '../components/dlq-inspector/EntryDrawer';
import type { ConfirmDialog } from '@/components/ui';

const mocks = vi.hoisted(() => ({
  entry: vi.fn(), drawer: vi.fn(), confirm: vi.fn(), replay: vi.fn(), listRetry: vi.fn(), auditRetry: vi.fn(),
}));
const summary: DLQEntrySummary = {
  id: '0123456789abcdef0123456789abcdef',
  arrived_at: '2026-10-01T10:00:00Z',
  dlq_topic: 'dlq/synthetic',
  parsed_redeliveries: 0,
  replayable: true,
  raw_payload_size: 2,
  inner_payload_size: 2,
};
const full: DLQEntryFull = { ...summary, raw_payload_b64: 'e30=', inner_payload_b64: 'e30=' };
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: vi.fn() }));
vi.mock('@/api/hooks/useDLQ', () => ({
  useDLQList: () => ({
    data: { count: 1, replay_enabled: true, entries: [summary] }, refetch: mocks.listRetry,
  }),
  useDLQAudit: () => ({ data: { rows: [] }, refetch: mocks.auditRetry }),
  useDLQEntry: (id: string | undefined, enabled: boolean) => mocks.entry(id, enabled),
  useDLQReplay: () => ({ mutateAsync: mocks.replay, isPending: false }),
}));
vi.mock('@/components/layout', () => ({
  PageLayout: ({ children }: { children?: ReactNode }) => <main>{children}</main>,
  LayoutCard: ({ title, children }: { title: string; children?: ReactNode }) => <section aria-label={title}>{children}</section>,
}));
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('@/components/feedback', () => ({
  AlertBanner: ({ children }: { children?: ReactNode }) => <div role="status">{children}</div>,
  SectionErrorBoundary: ({ children }: { children?: ReactNode }) => <>{children}</>,
  QueryError: () => <div role="alert">Unexpected neighboring fatal error</div>,
}));
vi.mock('@/components/ui', () => ({
  Icon: () => null,
  ConfirmDialog: (props: ComponentProps<typeof ConfirmDialog>) => {
    mocks.confirm(props);
    return null;
  },
}));
vi.mock('../components/statstrip-ingest-dlq-redis/DLQOperationalBrief', () => ({
  DLQOperationalBrief: () => <section aria-label="DLQ summary" />,
}));
vi.mock('../components/dlq-inspector', () => ({
  AuditPanel: () => <div>audit rows</div>,
  ReasonBreakdown: () => <div>reason breakdown</div>,
  EntriesTable: ({ onInspect }: { onInspect: (row: DLQEntrySummary) => void }) => (
    <div role="button" tabIndex={0} onClick={() => onInspect(summary)} onKeyDown={() => onInspect(summary)}>
      Inspect synthetic entry
    </div>
  ),
  EntryDrawer: (props: ComponentProps<typeof EntryDrawer>) => {
    mocks.drawer(props);
    return <div data-testid="drawer-wiring" />;
  },
}));
import DLQInspectorPage from './DLQInspectorPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.entry.mockReturnValue({ data: undefined, fetchStatus: 'idle' });
});
function selectedDrawer(source: DataStateSource<DLQEntryFull>) {
  mocks.entry.mockReturnValue(source);
  render(<DLQInspectorPage />);
  fireEvent.click(screen.getByRole('button', { name: 'Inspect synthetic entry' }));
  return mocks.drawer.mock.lastCall![0] as ComponentProps<typeof EntryDrawer>;
}

describe('DLQInspectorPage derived detail trust wiring', () => {
  it('passes the untouched opaque selected ID and enables only the selected detail query', () => {
    selectedDrawer({ data: full });
    expect(mocks.entry).toHaveBeenNthCalledWith(1, undefined, false);
    expect(mocks.entry).toHaveBeenLastCalledWith(summary.id, true);
    expect(mocks.replay).not.toHaveBeenCalled();
  });
  it('forwards initial loading even when raw isLoading is false for an unresolved idle query', () => {
    const drawer = selectedDrawer({ data: undefined, isLoading: false, fetchStatus: 'idle' });
    expect(drawer.loading).toBe(true);
    expect(drawer.state?.status).toBe('initial');
    expect(drawer.full).toBeUndefined();
  });
  it('forwards fatalError and the detail retry rather than a neighboring query retry', () => {
    const error = new Error('detail unavailable');
    const retry = vi.fn();
    const drawer = selectedDrawer({ error, isError: true, refetch: retry });
    expect(drawer.state?.fatalError).toBe(error);
    expect(drawer.state?.refreshError).toBeNull();
    drawer.state?.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(mocks.listRetry).not.toHaveBeenCalled();
    expect(mocks.auditRetry).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('retains successful payload and timestamp on a raw detail refresh error instead of exposing fatalError', () => {
    const error = new Error('refresh failed');
    const drawer = selectedDrawer({ data: full, error, isError: true, dataUpdatedAt: 1234 });
    expect(drawer.full).toBe(full);
    expect(drawer.state?.status).toBe('stale');
    expect(drawer.state?.fatalError).toBeNull();
    expect(drawer.state?.refreshError).toBe(error);
    expect(drawer.state?.updatedAt).toBe(1234);
    expect(drawer.loading).toBe(false);
  });
  it.each([
    { name: 'initial paused', data: undefined, status: 'initial', loading: true },
    { name: 'retained paused', data: full, status: 'stale', loading: false },
  ])('forwards $name as blocked rather than a server error', ({ data, status, loading }) => {
    const drawer = selectedDrawer({ data, fetchStatus: 'paused', isLoading: false });
    expect(drawer.state?.isRefreshBlocked).toBe(true);
    expect(drawer.state?.status).toBe(status);
    expect(drawer.state?.fatalError).toBeNull();
    expect(drawer.state?.refreshError).toBeNull();
    expect(drawer.loading).toBe(loading);
  });
  it('keeps all four source sections during a detail failure and never triggers replay implicitly', () => {
    selectedDrawer({ error: new Error('detail failed'), isError: true });
    for (const name of ['DLQ summary', 'Dead-letter entries', 'Failure reasons', 'Recent replay activity']) {
      expect(screen.getByRole('region', { name })).toBeInTheDocument();
    }
    expect(mocks.replay).not.toHaveBeenCalled();
  });
  it('rechecks detail trust before confirmed replay when a previously ready entry becomes paused', async () => {
    mocks.entry.mockReturnValue({ data: full, fetchStatus: 'idle' });
    const { rerender } = render(<DLQInspectorPage />);
    fireEvent.click(screen.getByRole('button', { name: 'Inspect synthetic entry' }));
    const drawer = mocks.drawer.mock.lastCall![0] as ComponentProps<typeof EntryDrawer>;
    act(() => drawer.onReplay());
    expect(mocks.confirm.mock.lastCall![0].open).toBe(true);
    mocks.entry.mockReturnValue({ data: full, fetchStatus: 'paused' });
    rerender(<DLQInspectorPage />);
    const confirm = mocks.confirm.mock.lastCall![0] as ComponentProps<typeof ConfirmDialog>;
    expect(confirm.confirmDisabled).toBe(true);
    await act(async () => { await confirm.onConfirm(); });
    expect(mocks.replay).not.toHaveBeenCalled();
    expect(mocks.confirm.mock.lastCall![0].open).toBe(false);
  });
});
