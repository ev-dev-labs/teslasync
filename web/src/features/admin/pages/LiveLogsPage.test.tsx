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
import { useSyncExternalStore, type ReactNode } from 'react';

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

const selectedVehicleState = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  // `snapshot` is the object useSyncExternalStore's getSnapshot()
  // returns. It MUST be replaced (a new reference) on every mutation
  // — useSyncExternalStore bails out of re-rendering via Object.is
  // comparison against the previously returned snapshot, so mutating
  // fields on a single long-lived object in place would notify
  // listeners but never actually re-render (React sees "no change").
  // Getters/setters below keep the ergonomic
  // `selectedVehicleState.vehicleId = ...` test API while internally
  // rebuilding the snapshot reference on every write.
  let snapshot: { vehicleId: number | null; vehicles: Array<{ id: number }> } = {
    vehicleId: null,
    vehicles: [],
  };
  const notify = () => listeners.forEach((listener) => listener());
  return {
    listeners,
    getSnapshot: () => snapshot,
    setVehicleId: vi.fn(),
    get vehicleId() {
      return snapshot.vehicleId;
    },
    set vehicleId(next: number | null) {
      snapshot = { ...snapshot, vehicleId: next };
      notify();
    },
    get vehicles() {
      return snapshot.vehicles;
    },
    set vehicles(next: Array<{ id: number }>) {
      snapshot = { ...snapshot, vehicles: next };
      notify();
    },
  };
});

// The real useSelectedVehicle hook is backed by reactive state, so a
// commit (setVehicleId) always schedules a re-render of any consumer.
// A bare `() => selectedVehicleState` mock would silently break that
// contract — mutating the shared object would never itself trigger a
// re-render, which would mask the very regression under test here
// (aiVehicleId must reflect a REAL commit). useSyncExternalStore wires
// the mock to genuinely re-render LiveLogsPage when setVehicleId
// mutates the store, matching the real hook's behaviour.
vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => {
    const snapshot = useSyncExternalStore(
      (onStoreChange) => {
        selectedVehicleState.listeners.add(onStoreChange);
        return () => selectedVehicleState.listeners.delete(onStoreChange);
      },
      () => selectedVehicleState.getSnapshot(),
    );
    return {
      vehicleId: snapshot.vehicleId,
      vehicles: snapshot.vehicles,
      setVehicleId: selectedVehicleState.setVehicleId,
    };
  },
}));

// AI settings are mocked so the AI-01 regression test below can flip
// the log-trace-summarization feature on without a real settings
// round-trip. Every other test in this file leaves the default
// (ai_mode='off') in place, matching the pre-existing behaviour where
// the AI section never renders unless a test opts in.
vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

import LiveLogsPage, { deriveAiVehicleScope, parseCanonicalVehicleId } from './LiveLogsPage';
import { ToastProvider } from '@/components/feedback/Toast';
import { useSettings } from '@/hooks/useSettings';
import type { AppSettings } from '@/api/types';

const mockUseSettings = useSettings as unknown as ReturnType<typeof vi.fn>;

const AI_FEATURE_ID = 'log-trace-summarization';
const AI_ROUTE = '/api/v1/ai/system/logs/summarize';

const baseAiSettings: AppSettings = {
  unit_of_length: 'km',
  unit_of_temp: 'C',
  unit_of_pressure: 'bar',
  preferred_range: 'rated',
  language: 'en',
  base_cost_per_kwh: 0.12,
  api_suspended: false,
  theme: 'neon-cyan',
  mode: 'dark',
  custom_primary: '#00b4d8',
  custom_accent: '#e63946',
  gas_price_per_unit: 0,
  gas_unit: 'gallon',
  gas_efficiency_mpg: 25,
  decimal_precision: 2,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  alert_digest_mode: 'instant',
};

function aiOffSettings() {
  return { settings: { ...baseAiSettings, ai_mode: 'off' as const } };
}

function aiEnabledSettings() {
  return {
    settings: {
      ...baseAiSettings,
      ai_mode: 'cloud' as const,
      ai_features: { [AI_FEATURE_ID]: true },
    },
  };
}

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

// sseFrame formats a single SSE event the way internal/ai/stream/writer.go
// emits it — matches the helper used by AILogTraceSummarization.test.tsx
// and the useAiStream unit tests.
function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
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

const ORIGINAL_GLOBAL_FETCH = globalThis.fetch;

