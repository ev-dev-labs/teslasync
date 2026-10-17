import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import type { GDPRExportArtifact } from '@/types/admin-operator-confidence';
import { formatDateTime, formatRelative } from '@/lib/dateFormat';
import { GDPRLifecyclePanel } from './GDPRLifecyclePanel';
import { STATUS_COLOR, STATUS_ICON, STATUS_VARIANT } from './constants';

const preferences = vi.hoisted(() => ({ locale: 'en-US', tz: 'UTC' }));

vi.mock('@/hooks/useDateFormat', async () => {
  const actual = await vi.importActual<typeof import('@/lib/dateFormat')>('@/lib/dateFormat');
  return {
    useDateFormat: () => ({
      formatDateTime: (iso: string | null | undefined) => actual.formatDateTime(iso, preferences),
      formatRelative: (iso: string | null | undefined) => actual.formatRelative(iso, preferences),
    }),
  };
});

const NOW = Date.parse('2026-07-04T12:00:00.000Z');
const CREATED = '2026-07-04T10:00:00.000Z';
const EXPIRY = '2026-07-04T13:00:00.000Z';
const manifest: GDPRExportArtifact = {
  id: 'synthetic-manifest?opaque#id',
  export_job_id: 'synthetic-job',
  vehicle_id: 7,
  storage_kind: 'local_fs',
  storage_path: 'synthetic-bundle',
  sha256: 'synthetic-checksum',
  byte_count: 0,
  created_at: CREATED,
  expires_at: EXPIRY,
  download_count: 0,
};

const mk = (changes: Partial<GDPRExportArtifact> = {}): GDPRExportArtifact => ({
  ...manifest,
  ...changes,
});

function rows() {
  return within(screen.getByRole('list', { name: 'Lifecycle' })).getAllByRole('listitem');
}

