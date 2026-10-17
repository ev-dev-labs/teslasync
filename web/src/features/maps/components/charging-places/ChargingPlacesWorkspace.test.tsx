/**
 * ChargingPlacesWorkspace — the top-level Charging Places section: the
 * "Needs Setup" queue, the archived-places toggle, the full places table,
 * and the detail panel for whichever place is selected.
 *
 * NeedsSetupQueue / PlacesTable / PlaceDetailPanel each carry their own
 * dedicated test suite — here they are replaced with prop-echoing stubs so
 * these tests stay focused on the workspace's OWN orchestration contract:
 * data threading, the archived-places filter, opening the detail panel
 * from either child, and keeping the open panel's place "live" as the
 * underlying list refetches.
 *
 * Coverage:
 *   1. Threads places/loading/error/currentRates into the two list panels.
 *   2. Archived filter: excluded by default; the toggle includes them and
 *      is passed through to PlacesTable as `includesArchived`.
 *   3. Opening the detail panel from NeedsSetupQueue's onReview.
 *   4. Opening the detail panel from PlacesTable's onSelect.
 *   5. Closing the detail panel clears the selection.
 *   6. The open detail panel's `place` prop stays live — re-derived from
 *      the latest list query result rather than a stale snapshot from the
 *      moment it was opened.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

const { emptyPins, tableProps, queueProps } = vi.hoisted(() => ({
  emptyPins: [] as never[],
  tableProps: vi.fn(),
  queueProps: vi.fn(),
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, values?: Record<string, unknown>) => (
        typeof fallback === 'string'
          ? fallback.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => String(values?.[name] ?? `{{${name}}}`))
          : key
      ),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/usePinned', () => ({
  usePinned: () => ({ data: emptyPins }),
}));

interface StubPlace {
  id: number;
  archived_at?: string | null;
}

vi.mock('./NeedsSetupQueue', () => ({
  NeedsSetupQueue: ({
    places,
    isLoading,
    error,
    onReview,
    onRetry,
  }: {
    places?: StubPlace[];
    isLoading: boolean;
    error?: unknown;
    onReview: (p: StubPlace) => void;
    onRetry?: () => void;
  }) => {
    queueProps({ places, isLoading, error, onRetry });
    return (
    <div data-testid="stub-needs-setup">
      {`NeedsSetupQueue places=${places?.length ?? 0} loading=${isLoading} error=${Boolean(error)}`}
      <a href="#review-first" onClick={() => places?.[0] && onReview(places[0])}>stub-review-first</a>
      {Boolean(error) && <Button onClick={onRetry}>Retry</Button>}
    </div>
    );
  },
}));

vi.mock('./PlacesTable', () => ({
  PlacesTable: ({
    places,
    currentRates,
    isLoading,
    error,
    onSelect,
    includesArchived,
    selectedKeys,
    onSelectionChange,
    bulkActions,
    onRetry,
    onEdit,
    onDelete,
  }: {
    places?: Geofence[];
    currentRates?: unknown[];
    isLoading: boolean;
    error?: unknown;
    onSelect: (p: StubPlace) => void;
    includesArchived?: boolean;
    selectedKeys?: number[];
    onSelectionChange?: (keys: number[]) => void;
    bulkActions?: (selected: Geofence[]) => ReactNode;
    onRetry?: () => void;
    onEdit?: (place: Geofence) => void;
    onDelete?: (place: Geofence) => void;
  }) => {
    tableProps({ places, currentRates, isLoading, error, selectedKeys, onEdit, onDelete });
    const selected = (places ?? []).filter((place) => selectedKeys?.includes(place.id));
    return (
    <div data-testid="stub-places-table">
      {`PlacesTable places=${places?.length ?? 0} rates=${currentRates?.length ?? 0} loading=${isLoading} error=${Boolean(error)} archived=${Boolean(includesArchived)}`}
      <span data-testid="stub-selection">{selectedKeys?.join(',')}</span>
      <a href="#select-first" onClick={() => places?.[0] && onSelect(places[0])}>stub-select-first</a>
      {Boolean(error) && <Button onClick={onRetry}>Retry</Button>}
      {onSelectionChange && <Button onClick={() => onSelectionChange((places ?? []).map((place) => place.id))}>stub-select-all</Button>}
      {selected.length > 0 && bulkActions?.(selected)}
    </div>
    );
  },
}));

vi.mock('./PlaceDetailPanel', () => ({
  PlaceDetailPanel: ({ place, onClose }: { place: StubPlace | null; onClose: () => void }) =>
    place ? (
      <div data-testid="stub-detail-panel">
        {`PlaceDetailPanel place=${place.id} archived=${Boolean(place.archived_at)}`}
        <a href="#close-detail" onClick={onClose}>stub-close-detail</a>
      </div>
    ) : null,
}));

import {
  useGeofencesFull,
  useGeofenceNeedsReview,
  useGeofenceCurrentRates,
  getGeofenceBulkDeleteOutcome,
} from '@/api/hooks/useLocations';
import { Button } from '@/components/ui';
import { ChargingPlacesWorkspace } from './ChargingPlacesWorkspace';
import type { Geofence, GeofenceRate } from '@/api/types';

const mockedPlaces = useGeofencesFull as unknown as ReturnType<typeof vi.fn>;
const mockedNeedsReview = useGeofenceNeedsReview as unknown as ReturnType<typeof vi.fn>;
const mockedCurrentRates = useGeofenceCurrentRates as unknown as ReturnType<typeof vi.fn>;

vi.mock('@/api/hooks/useLocations', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/hooks/useLocations')>();
  return {
    ...actual,
    useGeofencesFull: vi.fn(),
    useGeofenceNeedsReview: vi.fn(),
    useGeofenceCurrentRates: vi.fn(),
  };
});

function makePlace(overrides: Partial<Geofence> = {}): Geofence {
  return {
    id: 1,
    name: 'Home',
    polygon_wkt: 'POLYGON((0 0,0 0,0 0,0 0))',
    category: 'home',
    enabled: true,
    alert_on_entry: false,
    alert_on_exit: false,
    origin: 'manual',
    needs_review: false,
    archived_at: null,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
    latitude: 40,
    longitude: -74,
    radius: 50,
    ...overrides,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  mockedPlaces.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  mockedNeedsReview.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
  mockedCurrentRates.mockReturnValue({ data: [], isLoading: false, error: null, refetch: vi.fn() });
});

describe('ChargingPlacesWorkspace — data threading', () => {
  it('threads places/currentRates/needs-review into the two list panels', () => {
    mockedPlaces.mockReturnValue({
      data: [makePlace({ id: 1 }), makePlace({ id: 2 })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockedNeedsReview.mockReturnValue({
      data: [makePlace({ id: 3, needs_review: true, origin: 'charging_discovery' })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockedCurrentRates.mockReturnValue({
      data: [{ id: 1, geofence_id: 1 } as GeofenceRate],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ChargingPlacesWorkspace />);

    expect(screen.getByTestId('stub-needs-setup')).toHaveTextContent('places=1');
    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('places=2');
    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('rates=1');
  });

  it('propagates loading/error from the places query into PlacesTable', () => {
    mockedPlaces.mockReturnValue({ data: undefined, isLoading: true, error: null, refetch: vi.fn() });
    render(<ChargingPlacesWorkspace />);
    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('loading=true');
  });

  it('keeps directory, review queue, rates and selected details during independent refresh failures', () => {
    const places = [makePlace({ id: 4 })];
    mockedPlaces.mockReturnValue({
      data: places, isLoading: false, isError: true,
      error: new Error('directory refresh failed'), refetch: vi.fn(),
    });
    mockedNeedsReview.mockReturnValue({
      data: [makePlace({ id: 9, needs_review: true })], isLoading: false, isError: true,
      error: new Error('review refresh failed'), refetch: vi.fn(),
    });
    mockedCurrentRates.mockReturnValue({
      data: [{ id: 1, geofence_id: 4 } as GeofenceRate], isLoading: false, isError: true,
      error: new Error('rates refresh failed'), refetch: vi.fn(),
    });
    render(<MemoryRouter><ChargingPlacesWorkspace /></MemoryRouter>);

    expect(screen.getByTestId('stub-needs-setup')).toHaveTextContent('places=1 loading=false error=false');
    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('places=1 rates=1 loading=false error=false');
    fireEvent.click(screen.getByText('stub-select-first'));
    expect(screen.getByTestId('stub-detail-panel')).toHaveTextContent('place=4');
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(3);
  });

  describe('ChargingPlacesWorkspace — source-specific trust and recovery', () => {
    it.each(['review', 'directory', 'rates'] as const)('keeps retained %s rows with exactly one paused-source retry', (source) => {
      const reviewRetry = vi.fn();
      const directoryRetry = vi.fn();
      const ratesRetry = vi.fn();
      mockedNeedsReview.mockReturnValue({
        data: [makePlace({ id: 9 })], refetch: reviewRetry,
        fetchStatus: source === 'review' ? 'paused' : 'idle',
      });
      mockedPlaces.mockReturnValue({
        data: [makePlace({ id: 4 })], refetch: directoryRetry,
        fetchStatus: source === 'directory' ? 'paused' : 'idle',
      });
      const rates = [{ id: 1, geofence_id: 4 }];
      mockedCurrentRates.mockReturnValue({
        data: rates, refetch: ratesRetry,
        fetchStatus: source === 'rates' ? 'paused' : 'idle',
      });

      render(<ChargingPlacesWorkspace />);
      const label = source === 'review' ? 'Needs setup' : source === 'directory' ? 'Place directory' : 'charging rates';
      const region = screen.getByRole('region', { name: label });
      expect(within(region).getByRole('status')).toHaveTextContent(`${label} refresh is paused.`);
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
      expect(screen.queryByText(/offline/i)).not.toBeInTheDocument();
      fireEvent.click(within(region).getByRole('button', { name: 'Retry' }));
      expect(reviewRetry).toHaveBeenCalledTimes(source === 'review' ? 1 : 0);
      expect(directoryRetry).toHaveBeenCalledTimes(source === 'directory' ? 1 : 0);
      expect(ratesRetry).toHaveBeenCalledTimes(source === 'rates' ? 1 : 0);
      expect(screen.getByTestId('stub-needs-setup')).toHaveTextContent('places=1');
      expect(screen.getByTestId('stub-places-table')).toHaveTextContent('places=1 rates=1');
      expect(tableProps.mock.lastCall?.[0].currentRates).toBe(rates);
    });

    it.each(['review', 'directory', 'rates'] as const)('does not claim initial-paused %s is empty or loaded', (source) => {
      const query = { data: undefined, isLoading: false, isPending: true, fetchStatus: 'paused', refetch: vi.fn() };
      const mock = source === 'review' ? mockedNeedsReview : source === 'directory' ? mockedPlaces : mockedCurrentRates;
      mock.mockReturnValue(query);
      render(<ChargingPlacesWorkspace />);
      const label = source === 'review' ? 'Needs setup' : source === 'directory' ? 'Place directory' : 'charging rates';
      expect(within(screen.getByRole('region', { name: label })).getByRole('status'))
        .toHaveTextContent(`${label} loading is paused. No data has been loaded yet.`);
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
      if (source === 'review') expect(screen.getByTestId('stub-needs-setup')).toHaveTextContent('loading=true error=false');
      if (source === 'directory') expect(screen.getByTestId('stub-places-table')).toHaveTextContent('loading=true error=false');
      expect(screen.queryByText(/Previously loaded|offline/)).not.toBeInTheDocument();
    });

    it.each(['review', 'directory', 'rates'] as const)('keeps a %s fatal retry singular and scoped', (source) => {
      const refetch = vi.fn();
      const mock = source === 'review' ? mockedNeedsReview : source === 'directory' ? mockedPlaces : mockedCurrentRates;
      mock.mockReturnValue({ data: undefined, error: new Error('Synthetic failure'), isLoading: false, refetch });
      render(<MemoryRouter><ChargingPlacesWorkspace /></MemoryRouter>);
      expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      expect(refetch).toHaveBeenCalledTimes(1);
    });

    it('refreshes all three sources only through the explicit workspace refresh', () => {
      const retries = [vi.fn(), vi.fn(), vi.fn()];
      [mockedPlaces, mockedNeedsReview, mockedCurrentRates].forEach((mock, index) => {
        mock.mockReturnValue({ data: [], refetch: retries[index] });
      });
      render(<ChargingPlacesWorkspace />);
      fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
      retries.forEach((retry) => expect(retry).toHaveBeenCalledTimes(1));
    });

    it('threads write permissions unchanged rather than inventing callbacks', () => {
      render(<ChargingPlacesWorkspace />);
      expect(tableProps.mock.lastCall?.[0].onEdit).toBeUndefined();
      expect(tableProps.mock.lastCall?.[0].onDelete).toBeUndefined();
      expect(screen.queryByRole('button', { name: 'Add place' })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'stub-select-all' })).not.toBeInTheDocument();
    });
  });

  async function confirmBulkDelete() {
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
  }

  describe('ChargingPlacesWorkspace — actual bulk outcome recovery', () => {
    beforeEach(() => {
      mockedPlaces.mockReturnValue({
        data: [makePlace({ id: 1 }), makePlace({ id: 2 })], isLoading: false, error: null, refetch: vi.fn(),
      });
    });

    it('uses the released outcome classifier, not promise fulfillment', () => {
      expect(getGeofenceBulkDeleteOutcome({ deleted: 2, failed: [] }, [1, 2])).toBe('complete');
      expect(getGeofenceBulkDeleteOutcome({ deleted: 1, failed: [{ id: 2, reason: 'Synthetic refusal' }] }, [1, 2])).toBe('partial');
      expect(getGeofenceBulkDeleteOutcome({ deleted: 0, failed: [] }, [1, 2])).toBe('failed');
    });

    it('requires confirmation and preserves exact failed IDs/reasons after a partial response', async () => {
      const onBulkDelete = vi.fn().mockResolvedValue({ deleted: 1, failed: [{ id: 2, reason: 'Synthetic charging history refusal' }] });
      render(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'stub-select-all' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      expect(onBulkDelete).not.toHaveBeenCalled();
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^2$/));
      expect(screen.getByText('Place 2: Synthetic charging history refusal')).toBeInTheDocument();
      expect(onBulkDelete.mock.calls[0][0].map((place: Geofence) => place.id)).toEqual([1, 2]);
    });

    it('clears only confirmed complete deletion selections', async () => {
      const onBulkDelete = vi.fn().mockResolvedValue({ deleted: 2, failed: [] });
      render(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'stub-select-all' }));
      await confirmBulkDelete();
      await waitFor(() => expect(screen.getByTestId('stub-selection')).toBeEmptyDOMElement());
      expect(screen.queryByText(/deletions did not complete/)).not.toBeInTheDocument();
    });

    it.each([
      ['zero deletions', { deleted: 0, failed: [{ id: 1, reason: 'Synthetic refusal' }] }],
      ['unaccounted short count', { deleted: 1, failed: [] }],
      ['void page adapter', undefined],
    ])('retains all submitted IDs for %s without inventing success', async (_label, result) => {
      render(<ChargingPlacesWorkspace onBulkDelete={vi.fn().mockResolvedValue(result)} />);
      fireEvent.click(screen.getByRole('button', { name: 'stub-select-all' }));
      await confirmBulkDelete();
      await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/Selections remain|selections remain/));
      expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^1,2$/);
      if (result?.failed.length) expect(screen.getByText('Place 1: Synthetic refusal')).toBeInTheDocument();
    });

    it('preserves failure reasons and selection while the directory is unresolved or filtered', async () => {
      const onBulkDelete = vi.fn().mockResolvedValue({ deleted: 1, failed: [{ id: 2, reason: 'Synthetic retained refusal' }] });
      const { rerender } = render(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'stub-select-all' }));
      await confirmBulkDelete();
      await waitFor(() => expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^2$/));
      mockedPlaces.mockReturnValue({ data: undefined, fetchStatus: 'paused', refetch: vi.fn() });
      rerender(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^2$/);
      mockedPlaces.mockReturnValue({ data: [makePlace({ id: 1 })], refetch: vi.fn() });
      rerender(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^2$/);
      expect(screen.getByText('Place 2: Synthetic retained refusal')).toBeInTheDocument();
    });

    it('retains reasons after rejected recovery and clears them only after confirmed success', async () => {
      const onBulkDelete = vi.fn()
        .mockResolvedValueOnce({ deleted: 1, failed: [{ id: 2, reason: 'Synthetic refusal' }] })
        .mockRejectedValueOnce(new Error('Synthetic request failure'))
        .mockResolvedValueOnce({ deleted: 1, failed: [] });
      render(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'stub-select-all' }));
      await confirmBulkDelete();
      await waitFor(() => expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^2$/));
      await confirmBulkDelete();
      await waitFor(() => expect(onBulkDelete).toHaveBeenCalledTimes(2));
      expect(screen.getByText('Place 2: Synthetic refusal')).toBeInTheDocument();
      expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^2$/);
      await waitFor(() => expect(screen.getByRole('button', { name: 'Delete' })).not.toBeDisabled());
      await confirmBulkDelete();
      await waitFor(() => expect(screen.getByTestId('stub-selection')).toBeEmptyDOMElement());
      expect(screen.queryByText('Place 2: Synthetic refusal')).not.toBeInTheDocument();
    });

    it('retains selection and never mutates on cancellation or pending permission', async () => {
      const onBulkDelete = vi.fn();
      const { rerender } = render(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} />);
      fireEvent.click(screen.getByRole('button', { name: 'stub-select-all' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
      expect(screen.getByTestId('stub-selection')).toHaveTextContent(/^1,2$/);
      rerender(<ChargingPlacesWorkspace onBulkDelete={onBulkDelete} deletePending />);
      fireEvent.click(screen.getByRole('button', { name: /Delete/ }));
      expect(onBulkDelete).not.toHaveBeenCalled();
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });

  it('keeps the place directory usable when only current-rate loading fails', () => {
    mockedPlaces.mockReturnValue({
      data: [makePlace()],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockedCurrentRates.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('rates unavailable'),
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <ChargingPlacesWorkspace />
      </MemoryRouter>,
    );

    expect(screen.getByTestId('stub-places-table')).toHaveTextContent(
      'places=1 rates=0 loading=false error=false',
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});

describe('ChargingPlacesWorkspace — archived filter', () => {
  it('excludes archived places by default', () => {
    mockedPlaces.mockReturnValue({
      data: [makePlace({ id: 1, archived_at: null }), makePlace({ id: 2, archived_at: '2026-06-01T00:00:00Z' })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ChargingPlacesWorkspace />);

    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('places=1');
    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('archived=false');
  });

  it('includes archived places once "Show archived" is toggled on', () => {
    mockedPlaces.mockReturnValue({
      data: [makePlace({ id: 1, archived_at: null }), makePlace({ id: 2, archived_at: '2026-06-01T00:00:00Z' })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ChargingPlacesWorkspace />);
    fireEvent.click(screen.getByRole('switch', { name: 'Show archived' }));

    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('places=2');
    expect(screen.getByTestId('stub-places-table')).toHaveTextContent('archived=true');
  });
});

describe('ChargingPlacesWorkspace — detail panel', () => {
  it('opens the detail panel from NeedsSetupQueue\'s onReview', () => {
    mockedNeedsReview.mockReturnValue({
      data: [makePlace({ id: 9, needs_review: true })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ChargingPlacesWorkspace />);
    expect(screen.queryByTestId('stub-detail-panel')).not.toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-review-first'));
    expect(screen.getByTestId('stub-detail-panel')).toHaveTextContent('place=9');
  });

  it('opens the detail panel from PlacesTable\'s onSelect', () => {
    mockedPlaces.mockReturnValue({
      data: [makePlace({ id: 4 })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ChargingPlacesWorkspace />);
    fireEvent.click(screen.getByText('stub-select-first'));
    expect(screen.getByTestId('stub-detail-panel')).toHaveTextContent('place=4');
  });

  it('clears the selection when the detail panel is closed', () => {
    mockedPlaces.mockReturnValue({ data: [makePlace({ id: 4 })], isLoading: false, error: null, refetch: vi.fn() });

    render(<ChargingPlacesWorkspace />);
    fireEvent.click(screen.getByText('stub-select-first'));
    expect(screen.getByTestId('stub-detail-panel')).toBeInTheDocument();

    fireEvent.click(screen.getByText('stub-close-detail'));
    expect(screen.queryByTestId('stub-detail-panel')).not.toBeInTheDocument();
  });

  it('keeps the open panel\'s place live — re-deriving from the latest list query, not a stale snapshot', () => {
    const { rerender } = render(<ChargingPlacesWorkspace />);
    mockedPlaces.mockReturnValue({
      data: [makePlace({ id: 4, archived_at: null })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    rerender(<ChargingPlacesWorkspace />);

    fireEvent.click(screen.getByText('stub-select-first'));
    expect(screen.getByTestId('stub-detail-panel')).toHaveTextContent('archived=false');

    // Simulate the list refetching with the SAME place now archived (e.g.
    // an archive mutation elsewhere invalidated the shared query cache).
    mockedPlaces.mockReturnValue({
      data: [makePlace({ id: 4, archived_at: '2026-06-01T00:00:00Z' })],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    rerender(<ChargingPlacesWorkspace />);

    expect(screen.getByTestId('stub-detail-panel')).toHaveTextContent('place=4 archived=true');
  });
});
