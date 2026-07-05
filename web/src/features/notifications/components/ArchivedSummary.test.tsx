/**
 * ArchivedSummary — the always-on KPI band above the Archived notifications
 * page. This suite pins every facet of the band against its passed-in
 * TanStack query result:
 *   • the loaded band renders all six metric cards (total / critical / warn /
 *     info / unread / last-archived) with the exact aggregates derived off the
 *     `query.data` rows;
 *   • "Last archived" reflects the newest `archived_at` as a relative label and
 *     collapses to an em-dash when no row carries an archive timestamp;
 *   • severity bucketing is case- and whitespace-insensitive — the hardening —
 *     so `CRITICAL`, ` warn `, `Warn`, `INFO` all land in the right bucket;
 *   • the loading branch swaps the whole band for a stat-grid skeleton and
 *     shows none of the metric labels while keeping the labelled region;
 *   • the error branch surfaces the shared QueryError with a Retry that calls
 *     `query.refetch()`;
 *   • the empty branch (and the null-safe `data === undefined` branch) render a
 *     single EmptyState, never a blank panel;
 *   • a11y: the band is a labelled `region` and every lucide glyph is
 *     decorative and hidden from assistive tech.
 *
 * react-i18next is mocked to echo the English fallback so labels are
 * deterministic. framer-motion is mocked to a passthrough because the
 * `@/components/data-display` barrel this file pulls in ships motion-driven
 * components; the mock keeps module load hermetic even though the band renders
 * no motion itself.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { UseQueryResult } from '@tanstack/react-query';

import type { NotificationLog } from '@/api/types';

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get: () => (props: Record<string, unknown>) => {
        const Component = (props.as as string) ?? 'div';
        const { children, ...rest } = props as { children?: unknown } & Record<string, unknown>;
        return <Component {...(rest as Record<string, unknown>)}>{children as ReactNode}</Component>;
      },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
  useReducedMotion: () => true,
  useInView: () => true,
  useMotionValue: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useSpring: (v: unknown) => ({ get: () => v, set: vi.fn(), on: vi.fn() }),
  useTransform: () => ({ get: () => 0, set: vi.fn(), on: vi.fn() }),
  animate: vi.fn(() => ({ stop: vi.fn() })),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string, opts?: Record<string, unknown>) => {
      let out = fallback ?? _key;
      if (opts) {
        for (const [k, v] of Object.entries(opts)) {
          out = out.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
        }
      }
      return out;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

import { ArchivedSummary } from './ArchivedSummary';

const HOUR_MS = 3_600_000;
/** ISO timestamp `h` hours before now. */
const hoursAgo = (h: number) => new Date(Date.now() - h * HOUR_MS).toISOString();

/** Build a well-formed archived NotificationLog; every field is overridable. */
function makeLog(over: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: 1,
    channel_id: 1,
    alert_id: 10,
    title: 'Archived alert',
    message: 'Body copy',
    status: 'sent',
    severity: 'info',
    error: '',
    created_at: hoursAgo(4),
    sent_at: hoursAgo(4),
    read_at: null,
    archived_at: hoursAgo(4),
    ...over,
  };
}

/** Minimal UseQueryResult stub carrying only the fields the band reads. */
function makeQuery(
  over: Partial<UseQueryResult<NotificationLog[]>> = {},
): UseQueryResult<NotificationLog[]> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
    ...over,
  } as unknown as UseQueryResult<NotificationLog[]>;
}

function renderSummary(query: UseQueryResult<NotificationLog[]>) {
  return render(
    <MemoryRouter>
      <ArchivedSummary query={query} />
    </MemoryRouter>,
  );
}

/**
 * A representative backlog engineered so every displayed count is distinct
 * (total 8, critical 2, warn 3, info 1, unread 5) and the newest archive is
 * exactly three hours old.
 */
const LOADED_ROWS: NotificationLog[] = [
  makeLog({ id: 1, severity: 'critical', read_at: null, archived_at: hoursAgo(8) }),
  makeLog({ id: 2, severity: 'critical', read_at: hoursAgo(1), archived_at: hoursAgo(7) }),
  makeLog({ id: 3, severity: 'warn', read_at: null, archived_at: hoursAgo(6) }),
  makeLog({ id: 4, severity: 'warn', read_at: null, archived_at: hoursAgo(5) }),
  makeLog({ id: 5, severity: 'warn', read_at: hoursAgo(1), archived_at: hoursAgo(4) }),
  makeLog({ id: 6, severity: 'info', read_at: null, archived_at: hoursAgo(3) }), // newest
  makeLog({ id: 7, severity: '', read_at: null, archived_at: hoursAgo(9) }),
  makeLog({ id: 8, severity: undefined, read_at: hoursAgo(1), archived_at: hoursAgo(10) }),
];