function skeleton(container: HTMLElement) {
  return container.querySelectorAll(
    '[data-print-card] [aria-hidden="true"][class*="bg-[var(--skeleton-bg)]"]',
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  preferences.locale = 'en-US';
  preferences.tz = 'UTC';
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('GDPRLifecyclePanel manifest contract', () => {
  it('preserves the always-visible Lifecycle heading', () => {
    render(<GDPRLifecyclePanel />);
    expect(screen.getByRole('heading', { level: 3, name: 'Lifecycle' })).toBeInTheDocument();
  });

  it('preserves the explanatory empty status with no timeline or skeleton', () => {
    const { container } = render(<GDPRLifecyclePanel />);
    expect(screen.getByRole('status')).toHaveTextContent('No lifecycle events recorded yet.');
    expect(screen.queryByRole('list')).toBeNull();
    expect(skeleton(container)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves all initial-loading skeleton assertions and withholds events', () => {
    const { container } = render(<GDPRLifecyclePanel loading />);
    const placeholders = skeleton(container);
    expect(placeholders).toHaveLength(1);
    expect(placeholders[0]).toHaveAttribute('aria-hidden', 'true');
    expect(placeholders[0]).toHaveClass('h-4', 'w-full', 'rounded');
    expect(placeholders[0]).toHaveStyle({ height: '140px' });
    expect(placeholders[0]).toBeEmptyDOMElement();
    expect(container.querySelectorAll('[data-print-card] .animate-pulse')).toHaveLength(0);
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    for (const label of ['Created', 'Completed', 'Failed', 'Expires', 'Expired', 'Download']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('preserves retained-artifact precedence during loading without a skeleton flash', () => {
    const { container } = render(<GDPRLifecyclePanel artifact={mk()} loading />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(skeleton(container)).toHaveLength(0);
    expect(container.querySelector('[data-print-card]')).toHaveAttribute('aria-busy', 'false');
  });

  it('renders Created alone when no other timestamp is recorded, never a job state', () => {
    render(<GDPRLifecyclePanel artifact={mk({ expires_at: '' })} />);
    expect(rows()).toHaveLength(1);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText(formatRelative(CREATED, preferences))).toBeInTheDocument();
    for (const label of ['Completed', 'Failed', 'Expires', 'Expired', 'Download']) {
      expect(screen.queryByText(label)).toBeNull();
    }
  });

  it('preserves missing creation as explicit unknown without Invalid Date or invented bounds', () => {
    render(<GDPRLifecyclePanel artifact={mk({
      created_at: undefined as unknown as string,
      expires_at: '',
    })} />);
    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
    expect(screen.queryByText(/^From /)).toBeNull();
  });

  it('preserves malformed creation as unknown while retaining valid expiry', () => {
    render(<GDPRLifecyclePanel artifact={mk({ created_at: 'not-an-instant' })} />);
    expect(rows()).toHaveLength(2);
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText(/^From /)).toBeNull();
    expect(screen.queryByText(/Invalid Date/)).toBeNull();
  });

  it('renders only Created and Expires for a future expiry, never inferred completion', () => {
    render(<GDPRLifecyclePanel artifact={mk()} />);
    expect(rows()).toHaveLength(2);
    expect(within(rows()[0]).getByText('Created')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('preserves elapsed expiry and sorts actual timestamps oldest-first', () => {
    render(<GDPRLifecyclePanel artifact={mk({ expires_at: '2000-01-01T00:00:00.000Z' })} />);
    expect(within(rows()[0]).getByText('Expired')).toBeInTheDocument();
    expect(within(rows()[1]).getByText('Created')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
  });

  it('marks expiry at the exact instant expired, not still available', () => {
    render(<GDPRLifecyclePanel artifact={mk({ expires_at: new Date(NOW).toISOString() })} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
  });

  it('ticks retained expiry across the exact subsecond boundary without a refetch', () => {
    const artifact = mk({ expires_at: new Date(NOW + 250).toISOString() });
    render(<GDPRLifecyclePanel artifact={artifact} loading />);
    expect(screen.getByText('Expires')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(249); });
    expect(screen.getByText('Expires')).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Expires')).toBeNull();
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('accepts the page-owned clock and adds no competing timer', () => {
    const artifact = mk({ expires_at: new Date(NOW + 250).toISOString() });
    const { rerender } = render(<GDPRLifecyclePanel artifact={artifact} now={NOW} />);
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    rerender(<GDPRLifecyclePanel artifact={artifact} now={NOW + 250} />);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('resets expiry evidence when the selected manifest changes and cleans timers on unmount', () => {
    const { rerender, unmount } = render(<GDPRLifecyclePanel artifact={mk({
      expires_at: new Date(NOW + 250).toISOString(),
    })} />);
    rerender(<GDPRLifecyclePanel artifact={mk({ id: 'other-manifest' })} />);
    act(() => { vi.advanceTimersByTime(250); });
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).toBeNull();
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not overflow browser timers for far-future retention', () => {
    render(<GDPRLifecyclePanel artifact={mk({ expires_at: '2099-01-01T00:00:00.000Z' })} />);
    expect(vi.getTimerCount()).toBe(1);
    act(() => { vi.advanceTimersByTime(1_000); });
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.queryByText('Expired')).toBeNull();
  });

  it('uses optional downloaded_at as recorded evidence, not export completion', () => {
    const downloaded = '2026-07-04T11:55:00.000Z';
    render(<GDPRLifecyclePanel artifact={mk({ downloaded_at: downloaded })} />);
    expect(rows()).toHaveLength(3);
    expect(within(rows()[1]).getByText('Download')).toBeInTheDocument();
    expect(within(rows()[1]).getByText(formatRelative(downloaded, preferences))).toBeInTheDocument();
    expect(within(rows()[1]).getByText(formatDateTime(downloaded, preferences))).toBeInTheDocument();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
    expect(screen.queryByText(/audit ledger/i)).toBeNull();
  });

  it('does not synthesize a download timestamp from a positive download_count', () => {
    render(<GDPRLifecyclePanel artifact={mk({ download_count: 9 })} />);
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('Download')).toBeNull();
  });

  it.each([null, '', '   '])('keeps an absent download timestamp %j unknown, not an event', (downloaded_at) => {
    render(<GDPRLifecyclePanel artifact={mk({ downloaded_at })} />);
    expect(rows()).toHaveLength(2);
    expect(screen.queryByText('Download')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('retains a malformed recorded download as unknown rather than failure or a fabricated instant', () => {
    render(<GDPRLifecyclePanel artifact={mk({ downloaded_at: 'not-an-instant' })} />);
    expect(rows()).toHaveLength(3);
    expect(within(rows()[2]).getByText('Download')).toBeInTheDocument();
    expect(within(rows()[2]).getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText(/^From /)).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });

  it('keeps malformed expiry unknown and never classifies it expired', () => {
    render(<GDPRLifecyclePanel artifact={mk({ expires_at: 'not-an-instant' })} />);
    expect(screen.getByText('Expires')).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.queryByText('Expired')).toBeNull();
    expect(screen.queryByText(/^From /)).toBeNull();
  });

  it('supplies a localized accessible list name and absolute oldest/newest bounds', () => {
    render(<GDPRLifecyclePanel artifact={mk({ downloaded_at: '2026-07-04T11:00:00.000Z' })} />);
    expect(screen.getByRole('list', { name: 'Lifecycle' })).toBeInTheDocument();
    expect(screen.getByText(
      `Lifecycle: 3 entries. From ${formatDateTime(CREATED, preferences)} to ${formatDateTime(EXPIRY, preferences)}`,
    )).toBeInTheDocument();
    expect(within(rows()[0]).getByText('Created')).toBeInTheDocument();
    expect(within(rows()[2]).getByText('Expires')).toBeInTheDocument();
  });

  it('sorts a recorded download after expiry without dropping source evidence or reversing bounds', () => {
    const downloaded = '2026-07-04T14:00:00.000Z';
    render(<GDPRLifecyclePanel artifact={mk({ downloaded_at: downloaded })} />);
    expect(within(rows()[2]).getByText('Download')).toBeInTheDocument();
    expect(screen.getByText(
      `Lifecycle: 3 entries. From ${formatDateTime(CREATED, preferences)} to ${formatDateTime(downloaded, preferences)}`,
    )).toBeInTheDocument();
  });

  it('uses the existing preference-bound formatter for rows and bounds without changing wire instants', () => {
    preferences.locale = 'de-DE';
    preferences.tz = 'Europe/Berlin';
    const artifact = Object.freeze(mk());
    render(<GDPRLifecyclePanel artifact={artifact} />);
    expect(within(rows()[0]).getByText(formatDateTime(CREATED, preferences))).toBeInTheDocument();
    expect(within(rows()[1]).getByText(formatRelative(EXPIRY, preferences))).toBeInTheDocument();
    expect(screen.getByText(
      `Lifecycle: 2 entries. From ${formatDateTime(CREATED, preferences)} to ${formatDateTime(EXPIRY, preferences)}`,
    )).toBeInTheDocument();
    expect(artifact).toEqual(manifest);
  });

  it('preserves every decorative icon assertion in populated and empty states', () => {
    const { container, rerender } = render(<GDPRLifecyclePanel artifact={mk({
      downloaded_at: '2026-07-04T11:00:00.000Z',
    })} />);
    expect(container.querySelectorAll('svg').length).toBeGreaterThan(0);
    expect(container.querySelector('svg:not([aria-hidden="true"])')).toBeNull();
    expect(container.querySelector('svg:not([focusable="false"])')).toBeNull();
    rerender(<GDPRLifecyclePanel />);
    expect(container.querySelector('svg:not([aria-hidden="true"])')).toBeNull();
  });

  it('preserves className forwarding and the single panel shell', () => {
    const { container } = render(<GDPRLifecyclePanel artifact={mk()} className="lifecycle-test-class" />);
    expect(container.querySelectorAll('[data-print-card]')).toHaveLength(1);
    expect(container.querySelector('[data-print-card]')).toHaveClass('lifecycle-test-class');
    expect(container.querySelector('button, input, select, textarea, a')).toBeNull();
  });

  it('preserves barrel exports with only actual event keys and restrained semantic roles', () => {
    const keys = ['created', 'downloaded', 'expires', 'expired'].sort();
    expect(Object.keys(STATUS_VARIANT).sort()).toEqual(keys);
    expect(Object.keys(STATUS_ICON).sort()).toEqual(keys);
    expect(Object.keys(STATUS_COLOR).sort()).toEqual(keys);
    expect(STATUS_VARIANT).toEqual({
      created: 'neutral', downloaded: 'info', expires: 'neutral', expired: 'warning',
    });
    expect(STATUS_COLOR).toEqual({
      created: 'var(--text-secondary)',
      downloaded: 'var(--semantic-info)',
      expires: 'var(--text-secondary)',
      expired: 'var(--semantic-warning)',
    });
    const { container } = render(<GDPRLifecyclePanel artifact={mk()} />);
    expect(container.querySelector('h3 svg')).toHaveClass('text-[var(--text-muted)]');
    expect(container.querySelector('[class*="text-cyan-"]')).toBeNull();
    expect(screen.queryByText('Completed')).toBeNull();
    expect(screen.queryByText('Failed')).toBeNull();
  });
});
