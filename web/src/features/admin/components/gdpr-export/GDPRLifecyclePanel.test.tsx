/**
 * GDPRLifecyclePanel contract.
 *
 * Original scenario names are retained as stable receipt identities, not job
 * state claims. Their canonical crosswalk is:
 * queued → creation without optional events; complete → recorded download;
 * expired status → controlled expiry instant; failed → malformed download;
 * failed + completed_at → valid recorded download; empty/whitespace error →
 * absent download timestamp. The manifest has no status/error/completion fields.
 *
 * Keep all original loading/empty/retained/unknown/accessibility obligations.
 * Dates are sorted by raw instants and displayed through preference-bound
 * formatters. A recorded download is best-effort evidence, not a durable ledger.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';

const preferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));
const dates = vi.hoisted(() => ({
  absolute: vi.fn<(iso: string | null | undefined) => string>(),
  relative: vi.fn<(iso: string | null | undefined) => string>(),
}));

vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      formatDateTime: dates.absolute.mockImplementation((iso) => actual.formatDateTime(iso, preferences)),
      formatRelative: dates.relative.mockImplementation((iso) => actual.formatRelative(iso, preferences)),
    }),
  };
});

import { GDPRLifecyclePanel } from './GDPRLifecyclePanel';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';

// Frozen "now" — every fixture timestamp is expressed relative to this so the
// relative-time labels and the `expires_at < Date.now()` branch are stable.
const FIXED_NOW = '2026-07-04T12:00:00.000Z';

const base: GDPRExportArtifact = {
  id: 'exp-1',
  export_job_id: 'synthetic-job',
  vehicle_id: 7,
  storage_kind: 'local_fs',
  storage_path: 'synthetic-bundle',
  byte_count: 0,
  sha256: 'synthetic-checksum',
  created_at: '2026-07-04T10:00:00.000Z', // 2h before FIXED_NOW → "2h ago"
  expires_at: '',
  download_count: 0,
};

const mk = (overrides: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact => ({
  ...base,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
  preferences.locale = 'en-US';
  preferences.tz = 'UTC';
  dates.absolute.mockClear();
  dates.relative.mockClear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GDPRLifecyclePanel', () => {
  it('renders the always-visible "Lifecycle" heading regardless of state', () => {
    render(<GDPRLifecyclePanel />);
    // PanelTitle is an <h3>; the decorative clock icon is aria-hidden so the
    // accessible name is exactly the visible copy.
    expect(screen.getByRole('heading', { level: 3, name: 'Lifecycle' })).toBeInTheDocument();
  });

  it('empty: with no artifact and not loading, shows the EmptyState copy and no timeline', () => {
    const { container } = render(<GDPRLifecyclePanel />);

    // EmptyState renders a labelled live region with the explanatory message.
    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(screen.getByText('No lifecycle events recorded yet.')).toBeInTheDocument();
    // No timeline entries and no loading skeleton in the empty branch.
    expect(screen.queryByText('Created')).toBeNull();
    expect(container.querySelector(
      '[data-print-card] [aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toBeNull();
  });

  it('loading: with no artifact yet, shows a skeleton and neither the timeline nor the empty state', () => {
    const { container } = render(<GDPRLifecyclePanel loading />);

    // The lifecycle reserves its source-local height without ambient motion.
    const placeholder = container.querySelector(
      '[data-print-card] [aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    );
    expect(placeholder).not.toBeNull();
    expect(container.querySelectorAll(
      '[data-print-card] [aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toHaveLength(1);
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder).toHaveClass('h-4', 'w-full', 'rounded');
    expect(placeholder).toHaveStyle({ height: '140px' });
    expect(placeholder).toBeEmptyDOMElement();
    expect(container.querySelectorAll('[data-print-card] .animate-pulse')).toHaveLength(0);
    // The empty-state live region and any timeline entries are withheld.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Created')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('loading precedence: a present artifact wins over `loading` (no skeleton flash)', () => {
    preferences.locale = 'de-DE';
    preferences.tz = 'Europe/Berlin';
    const artifact = Object.freeze(mk());
    const { container } = render(<GDPRLifecyclePanel artifact={artifact} loading />);

    // The real timeline paints; the skeleton must NOT override live data.
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(container.querySelector(
      '[data-print-card] [aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
    )).toBeNull();
    expect(screen.getByText(formatDateTime(artifact.created_at, preferences))).toBeInTheDocument();
    expect(screen.getByText(formatRelative(artifact.created_at, preferences))).toBeInTheDocument();
    expect(dates.absolute).toHaveBeenCalledWith(artifact.created_at);
    expect(dates.relative).toHaveBeenCalledWith(artifact.created_at);
    expect(artifact).toEqual(base);
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'false');
  });

  it('queued: renders only the "Created" step with its relative time', () => {
    render(<GDPRLifecyclePanel artifact={mk()} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    // formatRelative wiring: created_at is 2h before the frozen now.
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    // An absent timestamp is not an inferred job state or download event.
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('null-safety: a missing created_at degrades to the "—" placeholder, never "Invalid Date"', () => {
    // Untyped API data can omit created_at despite the type; the formatters
    // must absorb it rather than throw.
    const artifact = mk();
    Reflect.deleteProperty(artifact, 'created_at');
    const { rerender } = render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    // Both the subtitle (formatDateTime) and time (formatRelative) fall back.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(dates.relative).toHaveBeenCalledWith(undefined);
    rerender(<GDPRLifecyclePanel artifact={mk({ created_at: 'not-an-instant' })} />);
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('complete + future expiry: shows Created, Completed, and the "Expires" label', () => {
    const artifact = mk({
      downloaded_at: '2026-07-04T11:00:00.000Z', // recorded 1h ago
      expires_at: '2099-01-01T00:00:00.000Z', // far future → not yet expired
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
    // Future expiry → "Expires", exact-match so it never collides with "Expired".
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('complete + past expiry: the date-based branch flips the label to "Expired" while keeping Completed', () => {
    const artifact = mk({
      downloaded_at: '2026-07-04T11:00:00.000Z',
      expires_at: '2000-01-01T00:00:00.000Z', // in the past
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
    // Preserve recorded evidence, even when expiry precedes creation/download.
    expect(screen.getByText('Download')).toBeInTheDocument();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Expired')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Created')).toBeInTheDocument();
    expect(within(rows[2]).getByText('Download')).toBeInTheDocument();
    expect(dates.absolute).toHaveBeenCalledWith(artifact.expires_at);
    expect(dates.relative).toHaveBeenCalledWith(artifact.downloaded_at);
    expect(screen.getByText(
      `Lifecycle: 3 entries. From ${formatDateTime(artifact.expires_at, preferences)} to ${formatDateTime(artifact.downloaded_at, preferences)}`,
    )).toBeInTheDocument();
  });

  it('expired status: a future expires_at still renders "Expired" because the status wins', () => {
    const artifact = mk({
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    const expiry = Date.parse(artifact.expires_at);
    const { rerender } = render(<GDPRLifecyclePanel artifact={artifact} now={expiry} />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<GDPRLifecyclePanel artifact={artifact} now={expiry - 1} />);
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('failed: echoes the backend error as the subtitle and suppresses the "Completed" step', () => {
    const artifact = mk({ downloaded_at: 'not-an-instant', expires_at: '2099-01-01T00:00:00.000Z' });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    // Malformed recorded evidence stays unknown, never a fabricated failure.
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(within(screen.getAllByRole('listitem')[2]).getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.queryByText(/^Lifecycle:.*From /)).toBeNull();
  });

  it('failed + completed_at: still suppresses Completed but timestamps the failure from completed_at', () => {
    const artifact = mk({
      downloaded_at: '2026-07-04T11:55:00.000Z', // best-effort recording, 5m ago
      download_count: 0,
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    // A timestamp is preserved independently of the best-effort counter.
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.getByText('Download')).toBeInTheDocument();
    expect(screen.getByText('5m ago')).toBeInTheDocument();
    expect(dates.absolute).toHaveBeenCalledWith(artifact.downloaded_at);
    expect(dates.relative).toHaveBeenCalledWith(artifact.downloaded_at);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('failed + empty error string: falls back to the generic copy instead of a blank subtitle', () => {
    const artifact = mk({ downloaded_at: '', download_count: 9, expires_at: 'not-an-instant' });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('failed + whitespace-only error: also falls back to the generic copy', () => {
    const artifact = mk({ downloaded_at: '   ', download_count: 9, expires_at: '   ' });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.getAllByRole('listitem')).toHaveLength(1);
  });

  it('a11y: every timeline icon is decorative (aria-hidden) so it stays out of the a11y tree', () => {
    const artifact = mk({
      downloaded_at: '2026-07-04T11:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    const { container } = render(<GDPRLifecyclePanel artifact={artifact} />);

    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    // No icon leaks into the accessibility tree.
    expect(container.querySelector('svg:not([aria-hidden="true"])')).toBeNull();
    expect(container.querySelector('svg:not([focusable="false"])')).toBeNull();
    expect(screen.getByRole('list', { name: 'Lifecycle' })).toBeInTheDocument();
  });

  it('forwards className to the outer GlassPanel surface', () => {
    const { container } = render(
      <GDPRLifecyclePanel artifact={mk()} className="lifecycle-test-class" />,
    );

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('lifecycle-test-class')).toBe(true);
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(1);
    expect(container.querySelector('button, input, select, textarea, a')).toBeNull();
  });
});
