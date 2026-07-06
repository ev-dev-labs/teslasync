/**
 * GDPRExportPage — behaviour + regression tests.
 *
 * The page is the operator surface for the read-only
 * `GET /admin/gdpr/exports/{id}` route (see
 * internal/handler/v1/gdpr_export_handler.go). These tests drive the
 * `useGDPRExport` hook through a mocked `request()` client — the same seam
 * DLQInspectorPage's suite uses — so the real TanStack Query wiring, the
 * four gdpr-export sub-components, the KPI band, and every error branch all
 * execute.
 *
 * Coverage:
 *   1. No `?id=` → the "no artifact selected" empty state renders, the query
 *      never fires, and Refresh is disabled.
 *   2. Lookup flow — typing an id + clicking "Look up" fetches the artifact
 *      and paints the whole surface: status badge, format/size/storage KPIs,
 *      the download link (with the fully-qualified /api/v1 href), the metadata
 *      panel, and the lifecycle timeline.
 *   3. Deep link — a `?id=` on mount auto-fetches and mirrors the id into the
 *      input.
 *   4. 404 → the "Artifact not found" danger banner (no KPI band).
 *   5. 503 → the "Subsystem unavailable" warning banner (SUBSYSTEM_NOT_CONFIGURED).
 *   6. 5xx → a recoverable QueryError; Retry refetches and the artifact paints.
 *   7. `failed` status → the "Export failed" banner carries the backend error,
 *      the download panel explains no bundle is available, and the lifecycle
 *      shows a "Failed" event.
 *   8. `queued` status → the download panel shows the "becomes available once
 *      complete" wait copy and offers no download link.
 *   9. REGRESSION — an external `?id=` change while the page stays mounted
 *      (shared link / back-forward nav) re-drives the lookup and re-syncs the
 *      input. Guards the URL-as-source-of-truth fix (previously the view was
 *      stranded on the id read at mount).
 *  10. Refresh — the header button refetches the active artifact.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
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

// ── API client: mock only `request`; keep the real apiUrl / ApiError /
//    isApiError so the download URL builder + error classification run honestly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: vi.fn() };
});

import { request, ApiError } from '@/api/client';
import GDPRExportPage from './GDPRExportPage';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

const mockedRequest = request as unknown as ReturnType<typeof vi.fn>;

// ── Fixtures ────────────────────────────────────────────────────────────────
const ART_A = 'artifact-a-1111';
const ART_B = 'artifact-b-2222';
const EXPORT_RE = /^\/admin\/gdpr\/exports\/([^/]+)$/;

const completeArtifact: GDPRExportArtifact = {
  id: ART_A,
  user_id: 'gdpr-user@example.com',
  status: 'complete',
  format: 'zip',
  bytes: 1048576, // → "1.0 MB"
  sha256: 'f'.repeat(64),
  storage: 's3',
  created_at: '2026-06-01T10:00:00.000Z',
  completed_at: '2026-06-01T10:05:00.000Z',
  expires_at: '2026-06-08T10:00:00.000Z',
  error: null,
};

const artifactB: GDPRExportArtifact = {
  ...completeArtifact,
  id: ART_B,
  format: 'json',
  storage: 'gcs',
};

const failedArtifact: GDPRExportArtifact = {
  id: ART_A,
  user_id: 'gdpr-user@example.com',
  status: 'failed',
  format: 'zip',
  bytes: null,
  sha256: null,
  storage: 'local',
  created_at: '2026-06-01T10:00:00.000Z',
  completed_at: null,
  expires_at: null,
  error: 'disk full during export',
};

const queuedArtifact: GDPRExportArtifact = {
  id: ART_A,
  user_id: null,
  status: 'queued',
  format: 'zip',
  bytes: null,
  sha256: null,
  storage: null,
  created_at: '2026-06-01T10:00:00.000Z',
  completed_at: null,
  expires_at: null,
  error: null,
};

/** Route `/admin/gdpr/exports/{id}` GETs to a per-id async handler. */
function wire(byId: Record<string, () => Promise<unknown>>) {
  mockedRequest.mockImplementation((path: string) => {
    const m = EXPORT_RE.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const handler = byId[id];
      if (handler) return handler();
      return Promise.reject(new ApiError('not found', 404));
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

function makeClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderPage(initialEntries: string[] = ['/admin/gdpr-exports'], extra?: ReactNode) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={makeClient()}>
        {extra}
        <GDPRExportPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

/** Sibling probe that swaps `?id=` on the shared router — simulates a
 *  same-route navigation (shared link / history) while the page is mounted. */
function NavToB() {
  const [, setSearchParams] = useSearchParams();
  return (
    <button type="button" onClick={() => setSearchParams({ id: ART_B })}>
      nav-to-b
    </button>
  );
}

beforeEach(() => {
  mockedRequest.mockReset();
});

describe('GDPRExportPage — empty + lookup', () => {
  it('shows the empty state, never fetches, and disables Refresh when no id is set', () => {
    wire({});
    renderPage();

    expect(screen.getByText('No artifact selected')).toBeInTheDocument();
    expect(
      screen.getByText(/Enter an artifact ID above to look up its status/),
    ).toBeInTheDocument();

    // Query is disabled without an id — no network call at all.
    expect(mockedRequest).not.toHaveBeenCalled();

    // Refresh is inert until an artifact is selected.
    expect(
      screen.getByRole('button', { name: 'Refresh artifact status' }),
    ).toBeDisabled();
  });

  it('fetches and paints the full surface after typing an id and clicking Look up', async () => {
    wire({ [ART_A]: () => Promise.resolve(completeArtifact) });
    renderPage();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: `  ${ART_A}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    // The trimmed id drives the request path.
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        `/admin/gdpr/exports/${ART_A}`,
        expect.anything(),
      ),
    );

    // Status badge + KPI values.
    expect(await screen.findByText('complete')).toBeInTheDocument();
    expect(screen.getByText('zip')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
    expect(screen.getByText('s3')).toBeInTheDocument();

    // Metadata panel exposes the id + sha256.
    expect(screen.getByText(ART_A)).toBeInTheDocument();
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument();

    // Lifecycle timeline + metadata both surface these events; "Created" is
    // also a KPI label, so assert presence rather than uniqueness.
    expect(screen.getAllByText('Created').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Completed').length).toBeGreaterThan(0);

    // Download link carries the fully-qualified, versioned, browser-owned href.
    const downloadBtn = screen.getByRole('link', { name: /Download bundle/i });
    const anchor = downloadBtn.closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor?.getAttribute('href')).toContain(
      `/api/v1/admin/gdpr/exports/${ART_A}/download`,
    );
  });

  it('auto-fetches from a `?id=` deep link and mirrors the id into the input', async () => {
    wire({ [ART_A]: () => Promise.resolve(completeArtifact) });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        `/admin/gdpr/exports/${ART_A}`,
        expect.anything(),
      ),
    );
    expect(await screen.findByText('complete')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ART_A);
  });
});

describe('GDPRExportPage — error branches', () => {
  it('renders the "Artifact not found" banner on a 404 and shows no download', async () => {
    wire({ [ART_A]: () => Promise.reject(new ApiError('gone', 404)) });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    expect(await screen.findByText('Artifact not found')).toBeInTheDocument();
    expect(screen.getByText(/No artifact with that id exists/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download bundle/i })).toBeNull();
  });

  it('renders the "Subsystem unavailable" warning on a 503 (not configured)', async () => {
    wire({ [ART_A]: () => Promise.reject(new ApiError('nope', 503)) });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    expect(await screen.findByText('Subsystem unavailable')).toBeInTheDocument();
    expect(
      screen.getByText(/GDPR export subsystem is not configured/),
    ).toBeInTheDocument();
  });

  it('surfaces a recoverable QueryError on a 5xx and repaints the artifact on Retry', async () => {
    let calls = 0;
    mockedRequest.mockImplementation((path: string) => {
      if (EXPORT_RE.test(path)) {
        calls += 1;
        // Initial attempt + the hook's single retry both fail; the manual
        // Retry (a fresh fetch cycle) then succeeds.
        return calls <= 2
          ? Promise.reject(new ApiError('boom', 500))
          : Promise.resolve(completeArtifact);
      }
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    expect(await screen.findByText('Server error')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByText('complete')).toBeInTheDocument();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();
  });
});

describe('GDPRExportPage — status-specific panels', () => {
  it('carries the backend error and blocks download for a failed export', async () => {
    wire({ [ART_A]: () => Promise.resolve(failedArtifact) });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    expect(await screen.findByText('Export failed')).toBeInTheDocument();
    // The backend error is echoed by both the banner and the lifecycle entry.
    expect(screen.getAllByText('disk full during export').length).toBeGreaterThan(0);
    expect(screen.getByText('failed')).toBeInTheDocument();

    // No download link; the panel explains why.
    expect(screen.queryByRole('link', { name: /Download bundle/i })).toBeNull();
    expect(screen.getByText(/No bundle available/)).toBeInTheDocument();

    // Lifecycle records the failure.
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('shows the wait copy (and no download) while an export is queued', async () => {
    wire({ [ART_A]: () => Promise.resolve(queuedArtifact) });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    expect(await screen.findByText('queued')).toBeInTheDocument();
    expect(
      screen.getByText(/Download becomes available once the export completes/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download bundle/i })).toBeNull();
  });
});

describe('GDPRExportPage — url + refresh wiring', () => {
  it('re-drives the lookup and re-syncs the input when `?id=` changes in place', async () => {
    wire({
      [ART_A]: () => Promise.resolve(completeArtifact),
      [ART_B]: () => Promise.resolve(artifactB),
    });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`], <NavToB />);

    // Artifact A is loaded first (s3 storage, zip format).
    expect(await screen.findByText('s3')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ART_A);

    // A same-route navigation swaps the URL id to B.
    fireEvent.click(screen.getByRole('button', { name: 'nav-to-b' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        `/admin/gdpr/exports/${ART_B}`,
        expect.anything(),
      ),
    );
    // The view follows the URL: B's distinct storage/format render and the
    // input mirrors the new id (the bug this guards left both stranded on A).
    expect(await screen.findByText('gcs')).toBeInTheDocument();
    expect(screen.getByText('json')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ART_B);
  });

  it('refetches the active artifact when the header Refresh button is clicked', async () => {
    wire({ [ART_A]: () => Promise.resolve(completeArtifact) });
    renderPage([`/admin/gdpr-exports?id=${ART_A}`]);

    await screen.findByText('complete');
    const before = mockedRequest.mock.calls.length;

    const refresh = screen.getByRole('button', { name: 'Refresh artifact status' });
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    );
    expect(mockedRequest).toHaveBeenLastCalledWith(
      `/admin/gdpr/exports/${ART_A}`,
      expect.anything(),
    );
  });
});
