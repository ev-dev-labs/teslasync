/**
 * GDPRLifecyclePanel contract.
 *
 * The panel renders a GDPR export artifact's lifecycle as a timeline
 * (Created → Completed/Failed → Expires/Expired), derived purely from the
 * artifact's timestamps + status. It is presentational (no interactive
 * controls), so the suite pins every render branch, the derived-timeline
 * edge cases, the null-safety contract, and the a11y guarantees:
 *
 *   Render branches
 *     1. Loading (no artifact yet) → a Skeleton, never a timeline/empty state.
 *     2. Loading precedence: a present artifact wins over `loading` so a
 *        background refetch does not flash the skeleton over real data.
 *     3. No artifact, not loading → the EmptyState (role="status") copy.
 *     4. Artifact present → the timeline, with the always-present "Created"
 *        step and the conditional Completed/Failed/Expiry steps.
 *
 *   Derived-timeline branches
 *     - queued: Created only.
 *     - complete + future expiry: Created, Completed, "Expires".
 *     - complete + past expiry: the date-based branch flips the label to
 *       "Expired" even though the status is still 'complete'.
 *     - status 'expired' with a future date: still "Expired" (status wins).
 *     - failed: the error text is echoed, and — critically — the green
 *       "Completed" step is suppressed so the timeline can't contradict
 *       itself, while the failure's terminal timestamp is preserved.
 *
 *   Hardening / bug-guards surfaced by this suite
 *     - An empty or whitespace-only `error` string must fall back to the
 *       generic copy, not render a blank subtitle (`?? ` would let '' pass).
 *     - A malformed/absent `created_at` degrades to the "—" placeholder
 *       instead of throwing or printing "Invalid Date".
 *
 * `Date.now()` is frozen so the relative-time labels ("2h ago", "5m ago")
 * and the date-based expiry comparison are deterministic. react-i18next is
 * mocked (mirroring the sibling BridgeStatus/FeedbackStatTile tests) so the
 * fallback strings render without locale files.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
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
  user_id: 'user@example.com',
  status: 'queued',
  format: 'zip',
  bytes: null,
  sha256: null,
  storage: null,
  created_at: '2026-07-04T10:00:00.000Z', // 2h before FIXED_NOW → "2h ago"
  completed_at: null,
  expires_at: null,
  error: null,
};

const mk = (overrides: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact => ({
  ...base,
  ...overrides,
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(FIXED_NOW));
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
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('loading: with no artifact yet, shows a skeleton and neither the timeline nor the empty state', () => {
    const { container } = render(<GDPRLifecyclePanel loading />);

    // Skeleton primitive renders an animate-pulse block.
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    // The empty-state live region and any timeline entries are withheld.
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByText('Created')).toBeNull();
  });

  it('loading precedence: a present artifact wins over `loading` (no skeleton flash)', () => {
    const { container } = render(<GDPRLifecyclePanel artifact={mk()} loading />);

    // The real timeline paints; the skeleton must NOT override live data.
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(container.querySelector('.animate-pulse')).toBeNull();
  });

  it('queued: renders only the "Created" step with its relative time', () => {
    render(<GDPRLifecyclePanel artifact={mk({ status: 'queued' })} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    // formatRelative wiring: created_at is 2h before the frozen now.
    expect(screen.getByText('2h ago')).toBeInTheDocument();
    // None of the terminal steps appear for an in-flight export.
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('null-safety: a missing created_at degrades to the "—" placeholder, never "Invalid Date"', () => {
    // Untyped API data can omit created_at despite the type; the formatters
    // must absorb it rather than throw.
    const artifact = mk({ created_at: undefined as unknown as string });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    // Both the subtitle (formatDateTime) and time (formatRelative) fall back.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('complete + future expiry: shows Created, Completed, and the "Expires" label', () => {
    const artifact = mk({
      status: 'complete',
      completed_at: '2026-07-04T11:00:00.000Z', // 1h ago
      expires_at: '2099-01-01T00:00:00.000Z', // far future → not yet expired
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('1h ago')).toBeInTheDocument();
    // Future expiry → "Expires", exact-match so it never collides with "Expired".
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('complete + past expiry: the date-based branch flips the label to "Expired" while keeping Completed', () => {
    const artifact = mk({
      status: 'complete', // status is NOT 'expired' — the date comparison drives the label
      completed_at: '2026-07-04T11:00:00.000Z',
      expires_at: '2000-01-01T00:00:00.000Z', // in the past
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
    // A completed-then-expired export still records its Completed milestone.
    expect(screen.getByText('Completed')).toBeInTheDocument();
  });

  it('expired status: a future expires_at still renders "Expired" because the status wins', () => {
    const artifact = mk({
      status: 'expired',
      expires_at: '2099-01-01T00:00:00.000Z', // future date, but status is authoritative
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
  });

  it('failed: echoes the backend error as the subtitle and suppresses the "Completed" step', () => {
    const artifact = mk({ status: 'failed', error: 'disk full during export' });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('disk full during export')).toBeInTheDocument();
    // A failed export must never present a contradictory green "Completed".
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('failed + completed_at: still suppresses Completed but timestamps the failure from completed_at', () => {
    const artifact = mk({
      status: 'failed',
      error: 'kaboom',
      completed_at: '2026-07-04T11:55:00.000Z', // 5m ago — the job stopped here
    });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    // Guard: completed_at present + failed → no "Completed" milestone.
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('kaboom')).toBeInTheDocument();
    // The terminal timestamp is preserved on the Failed entry (not dropped as '').
    expect(screen.getByText('5m ago')).toBeInTheDocument();
  });

  it('failed + empty error string: falls back to the generic copy instead of a blank subtitle', () => {
    // Regression guard: `error ?? generic` would let '' through and render
    // an empty subtitle — a non-empty error is required to override.
    const artifact = mk({ status: 'failed', error: '' });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Export did not finish')).toBeInTheDocument();
  });

  it('failed + whitespace-only error: also falls back to the generic copy', () => {
    const artifact = mk({ status: 'failed', error: '   ' });
    render(<GDPRLifecyclePanel artifact={artifact} />);

    expect(screen.getByText('Export did not finish')).toBeInTheDocument();
  });

  it('a11y: every timeline icon is decorative (aria-hidden) so it stays out of the a11y tree', () => {
    const artifact = mk({
      status: 'complete',
      completed_at: '2026-07-04T11:00:00.000Z',
      expires_at: '2099-01-01T00:00:00.000Z',
    });
    const { container } = render(<GDPRLifecyclePanel artifact={artifact} />);

    const icons = container.querySelectorAll('svg');
    expect(icons.length).toBeGreaterThan(0);
    // No icon leaks into the accessibility tree.
    expect(container.querySelector('svg:not([aria-hidden="true"])')).toBeNull();
  });

  it('forwards className to the outer GlassPanel surface', () => {
    const { container } = render(
      <GDPRLifecyclePanel artifact={mk()} className="lifecycle-test-class" />,
    );

    const panel = container.querySelector('[data-print-card]');
    expect(panel).not.toBeNull();
    expect(panel?.classList.contains('lifecycle-test-class')).toBe(true);
  });
});
