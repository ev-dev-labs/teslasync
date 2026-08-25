/**
 * SignalCatalogWidget — behavioural, branch, null-safety and a11y coverage for
 * the dashboard "Signal Catalog" widget.
 *
 * The widget reads two hooks — `useSignalCatalog()` (the catalog entries, whose
 * TanStack Query state also drives the header freshness chip) and
 * `useSignalObservations(id)` (per-signal observation counts) — and renders one
 * of several branches driven by `size.cols` and the query state:
 *   • loading  → WidgetShell renders only a skeleton (no header, no content);
 *   • empty    → an EmptyState ("No signals in catalog");
 *   • error    → an EmptyState with a DISTINCT "failed to load" message when the
 *                catalog errors with no cached data (the bug fix — the pre-fix
 *                widget mislabeled a failed load as "no signals");
 *   • compact (cols ≤ 1) → a single big signal-count figure, no search box;
 *   • standard (cols ≥ 2) → a search box + a source-module-grouped, alpha-sorted
 *                list of signals with unit badges and per-signal observation
 *                counts.
 *
 * What this file pins:
 *   - the LAYOUT SWITCH (loading / empty / error / compact / standard) and each
 *     branch's distinguishing output;
 *   - the ERROR fix — an errored initial load (no data) shows a "failed to load"
 *     message, NOT the misleading "no signals" empty state, while a
 *     background-refetch error over cached data keeps the list on screen;
 *   - the SEARCH filter across name / description / source_module, and its
 *     "no matching signals" empty state;
 *   - the GROUPING + alpha SORT of categories and the observation-count join
 *     (matched by signal name, null-safe "0" for unmatched signals);
 *   - the NULL-SAFETY hardening — a malformed entry with an undefined `name`
 *     neither crashes the search filter nor the row render (it degrades to "—");
 *   - the observations WIRING — the resolved vehicle id (`vehicleId` prop →
 *     first vehicle → 0) is what reaches `useSignalObservations`;
 *   - the a11y search label and the REFRESH control (freshness chip → refetch).
 *
 * Strategy: both data hooks are the network boundary and are fully controllable
 * via hoisted mocks. `react-i18next` echoes each `t(key, fallback)` fallback so
 * assertions read against English copy. The freshness chip's display hooks
 * (`useDateFormat` / `useMotionPreference`) are stubbed so WidgetShell renders
 * synchronously without a Settings/QueryClient provider.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';

import type { SignalCatalogEntry, SignalObservation } from '@/types/signals';
import type { WidgetSize } from './types';

// ── Hoisted mocks (referenced inside vi.mock factories) ─────────────────────────

const { catalogMock, observationsMock, vehiclesMock } = vi.hoisted(() => ({
  catalogMock: vi.fn(),
  observationsMock: vi.fn(),
  vehiclesMock: vi.fn(),
}));

// The two network boundaries the widget consumes.
vi.mock('@/api/hooks/useTelemetry', () => ({
  useSignalCatalog: () => catalogMock(),
  useSignalObservations: (id: unknown) => observationsMock(id),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useVehicles: () => vehiclesMock(),
}));

// i18n → echo the developer fallback, interpolating `{{var}}` placeholders so
// copy reads as English regardless of namespace.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interp = (tpl: string, opts?: Record<string, unknown>) =>
    opts ? tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (opts[k] != null ? String(opts[k]) : '')) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (_key: string, fallback?: string, opts?: Record<string, unknown>) =>
        typeof fallback === 'string' ? interp(fallback, opts) : _key,
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Freshness chip display hooks — stubbed so the WidgetShell header renders
// deterministically without a Settings/QueryClient provider.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({ formatTime: (v: unknown) => String(v) }),
}));
vi.mock('@/hooks/useMotionPreference', () => ({
  useMotionPreference: () => ({ reduce: false, durationMs: 250 }),
}));

import SignalCatalogWidget from './SignalCatalogWidget';

// ── Fixtures ────────────────────────────────────────────────────────────────────

const NOW = '2026-07-05T12:00:00.000Z';

function makeEntry(over: Partial<SignalCatalogEntry> = {}): SignalCatalogEntry {
  return {
    name: 'BatteryLevel',
    value_type: 'numeric',
    source_module: 'battery',
    unit: '%',
    description: 'State of charge',
    first_seen_at: NOW,
    last_seen_at: NOW,
    ...over,
  };
}

function makeObs(over: Partial<SignalObservation> = {}): SignalObservation {
  return {
    vehicle_id: 7,
    ts: NOW,
    signal_name: 'BatteryLevel',
    value_numeric: 50,
    value_text: null,
    value_bool: null,
    source: 'fleet_telemetry',
    ...over,
  };
}

interface CatalogOverrides {
  data?: SignalCatalogEntry[];
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setCatalog(over: CatalogOverrides = {}) {
  const q = {
    data: undefined as SignalCatalogEntry[] | undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.parse(NOW),
    refetch: vi.fn(),
    ...over,
  };
  catalogMock.mockReturnValue(q);
  return q;
}

function setObservations(rows: SignalObservation[] | undefined) {
  observationsMock.mockReturnValue({ data: rows });
}

const STANDARD: WidgetSize = { cols: 2, rows: 3 };
const COMPACT: WidgetSize = { cols: 1, rows: 1 };

function renderWidget(size: WidgetSize = STANDARD, vehicleId?: number) {
  return render(<SignalCatalogWidget size={size} vehicleId={vehicleId} />);
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  setObservations([]);
  setCatalog({ data: [makeEntry()] });
});

// ── Loading / empty / error states ────────────────────────────────────────────

describe('SignalCatalogWidget — loading / empty / error states', () => {
  it('renders only a skeleton (no header, search or empty copy) while loading', () => {
    setCatalog({ isLoading: true, data: undefined });
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeNull();
  });

  it('shows the empty state when the catalog loaded with zero entries and no error', () => {
    setCatalog({ data: [] });
    renderWidget(STANDARD);

    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load signal catalog')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows a distinct "failed to load" message (not "no signals") on an errored initial load', () => {
    setCatalog({ isError: true, data: undefined });
    renderWidget(STANDARD);

    expect(screen.getByText('Failed to load signal catalog')).toBeInTheDocument();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
  });

  it('keeps the cached list visible (no error copy) when a background refetch errors', () => {
    setCatalog({ isError: true, data: [makeEntry({ name: 'CachedSignal' })] });
    renderWidget(STANDARD);

    expect(screen.getByText('CachedSignal')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load signal catalog')).toBeNull();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
  });
});

// ── Compact layout ────────────────────────────────────────────────────────────

describe('SignalCatalogWidget — compact layout', () => {
  it('renders the signal count and caption without a search box or title heading', () => {
    setCatalog({ data: [makeEntry(), makeEntry({ name: 'VehicleSpeed' })] });
    renderWidget(COMPACT);

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('signals available')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('heading', { name: /Signal Catalog/i })).toBeNull();
  });

  it('prefers the empty state over a "0" figure when the catalog is empty', () => {
    setCatalog({ data: [] });
    renderWidget(COMPACT);

    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();
    expect(screen.queryByText('signals available')).toBeNull();
  });
});

// ── Standard layout — grouping, units, observation counts ─────────────────────

describe('SignalCatalogWidget — standard layout', () => {
  it('exposes the title heading and an accessible search field', () => {
    renderWidget(STANDARD);

    expect(screen.getByRole('heading', { name: /Signal Catalog/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search signals' })).toBeInTheDocument();
  });

  it('groups signals by source module and sorts the categories alphabetically', () => {
    // Supplied out of alpha order to prove the sort (zephyr before alpha).
    setCatalog({
      data: [
        makeEntry({ name: 'ZSignal', source_module: 'zephyr' }),
        makeEntry({ name: 'ASignal', source_module: 'alpha' }),
      ],
    });
    renderWidget(STANDARD);

    const headers = screen.getAllByRole('heading', { level: 4 });
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toMatch(/^alpha/);
    expect(headers[1].textContent).toMatch(/^zephyr/);
  });

  it('falls back to an "Uncategorized" group when a signal has no source module', () => {
    setCatalog({ data: [makeEntry({ name: 'Orphan', source_module: '' })] });
    renderWidget(STANDARD);

    expect(screen.getByRole('heading', { level: 4, name: /Uncategorized/ })).toBeInTheDocument();
    expect(screen.getByText('Orphan')).toBeInTheDocument();
  });

  it('renders a unit badge only for signals that carry a unit', () => {
    setCatalog({
      data: [
        makeEntry({ name: 'BatteryLevel', unit: '%', source_module: 'battery' }),
        makeEntry({ name: 'DoorState', unit: null, source_module: 'battery' }),
      ],
    });
    renderWidget(STANDARD);

    expect(screen.getByText('%')).toBeInTheDocument();
    // The unit-less signal still renders its row; its cell simply omits a badge.
    const doorRow = screen.getByText('DoorState').closest('div') as HTMLElement;
    expect(within(doorRow).queryByText('%')).toBeNull();
  });

  it('joins observation counts by signal name and shows 0 for signals with none', () => {
    setCatalog({
      data: [
        makeEntry({ name: 'BatteryLevel', source_module: 'battery' }),
        makeEntry({ name: 'VehicleSpeed', source_module: 'battery' }),
      ],
    });
    setObservations([
      makeObs({ signal_name: 'BatteryLevel' }),
      makeObs({ signal_name: 'BatteryLevel' }),
      makeObs({ signal_name: 'BatteryLevel' }),
    ]);
    renderWidget(STANDARD);

    const batteryRow = screen.getByText('BatteryLevel').closest('div') as HTMLElement;
    const speedRow = screen.getByText('VehicleSpeed').closest('div') as HTMLElement;
    expect(within(batteryRow).getByText('3')).toBeInTheDocument();
    expect(within(speedRow).getByText('0')).toBeInTheDocument();
  });
});

// ── Search filtering ──────────────────────────────────────────────────────────

describe('SignalCatalogWidget — search', () => {
  beforeEach(() => {
    setCatalog({
      data: [
        makeEntry({ name: 'BatteryLevel', source_module: 'battery', description: 'State of charge' }),
        makeEntry({ name: 'VehicleSpeed', source_module: 'drive', description: 'Ground speed' }),
      ],
    });
  });

  it('filters by signal name', () => {
    renderWidget(STANDARD);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), {
      target: { value: 'batter' },
    });

    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
    expect(screen.queryByText('VehicleSpeed')).toBeNull();
  });

  it('also matches the description and the source module', () => {
    renderWidget(STANDARD);
    const input = screen.getByRole('textbox', { name: 'Search signals' });

    // description match: "Ground speed" → VehicleSpeed
    fireEvent.change(input, { target: { value: 'ground' } });
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument();
    expect(screen.queryByText('BatteryLevel')).toBeNull();

    // source-module match: "drive" → VehicleSpeed
    fireEvent.change(input, { target: { value: 'drive' } });
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument();
    expect(screen.queryByText('BatteryLevel')).toBeNull();
  });

  it('shows the "no matching signals" empty state when nothing matches', () => {
    renderWidget(STANDARD);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), {
      target: { value: 'zzzzz' },
    });

    expect(screen.getByText('No matching signals')).toBeInTheDocument();
    expect(screen.queryByText('BatteryLevel')).toBeNull();
    expect(screen.queryByText('VehicleSpeed')).toBeNull();
  });
});

// ── Null safety ───────────────────────────────────────────────────────────────

describe('SignalCatalogWidget — null safety', () => {
  it('renders a "—" placeholder for a malformed entry with no name instead of a blank row', () => {
    const malformed = { ...makeEntry({ source_module: 'ghost', unit: null }), name: undefined as unknown as string };
    setCatalog({ data: [malformed, makeEntry({ name: 'BatteryLevel' })] });
    renderWidget(STANDARD);

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
  });

  it('does not throw in the search filter when an entry has an undefined name', () => {
    const malformed = {
      ...makeEntry({ source_module: null as unknown as string, description: null }),
      name: undefined as unknown as string,
    };
    setCatalog({ data: [malformed, makeEntry({ name: 'BatteryLevel', source_module: 'battery' })] });
    renderWidget(STANDARD);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), {
      target: { value: 'batter' },
    });

    // The valid entry still filters correctly; the malformed one is excluded
    // (an empty name matches nothing) without crashing the memoised filter.
    expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 })).toHaveLength(1);
  });
});

// ── Observations wiring & refresh control ─────────────────────────────────────

describe('SignalCatalogWidget — observations wiring & refresh', () => {
  it('passes the explicit vehicleId prop through to useSignalObservations', () => {
    renderWidget(STANDARD, 42);
    expect(observationsMock).toHaveBeenCalledWith(42);
  });

  it('falls back to the first vehicle id when no vehicleId prop is provided', () => {
    vehiclesMock.mockReturnValue({ data: [{ id: 9, display_name: 'Other' }] });
    renderWidget(STANDARD, undefined);
    expect(observationsMock).toHaveBeenCalledWith(9);
  });

  it('falls back to 0 when there are no vehicles at all', () => {
    vehiclesMock.mockReturnValue({ data: undefined });
    renderWidget(STANDARD, undefined);
    expect(observationsMock).toHaveBeenCalledWith(0);
  });

  it('invokes refetch when the accessible refresh control is activated', () => {
    const q = setCatalog({ data: [makeEntry()], isFetching: false });
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
});
