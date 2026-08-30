/**
 * BackupMonitorWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans a single hook (`useBackupRuns`) into three responsive
 * layouts (compact 1×2 / standard 2×2 / wide ≥4-col) plus five pure display
 * helpers. This suite drives every export:
 *
 *   - the pure helpers (`fmtBytes`, `fmtRelativeTime`, `statusVariant`,
 *     `statusLabel`, `statusDotColor`) are unit-tested across ALL branches and
 *     the hardened edge cases (non-finite / out-of-range bytes that used to
 *     render "<n> undefined", i18n-threaded relative time, invalid dates);
 *   - the component is exercised through its accessible surface for the
 *     loading / empty / happy paths of each layout, the sort-by-newest logic
 *     (incl. the `toEpoch` invalid-date guard), the icon-only status dot's
 *     accessible name, decorative-dot hiding, and the refresh interaction.
 *
 * `useBackupRuns` is mocked at the hook boundary so no network is touched.
 * `react-i18next` is stubbed to echo the English fallback and interpolate
 * `{{count}}` so assertions target rendered copy. `@testing-library/user-event`
 * is not installed in this repo (see the sibling admin devtools suites), so the
 * one interaction goes through `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so the count-bearing relative-time strings render as real copy.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string, opts?: Record<string, unknown>) => {
      const base = typeof fallback === 'string' ? fallback : key;
      if (opts && typeof opts === 'object') {
        return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in opts ? String(opts[name]) : `{{${name}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The single data source becomes a controllable vi.fn.
vi.mock('@/api/hooks/useAdmin', () => ({
  useBackupRuns: vi.fn(),
}));

import BackupMonitorWidget, {
  fmtBytes,
  fmtRelativeTime,
  statusVariant,
  statusLabel,
  statusDotColor,
} from './BackupMonitorWidget';
import { useBackupRuns } from '@/api/hooks/useAdmin';
import type { BackupRun } from '@/types/admin';
import type { WidgetSize } from './types';

const mockUseBackupRuns = vi.mocked(useBackupRuns);

// jsdom lacks matchMedia; framer-motion's useReducedMotion (via <DataFreshness>
// inside <WidgetShell>) reads it.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Identity translate matching the component's `TranslateFn` contract. */
const tid = (key: string, fallback?: string, opts?: Record<string, unknown>): string => {
  const base = typeof fallback === 'string' ? fallback : key;
  if (opts) {
    return base.replace(/{{(\w+)}}/g, (_m, name: string) =>
      name in opts ? String(opts[name]) : `{{${name}}}`,
    );
  }
  return base;
};

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

let runSeq = 0;
function makeRun(over: Partial<BackupRun> = {}): BackupRun {
  runSeq += 1;
  return {
    id: `run-${runSeq}`,
    configId: 'cfg-1',
    status: 'completed',
    backupType: 'full',
    fileSize: 1024 * 1024,
    createdAt: '2024-05-01T00:00:00Z',
    completedAt: '2024-05-01T00:05:00Z',
    durationMs: 1234,
    ...over,
  };
}

function renderWidget(size: WidgetSize) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BackupMonitorWidget size={size} />
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 4, rows: 2 };

beforeEach(() => {
  runSeq = 0;
  vi.clearAllMocks();
  mockUseBackupRuns.mockReturnValue(qr({ data: [] }));
});

// ── Pure helpers ──────────────────────────────────────────────────────────

describe('fmtBytes', () => {
  it('formats each unit tier and rounds ≥10 vs <10 distinctly', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(fmtBytes(15 * 1024 * 1024)).toBe('15 MB');
    expect(fmtBytes(1.5 * 1024 * 1024 * 1024)).toBe('1.5 GB');
  });

  it('guards zero / negative / non-finite and clamps out-of-range without "undefined"', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(-42)).toBe('0 B');
    expect(fmtBytes(Number.NaN)).toBe('0 B');
    expect(fmtBytes(Number.POSITIVE_INFINITY)).toBe('0 B');
    // Sub-1 byte would produce a negative unit index → previously "512 undefined".
    expect(fmtBytes(0.5)).toBe('0.5 B');
    // Beyond TB clamps to the top tier instead of indexing past the array.
    const huge = fmtBytes(5 * 1024 ** 5);
    expect(huge).toContain('TB');
    expect(huge).not.toContain('undefined');
  });
});

