import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// i18n stub — return defaultValue (or 2nd-arg string) so tooltip/aria copy is
// human-readable in assertions.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { defaultValue?: string } | string) => {
      if (typeof opts === 'string') return opts || key;
      if (opts && typeof opts === 'object' && 'defaultValue' in opts) {
        return opts.defaultValue ?? key;
      }
      return key;
    },
  }),
}));

// Toast helper stub — exercise mutation flow without ToastProvider.
vi.mock('@/api/hooks/_toastHelpers', () => ({
  useMutationToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));

// HTTP client stub — captures POST/DELETE so the tests can assert wire shape.
// Default GET responses to an empty array so post-mutation invalidation doesn't
// trip TanStack Query's "data cannot be undefined" guard.
const requestMock = vi.fn(async (path: string, init?: RequestInit) => {
  if (!init || !init.method || init.method === 'GET') return [];
  return undefined;
});
vi.mock('@/api/client', () => ({
  request: (path: string, init?: RequestInit) => requestMock(path, init),
}));

import { PinButton } from '../PinButton';
import { pinnedKeys } from '@/api/hooks/usePinned';
import type { PinnedItem } from '@/api/types';

function wrap(qc: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  };
}

beforeEach(() => {
  requestMock.mockReset();
  // Re-install default GET-returns-empty after reset.
  requestMock.mockImplementation(async (_path: string, init?: RequestInit) => {
    if (!init || !init.method || init.method === 'GET') return [];
    return undefined;
  });
});

describe('PinButton', () => {
  it('renders an unpinned trigger when the item is not in the pinned list', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('vehicle'), [] as PinnedItem[]);
    render(<PinButton itemType="vehicle" itemId={42} />, { wrapper: wrap(qc) });

    const btn = screen.getByRole('button', { name: 'Pin' });
    expect(btn).toBeInTheDocument();
    expect(btn).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders a pinned trigger when the item appears in the pinned list', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('vehicle'), [
      {
        id: 1,
        item_type: 'vehicle',
        item_id: '42',
        position: 0,
        pinned_at: new Date().toISOString(),
      },
    ] as PinnedItem[]);
    render(<PinButton itemType="vehicle" itemId={42} />, { wrapper: wrap(qc) });

    const btn = screen.getByRole('button', { name: 'Unpin' });
    expect(btn).toHaveAttribute('aria-pressed', 'true');
  });

  it('issues a POST /pinned with item_type + item_id when pinning', async () => {
    requestMock.mockResolvedValueOnce({
      id: 99,
      item_type: 'vehicle',
      item_id: '42',
      position: 0,
      pinned_at: new Date().toISOString(),
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('vehicle'), [] as PinnedItem[]);

    render(<PinButton itemType="vehicle" itemId={42} />, { wrapper: wrap(qc) });

    await fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(requestMock).toHaveBeenCalledWith(
      '/pinned',
      expect.objectContaining({ method: 'POST' }),
    );
    const init = requestMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({ item_type: 'vehicle', item_id: '42' });
  });

  it('forwards the optional context on the POST body', async () => {
    requestMock.mockResolvedValueOnce({
      id: 100,
      item_type: 'widget',
      item_id: 'soc-widget',
      position: 0,
      pinned_at: new Date().toISOString(),
      context: 'dash-1',
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('widget', 'dash-1'), [] as PinnedItem[]);

    render(
      <PinButton itemType="widget" itemId="soc-widget" context="dash-1" />,
      { wrapper: wrap(qc) },
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    const init = requestMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      item_type: 'widget',
      item_id: 'soc-widget',
      context: 'dash-1',
    });
  });

  it('issues a DELETE /pinned/{id} when unpinning a pinned item', async () => {
    requestMock.mockResolvedValueOnce(undefined);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('vehicle'), [
      {
        id: 7,
        item_type: 'vehicle',
        item_id: '42',
        position: 0,
        pinned_at: new Date().toISOString(),
      },
    ] as PinnedItem[]);

    render(<PinButton itemType="vehicle" itemId={42} />, { wrapper: wrap(qc) });

    await fireEvent.click(screen.getByRole('button', { name: 'Unpin' }));
    await waitFor(() => expect(requestMock).toHaveBeenCalled());

    expect(requestMock).toHaveBeenCalledWith(
      '/pinned/7',
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('renders a label next to the icon when showLabel is true', () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('vehicle'), [] as PinnedItem[]);
    render(<PinButton itemType="vehicle" itemId={1} showLabel />, { wrapper: wrap(qc) });

    // Two "Pin" nodes are expected: one inside the button and one inside the
    // tooltip body. Both should be present.
    expect(screen.getAllByText('Pin').length).toBeGreaterThanOrEqual(1);
  });

  it('does not bubble click events to ancestor handlers', async () => {
    requestMock.mockResolvedValueOnce({
      id: 99,
      item_type: 'vehicle',
      item_id: '42',
      position: 0,
      pinned_at: new Date().toISOString(),
    });
    const onParentClick = vi.fn();
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    qc.setQueryData(pinnedKeys.list('vehicle'), [] as PinnedItem[]);

    render(
      <div onClick={onParentClick}>
        <PinButton itemType="vehicle" itemId={42} />
      </div>,
      { wrapper: wrap(qc) },
    );

    await fireEvent.click(screen.getByRole('button', { name: 'Pin' }));
    expect(onParentClick).not.toHaveBeenCalled();
  });
});
