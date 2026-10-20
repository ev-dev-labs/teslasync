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
 * The fourteen original test identities remain unchanged for preservation.
 * Their job-oriented titles are historical, not additional wire capabilities:
 * "complete" now means a persisted manifest eligible to request download;
 * "failed export" exercises a failed manifest lookup with its real diagnostic;
 * "queued" exercises an unresolved lookup, never a fabricated pending job.
 * Metadata uses the canonical manifest fields, and lifecycle assertions cover
 * creation, download and expiry only. The exact named scenario crosswalk is
 * recorded in logs/phase6-fix-gdpr-original-page-oracles.log.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, act, cleanup, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { MemoryRouter, useSearchParams } from 'react-router-dom';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui';
import { operatorConfidenceKeys } from '@/api/hooks/useOperatorConfidence';

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
          return <div {...safe}>{children}</div>;
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

const mockedRequest = vi.mocked(request);

// ── Fixtures ────────────────────────────────────────────────────────────────
const ART_A = 'artifact/a %?#é';
const ART_B = 'ARTIFACT/b %?#é';
const NOW = Date.parse('2026-06-02T10:00:00.000Z');
const EXPORT_RE = /^\/admin\/gdpr\/exports\/([^/]+)$/;

const artifactManifest: GDPRExportArtifact = {
  id: ART_A,
  export_job_id: ' job/a %?#é ',
  vehicle_id: 17,
  byte_count: 1048576,
  sha256: 'f'.repeat(64),
  storage_kind: 'local_fs',
  storage_path: 'synthetic/bundle-a.tar.gz',
  created_at: '2026-06-01T10:00:00.000Z',
  expires_at: '2026-06-08T10:00:00.000Z',
  downloaded_at: '2026-06-01T10:05:00.000Z',
  download_count: 2,
};

const artifactB: GDPRExportArtifact = {
  ...artifactManifest,
  id: ART_B,
  export_job_id: 'job-b',
  storage_kind: 's3',
  storage_path: 'synthetic/bundle-b.tar.gz',
};

const metadataPath = (id: string) => `/admin/gdpr/exports/${encodeURIComponent(id)}`;
const pagePath = (id: string) => `/admin/gdpr-exports?id=${encodeURIComponent(id)}`;
const clients: QueryClient[] = [];

/** Route `/admin/gdpr/exports/{id}` GETs to a per-id async handler. */
function wire(byId: Record<string, () => Promise<unknown>>) {
  mockedRequest.mockImplementation((path: string) => {
    const m = EXPORT_RE.exec(path);
    if (m) {
      const id = decodeURIComponent(m[1]);
      const handler = byId[id];
      if (handler) return handler().then(data => ({ data }));
      return Promise.reject(new ApiError('not found', 404));
    }
    return Promise.reject(new Error(`unexpected path: ${path}`));
  });
}

function makeClient() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, retryDelay: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
  clients.push(client);
  return client;
}

function renderPage(initialEntries: string[] = ['/admin/gdpr-exports'], extra?: ReactNode, client = makeClient()) {
  const view = render(
    <MemoryRouter initialEntries={initialEntries}>
      <QueryClientProvider client={client}>
        {extra}
        <GDPRExportPage />
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...view, client };
}

/** Sibling probe that swaps `?id=` on the shared router — simulates a
 *  same-route navigation (shared link / history) while the page is mounted. */
function NavToB() {
  const [, setSearchParams] = useSearchParams();
  return (
    <Button type="button" onClick={() => setSearchParams({ id: ART_B })}>
      nav-to-b
    </Button>
  );
}

function detailsPanel() {
  const panel = screen.getByText('Artifact details').closest('[data-print-card]');
  if (!(panel instanceof HTMLElement)) throw new Error('Artifact details panel missing');
  return panel;
}

function metadataValue(label: string) {
  const row = within(detailsPanel()).getByText(label, { selector: 'dt' }).parentElement;
  const value = row?.querySelector('dd');
  if (!(value instanceof HTMLElement)) throw new Error(`Metadata value missing: ${label}`);
  return value;
}