describe('fmtRelativeTime', () => {
  it('returns the em-dash placeholder for nullish or unparseable input', () => {
    expect(fmtRelativeTime(null, tid)).toBe('—');
    expect(fmtRelativeTime('not-a-real-date', tid)).toBe('—');
  });

  it('buckets into just-now / minutes / hours / days and treats the future as just now', () => {
    const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
    expect(fmtRelativeTime(ago(30 * 1000), tid)).toBe('just now');
    expect(fmtRelativeTime(ago(5 * 60 * 1000), tid)).toBe('5m ago');
    expect(fmtRelativeTime(ago(3 * 60 * 60 * 1000), tid)).toBe('3h ago');
    expect(fmtRelativeTime(ago(2 * 24 * 60 * 60 * 1000), tid)).toBe('2d ago');
    expect(fmtRelativeTime(new Date(Date.now() + 60_000).toISOString(), tid)).toBe('just now');
  });
});

describe('statusVariant / statusLabel / statusDotColor', () => {
  it('maps each status to the right badge variant, defaulting unknowns to danger', () => {
    expect(statusVariant('completed')).toBe('success');
    expect(statusVariant('running')).toBe('warning');
    expect(statusVariant('queued')).toBe('warning');
    expect(statusVariant('failed')).toBe('danger');
    expect(statusVariant('mystery')).toBe('danger');
  });

  it('translates each status label, defaulting unknowns to Failed', () => {
    expect(statusLabel('completed', tid)).toBe('Success');
    expect(statusLabel('running', tid)).toBe('Running');
    expect(statusLabel('queued', tid)).toBe('Queued');
    expect(statusLabel('failed', tid)).toBe('Failed');
    expect(statusLabel('mystery', tid)).toBe('Failed');
  });

  it('picks the semantic dot colour per status', () => {
    expect(statusDotColor('completed')).toContain('bg-green-500');
    expect(statusDotColor('running')).toContain('bg-amber-400');
    expect(statusDotColor('queued')).toContain('bg-amber-400');
    expect(statusDotColor('failed')).toContain('bg-red-500');
  });
});

// ── Component: states ─────────────────────────────────────────────────────

describe('BackupMonitorWidget states', () => {
  it('renders a skeleton (no title, no empty copy) while loading', () => {
    mockUseBackupRuns.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('No backup data')).toBeNull();
    expect(screen.queryByText('Backup Monitor')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there are no runs — standard', () => {
    mockUseBackupRuns.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);
    const empty = screen.getByText('No backup data');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });

  it('shows an empty state when there are no runs — compact', () => {
    mockUseBackupRuns.mockReturnValue(qr({ data: [] }));
    renderWidget(COMPACT);
    expect(screen.getByText('No backup data')).toBeInTheDocument();
  });
});

// ── Component: standard layout ────────────────────────────────────────────

