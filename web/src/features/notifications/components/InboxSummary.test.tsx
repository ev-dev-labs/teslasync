/**
 * InboxSummary contract tests.
 *
 * InboxSummary is a presentational KPI band: it receives a TanStack
 * `UseQueryResult<NotificationLog[]>` as a prop and never fetches itself, so
 * the tests drive it with real query-observer snapshots rather than mocking the
 * network. Coverage:
 *   1. First-load skeleton grid (6 cards) inside the labelled region, no KPIs.
 *   2. Background refetch with cached data keeps the KPIs on screen (firstLoad
 *      guard) rather than flashing an empty skeleton.
 *   3. Error branch renders a QueryError alert; Retry calls refetch().
 *   4. Empty backlog → EmptyState placeholder, region still visible.
 *   5. Undefined data (idle query) is treated as empty (null-safety).
 *   6. Populated aggregation: total / unread (+ "N of M" subtitle) / severity
 *      buckets / relative "last received".
 *   7. Null-safety: unknown severities are not miscounted, missing read_at
 *      counts as unread, all-invalid timestamps fall back to the em-dash.
 *   8. a11y: labelled landmark region with decorative (aria-hidden) icons.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryObserver, type UseQueryResult } from '@tanstack/react-query';
import '../../../i18n';

import { InboxSummary } from './InboxSummary';
import type { NotificationLog } from '@/api/types';
import { formatDateTime } from '@/lib/dateFormat';

let logId = 1;
function makeLog(overrides: Partial<NotificationLog> = {}): NotificationLog {
  return {
    id: logId++,
    channel_id: 1,
    alert_id: 10,
    title: 'Tire pressure low',
    message: 'Front-left tire below 30 PSI',
    status: 'sent',
    severity: 'info',
    error: '',
    created_at: new Date().toISOString(),
    sent_at: null,
    read_at: null,
    archived_at: null,
    ...overrides,
  };
}

interface QueryOverrides {
  data?: NotificationLog[];
  error?: Error | null;
  isLoading?: boolean;
  isPending?: boolean;
  isFetching?: boolean;
  isError?: boolean;
  isSuccess?: boolean;
  fetchStatus?: UseQueryResult<NotificationLog[], Error>['fetchStatus'];
  dataUpdatedAt?: number;
  refetch?: UseQueryResult<NotificationLog[], Error>['refetch'];
}

function makeQuery(overrides: QueryOverrides = {}): UseQueryResult<NotificationLog[], Error> {
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: Infinity } } });
  const queryKey = ['inbox-summary-fixture'];
  const query = client.getQueryCache().build<NotificationLog[], Error>(client, { queryKey });
  query.setState({
    data: overrides.data,
    error: overrides.error ?? null,
    status: overrides.error || overrides.isError ? 'error'
      : overrides.data === undefined ? 'pending' : 'success',
    fetchStatus: overrides.fetchStatus ?? (overrides.isFetching ? 'fetching' : 'idle'),
    dataUpdatedAt: overrides.dataUpdatedAt ?? 0,
  });
  const observer = new QueryObserver<NotificationLog[], Error>(client, { queryKey, enabled: false });
  const result = observer.getCurrentResult();
  return {
    ...result,
    refetch: overrides.refetch ?? vi.fn<UseQueryResult<NotificationLog[], Error>['refetch']>(),
  };
}

function renderSummary(query: UseQueryResult<NotificationLog[], Error>, archived = false) {
  return render(
    <MemoryRouter>
      <InboxSummary query={query} archived={archived} />
    </MemoryRouter>,
  );
}

function getRegion() {
  return screen.getByRole('region', { name: /inbox summary/i });
}

// Scope the canonical value to its metric rather than old card DOM siblings.
function cardValue(label: string): string {
  const tile = screen.getByText(label).closest('[data-operational-metric]');
  return tile?.querySelector('[data-operational-value]')?.textContent ?? '';
}

describe('InboxSummary — loading & error states', () => {
  it('retains compact metrics after a failed cached refresh', () => {
    renderSummary(makeQuery({
      data: [makeLog({ severity: 'critical' })],
      isError: true,
      error: new Error('Refresh failed'),
    }));
    expect(cardValue('Recent notifications')).toBe('1');
    expect(cardValue('Critical')).toBe('1');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
  it('renders a six-card skeleton grid inside the labelled region on first load', () => {
    renderSummary(makeQuery({ isLoading: true, isPending: true, isFetching: true }));

    expect(getRegion()).toBeInTheDocument();
    const skeleton = screen.getByTestId('notification-backlog-brief');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton.querySelectorAll('[data-operational-metric]')).toHaveLength(6);
    expect(skeleton.querySelectorAll('[data-operational-value]')).toHaveLength(0);
    // No KPI cards while first-loading.
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
  });

  it('keeps the KPI cards on screen during a background refetch that has data', () => {
    renderSummary(
      makeQuery({
        isLoading: true,
        isFetching: true,
        data: [makeLog({ severity: 'critical' })],
      }),
    );

    // Cached data wins over the skeleton — the band stays populated.
    expect(cardValue('Recent notifications')).toBe('1');
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });

  it('renders a QueryError alert and retries on demand when the query fails', () => {
    const refetch = vi.fn();
    renderSummary(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    expect(getRegion()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Error branch replaces the KPI cards entirely.
    expect(screen.queryByText('Recent notifications')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('InboxSummary — accepted severity aliases and archived scope', () => {
  it('counts accepted warning aliases without changing source rows or unknown severity', () => {
    const data = [
      makeLog({ severity: 'warn' }),
      makeLog({ severity: ' Warning ' }),
      makeLog({ severity: 'WARN' }),
      makeLog({ severity: 'debug' }),
    ];
    const original = data.map((row) => ({ ...row }));
    renderSummary(makeQuery({ data }));

    expect(cardValue('Warnings')).toBe('3');
    expect(cardValue('Recent notifications')).toBe('4');
    expect(data).toEqual(original);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('1 with unknown severity');
  });

  it('does not reinterpret other unknown active severity values as confirmed critical or info', () => {
    renderSummary(makeQuery({ data: [
      makeLog({ severity: ' CRITICAL ' }),
      makeLog({ severity: 'INFO' }),
    ] }));

    expect(cardValue('Critical')).toBe('0');
    expect(cardValue('Info')).toBe('0');
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('2 with unknown severity');
  });

  it('keeps archive timestamps, normalized counts and bounded all-time provenance', () => {
    const archivedAt = new Date(Date.now() - 5 * 60_000).toISOString();
    renderSummary(makeQuery({ data: [
      makeLog({ severity: ' Warning ', archived_at: archivedAt, created_at: '' }),
      makeLog({ severity: ' CRITICAL ', archived_at: 'not-a-date', created_at: '2026-10-08T12:00:00Z' }),
    ] }), true);

    expect(screen.getByRole('region', { name: 'Archived summary' })).toBeInTheDocument();
    expect(cardValue('Total archived')).toBe('2');
    expect(cardValue('Warnings')).toBe('1');
    expect(cardValue('Critical')).toBe('1');
    expect(cardValue('Last archived')).toMatch(/ago/i);
    fireEvent.click(screen.getByRole('button', { name: 'Review details' }));
    expect(screen.getByRole('dialog')).toHaveTextContent('Latest 50 archived entries · all time');
    expect(screen.getByRole('dialog')).toHaveTextContent('not the workspace period or the server total');
    expect(screen.getByRole('dialog')).toHaveTextContent(formatDateTime(new Date(archivedAt)));
  });

  it('retains cached metrics and explicit paused trust instead of claiming a loaded fresh sample', () => {
    renderSummary(makeQuery({ data: [makeLog()], fetchStatus: 'paused' }));

    expect(cardValue('Recent notifications')).toBe('1');
    expect(screen.getByTestId('stale-refresh-warning')).toBeInTheDocument();
    expect(screen.getByText('Refresh paused')).toBeInTheDocument();
    expect(screen.queryByText('Sample loaded')).not.toBeInTheDocument();
  });

  it('preserves the active empty-state action destination', () => {
    renderSummary(makeQuery({ data: [] }));

    expect(screen.getByRole('link', { name: 'Manage alert rules' })).toHaveAttribute('href', '/notifications/rules');
  });

  it('preserves the archived empty-state action destination', () => {
    renderSummary(makeQuery({ data: [] }), true);

    expect(screen.getByText('No archived notifications yet')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to inbox' })).toHaveAttribute('href', '/notifications/inbox');
  });
});

describe('InboxSummary — empty states', () => {
  it('shows an empty-state placeholder when the backlog is empty', () => {
    renderSummary(makeQuery({ isSuccess: true, data: [] }));

    expect(getRegion()).toBeInTheDocument();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.queryByText('Recent notifications')).not.toBeInTheDocument();
  });

  it('treats an idle query with undefined data as empty (null-safety)', () => {
    renderSummary(makeQuery());

    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    // Not loading, so no skeleton either — just the placeholder.
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });
});

describe('InboxSummary — populated aggregation', () => {
  it('aggregates totals, unread count, severity buckets and last-received time', () => {
    const now = Date.now();
    const data = [
      makeLog({ severity: 'critical', read_at: null, created_at: new Date(now - 5 * 60_000).toISOString() }),
      makeLog({ severity: 'warn', read_at: null, created_at: new Date(now - 10 * 60_000).toISOString() }),
      makeLog({ severity: 'warn', read_at: new Date(now - 60 * 60_000).toISOString(), created_at: new Date(now - 60 * 60_000).toISOString() }),
      makeLog({ severity: 'info', read_at: new Date(now - 120 * 60_000).toISOString(), created_at: new Date(now - 120 * 60_000).toISOString() }),
      // Unknown severity: counted in total + unread, but no severity bucket.
      makeLog({ severity: undefined, read_at: null, created_at: new Date(now - 30 * 60_000).toISOString() }),
    ];
    renderSummary(makeQuery({ isSuccess: true, data }));

    expect(cardValue('Recent notifications')).toBe('5');
    expect(cardValue('Unread')).toBe('3');
    expect(cardValue('Critical')).toBe('1');
    expect(cardValue('Warnings')).toBe('2');
    expect(cardValue('Info')).toBe('1');
    // "N of M" subtitle on the unread card.
    expect(screen.getByText('3 of 5')).toBeInTheDocument();
    // Last received tracks the most-recent created_at (5 min ago) → relative.
    expect(cardValue('Last received')).toMatch(/ago/i);
  });

  it('reports a fully-read backlog as zero unread while keeping the total', () => {
    const readAt = new Date().toISOString();
    const data = [
      makeLog({ severity: 'info', read_at: readAt }),
      makeLog({ severity: 'critical', read_at: readAt }),
    ];
    renderSummary(makeQuery({ isSuccess: true, data }));

    expect(cardValue('Recent notifications')).toBe('2');
    expect(cardValue('Unread')).toBe('0');
    expect(screen.getByText('0 of 2')).toBeInTheDocument();
  });
});

describe('InboxSummary — null-safety & accessibility', () => {
  it('handles unknown severities and missing timestamps without miscounting', () => {
    const data = [
      makeLog({ severity: 'debug', read_at: null, created_at: '' }),
      makeLog({ severity: undefined, read_at: null, created_at: 'not-a-date' }),
    ];
    renderSummary(makeQuery({ isSuccess: true, data }));

    expect(cardValue('Recent notifications')).toBe('2');
    // Neither row lands in a severity bucket.
    expect(cardValue('Critical')).toBe('0');
    expect(cardValue('Warnings')).toBe('0');
    expect(cardValue('Info')).toBe('0');
    // Both rows are unread (no read_at).
    expect(cardValue('Unread')).toBe('2');
    // No valid created_at anywhere → em-dash placeholder, never a blank cell.
    expect(cardValue('Last received')).toBe('—');
  });

  it('exposes the band as a labelled region with decorative icons', () => {
    const { container } = renderSummary(
      makeQuery({ isSuccess: true, data: [makeLog({ severity: 'critical' })] }),
    );

    expect(getRegion()).toHaveAttribute('aria-label', 'Inbox summary');
    // Card icons are purely decorative — hidden from the a11y tree so the
    // metric label + value carry the meaning.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBeGreaterThan(0);
    expect(cardValue('Recent notifications')).toBe('1');
  });

  it('reviews the bounded sample, unread denominator, full timestamp, and severity uncertainty in the real drawer', () => {
    renderSummary(makeQuery({ isSuccess: true, data: [
      makeLog({ severity: 'critical', read_at: null, created_at: '2026-08-04T12:00:00Z' }),
      makeLog({ severity: 'debug', read_at: '2026-08-04T13:00:00Z' }),
    ] }));
    const brief = screen.getByTestId('notification-backlog-brief');
    expect(brief).toHaveAttribute('data-operational-brief');
    expect(brief.querySelector('[data-operational-metric="inbox-unread"]')).toHaveAttribute('data-value-state', 'value');
    fireEvent.click(within(brief).getByRole('button', { name: 'Review details' }));
    const drawer = screen.getByRole('dialog');
    expect(drawer).toHaveTextContent('Latest 50 active entries · all time');
    expect(drawer).toHaveTextContent('not the workspace period or the server total');
    expect(drawer).toHaveTextContent('1 of 2');
    expect(drawer).toHaveTextContent('1 with unknown severity');
    expect(drawer).toHaveTextContent('Last received');
  });
});
