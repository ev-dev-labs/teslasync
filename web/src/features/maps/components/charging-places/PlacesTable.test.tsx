/**
 * PlacesTable — the full Charging Places list with each place's currently
 * -active rate resolved from a bulk lookup (never a per-row fetch).
 *
 * Coverage:
 *   1. Loading skeleton, error → QueryError + retry, empty (both the
 *      active-only and includes-archived empty copies).
 *   2. Renders name (with "Unnamed place" fallback), an "Archived" badge
 *      only for archived rows, origin badge (manual vs auto-discovered),
 *      category (with "Uncategorized" fallback), and "Manage" per row.
 *   3. Resolves each row's rate via `currentRates` keyed by `geofence_id`
 *      — "Not set" when a place has no row in the bulk lookup.
 *   4. Clicking "Manage" invokes `onSelect` with the exact place.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

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

vi.mock('@/hooks/useSettings', () => ({
  useSettings: () => ({ locale: 'en-US' }),
}));

vi.mock('@/components/data-display', () => ({
  TimeStamp: ({ value }: { value: unknown }) => <span data-testid="effective-since">{String(value)}</span>,
}));

import { PlacesTable } from './PlacesTable';
import type { Geofence, GeofenceRate } from '@/api/types';

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

function makeRate(overrides: Partial<GeofenceRate> = {}): GeofenceRate {
  return {
    id: 1,
    geofence_id: 1,
    rate_per_wh: 0.00012,
    currency: 'USD',
    effective_from: '2026-08-27T00:00:00Z',
    effective_to: null,
    created_at: '2026-08-27T00:00:00Z',
    ...overrides,
  };
}

function renderTable(props: Partial<Parameters<typeof PlacesTable>[0]> = {}) {
  return render(
    <MemoryRouter>
      <PlacesTable isLoading={false} onSelect={vi.fn()} {...props} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  cleanup();
});

describe('PlacesTable — loading/error/empty', () => {
  it('shows a loading skeleton when loading with no rows yet', () => {
    const { container } = renderTable({ isLoading: true });
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('surfaces a QueryError with a working retry on failure', () => {
    const onRetry = vi.fn();
    renderTable({ error: new Error('boom'), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the active-only empty copy by default', () => {
    renderTable({ places: [] });
    expect(
      screen.getByText(
        'No active charging places yet. Existing and future confirmed charging locations appear automatically.',
      ),
    ).toBeInTheDocument();
  });

  it('shows the includes-archived empty copy when includesArchived is true', () => {
    renderTable({ places: [], includesArchived: true });
    expect(
      screen.getByText(
        'No charging places yet. Charge somewhere or create a geofence above to start tracking costs.',
      ),
    ).toBeInTheDocument();
  });
});

describe('PlacesTable — rows', () => {
  it('renders name, origin, category, and Manage for a manual place with no rate', () => {
    renderTable({ places: [makePlace()] });

    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.getByText('home')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Manage' })).toBeInTheDocument();
  });

  it('falls back to "Unnamed place" and "Uncategorized" when both are empty', () => {
    renderTable({ places: [makePlace({ name: '', category: null })] });
    expect(screen.getByText('Unnamed place')).toBeInTheDocument();
    expect(screen.getByText('Uncategorized')).toBeInTheDocument();
  });

  it('badges an auto-discovered place distinctly from a manual one', () => {
    renderTable({ places: [makePlace({ origin: 'charging_discovery' })] });
    expect(screen.getByText('Auto-discovered')).toBeInTheDocument();
  });

  it('shows an "Archived" badge only for archived rows', () => {
    renderTable({
      places: [
        makePlace({ id: 1, name: 'Active One', archived_at: null }),
        makePlace({ id: 2, name: 'Retired One', archived_at: '2026-06-01T00:00:00Z' }),
      ],
    });
    expect(screen.getByText('Archived')).toBeInTheDocument();
    // Exactly one archived badge for two rows, one archived.
    expect(screen.getAllByText('Archived')).toHaveLength(1);
  });

  it('resolves each row\'s rate from the bulk currentRates lookup keyed by geofence_id', () => {
    renderTable({
      places: [makePlace({ id: 1, name: 'Home' }), makePlace({ id: 2, name: 'Office' })],
      currentRates: [makeRate({ geofence_id: 1, rate_per_wh: 0.00012, currency: 'USD' })],
    });

    // Home (id 1) has a resolved rate string; Office (id 2) shows "Not set".
    expect(screen.getByText('$0.120')).toBeInTheDocument();
    expect(screen.getByText('Not set')).toBeInTheDocument();
    expect(screen.getByTestId('effective-since')).toHaveTextContent('2026-08-27T00:00:00Z');
  });

  it('invokes onSelect with the exact place when Manage is clicked', () => {
    const onSelect = vi.fn();
    const place = makePlace({ id: 7, name: 'Costco Supercharger' });
    renderTable({ places: [place], onSelect });

    fireEvent.click(screen.getByRole('button', { name: 'Manage' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(place);
  });

  it('renders the row-count badge matching the number of places', () => {
    renderTable({
      places: [makePlace({ id: 1, name: 'A' }), makePlace({ id: 2, name: 'B' }), makePlace({ id: 3, name: 'C' })],
    });
    expect(screen.getByText('3')).toBeInTheDocument();
  });
});