/** Every card label, in render order (echoed English fallbacks). */
const LABELS = [
  'Total archived',
  'Critical',
  'Warnings',
  'Info',
  'Unread',
  'Last archived',
] as const;

describe('ArchivedSummary', () => {
  it('renders all six KPI cards with their labels when data is present', () => {
    renderSummary(makeQuery({ data: LOADED_ROWS }));

    for (const label of LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('derives each severity / read aggregate off the query rows', () => {
    renderSummary(makeQuery({ data: LOADED_ROWS }));

    // Distinct by construction so every assertion is unambiguous.
    expect(screen.getByText('8')).toBeInTheDocument(); // total
    expect(screen.getByText('2')).toBeInTheDocument(); // critical
    expect(screen.getByText('3')).toBeInTheDocument(); // warnings
    expect(screen.getByText('1')).toBeInTheDocument(); // info
    expect(screen.getByText('5')).toBeInTheDocument(); // unread
  });

  it('surfaces the newest archive time as a relative "last archived" label', () => {
    renderSummary(makeQuery({ data: LOADED_ROWS }));

    expect(screen.getByText('Last archived')).toBeInTheDocument();
    // Newest archived_at is exactly three hours old → "3h ago".
    expect(screen.getByText('3h ago')).toBeInTheDocument();
    expect(screen.queryByText('—')).not.toBeInTheDocument();
  });

  it('buckets severities case- and whitespace-insensitively', () => {
    const rows: NotificationLog[] = [
      makeLog({ id: 1, severity: 'CRITICAL', read_at: null }),
      makeLog({ id: 2, severity: 'Critical', read_at: hoursAgo(1) }),
      makeLog({ id: 3, severity: ' warn ', read_at: null }),
      makeLog({ id: 4, severity: 'WARN', read_at: null }),
      makeLog({ id: 5, severity: 'Warn', read_at: hoursAgo(1) }),
      makeLog({ id: 6, severity: 'INFO', read_at: null }),
    ];
    renderSummary(makeQuery({ data: rows }));

    // total 6, critical 2, warn 3, info 1 — all distinct. Without the
    // trim/lowercase normalisation these would all read 0.
    expect(screen.getByText('6')).toBeInTheDocument(); // total
    expect(screen.getByText('2')).toBeInTheDocument(); // critical
    expect(screen.getByText('3')).toBeInTheDocument(); // warnings
    expect(screen.getByText('1')).toBeInTheDocument(); // info
  });

  it('collapses "last archived" to an em-dash when no row carries an archive time', () => {
    renderSummary(
      makeQuery({ data: [makeLog({ id: 1, severity: 'info', read_at: null, archived_at: null })] }),
    );

    expect(screen.getByText('Last archived')).toBeInTheDocument();
    // Only the last-archived cell degrades; it is the sole em-dash on screen.
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('renders the skeleton and hides metric labels while loading', () => {
    renderSummary(makeQuery({ isLoading: true }));

    expect(screen.getByTestId('stat-grid-skeleton')).toBeInTheDocument();
    for (const label of LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // The labelled region is preserved so the summary never loses its name.
    expect(screen.getByRole('region', { name: 'Archived summary' })).toBeInTheDocument();
  });

  it('renders a retryable QueryError when the query fails', () => {
    const refetch = vi.fn();
    renderSummary(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    // A non-ApiError degrades to the network/unknown branch.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: 'Retry' });
    fireEvent.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('renders a single EmptyState (never a blank panel) for an empty backlog', () => {
    renderSummary(makeQuery({ data: [] }));

    expect(screen.getByText('No archived notifications yet')).toBeInTheDocument();
    expect(screen.queryByText('Total archived')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Archived summary' })).toBeInTheDocument();
  });

  it('treats an undefined data payload as empty rather than crashing', () => {
    // Neither loading nor errored, but no data yet — the null-safe `?? []`
    // must keep the band on the empty branch instead of iterating undefined.
    renderSummary(makeQuery({ data: undefined }));

    expect(screen.getByText('No archived notifications yet')).toBeInTheDocument();
  });

  it('exposes a labelled region and hides its decorative icons from a11y tools', () => {
    const { container } = renderSummary(makeQuery({ data: LOADED_ROWS }));

    expect(screen.getByRole('region', { name: 'Archived summary' })).toBeInTheDocument();
    // One decorative lucide glyph per card → at least six aria-hidden nodes.
    const hidden = container.querySelectorAll('[aria-hidden="true"]');
    expect(hidden.length).toBeGreaterThanOrEqual(6);
  });
});
