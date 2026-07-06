/**
 * IncidentTimelinePage — contract + hardening tests.
 *
 * IncidentTimelinePage is the per-incident post-mortem orchestrator at
 * /system-status/incidents/:id. It owns:
 *   - route `:id` → positive-numeric-id parsing (invalid / 0 / negative → null),
 *   - the load / error / not-found / loaded render branches,
 *   - the KPI band, hero overview, details panel, timeline, and append-update
 *     bento (or a resolved-state placeholder),
 *   - the "Resolve" close-out flow (confirm dialog → PATCH → toast), and
 *   - wiring the self-gated AI summarizer with the loaded incident id.
 *
 * The incidents data layer (`useIncident` / `usePatchIncident` /
 * `useAppendIncidentUpdate`) is mocked so every branch can be driven
 * deterministically without touching the network — the same hook-seam the
 * sibling `TestIncidentTimelineAIOffShowsRawTimelineOnly` test uses. The heavy,
 * self-gated `AIIncidentTimelineSummarizer` child is stubbed with a
 * prop-capturing marker so the page's own behaviour is isolated (and its
 * `incidentId` wiring is asserted) without mounting the AI SSE subtree.
 *
 * `react-i18next` is stubbed to return the `defaultValue` fallback so visible
 * copy stays English. `@testing-library/user-event` is intentionally not used —
 * it is not a dependency of this repo — interactions go through `fireEvent`.
 * The global `test-setup.ts` already stubs `useSettings` (ai_mode='off') and
 * `useTimezone`, so `useDateFormat` resolves without a vehicle/query provider.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { ReactNode } from 'react';

// i18n stub: `t(key, 'Fallback', { var })` → the fallback, interpolating any
// {{var}} tokens; `t(key, { defaultValue })` → the defaultValue. Keeps the
// asserted copy English + deterministic regardless of i18n init state.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
      if (typeof fallbackOrOpts === 'string') {
        if (opts && typeof opts === 'object') {
          const o = opts as Record<string, unknown>;
          return fallbackOrOpts.replace(/{{(\w+)}}/g, (_m, name: string) =>
            name in o ? String(o[name]) : `{{${name}}}`,
          );
        }
        return fallbackOrOpts;
      }
      if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
        const o = fallbackOrOpts as Record<string, unknown>;
        if (typeof o.defaultValue === 'string') return o.defaultValue;
      }
      return key;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The AI summarizer is a heavy, self-gated SSE child (covered by its own
// sibling tests). Stub it with a prop-capturing marker so the page's
// `incidentId={incident.id}` wiring can be asserted without mounting it.
vi.mock('@/components/ai/AIIncidentTimelineSummarizer', () => ({
  AIIncidentTimelineSummarizer: ({
    incidentId,
  }: {
    incidentId?: string | number;
  }) => (
    <div data-testid="ai-summarizer-stub" data-incident-id={String(incidentId)} />
  ),
}));

vi.mock('@/api/hooks/useIncidents', () => ({
  useIncident: vi.fn(),
  usePatchIncident: vi.fn(),
  useAppendIncidentUpdate: vi.fn(),
}));

import {
  useIncident,
  usePatchIncident,
  useAppendIncidentUpdate,
  type Incident,
} from '@/api/hooks/useIncidents';
import { ToastProvider } from '@/components/feedback/Toast';
import IncidentTimelinePage from './IncidentTimelinePage';

const mockUseIncident = useIncident as unknown as ReturnType<typeof vi.fn>;
const mockUsePatchIncident =
  usePatchIncident as unknown as ReturnType<typeof vi.fn>;
const mockUseAppendIncidentUpdate =
  useAppendIncidentUpdate as unknown as ReturnType<typeof vi.fn>;

// ── fixtures ──────────────────────────────────────────────────────────────

function baseIncident(overrides?: Partial<Incident>): Incident {
  return {
    id: 7,
    title: 'API gateway intermittent 502s',
    description:
      'Customers report bursty 502 responses from the public API gateway.',
    severity: 'major',
    status: 'monitoring',
    source: 'auto',
    affected_components: ['api-gateway', 'edge-cache'],
    started_at: '2025-03-12T14:05:00Z',
    resolved_at: undefined,
    created_at: '2025-03-12T14:05:00Z',
    updated_at: '2025-03-12T14:35:00Z',
    created_by: 'oncall-bot',
    updates: [
      {
        at: '2025-03-12T14:07:00Z',
        status: 'investigating',
        message: 'PagerDuty fired alert api-gateway-5xx-burst.',
        author: 'oncall-bot',
      },
      {
        at: '2025-03-12T14:18:00Z',
        status: 'identified',
        message: 'Root cause: rolling restart on edge-cache fleet.',
        author: 'sre-jane',
      },
      {
        at: '2025-03-12T14:35:00Z',
        status: 'monitoring',
        message: 'Restart completed. Watching error rate before resolving.',
        author: 'sre-jane',
      },
    ],
    ...overrides,
  };
}

/** A resolved TanStack-Query-shaped result the page can consume + forward to
 *  PageContainer's `query` (DataFreshness) prop. */
