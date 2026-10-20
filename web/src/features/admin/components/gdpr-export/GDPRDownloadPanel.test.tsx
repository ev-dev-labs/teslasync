/**
 * GDPRDownloadPanel — download-action panel for a single GDPR export artifact.
 *
 * The component is purely presentational: it takes an optional `artifact`, a
 * `downloadUrl` (already fully-qualified by the parent), plus `loading` /
 * `className`, and renders exactly one of three mutually-exclusive branches:
 *
 *   loading (and no artifact yet) → skeleton placeholders (never a blank panel)
 *   downloadUrl present           → a hint + a single download control
 *   otherwise                     → a manifest-aware caption explaining why the
 *                                   bundle can't be downloaded yet
 *
 * Coverage for the sole export (`GDPRDownloadPanel`):
 *   1. Download-available — the hint copy + a single, correctly-wired download
 *      control (href, `download` attr, accessible name, aria-hidden icon).
 *   2. a11y regression guard — the download control is ONE anchor and NOT a
 *      <button> nested inside an <a> (the fix: `nested-interactive` produced two
 *      tab stops for a single action). Keyboard-focusable + click dispatches.
 *   3. downloadUrl precedence — a non-null URL wins even over an inconsistent
 *      expired manifest (the parent-supplied URL is the source of truth).
 *   4. Original job-scenario crosswalk (names retained, no job fields invented):
 *      queued → valid local_fs manifest, but no eligible parent href;
 *      running → unknown storage/expiry metadata;
 *      failed → unsupported storage kind, not evidence of a failed export;
 *      expired → real expires_at boundary;
 *      complete-without-url → valid manifest without file-availability proof;
 *      no-artifact → missing lookup result.
 *   5. Loading — skeletons on first load; but a background refetch (artifact
 *      already present) keeps the resolved content, never a skeleton.
 *   6. Structure — the panel heading is always present and `className` is
 *      forwarded to the GlassPanel root.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

// Deterministic i18n: `t(key, default, opts)` returns the default string (with
// any `{{token}}` interpolated) so assertions never depend on the shipped
// translation catalogue. Mirrors the convention in the sibling gdpr-export /
// gas-price tests.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, opts?: unknown) => {
        if (typeof fallbackOrOpts === 'string') {
          if (opts && typeof opts === 'object') {
            const o = opts as Record<string, unknown>;
            return fallbackOrOpts.replace(/{{(\w+)}}/g, (_, name) =>
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
  };
});

import { GDPRDownloadPanel } from './GDPRDownloadPanel';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

const DOWNLOAD_URL =
  'http://localhost:8080/api/v1/admin/gdpr/exports/exp_123/download';
const NOW = Date.parse('2026-01-01T01:00:00Z');
const UNAVAILABLE_CAPTION =
  'No eligible download link was supplied. Refresh the artifact manifest; metadata does not confirm that the stored file is available.';
const UNKNOWN_CAPTION =
  'Download eligibility is unknown because storage or a valid expiry is missing. Refresh the artifact manifest to check its metadata.';
const MISSING_CAPTION =
  'No artifact result is available. Look up an artifact or retry the lookup to inspect download eligibility.';

function makeArtifact(over: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact {
  return {
    id: 'exp_123',
    export_job_id: 'job_123',
    vehicle_id: 4,
    storage_kind: 'local_fs',
    storage_path: 'synthetic/exp_123.zip',
    sha256: 'a'.repeat(64),
    byte_count: 1024,
    created_at: '2026-01-01T00:00:00Z',
    expires_at: '2026-01-02T00:00:00Z',
    download_count: 0,
    ...over,
  };
}

interface RenderProps {
  artifact?: GDPRExportArtifact;
  downloadUrl?: string | null;
  loading?: boolean;
  className?: string;
  now?: number;
}

function renderPanel(props: RenderProps = {}) {
  return render(
    <GDPRDownloadPanel
      artifact={props.artifact}
      downloadUrl={props.downloadUrl ?? null}
      loading={props.loading}
      className={props.className}
      now={props.now ?? NOW}
    />,
  );
}

/** The rendered GlassPanel root (a div tagged with data-print-card). */
function panelRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector<HTMLElement>('[data-print-card]');
  if (!root) throw new Error('panel root not found');
  return root;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe('GDPRDownloadPanel — download available', () => {
  it('renders the hint and a single, correctly-wired download control', () => {
    const { container } = renderPanel({
      artifact: makeArtifact(),
      downloadUrl: DOWNLOAD_URL,
    });

    // Panel heading (i18n default) is always present.
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();

    // The explanatory hint copy renders.
    expect(
      screen.getByText(/bundle streams from the backend/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/file is missing.*best effort, not a durable audit record/i))
      .toBeInTheDocument();

    // Exactly one interactive control: an <a> that points at the bundle.
    const link = screen.getByRole('link', { name: 'Download bundle' });
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(DOWNLOAD_URL);
    expect(link.hasAttribute('download')).toBe(true);

    // The leading icon is decorative and hidden from assistive tech.
    const icon = link.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');

    // No "can't download yet" caption while a URL is present.
    expect(
      screen.queryByText(UNAVAILABLE_CAPTION),
    ).toBeNull();
    // And no skeleton placeholder.
    expect(panelRoot(container).querySelector(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toBeNull();
  });

  it('exposes ONE anchor and ZERO buttons (nested-interactive a11y fix)', () => {
    const { container } = renderPanel({
      artifact: makeArtifact(),
      downloadUrl: DOWNLOAD_URL,
    });

    // The regression this guards: the control used to be a <button> wrapped in
    // an <a>, producing two focus stops + an axe `nested-interactive` error.
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('is keyboard-focusable and dispatches a click when activated', () => {
    renderPanel({ artifact: makeArtifact(), downloadUrl: DOWNLOAD_URL });
    const link = screen.getByRole('link', { name: 'Download bundle' });

    // Keyboard operability: the single control is reachable + focusable.
    link.focus();
    expect(link).toHaveFocus();

    // Activating it fires a real click. Navigation is prevented so jsdom does
    // not attempt an unimplemented navigation.
    const onClick = vi.fn((event: Event) => event.preventDefault());
    link.addEventListener('click', onClick);
    // Measure only activation's scheduling delta, after render and focus.
    const timeout = vi.spyOn(globalThis, 'setTimeout');
    const interval = vi.spyOn(globalThis, 'setInterval');
    const timeoutBaseline = timeout.mock.calls.length;
    const intervalBaseline = interval.mock.calls.length;
    expect(fireEvent.click(link)).toBe(false);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0].defaultPrevented).toBe(true);
    expect(timeout.mock.calls.length).toBe(timeoutBaseline);
    expect(interval.mock.calls.length).toBe(intervalBaseline);
    expect(link).toHaveFocus();
    expect(link).toHaveAttribute('href', DOWNLOAD_URL);
    expect(link).toHaveAttribute('download');
    link.removeEventListener('click', onClick);
  });

  it('prefers a non-null downloadUrl even over an inconsistent expired status', () => {
    // downloadUrl is the source of truth: if the parent handed us a URL, show
    // the control even if its retained manifest has reached expires_at.
    renderPanel({
      artifact: makeArtifact({ expires_at: new Date(NOW).toISOString() }),
      downloadUrl: DOWNLOAD_URL,
    });

    expect(
      screen.getByRole('link', { name: 'Download bundle' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/This artifact has expired/),
    ).toBeNull();
  });
});

describe('GDPRDownloadPanel — unavailable captions', () => {
  it.each<[string, Partial<GDPRExportArtifact>, string]>([
    ['queued', {}, UNAVAILABLE_CAPTION],
    ['running', { storage_kind: '', expires_at: '' }, UNKNOWN_CAPTION],
  ])(
    'shows the "wait for completion" caption while %s',
    (_originalScenario, manifest, caption) => {
      const { container } = renderPanel({
        artifact: makeArtifact(manifest),
        downloadUrl: null,
      });

      expect(
        screen.getByText(caption),
      ).toBeInTheDocument();
      expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();
      expect(screen.queryByText('Download becomes available once the export completes.')).toBeNull();
      // No download control in this branch.
      expect(screen.queryByRole('link')).toBeNull();
      expect(panelRoot(container).querySelector(
        '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
      )).toBeNull();
    },
  );

  it('shows the "expired" caption when the artifact has expired', () => {
    renderPanel({
      artifact: makeArtifact({ expires_at: new Date(NOW).toISOString() }),
      downloadUrl: null,
    });

    expect(
      screen.getByText('This artifact has expired and is no longer downloadable.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to the generic caption for a failed artifact', () => {
    renderPanel({
      artifact: makeArtifact({ storage_kind: 's3' }),
      downloadUrl: null,
    });

    expect(screen.getByText('Downloads are not supported for this artifact’s storage kind.'))
      .toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to the generic caption when complete but no URL was provided', () => {
    // A persisted manifest alone does not prove an available file.
    renderPanel({
      artifact: makeArtifact(),
      downloadUrl: null,
    });

    expect(screen.getByText(UNAVAILABLE_CAPTION)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to the generic caption when there is no artifact at all', () => {
    // No artifact, not loading, no URL → the em-dash-free fallback, never a crash.
    renderPanel({ artifact: undefined, downloadUrl: null, loading: false });

    expect(screen.getByText(MISSING_CAPTION)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();
  });
});

describe('GDPRDownloadPanel — loading', () => {
  it('renders skeleton placeholders (never a blank panel) on first load', () => {
    const { container } = renderPanel({ loading: true, artifact: undefined });

    // Heading stays mounted; the body is skeleton placeholders.
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();
    const placeholders = panelRoot(container).querySelectorAll(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    );
    expect(placeholders.length).toBeGreaterThan(0);
    expect(placeholders).toHaveLength(2);
    placeholders.forEach((placeholder, index) => {
      expect(placeholder).toHaveAttribute('aria-hidden', 'true');
      expect(placeholder).toHaveClass('rounded', 'bg-[var(--skeleton-bg)]');
      expect(placeholder).toHaveStyle({
        width: index === 0 ? '90%' : '55%',
        height: index === 0 ? '14px' : '44px',
      });
      expect(placeholder).toBeEmptyDOMElement();
    });
    expect(panelRoot(container).querySelectorAll('.animate-pulse')).toHaveLength(0);
    // No control and no caption while the first load is in flight.
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(MISSING_CAPTION)).toBeNull();
    expect(screen.queryByText(UNKNOWN_CAPTION)).toBeNull();
    expect(screen.queryByText(UNAVAILABLE_CAPTION)).toBeNull();
    expect(screen.queryByText(/bundle streams from the backend/i)).toBeNull();
    expect(screen.queryByText('Download becomes available once the export completes.')).toBeNull();
    expect(screen.queryByText('This artifact has expired and is no longer downloadable.')).toBeNull();
  });

  it('keeps the resolved download control during a background refetch', () => {
    // loading === true but an artifact is already present → not a first load,
    // so the panel must keep showing content, not blank it with a skeleton.
    const { container } = renderPanel({
      loading: true,
      artifact: makeArtifact(),
      downloadUrl: DOWNLOAD_URL,
    });

    expect(
      screen.getByRole('link', { name: 'Download bundle' }),
    ).toBeInTheDocument();
    expect(panelRoot(container).querySelector(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toBeNull();
  });

  it('keeps the status caption during a background refetch of a queued artifact', () => {
    const { container } = renderPanel({
      loading: true,
      artifact: makeArtifact(),
      downloadUrl: null,
    });

    expect(
      screen.getByText(UNAVAILABLE_CAPTION),
    ).toBeInTheDocument();
    expect(panelRoot(container).querySelector(
      '[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toBeNull();
  });
});

describe('GDPRDownloadPanel — structure', () => {
  it('forwards className to the GlassPanel root', () => {
    const { container } = renderPanel({
      artifact: makeArtifact(),
      downloadUrl: DOWNLOAD_URL,
      className: 'apex-passthrough',
    });

    const root = panelRoot(container);
    expect(root).toHaveClass('apex-passthrough');
    // The custom class merges onto the panel, not some inner node.
    expect(root.className).toContain('apex-passthrough');
  });
});
