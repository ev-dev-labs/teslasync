/**
 * SessionListSection — behaviour + hardening coverage.
 *
 * The section is the charging-history list surface: it frames a debounced
 * search box + active-filter chips, a charger-type filter group, a sort-key
 * group, CSV/JSON export links, the session-card list (or a "no matches" empty
 * state), an optional bulk-actions toolbar, and pagination. It owns almost no
 * state of its own — every control reports up through a callback prop — so this
 * suite drives each branch and asserts the wiring that matters:
 *
 *   - loading renders skeletons and withholds the search/list chrome,
 *   - a missing/empty `sessions` source shows the "no sessions yet" empty state,
 *   - the populated path lists a card per filtered session, stamps the header
 *     count, and forwards `selected` / `distanceUnit` to each card,
 *   - the charger + sort groups report the right key up, expose `aria-pressed`
 *     for the active control (the a11y hardening), and toggle vs. change on the
 *     already-active sort key,
 *   - the debounced search box emits the typed query,
 *   - active-filter chips summarise search + charger filters and route removals
 *     + "clear all" back through the callbacks,
 *   - export links build through the shared `apiUrl()` helper so they honour the
 *     API base and carry snake_case `vehicle_id` + the active range (the bug
 *     fix: the hardcoded `/api/v1/...` literal is gone and never double-prefixes),
 *   - a non-empty filtered slice with all bulk callbacks wires select → confirm
 *     → `onBulkDelete([numeric ids])`, and the toolbar is gated off when a
 *     callback is missing,
 *   - pagination page-size changes reset to page 1,
 *   - null-safety: a nullish `filteredSessions` degrades to the empty state
 *     instead of throwing on `.length`/`.map`.
 *
 * `react-i18next` is doubled so the English fallback (and `{{var}}` /
 * options-bag `defaultValue`) render — assertions read on human copy. The
 * motion wrappers are flattened (they are pure visual chrome and pull in
 * framer-motion + matchMedia). `ChargingSessionCard` is a light double that
 * surfaces its id + forwarded props and a toggle affordance so the card→select
 * wiring stays assertable without dragging in the whole card subtree. Every
 * other shared component (Button, Pagination, SearchInput, ActiveFilterChips,
 * BulkActionsToolbar/ConfirmDialog, EmptyState, Skeleton) and the real
 * `apiUrl()` helper are the genuine implementations. This component has no data
 * source of its own, so the network is never touched.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ReactNode } from 'react';

import type { ChargingSession } from '@/api/types';
import { SessionListSection } from './SessionListSection';

// ── i18n: resolve the string fallback (2nd arg) or the options-bag
//    `defaultValue`, then interpolate {{placeholders}} so assertions read on
//    copy. ──────────────────────────────────────────────────────────────────
vi.mock('react-i18next', () => {
  const interpolate = (str: string, vars?: Record<string, unknown> | null): string => {
    if (!vars) return str;
    let s = str;
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`{{\\s*${k}\\s*}}`, 'g'), String(v));
    }
    return s;
  };
  const t = (key: string, second?: unknown, third?: unknown): string => {
    if (typeof second === 'string') {
      return interpolate(second, third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined);
    }
    if (second && typeof second === 'object') {
      const bag = second as Record<string, unknown>;
      const tpl = typeof bag.defaultValue === 'string' ? bag.defaultValue : key;
      return interpolate(tpl, bag);
    }
    return key;
  };
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── motion wrappers: flatten to plain divs (framer-motion + matchMedia are
//    irrelevant to this section's behaviour). ─────────────────────────────────
vi.mock('@/components/motion', () => ({
  FadeIn: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerContainer: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
  StaggerItem: ({ children, className }: { children?: ReactNode; className?: string }) => (
    <div className={className}>{children}</div>
  ),
}));

// ── ChargingSessionCard double: surface the id + forwarded props (selected,
//    distanceUnit) and a toggle affordance so the card→onToggleSelect wiring
//    stays observable without the card's own formatting/routing subtree. ──────
vi.mock('../ChargingSessionCard', () => ({
  ChargingSessionCard: ({
    session,
    distanceUnit,
    selected,
    onToggleSelect,
  }: {
    session: ChargingSession;
    distanceUnit: string;
    selected?: boolean;
    onToggleSelect?: (id: number, on: boolean) => void;
  }) => (
    <div
      data-testid={`session-card-${session.id}`}
      data-selected={String(Boolean(selected))}
      data-distance-unit={distanceUnit}
    >
      <button type="button" onClick={() => onToggleSelect?.(session.id, true)}>
        {`toggle-${session.id}`}
      </button>
    </div>
  ),
}));

function makeSession(id: number, over: Partial<ChargingSession> = {}): ChargingSession {
  return {
    id,
    vehicle_id: 5,
    started_at: '2026-01-10T08:00:00Z',
    ended_at: '2026-01-10T09:00:00Z',
    start_soc_pct: 20,
    end_soc_pct: 80,
    delta_soc_pct: 60,
    start_odometer_m: null,
    end_odometer_m: null,
    start_lat: null,
    start_lng: null,
    start_place: 'Home',
    total_energy_added_wh: 30000,
    peak_power_w: 11000,
    avg_power_w: 9000,
    cost_decimal: 4.2,
    cost_currency: 'USD',
    charger_type: 'supercharger',
    cable_type: null,
    startedAt: '2026-01-10T08:00:00Z',
    duration_min: 60,
    ...over,
  };
}

const SESSIONS: ChargingSession[] = [
  makeSession(101, { charger_type: 'supercharger' }),
  makeSession(102, { charger_type: 'home' }),
  makeSession(103, { charger_type: 'dc' }),
];

type Props = Parameters<typeof SessionListSection>[0];

const SEARCH_PLACEHOLDER = 'Search by location or charger type…';

function baseProps(over: Partial<Props> = {}): Props {
  return {
    sessions: SESSIONS,
    filteredSessions: SESSIONS,
    isLoading: false,
    toDistanceDisplay: (x: number) => x,
    distanceUnit: 'km',
    sortBy: 'date',
    sortDesc: true,
    chargerFilter: 'all',
    searchQuery: '',
    onSearchQueryChange: vi.fn(),
    onSortChange: vi.fn(),
    onSortToggle: vi.fn(),
    onChargerFilterChange: vi.fn(),
    page: 1,
    pageSize: 25,
    onPageChange: vi.fn(),
    onPageSizeChange: vi.fn(),
    startDate: '2026-01-01',
    endDate: '2026-01-31',
    vehicleId: 5,
    ...over,
  };
}

function renderSection(over: Partial<Props> = {}) {
  const props = baseProps(over);
  const utils = render(
    <MemoryRouter>
      <SessionListSection {...props} />
    </MemoryRouter>,
  );
  return { props, ...utils };
}

beforeEach(() => {
  // SearchInput's history dropdown reads localStorage; keep it deterministic.
  localStorage.clear();
});

describe('SessionListSection — loading', () => {
  it('renders skeletons and withholds the search/list chrome while loading', () => {
    const { container } = renderSection({ isLoading: true });

    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(5);
    // None of the populated chrome mounts during load.
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
    expect(screen.queryByText('All Sessions')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('SessionListSection — no sessions', () => {
  it('shows the "no sessions yet" empty state when the source is undefined', () => {
    renderSection({ sessions: undefined, filteredSessions: [] });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No charging sessions yet')).toBeInTheDocument();
    // Empty source ⇒ no search box, no export links.
    expect(screen.queryByPlaceholderText(SEARCH_PLACEHOLDER)).toBeNull();
    expect(screen.queryByRole('link', { name: /CSV/ })).toBeNull();
  });

  it('shows the same empty state for an empty sessions array', () => {
    renderSection({ sessions: [], filteredSessions: [] });

    expect(screen.getByText('No charging sessions yet')).toBeInTheDocument();
    expect(screen.queryByTestId('session-card-101')).toBeNull();
  });
});

describe('SessionListSection — populated list', () => {
  it('lists one card per filtered session, stamps the header count, and forwards selected/unit', () => {
    renderSection({
      distanceUnit: 'mi',
      selectedIds: new Set([102]),
    });

    // A card per filtered session.
    expect(screen.getByTestId('session-card-101')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-102')).toBeInTheDocument();
    expect(screen.getByTestId('session-card-103')).toBeInTheDocument();

    // Header count reflects the filtered length.
    expect(screen.getByText('(3)')).toBeInTheDocument();

    // Forwarded props: only 102 is selected; the display unit reaches the card.
    expect(screen.getByTestId('session-card-102')).toHaveAttribute('data-selected', 'true');
    expect(screen.getByTestId('session-card-101')).toHaveAttribute('data-selected', 'false');
    expect(screen.getByTestId('session-card-101')).toHaveAttribute('data-distance-unit', 'mi');

    // The section chrome frames the list.
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Pagination' })).toBeInTheDocument();
  });
});

describe('SessionListSection — charger filter', () => {
  it('reports the clicked charger key and marks the active control with aria-pressed', () => {
    const { props } = renderSection({ chargerFilter: 'home' });

    // Active control exposes pressed state; the others do not.
    expect(screen.getByRole('button', { name: 'Home', pressed: true })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All', pressed: false })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'SC' }));
    expect(props.onChargerFilterChange).toHaveBeenCalledWith('supercharger');
  });
});

describe('SessionListSection — sort controls', () => {
  it('calls onSortChange for a new key and onSortToggle for the already-active key', () => {
    const { props } = renderSection({ sortBy: 'date', sortDesc: true });

    // Clicking a different key selects it.
    fireEvent.click(screen.getByRole('button', { name: 'kWh' }));
    expect(props.onSortChange).toHaveBeenCalledWith('energy');
    expect(props.onSortToggle).not.toHaveBeenCalled();

    // Clicking the active key flips the direction instead of re-selecting.
    fireEvent.click(screen.getByRole('button', { name: /^Date/ }));
    expect(props.onSortToggle).toHaveBeenCalledTimes(1);
    expect(props.onSortChange).toHaveBeenCalledTimes(1);
  });

  it('marks the active sort with aria-pressed and shows a descending arrow (hidden from AT)', () => {
    renderSection({ sortBy: 'date', sortDesc: true });

    const active = screen.getByRole('button', { name: /^Date/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    // The arrow is a visual affordance…
    expect(active.textContent).toContain('↓');
    // …but excluded from the accessible name via aria-hidden.
    expect(active.querySelector('[aria-hidden="true"]')?.textContent).toBe('↓');
  });

  it('shows an ascending arrow when sortDesc is false', () => {
    renderSection({ sortBy: 'cost', sortDesc: false });

    const active = screen.getByRole('button', { name: /^Cost/ });
    expect(active).toHaveAttribute('aria-pressed', 'true');
    expect(active.textContent).toContain('↑');
  });
});

describe('SessionListSection — search', () => {
  it('emits the typed query after the debounce window', async () => {
    const { props } = renderSection();

    fireEvent.change(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), { target: { value: 'supercharger' } });

    await waitFor(() =>
      expect(props.onSearchQueryChange).toHaveBeenCalledWith('supercharger'),
    );
  });
});

describe('SessionListSection — active filter chips', () => {
  it('summarises the active search + charger filters and routes removals back through callbacks', () => {
    const { props } = renderSection({ searchQuery: 'home', chargerFilter: 'supercharger' });

    // Both chips render their label + value.
    const chipGroup = screen.getByRole('group', { name: 'Active filters' });
    expect(within(chipGroup).getByText('home')).toBeInTheDocument();
    expect(within(chipGroup).getByText('SC')).toBeInTheDocument();

    // Removing the search chip clears just the search query.
    fireEvent.click(screen.getByRole('button', { name: 'Remove filter Search' }));
    expect(props.onSearchQueryChange).toHaveBeenCalledWith('');
    expect(props.onChargerFilterChange).not.toHaveBeenCalled();
  });

  it('clears both search and charger filters via "Clear all"', () => {
    const { props } = renderSection({ searchQuery: 'home', chargerFilter: 'supercharger' });

    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(props.onSearchQueryChange).toHaveBeenCalledWith('');
    expect(props.onChargerFilterChange).toHaveBeenCalledWith('all');
  });
});

describe('SessionListSection — export links', () => {
  it('builds CSV/JSON hrefs through apiUrl() with snake_case vehicle_id + the active range', () => {
    const { container } = renderSection({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      vehicleId: 5,
    });

    const csv = container.querySelector('a[download="teslasync-charging.csv"]');
    const json = container.querySelector('a[download="teslasync-charging.json"]');

    const csvHref = csv?.getAttribute('href') ?? '';
    expect(csvHref).toContain('/api/v1/export/charging?format=csv');
    expect(csvHref).toContain('vehicle_id=5');
    expect(csvHref).toContain('start=2026-01-01');
    expect(csvHref).toContain('end=2026-01-31');
    // Regression guard: apiUrl() must never double-prefix.
    expect(csvHref).not.toContain('/api/v1/api/v1');

    expect(json?.getAttribute('href') ?? '').toContain('format=json');
  });

  it('omits range + vehicle params when they are absent', () => {
    const { container } = renderSection({ startDate: '', endDate: '', vehicleId: null });

    const csvHref =
      container.querySelector('a[download="teslasync-charging.csv"]')?.getAttribute('href') ?? '';
    expect(csvHref).toContain('/api/v1/export/charging?format=csv');
    expect(csvHref).not.toContain('start=');
    expect(csvHref).not.toContain('end=');
    expect(csvHref).not.toContain('vehicle_id=');
  });
});

describe('SessionListSection — no matches', () => {
  it('shows the "no matches" empty state and withholds the cards when the filter set is empty', () => {
    renderSection({ sessions: SESSIONS, filteredSessions: [] });

    expect(screen.getByText('No sessions match your filters')).toBeInTheDocument();
    expect(screen.queryByTestId('session-card-101')).toBeNull();
    // The search + sort chrome still frames the (empty) result.
    expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toBeInTheDocument();
  });
});

describe('SessionListSection — bulk actions', () => {
  it('does not render the bulk toolbar unless all bulk callbacks are supplied', () => {
    // onBulkDelete present but onClearSelection / onToggleSelected missing.
    renderSection({ selectedIds: new Set([101]), onBulkDelete: vi.fn() });

    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('wires select → confirm → onBulkDelete with numeric ids', async () => {
    const onBulkDelete = vi.fn().mockResolvedValue(undefined);
    renderSection({
      selectedIds: new Set([101]),
      onToggleSelected: vi.fn(),
      onClearSelection: vi.fn(),
      onBulkDelete,
    });

    // Toolbar surfaces the selection count.
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // Trigger the destructive action → confirm dialog opens.
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete 1 charging session?')).toBeInTheDocument();

    // Confirm inside the dialog → mutation receives the numeric ids.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(onBulkDelete).toHaveBeenCalledWith([101]));
  });

  it('forwards a card toggle up through onToggleSelected', () => {
    const onToggleSelected = vi.fn();
    renderSection({
      onToggleSelected,
      onClearSelection: vi.fn(),
      onBulkDelete: vi.fn().mockResolvedValue(undefined),
    });

    fireEvent.click(screen.getByRole('button', { name: 'toggle-101' }));
    expect(onToggleSelected).toHaveBeenCalledWith(101, true);
  });
});

describe('SessionListSection — pagination', () => {
  it('resets to page 1 when the page size changes', () => {
    const { props } = renderSection({ page: 2, pageSize: 25 });

    fireEvent.change(screen.getByRole('combobox', { name: 'Rows per page' }), {
      target: { value: '50' },
    });

    expect(props.onPageSizeChange).toHaveBeenCalledWith(50);
    expect(props.onPageChange).toHaveBeenCalledWith(1);
  });
});

describe('SessionListSection — null safety', () => {
  it('degrades to the empty state instead of throwing when filteredSessions is nullish', () => {
    expect(() =>
      renderSection({
        sessions: SESSIONS,
        filteredSessions: undefined as unknown as ChargingSession[],
      }),
    ).not.toThrow();

    expect(screen.getByText('No sessions match your filters')).toBeInTheDocument();
    expect(screen.getByText('(0)')).toBeInTheDocument();
  });
});