describe('BackupMonitorWidget standard layout', () => {
  it('renders the title, stat grid, formatted size and a success badge for a completed run', () => {
    mockUseBackupRuns.mockReturnValue(
      qr({ data: [makeRun({ status: 'completed', fileSize: 5 * 1024 * 1024, backupType: 'full' })] }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Backup Monitor')).toBeInTheDocument();
    expect(screen.getByText('Last backup')).toBeInTheDocument();
    expect(screen.getByText('Backup Size')).toBeInTheDocument();
    expect(screen.getByText('Type')).toBeInTheDocument();
    expect(screen.getByText('5.0 MB')).toBeInTheDocument();
    expect(screen.getByText('full')).toBeInTheDocument();
    expect(screen.getByText('Success')).toBeInTheDocument();
    // Recent-runs list is wide-only.
    expect(screen.queryByText('Recent Runs')).toBeNull();
  });

  it('shows a Failed badge and the danger tint when the latest run failed', () => {
    mockUseBackupRuns.mockReturnValue(qr({ data: [makeRun({ status: 'failed' })] }));
    renderWidget(STANDARD);

    expect(screen.getByText('Failed')).toBeInTheDocument();
    const statusTile = screen.getByText('Status').closest('div');
    expect(statusTile?.className).toContain('bg-red-500/10');
  });

  it('selects the newest run as "latest" regardless of input order', () => {
    const older = makeRun({ completedAt: '2024-01-01T00:00:00Z', backupType: 'older-type' });
    const newer = makeRun({ completedAt: '2024-03-01T00:00:00Z', backupType: 'newer-type' });
    mockUseBackupRuns.mockReturnValue(qr({ data: [older, newer] }));
    renderWidget(STANDARD);
    // The "Type" stat card reflects the newest run.
    expect(screen.getByText('newer-type')).toBeInTheDocument();
  });

  it('does not crash on invalid timestamps and still picks the valid newest run', () => {
    const broken = makeRun({ completedAt: 'garbage', createdAt: 'also-garbage', backupType: 'broken' });
    const valid = makeRun({ completedAt: '2024-06-01T00:00:00Z', backupType: 'valid-latest' });
    mockUseBackupRuns.mockReturnValue(qr({ data: [valid, broken] }));
    renderWidget(STANDARD);
    expect(screen.getByText('valid-latest')).toBeInTheDocument();
  });
});

// ── Component: compact layout (a11y) ──────────────────────────────────────

describe('BackupMonitorWidget compact layout', () => {
  it('drops the title and exposes the status dot with an accessible status name', () => {
    mockUseBackupRuns.mockReturnValue(qr({ data: [makeRun({ status: 'completed' })] }));
    renderWidget(COMPACT);

    expect(screen.queryByText('Backup Monitor')).toBeNull();
    expect(screen.getByText('Last backup')).toBeInTheDocument();
    // Icon-only status indicator carries its meaning for screen readers.
    const dot = screen.getByRole('img', { name: 'Success' });
    expect(dot).toBeInTheDocument();
    expect(dot.className).toContain('bg-green-500');
  });
});

// ── Component: wide layout ────────────────────────────────────────────────

describe('BackupMonitorWidget wide layout', () => {
  it('lists recent runs with duration, keeps the row dots decorative, and sorts newest first', () => {
    const a = makeRun({ status: 'completed', completedAt: '2024-02-01T00:00:00Z', durationMs: 4321 });
    const b = makeRun({ status: 'failed', completedAt: '2024-04-01T00:00:00Z', durationMs: null });
    mockUseBackupRuns.mockReturnValue(qr({ data: [a, b] }));
    renderWidget(WIDE);

    expect(screen.getByText('Recent Runs')).toBeInTheDocument();
    // Duration is appended for runs that have one.
    expect(screen.getByText(/·\s*4321ms/)).toBeInTheDocument();
    // Per-row status dots are decorative — the sibling Badge conveys status —
    // so no dot is exposed as an image to assistive tech in this layout.
    expect(screen.queryAllByRole('img')).toHaveLength(0);
    // Both run statuses surface as badges. The failed run is newest, so it
    // also drives the top status tile → two "Failed" chips; "Success" once.
    expect(screen.getAllByText('Failed').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText('Success').length).toBeGreaterThanOrEqual(1);
  });
});

// ── Component: refresh interaction ────────────────────────────────────────

describe('BackupMonitorWidget refresh', () => {
  it('invokes refetch when the freshness refresh control is activated', () => {
    const refetch = vi.fn();
    mockUseBackupRuns.mockReturnValue(qr({ data: [makeRun()], refetch }));
    renderWidget(STANDARD);

    const refresh = screen.getByRole('button', { name: /^Refresh/i });
    fireEvent.click(refresh);
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});
