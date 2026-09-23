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
import { Button } from '@/components/ui';

const h = vi.hoisted(() => ({
  vehicleId: 7 as number | null,
  vehicles: [{ id: 7 }] as Array<{ id: number }>,
  useActivityMock: vi.fn(),
  refetch: vi.fn(),
  setRange: vi.fn(),
  asOf: null as string | null,
  downloadCsv: vi.fn(),
  downloadJson: vi.fn(),
}));

vi.mock('@/lib/csvExport', () => ({
  downloadRowsAsCSV: (...args: unknown[]) => h.downloadCsv(...args),
  downloadJSON: (...args: unknown[]) => h.downloadJson(...args),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: unknown, options?: Record<string, unknown>) =>
      typeof fallback === 'string'
        ? fallback.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
            options?.[key] == null ? match : String(options[key]))
        : _key,
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
  ListExportMenu: ({ disabled, onExportCsv, onExportJson }: {
    disabled: boolean;
    onExportCsv: () => void;
    onExportJson: () => void;
  }) => (
    <div>
      <Button type="button" data-testid="activity-export-trigger" disabled={disabled}>Export</Button>
      <Button type="button" data-testid="activity-export-csv" disabled={disabled} onClick={onExportCsv}>CSV</Button>
      <Button type="button" data-testid="activity-export-json" disabled={disabled} onClick={onExportJson}>JSON</Button>
    </div>
  ),
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
  h.downloadCsv.mockReset();
  h.downloadJson.mockReset();
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

  it('does not claim to show an event when a page becomes empty after the range changes', () => {
    h.useActivityMock.mockImplementation(({ offset }: { offset: number }) =>
      mockQueryResult({
        data: {
          items: offset ? [] : [makeItem()],
          total: offset ? 20 : 75,
          limit: 50,
          offset,
          generated_at: '',
        },
      }),
    );
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /older/i }));
    expect(screen.getByText('Showing 0–0 of 20 events in the selected range')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent(
      'events 0–0 of 20',
    );
    expect(screen.getByRole('button', { name: /newer/i })).toBeInTheDocument();
  });

  it('shows range total but limits event-type and alert counts to the loaded page', () => {
    h.useActivityMock.mockReturnValue(
      mockQueryResult({
        data: { items: [makeItem(), makeItem({ id: 'notification_logs:2', kind: 'alert', severity: 'critical', source_id: 2 })], total: 75, limit: 50, offset: 0, generated_at: '' },
      }),
    );
    renderPage();
    const overview = screen.getByRole('region', { name: 'Activity overview' });
    expect(overview).toHaveTextContent('Events in selected range75');
    expect(overview).toHaveTextContent('Events on this page2');
    expect(overview).toHaveTextContent('Critical alerts on this page1');
    expect(overview).toHaveTextContent('Event types on this page');
  });

  it('exports only loaded records and preserves raw SI fields', () => {
    const item = makeItem({ duration_s: 120, energy_added_wh: 2500 });
    h.useActivityMock.mockReturnValue(
      mockQueryResult({ data: { items: [item], total: 100, limit: 50, offset: 0, generated_at: '' } }),
    );
    renderPage();
    fireEvent.click(screen.getByTestId('activity-export-csv'));
    expect(h.downloadCsv).toHaveBeenCalledWith(
      'activity-2026-01-01-2026-01-31-page-1',
      [item],
      expect.arrayContaining([expect.objectContaining({ key: 'energy_added_wh' })]),
    );
    expect(screen.getByText(/exports include only the loaded page/i)).toBeInTheDocument();
  });

  it('does not present stale totals or an available export when the request fails', () => {
    h.useActivityMock.mockReturnValue(mockQueryResult({ isError: true, error: new Error('failed') }));
    renderPage();
    expect(screen.getByRole('region', { name: 'Activity overview' })).toHaveTextContent('Events in selected range—');
    expect(screen.getByTestId('activity-export-trigger')).toBeDisabled();
  });
});
