/**
 * AuditLogPage — behaviour + regression tests.
 *
 * The page is the dedicated surface for the `/system/audit` route. These
 * tests drive the real `useAuditLogs()` hook through a mocked `request()`
 * client (the same seam DLQInspectorPage's suite uses) so the TanStack Query
 * wiring, `safeArray` select, `useFilteredList`, and the shared DataTable +
 * SearchInput + ActiveFilterChips all execute for real.
 *
 * Coverage:
 *   1. Loading — the five skeleton rows render, the panel heading is present,
 *      and no table has mounted yet.
 *   2. Happy path — the audit table renders every column header + row, the
 *      CSV export control is reachable by its a11y name, and the hook hit the
 *      un-prefixed `/system/audit` path.
 *   3. Empty — a `[]` payload shows the "no entries" copy and mounts neither a
 *      table nor the search field.
 *   4. Error — a rejected fetch surfaces an `role="alert"` region carrying the
 *      failure message, and keeps the table unmounted.
 *   5. Search (match) — typing filters the table to matching rows, raises an
 *      active-filter chip, and the chip's remove control restores the full set.
 *   6. Search (no match) — an unmatched query swaps the table for the
 *      "no matches" copy, and "Clear all" recovers.
 *   7. REGRESSION (null-safety) — an entry whose action/resource/details/time
 *      are all null renders "—" placeholders in every cell instead of blank
 *      cells or a crash. Guards the `?? '—'` hardening in the column renderers.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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
              ['animate', 'initial', 'exit', 'transition', 'whileHover', 'whileTap', 'whileInView', 'variants', 'layout'].includes(
                k,
              )
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

// ── API client: mock only `request`; keep the real ApiError so the hook's
//    error surfaces with a genuine Error instance. ───────────────────────────
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request, ApiError } from '@/api/client';
import AuditLogPage from './AuditLogPage';
import type { AuditLogEntry } from '@/types/admin';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────
const AUDIT: AuditLogEntry[] = [
  {
    id: '1',
    action: 'settings.update',
    resource: 'config/theme',
    details: 'Changed theme to neon-cyan',
    createdAt: '2026-06-01T10:00:00.000Z',
  },
  {
    id: '2',
    action: 'apikey.revoke',
    resource: 'auth/apikey',
    details: 'Revoked key kp_9f2',
    createdAt: '2026-06-02T11:00:00.000Z',
  },
];

const SEARCH_PLACEHOLDER = /search by action/i;

function renderPage() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
    },
  });
  return render(
    <MemoryRouter>
      <QueryClientProvider client={client}>
        <AuditLogPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
  localStorage.clear();
});

describe('AuditLogPage — data states', () => {
  it('renders five skeleton rows while the audit fetch is in flight', () => {
    // A never-resolving fetch keeps the query in its loading state.
    mockedRequest.mockReturnValue(new Promise<AuditLogEntry[]>(() => {}));
    const { container } = renderPage();

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    expect(screen.getByRole('heading', { name: 'Recent Activity' })).toBeInTheDocument();
    // No table has mounted yet — skeletons stand in for it.
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the audit table (headers + rows + export) from the payload', async () => {
    mockedRequest.mockResolvedValue(AUDIT);
    renderPage();

    // Every row surfaces once the fetch resolves.
    expect(await screen.findByText('settings.update')).toBeInTheDocument();
    expect(screen.getByText('apikey.revoke')).toBeInTheDocument();
    expect(screen.getByText('config/theme')).toBeInTheDocument();
    expect(screen.getByText('Revoked key kp_9f2')).toBeInTheDocument();

    // All four columns render as real <th> column headers.
    for (const header of ['Time', 'Action', 'Resource', 'Details']) {
      expect(screen.getByRole('columnheader', { name: header })).toBeInTheDocument();
    }

    // CSV export is reachable by its accessible name (icon-only control).
    expect(screen.getByRole('button', { name: 'Download table as CSV' })).toBeInTheDocument();

    // The hook hits the un-prefixed path (request() adds /api/v1).
    expect(mockedRequest).toHaveBeenCalledWith('/system/audit', expect.anything());
  });

  it('shows the empty-state copy and no controls when the payload is empty', async () => {
    mockedRequest.mockResolvedValue([]);
    renderPage();

    expect(await screen.findByText('No audit entries found')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    // Search + export chrome only appears once there is data to filter.
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Download table as CSV' })).toBeNull();
  });

  it('announces a fetch failure through a role="alert" region', async () => {
    mockedRequest.mockRejectedValue(new ApiError('backend exploded', 500));
    renderPage();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Failed to load audit logs');
    expect(alert).toHaveTextContent('backend exploded');
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('AuditLogPage — search + filter chips', () => {
  it('filters the table to matching rows and clears via the chip remove control', async () => {
    mockedRequest.mockResolvedValue(AUDIT);
    renderPage();
    await screen.findByText('settings.update');

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'theme' } });

    // Debounced filter drops the non-matching row and raises a chip.
    await waitFor(() => expect(screen.queryByText('apikey.revoke')).toBeNull());
    expect(screen.getByText('settings.update')).toBeInTheDocument();
    const removeChip = screen.getByRole('button', { name: 'Remove filter Search' });
    expect(removeChip).toBeInTheDocument();

    // Removing the chip restores the full result set.
    fireEvent.click(removeChip);
    expect(await screen.findByText('apikey.revoke')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove filter Search' })).toBeNull();
  });

  it('swaps the table for the no-matches copy and recovers via "Clear all"', async () => {
    mockedRequest.mockResolvedValue(AUDIT);
    renderPage();
    await screen.findByText('settings.update');

    const input = screen.getByPlaceholderText(SEARCH_PLACEHOLDER);
    fireEvent.change(input, { target: { value: 'zzz-no-such-entry' } });

    expect(await screen.findByText('No audit entries match your search.')).toBeInTheDocument();
    expect(screen.queryByText('settings.update')).toBeNull();
    expect(screen.queryByRole('table')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(await screen.findByText('settings.update')).toBeInTheDocument();
    expect(screen.queryByText('No audit entries match your search.')).toBeNull();
  });
});

describe('AuditLogPage — null safety', () => {
  it('renders "—" placeholders for null action/resource/details/time cells', async () => {
    // Backend audit rows can legitimately carry null resource/details even
    // though the TS type narrows them to string — the column renderers must
    // fall back to the "—" placeholder rather than emitting blank cells.
    const nullEntry = {
      id: '9',
      action: null,
      resource: null,
      details: null,
      createdAt: null,
    } as unknown as AuditLogEntry;
    mockedRequest.mockResolvedValue([nullEntry]);
    renderPage();

    await screen.findByRole('table');
    // Four cells (time, action, resource, details) each collapse to "—".
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(4);
    // The page did not crash — its heading is still present.
    expect(screen.getByRole('heading', { name: 'Recent Activity' })).toBeInTheDocument();
  });
});
