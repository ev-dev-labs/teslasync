/**
 * AutomationListTable — behavioural coverage for the bulk-manage table band.
 *
 * The file exports a single component (`AutomationListTable`) that wraps the
 * shared `DataTable` with automation-specific columns, controlled multi-select,
 * client-side header sorting, and independent loading / error / empty / no-match
 * states. These tests drive it entirely through its public prop surface and
 * assert real, observable behaviour:
 *
 *   • every column renders (name link + href, description, vehicle lookup with
 *     all three fallbacks, run counts, failure colouring, last-triggered, status
 *     badges);
 *   • the controlled sort accessor is correct for each key + direction, and a
 *     corrupt timestamp sorts as "oldest" rather than corrupting the order (the
 *     NaN-comparator guard);
 *   • selection wiring emits the right keys for row-toggle, select-all, and
 *     deselect;
 *   • the four render states are mutually exclusive and accessible; and
 *   • null / undefined inputs never crash (defensive null-safety).
 *
 * i18n is mocked to echo each `t(key, fallback, opts)` fallback and interpolate
 * `{{var}}` placeholders so assertions read against the English copy. The
 * component is prop-driven — no network is touched. A `<MemoryRouter>` wraps
 * every render because the name column and empty-state CTA use `<Link>`.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { type ComponentProps } from 'react';

import { AutomationListTable } from './AutomationListTable';
import type { Automation } from '@/api/types';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tmpl: string, vars?: Record<string, unknown>) =>
    vars ? tmpl.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? '')) : tmpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (
        key: string,
        fallback?: string | Record<string, unknown>,
        opts?: Record<string, unknown>,
      ) => (typeof fallback === 'string' ? interpolate(fallback, opts) : interpolate(key, fallback)),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

type Props = ComponentProps<typeof AutomationListTable>;

// ── Fixtures ────────────────────────────────────────────────────────────────
// The full `Automation` type intersects a "removed-compatibility" shape whose
// keys are typed `never`, so plain object literals can't satisfy it directly.
// The factory builds a complete row and double-casts, mirroring how the API
// client hands back `request<Automation[]>` values at runtime.
function makeAutomation(overrides: Partial<Automation> = {}): Automation {
  const base = {
    id: 1,
    name: 'Base automation',
    description: null,
    enabled: true,
    vehicle_id: null,
    created_at: '2024-01-01T00:00:00Z',
    updated_at: '2024-01-01T00:00:00Z',
    stop_on_failure: false,
    notify_on_run: false,
    notify_on_failure: false,
    seasonal_start: null,
    seasonal_end: null,
    last_triggered_at: null,
    last_success_at: null,
    last_failure_at: null,
    execution_count: 0,
    failure_count: 0,
    consecutive_failures: 0,
    auto_disabled: false,
    auto_disabled_reason: null,
    preset_id: null,
  };
  return { ...base, ...overrides } as unknown as Automation;
}

// Alpha: enabled, known vehicle, 5 runs, 0 failures, never triggered.
const alpha = makeAutomation({
  id: 1,
  name: 'Alpha',
  description: 'Nightly charge cap',
  vehicle_id: 10,
  enabled: true,
  auto_disabled: false,
  execution_count: 5,
  failure_count: 0,
  last_triggered_at: null,
});
// bravo (lowercase — proves case-insensitive name sort): disabled, ALL vehicles,
// 100 runs, 3 failures.
const bravo = makeAutomation({
  id: 2,
  name: 'bravo',
  description: null,
  vehicle_id: null,
  enabled: false,
  auto_disabled: false,
  execution_count: 100,
  failure_count: 3,
  last_triggered_at: null,
});
// Charlie: auto-disabled, UNKNOWN vehicle (99 not in lookup), 20 runs, triggered
// long ago (absolute-date fallback).
const charlie = makeAutomation({
  id: 3,
  name: 'Charlie',
  description: 'Sentry on leave',
  vehicle_id: 99,
  enabled: true,
  auto_disabled: true,
  execution_count: 20,
  failure_count: 0,
  last_triggered_at: '2020-01-15T12:00:00Z',
});

const vehicleLookup = new Map<number, string>([[10, 'Model 3']]);

function renderTable(overrides: Partial<Props> = {}) {
  const onSelectionChange = vi.fn();
  const onRetry = vi.fn();
  const props: Props = {
    automations: [alpha, bravo, charlie],
    vehicleLookup,
    selectedKeys: [],
    onSelectionChange,
    isLoading: false,
    error: null,
    onRetry,
    totalCount: 3,
    ...overrides,
  };
  const view = render(
    <MemoryRouter>
      <AutomationListTable {...props} />
    </MemoryRouter>,
  );
  return { onSelectionChange, onRetry, ...view };
}

// Name-column links render in row order, so their text is the visible sort order.
const nameOrder = () => screen.getAllByRole('link').map((a) => a.textContent);

beforeEach(() => {
  window.localStorage.clear();
});

// ── Data rendering ──────────────────────────────────────────────────────────
describe('AutomationListTable — data rendering', () => {
  it('renders a name link per row pointing at the automation detail route', () => {
    renderTable();
    const alphaLink = screen.getByRole('link', { name: 'Alpha' });
    expect(alphaLink).toHaveAttribute('href', '/automations/1');
    expect(screen.getByRole('link', { name: 'bravo' })).toHaveAttribute('href', '/automations/2');
    expect(screen.getByRole('link', { name: 'Charlie' })).toHaveAttribute('href', '/automations/3');
  });

  it('resolves the Vehicle column with lookup hit, all-vehicles, and unknown fallback', () => {
    renderTable();
    expect(screen.getByText('Model 3')).toBeInTheDocument(); // vehicle_id 10 → lookup hit
    expect(screen.getByText('All vehicles')).toBeInTheDocument(); // vehicle_id null
    expect(screen.getByText('Vehicle #99')).toBeInTheDocument(); // vehicle_id 99, not in lookup
  });

  it('renders run counts, descriptions, and the absolute-date last-triggered fallback', () => {
    renderTable();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('20')).toBeInTheDocument();
    expect(screen.getByText('Nightly charge cap')).toBeInTheDocument();
    // formatRelative() falls back to an absolute date for >7-day-old timestamps.
    expect(screen.getByText(/2020/)).toBeInTheDocument();
  });

  it('renders the correct status badge for enabled / disabled / auto-disabled rows', () => {
    renderTable();
    expect(screen.getByText('Enabled')).toBeInTheDocument();
    expect(screen.getByText('Disabled')).toBeInTheDocument();
    expect(screen.getByText('Auto-disabled')).toBeInTheDocument();
  });

  it('colours a non-zero failure count rose and a zero count muted', () => {
    renderTable();
    const failing = screen.getByText('3'); // bravo — the only "3" in the table
    expect(failing.className).toContain('text-rose-300');
    const zeros = screen.getAllByText('0'); // alpha + charlie failure cells
    expect(zeros.length).toBeGreaterThanOrEqual(1);
    expect(zeros[0].className).toContain('text-[var(--text-muted)]');
  });
});

// ── Sorting ─────────────────────────────────────────────────────────────────
describe('AutomationListTable — controlled sorting', () => {
  it('defaults to case-insensitive name ascending', () => {
    renderTable();
    expect(nameOrder()).toEqual(['Alpha', 'bravo', 'Charlie']);
  });

  it('toggles the active column direction on repeat clicks (name asc → desc)', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(nameOrder()).toEqual(['Charlie', 'bravo', 'Alpha']);
  });

  it('sorts numerically by run count, ascending then descending', () => {
    renderTable();
    const runs = () => screen.getByRole('button', { name: 'Runs' });
    fireEvent.click(runs());
    expect(nameOrder()).toEqual(['Alpha', 'Charlie', 'bravo']); // 5, 20, 100
    fireEvent.click(runs());
    expect(nameOrder()).toEqual(['bravo', 'Charlie', 'Alpha']); // 100, 20, 5
  });

  it('sorts by failure count with a stable tie order', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Failures' }));
    // 0 (alpha), 0 (charlie) keep input order; 3 (bravo) sorts last.
    expect(nameOrder()).toEqual(['Alpha', 'Charlie', 'bravo']);
  });

  it('sorts by vehicle label, treating all-vehicles / unknown as empty', () => {
    renderTable();
    fireEvent.click(screen.getByRole('button', { name: 'Vehicle' }));
    // '' (bravo), '' (charlie) precede 'model 3' (alpha).
    expect(nameOrder()).toEqual(['bravo', 'Charlie', 'Alpha']);
  });

  it('ranks status enabled < disabled < auto-disabled (descending shows worst first)', () => {
    renderTable();
    const status = () => screen.getByRole('button', { name: 'Status' });
    fireEvent.click(status()); // asc
    expect(nameOrder()).toEqual(['Alpha', 'bravo', 'Charlie']);
    fireEvent.click(status()); // desc
    expect(nameOrder()).toEqual(['Charlie', 'bravo', 'Alpha']);
  });

  it('sorts a corrupt last_triggered_at as oldest instead of corrupting the order', () => {
    // Input order is [valid, invalid]; the NaN-comparator guard must coerce the
    // invalid timestamp to 0 so it sorts BEFORE the valid one ascending. Without
    // the guard a NaN return leaves the input order untouched ('Aardvark' first).
    const validRow = makeAutomation({ id: 41, name: 'Aardvark', last_triggered_at: '2025-06-01T12:00:00Z' });
    const corruptRow = makeAutomation({ id: 42, name: 'Zebra', last_triggered_at: 'not-a-real-date' });
    renderTable({ automations: [validRow, corruptRow], totalCount: 2 });
    expect(nameOrder()).toEqual(['Aardvark', 'Zebra']); // default name asc
    fireEvent.click(screen.getByRole('button', { name: 'Last triggered' }));
    expect(nameOrder()).toEqual(['Zebra', 'Aardvark']); // corrupt (0) sorts first asc
  });
});

// ── Selection ───────────────────────────────────────────────────────────────
describe('AutomationListTable — controlled selection', () => {
  it('emits the row key when an unselected row checkbox is toggled', () => {
    const { onSelectionChange } = renderTable();
    // Each checkbox is named after its automation (A11Y): "Select Alpha",
    // not three indistinguishable "Select row" controls.
    const rowCheckboxes = screen.getAllByRole('checkbox', { name: /^Select (?!all)/ });
    expect(rowCheckboxes).toHaveLength(3);
    fireEvent.click(rowCheckboxes[0]); // Alpha (id 1) — first row in name-asc order
    expect(onSelectionChange).toHaveBeenCalledWith([1]);
  });

  it('names each row checkbox after the automation it selects', () => {
    renderTable();
    expect(screen.getByRole('checkbox', { name: 'Select Alpha' })).toBeInTheDocument();
  });

  it('emits every visible key when the header select-all is toggled', () => {
    const { onSelectionChange } = renderTable();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select all rows' }));
    expect(onSelectionChange).toHaveBeenCalledWith([1, 2, 3]);
  });

  it('removes a key when an already-selected row is toggled off', () => {
    const { onSelectionChange } = renderTable({ selectedKeys: [1] });
    fireEvent.click(screen.getByRole('checkbox', { name: /^Deselect / }));
    expect(onSelectionChange).toHaveBeenCalledWith([]);
  });
});

// ── Render states ─────────────────────────────────────────────────────────
describe('AutomationListTable — render states', () => {
  it('shows an accessible loading status and no table while loading', () => {
    renderTable({ isLoading: true });
    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByText('Loading automations…')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    // The panel title is always present, even mid-load.
    expect(screen.getByText('All automations')).toBeInTheDocument();
  });

  it('renders a QueryError with a working Retry action on failure', () => {
    const { onRetry } = renderTable({ error: new Error('boom'), isLoading: false });
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('shows the first-run empty state (with builder CTA) when there are no automations at all', () => {
    renderTable({ automations: [], totalCount: 0 });
    expect(screen.getByText('No automations yet')).toBeInTheDocument();
    const cta = screen.getByRole('link', { name: 'Open builder' });
    expect(cta).toHaveAttribute('href', '/automations/new');
  });

  it('distinguishes "no matches" (filtered to empty) from "no automations"', () => {
    // totalCount > 0 but zero visible rows → the table renders its own
    // no-match message, NOT the first-run empty state.
    renderTable({ automations: [], totalCount: 5 });
    expect(screen.getByText('No automations match your filters')).toBeInTheDocument();
    expect(screen.queryByText('No automations yet')).not.toBeInTheDocument();
    expect(screen.getByRole('table')).toBeInTheDocument();
  });
});

// ── Null-safety & accessibility ─────────────────────────────────────────────
describe('AutomationListTable — null-safety & a11y', () => {
  it('renders em-dash placeholders for null description and last_triggered', () => {
    const sparse = makeAutomation({
      id: 7,
      name: 'Sparse',
      description: null,
      vehicle_id: null,
      last_triggered_at: null,
    });
    renderTable({ automations: [sparse], totalCount: 1 });
    // description → '—' and last_triggered → '—'.
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(screen.getByText('All vehicles')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sparse' })).toBeInTheDocument();
  });

  it('does not crash when automations / vehicleLookup arrive undefined', () => {
    expect(() =>
      renderTable({
        automations: undefined,
        vehicleLookup: undefined,
        totalCount: 1,
      }),
    ).not.toThrow();
    // Falls back to the table branch with an empty, guarded data set.
    expect(screen.getByText('No automations match your filters')).toBeInTheDocument();
  });

  it('exposes every sortable column header as a keyboard-operable button', () => {
    renderTable();
    for (const header of ['Name', 'Vehicle', 'Runs', 'Failures', 'Last triggered', 'Status']) {
      expect(screen.getByRole('button', { name: header })).toBeInTheDocument();
    }
    // Description is intentionally non-sortable — no button for it.
    expect(screen.queryByRole('button', { name: 'Description' })).not.toBeInTheDocument();
  });
});
