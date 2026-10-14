import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { BUTTON_BASE, BUTTON_VARIANTS } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';
import { GDPRDownloadPanel } from './GDPRDownloadPanel';

const translations = vi.hoisted(() => ({ overrides: {} as Record<string, string> }));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => translations.overrides[key] ?? fallback ?? key,
  }),
}));

const NOW = Date.parse('2026-10-14T02:00:00Z');
const HREF = '/api/v1/admin/gdpr/exports/synthetic%2FCase%3F%23/download';
const MISSING = 'No artifact result is available. Look up an artifact or retry the lookup to inspect download eligibility.';
const UNKNOWN = 'Download eligibility is unknown because storage or a valid expiry is missing. Refresh the artifact manifest to check its metadata.';
const UNSUPPORTED = 'Downloads are not supported for this artifact’s storage kind.';
const UNAVAILABLE = 'No eligible download link was supplied. Refresh the artifact manifest; metadata does not confirm that the stored file is available.';
const EXPIRED = 'This artifact has expired and is no longer downloadable.';
const HINT = 'The bundle streams from the backend through this browser. An eligible request can still fail if the file is missing. Download timestamp and counter updates are best effort, not a durable audit record.';

function manifest(changes: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact {
  return {
    id: 'synthetic/Case?#',
    export_job_id: 'synthetic-job',
    vehicle_id: 0,
    storage_kind: 'local_fs',
    storage_path: 'synthetic-only-path',
    sha256: 'synthetic-checksum',
    byte_count: 0,
    created_at: '2026-10-13T02:00:00Z',
    expires_at: '2026-10-14T03:00:00Z',
    download_count: 0,
    ...changes,
  };
}

function skeletons(container: HTMLElement) {
  return container.querySelectorAll('[aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]');
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  translations.overrides = {};
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('GDPRDownloadPanel canonical manifest contract', () => {
  it('preserves one always-visible panel heading and caller classes without an artifact', () => {
    const { container } = render(<GDPRDownloadPanel downloadUrl={null} className="synthetic-panel" />);
    expect(screen.getByRole('heading', { name: 'Download', level: 3 })).toBeInTheDocument();
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(1);
    expect(container.querySelector('[data-print-card]')).toHaveClass('synthetic-panel', 'min-w-0');
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText(MISSING)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/error above|export failed|once the export completes/i)).toBeNull();
  });

  it('preserves both initial decorative skeletons and withholds actionable or failed content', () => {
    const { container } = render(<GDPRDownloadPanel downloadUrl={HREF} loading />);
    expect(screen.getByRole('heading', { name: 'Download' })).toBeInTheDocument();
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'true');
    const placeholders = skeletons(container);
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
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    expect(screen.queryByRole('link')).toBeNull();
    for (const caption of [MISSING, UNKNOWN, UNSUPPORTED, UNAVAILABLE, EXPIRED, HINT]) {
      expect(screen.queryByText(caption)).toBeNull();
    }
  });

  it('renders the exact supplied href once as a native download anchor with a decorative icon', () => {
    const { container } = render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={HREF} />);
    const link = screen.getByRole('link', { name: 'Download bundle' });
    expect(link.tagName).toBe('A');
    expect(link).toHaveAttribute('href', HREF);
    expect(link).toHaveAttribute('download', '');
    expect(link).not.toHaveAttribute('target');
    expect(link).not.toHaveAttribute('role');
    expect(link).not.toHaveAttribute('tabindex');
    expect(container.querySelectorAll('a')).toHaveLength(1);
    expect(container.querySelectorAll('button')).toHaveLength(0);
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
    expect(link.querySelector('svg')).toHaveAttribute('focusable', 'false');
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('retains shared primary chrome, crisp focus, forced colors and a wrapping mobile target', () => {
    render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={HREF} />);
    const link = screen.getByRole('link', { name: 'Download bundle' });
    for (const token of cn(BUTTON_BASE, BUTTON_VARIANTS.primary).split(/\s+/)) {
      expect(link).toHaveClass(token);
    }
    expect(link).toHaveClass(
      'focus-visible:outline-2', 'focus-visible:outline-offset-2',
      'forced-colors:focus-visible:outline-[Highlight]',
      'forced-colors:bg-[Highlight]', 'forced-colors:text-[HighlightText]',
      'forced-colors:border-[ButtonBorder]', 'motion-reduce:transition-none',
      'min-h-11', 'min-w-11', 'w-full', 'sm:w-auto', 'max-w-full', 'whitespace-normal',
    );
    expect(link.querySelector('span')).toHaveClass('min-w-0', 'break-words');
    expect(link.className).not.toMatch(/focus-visible:ring|rounded-md|brightness-110/);
  });

  it('is one focusable link whose synthetic activation remains browser-owned', () => {
    render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={HREF} />);
    const link = screen.getByRole('link', { name: 'Download bundle' });
    link.focus();
    expect(link).toHaveFocus();
    // Cancel the synthetic event before any jsdom navigation or download.
    const preventNavigation = vi.fn((event: MouseEvent) => {
      expect(event.defaultPrevented).toBe(false);
      event.preventDefault();
    });
    link.addEventListener('click', preventNavigation);
    fireEvent.click(link);
    expect(preventNavigation).toHaveBeenCalledTimes(1);
    expect(link).toHaveAttribute('href', HREF);
    link.removeEventListener('click', preventNavigation);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('retains the eligible link and best-effort explanation during a background refresh', () => {
    const { container } = render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={HREF} loading />);
    expect(screen.getByRole('link', { name: 'Download bundle' })).toBeInTheDocument();
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'false');
    expect(skeletons(container)).toHaveLength(0);
  });

  it('treats the parent-supplied href as authority, not a renderer-invented readiness state', () => {
    render(<GDPRDownloadPanel artifact={manifest({ expires_at: '2000-01-01T00:00:00Z', storage_kind: 's3' })} downloadUrl={HREF} />);
    expect(screen.getByRole('link', { name: 'Download bundle' })).toHaveAttribute('href', HREF);
    expect(screen.queryByText(EXPIRED)).toBeNull();
    expect(screen.queryByText(UNSUPPORTED)).toBeNull();
  });

  it.each([
    { label: 'before', now: NOW - 1, caption: UNAVAILABLE },
    { label: 'at', now: NOW, caption: EXPIRED },
    { label: 'after', now: NOW + 1, caption: EXPIRED },
  ])('uses actual expiry evidence $label the exact boundary without inventing a link', ({ now, caption }) => {
    render(<GDPRDownloadPanel artifact={manifest({ expires_at: new Date(NOW).toISOString() })} downloadUrl={null} now={now} />);
    expect(screen.getByText(caption)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('accepts the retained page clock and href revocation without another timer or refetch', () => {
    const artifact = manifest({ expires_at: new Date(NOW + 250).toISOString() });
    const { container, rerender } = render(<GDPRDownloadPanel artifact={artifact} downloadUrl={HREF} now={NOW} loading />);
    expect(screen.getByRole('link')).toBeInTheDocument();
    rerender(<GDPRDownloadPanel artifact={artifact} downloadUrl={null} now={NOW + 250} loading />);
    expect(screen.getByText(EXPIRED)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(skeletons(container)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('uses the render-time clock when the existing ticking page does not pass now', () => {
    const artifact = manifest({ expires_at: new Date(NOW + 250).toISOString() });
    const { rerender } = render(<GDPRDownloadPanel artifact={artifact} downloadUrl={null} />);
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    vi.setSystemTime(NOW + 250);
    rerender(<GDPRDownloadPanel artifact={artifact} downloadUrl={null} />);
    expect(screen.getByText(EXPIRED)).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    '', 'not-a-date', '2026-10-14', '2026-10-14T01:00:00',
    '2026-02-30T01:00:00Z', '2026-13-01T01:00:00Z', '2026-10-00T01:00:00Z',
    '2026-10-14T24:00:00Z', '2026-10-14T01:00:00+24:00',
  ])('keeps malformed or unzoned expiry %j unknown instead of inferring expiry or completion', (expires_at) => {
    render(<GDPRDownloadPanel artifact={manifest({ expires_at })} downloadUrl={null} />);
    expect(screen.getByText(UNKNOWN)).toBeInTheDocument();
    expect(screen.queryByText(EXPIRED)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/once the export completes|error above|Invalid Date/i)).toBeNull();
  });

  it.each(['2026-10-14T03:00:00+01:00', '2026-10-13T21:00:00-05:00'])(
    'honors a zoned expiry instant %s rather than local wall time',
    (expires_at) => {
      render(<GDPRDownloadPanel artifact={manifest({ expires_at })} downloadUrl={null} now={NOW} />);
      expect(screen.getByText(EXPIRED)).toBeInTheDocument();
      expect(screen.queryByRole('link')).toBeNull();
    },
  );

  it.each(['', '   '])('keeps missing storage %j unknown without assuming local filesystem support', (storage_kind) => {
    render(<GDPRDownloadPanel artifact={manifest({ storage_kind })} downloadUrl={null} />);
    expect(screen.getByText(UNKNOWN)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it.each(['s3', 'synthetic_vendor', 'LOCAL_FS', ' local_fs '])(
    'explains unsupported raw storage %j without rewriting it or offering a link',
    (storage_kind) => {
      render(<GDPRDownloadPanel artifact={manifest({ storage_kind })} downloadUrl={null} />);
      expect(screen.getByText(UNSUPPORTED)).toBeInTheDocument();
      expect(screen.queryByRole('link')).toBeNull();
    },
  );

  it('does not claim a missing file, export failure or queued job when the href is absent', () => {
    render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={null} />);
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText(/see the error above|once the export completes|export failed/i)).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('retains actual unavailable metadata explanation during a paused or failed background refresh', () => {
    const { container } = render(<GDPRDownloadPanel artifact={manifest({ storage_kind: 's3' })} downloadUrl={null} loading />);
    expect(screen.getByText(UNSUPPORTED)).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(0);
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'false');
  });

  it.each([0, 3])('does not infer readiness or successful download from recorded count %i', (download_count) => {
    render(<GDPRDownloadPanel artifact={manifest({ download_count, byte_count: 0 })} downloadUrl={null} />);
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.queryByText(/completed|successfully downloaded|audit ledger/i)).toBeNull();
  });

  it('does not gate a supplied download on zero bytes or unknown numeric measurements', () => {
    const { rerender } = render(<GDPRDownloadPanel artifact={manifest({ byte_count: 0, download_count: 0 })} downloadUrl={HREF} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', HREF);
    rerender(<GDPRDownloadPanel artifact={manifest({ byte_count: undefined as unknown as number, download_count: undefined as unknown as number })} downloadUrl={HREF} />);
    expect(screen.getByRole('link')).toHaveAttribute('href', HREF);
    expect(screen.getByText(HINT)).toBeInTheDocument();
  });

  it('ignores phantom lifecycle fields even when an untyped payload includes them', () => {
    const artifact = { ...manifest(), status: 'queued', format: 'zip', error: 'synthetic-old-field' };
    render(<GDPRDownloadPanel artifact={artifact} downloadUrl={null} />);
    expect(screen.getByText(UNAVAILABLE)).toBeInTheDocument();
    expect(screen.queryByText(/once the export completes|synthetic-old-field/i)).toBeNull();
  });

  it('does not consume the old English override that incorrectly promises an audit ledger', () => {
    translations.overrides['admin.gdprExport.downloadHint'] = 'Synthetic legacy durable audit ledger promise';
    render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={HREF} />);
    expect(screen.getByText(HINT)).toBeInTheDocument();
    expect(screen.queryByText('Synthetic legacy durable audit ledger promise')).toBeNull();
  });

  it('uses localized heading, action and explanation while preserving a single wrapping link', () => {
    translations.overrides = {
      'admin.gdprExport.downloadTitle': 'Synthetic localized heading',
      'admin.gdprExport.downloadButton': 'Synthetic long localized bundle download action',
      'admin.gdprExport.downloadManifestHint': 'Synthetic localized best-effort explanation',
    };
    render(<GDPRDownloadPanel artifact={manifest()} downloadUrl={HREF} />);
    expect(screen.getByRole('heading', { name: 'Synthetic localized heading' })).toBeInTheDocument();
    const link = screen.getByRole('link', { name: 'Synthetic long localized bundle download action' });
    expect(link.querySelector('span')).toHaveClass('break-words');
    expect(screen.getByText('Synthetic localized best-effort explanation')).toBeInTheDocument();
  });
});
