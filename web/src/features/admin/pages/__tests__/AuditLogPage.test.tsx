/**
 * AuditLogPage — behaviour + hardening coverage.
 *
 * Exercises every branch of the audit-log cockpit through the public page
 * (its only export) plus its internal `ExpandedDetail` / `formatJSON` helpers
 * via the row-expansion path:
 *   - KPI band honesty: real counts on success, but the universal "—"
 *     placeholder while a source query is loading or has errored (so the
 *     header never reports a fabricated "0"). This is the bug this suite
 *     locks in, mirroring RedisSignalViewerPage's error-honesty contract.
 *   - subsystem-missing (503) banner vs generic (500) QueryError routing.
 *   - loading / empty / error / populated states for the entries table.
 *   - filter → query-param wiring (snake_case, offset reset), Reset + Search.
 *   - pagination Previous/Next enable/disable + offset advance.
 *   - hash-chain verify: read-only hint, intact, broken, fetching, error.
 *   - expandable row detail with valid (pretty-printed) + invalid (raw)
 *     JSON payloads.
 *
 * Network is never touched: the four `useOperatorConfidence` hooks are mocked
 * and driven per-test.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ToastProvider } from '@/components/feedback/Toast';
import { ApiError } from '@/lib/resilience';
import type { AuditLogRow } from '@/types/admin-operator-confidence';

// ── i18n stub: return the fallback string, interpolating {{var}} options ──
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallbackOrOpts?: unknown, opts?: Record<string, unknown>) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          let s = fallbackOrOpts;
          for (const [k, v] of Object.entries(opts)) {
            s = s.replace(`{{${k}}}`, String(v));
          }
          return s;
        }
        return fallbackOrOpts;
      }
      return _key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// ── framer-motion: strip animation props, keep tests deterministic ──
vi.mock('framer-motion', () => {
  const motionProxy: Record<string, unknown> = new Proxy(
    {},
    {
      get:
        () =>
        ({ children, ...rest }: { children?: ReactNode } & Record<string, unknown>) => {
          const safeRest: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(rest)) {
            if (
              k === 'animate' ||
              k === 'initial' ||
              k === 'exit' ||
              k === 'transition' ||
              k === 'whileHover' ||
              k === 'whileTap' ||
              k === 'variants'
            )
              continue;
            safeRest[k] = v;
          }
          return <div {...(safeRest as Record<string, unknown>)}>{children}</div>;
        },
    },
  );
  return {
    motion: motionProxy,
    AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
    useReducedMotion: () => true,
  };
});

// ── The four audit hooks — driven per test ──
vi.mock('@/api/hooks/useOperatorConfidence', () => ({
  useAuditLog: vi.fn(),
  useAuditCategories: vi.fn(),
  useAuditActions: vi.fn(),
  useAuditChainVerify: vi.fn(),
}));

import {
  useAuditLog,
  useAuditCategories,
  useAuditActions,
  useAuditChainVerify,
} from '@/api/hooks/useOperatorConfidence';
import AuditLogPage from '../AuditLogPage';

const mockUseAuditLog = useAuditLog as unknown as ReturnType<typeof vi.fn>;
const mockUseAuditCategories = useAuditCategories as unknown as ReturnType<typeof vi.fn>;
const mockUseAuditActions = useAuditActions as unknown as ReturnType<typeof vi.fn>;
const mockUseAuditChainVerify = useAuditChainVerify as unknown as ReturnType<typeof vi.fn>;

 
function makeQuery(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

// Inspect the most recent argument object the audit-log hook was called with —
// the page rebuilds `queryParams` on every render, so the last call reflects
// the live filter/offset state.
 
function lastAuditParams(): any {
  const calls = mockUseAuditLog.mock.calls;
  return calls[calls.length - 1]?.[0];
}

// Read the value <p> that sits immediately after a MetricCard's label span.
function metricValue(label: string): string {
  const labelSpan = screen.getByText(label);
  const valueEl = labelSpan.closest('p')?.nextElementSibling;
  return valueEl?.textContent ?? '';
}

const ROWS: AuditLogRow[] = [
  {
    id: 1,
    ts: '2024-01-01T10:00:00Z',
    actor: 'admin@local',
    category: 'auth',
    action: 'login',
    entity_type: 'session',
    entity_id: 42,
    detail: 'signed in',
    ip: '10.0.0.1',
    user_agent: 'curl/8',
    trace_id: 'trace-abcdef1234567890',
    prev_row_hash: 'p0',
    row_hash: 'h1',
    success: true,
  },
  {
    id: 2,
    ts: '2024-01-02T11:30:00Z',
    actor: 'system',
    category: null,
    action: 'rotate',
    entity_type: 'secret',
    entity_id: null,
    detail: null,
    ip: null,
    user_agent: null,
    before: '{"k":1}',
    after: 'not-json',
    trace_id: null,
    prev_row_hash: 'h1',
    row_hash: 'h2',
    success: false,
  },
];

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <ToastProvider>
          <AuditLogPage />
        </ToastProvider>
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockUseAuditLog.mockReset();
  mockUseAuditCategories.mockReset();
  mockUseAuditActions.mockReset();
  mockUseAuditChainVerify.mockReset();
  mockUseAuditLog.mockReturnValue(makeQuery({ data: { rows: ROWS, limit: 100 } }));
  mockUseAuditCategories.mockReturnValue(makeQuery({ data: { categories: ['auth', 'config'] } }));
  mockUseAuditActions.mockReturnValue(makeQuery({ data: { actions: ['login', 'update'] } }));
  mockUseAuditChainVerify.mockReturnValue(makeQuery({ data: undefined }));
});

describe('AuditLogPage — populated view', () => {
  it('derives honest KPIs and renders every core section from the loaded rows', () => {
    renderPage();

    // Page + section scaffolding (all headings always present).
    expect(screen.getByRole('heading', { name: 'Audit Log', level: 1 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Hash chain integrity' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Entries' })).toBeInTheDocument();

    // KPI band — success => real numbers (2 rows: 1 ok, 1 fail, 2 actors).
    expect(metricValue('Entries shown')).toBe('2');
    expect(metricValue('OK (in view)')).toBe('1');
    expect(metricValue('Failed (in view)')).toBe('1');
    expect(metricValue('Actors (in view)')).toBe('2');
    expect(metricValue('Categories')).toBe('2');
    expect(metricValue('Action types')).toBe('2');

    // Table rows rendered.
    expect(screen.getByText('admin@local')).toBeInTheDocument();
    expect(screen.getByText('system')).toBeInTheDocument();
    // Non-colliding column headers (Actor/Category/Action also appear as filters).
    expect(screen.getByText('Timestamp')).toBeInTheDocument();
    expect(screen.getByText('Trace')).toBeInTheDocument();
  });

  it('exposes the CSV export affordance when there are rows to export', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: 'Download CSV' }),
    ).toBeInTheDocument();
  });
});

describe('AuditLogPage — degraded data sources', () => {
  it('shows the subsystem-unavailable banner and blanks KPIs to "—" on a 503 (no lying zeros)', () => {
    mockUseAuditLog.mockReturnValue(
      makeQuery({
        data: undefined,
        error: new ApiError('not configured', 503, 'SUBSYSTEM_NOT_CONFIGURED'),
      }),
    );
    renderPage();

    expect(
      screen.getByText('The audit log subsystem is not configured on this deployment.'),
    ).toBeInTheDocument();

    // The header must not fabricate a "0" when the ledger could not load.
    expect(metricValue('Entries shown')).toBe('—');
    expect(metricValue('OK (in view)')).toBe('—');
    expect(metricValue('Failed (in view)')).toBe('—');

    // A 503-subsystem case is NOT the generic table error path.
    expect(screen.queryByText('Server error')).toBeNull();
  });

  it('routes a non-503 failure to QueryError, blanks KPIs, and retries via the hook', async () => {
    const q = makeQuery({ data: undefined, error: new ApiError('boom', 500) });
    mockUseAuditLog.mockReturnValue(q);
    renderPage();

    expect(screen.getByText('Server error')).toBeInTheDocument();
    expect(metricValue('Entries shown')).toBe('—');

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(q.refetch).toHaveBeenCalled());
  });

  it('keeps KPIs honest as "—" while the first page is still loading', () => {
    mockUseAuditLog.mockReturnValue(makeQuery({ data: undefined, isLoading: true }));
    renderPage();

    expect(metricValue('Entries shown')).toBe('—');
    // Loading is not "empty": the empty-state copy must not show yet.
    expect(screen.queryByText('No audit entries')).toBeNull();
  });

  it('shows a genuine empty-state (and an honest 0) when the ledger loaded with no rows', () => {
    mockUseAuditLog.mockReturnValue(makeQuery({ data: { rows: [], limit: 100 } }));
    renderPage();

    expect(screen.getByText('No audit entries')).toBeInTheDocument();
    // Load succeeded => 0 is real, not a placeholder.
    expect(metricValue('Entries shown')).toBe('0');
  });
});

describe('AuditLogPage — filtering', () => {
  it('wires the actor filter to snake_case params, resets offset, and Reset/Search behave', async () => {
    const q = makeQuery({ data: { rows: ROWS, limit: 100 } });
    mockUseAuditLog.mockReturnValue(q);
    renderPage();

    fireEvent.change(screen.getByLabelText('Actor'), {
      target: { value: 'root@local' },
    });
    await waitFor(() => {
      expect(lastAuditParams().actors).toEqual(['root@local']);
    });
    expect(lastAuditParams().offset).toBe(0);

    // Reset clears the actor filter.
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    await waitFor(() => {
      expect(lastAuditParams().actors).toBeUndefined();
    });

    // Search triggers an explicit refetch.
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(q.refetch).toHaveBeenCalledTimes(1);
  });

  it('converts a valid "Since" datetime into an ISO-8601 query param (parse guard, happy path)', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Since'), {
      target: { value: '2024-06-01T08:30' },
    });
    await waitFor(() => {
      expect(lastAuditParams().since).toMatch(/^2024-06-01T\d{2}:\d{2}/);
    });
  });
});

describe('AuditLogPage — pagination', () => {
  it('disables Previous on the first page when fewer rows than the page size loaded', () => {
    renderPage();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    // 2 rows < limit(100) => no next page.
    expect(screen.getByRole('button', { name: 'Next' })).toBeDisabled();
  });

  it('advances the offset by the page size when Next is clicked on a full page', async () => {
    const fullPage: AuditLogRow[] = Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      ts: '2024-01-01T00:00:00Z',
      actor: `actor-${i}`,
      category: null,
      action: 'evt',
      entity_type: 'thing',
      entity_id: null,
      detail: null,
      trace_id: null,
      success: i % 2 === 0,
    }));
    mockUseAuditLog.mockReturnValue(makeQuery({ data: { rows: fullPage, limit: 100 } }));
    renderPage();

    const next = screen.getByRole('button', { name: 'Next' });
    expect(next).not.toBeDisabled();
    fireEvent.click(next);

    await waitFor(() => expect(lastAuditParams().offset).toBe(100));
    expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  });
});

describe('AuditLogPage — row expansion (ExpandedDetail + formatJSON)', () => {
  it('renders the drawer with IP, pretty-printed valid JSON, and raw invalid JSON', () => {
    const row: AuditLogRow = {
      id: 7,
      ts: '2024-01-01T10:00:00Z',
      actor: 'admin@local',
      category: 'config',
      action: 'update',
      entity_type: 'setting',
      entity_id: 5,
      detail: 'changed',
      ip: '192.168.1.9',
      user_agent: 'Mozilla',
      before: '{"speed":42}',
      after: 'oops-not-json',
      trace_id: 'trace-xyz-0011223344',
      prev_row_hash: 'p',
      row_hash: 'HASH-9',
      success: true,
    };
    mockUseAuditLog.mockReturnValue(makeQuery({ data: { rows: [row], limit: 100 } }));
    renderPage();

    // Collapsed by default.
    expect(screen.queryByText('192.168.1.9')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('192.168.1.9')).toBeInTheDocument();
    // formatJSON valid branch => pretty-printed with a space after the colon.
    expect(screen.getByText(/"speed": 42/)).toBeInTheDocument();
    // formatJSON invalid branch => raw passthrough.
    expect(screen.getByText('oops-not-json')).toBeInTheDocument();
    expect(screen.getByText('HASH-9')).toBeInTheDocument();
  });
});

describe('AuditLogPage — hash-chain verification', () => {
  it('shows the read-only hint and re-derives the chain on demand', async () => {
    const vq = makeQuery({ data: undefined });
    mockUseAuditChainVerify.mockReturnValue(vq);
    renderPage();

    expect(
      screen.getByText(
        'Re-derive every row_hash server-side. No data is sent or written — this is read-only.',
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Verify chain' }));
    await waitFor(() => expect(vq.refetch).toHaveBeenCalled());
  });

  it('reports an intact chain with the rows-checked count', () => {
    mockUseAuditChainVerify.mockReturnValue(
      makeQuery({
        data: { intact: true, first_bad_id: 0, rows_checked: 500, since: '', limit: 1000 },
      }),
    );
    renderPage();

    expect(screen.getByText('Chain intact')).toBeInTheDocument();
    expect(screen.getByText('500 rows checked')).toBeInTheDocument();
  });

  it('reports a broken chain and names the first bad row', () => {
    mockUseAuditChainVerify.mockReturnValue(
      makeQuery({
        data: { intact: false, first_bad_id: 7, rows_checked: 10, since: '', limit: 1000 },
      }),
    );
    renderPage();

    expect(screen.getByText('Chain broken')).toBeInTheDocument();
    expect(screen.getByText('First bad row: #7')).toBeInTheDocument();
  });

  it('surfaces a verification error and a busy button while fetching', () => {
    // Error state.
    mockUseAuditChainVerify.mockReturnValue(
      makeQuery({ error: new Error('chain verify failed') }),
    );
    const { unmount } = renderPage();
    expect(screen.getByText('Verification failed')).toBeInTheDocument();
    expect(screen.getByText('chain verify failed')).toBeInTheDocument();
    unmount();

    // Fetching state.
    mockUseAuditChainVerify.mockReturnValue(makeQuery({ isFetching: true }));
    renderPage();
    expect(screen.getByRole('button', { name: 'Verifying…' })).toBeDisabled();
  });
});