function expectManifestMetadata(artifact: GDPRExportArtifact) {
  for (const [label, value] of [
    ['ID', artifact.id],
    ['Export job ID', artifact.export_job_id],
    ['Vehicle ID', String(artifact.vehicle_id)],
    ['Byte count', String(artifact.byte_count)],
    ['Storage kind', artifact.storage_kind],
    ['Storage path', artifact.storage_path],
    ['Download count', String(artifact.download_count)],
    ['SHA-256', artifact.sha256],
  ] as const) {
    expect(metadataValue(label).textContent).toBe(value);
  }
  for (const [label, value] of [
    ['Created', artifact.created_at],
    ['Downloaded', artifact.downloaded_at],
    ['Expires', artifact.expires_at],
  ] as const) {
    expect(metadataValue(label).querySelector('[title]')).toHaveAttribute('title', value);
  }
  expect(detailsPanel().querySelectorAll('dt')).toHaveLength(11);
}

beforeEach(() => {
  mockedRequest.mockReset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  onlineManager.setOnline(true);
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('Real network forbidden in GDPR fixture'))));
});

afterEach(() => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  onlineManager.setOnline(true);
  vi.useRealTimers();
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  for (const [path, options] of mockedRequest.mock.calls) {
    expect(path).toMatch(EXPORT_RE);
    expect(options?.method ?? 'GET').toBe('GET');
    expect(options?.signal).toBeInstanceOf(AbortSignal);
  }
});

describe('GDPRExportPage — empty + lookup', () => {
  it('retains artifact-only scope and typed size in the actual operational brief and review drawer', async () => {
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    renderPage();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: ART_A } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    await screen.findByTestId('gdpr-export-summary');
    await waitFor(() => expect(screen.getByTestId('gdpr-export-summary').querySelector('[data-operational-metric="bytes"]')).toHaveAttribute('data-value-state', 'value'));
    const summary = screen.getByTestId('gdpr-export-summary');
    expect(summary.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(summary).toHaveAttribute('data-operational-brief');
    // The artifact-only scope moved from the face to the Review-details drawer.
    expect(summary).not.toHaveTextContent('only the selected export artifact');
    expect(summary).not.toHaveTextContent('not export-job progress or file availability');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog', { name: 'Artifact summary details' });
    expect(drawer).toHaveTextContent('only the selected export artifact');
    expect(drawer).toHaveTextContent('not export-job progress or file availability');
    expect(drawer).toHaveTextContent('selected export artifact');
    expect(screen.getByRole('link', { name: /Download bundle/i })).toBeInTheDocument();
  });

  it('shows the empty state, never fetches, and disables Refresh when no id is set', () => {
    wire({});
    renderPage();

    expect(screen.getByText('No artifact selected')).toBeInTheDocument();
    expect(
      screen.getByText(/Enter an artifact ID above to look up its manifest/),
    ).toBeInTheDocument();

    // Query is disabled without an id — no network call at all.
    expect(mockedRequest).not.toHaveBeenCalled();

    // Refresh is inert until an artifact is selected.
    expect(
      screen.getByRole('button', { name: 'Refresh artifact manifest' }),
    ).toBeDisabled();
  });

  it('fetches and paints the full surface after typing an id and clicking Look up', async () => {
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    renderPage();

    fireEvent.change(screen.getByRole('textbox'), { target: { value: `  ${ART_A}  ` } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    // The trimmed id drives the request path.
    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        metadataPath(ART_A),
        expect.anything(),
      ),
    );

    // Eligibility is manifest-derived, not an export-job status or file proof.
    expect(await screen.findByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expect(screen.getAllByText('Eligible to request download').length).toBeGreaterThan(0);
    expect(screen.getByTestId('gdpr-export-summary')).toHaveTextContent(artifactManifest.export_job_id.trim());
    expect(screen.getByText('1.00 MB')).toBeInTheDocument();
    expect(screen.getAllByText('local_fs').length).toBeGreaterThan(0);

    // Metadata panel exposes the id + sha256.
    expect(screen.getByText(ART_A)).toBeInTheDocument();
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument();
    expectManifestMetadata(artifactManifest);

    // Lifecycle timeline + metadata both surface these events; "Created" is
    // also a KPI label, so assert presence rather than uniqueness.
    expect(screen.getAllByText('Created').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Download').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Expires').length).toBeGreaterThan(0);
    expect(screen.queryByText('Completed')).toBeNull();

    // Download link carries the fully-qualified, versioned, browser-owned href.
    const downloadBtn = screen.getByRole('link', { name: /Download bundle/i });
    const anchor = downloadBtn.closest('a');
    expect(anchor).not.toBeNull();
    expect(anchor).toHaveAttribute('download');
    expect(anchor?.getAttribute('href')).toContain(
      `/api/v1/admin/gdpr/exports/${encodeURIComponent(ART_A)}/download`,
    );
    expect(screen.getByText(/An eligible request can still fail if the file is missing/)).toBeInTheDocument();
  });

  it('auto-fetches from a `?id=` deep link and mirrors the id into the input', async () => {
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    renderPage([pagePath(ART_A)]);

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        metadataPath(ART_A),
        expect.anything(),
      ),
    );
    expect(await screen.findByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ART_A);
  });
});

