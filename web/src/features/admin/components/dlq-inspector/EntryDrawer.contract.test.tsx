import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps, ReactNode } from 'react';
import { deriveDataState, type DataStateSource } from '@/api/dataState';
import type { DLQEntryFull, DLQEntrySummary } from '@/types/admin-diagnostics';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: unknown, vars?: Record<string, unknown>) => {
      const text = typeof fallback === 'string' ? fallback : key;
      return text.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(vars?.[name] ?? ''));
    },
    i18n: { language: 'en' },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy({}, {
    get: () => ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
      const safe = Object.fromEntries(Object.entries(rest).filter(([key]) =>
        !['animate', 'initial', 'exit', 'transition', 'variants', 'layout',
          'whileHover', 'whileTap', 'whileInView'].includes(key)));
      return <div {...safe}>{children}</div>;
    },
  }),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
}));
vi.mock('@/api/client', async () => ({
  ...await vi.importActual<typeof import('@/api/client')>('@/api/client'),
  request: vi.fn().mockResolvedValue({}),
}));
import { EntryDrawer } from './EntryDrawer';

const summary: DLQEntrySummary = {
  id: '0123456789abcdef0123456789abcdef',
  arrived_at: '2026-10-01T10:00:00Z',
  dlq_topic: 'dlq/synthetic',
  parsed_reason: 'synthetic',
  parsed_source_topic: 'telemetry/synthetic',
  parsed_redeliveries: 0,
  replayable: true,
  raw_payload_size: 999,
  inner_payload_size: 888,
};
const full: DLQEntryFull = {
  ...summary,
  raw_payload_b64: btoa('{"raw":true}'),
  inner_payload_b64: btoa('{"inner":true}'),
};
const copy = vi.fn().mockResolvedValue(undefined);
const retry = vi.fn();
const onReplay = vi.fn();
const onClose = vi.fn();
type Props = ComponentProps<typeof EntryDrawer>;

function props(source: DataStateSource<DLQEntryFull> = { data: full }): Props {
  const state = deriveDataState({ refetch: retry, ...source });
  return {
    open: true, summary, full: state.data, state,
    loading: state.status === 'initial',
    replayEnabled: true, replayInFlight: false, onReplay, onClose,
  };
}
function mount(input: Props) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<MemoryRouter><QueryClientProvider client={client}>
    <EntryDrawer {...input} />
  </QueryClientProvider></MemoryRouter>);
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: copy } });
});