function loadedQuery(data: Incident | undefined) {
  return {
    data,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
  };
}

function renderAt(path = '/system-status/incidents/7') {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              path="/system-status/incidents/:id"
              element={<IncidentTimelinePage />}
            />
            <Route
              path="/system-status"
              element={<div>System Status Home</div>}
            />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUseIncident.mockReset();
  mockUsePatchIncident.mockReset();
  mockUseAppendIncidentUpdate.mockReset();

  // Sensible defaults; individual tests override the mutation state.
  mockUsePatchIncident.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  });
  mockUseAppendIncidentUpdate.mockReturnValue({
    mutateAsync: vi.fn().mockResolvedValue(undefined),
    isPending: false,
  });
});

describe('IncidentTimelinePage', () => {
  it('parses the route :id into a positive numeric id (invalid / 0 / negative → null)', () => {
    mockUseIncident.mockReturnValue(loadedQuery(undefined));

    const good = renderAt('/system-status/incidents/7');
    expect(mockUseIncident).toHaveBeenLastCalledWith(7);
    good.unmount();

    mockUseIncident.mockClear();
    const bad = renderAt('/system-status/incidents/not-a-number');
    expect(mockUseIncident).toHaveBeenLastCalledWith(null);
    bad.unmount();

    mockUseIncident.mockClear();
    const zero = renderAt('/system-status/incidents/0');
    expect(mockUseIncident).toHaveBeenLastCalledWith(null);
    zero.unmount();

    mockUseIncident.mockClear();
    renderAt('/system-status/incidents/-4');
    expect(mockUseIncident).toHaveBeenLastCalledWith(null);
  });

  it('renders the loading skeletons with a Back action and no incident content', () => {
    mockUseIncident.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
      refetch: vi.fn(),
    });

    renderAt();

    expect(screen.getByText(/Loading incident/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Back/i }),
    ).toBeInTheDocument();
    // No resolved incident yet → the title/append-form must be absent.
    expect(
      screen.queryByText('API gateway intermittent 502s'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Resolve' }),
    ).not.toBeInTheDocument();
  });

  it('renders a retryable error state when the query fails', () => {
    const refetch = vi.fn();
    mockUseIncident.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('boom: upstream down'),
      refetch,
    });

    renderAt();

    // A generic (non-ApiError) failure lands on the network/unknown branch
    // with an actionable Retry CTA wired to refetch().
    const retry = screen.getByRole('button', { name: /Retry/i });
    expect(retry).toBeInTheDocument();
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);

    // The error branch must win over the not-found empty state.
    expect(
      screen.queryByText(/Incident not found/i),
    ).not.toBeInTheDocument();
  });

  it('renders the not-found empty state with a back-to-list link when there is no incident and no error', () => {
    mockUseIncident.mockReturnValue(loadedQuery(undefined));

    renderAt();

    expect(screen.getByText(/Incident not found/i)).toBeInTheDocument();
    const link = screen.getByRole('link', {
      name: /Back to System Status/i,
    });
    expect(link).toHaveAttribute('href', '/system-status');
  });

  it('renders the KPI band, subtitle, and wires the AI summarizer with the incident id', () => {
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    // Subtitle carries the id prefix.
    expect(screen.getByText(/Incident #7/)).toBeInTheDocument();

    // The KPI band is an accessible region carrying every metric label.
    const kpis = screen.getByRole('region', { name: 'Incident metrics' });
    for (const label of [
      'Status',
      'Duration',
      'Updates',
      'Affected',
      'Source',
      'Started',
    ]) {
      expect(within(kpis).getByText(label)).toBeInTheDocument();
    }
    // Source value is surfaced verbatim inside the band.
    expect(within(kpis).getByText('auto')).toBeInTheDocument();

    // The self-gated AI child receives the loaded incident id.
    expect(screen.getByTestId('ai-summarizer-stub')).toHaveAttribute(
      'data-incident-id',
      '7',
    );
  });

  it('renders the hero overview (severity, status, description, affected) with a Resolve control for open incidents', () => {
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    expect(screen.getByText('Major')).toBeInTheDocument();
    expect(screen.getAllByText('Monitoring').length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Customers report bursty 502 responses/),
    ).toBeInTheDocument();
    // Affected components render as a joined, human-readable list.
    expect(
      screen.getByText('api-gateway, edge-cache'),
    ).toBeInTheDocument();
    // Open incident → the resolve close-out control is present.
    expect(
      screen.getByRole('button', { name: 'Resolve' }),
    ).toBeInTheDocument();
  });

  it('renders every timeline update newest-first and the append-update form for open incidents', () => {
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(3);

    // Every message is rendered.
    const newest = screen.getByText(/Restart completed\./);
    const oldest = screen.getByText(/PagerDuty fired alert/);
    expect(screen.getByText(/Root cause: rolling restart/)).toBeInTheDocument();

    // Newest-first: the 14:35 update precedes the 14:07 update in the DOM.
    expect(
      newest.compareDocumentPosition(oldest) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // The append-update form is available while the incident is open.
    expect(
      screen.getByPlaceholderText(/What's new\?/i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Add update/i }),
    ).toBeInTheDocument();
  });

  it('replaces the append-update form and hides Resolve once the incident is resolved', () => {
    mockUseIncident.mockReturnValue(
      loadedQuery(
        baseIncident({
          status: 'resolved',
          resolved_at: '2025-03-12T15:00:00Z',
        }),
      ),
    );

    renderAt();

    // Resolve control is gone — resolving is a one-way close-out.
    expect(
      screen.queryByRole('button', { name: 'Resolve' }),
    ).not.toBeInTheDocument();
    // The append form is swapped for a resolved-state placeholder.
    expect(screen.getByText('Incident resolved')).toBeInTheDocument();
    expect(
      screen.queryByPlaceholderText(/What's new\?/i),
    ).not.toBeInTheDocument();
  });

  it('resolves an incident: confirm dialog → PATCH { resolved: true } → success toast → dialog closes', async () => {
    const mutateAsync = vi
      .fn()
      .mockResolvedValue(
        baseIncident({ status: 'resolved', resolved_at: '2025-03-12T15:00:00Z' }),
      );
    mockUsePatchIncident.mockReturnValue({ mutateAsync, isPending: false });
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));

    // The confirm dialog opens.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/Resolve incident\?/i)).toBeInTheDocument();

    // Confirm inside the dialog (there are now two "Resolve" buttons — scope it).
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    await waitFor(() =>
      expect(mutateAsync).toHaveBeenCalledWith({
        id: 7,
        payload: { resolved: true },
      }),
    );
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    // Success toast surfaces and the dialog closes.
    await waitFor(() =>
      expect(screen.getByText('Incident resolved.')).toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
  });

  it('does not mutate when the resolve confirm dialog is cancelled', async () => {
    const mutateAsync = vi.fn().mockResolvedValue(undefined);
    mockUsePatchIncident.mockReturnValue({ mutateAsync, isPending: false });
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: /Cancel/i }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mutateAsync).not.toHaveBeenCalled();
  });

  it('surfaces an error toast and keeps the dialog open when resolving fails', async () => {
    const mutateAsync = vi.fn().mockRejectedValue(new Error('patch failed'));
    mockUsePatchIncident.mockReturnValue({ mutateAsync, isPending: false });
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    fireEvent.click(screen.getByRole('button', { name: 'Resolve' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Resolve' }));

    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // Failure copy is surfaced (assertive alert toast).
    await waitFor(() =>
      expect(screen.getByText('patch failed')).toBeInTheDocument(),
    );
    // The dialog stays open so the operator can retry.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('disables the Resolve control while a patch mutation is pending', () => {
    mockUsePatchIncident.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: true,
    });
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    expect(screen.getByRole('button', { name: 'Resolve' })).toBeDisabled();
  });

  it('is null-safe when updates and affected_components are missing', () => {
    mockUseIncident.mockReturnValue(
      loadedQuery(
        baseIncident({
          updates: undefined,
          affected_components: undefined,
        }),
      ),
    );

    renderAt();

    // No timeline items, and each surface shows its own empty placeholder
    // rather than a blank panel or a crash.
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(
      screen.getByText(/No updates recorded yet/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/None recorded/i)).toBeInTheDocument();
    // The page still mounted its header.
    expect(screen.getByText(/Incident #7/)).toBeInTheDocument();
  });

  it('exposes the three primary content sections as accessible landmark regions', () => {
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    expect(
      screen.getByRole('region', { name: 'Incident metrics' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Incident overview and details' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('region', { name: 'Incident timeline and updates' }),
    ).toBeInTheDocument();
  });

  it('navigates back to /system-status when the Back action is clicked', () => {
    mockUseIncident.mockReturnValue(loadedQuery(baseIncident()));

    renderAt();

    fireEvent.click(screen.getByRole('button', { name: /Back/i }));
    expect(screen.getByText('System Status Home')).toBeInTheDocument();
  });
});
