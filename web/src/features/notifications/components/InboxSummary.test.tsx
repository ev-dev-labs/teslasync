/**
 * InboxSummary contract tests.
 *
 * InboxSummary is a presentational KPI band: it receives a TanStack
 * `UseQueryResult<NotificationLog[]>` as a prop and never fetches itself, so
 * the tests drive it with hand-built query objects rather than mocking the
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
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { UseQueryResult } from '@tanstack/react-query';
import '../../../i18n';

import { InboxSummary } from './InboxSummary';
import type { NotificationLog } from '@/api/types';

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

function makeQuery(
  overrides: Partial<UseQueryResult<NotificationLog[], Error>> = {},
): UseQueryResult<NotificationLog[], Error> {
  return {
    data: undefined,
    error: null,
    isLoading: false,
    isPending: false,
    isFetching: false,
    isError: false,
    isSuccess: false,
    refetch: vi.fn(),
    ...overrides,
  } as unknown as UseQueryResult<NotificationLog[], Error>;
}

function renderSummary(query: UseQueryResult<NotificationLog[], Error>) {
  return render(
    <MemoryRouter>
      <InboxSummary query={query} />
    </MemoryRouter>,
  );
}

function getRegion() {
  return screen.getByRole('region', { name: /inbox summary/i });
}

// Read a MetricCard's rendered value by its (unique) label text. The label
// lives in a <span> inside <p class="metric-label">; the value is that
// paragraph's immediate sibling.
function cardValue(label: string): string {
  const labelParagraph = screen.getByText(label).closest('p');
  return labelParagraph?.nextElementSibling?.textContent ?? '';
}

describe('InboxSummary — loading & error states', () => {
  it('renders a six-card skeleton grid inside the labelled region on first load', () => {
    renderSummary(makeQuery({ isLoading: true, isPending: true, isFetching: true }));

    expect(getRegion()).toBeInTheDocument();
    const skeleton = screen.getByTestId('stat-grid-skeleton');
    expect(skeleton).toHaveAttribute('aria-busy', 'true');
    expect(skeleton.querySelectorAll('.animate-pulse')).toHaveLength(6);
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
    expect(cardValue('Total')).toBe('1');
    expect(screen.queryByTestId('stat-grid-skeleton')).not.toBeInTheDocument();
  });

  it('renders a QueryError alert and retries on demand when the query fails', () => {
    const refetch = vi.fn();
    renderSummary(makeQuery({ isError: true, error: new Error('boom'), refetch }));

    expect(getRegion()).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    // Error branch replaces the KPI cards entirely.
    expect(screen.queryByText('Total')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('InboxSummary — empty states', () => {
  it('shows an empty-state placeholder when the backlog is empty', () => {
    renderSummary(makeQuery({ isSuccess: true, data: [] }));

    expect(getRegion()).toBeInTheDocument();
    expect(screen.getByText('No notifications yet')).toBeInTheDocument();
    expect(screen.queryByText('Total')).not.toBeInTheDocument();
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

    expect(cardValue('Total')).toBe('5');
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

    expect(cardValue('Total')).toBe('2');
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

    expect(cardValue('Total')).toBe('2');
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
    expect(cardValue('Total')).toBe('1');
  });
});
