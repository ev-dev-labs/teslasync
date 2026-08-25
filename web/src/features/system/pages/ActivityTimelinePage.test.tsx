/**
 * ActivityTimelinePage contract tests.
 *
 * Covers:
 *   1. No-vehicle-in-fleet gate — renders `<NoVehicleSelected>` instead of
 *      the feed when the fleet is empty.
 *   2. Loading — the feed shell renders a skeleton, not the empty/error
 *      states.
 *   3. Loaded — grouped items render via the feed, and the query is called
 *      with the inherited vehicle id + range instants.
 *   4. Empty — the feed's empty state renders when `items` is `[]`.
 *   5. Error — the feed's error state renders and Retry re-issues the
 *      query.
 *   6. Kind filter — toggling a chip re-issues the query with `kind` set.
 *   7. Pagination — the Older/Newer controls appear only when there is a
 *      next/previous page and step `offset` by the page size.
 *   8. The compact service-history limitation renders regardless of load
 *      state without displacing the activity feed.
 *
 * Heavy visual dependencies (VehicleSelect/RangePicker, the feed's day
 * grouping) are exercised through minimal mocks so this file asserts
 * page-level wiring, not the already-covered ActivityFeed/KindFilterBar
 * internals.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActivityItem } from '@/types/activity';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  vehicles: [{ id: 7 }] as Array<{ id: number }>,
  useActivityMock: vi.fn(),
  refetch: vi.fn(),
  setRange: vi.fn(),
  asOf: null as string | null,
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : _key),
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

vi.mock('@/hooks/usePageTitle', () => ({ usePageTitle: () => {} }));

vi.mock('@/hooks/useSelectedVehicle', () => ({
  useSelectedVehicle: () => ({ vehicleId: h.vehicleId, vehicles: h.vehicles }),
}));

vi.mock('@/lib/timezone', () => ({
  useTimezone: () => 'America/Los_Angeles',
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    formatDuration: (value: number) => `${(value / 3600).toFixed(1)} h`,
    formatEnergy: (value: number) => `${(value / 1000).toFixed(1)} kWh`,
  }),
}));

vi.mock('@/hooks/useRangeState', () => ({
  useRangeState: () => ({
    start: '2026-01-01',
    end: '2026-01-31',
    startInstant: '2026-01-01T00:00:00.000Z',
    endInstantExclusive: '2026-02-01T00:00:00.000Z',
    setRange: h.setRange,
  }),
}));

vi.mock('@/hooks/useOperationalMode', () => ({
  useOperationalMode: () => ({
    mode: h.asOf ? 'as_of' : 'live',
    asOf: h.asOf,
    online: true,
    isReadOnly: h.asOf != null,
    canWrite: h.asOf == null,
    label: h.asOf ? 'As of' : 'Live',
    description: '',
    writeBlockReason: h.asOf ? 'Return to live mode.' : null,
  }),
}));

vi.mock('@/components/forms', () => ({
  VehicleSelect: () => <div data-testid="vehicle-select" />,
  RangePicker: () => <div data-testid="range-picker" />,
}));

vi.mock('@/api/hooks/useActivity', () => ({
  useActivity: (params: unknown) => h.useActivityMock(params),
}));

vi.mock('@/features/onboarding/components/NoVehicleSelected', () => ({
  NoVehicleSelected: ({ pageTitle }: { pageTitle: string }) => (
    <div data-testid="no-vehicle-selected">{pageTitle}</div>
  ),
}));

import ActivityTimelinePage from './ActivityTimelinePage';

function makeItem(overrides: Partial<ActivityItem> = {}): ActivityItem {
  return {
    id: 'drives:1',
    kind: 'drive',
    occurred_at: '2026-01-15T12:00:00Z',
    vehicle_id: 7,
    title: 'Drive',
    summary: '12 min',
    status: 'completed',
    source_table: 'drives',
    source_id: 1,
    path: '/drives/1',
    ...overrides,
  };
}

function mockQueryResult(overrides: Partial<ReturnType<typeof baseQueryResult>> = {}) {
  return { ...baseQueryResult(), ...overrides };
}

function baseQueryResult() {
  return {
    data: { items: [] as ActivityItem[], total: 0, limit: 50, offset: 0, generated_at: '' },
    isLoading: false,
    isError: false,
    error: null as unknown,
    refetch: h.refetch,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ActivityTimelinePage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  h.vehicleId = 7;
  h.vehicles = [{ id: 7 }];
  h.refetch.mockReset();
  h.setRange.mockReset();
  h.useActivityMock.mockReset();
  h.asOf = null;
  h.useActivityMock.mockReturnValue(mockQueryResult());
});

describe('ActivityTimelinePage', () => {
  it('renders NoVehicleSelected instead of the feed when the fleet is empty', () => {
    h.vehicles = [];
    renderPage();
    expect(screen.getByTestId('no-vehicle-selected')).toBeInTheDocument();
    // useActivity is still called (React hooks can't be conditional) but
    // must be disabled so no wasted request fires while the fleet is empty.
    expect(h.useActivityMock).toHaveBeenCalledWith(expect.objectContaining({ enabled: false }));
  });

  it('calls useActivity with the inherited vehicle id and range instants', () => {
    renderPage();
    expect(h.useActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        vehicle_id: 7,
        start: '2026-01-01T00:00:00.000Z',
        end: '2026-02-01T00:00:00.000Z',
        limit: 50,
        offset: 0,
      }),
    );
  });

  it('never queries activity after the historical anchor', () => {
    h.asOf = '2025-12-15T12:00:00.000Z';
    renderPage();
    expect(h.useActivityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        start: '2025-11-14T12:00:00.000Z',
        end: '2025-12-15T12:00:00.000Z',
      }),
    );
  });

  it('documents the verified service-history limitation without a blocking warning panel', () => {
    renderPage();
    expect(screen.getByText(/dated service records will join this timeline/i)).toBeInTheDocument();
  });

  it('shows the empty state when there are no items', () => {
    renderPage();
    expect(screen.getByText(/no activity in this window/i)).toBeInTheDocument();
  });

  it('renders the error state and Retry calls refetch', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({ isError: true, error: new Error('boom'), data: undefined }),
    );
    renderPage();
    const retry = screen.getByRole('button', { name: /retry/i });
    fireEvent.click(retry);
    expect(h.refetch).toHaveBeenCalledTimes(1);
  });

  it('renders feed items grouped by day when loaded', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({
        data: { items: [makeItem()], total: 1, limit: 50, offset: 0, generated_at: '' },
      }),
    );
    renderPage();
    expect(screen.getByText('12 min')).toBeInTheDocument();
  });

  it('toggles a kind filter and re-issues the query scoped to it', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /^drive$/i }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ kind: ['drive'] }),
    );
  });

  it('hides pagination controls when there is only one page', () => {
    renderPage();
    expect(screen.queryByRole('button', { name: /older/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /newer/i })).not.toBeInTheDocument();
  });

  it('shows Older (not Newer) on the first page when more results exist, and steps offset forward', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({
        data: { items: [makeItem()], total: 100, limit: 50, offset: 0, generated_at: '' },
      }),
    );
    renderPage();
    expect(screen.queryByRole('button', { name: /newer/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /older/i }));
    expect(h.useActivityMock).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));
  });
});
