/**
 * LocationFavoritesWidget — behaviour, hardening & a11y contract.
 *
 * The widget fans TWO hooks (`useLocationSnapshotLatest` for the presence
 * badge + `useLocations` for the ranked list) into two responsive layouts
 * (compact 1×N presence badge / standard ≥2-col badge + destination + list)
 * plus one exported pure helper. This suite drives every export:
 *
 *   - `locationBadge` is unit-tested across ALL four branches
 *     (home / work / favorite / other) plus the null/undefined/empty
 *     snapshot fall-through and the home>work>favorite precedence order;
 *   - the component is exercised through its accessible surface for the
 *     loading / error / empty / happy paths of both layouts, the vehicle-id
 *     resolution (explicit prop vs first-vehicle fallback), the icon-only
 *     emoji's accessible name, and — crucially — the refresh regression:
 *     the compact layout's badge is derived SOLELY from the snapshot, so a
 *     refresh MUST refetch the snapshot query (previously it refetched only
 *     the unrelated locations query, leaving the visible badge stale).
 *
 * Both hooks are mocked at the hook boundary so no network is touched; the
 * `importActual` spread preserves each module's other exports (the
 * `useVehicles` module in particular is transitively imported elsewhere in
 * the render tree). `react-i18next` is stubbed to echo the English fallback.
 * `@testing-library/user-event` is not installed in this repo (see the
 * sibling BackupMonitorWidget / CommandHistoryWidget suites), so the
 * interactions go through `fireEvent`. `QueryError` (rendered on the error
 * path) pulls in `react-router-dom`'s `useNavigate`, so renders are wrapped
 * in a `MemoryRouter`.
 */

import { type ReactNode } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n stub: echo the fallback string, interpolating {{var}} tokens from the
// options bag so any count-bearing copy renders as real text.
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

// Both data sources become controllable vi.fns. importActual keeps the other
// exports intact (useVehicles co-exports useLocationSnapshotLatest and many
// helpers imported transitively across the render tree).
vi.mock('@/api/hooks/useLocations', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useLocations')>(
    '@/api/hooks/useLocations',
  );
  return { ...actual, useLocations: vi.fn() };
});

vi.mock('@/api/hooks/useVehicles', async () => {
  const actual = await vi.importActual<typeof import('@/api/hooks/useVehicles')>(
    '@/api/hooks/useVehicles',
  );
  return { ...actual, useVehicles: vi.fn(), useLocationSnapshotLatest: vi.fn() };
});

import LocationFavoritesWidget, { locationBadge } from './LocationFavoritesWidget';
import { useLocations } from '@/api/hooks/useLocations';
import { useVehicles, useLocationSnapshotLatest } from '@/api/hooks/useVehicles';
import type { WidgetSize } from './types';

const mockUseLocations = vi.mocked(useLocations);
const mockUseVehicles = vi.mocked(useVehicles);
const mockUseSnapshot = vi.mocked(useLocationSnapshotLatest);

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