describe('EntryDrawer detail trust contract', () => {
  it('keeps opaque identity and metadata while initial details load without copy or replay', () => {
    mount(props({ isPending: true, isFetching: true, fetchStatus: 'fetching' }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(`DLQ entry #${summary.id}`);
    expect(screen.getByText(summary.parsed_source_topic!)).toBeInTheDocument();
    expect(screen.getByTestId('dlq-entry-loading')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
  it('uses the derived fatal detail error and detail-only retry without discarding metadata', () => {
    mount(props({ isError: true, error: new Error('detail failed') }));
    expect(screen.getByText(summary.parsed_source_topic!)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
  it('announces initial-paused details honestly instead of binary bytes or a server failure', () => {
    mount(props({ isPending: true, fetchStatus: 'paused' }));
    expect(screen.getByText('The payload request is paused. No entry details have loaded yet.')).toBeInTheDocument();
    expect(screen.queryByTestId('dlq-entry-loading')).toBeNull();
    expect(screen.queryByText(/non-UTF-8/)).toBeNull();
    expect(screen.queryByText('Server error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
  it.each([
    { name: 'refresh failure', error: new Error('refresh failed'), isError: true, fetchStatus: 'idle' as const },
    { name: 'paused refresh', error: undefined, isError: false, fetchStatus: 'paused' as const },
  ])('retains exact payload and successful timestamp with recovery after $name', source => {
    mount(props({ data: full, dataUpdatedAt: Date.parse('2026-10-01T10:00:00Z'), ...source }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('{"inner":true}');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(retry).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Server error')).toBeNull();
  });
  it('retains copy and tab focus during refresh while replay is interlocked', async () => {
    mount(props({ data: full, isFetching: true }));
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Updating…');
    const raw = screen.getByRole('tab', { name: 'Raw envelope' });
    screen.getByRole('tab', { name: 'Inner payload' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'Inner payload' }), { key: 'ArrowRight' });
    await waitFor(() => expect(raw).toHaveFocus());
    expect(screen.getByRole('tabpanel')).toHaveTextContent('{"raw":true}');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('{"raw":true}'));
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
  it('never trusts another entry payload under the selected summary identity', () => {
    mount(props({ data: { ...full, id: 'ffffffffffffffffffffffffffffffff' } }));
    expect(screen.getByRole('dialog')).toHaveAccessibleName(`DLQ entry #${summary.id}`);
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
  it('keeps selected summary-only details pending rather than fabricating binary or empty bytes', () => {
    mount({ ...props(), full: undefined, state: undefined, loading: false });
    expect(screen.getByTestId('dlq-entry-loading')).toBeInTheDocument();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
});

describe('EntryDrawer payload outcomes and preserved actions', () => {
  it('distinguishes omitted inner bytes from a valid empty raw envelope', async () => {
    mount(props({ data: { ...full, inner_payload_b64: undefined, raw_payload_b64: '' } }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('This payload was not included in the entry details.');
    expect(screen.queryByRole('button', { name: 'Copy' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
    fireEvent.click(screen.getByRole('tab', { name: 'Raw envelope' }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Empty UTF-8 payload (0 bytes).');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(''));
  });
  it('recognizes valid zero-byte inner UTF-8 without labeling it binary and copies the empty value', async () => {
    mount(props({ data: { ...full, inner_payload_b64: '', inner_payload_size: 0 } }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Empty UTF-8 payload (0 bytes).');
    expect(screen.getByRole('button', { name: 'Replay' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(''));
  });
  it.each([
    { name: 'invalid UTF-8 inner payload', bytes: [255, 254, 0, 1], tab: 'Inner payload', marker: 'binary' },
    { name: 'truncated UTF-8 inner payload', bytes: [226, 130], tab: 'Inner payload', marker: 'binary' },
    { name: 'invalid UTF-8 raw envelope', bytes: [255, 254, 0, 1], tab: 'Raw envelope', marker: 'envelope' },
    { name: 'truncated UTF-8 raw envelope', bytes: [226, 130], tab: 'Raw envelope', marker: 'envelope' },
  ])('preserves $name as actual binary bytes and exact base64, not summary sizes', async ({ bytes, tab, marker }) => {
    const encoded = btoa(String.fromCharCode(...bytes));
    mount(props({ data: { ...full, inner_payload_b64: encoded, raw_payload_b64: encoded } }));
    fireEvent.click(screen.getByRole('tab', { name: tab }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(`non-UTF-8 ${marker}, ${bytes.length} bytes`);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(encoded));
  });
  it('distinguishes malformed base64 from binary and retains the original value for diagnostic copy', async () => {
    mount(props({ data: { ...full, inner_payload_b64: '%%%invalid%%%' } }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent('This payload is not valid base64.');
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('%%%invalid%%%'));
  });
  it('preserves a UTF-8 byte-order mark rather than treating three real bytes as empty', async () => {
    mount(props({ data: { ...full, inner_payload_b64: btoa(String.fromCharCode(239, 187, 191)) } }));
    expect(screen.queryByText('Empty UTF-8 payload (0 bytes).')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith('\uFEFF'));
  });
  it('renders and copies valid multibyte UTF-8 exactly without interpreting markup', async () => {
    const text = '<script>😀</script>';
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    mount(props({ data: { ...full, inner_payload_b64: encoded } }));
    expect(screen.getByRole('tabpanel')).toHaveTextContent(text);
    expect(screen.getByRole('tabpanel').querySelector('script')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(copy).toHaveBeenCalledWith(text));
  });
  it('links both tab targets bidirectionally and keeps stable IDs through tab switches and refreshes', () => {
    const input = props();
    const { rerender } = mount(input);
    const tabs = screen.getAllByRole('tab');
    const ids = tabs.map(tab => tab.id);
    for (const tab of tabs) {
      const target = document.getElementById(tab.getAttribute('aria-controls')!);
      expect(target).toHaveAttribute('aria-labelledby', tab.id);
    }
    fireEvent.click(tabs[1]);
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', tabs[1].getAttribute('aria-controls'));
    // Refresh state never replaces the real Tabs or its focus owner.
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    rerender(<MemoryRouter><QueryClientProvider client={client}>
      <EntryDrawer {...props({ data: full, isFetching: true })} />
    </QueryClientProvider></MemoryRouter>);
    expect(screen.getAllByRole('tab').map(tab => tab.id)).toEqual(ids);
  });
  it('preserves replay, both Close actions and Escape without invoking replay on dismissal', () => {
    mount(props());
    fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
    expect(onReplay).toHaveBeenCalledTimes(1);
    const dialog = screen.getByRole('dialog');
    for (const close of within(dialog).getAllByRole('button', { name: 'Close' })) fireEvent.click(close);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onReplay).toHaveBeenCalledTimes(1);
  });
  it.each([
    { name: 'server capability disabled', overrides: { replayEnabled: false } },
    { name: 'full entry not replayable', overrides: { full: { ...full, replayable: false } } },
    { name: 'replay already in flight', overrides: { replayInFlight: true } },
  ])('preserves the replay interlock for $name', ({ overrides }) => {
    mount({ ...props(), ...overrides });
    const replay = screen.getByRole('button', { name: 'Replay' });
    expect(replay).toBeDisabled();
    fireEvent.click(replay);
    expect(onReplay).not.toHaveBeenCalled();
    if ('replayInFlight' in overrides) expect(replay).toHaveAttribute('aria-busy', 'true');
  });
  it('preserves the fallback empty state when nothing has been selected', () => {
    mount({ ...props(), summary: null, full: undefined, state: undefined, loading: false });
    expect(screen.getByRole('dialog')).toHaveAccessibleName('DLQ entry');
    expect(screen.getByText('No DLQ entry selected.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replay' })).toBeDisabled();
  });
  it('keeps the closed drawer absent without triggering actions', () => {
    mount({ ...props(), open: false });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onReplay).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});
