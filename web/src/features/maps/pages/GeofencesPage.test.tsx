/**
 * GeofencesPage — behaviour, branch, interaction and a11y coverage.
 *
 * GeofencesPage is the "Zones" surface: a KPI band, an (AI-gated) Helix draft
 * assistant, and a hero panel whose geofence cards flow into an auto-fit bento,
 * plus a create/edit modal with vehicle / browser / map-drawn location capture.
 * Its own responsibilities (what these tests exercise) are:
 *
 *   1. A KPI band derived from the geofences (total / active / entry / exit),
 *      always visible with a 0 placeholder — loading shows skeletons.
 *   2. Section-local loading / error / empty / no-search-match branches for the
 *      Zones panel — no panel is gated away or left blank.
 *   3. Per-card behaviour: alert-type badges, enable toggle (partial PUT),
 *      inline rename (full PUT), edit → modal prefill, delete → confirm → DELETE.
 *   4. Client-side search + active-filter chips, and bulk select → bulk delete.
 *   5. The create modal: zod validation, a valid create POST, dirty-cancel
 *      discard confirmation, and all three location sources — vehicle position,
 *      browser geolocation (denied + unsupported), and map-drawn capture.
 *   6. The AI section gate (absent in off-mode, present + wired in on-mode) and
 *      its visited-location id parsing + apply-draft → modal prefill.
 *   7. a11y: labelled regions, an accessible name ON the enable switch, and the
 *      snake_case / no-`/api/v1` data contract.
 *
 * Strategy mirrors ChargingHeatmapPage: render the REAL page + REAL shared
 * subtree (PageContainer, MetricCard, cards, Modal, ConfirmDialog, QueryError).
 * Only the network `request` helper, i18n, the leaflet map subtree, the AI panel
 * and the AI feature-gate are mocked — the query hooks, filter/bulk/dirty-form
 * hooks and settings-driven formatters all run for real. user-event is
 * intentionally NOT a dependency of this codebase — interactions use fireEvent,
 * consistent with the other page tests.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';
import type { Geofence } from '@/types/location';

// jsdom lacks matchMedia; framer-motion (<FadeIn>/<Stagger*>) + PageContainer's
// freshness chip read it at module load for the reduced-motion preference.
vi.hoisted(() => {
  if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    })) as unknown as typeof window.matchMedia;
  }
});

const { mockRequest, toastMock, aiEnabledMock } = vi.hoisted(() => ({
  mockRequest: vi.fn(),
  toastMock: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() },
  aiEnabledMock: vi.fn<[], boolean>(() => false),
}));

// Replace only `request`; keep the real ApiError/isApiError so <QueryError>
// classifies injected errors correctly.
vi.mock('@/api/client', async () => {
  const actual = await vi.importActual<typeof import('@/api/client')>('@/api/client');
  return { ...actual, request: mockRequest };
});

// i18n → developer fallback with {{var}} interpolation so assertions read real
// sentences rather than raw keys. Also handles the `t(key, optsObject)` shape.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown, opts?: unknown) => {
        const vars = (
          opts && typeof opts === 'object'
            ? opts
            : fallback && typeof fallback === 'object'
              ? fallback
              : undefined
        ) as Record<string, unknown> | undefined;
        // Template precedence: a string fallback arg > an opts `defaultValue`
        // (the `t(key, { defaultValue })` shape used by BulkActionsToolbar,
        // useMutationToast, PinButton, …) > the raw key.
        let template = key;
        if (typeof fallback === 'string') template = fallback;
        else if (vars && typeof vars.defaultValue === 'string') template = vars.defaultValue;
        if (!vars) return template;
        return template.replace(/{{(\w+)}}/g, (_m, name: string) =>
          name in vars ? String(vars[name]) : `{{${name}}}`,
        );
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// The leaflet map subtree cannot render in jsdom (no canvas / layout). Stub the
// shared maps module; the GeofenceDrawer stub exposes a button that fires the
// `onCreate` callback so the map-draw → form path stays testable.
vi.mock('@/components/maps', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    MapContainer: ({ children }: { children?: ReactNode }) =>
      React.createElement('div', { 'data-testid': 'map-container' }, children),
    MapTileLayer: () => React.createElement('div', { 'data-testid': 'map-tile' }),
    MapInvalidator: () => null,
    GeofenceDrawer: ({ onCreate }: { onCreate: (g: unknown) => void }) =>
      React.createElement(
        'button',
        {
          type: 'button',
          'data-testid': 'geofence-drawer-create',
          onClick: () => onCreate({ shape: 'circle', lat: 1.5, lng: 2.5, radius: 123 }),
        },
        'draw',
      ),
  };
});

// The AI panel is a separate surface with its own tests. Stub it to render the
// received locationId and expose an apply-draft button.
vi.mock('@/components/ai/AISuggestNewGeofences', async () => {
  const React = await vi.importActual<typeof import('react')>('react');
  return {
    AISuggestNewGeofences: ({
      locationId,
      onApplyDraft,
    }: {
      locationId: number;
      onApplyDraft: (d: {
        name: string;
        latitude: number;
        longitude: number;
        radius: number;
      }) => void;
    }) =>
      React.createElement('div', { 'data-testid': 'ai-suggest' }, [
        React.createElement('span', { key: 'id', 'data-testid': 'ai-location-id' }, String(locationId)),
        React.createElement(
          'button',
          {
            key: 'apply',
            type: 'button',
            'data-testid': 'ai-apply-draft',
            onClick: () =>
              onApplyDraft({ name: 'AI Zone', latitude: 12.5, longitude: -34.5, radius: 200 }),
          },
          'apply',
        ),
      ]),
  };
});

// Control the AI feature gate directly (bypasses settings).
vi.mock('@/hooks/useAiEnabled', () => ({ useAiEnabled: () => aiEnabledMock() }));

// Toast spies — the page AND useMutationToast (bulk delete + pin) both resolve
// through this module, so a single override captures every toast.
vi.mock('@/components/feedback/Toast', async () => {
  const actual = await vi.importActual<typeof import('@/components/feedback/Toast')>(
    '@/components/feedback/Toast',
  );
  return { ...actual, useToast: () => toastMock, useOptionalToast: () => toastMock };
});

import GeofencesPage from './GeofencesPage';

// ── Fixtures ─────────────────────────────────────────────────────────────────
function makeGeofence(o: Partial<Geofence> & { id: string; name: string }): Geofence {
  return {
    latitude: 0,
    longitude: 0,
    radius: 100,
    alertOnEntry: false,
    alertOnExit: false,
    enabled: true,
    costPerKwh: null,
    createdAt: '2024-01-01T00:00:00Z',
    ...o,
  };
}

// Home = both alerts / active; Work = entry-only / inactive; Gym = none / active.
// stats → total 3, active 2, entryAlerts 2, exitAlerts 1.
const GEOFENCES: Geofence[] = [
  makeGeofence({ id: '1', name: 'Home', latitude: 37.7749, longitude: -122.4194, radius: 100, alertOnEntry: true, alertOnExit: true, enabled: true }),
  makeGeofence({ id: '2', name: 'Work', latitude: 40.7128, longitude: -74.006, radius: 250, alertOnEntry: true, alertOnExit: false, enabled: false }),
  makeGeofence({ id: '3', name: 'Gym', latitude: 34.0522, longitude: -118.2437, radius: 50, alertOnEntry: false, alertOnExit: false, enabled: true }),
];

const VEHICLES = [
  { id: 5, vehicle_id: 5, vin: 'VIN00005', display_name: 'Model 3', state: 'online' },
];

const POSITIONS = [{ vehicle_id: 5, ts: '2024-01-01T00:00:00Z', latitude: 12.34, longitude: 56.78 }];

const GEOCODE = {
  display_name: 'Test Road, Test City',
  road: 'Test Road',
  city: 'Test City',
  state: '',
  country: '',
  postcode: '',
};

type Mode = 'resolve' | 'pending' | 'reject';
interface Store {
  geofences: Geofence[];
  mode: Mode;
  error: unknown;
  vehicles: unknown[];
  positions: unknown[];
  pinned: unknown[];
}
let store: Store;

function installRequest() {
  mockRequest.mockImplementation((url: unknown, options?: { method?: string }) => {
    const u = String(url);
    const method = (options?.method ?? 'GET').toUpperCase();

    if (u === '/geofences' && method === 'GET') {
      if (store.mode === 'pending') return new Promise(() => {});
      if (store.mode === 'reject') return Promise.reject(store.error ?? new Error('boom'));
      return Promise.resolve(store.geofences);
    }
    if (u === '/geofences' && method === 'POST') {
      return Promise.resolve(
        makeGeofence({ id: '99', name: 'Created', latitude: 1, longitude: 2, radius: 100 }),
      );
    }
    if (u === '/geofences/bulk' && method === 'POST') {
      return Promise.resolve({ deleted: 1, failed: [] });
    }
    if (/^\/geofences\/[^/]+$/.test(u) && method === 'PUT') {
      return Promise.resolve(store.geofences[0]);
    }
    if (/^\/geofences\/[^/]+$/.test(u) && method === 'DELETE') {
      return Promise.resolve(undefined);
    }
    if (u === '/vehicles') return Promise.resolve(store.vehicles);
    if (u.startsWith('/pinned')) {
      if (method === 'GET') return Promise.resolve(store.pinned);
      return Promise.resolve({ id: 1, item_type: 'geofence', item_id: '1', position: 0 });
    }
    if (u.includes('/positions')) return Promise.resolve(store.positions);
    if (u.startsWith('/geocode/reverse')) return Promise.resolve(GEOCODE);
    return Promise.resolve({});
  });
}

// Calls matching a method + url predicate — for data-contract assertions.
function callsMatching(method: string, matcher: (u: string) => boolean) {
  return mockRequest.mock.calls.filter((c) => {
    const u = String(c[0]);
    const m = ((c[1] as { method?: string } | undefined)?.method ?? 'GET').toUpperCase();
    return m === method && matcher(u);
  });
}

function installGeolocation(impl: Geolocation['getCurrentPosition']) {
  Object.defineProperty(navigator, 'geolocation', {
    configurable: true,
    value: { getCurrentPosition: impl },
  });
}
function removeGeolocation() {
  if ('geolocation' in navigator) {
    Reflect.deleteProperty(navigator as unknown as Record<string, unknown>, 'geolocation');
  }
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/geofences']}>
        <GeofencesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const summary = () => within(screen.getByRole('region', { name: 'Geofence summary' }));
const zones = () => within(screen.getByRole('region', { name: 'Geofence zones' }));

// Read a KPI card's value <p> by its label text.
function kpiValue(label: string): string {
  const card = summary().getByText(label).closest('.rounded-xl');
  return card?.querySelector('p.text-xl')?.textContent ?? '';
}

async function openCreateModal() {
  fireEvent.click(screen.getByRole('button', { name: 'Add Geofence' }));
  return screen.findByRole('dialog', { name: 'Create Geofence' });
}

beforeEach(() => {
  mockRequest.mockReset();
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.info.mockReset();
  toastMock.warning.mockReset();
  aiEnabledMock.mockReset();
  aiEnabledMock.mockReturnValue(false);
  window.localStorage.clear();
  removeGeolocation();
  store = {
    geofences: GEOFENCES,
    mode: 'resolve',
    error: undefined,
    vehicles: [],
    positions: POSITIONS,
    pinned: [],
  };
  installRequest();
});

afterEach(() => {
  removeGeolocation();
  vi.clearAllMocks();
});

// ── KPI band ─────────────────────────────────────────────────────────────────
describe('GeofencesPage — KPI band', () => {
  it('derives all four KPIs from the geofences and always shows the band', async () => {
    renderPage();
    await zones().findByText('Home');

    expect(summary().getByText('Total Geofences')).toBeInTheDocument();
    expect(kpiValue('Total Geofences')).toBe('3');
    expect(kpiValue('Active')).toBe('2');
    expect(kpiValue('Entry Alerts')).toBe('2');
    expect(kpiValue('Exit Alerts')).toBe('1');
  });

  it('shows skeletons (not KPI cards) while the geofences feed is in flight', () => {
    store.mode = 'pending';
    const { container } = renderPage();

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Total Geofences')).toBeNull();
  });

  it('keeps the KPI band visible with zero placeholders when the feed errors', async () => {
    store.mode = 'reject';
    store.error = new Error('kaboom');
    renderPage();

    // KPI band never disappears — it degrades to zeros.
    await waitFor(() => expect(kpiValue('Total Geofences')).toBe('0'));
    expect(kpiValue('Active')).toBe('0');
  });
});

// ── Zones panel states ───────────────────────────────────────────────────────
describe('GeofencesPage — zones panel states', () => {
  it('renders one card per geofence with the correct alert-type badge', async () => {
    renderPage();
    await zones().findByText('Home');

    expect(zones().getByText('Work')).toBeInTheDocument();
    expect(zones().getByText('Gym')).toBeInTheDocument();
    // alertBadgeLabel: both → "Entry & Exit", entry → "Entry", none → "None".
    expect(zones().getByText('Entry & Exit')).toBeInTheDocument();
    expect(zones().getByText('Entry')).toBeInTheDocument();
    expect(zones().getByText('None')).toBeInTheDocument();
  });

  it('renders a retry-able QueryError (not cards) when the feed fails', async () => {
    store.mode = 'reject';
    store.error = new Error('down');
    renderPage();

    const retry = await zones().findByRole('button', { name: 'Retry' });
    expect(zones().queryByText('Home')).toBeNull();
    const before = callsMatching('GET', (u) => u === '/geofences').length;
    fireEvent.click(retry);
    await waitFor(() =>
      expect(callsMatching('GET', (u) => u === '/geofences').length).toBeGreaterThan(before),
    );
  });

  it('shows the empty state with an Add CTA when there are no geofences', async () => {
    store.geofences = [];
    renderPage();

    expect(await zones().findByText('No geofences defined')).toBeInTheDocument();
    // The empty state offers its own "Add Geofence" action (plus the header one).
    expect(screen.getAllByRole('button', { name: 'Add Geofence' }).length).toBeGreaterThanOrEqual(1);
    expect(zones().queryByText('Home')).toBeNull();
  });
});

// ── Search + filters ─────────────────────────────────────────────────────────
describe('GeofencesPage — search and filtering', () => {
  it('filters the visible cards by name and surfaces an active-filter chip', async () => {
    renderPage();
    await zones().findByText('Home');

    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), {
      target: { value: 'Work' },
    });

    // Debounced — wait for the non-matching cards to drop out.
    await waitFor(() => expect(zones().queryByText('Home')).toBeNull());
    // The Work card survives (identified by its rename control, which is
    // unambiguous even though the filter chip also echoes "Work").
    expect(zones().getByRole('button', { name: 'Rename geofence Work' })).toBeInTheDocument();
    expect(zones().queryByText('Gym')).toBeNull();
    // The active-filter chip echoes the query.
    expect(
      within(screen.getByTestId('active-filter-chips')).getByText('Work'),
    ).toBeInTheDocument();
  });

  it('shows a "no matches" empty state with a clear action for an unmatched query', async () => {
    renderPage();
    await zones().findByText('Home');

    fireEvent.change(screen.getByPlaceholderText(/Search by name/i), {
      target: { value: 'zzz-nothing' },
    });

    expect(await zones().findByText('No geofences match your search.')).toBeInTheDocument();
    expect(zones().getByRole('button', { name: 'Clear search' })).toBeInTheDocument();
  });
});

// ── Per-card mutations ───────────────────────────────────────────────────────
describe('GeofencesPage — card mutations', () => {
  it('toggles a geofence via a partial PUT carrying only { enabled }', async () => {
    renderPage();
    await zones().findByText('Work');

    // Work is inactive → flipping the switch enables it.
    fireEvent.click(screen.getByRole('switch', { name: 'Toggle geofence Work' }));

    await waitFor(() => {
      const puts = callsMatching('PUT', (u) => u === '/geofences/2');
      expect(puts.length).toBeGreaterThan(0);
    });
    const put = callsMatching('PUT', (u) => u === '/geofences/2')[0];
    const body = JSON.parse((put[1] as { body: string }).body);
    expect(body).toEqual({ enabled: true });
  });

  it('deletes a geofence only after the confirm dialog is accepted', async () => {
    renderPage();
    await zones().findByText('Home');

    fireEvent.click(screen.getByRole('button', { name: 'Delete geofence Home' }));

    // Nothing is deleted until the destructive confirm is accepted.
    expect(callsMatching('DELETE', (u) => u === '/geofences/1')).toHaveLength(0);
    const dialog = await screen.findByRole('dialog', { name: 'Delete Geofence' });
    expect(within(dialog).getByText(/Are you sure you want to delete "Home"/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(callsMatching('DELETE', (u) => u === '/geofences/1').length).toBe(1),
    );
  });

  it('renames a geofence inline via a full-payload PUT', async () => {
    renderPage();
    await zones().findByText('Home');

    fireEvent.click(screen.getByRole('button', { name: 'Rename geofence Home' }));
    const input = await screen.findByTestId('editable-text-input');
    fireEvent.change(input, { target: { value: 'Casa' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(callsMatching('PUT', (u) => u === '/geofences/1').length).toBeGreaterThan(0);
    });
    const put = callsMatching('PUT', (u) => u === '/geofences/1')[0];
    const body = JSON.parse((put[1] as { body: string }).body);
    // Full merged payload — name plus the untouched fields (never a bare {name}).
    expect(body.name).toBe('Casa');
    expect(body.radius).toBe(100);
    expect(body).not.toHaveProperty('id');
  });
});

// ── Bulk selection ───────────────────────────────────────────────────────────
describe('GeofencesPage — bulk selection', () => {
  it('reveals the bulk toolbar on selection and bulk-deletes after confirmation', async () => {
    const { container } = renderPage();
    await zones().findByText('Home');

    // No toolbar until something is selected.
    expect(screen.queryByRole('region', { name: 'Bulk actions for selected items' })).toBeNull();

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select geofence Home' }));
    const toolbar = await screen.findByRole('region', { name: 'Bulk actions for selected items' });
    expect(within(toolbar).getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(container.querySelector('[data-bulk-action="delete"]') as HTMLElement);
    const dialog = await screen.findByRole('dialog', { name: 'Delete geofences?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() =>
      expect(callsMatching('POST', (u) => u === '/geofences/bulk').length).toBe(1),
    );
    const post = callsMatching('POST', (u) => u === '/geofences/bulk')[0];
    const body = JSON.parse((post[1] as { body: string }).body);
    // Frontend string ids are coerced to numeric ids for the bulk endpoint.
    expect(body).toEqual({ ids: [1], op: 'delete' });
  });
});

// ── Create modal ─────────────────────────────────────────────────────────────
describe('GeofencesPage — create modal', () => {
  it('blocks submit and surfaces field errors for an out-of-range latitude', async () => {
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Bad Zone' } });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '200' } });
    fireEvent.change(within(dialog).getByLabelText('Longitude'), { target: { value: '10' } });
    fireEvent.change(within(dialog).getByLabelText('Radius (meters)'), { target: { value: '100' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(
      within(dialog).getByText('Please fix the highlighted fields before saving.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Latitude must be between -90 and 90')).toBeInTheDocument();
    // A failed validation never reaches the network.
    expect(callsMatching('POST', (u) => u === '/geofences')).toHaveLength(0);
  });

  it('creates a geofence via POST with the numeric payload for valid input', async () => {
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Valid Zone' } });
    fireEvent.change(within(dialog).getByLabelText('Latitude'), { target: { value: '37.5' } });
    fireEvent.change(within(dialog).getByLabelText('Longitude'), { target: { value: '-122.5' } });
    fireEvent.change(within(dialog).getByLabelText('Radius (meters)'), { target: { value: '150' } });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    await waitFor(() =>
      expect(callsMatching('POST', (u) => u === '/geofences').length).toBe(1),
    );
    const post = callsMatching('POST', (u) => u === '/geofences')[0];
    const body = JSON.parse((post[1] as { body: string }).body);
    expect(body).toMatchObject({
      name: 'Valid Zone',
      latitude: 37.5,
      longitude: -122.5,
      radius: 150,
      alertOnEntry: true,
      alertOnExit: true,
      enabled: true,
      costPerKwh: null,
    });
    expect(toastMock.success).toHaveBeenCalledWith('Geofence created');
  });

  it('prompts to discard unsaved edits when cancelling a dirty form', async () => {
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'WIP' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    // Dirty → a discard confirmation intercepts the close.
    const discard = await screen.findByRole('dialog', { name: 'Unsaved changes' });
    expect(discard).toBeInTheDocument();
    fireEvent.click(within(discard).getByRole('button', { name: 'Discard changes' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Create Geofence' })).toBeNull(),
    );
  });

  it('captures a vehicle position → reverse-geocoded name into the form', async () => {
    store.vehicles = VEHICLES;
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.change(within(dialog).getByLabelText('Select Vehicle'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get Location' }));

    await waitFor(() =>
      expect((within(dialog).getByLabelText('Latitude') as HTMLInputElement).value).toBe('12.34'),
    );
    expect((within(dialog).getByLabelText('Longitude') as HTMLInputElement).value).toBe('56.78');
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Test Road, Test City');
    // snake_case, no /api/v1 prefix on the positions read.
    expect(callsMatching('GET', (u) => u.startsWith('/vehicles/5/positions')).length).toBe(1);
  });

  it('surfaces a friendly message when browser geolocation is denied', async () => {
    installGeolocation((_ok, err) => err?.({ code: 1, message: 'User denied' } as GeolocationPositionError));
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.click(within(dialog).getByRole('tab', { name: /Browser/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get Location' }));

    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith('Location access denied'));
  });

  it('degrades gracefully when the browser has no geolocation support', async () => {
    // No navigator.geolocation installed → the guard must not throw an
    // instanceof TypeError; it surfaces an "unsupported" toast instead.
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.click(within(dialog).getByRole('tab', { name: /Browser/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Get Location' }));

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('Geolocation is not supported by this browser'),
    );
  });

  it('copies a map-drawn circle into the latitude/longitude/radius fields', async () => {
    renderPage();
    await zones().findByText('Home');
    const dialog = await openCreateModal();

    fireEvent.click(within(dialog).getByRole('tab', { name: /Draw on map/ }));
    fireEvent.click(await within(dialog).findByTestId('geofence-drawer-create'));

    await waitFor(() =>
      expect((within(dialog).getByLabelText('Latitude') as HTMLInputElement).value).toBe('1.5'),
    );
    expect((within(dialog).getByLabelText('Longitude') as HTMLInputElement).value).toBe('2.5');
    expect((within(dialog).getByLabelText('Radius (meters)') as HTMLInputElement).value).toBe('123');
  });
});

// ── Edit modal ───────────────────────────────────────────────────────────────
describe('GeofencesPage — edit modal', () => {
  it('opens prefilled from a card and persists changes via PUT', async () => {
    renderPage();
    await zones().findByText('Home');

    fireEvent.click(screen.getByRole('button', { name: 'Edit geofence Home' }));
    const dialog = await screen.findByRole('dialog', { name: 'Edit Geofence' });

    // Prefilled from the selected geofence.
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('Home');
    expect((within(dialog).getByLabelText('Latitude') as HTMLInputElement).value).toBe('37.7749');

    fireEvent.change(within(dialog).getByLabelText('Name'), { target: { value: 'Home Base' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Update' }));

    await waitFor(() =>
      expect(callsMatching('PUT', (u) => u === '/geofences/1').length).toBeGreaterThan(0),
    );
    const put = callsMatching('PUT', (u) => u === '/geofences/1')[0];
    const body = JSON.parse((put[1] as { body: string }).body);
    expect(body).toMatchObject({ name: 'Home Base', latitude: 37.7749, radius: 100 });
  });
});

// ── AI section ───────────────────────────────────────────────────────────────
describe('GeofencesPage — AI Helix section', () => {
  it('hides every AI surface when the feature is off (ADR-015)', async () => {
    aiEnabledMock.mockReturnValue(false);
    renderPage();
    await zones().findByText('Home');

    expect(screen.queryByRole('region', { name: 'Suggest a geofence for this location' })).toBeNull();
    expect(screen.queryByTestId('ai-suggest')).toBeNull();
    expect(screen.queryByText('Helix')).toBeNull();
  });

  it('renders + wires the AI panel and parses the visited-location id when on', async () => {
    aiEnabledMock.mockReturnValue(true);
    renderPage();
    await zones().findByText('Home');

    expect(screen.getByTestId('ai-suggest')).toBeInTheDocument();
    expect(screen.getByText('Helix')).toBeInTheDocument();
    // Empty input → id 0; a positive integer flows straight through.
    expect(screen.getByTestId('ai-location-id')).toHaveTextContent('0');
    fireEvent.change(screen.getByPlaceholderText('501'), { target: { value: '42' } });
    expect(screen.getByTestId('ai-location-id')).toHaveTextContent('42');
  });

  it('applies an AI draft into a prefilled create modal', async () => {
    aiEnabledMock.mockReturnValue(true);
    renderPage();
    await zones().findByText('Home');

    fireEvent.click(screen.getByTestId('ai-apply-draft'));
    const dialog = await screen.findByRole('dialog', { name: 'Create Geofence' });

    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe('AI Zone');
    expect((within(dialog).getByLabelText('Latitude') as HTMLInputElement).value).toBe('12.5');
    expect((within(dialog).getByLabelText('Longitude') as HTMLInputElement).value).toBe('-34.5');
    expect((within(dialog).getByLabelText('Radius (meters)') as HTMLInputElement).value).toBe('200');
  });
});

// ── a11y & data contract ─────────────────────────────────────────────────────
describe('GeofencesPage — a11y & data contract', () => {
  it('names the labelled regions and exposes an accessible name on the enable switch', async () => {
    renderPage();
    await zones().findByText('Home');

    expect(screen.getByRole('region', { name: 'Geofence summary' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Geofence zones' })).toBeInTheDocument();
    // The switch's accessible name must live ON the switch button, not the wrapper.
    expect(screen.getByRole('switch', { name: 'Toggle geofence Home' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Edit geofence Gym' })).toBeInTheDocument();
  });

  it('reads geofences and pins without an /api/v1 prefix or camelCase params', async () => {
    renderPage();
    await zones().findByText('Home');

    const all = mockRequest.mock.calls.map((c) => String(c[0]));
    expect(all.some((u) => u === '/geofences')).toBe(true);
    expect(all.some((u) => u.startsWith('/pinned?type=geofence'))).toBe(true);
    expect(all.every((u) => !u.includes('/api/v1'))).toBe(true);
    expect(all.every((u) => !/[?&][a-z]+[A-Z]/.test(u))).toBe(true);
  });
});