/** Identity translate matching the helper's `(key, fallback) => string` contract. */
const tid = (key: string, fallback?: string): string =>
  typeof fallback === 'string' ? fallback : key;

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): any {
  return {
    data: undefined,
    isLoading: false,
    error: null,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(size: WidgetSize, props: { vehicleId?: number } = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <LocationFavoritesWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const COMPACT: WidgetSize = { cols: 1, rows: 1 };
const STANDARD: WidgetSize = { cols: 2, rows: 2 };

beforeEach(() => {
  vi.clearAllMocks();
  mockUseVehicles.mockReturnValue(qr({ data: [{ id: 42 }] }));
  mockUseLocations.mockReturnValue(qr({ data: [] }));
  mockUseSnapshot.mockReturnValue(qr({ data: null }));
});

// ── Pure helper ────────────────────────────────────────────────────────────

describe('locationBadge', () => {
  it('maps each presence flag to the right emoji, label and variant', () => {
    expect(locationBadge({ located_at_home: true }, tid)).toEqual({
      emoji: '🏠',
      label: 'Home',
      variant: 'success',
    });
    expect(locationBadge({ located_at_work: true }, tid)).toEqual({
      emoji: '🏢',
      label: 'Work',
      variant: 'neutral',
    });
    expect(locationBadge({ located_at_favorite: true }, tid)).toEqual({
      emoji: '⭐',
      label: 'Favorite',
      variant: 'neutral',
    });
  });

  it('falls back to "Other" for nullish/empty snapshots and prioritises home', () => {
    const other = { emoji: '📍', label: 'Other', variant: 'warning' as const };
    expect(locationBadge(null, tid)).toEqual(other);
    expect(locationBadge(undefined, tid)).toEqual(other);
    expect(locationBadge({}, tid)).toEqual(other);
    // Home wins when several presence flags are set at once.
    expect(
      locationBadge(
        { located_at_home: true, located_at_work: true, located_at_favorite: true },
        tid,
      ).label,
    ).toBe('Home');
  });
});

// ── Component: states ───────────────────────────────────────────────────────

describe('LocationFavoritesWidget states', () => {
  it('renders a loading skeleton (no title, no empty copy) while either query loads', () => {
    mockUseLocations.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Favorite Locations')).toBeNull();
    expect(screen.queryByText('No favorite locations')).toBeNull();
  });

  it('surfaces a query error instead of the widget body', () => {
    mockUseSnapshot.mockReturnValue(qr({ isError: true, error: new Error('boom') }));
    renderWidget(STANDARD);
    // QueryError's generic (statusless) branch renders the network copy.
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('Favorite Locations')).toBeNull();
  });

  it('shows an empty state (never a blank panel) when there are no locations', () => {
    mockUseLocations.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);
    const empty = screen.getByText('No favorite locations');
    expect(empty).toBeInTheDocument();
    expect(empty.closest('[role="status"]')).not.toBeNull();
  });
});

// ── Component: standard layout ──────────────────────────────────────────────

describe('LocationFavoritesWidget standard layout', () => {
  it('renders the title, presence badge, destination chip and ranked locations', () => {
    mockUseSnapshot.mockReturnValue(
      qr({ data: { located_at_home: true, destination_name: 'Supercharger' } }),
    );
    mockUseLocations.mockReturnValue(
      qr({
        data: [
          { id: 'l1', addressName: 'Home Base', visitCount: 12, lastVisited: null },
          { id: 'l2', addressName: 'Office', visitCount: 4, lastVisited: null },
        ],
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Favorite Locations')).toBeInTheDocument();
    // Presence badge is driven by the snapshot (home → "Home").
    expect(screen.getByText('Home')).toBeInTheDocument();
    // Active-navigation destination chip.
    expect(screen.getByText(/Supercharger/)).toBeInTheDocument();
    // Ranked list rows + the "<count>× · <relative>" formatted value.
    expect(screen.getByText('Home Base')).toBeInTheDocument();
    expect(screen.getByText('Office')).toBeInTheDocument();
    expect(screen.getByText('12× · —')).toBeInTheDocument();
  });

  it('exposes the presence emoji with an accessible name and hides the destination chip when idle', () => {
    mockUseSnapshot.mockReturnValue(qr({ data: { located_at_favorite: true } }));
    mockUseLocations.mockReturnValue(
      qr({ data: [{ id: 'l1', addressName: 'Cafe', visitCount: 3, lastVisited: null }] }),
    );
    renderWidget(STANDARD);

    // aria-label carries meaning for the icon-only emoji.
    expect(screen.getByRole('img', { name: 'Favorite' })).toHaveTextContent('⭐');
    // No destination_name → no "→ …" chip rendered.
    expect(screen.queryByText(/→/)).toBeNull();
  });
});

// ── Component: compact layout ───────────────────────────────────────────────

describe('LocationFavoritesWidget compact layout', () => {
  it('renders only the presence badge (no title) with an accessible emoji', () => {
    mockUseSnapshot.mockReturnValue(qr({ data: { located_at_work: true } }));
    renderWidget(COMPACT);

    expect(screen.queryByText('Favorite Locations')).toBeNull();
    expect(screen.getByRole('img', { name: 'Work' })).toHaveTextContent('🏢');
    expect(screen.getByText('Work')).toBeInTheDocument();
  });

  it('refetches BOTH the snapshot and the locations on refresh — the compact badge is snapshot-derived', () => {
    const locRefetch = vi.fn();
    const snapRefetch = vi.fn();
    mockUseLocations.mockReturnValue(qr({ data: [], refetch: locRefetch }));
    mockUseSnapshot.mockReturnValue(
      qr({ data: { located_at_home: true }, refetch: snapRefetch }),
    );
    renderWidget(COMPACT);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    // Regression guard: the snapshot drives the visible compact badge, so it
    // MUST be refetched (the old code refetched only the locations query).
    expect(snapRefetch).toHaveBeenCalledTimes(1);
    expect(locRefetch).toHaveBeenCalledTimes(1);
  });
});

// ── Component: vehicle-id resolution ────────────────────────────────────────

describe('LocationFavoritesWidget vehicle selection', () => {
  it('uses the explicit vehicleId prop for both queries when provided', () => {
    renderWidget(STANDARD, { vehicleId: 7 });
    expect(mockUseSnapshot).toHaveBeenCalledWith(7);
    expect(mockUseLocations).toHaveBeenCalledWith('7');
  });

  it('falls back to the first vehicle when no vehicleId prop is given', () => {
    mockUseVehicles.mockReturnValue(qr({ data: [{ id: 42 }, { id: 99 }] }));
    renderWidget(STANDARD);
    expect(mockUseSnapshot).toHaveBeenCalledWith(42);
    expect(mockUseLocations).toHaveBeenCalledWith('42');
  });
});
