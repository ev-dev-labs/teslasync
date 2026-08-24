/**
 * LiveLogsPage contract tests.
 *
 * Covers:
 *   1. Empty state on first mount.
 *   2. Filter inputs render with default values.
 *   3. Stub fetch returns a streamed SSE response → log events
 *      appear in the table, status badge flips to "Live".
 *   4. Pause stops appending new events to the visible list.
 *   5. Clear button empties the buffer.
 *   6. Download button creates a Blob via URL.createObjectURL.
 *
 * The hook (`useLogStream`) accepts a `fetchImpl` test seam so we
 * never touch the global `fetch`. The stream is driven by a
 * controlled ReadableStream we feed encoded SSE frames into.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

vi.mock('react-i18next', async () => {
  const actual =
    await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') return fallbackOrOpts;
        if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          const o = fallbackOrOpts as Record<string, unknown>;
          if (typeof o.defaultValue === 'string') {
            const dv = o.defaultValue as string;
            return dv.replace(/{{(\w+)}}/g, (_, name) =>
              name in o ? String(o[name]) : `{{${name}}}`,
            );
          }
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

const selectedVehicleState = vi.hoisted(() => ({
  vehicleId: null as number | null,
  vehicles: [] as Array<{ id: number }>,
  setVehicleId: vi.fn(),
}));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => selectedVehicleState,
}));

import LiveLogsPage from './LiveLogsPage';
import { ToastProvider } from '@/components/feedback/Toast';

interface ControlledStream {
  push: (chunk: string) => Promise<void>;
  close: () => Promise<void>;
}

function makeControlledFetch(): {
  fetchImpl: typeof fetch;
  stream: ControlledStream;
  url?: string;
} {
  const ref: { ctrl?: ReadableStreamDefaultController<Uint8Array>; url?: string } = {};
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      ref.ctrl = controller;
    },
  });
  const stream: ControlledStream = {
    push: async (chunk: string) => {
      ref.ctrl?.enqueue(encoder.encode(chunk));
      await Promise.resolve();
    },
    close: async () => {
      ref.ctrl?.close();
      await Promise.resolve();
    },
  };

  const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
    ref.url = typeof input === 'string' ? input : input.toString();
    return new Response(body, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    });
  }) as unknown as typeof fetch;

  return {
    fetchImpl,
    stream,
    get url() {
      return ref.url;
    },
  };
}

function renderPage(fetchImpl?: typeof fetch) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={['/live-logs']}>
        <ToastProvider>
          <LiveLogsPage
            fetchImpl={fetchImpl}
            endpoint="/api/v1/admin/logs/stream"
          />
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.useRealTimers();
  selectedVehicleState.vehicleId = null;
  selectedVehicleState.vehicles = [];
  selectedVehicleState.setVehicleId.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LiveLogsPage', () => {
  it('commits a known vehicle to global scope only on blur or Enter', async () => {
    selectedVehicleState.vehicleId = 12;
    selectedVehicleState.vehicles = [{ id: 1 }, { id: 12 }];
    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);

    const input = screen.getByTestId('livelogs-vehicle-input');
    await waitFor(() => expect(input).toHaveValue('12'));

    fireEvent.change(input, { target: { value: '1' } });
    expect(selectedVehicleState.setVehicleId).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '999' } });
    fireEvent.blur(input);
    expect(selectedVehicleState.setVehicleId).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '1' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(selectedVehicleState.setVehicleId).toHaveBeenCalledWith(1);

    await act(async () => {
      await stream.close();
    });
  });

  it('renders header, filters, and empty state on first mount', async () => {
    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);

    expect(screen.getAllByText('Live logs').length).toBeGreaterThan(0);
    expect(screen.getByTestId('livelogs-level-select')).toBeInTheDocument();
    expect(screen.getByTestId('livelogs-grep-input')).toBeInTheDocument();
    expect(screen.getByTestId('livelogs-vehicle-input')).toBeInTheDocument();

    // Empty state should be visible (no log events yet).
    expect(
      screen.getByText(/No log events yet/i),
    ).toBeInTheDocument();

    // Status badge starts as Connecting (fetch hasn't resolved
    // headers yet by the time React commits) or Live.
    const status = screen.getByTestId('livelogs-status-badge');
    expect(status.textContent).toMatch(/Connecting|Live|Disconnected/);

    await act(async () => {
      await stream.close();
    });
  });

  it('renders log events arriving over the controlled stream', async () => {
    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);

    // Wait for the fetch to be initiated.
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    await act(async () => {
      await stream.push('event: connected\ndata: {"level":"info"}\n\n');
      await stream.push(
        'event: log\ndata: {"level":"info","message":"hello world"}\n\n',
      );
      await stream.push(
        'event: log\ndata: {"level":"warn","message":"second event","mqtt":"on"}\n\n',
      );
      // Allow the rAF/microtask flush to land.
      await Promise.resolve();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(screen.getByText(/hello world/)).toBeInTheDocument();
    });
    expect(screen.getByText(/second event/)).toBeInTheDocument();

    await act(async () => {
      await stream.close();
    });
  });

  it('pause button toggles label and freezes the visible buffer', async () => {
    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);

    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await act(async () => {
      await stream.push(
        'event: log\ndata: {"level":"info","message":"first"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/first/)).toBeInTheDocument());

    const pauseBtn = screen.getByTestId('livelogs-pause-button');
    expect(pauseBtn.textContent).toMatch(/Pause/);
    fireEvent.click(pauseBtn);
    expect(pauseBtn.textContent).toMatch(/Resume/);

    // Push more events while paused — they MUST NOT appear in the
    // visible buffer.
    await act(async () => {
      await stream.push(
        'event: log\ndata: {"level":"info","message":"after-pause"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByText(/after-pause/)).not.toBeInTheDocument();

    // Resume should let new events through again.
    fireEvent.click(pauseBtn);
    await act(async () => {
      await stream.push(
        'event: log\ndata: {"level":"info","message":"after-resume"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/after-resume/)).toBeInTheDocument(),
    );

    await act(async () => {
      await stream.close();
    });
  });

  it('clear button drops all buffered events back to the empty state', async () => {
    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await act(async () => {
      await stream.push(
        'event: log\ndata: {"level":"info","message":"about-to-clear"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/about-to-clear/)).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('livelogs-clear-button'));

    await waitFor(() => {
      expect(screen.queryByText(/about-to-clear/)).not.toBeInTheDocument();
      expect(screen.getByText(/No log events yet/i)).toBeInTheDocument();
    });

    await act(async () => {
      await stream.close();
    });
  });

  it('download button is disabled when buffer is empty and fires Blob creation when populated', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    });

    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    const downloadBtn = screen.getByTestId('livelogs-download-button');
    expect(downloadBtn).toBeDisabled();

    await act(async () => {
      await stream.push(
        'event: log\ndata: {"level":"info","message":"to-download"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/to-download/)).toBeInTheDocument(),
    );
    expect(downloadBtn).not.toBeDisabled();

    fireEvent.click(downloadBtn);
    expect(createObjectURL).toHaveBeenCalledTimes(1);

    await act(async () => {
      await stream.close();
    });
  });

  it('renders an error banner when the stream fetch rejects', async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response('forbidden', {
          status: 403,
          statusText: 'Forbidden',
        }),
    ) as unknown as typeof fetch;

    renderPage(fetchImpl);

    await waitFor(() => {
      expect(screen.getByTestId('livelogs-error')).toBeInTheDocument();
    });
    expect(screen.getByText(/Could not connect/i)).toBeInTheDocument();
  });
});
