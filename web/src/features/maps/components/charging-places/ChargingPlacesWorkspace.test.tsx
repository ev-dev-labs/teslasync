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
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';

const { emptyPins } = vi.hoisted(() => ({ emptyPins: [] as never[] }));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

vi.mock('@/api/hooks/useLocations', () => ({
  useGeofencesFull: vi.fn(),
  useGeofenceNeedsReview: vi.fn(),
  useGeofenceCurrentRates: vi.fn(),
}));

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
  }: {
    places?: StubPlace[];
    isLoading: boolean;
    error?: unknown;
    onReview: (p: StubPlace) => void;
  }) => (
    <div data-testid="stub-needs-setup">
      {`NeedsSetupQueue places=${places?.length ?? 0} loading=${isLoading} error=${Boolean(error)}`}
      <a href="#review-first" onClick={() => places?.[0] && onReview(places[0])}>stub-review-first</a>
    </div>
  ),
}));

vi.mock('./PlacesTable', () => ({
  PlacesTable: ({
    places,
    currentRates,
    isLoading,
    error,
    onSelect,
    includesArchived,
  }: {
    places?: StubPlace[];
    currentRates?: unknown[];
    isLoading: boolean;
    error?: unknown;
    onSelect: (p: StubPlace) => void;
    includesArchived?: boolean;
  }) => (
    <div data-testid="stub-places-table">
      {`PlacesTable places=${places?.length ?? 0} rates=${currentRates?.length ?? 0} loading=${isLoading} error=${Boolean(error)} archived=${Boolean(includesArchived)}`}
      <a href="#select-first" onClick={() => places?.[0] && onSelect(places[0])}>stub-select-first</a>
    </div>
  ),
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
} from '@/api/hooks/useLocations';
import { ChargingPlacesWorkspace } from './ChargingPlacesWorkspace';
import type { Geofence, GeofenceRate } from '@/api/types';

const mockedPlaces = useGeofencesFull as unknown as ReturnType<typeof vi.fn>;
const mockedNeedsReview = useGeofenceNeedsReview as unknown as ReturnType<typeof vi.fn>;
const mockedCurrentRates = useGeofenceCurrentRates as unknown as ReturnType<typeof vi.fn>;

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