beforeEach(() => {
  vi.useRealTimers();
  selectedVehicleState.vehicleId = null;
  selectedVehicleState.vehicles = [];
  selectedVehicleState.setVehicleId.mockReset();
  // Mirrors the real useSelectedVehicle hook's effect on commit: a
  // known-vehicle commitVehicleFilter call actually updates the
  // committed vehicleId AND notifies subscribers (via the
  // useSyncExternalStore-backed mock above), so tests can observe the
  // REAL downstream effect (aiVehicleId / useAiStream scopeKey) of a
  // genuine commit — a real re-render, not just the setVehicleId call
  // args.
  selectedVehicleState.setVehicleId.mockImplementation((id: number) => {
    // The `vehicleId` setter rebuilds the snapshot reference AND
    // notifies subscribers — no extra listener plumbing needed here.
    selectedVehicleState.vehicleId = id;
  });
  mockUseSettings.mockReset();
  mockUseSettings.mockReturnValue(aiOffSettings());
});

afterEach(() => {
  vi.restoreAllMocks();
  // Restore the pristine global fetch reference — only the AI-01
  // regression test below reassigns globalThis.fetch (the other
  // tests exclusively use the fetchImpl test seam), so this must
  // never leak into a later test.
  globalThis.fetch = ORIGINAL_GLOBAL_FETCH;
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

  // AI-01 regression (production parent): LiveLogsPage recomputes
  // { aiFromUnix, aiToUnix } from the live event buffer on every
  // incoming log line (newest event time minus a fixed 30-minute
  // lookback). Before the fix, AILogTraceSummarization keyed its
  // useAiStream scopeKey on `${vehicleId}:${fromUnix}:${toUnix}`, so
  // every single live log event aborted an in-flight AI summary (or
  // wiped a just-completed one) even though the user's actual
  // semantic scope (the selected vehicle) never changed. This test
  // exercises the REAL page + REAL live-log stream (not just the
  // isolated AI component) to prove the fix holds end-to-end: the AI
  // stream survives window churn from live events and only
  // aborts/resets when the vehicle scope actually changes.
  it('keeps the AI log summary stream alive as live events advance the window, and only aborts/resets on a real vehicle-scope change', async () => {
    mockUseSettings.mockReturnValue(aiEnabledSettings());
    selectedVehicleState.vehicles = [{ id: 42 }, { id: 7 }];

    let aiAbortSignal: AbortSignal | undefined;
    let aiFetchCount = 0;
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.endsWith(AI_ROUTE)) {
        aiFetchCount += 1;
        aiAbortSignal = init?.signal ?? undefined;
        // Never resolves/closes — holds the AI stream at
        // state='streaming' so we can observe abort behaviour.
        return new Response(
          new ReadableStream<Uint8Array>({ start() {} }),
          { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
        );
      }
      throw new Error(`unexpected global fetch call: ${url}`);
    }) as unknown as typeof globalThis.fetch;

    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());

    // Seed the live buffer with one event so the AI window is valid,
    // then start the AI summary.
    await act(async () => {
      await stream.push(
        'event: log\ndata: {"level":"info","message":"first live event"}\n\n',
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() =>
      expect(screen.getByText(/first live event/)).toBeInTheDocument(),
    );

    const summarizeButton = screen.getByRole('button', { name: /Summarize/i });
    await act(async () => {
      fireEvent.click(summarizeButton);
    });
    await waitFor(() => expect(aiFetchCount).toBe(1));
    expect(aiAbortSignal?.aborted).toBe(false);
    expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument();

    // More live events land while the AI summary is in flight. Each
    // one recomputes aiFromUnix/aiToUnix (the window slides forward)
    // but the VEHICLE scope has not changed — the AI stream MUST
    // survive every one of them.
    for (let i = 0; i < 3; i += 1) {
      await act(async () => {
        await stream.push(
          `event: log\ndata: {"level":"info","message":"live event ${i}"}\n\n`,
        );
        await Promise.resolve();
        await Promise.resolve();
      });
    }
    await waitFor(() =>
      expect(screen.getByText(/live event 2/)).toBeInTheDocument(),
    );
    expect(aiAbortSignal?.aborted).toBe(false);
    expect(aiFetchCount).toBe(1);
    expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument();

    // The user types into the vehicle box but never commits it (no
    // blur/Enter) — uncommitted keystrokes, even a syntactically
    // plausible positive integer, MUST NOT change AI scope or abort
    // the in-flight summary.
    const vehicleInput = screen.getByTestId('livelogs-vehicle-input');
    fireEvent.change(vehicleInput, { target: { value: '42' } });
    expect(aiAbortSignal?.aborted).toBe(false);
    expect(aiFetchCount).toBe(1);
    expect(screen.getByTestId('ai-output-panel')).toBeInTheDocument();

    // Now the user actually COMMITS a known vehicle (blur) — a real
    // semantic scope change — and the in-flight AI stream MUST abort.
    fireEvent.blur(vehicleInput);

    await waitFor(() => expect(aiAbortSignal?.aborted).toBe(true));
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();

    await act(async () => {
      await stream.close();
    });
  });

  // AI-06 regression: a NON-empty but invalid/uncommitted vehicle-box
  // draft must never widen or corrupt AI scope, and must never
  // abort/reset an already-committed AI summary. Only a genuine
  // COMMIT (blur/Enter of a positive-integer, known vehicle id) or an
  // explicit CLEAR to empty may change AI scope.
  it('does not broaden scope, abort, or reset for a fractional, scientific-notation, or unknown-id draft — but a committed id and a clear both do', async () => {
    mockUseSettings.mockReturnValue(aiEnabledSettings());
    // Vehicle 7 is the only KNOWN vehicle; 1.5 / 1e2 / 999 are not.
    selectedVehicleState.vehicles = [{ id: 7 }];

    const completedSummaries: Array<number | 'none'> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.endsWith(AI_ROUTE)) {
        throw new Error(`unexpected global fetch call: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as { vehicle_id?: number };
      completedSummaries.push(body.vehicle_id ?? 'none');
      const sseBody =
        sseFrame('delta', { text: `Summary for vehicle_id=${body.vehicle_id ?? 'none'}.` }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await act(async () => {
      await stream.push('event: log\ndata: {"level":"info","message":"seed"}\n\n');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/seed/)).toBeInTheDocument());

    const vehicleInput = screen.getByTestId('livelogs-vehicle-input');
    const summarizeButton = screen.getByRole('button', { name: /Summarize/i });

    // Commit no vehicle yet (fleet-wide) and run once so we have a
    // completed summary to protect against corruption.
    await act(async () => {
      fireEvent.click(summarizeButton);
    });
    await screen.findByText('Summary for vehicle_id=none.');

    // Fractional draft ("1.5"): finite and positive, but NOT an
    // integer — must not replace the fleet-wide completed summary,
    // and must never be sent to the backend as vehicle_id.
    fireEvent.change(vehicleInput, { target: { value: '1.5' } });
    expect(screen.getByText('Summary for vehicle_id=none.')).toBeInTheDocument();

    // Scientific notation ("1e2" === 100): numerically finite and
    // positive, but vehicle 100 is not a known vehicle — must not
    // replace the completed summary or be sent to the backend.
    fireEvent.change(vehicleInput, { target: { value: '1e2' } });
    expect(screen.getByText('Summary for vehicle_id=none.')).toBeInTheDocument();

    // Unknown id ("999"): a syntactically valid positive integer that
    // is not in the known-vehicles list — must not broaden/redirect
    // scope to a vehicle the user never actually selected.
    fireEvent.change(vehicleInput, { target: { value: '999' } });
    expect(screen.getByText('Summary for vehicle_id=none.')).toBeInTheDocument();

    // None of the three invalid/unknown drafts ever reached the
    // backend — only the original fleet-wide run did.
    expect(completedSummaries).toEqual(['none']);

    // A REAL commit of a known vehicle (7) DOES change scope and
    // clears the stale fleet-wide summary.
    fireEvent.change(vehicleInput, { target: { value: '7' } });
    fireEvent.blur(vehicleInput);
    expect(screen.queryByText('Summary for vehicle_id=none.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Summarize/i }));
    });
    await screen.findByText('Summary for vehicle_id=7.');
    expect(completedSummaries).toEqual(['none', 7]);

    // Clearing the box back to empty is an intentional, IMMEDIATE
    // request for fleet-wide scope — no commit required — and clears
    // the vehicle-7 summary.
    fireEvent.change(vehicleInput, { target: { value: '' } });
    expect(screen.queryByText('Summary for vehicle_id=7.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();

    await act(async () => {
      await stream.close();
    });
  });

  // Regression: closes the scientific-notation COMMIT loophole.
  // commitVehicleFilter used to accept anything `Number(text)` could
  // parse to a positive integer — so blurring/Entering "1e2" (which
  // `Number("1e2") === 100`) would commit vehicle 100 exactly as if
  // the user had typed "100". This is a production-parent test (the
  // real page, real commit path, real AI wiring): with vehicle 100
  // KNOWN, committing "1e2" must NOT select vehicle 100, must NOT
  // change AI scope, and must NOT send vehicle_id 100 to the backend
  // — while committing the canonical "100" must do all three.
  it('rejects a committed "1e2" draft as vehicle 100 (no selection/scope change, no vehicle_id=100 sent), but commits the canonical "100" draft', async () => {
    mockUseSettings.mockReturnValue(aiEnabledSettings());
    selectedVehicleState.vehicles = [{ id: 100 }];

    const sentVehicleIds: Array<number | 'none'> = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (!url.endsWith(AI_ROUTE)) {
        throw new Error(`unexpected global fetch call: ${url}`);
      }
      const body = JSON.parse(String(init?.body)) as { vehicle_id?: number };
      sentVehicleIds.push(body.vehicle_id ?? 'none');
      const sseBody =
        sseFrame('delta', { text: `Summary for vehicle_id=${body.vehicle_id ?? 'none'}.` }) +
        sseFrame('done', { finish_reason: 'stop', usage: { in: 1, out: 1 } });
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sseBody));
            controller.close();
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      );
    }) as unknown as typeof globalThis.fetch;

    const { fetchImpl, stream } = makeControlledFetch();
    renderPage(fetchImpl);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
    await act(async () => {
      await stream.push('event: log\ndata: {"level":"info","message":"seed"}\n\n');
      await Promise.resolve();
      await Promise.resolve();
    });
    await waitFor(() => expect(screen.getByText(/seed/)).toBeInTheDocument());

    const vehicleInput = screen.getByTestId('livelogs-vehicle-input');
    const summarizeButton = screen.getByRole('button', { name: /Summarize/i });

    // Commit "1e2" — numerically equal to 100, but NOT the canonical
    // digit-string form. Must not select vehicle 100.
    fireEvent.change(vehicleInput, { target: { value: '1e2' } });
    fireEvent.blur(vehicleInput);
    expect(selectedVehicleState.setVehicleId).not.toHaveBeenCalled();
    expect(selectedVehicleState.vehicleId).toBeNull();

    // AI scope must still be fleet-wide (no committed vehicle), so a
    // run now must NOT send vehicle_id=100.
    await act(async () => {
      fireEvent.click(summarizeButton);
    });
    await screen.findByText('Summary for vehicle_id=none.');
    expect(sentVehicleIds).toEqual(['none']);

    // Now commit the CANONICAL "100" — this must actually select
    // vehicle 100 and change AI scope.
    fireEvent.change(vehicleInput, { target: { value: '100' } });
    fireEvent.blur(vehicleInput);
    expect(selectedVehicleState.setVehicleId).toHaveBeenCalledWith(100);
    expect(selectedVehicleState.vehicleId).toBe(100);
    // The stale fleet-wide summary is cleared by the real scope change.
    expect(screen.queryByText('Summary for vehicle_id=none.')).not.toBeInTheDocument();
    expect(screen.queryByTestId('ai-output-panel')).not.toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /Summarize/i }));
    });
    await screen.findByText('Summary for vehicle_id=100.');
    expect(sentVehicleIds).toEqual(['none', 100]);

    await act(async () => {
      await stream.close();
    });
  });
});

// ── parseCanonicalVehicleId (pure helper) ─────────────────────────────────
//
// Direct unit coverage of the canonical-digit-string gate that stands
// between free-typed filter text and a committed vehicle id.
describe('parseCanonicalVehicleId', () => {
  it('accepts plain positive-integer digit strings, including with surrounding whitespace', () => {
    expect(parseCanonicalVehicleId('7')).toBe(7);
    expect(parseCanonicalVehicleId('100')).toBe(100);
    expect(parseCanonicalVehicleId('  100  ')).toBe(100);
  });

  it('rejects scientific notation even though Number() would parse it to a positive integer', () => {
    expect(parseCanonicalVehicleId('1e2')).toBeNull();
    expect(parseCanonicalVehicleId('1E2')).toBeNull();
    expect(parseCanonicalVehicleId('1e+2')).toBeNull();
  });

  it('rejects fractional/decimal drafts', () => {
    expect(parseCanonicalVehicleId('1.5')).toBeNull();
    expect(parseCanonicalVehicleId('100.0')).toBeNull();
  });

  it('rejects signed drafts (leading + or -)', () => {
    expect(parseCanonicalVehicleId('+7')).toBeNull();
    expect(parseCanonicalVehicleId('-7')).toBeNull();
  });

  it('rejects whitespace-only and empty drafts', () => {
    expect(parseCanonicalVehicleId('')).toBeNull();
    expect(parseCanonicalVehicleId('   ')).toBeNull();
    expect(parseCanonicalVehicleId('\t\n')).toBeNull();
  });

  it('rejects leading-syntax garbage that is not a canonical digit string', () => {
    expect(parseCanonicalVehicleId('0x64')).toBeNull(); // hex for 100
    expect(parseCanonicalVehicleId('Infinity')).toBeNull();
    expect(parseCanonicalVehicleId('NaN')).toBeNull();
    expect(parseCanonicalVehicleId('7abc')).toBeNull();
    expect(parseCanonicalVehicleId('abc7')).toBeNull();
    expect(parseCanonicalVehicleId('7 7')).toBeNull();
  });

  it('rejects leading zeros (documented decision: "007" is not canonical "7")', () => {
    expect(parseCanonicalVehicleId('007')).toBeNull();
    expect(parseCanonicalVehicleId('01')).toBeNull();
  });

  it('rejects zero itself (not a positive integer)', () => {
    expect(parseCanonicalVehicleId('0')).toBeNull();
  });
});

// ── deriveAiVehicleScope (pure helper) ────────────────────────────────────
//
// Direct unit coverage of the validation the vehicle-scope regression
// hinges on. Exercised in isolation (no rendering, no fetch) so the
// exact boundary cases are pinned precisely and cheaply.
describe('deriveAiVehicleScope', () => {
  it('treats a cleared (empty/whitespace) draft as intentional fleet-wide scope, regardless of any committed vehicleId', () => {
    expect(deriveAiVehicleScope('', 7, [{ id: 7 }])).toBeUndefined();
    expect(deriveAiVehicleScope('   ', 7, [{ id: 7 }])).toBeUndefined();
    expect(deriveAiVehicleScope('', null, [])).toBeUndefined();
  });

  it('rejects a fractional draft ("1.5") — never adopts a non-integer id even if numerically positive/finite', () => {
    // No committed vehicle yet: falls back to fleet-wide, NOT 1.5.
    expect(deriveAiVehicleScope('1.5', null, [])).toBeUndefined();
    // A committed vehicle exists: the fractional draft must not
    // override it OR adopt 1.5 — the committed id is preserved.
    expect(deriveAiVehicleScope('1.5', 7, [{ id: 7 }])).toBe(7);
  });

  it('rejects scientific-notation drafts ("1e2") even though Number("1e2") is a finite positive integer (100)', () => {
    expect(deriveAiVehicleScope('1e2', null, [])).toBeUndefined();
    expect(deriveAiVehicleScope('1e2', 7, [{ id: 7 }])).toBe(7);
    // Even if a vehicle 100 happens to exist, the DRAFT alone must
    // never drive scope — only a committed vehicleId does.
    expect(deriveAiVehicleScope('1e2', 7, [{ id: 7 }, { id: 100 }])).toBe(7);
  });

  it('rejects a syntactically valid but unknown vehicle id draft', () => {
    expect(deriveAiVehicleScope('999', null, [{ id: 1 }, { id: 2 }])).toBeUndefined();
    expect(deriveAiVehicleScope('999', 7, [{ id: 7 }])).toBe(7);
  });

  it('returns the committed vehicleId once it is a known, positive-integer id (the "valid committed ID" case)', () => {
    expect(deriveAiVehicleScope('7', 7, [{ id: 7 }])).toBe(7);
    expect(deriveAiVehicleScope('anything-uncommitted', 7, [{ id: 7 }])).toBe(7);
  });

  it('falls back to fleet-wide when the committed vehicleId is no longer known, non-integer, zero, or negative (defence in depth)', () => {
    expect(deriveAiVehicleScope('7', 999, [{ id: 7 }])).toBeUndefined();
    expect(deriveAiVehicleScope('7', 1.5, [{ id: 7 }, { id: 1.5 }])).toBeUndefined();
    expect(deriveAiVehicleScope('7', 0, [{ id: 0 }])).toBeUndefined();
    expect(deriveAiVehicleScope('7', -1, [{ id: -1 }])).toBeUndefined();
  });
});
