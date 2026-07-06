/**
 * DLQInspectorPage — behaviour + regression tests.
 *
 * The page is the operator surface for the `/system/dlq*` routes. These
 * tests drive the four DLQ hooks through a mocked `request()` client (the
 * same seam FleetTelemetryCoveragePage's suite uses) so the real TanStack
 * Query wiring, sub-components, drawer, and confirm-dialog all execute.
 *
 * Coverage:
 *   1. Happy path — KPI band + entries table + reason breakdown + audit log
 *      render from a single list payload; the replay-disabled banner is
 *      absent when the env flag is on.
 *   2. `replay_enabled: false` surfaces the StatusHeader "disabled" banner
 *      and flips the "Replay mode" KPI to "Disabled".
 *   3. Inspecting a row opens the drawer, lazy-loads the full entry, and
 *      decodes the base64 inner payload.
 *   4. A successful replay fires the POST and closes BOTH the confirm dialog
 *      and the drawer.
 *   5. A 403 (env hard-disable) swaps the toast for the persistent page
 *      "Replay blocked" banner and closes the confirm dialog.
 *   6. REGRESSION — a non-403 replay failure (502 publish_failed) must close
 *      the confirm dialog instead of stranding it open, while surfacing the
 *      failure via the mutation toast. This guards the bug fixed in
 *      `handleConfirmReplay`'s `finally`.
 *   7. A list fetch error keeps the KPI band visible with honest "—"
 *      placeholders, shows a recoverable QueryError, and recovers on retry.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

// ── i18n stub: return the English fallback, interpolating {{vars}} from the
//    3rd positional arg OR from a `{ defaultValue, ...vars }` object. ────────
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, second?: unknown, third?: unknown) => {
      const interpolate = (tpl: string, vars?: Record<string, unknown>) => {
        if (!vars) return tpl;
        let out = tpl;
        for (const [k, v] of Object.entries(vars)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
        return out;
      };
      if (typeof second === 'string') {
        return interpolate(
          second,
          third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined,
        );
      }
      if (second && typeof second === 'object') {
        const o = second as Record<string, unknown>;
        const tpl = typeof o.defaultValue === 'string' ? o.defaultValue : key;
        const { defaultValue: _dv, ...vars } = o;
        return interpolate(tpl, vars);
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props, render children synchronously. ────
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safe: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              [
                'animate',
                'initial',
                'exit',
                'transition',
                'whileHover',
                'whileTap',
                'whileInView',
                'variants',
                'layout',
              ].includes(k)
            )
              continue;
            safe[k] = v;
          }
          return <div {...(safe as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── API client: mock only `request`; keep the real ApiError / isApiError /
//    SudoCanceledError so error classification and QueryError branch honestly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request, ApiError } from '@/api/client';
import { ToastProvider } from '@/components/feedback/Toast';
import DLQInspectorPage from './DLQInspectorPage';
import type {
  DLQAuditResponse,
  DLQEntryFull,
  DLQEntrySummary,
  DLQListResponse,
  DLQReplayResponse,
} from '@/types/admin-diagnostics';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────
const ENTRY_A_VIN = 'VIN0000000000001';
const ENTRY_A_SOURCE = 'telemetry/VIN1/v/Field';
const INNER_JSON = '{"field":"VehicleSpeed"}';

const entryA: DLQEntrySummary = {
  id: 1,
  arrived_at: '2026-07-01T10:00:00.000Z',
  dlq_topic: 'dlq/telemetry',
  parsed_reason: 'unknown_enum',
  parsed_vehicle_id: 42,
  parsed_vin: ENTRY_A_VIN,
  parsed_source_topic: ENTRY_A_SOURCE,
  parsed_redeliveries: 3,
  parsed_timestamp: '2026-07-01T09:59:00.000Z',
  parse_error: null,
  replayable: true,
  raw_payload_size: 2048,
  inner_payload_size: 512,
};

const entryB: DLQEntrySummary = {
  id: 2,
  arrived_at: '2026-07-02T11:00:00.000Z',
  dlq_topic: 'dlq/telemetry',
  parsed_reason: 'kind_mismatch',
  parsed_vehicle_id: null,
  parsed_vin: null,
  parsed_source_topic: null,
  parsed_redeliveries: null,
  parsed_timestamp: null,
  parse_error: 'no source topic',
  replayable: false,
  raw_payload_size: 900,
  inner_payload_size: 100,
};

const entryAFull: DLQEntryFull = {
  ...entryA,
  raw_payload_b64: btoa('{"envelope":true}'),
  inner_payload_b64: btoa(INNER_JSON),
};

const entryBFull: DLQEntryFull = {
  ...entryB,
  raw_payload_b64: btoa('{"env":"b"}'),
  inner_payload_b64: btoa('{"reason":"kind_mismatch"}'),
};

const auditResponse: DLQAuditResponse = {
  count: 1,
  limit: 50,
  dlq_id: 0,
  rows: [
    {
      id: 10,
      replayed_at: '2026-07-02T12:00:00.000Z',
      actor: 'admin@example.com',
      actor_ip: '10.0.0.1',
      dlq_id: 1,
      src_topic: ENTRY_A_SOURCE,
      dst_topic: ENTRY_A_SOURCE,
      payload: 'x',
      reason: 'unknown_enum',
      result: 'ok',
      error: '',
      trace_id: 'trace-abc',
    },
  ],
};

const replayOk: DLQReplayResponse = {
  ok: true,
  replayed_id: 1,
  dst_topic: ENTRY_A_SOURCE,
  result: 'ok',
  audit_id: 10,
};

function listResponse(overrides: Partial<DLQListResponse> = {}): DLQListResponse {
  return { count: 2, replay_enabled: true, entries: [entryA, entryB], ...overrides };
}

interface Handlers {
  list?: () => Promise<unknown>;
  audit?: () => Promise<unknown>;
  entry?: (id: number) => Promise<unknown>;
  replay?: (id: number) => Promise<unknown>;
}

function wire(h: Handlers = {}) {
  mockedRequest.mockImplementation((path: string) => {
    if (path === '/system/dlq') {
      return (h.list ?? (() => Promise.resolve(listResponse())))();
    }
    if (path.startsWith('/system/dlq/audit')) {
      return (h.audit ?? (() => Promise.resolve(auditResponse)))();
    }
    const replayMatch = path.match(/^\/system\/dlq\/(\d+)\/replay$/);
    if (replayMatch) {
      const id = Number(replayMatch[1]);
      return (h.replay ?? (() => Promise.resolve(replayOk)))(id);
    }
    const entryMatch = path.match(/^\/system\/dlq\/(\d+)$/);
    if (entryMatch) {
      const id = Number(entryMatch[1]);
      return (h.entry ?? ((eid: number) => Promise.resolve(eid === 2 ? entryBFull : entryAFull)))(id);
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <DLQInspectorPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Inspect entry A (replayable) by locating its row via the VIN cell. */
async function openEntryADrawer() {
  const vinCell = await screen.findByText(ENTRY_A_VIN);
  const row = vinCell.closest('tr') as HTMLElement | null;
  if (!row) throw new Error('entry A row not found in table');
  fireEvent.click(within(row).getByRole('button', { name: /Inspect/ }));
  await screen.findByRole('dialog', { name: /DLQ entry #1/ });
}

/** Open the drawer, wait for lazy load, click Replay, and await the confirm. */
async function openReplayConfirm() {
  await openEntryADrawer();
  // The decoded inner payload only appears once the full entry has loaded,
  // which is also when the Replay CTA leaves its disabled/loading state.
  await screen.findByText(INNER_JSON);
  fireEvent.click(screen.getByRole('button', { name: 'Replay' }));
  await screen.findByRole('dialog', { name: 'Replay DLQ entry?' });
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('DLQInspectorPage — bento surface', () => {
  it('renders the KPI band, entries table, reason breakdown, and audit log from the list payload', async () => {
    wire();
    renderPage();

    // Entries table populated (entry A by VIN, both reasons present).
    expect(await screen.findByText(ENTRY_A_VIN)).toBeInTheDocument();
    expect(screen.getAllByText('unknown_enum').length).toBeGreaterThan(0);
    expect(screen.getAllByText('kind_mismatch').length).toBeGreaterThan(0);

    // Page chrome + KPI band labels.
    expect(screen.getByRole('heading', { name: 'DLQ Inspector' })).toBeInTheDocument();
    expect(screen.getByText('Total entries')).toBeInTheDocument();
    // "Replayable" is both a KPI label and a table column header → >= 2.
    expect(screen.getAllByText('Replayable').length).toBeGreaterThan(0);
    expect(screen.getByText('Blocked')).toBeInTheDocument();

    // Global audit log rendered its row.
    expect(screen.getByText('admin@example.com')).toBeInTheDocument();

    // Replay is enabled → neither disabled banner shows.
    expect(screen.queryByText('DLQ replay is disabled')).toBeNull();
    expect(screen.queryByText('Replay blocked')).toBeNull();

    expect(mockedRequest).toHaveBeenCalledWith('/system/dlq', expect.anything());
  });

  it('surfaces the disabled banner and flips the Replay-mode KPI when replay_enabled is false', async () => {
    wire({ list: () => Promise.resolve(listResponse({ replay_enabled: false })) });
    renderPage();

    expect(await screen.findByText('DLQ replay is disabled')).toBeInTheDocument();
    expect(screen.getByText(/DLQ_REPLAY_ENABLED env flag is not set/)).toBeInTheDocument();
    // The "Replay mode" StatCard reads "Disabled".
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });
});

describe('DLQInspectorPage — entry drawer', () => {
  it('opens the drawer, lazy-loads the full entry, and decodes the base64 inner payload', async () => {
    wire();
    renderPage();
    await openEntryADrawer();

    expect(mockedRequest).toHaveBeenCalledWith('/system/dlq/1', expect.anything());

    // Decoded UTF-8 inner payload renders in the drawer's <pre>.
    expect(await screen.findByText(INNER_JSON)).toBeInTheDocument();

    const drawer = screen.getByRole('dialog', { name: /DLQ entry #1/ });
    expect(within(drawer).getByText(ENTRY_A_SOURCE)).toBeInTheDocument();
    // The drawer exposes a header (icon) Close and a footer Close — both named.
    expect(within(drawer).getAllByRole('button', { name: 'Close' }).length).toBeGreaterThan(0);
  });
});

describe('DLQInspectorPage — replay flow', () => {
  it('fires the replay POST and closes both the confirm dialog and the drawer on success', async () => {
    wire();
    renderPage();
    await openReplayConfirm();

    // Confirm message interpolates the entry id.
    expect(
      screen.getByText('This will republish entry #1 to its source topic. The action is logged and rate-limited.'),
    ).toBeInTheDocument();

    const replayButtons = screen.getAllByRole('button', { name: 'Replay' });
    fireEvent.click(replayButtons[replayButtons.length - 1]);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        '/system/dlq/1/replay',
        expect.objectContaining({ method: 'POST' }),
      ),
    );
    // result === 'ok' closes the confirm dialog AND the drawer.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Replay DLQ entry?' })).toBeNull(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /DLQ entry #1/ })).toBeNull(),
    );
  });

  it('shows the persistent "Replay blocked" banner and closes the dialog on a 403 env hard-disable', async () => {
    wire({ replay: () => Promise.reject(new ApiError('DLQ replay disabled', 403)) });
    renderPage();
    await openReplayConfirm();

    const replayButtons = screen.getAllByRole('button', { name: 'Replay' });
    fireEvent.click(replayButtons[replayButtons.length - 1]);

    expect(await screen.findByText('Replay blocked')).toBeInTheDocument();
    expect(screen.getByText(/DLQ_REPLAY_ENABLED is not set/)).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Replay DLQ entry?' })).toBeNull(),
    );
  });

  it('closes the confirm dialog (not stranded open) and toasts on a non-403 replay failure', async () => {
    // REGRESSION GUARD: a 502 publish_failed (like 404 not_found / 409
    // unparseable) rejects. The dialog must dismiss itself; only the toast
    // carries the failure — no "Replay blocked" env banner (that's 403-only).
    wire({ replay: () => Promise.reject(new ApiError('publish failed', 502)) });
    renderPage();
    await openReplayConfirm();

    const replayButtons = screen.getAllByRole('button', { name: 'Replay' });
    fireEvent.click(replayButtons[replayButtons.length - 1]);

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Replay DLQ entry?' })).toBeNull(),
    );
    // The failure surfaces via the mutation's error toast, not the env banner.
    expect(await screen.findByText('Replay failed')).toBeInTheDocument();
    expect(screen.queryByText('Replay blocked')).toBeNull();
    expect(mockedRequest).toHaveBeenCalledWith(
      '/system/dlq/1/replay',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});

describe('DLQInspectorPage — list error handling', () => {
  it('keeps the KPI band visible with "—" placeholders on a fetch error, then recovers on retry', async () => {
    wire({ list: () => Promise.reject(new ApiError('backend down', 503)) });
    renderPage();

    // Recoverable error surface (entries panel + reason breakdown both render
    // a QueryError for a 5xx → "Server error").
    expect((await screen.findAllByText('Server error')).length).toBeGreaterThan(0);
    // The band stays mounted and shows honest dashes rather than a fake "0".
    expect(screen.getByText('Total entries')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Recover: the retry handler refetches the list.
    wire();
    fireEvent.click(screen.getAllByRole('button', { name: 'Retry' })[0]);

    expect(await screen.findByText(ENTRY_A_VIN)).toBeInTheDocument();
    expect(screen.getAllByText('unknown_enum').length).toBeGreaterThan(0);
  });
});
