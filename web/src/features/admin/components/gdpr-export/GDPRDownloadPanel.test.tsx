/**
 * GDPRDownloadPanel — download-action panel for a single GDPR export artifact.
 *
 * The component is purely presentational: it takes an optional `artifact`, a
 * `downloadUrl` (already fully-qualified by the parent), plus `loading` /
 * `className`, and renders exactly one of three mutually-exclusive branches:
 *
 *   loading (and no artifact yet) → skeleton placeholders (never a blank panel)
 *   downloadUrl present           → a hint + a single download control
 *   otherwise                     → a status-aware caption explaining why the
 *                                   bundle can't be downloaded yet
 *
 * Coverage for the sole export (`GDPRDownloadPanel`):
 *   1. Download-available — the hint copy + a single, correctly-wired download
 *      control (href, `download` attr, accessible name, aria-hidden icon).
 *   2. a11y regression guard — the download control is ONE anchor and NOT a
 *      <button> nested inside an <a> (the fix: `nested-interactive` produced two
 *      tab stops for a single action). Keyboard-focusable + click dispatches.
 *   3. downloadUrl precedence — a non-null URL wins even over an inconsistent
 *      `expired` status (the URL is the source of truth).
 *   4. Unavailable captions — queued/running → "wait", expired → "expired",
 *      failed / complete-without-url / no-artifact → the generic fallback.
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
import type {
  GDPRExportArtifact,
  GDPRArtifactStatus,
} from '@/types/admin-operator-confidence';

const DOWNLOAD_URL =
  'http://localhost:8080/api/v1/admin/gdpr/exports/exp_123/download';

function makeArtifact(over: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact {
  return {
    id: 'exp_123',
    status: 'complete',
    format: 'zip',
    created_at: '2026-01-01T00:00:00Z',
    ...over,
  };
}

interface RenderProps {
  artifact?: GDPRExportArtifact;
  downloadUrl?: string | null;
  loading?: boolean;
  className?: string;
}

function renderPanel(props: RenderProps = {}) {
  return render(
    <GDPRDownloadPanel
      artifact={props.artifact}
      downloadUrl={props.downloadUrl ?? null}
      loading={props.loading}
      className={props.className}
    />,
  );
}

/** The rendered GlassPanel root (a div tagged with data-print-card). */
function panelRoot(container: HTMLElement): HTMLElement {
  const root = container.querySelector('[data-print-card]');
  if (!root) throw new Error('panel root not found');
  return root as HTMLElement;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('GDPRDownloadPanel — download available', () => {
  it('renders the hint and a single, correctly-wired download control', () => {
    const { container } = renderPanel({
      artifact: makeArtifact({ status: 'complete' }),
      downloadUrl: DOWNLOAD_URL,
    });

    // Panel heading (i18n default) is always present.
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();

    // The explanatory hint copy renders.
    expect(
      screen.getByText(/bundle streams from the backend/i),
    ).toBeInTheDocument();

    // Exactly one interactive control: an <a> that points at the bundle.
    const link = screen.getByRole('link', { name: 'Download bundle' });
    expect(link.getAttribute('href')).toBe(DOWNLOAD_URL);
    expect(link.hasAttribute('download')).toBe(true);

    // The leading icon is decorative and hidden from assistive tech.
    const icon = link.querySelector('svg');
    expect(icon?.getAttribute('aria-hidden')).toBe('true');

    // No "can't download yet" caption while a URL is present.
    expect(
      screen.queryByText(/Download becomes available/),
    ).toBeNull();
    // And no skeleton placeholder.
    expect(container.querySelector('.animate-pulse')).toBeNull();
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
    const onClick = vi.fn((e: MouseEvent) => e.preventDefault());
    link.addEventListener('click', onClick as EventListener);
    fireEvent.click(link);
    expect(onClick).toHaveBeenCalledTimes(1);
    link.removeEventListener('click', onClick as EventListener);
  });

  it('prefers a non-null downloadUrl even over an inconsistent expired status', () => {
    // downloadUrl is the source of truth: if the parent handed us a URL, show
    // the control regardless of a stale/contradictory status field.
    renderPanel({
      artifact: makeArtifact({ status: 'expired' }),
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
  it.each<GDPRArtifactStatus>(['queued', 'running'])(
    'shows the "wait for completion" caption while %s',
    (status) => {
      const { container } = renderPanel({
        artifact: makeArtifact({ status }),
        downloadUrl: null,
      });

      expect(
        screen.getByText('Download becomes available once the export completes.'),
      ).toBeInTheDocument();
      // No download control in this branch.
      expect(screen.queryByRole('link')).toBeNull();
      expect(container.querySelector('.animate-pulse')).toBeNull();
    },
  );

  it('shows the "expired" caption when the artifact has expired', () => {
    renderPanel({
      artifact: makeArtifact({ status: 'expired' }),
      downloadUrl: null,
    });

    expect(
      screen.getByText('This artifact has expired and is no longer downloadable.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to the generic caption for a failed artifact', () => {
    renderPanel({
      artifact: makeArtifact({ status: 'failed' }),
      downloadUrl: null,
    });

    expect(screen.getByText(/No bundle available/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to the generic caption when complete but no URL was provided', () => {
    // Defensive branch: status says complete yet the parent handed no URL.
    renderPanel({
      artifact: makeArtifact({ status: 'complete' }),
      downloadUrl: null,
    });

    expect(screen.getByText(/No bundle available/)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('falls back to the generic caption when there is no artifact at all', () => {
    // No artifact, not loading, no URL → the em-dash-free fallback, never a crash.
    renderPanel({ artifact: undefined, downloadUrl: null, loading: false });

    expect(screen.getByText(/No bundle available/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();
  });
});

describe('GDPRDownloadPanel — loading', () => {
  it('renders skeleton placeholders (never a blank panel) on first load', () => {
    const { container } = renderPanel({ loading: true, artifact: undefined });

    // Heading stays mounted; the body is skeleton placeholders.
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();
    expect(container.querySelectorAll('.animate-pulse').length).toBeGreaterThan(0);
    // No control and no caption while the first load is in flight.
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/No bundle available/)).toBeNull();
  });

  it('keeps the resolved download control during a background refetch', () => {
    // loading === true but an artifact is already present → not a first load,
    // so the panel must keep showing content, not blank it with a skeleton.
    const { container } = renderPanel({
      loading: true,
      artifact: makeArtifact({ status: 'complete' }),
      downloadUrl: DOWNLOAD_URL,
    });

    expect(
      screen.getByRole('link', { name: 'Download bundle' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('keeps the status caption during a background refetch of a queued artifact', () => {
    const { container } = renderPanel({
      loading: true,
      artifact: makeArtifact({ status: 'queued' }),
      downloadUrl: null,
    });

    expect(
      screen.getByText('Download becomes available once the export completes.'),
    ).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
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