describe('GDPRExportPage — error branches', () => {
  it('renders the "Artifact not found" banner on a 404 and shows no download', async () => {
    wire({ [ART_A]: () => Promise.reject(new ApiError('gone', 404)) });
    renderPage([pagePath(ART_A)]);

    expect(await screen.findByText('Artifact not found')).toBeInTheDocument();
    expect(screen.getByText(/No artifact with that id exists/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Download bundle/i })).toBeNull();
    expect(screen.queryByTestId('gdpr-export-summary')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue(ART_A);
  });

  it('renders the "Subsystem unavailable" warning on a 503 (not configured)', async () => {
    wire({ [ART_A]: () => Promise.reject(new ApiError('nope', 503)) });
    renderPage([pagePath(ART_A)]);

    expect(await screen.findByText('Feature not supported')).toBeInTheDocument();
    expect(
      screen.getByText(/GDPR export subsystem is not configured/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull();
    expect(screen.queryByTestId('gdpr-export-summary')).toBeNull();
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
          : Promise.resolve({ data: artifactManifest });
      }
      return Promise.reject(new Error(`unexpected path: ${path}`));
    });
    renderPage([pagePath(ART_A)]);

    expect(await screen.findByText('Server error')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(await screen.findByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expect(screen.getByText('1.00 MB')).toBeInTheDocument();
    expect(calls).toBe(3);
  });
});

describe('GDPRExportPage — status-specific panels', () => {
  it('carries the backend error and blocks download for a failed export', async () => {
    const diagnostic = new ApiError('disk full during export', 500);
    wire({ [ART_A]: () => Promise.reject(diagnostic) });
    const { client } = renderPage([pagePath(ART_A)]);

    expect(await screen.findByText('Server error')).toBeInTheDocument();
    // The server diagnostic belongs to the query, not a nonexistent job field.
    expect(client.getQueryState(operatorConfidenceKeys.gdprExport(ART_A))?.error).toBe(diagnostic);
    expect(diagnostic.message).toBe('disk full during export');
    expect(screen.queryByRole('link', { name: /Download bundle/i })).toBeNull();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeEnabled();
    expect(screen.queryByText('Export failed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Lifecycle')).toBeNull();
    expect(screen.getByRole('textbox')).toHaveValue(ART_A);
  });

  it('shows the wait copy (and no download) while an export is queued', async () => {
    let resolveLookup: ((artifact: GDPRExportArtifact) => void) | undefined;
    wire({ [ART_A]: () => new Promise<GDPRExportArtifact>(resolve => { resolveLookup = resolve; }) });
    renderPage([pagePath(ART_A)]);
    await waitFor(() => expect(mockedRequest).toHaveBeenCalledTimes(1));

    // The loading status moved from the face to the Review-details drawer;
    // the face advertises the pending load via aria-busy + skeleton values.
    const summary = screen.getByTestId('gdpr-export-summary');
    expect(summary).toHaveAttribute('aria-busy', 'true');
    expect(summary).not.toHaveTextContent('Loading sources');
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Artifact summary details' })).toHaveTextContent('Loading sources');
    for (const title of ['Artifact details', 'Download', 'Lifecycle']) {
      expect(screen.getByRole('heading', { name: title }).closest('[data-print-card]')).toHaveAttribute('aria-busy', 'true');
    }
    expect(screen.queryByText('queued')).toBeNull();
    expect(screen.queryByText(/Download becomes available once the export completes/)).toBeNull();
    expect(screen.queryByRole('link', { name: /Download bundle/i })).toBeNull();
    expect(screen.queryByText(ART_A)).toBeNull();
    await act(async () => { resolveLookup?.(artifactManifest); });
    expect(await screen.findByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expectManifestMetadata(artifactManifest);
  });
});

describe('GDPRExportPage — url + refresh wiring', () => {
  it('retains a complete artifact, exact download link and all lifecycle details after a failed refresh rather than classifying retained data as unsupported', async () => {
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    const { client } = renderPage([pagePath(ART_A)]);
    const download = await screen.findByRole('link', { name: 'Download bundle' });
    const href = download.getAttribute('href');
    wire({ [ART_A]: () => Promise.reject(new ApiError('subsystem refresh unavailable', 503)) });
    await act(async () => { await client.refetchQueries({ type: 'active' }); });
    expect(screen.getByRole('link', { name: 'Download bundle' })).toHaveAttribute('href', href);
    expect(screen.getByText(ART_A)).toBeInTheDocument();
    expect(screen.getByText('Artifact details')).toBeInTheDocument();
    expect(screen.getByText('Lifecycle')).toBeInTheDocument();
    expect(screen.getByText('Data may be stale')).toBeInTheDocument();
    expect(screen.queryByText('Feature not supported')).toBeNull();
    expectManifestMetadata(artifactManifest);
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    const beforeRetry = mockedRequest.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Retry unavailable sources' }));
    await waitFor(() => expect(mockedRequest.mock.calls.length).toBeGreaterThan(beforeRetry));
    await waitFor(() => expect(screen.queryByText('Data may be stale')).toBeNull());
    expect(mockedRequest.mock.calls.every(call => !call[1] || !('method' in call[1]) || call[1].method === 'GET')).toBe(true);
  });
  it('re-drives the lookup and re-syncs the input when `?id=` changes in place', async () => {
    wire({
      [ART_A]: () => Promise.resolve(artifactManifest),
      [ART_B]: () => Promise.resolve(artifactB),
    });
    renderPage([pagePath(ART_A)], <NavToB />);

    await screen.findByRole('link', { name: 'Download bundle' });
    expectManifestMetadata(artifactManifest);
    expect(screen.getByRole('textbox')).toHaveValue(ART_A);

    // A same-route navigation swaps the URL id to B.
    fireEvent.click(screen.getByRole('button', { name: 'nav-to-b' }));

    await waitFor(() =>
      expect(mockedRequest).toHaveBeenCalledWith(
        metadataPath(ART_B),
        expect.anything(),
      ),
    );
    // The view follows the URL: B's distinct canonical storage/job render and the
    // input mirrors the new id (the bug this guards left both stranded on A).
    expect((await screen.findAllByText('s3')).length).toBeGreaterThan(0);
    expectManifestMetadata(artifactB);
    expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull();
    expect(screen.getByText(/Downloads are not supported for this artifact’s storage kind/)).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(ART_B);
  });

  it('refetches the active artifact when the header Refresh button is clicked', async () => {
    let artifact = artifactManifest;
    wire({ [ART_A]: () => Promise.resolve(artifact) });
    renderPage([pagePath(ART_A)]);

    await screen.findByRole('link', { name: 'Download bundle' });
    const before = mockedRequest.mock.calls.length;

    artifact = { ...artifactManifest, downloaded_at: '2026-06-02T09:00:00.000Z', download_count: 3 };
    const refresh = screen.getByRole('button', { name: 'Refresh artifact manifest' });
    expect(refresh).toBeEnabled();
    fireEvent.click(refresh);

    await waitFor(() =>
      expect(mockedRequest.mock.calls.length).toBeGreaterThan(before),
    );
    expect(mockedRequest).toHaveBeenLastCalledWith(
      metadataPath(ART_A),
      expect.anything(),
    );
    await waitFor(() => expect(metadataValue('Download count')).toHaveTextContent('3'));
    expectManifestMetadata(artifact);
  });
});

describe('GDPRExportPage — restrained caller presentation', () => {
  it('keeps the named refresh target reachable and decorative icons out of the accessibility tree', () => {
    wire({});
    const { container } = renderPage();
    const refresh = screen.getByRole('button', { name: 'Refresh artifact manifest' });
    expect(refresh).toHaveClass('min-h-11', 'min-w-11', 'shrink-0');
    expect(refresh).toBeDisabled();
    expect(refresh.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(refresh.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(container.querySelector('.lucide-hard-drive-download')).toHaveClass('h-6', 'w-6', 'shrink-0');
    expect(container.querySelector('.lucide-hard-drive-download')).toHaveAttribute('aria-hidden', 'true');
    expect(mockedRequest).not.toHaveBeenCalled();
  });

  it('contains the complete artifact panels in shrinkable responsive grids without losing metadata or download semantics', async () => {
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    renderPage([pagePath(ART_A)]);
    const download = await screen.findByRole('link', { name: 'Download bundle' });
    const details = screen.getByText('Artifact details').closest('[data-print-card]');
    const lifecycle = screen.getByText('Lifecycle').closest('[data-print-card]');
    const downloadPanel = screen.getByRole('heading', { name: 'Download' }).closest('[data-print-card]');

    expect(details).toHaveClass('min-w-0', 'xl:col-span-2');
    expect(details?.parentElement).toHaveClass('min-w-0', 'grid-cols-1', 'xl:grid-cols-3');
    expect(downloadPanel).toHaveClass('min-w-0');
    expect(lifecycle).toHaveClass('min-w-0');
    expect(lifecycle?.parentElement).toHaveClass('min-w-0', 'grid-cols-1', 'sm:grid-cols-2', 'xl:grid-cols-1');
    expect(screen.getByTestId('gdpr-export-summary').querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(screen.getByText(ART_A)).toBeInTheDocument();
    expect(screen.getByText('f'.repeat(64))).toBeInTheDocument();
    expect(download).toHaveAttribute('download');
    expect(download).toHaveAttribute('href', expect.stringContaining(`/api/v1/admin/gdpr/exports/${encodeURIComponent(ART_A)}/download`));
    expectManifestMetadata(artifactManifest);
  });
});

describe('GDPRExportPage — canonical manifest boundary coverage', () => {
  it.each([false, true])('keeps paused lookup distinct from fatal or empty with retained=%s and retry', async retained => {
    const client = makeClient();
    if (retained) client.setQueryData(operatorConfidenceKeys.gdprExport(ART_A), artifactManifest);
    wire({ [ART_A]: () => Promise.resolve(artifactManifest) });
    onlineManager.setOnline(false);
    renderPage([pagePath(ART_A)], undefined, client);
    if (retained) {
      fireEvent.click(screen.getByRole('button', { name: 'Refresh artifact manifest' }));
      await waitFor(() => expect(client.getQueryState(operatorConfidenceKeys.gdprExport(ART_A))?.fetchStatus).toBe('paused'));
      expect(await screen.findByText('Data may be stale')).toBeInTheDocument();
      expectManifestMetadata(artifactManifest);
      expect(screen.getByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    } else {
      expect(screen.getByText('Artifact lookup paused')).toBeInTheDocument();
      expect(screen.getByText(/not an export failure or an empty result/)).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull();
    }
    expect(screen.queryByText('Artifact not found')).toBeNull();
    expect(screen.queryByText('Feature not supported')).toBeNull();
    expect(mockedRequest).not.toHaveBeenCalled();
    const retry = screen.getByRole('button', { name: retained ? 'Retry unavailable sources' : 'Retry' });
    await act(async () => {
      onlineManager.setOnline(true);
      fireEvent.click(retry);
    });
    await waitFor(() => expect(mockedRequest).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryState(operatorConfidenceKeys.gdprExport(ART_A))?.fetchStatus).toBe('idle'));
    expect(await screen.findByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('Data may be stale')).toBeNull());
  });

  it('preserves measured zero byte and download counts rather than treating them as unknown', async () => {
    const zero = { ...artifactManifest, byte_count: 0, download_count: 0, downloaded_at: null };
    wire({ [ART_A]: () => Promise.resolve(zero) });
    renderPage([pagePath(ART_A)]);
    await screen.findByRole('link', { name: 'Download bundle' });
    expect(metadataValue('Byte count')).toHaveTextContent(/^0$/);
    expect(metadataValue('Download count')).toHaveTextContent(/^0$/);
    expect(metadataValue('Downloaded')).toHaveTextContent('—');
    expect(screen.getByTestId('gdpr-export-summary').querySelector('[data-operational-metric="bytes"]')).toHaveAttribute('data-value-state', 'value');
  });

  it.each([undefined, null])('keeps malformed missing byte count %s unknown rather than silently displaying zero', async byteCount => {
    wire({ [ART_A]: () => Promise.resolve({ ...artifactManifest, byte_count: byteCount }) });
    renderPage([pagePath(ART_A)]);
    await screen.findByRole('link', { name: 'Download bundle' });
    expect(metadataValue('Byte count')).toHaveTextContent(/^—$/);
    // The malformed byte count is omitted from the face (never zero-filled)...
    const summary = screen.getByTestId('gdpr-export-summary');
    expect(summary.querySelector('[data-operational-metric="bytes"]')).toBeNull();
    // ...and counted as hidden in the Review-details drawer.
    fireEvent.click(within(summary).getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog', { name: 'Artifact summary details' }))
      .toHaveTextContent('1 empty fields are hidden.');
    expect(screen.queryByText('0 B')).toBeNull();
  });

  it.each(['not-a-date', '2026-06-08T10:00:00', '2026-02-30T10:00:00Z', ''])(
    'blocks download for invalid or unzoned expiry %j without promising readiness', async expiresAt => {
      wire({ [ART_A]: () => Promise.resolve({ ...artifactManifest, expires_at: expiresAt }) });
      renderPage([pagePath(ART_A)]);
      await screen.findByText(ART_A);
      expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull();
      expect(screen.getByTestId('gdpr-export-summary')).toHaveTextContent('Download eligibility unknown');
      expect(screen.getByText(/Download eligibility is unknown because storage or a valid expiry is missing/)).toBeInTheDocument();
      expect(metadataValue('Expires').querySelector('[title]')).toHaveAttribute('title', expiresAt);
    },
  );

  it('blocks download at the expiry instant and preserves real manifest lifecycle events', async () => {
    wire({ [ART_A]: () => Promise.resolve({ ...artifactManifest, expires_at: new Date(NOW).toISOString() }) });
    renderPage([pagePath(ART_A)]);
    await screen.findByText(ART_A);
    expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull();
    expect(screen.getByTestId('gdpr-export-summary')).toHaveTextContent('Expired');
    expect(screen.getByText(/This artifact has expired and is no longer downloadable/)).toBeInTheDocument();
    expect(screen.getAllByText('Expired').length).toBeGreaterThan(1);
    expect(screen.getAllByText('Created').length).toBeGreaterThan(0);
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('accepts a valid offset expiry but does not infer support for missing storage or mismatched identity', async () => {
    const client = makeClient();
    const offset = { ...artifactManifest, expires_at: '2026-06-08T03:00:00-07:00' };
    wire({ [ART_A]: () => Promise.resolve(offset) });
    renderPage([pagePath(ART_A)], undefined, client);
    await screen.findByRole('link', { name: 'Download bundle' });
    expect(metadataValue('Expires').querySelector('[title]')).toHaveAttribute('title', offset.expires_at);
    for (const artifact of [{ ...offset, storage_kind: '' }, { ...offset, id: ART_B }]) {
      await act(async () => { client.setQueryData(operatorConfidenceKeys.gdprExport(ART_A), artifact); });
      await waitFor(() => expect(metadataValue('ID').textContent).toBe(artifact.id));
      await waitFor(() => expect(screen.queryByRole('link', { name: 'Download bundle' })).toBeNull());
      expect(screen.getByTestId('gdpr-export-summary')).toHaveTextContent('Download eligibility unknown');
      expect(metadataValue('ID').textContent).toBe(artifact.id);
      expect(screen.getByRole('textbox')).toHaveValue(ART_A);
    }
  });
});
