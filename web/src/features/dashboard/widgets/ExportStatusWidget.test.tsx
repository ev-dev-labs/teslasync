/**
 * ExportStatusWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans TWO reads of the same `/export/jobs` endpoint (`useExports`,
 * which types `filePath`, and `useExportJobs`, which types the fresher `status`)
 * into three responsive layouts (compact 1×N big-number / standard row list /
 * wide row list + download links) plus five pure exports. This suite drives
 * every export:
 *
 *   - the pure helpers (`fmtBytes`, `truncateFilename`,
 *     `normaliseStatusFromExport`, `normaliseStatusFromAdmin`, `mergeExportJobs`)
 *     are unit-tested across ALL branches and the hardened edge cases (non-finite
 *     / non-positive bytes that used to render "NaN GB"; trailing-slash basenames
 *     that used to render an empty string; unparseable createdAt that used to
 *     poison the sort comparator);
 *   - `mergeExportJobs` locks the two real bugs this elevation fixed:
 *     (1) the admin summary merge no longer nukes the export hook's `filePath`,
 *     and (2) the download link now points at the real backend route;
 *   - the component is exercised through its accessible surface for the
 *     loading / empty / error paths, the populated standard list (uppercase
 *     format, formatted size, per-status badges, status ordering), the wide
 *     layout's download link (correct href + accessible name, cross-hook
 *     filePath preservation, ready/filePath gating), the compact big-number
 *     summary (active count + Running/Idle badge), and the dual-source refresh.
 *
 * `useExports` + `useExportJobs` are mocked at the hook boundary so no network
 * is touched; `importActual` keeps `exportDownloadUrl` REAL so the href
 * assertion exercises the genuine URL builder. `react-i18next` is stubbed to
 * echo the English fallback and interpolate `{{var}}` tokens. `matchMedia` is
 * stubbed reduced-motion-aware so `<AnimatedNumber>` lands on its value
 * synchronously. `@testing-library/user-event` is not installed in this repo
 * (see the sibling BackupMonitorWidget suite), so interactions use `fireEvent`.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any count/time-bearing copy (DataFreshness) renders as text.
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
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data sources become controllable vi.fns. `importActual` preserves the
// modules' other exports — in particular `exportDownloadUrl`, which the widget
// uses to build the download href and which we keep REAL so the URL is genuinely
// verified (not stubbed).
vi.mock('@/api/hooks/useExports', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useExports')>(
    '@/api/hooks/useExports',
  );
  return { ...actual, useExports: vi.fn() };
});

vi.mock('@/api/hooks/useAdmin', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useAdmin')>(
    '@/api/hooks/useAdmin',
  );
  return { ...actual, useExportJobs: vi.fn() };
});

import ExportStatusWidget, {
  fmtBytes,
  truncateFilename,
  normaliseStatusFromExport,
  normaliseStatusFromAdmin,
  mergeExportJobs,
} from './ExportStatusWidget';
import { useExports } from '@/api/hooks/useExports';
import { useExportJobs } from '@/api/hooks/useAdmin';
import type { ExportJob as ExportJobExport } from '@/types/export';
import type { ExportJob as ExportJobAdmin } from '@/types/admin';
import type { WidgetSize } from './types';

const mockUseExports = vi.mocked(useExports);
const mockUseExportJobs = vi.mocked(useExportJobs);

// jsdom lacks matchMedia. Report reduced motion so <AnimatedNumber> (inside the
// compact <WidgetBigNumber>) skips its tween and lands on the target value
// synchronously, and framer-motion's useReducedMotion (via <DataFreshness>)
// suppresses its pulse. Only the reduce-motion query matches so nothing else
// is inadvertently toggled.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = ((query: string) => ({
    matches: /prefers-reduced-motion/.test(query),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: [],
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

let exSeq = 0;
function makeExport(over: Partial<ExportJobExport> = {}): ExportJobExport {
  exSeq += 1;
  return {
    id: `ex-${exSeq}`,
    format: 'csv',
    vehicleId: '1',
    fsmState: 'ready',
    filePath: `/exports/ex-${exSeq}.csv`,
    fileSize: 2048,
    createdAt: '2024-05-01T10:00:00Z',
    ...over,
  };
}

let adSeq = 0;
function makeAdmin(over: Partial<ExportJobAdmin> = {}): ExportJobAdmin {
  adSeq += 1;
  return {
    id: `ad-${adSeq}`,
    type: 'drives',
    format: 'csv',
    status: 'ready',
    recordCount: 10,
    fileSize: 2048,
    createdAt: '2024-05-01T10:00:00Z',
    ...over,
  };
}

function renderWidget(size: WidgetSize) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ExportStatusWidget size={size} />
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };
const WIDE: WidgetSize = { cols: 3, rows: 2 };

beforeEach(() => {
  exSeq = 0;
  adSeq = 0;
  vi.clearAllMocks();
  mockUseExports.mockReturnValue(qr({ data: [] }));
  mockUseExportJobs.mockReturnValue(qr({ data: [] }));
});

// ── Pure helper: fmtBytes ───────────────────────────────────────────────────

describe('fmtBytes', () => {
  it('formats each size tier with one decimal above bytes', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1024)).toBe('1.0 KB');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(fmtBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });

  it('guards zero / negative / non-finite sizes with an em-dash (never "NaN GB")', () => {
    expect(fmtBytes(0)).toBe('—');
    expect(fmtBytes(-1)).toBe('—');
    expect(fmtBytes(Number.NaN)).toBe('—');
    expect(fmtBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

// ── Pure helper: truncateFilename ───────────────────────────────────────────

describe('truncateFilename', () => {
  it('returns the basename untouched when within the length limit', () => {
    expect(truncateFilename('/exports/report.csv', 28)).toBe('report.csv');
    expect(truncateFilename('report.json', 28)).toBe('report.json');
  });

  it('collapses nullish / empty paths to an em-dash', () => {
    expect(truncateFilename(undefined, 28)).toBe('—');
    expect(truncateFilename('', 28)).toBe('—');
  });

  it('truncates an over-long basename to exactly maxLen chars with an ellipsis', () => {
    const out = truncateFilename('/exports/' + 'a'.repeat(40) + '.csv', 28);
    expect(out.length).toBe(28);
    expect(out.endsWith('…')).toBe(true);
  });

  it('falls back to the full path when the last segment is empty (trailing slash)', () => {
    // Hardened: `pop() || path` — previously rendered an empty string.
    expect(truncateFilename('a/b/c/', 28)).toBe('a/b/c/');
  });
});

// ── Pure helpers: status normalisers ────────────────────────────────────────

describe('normaliseStatusFromExport', () => {
  it('maps fsm/export vocabulary to the widget status set (case-insensitive)', () => {
    expect(normaliseStatusFromExport('processing')).toBe('processing');
    expect(normaliseStatusFromExport('running')).toBe('processing');
    expect(normaliseStatusFromExport('ready')).toBe('ready');
    expect(normaliseStatusFromExport('completed')).toBe('ready');
    expect(normaliseStatusFromExport('DONE')).toBe('ready');
    expect(normaliseStatusFromExport('failed')).toBe('failed');
    expect(normaliseStatusFromExport('error')).toBe('failed');
  });

  it('defaults unknown / empty / undefined states to queued', () => {
    expect(normaliseStatusFromExport('queued')).toBe('queued');
    expect(normaliseStatusFromExport('')).toBe('queued');
    expect(normaliseStatusFromExport(undefined)).toBe('queued');
    expect(normaliseStatusFromExport('mystery')).toBe('queued');
  });
});

describe('normaliseStatusFromAdmin', () => {
  it('maps admin statuses to the widget status set', () => {
    expect(normaliseStatusFromAdmin('processing')).toBe('processing');
    expect(normaliseStatusFromAdmin('ready')).toBe('ready');
    expect(normaliseStatusFromAdmin('failed')).toBe('failed');
  });

  it('defaults unknown / empty / undefined statuses to queued', () => {
    expect(normaliseStatusFromAdmin('queued')).toBe('queued');
    expect(normaliseStatusFromAdmin('')).toBe('queued');
    expect(normaliseStatusFromAdmin(undefined)).toBe('queued');
  });
});

// ── Pure helper: mergeExportJobs (the bug-fix surface) ──────────────────────

describe('mergeExportJobs', () => {
  it('returns an empty list when both sources are undefined or empty', () => {
    expect(mergeExportJobs(undefined, undefined)).toEqual([]);
    expect(mergeExportJobs([], [])).toEqual([]);
  });

  it('dedupes by id, taking the admin status but PRESERVING the export filePath', () => {
    // Both hooks return the same job id (same endpoint): the export hook alone
    // carries filePath; the admin summary carries the fresher status but no
    // path. Before the fix the admin entry overwrote filePath with undefined.
    const out = mergeExportJobs(
      [makeExport({ id: 'j1', fsmState: 'processing', filePath: '/exports/j1.csv' })],
      [makeAdmin({ id: 'j1', status: 'ready' })],
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('ready');
    expect(out[0].job.filePath).toBe('/exports/j1.csv');
  });

  it('keeps an export-only job together with its filePath and status', () => {
    const out = mergeExportJobs(
      [makeExport({ id: 'e1', fsmState: 'ready', filePath: '/p/e1.csv' })],
      [],
    );
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('ready');
    expect(out[0].job.filePath).toBe('/p/e1.csv');
  });

  it('orders processing → queued → ready → failed, newest-first within a status', () => {
    const out = mergeExportJobs(
      [],
      [
        makeAdmin({ id: 'ready-old', status: 'ready', createdAt: '2024-01-01T00:00:00Z' }),
        makeAdmin({ id: 'failed', status: 'failed', createdAt: '2024-06-01T00:00:00Z' }),
        makeAdmin({ id: 'processing', status: 'processing', createdAt: '2024-02-01T00:00:00Z' }),
        makeAdmin({ id: 'queued', status: 'queued', createdAt: '2024-03-01T00:00:00Z' }),
        makeAdmin({ id: 'ready-new', status: 'ready', createdAt: '2024-05-01T00:00:00Z' }),
      ],
    ).map((e) => e.job.id);
    expect(out).toEqual(['processing', 'queued', 'ready-new', 'ready-old', 'failed']);
  });

  it('does not throw and still orders sensibly when a createdAt is unparseable', () => {
    // toEpoch('not-a-date') === 0, so the valid (newer) job sorts ahead.
    const out = mergeExportJobs(
      [],
      [
        makeAdmin({ id: 'valid', status: 'ready', createdAt: '2024-05-01T00:00:00Z' }),
        makeAdmin({ id: 'broken', status: 'ready', createdAt: 'not-a-date' }),
      ],
    ).map((e) => e.job.id);
    expect(out).toEqual(['valid', 'broken']);
  });
});

// ── Component: async states ─────────────────────────────────────────────────

describe('ExportStatusWidget states', () => {
  it('renders a skeleton (no title / empty copy) while either source is loading', () => {
    mockUseExports.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Export Status')).toBeNull();
    expect(screen.queryByText('No export jobs')).toBeNull();
  });

  it('shows an empty state (never a blank panel) with the title when there are no jobs', () => {
    renderWidget(STANDARD);
    const empty = screen.getByText('No export jobs');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
    expect(screen.getByText('Export Status')).toBeInTheDocument();
  });

  it('shows an empty state when there are no jobs — compact', () => {
    renderWidget(COMPACT);
    expect(screen.getByText('No export jobs')).toBeInTheDocument();
  });

  it('degrades to the empty panel (never blank) but keeps refresh when both queries error', () => {
    mockUseExports.mockReturnValue(qr({ data: undefined, isError: true }));
    mockUseExportJobs.mockReturnValue(qr({ data: undefined, isError: true }));
    renderWidget(STANDARD);
    expect(screen.getByText('Export Status')).toBeInTheDocument();
    expect(screen.getByText('No export jobs')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Refresh' })).toBeInTheDocument();
  });
});

// ── Component: standard layout (row list) ───────────────────────────────────

describe('ExportStatusWidget standard layout', () => {
  it('renders a row with uppercase format, formatted size and the status badge', () => {
    mockUseExportJobs.mockReturnValue(
      qr({ data: [makeAdmin({ id: 'a1', format: 'csv', status: 'ready', fileSize: 2048 })] }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Export Status')).toBeInTheDocument();
    expect(screen.getByText('CSV')).toBeInTheDocument();
    expect(screen.getByText('2.0 KB')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
  });

  it('labels every status distinctly (queued/processing/ready/failed)', () => {
    mockUseExportJobs.mockReturnValue(
      qr({
        data: [
          makeAdmin({ id: 'r', status: 'ready' }),
          makeAdmin({ id: 'p', status: 'processing' }),
          makeAdmin({ id: 'f', status: 'failed' }),
          makeAdmin({ id: 'q', status: 'queued' }),
        ],
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Queued')).toBeInTheDocument();
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
  });

  it('does NOT render download links in the standard (non-wide) layout', () => {
    mockUseExports.mockReturnValue(
      qr({ data: [makeExport({ id: 'x', fsmState: 'ready', filePath: '/p/x.csv' })] }),
    );
    renderWidget(STANDARD);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
  });
});

// ── Component: wide layout (download links) ─────────────────────────────────

describe('ExportStatusWidget wide layout', () => {
  it('renders an accessible download link at the real backend route, preserving the filePath across the admin merge', () => {
    // Same id from both hooks: export carries filePath, admin carries the ready
    // status. This is exactly the shape that regressed — the link only renders
    // if the merge keeps filePath AND the href uses the canonical builder.
    mockUseExports.mockReturnValue(
      qr({ data: [makeExport({ id: 'j1', fsmState: 'ready', filePath: '/exports/j1.csv' })] }),
    );
    mockUseExportJobs.mockReturnValue(
      qr({ data: [makeAdmin({ id: 'j1', status: 'ready' })] }),
    );
    renderWidget(WIDE);

    const link = screen.getByRole('link', { name: 'Download' });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/api/v1/export/jobs/j1/download');
  });

  it('omits the download link for a ready job that has no filePath', () => {
    mockUseExportJobs.mockReturnValue(qr({ data: [makeAdmin({ id: 'a1', status: 'ready' })] }));
    renderWidget(WIDE);
    expect(screen.getByText('Done')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
  });

  it('omits the download link for a non-ready job even when it has a filePath', () => {
    mockUseExports.mockReturnValue(
      qr({ data: [makeExport({ id: 'p1', fsmState: 'processing', filePath: '/p/p1.csv' })] }),
    );
    renderWidget(WIDE);
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Download' })).toBeNull();
  });
});

// ── Component: compact layout (big-number summary) ──────────────────────────

describe('ExportStatusWidget compact layout', () => {
  it('summarises active (processing + queued) jobs with a Running badge', () => {
    mockUseExportJobs.mockReturnValue(
      qr({
        data: [
          makeAdmin({ id: 'p', status: 'processing' }),
          makeAdmin({ id: 'q', status: 'queued' }),
          makeAdmin({ id: 'r', status: 'ready' }),
        ],
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('Active Exports')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument(); // processing + queued
    // Compact renders the big number, not the per-row format badges.
    expect(screen.queryByText('CSV')).toBeNull();
  });

  it('shows an Idle badge and a zero count when nothing is active', () => {
    mockUseExportJobs.mockReturnValue(
      qr({
        data: [
          makeAdmin({ id: 'r', status: 'ready' }),
          makeAdmin({ id: 'f', status: 'failed' }),
        ],
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('Idle')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

// ── Component: refresh interaction ──────────────────────────────────────────

describe('ExportStatusWidget refresh', () => {
  it('refetches BOTH sources when the freshness refresh control is activated', () => {
    const exportsRefetch = vi.fn();
    const adminRefetch = vi.fn();
    mockUseExports.mockReturnValue(qr({ data: [makeExport()], refetch: exportsRefetch }));
    mockUseExportJobs.mockReturnValue(qr({ data: [makeAdmin()], refetch: adminRefetch }));
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(exportsRefetch).toHaveBeenCalledTimes(1);
    expect(adminRefetch).toHaveBeenCalledTimes(1);
  });
});
