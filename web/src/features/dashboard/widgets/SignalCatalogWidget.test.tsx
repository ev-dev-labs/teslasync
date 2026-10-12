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
 *   • standard (cols ≥ 2) → a search box + a destination-grouped, alpha-sorted
 *                list of signals with value-kind badges and per-signal observation
 *                counts.
 *
 * What this file pins:
 *   - the LAYOUT SWITCH (loading / empty / error / compact / standard) and each
 *     branch's distinguishing output;
 *   - the ERROR fix — an errored initial load (no data) shows a "failed to load"
 *     message, NOT the misleading "no signals" empty state, while a
 *     background-refetch error over cached data keeps the list on screen;
 *   - the SEARCH filter across field / destination / value_kind, and its
 *     "no matching signals" empty state;
 *   - the GROUPING + alpha SORT of categories and the observation-count join
 *     (matched by signal name, null-safe "0" for unmatched signals);
 *   - the NULL-SAFETY boundary — missing required identities are source errors;
 *     nullable aggregate metadata stays unknown without fabricating units;
 *   - the observations WIRING — the resolved vehicle id (`vehicleId` prop →
 *     first vehicle → 0) is what reaches `useSignalObservations`;
 *   - the a11y search label and the REFRESH control (freshness chip → refetch).
 *
 * Strategy: both data hooks are the network boundary and are fully controllable
 * via hoisted mocks. `react-i18next` echoes each `t(key, fallback)` fallback so
 * assertions read against English copy. The freshness chip's display hooks
 * (`useDateFormat` / `useMotionPreference`) are stubbed so WidgetShell renders
 * synchronously without a Settings/QueryClient provider. The continuation file
 * also mounts the actual query functions against a QueryClient/request boundary.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { SignalCatalogRow, SignalsCatalogResponse, SignalObservation } from '@/types/signals';
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

function makeEntry(over: Partial<SignalCatalogRow> = {}): SignalCatalogRow {
  return {
    field: 'BatteryLevel',
    value_kind: 'ValueKindFloat',
    destination: 'battery',
    last_seen_at: null,
    sample_count_total: null,
    vehicle_count: null,
    ...over,
  };
}

function envelope(signals: SignalCatalogRow[]): SignalsCatalogResponse {
  return { signals, generated_at: NOW };
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
  data?: SignalsCatalogResponse;
  isLoading?: boolean;
  isFetching?: boolean;
  isStale?: boolean;
  isError?: boolean;
  dataUpdatedAt?: number;
  refetch?: () => void;
}

function setCatalog(over: CatalogOverrides = {}) {
  const q = {
    data: undefined as SignalsCatalogResponse | undefined,
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
  return render(<MemoryRouter><SignalCatalogWidget size={size} vehicleId={vehicleId} /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  vehiclesMock.mockReturnValue({ data: [{ id: 7, display_name: 'Car' }] });
  setObservations([]);
  setCatalog({ data: envelope([makeEntry()]) });
});

// ── Loading / empty / error states ────────────────────────────────────────────

describe('SignalCatalogWidget — loading / empty / error states', () => {
  it('renders only a skeleton (no header, search or empty copy) while loading', () => {
    setCatalog({ isLoading: true, data: undefined });
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Refresh/i })).toBeInTheDocument();
  });

  it('shows the empty state when the catalog loaded with zero entries and no error', () => {
    setCatalog({ data: envelope([]) });
    renderWidget(STANDARD);

    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load signal catalog')).toBeNull();
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('shows a distinct "failed to load" message (not "no signals") on an errored initial load', () => {
    setCatalog({ isError: true, data: undefined });
    renderWidget(STANDARD);

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
  });

  it('keeps the cached list visible (no error copy) when a background refetch errors', () => {
    setCatalog({ isError: true, data: envelope([makeEntry({ field: 'CachedSignal' })]) });
    renderWidget(STANDARD);

    expect(screen.getByText('CachedSignal')).toBeInTheDocument();
    expect(screen.queryByText('Failed to load signal catalog')).toBeNull();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
  });
});

// ── Compact layout ────────────────────────────────────────────────────────────

describe('SignalCatalogWidget — compact layout', () => {
  it('retains its title beside the signal count and caption without a search box', () => {
    setCatalog({ data: envelope([makeEntry(), makeEntry({ field: 'VehicleSpeed' })]) });
    renderWidget(COMPACT);

    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('Signals available')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByRole('heading', { name: /Signal catalog/i })).toBeInTheDocument();
  });

  it('prefers the empty state over a "0" figure when the catalog is empty', () => {
    setCatalog({ data: envelope([]) });
    renderWidget(COMPACT);

    expect(screen.getByText('No signals in catalog')).toBeInTheDocument();
    expect(screen.getByText('Signals available')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument();
  });
});

// ── Standard layout — grouping, served metadata, observation counts ──────────

describe('SignalCatalogWidget — standard layout', () => {
  it('exposes the title heading and an accessible search field', () => {
    renderWidget(STANDARD);

    expect(screen.getByRole('heading', { name: /Signal catalog/i })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Search signals' })).toBeInTheDocument();
  });

  it('groups signals by destination and sorts the categories alphabetically', () => {
    // Supplied out of alpha order to prove the sort (zephyr before alpha).
    setCatalog({
      data: envelope([
        makeEntry({ field: 'ZSignal', destination: 'zephyr' }),
        makeEntry({ field: 'ASignal', destination: 'alpha' }),
      ]),
    });
    renderWidget(STANDARD);

    const headers = screen.getAllByRole('heading', { level: 4 });
    expect(headers).toHaveLength(2);
    expect(headers[0].textContent).toMatch(/^Destination: alpha/);
    expect(headers[1].textContent).toMatch(/^Destination: zephyr/);
  });

  it('uses the served destination without inventing an unsupported source module', () => {
    setCatalog({ data: envelope([makeEntry({ field: 'Orphan', destination: 'signal_log' })]) });
    renderWidget(STANDARD);

    expect(screen.getByRole('heading', { level: 4, name: /Destination: signal_log/ })).toBeInTheDocument();
    expect(screen.queryByText('Uncategorized')).toBeNull();
    expect(screen.getByText('Orphan')).toBeInTheDocument();
  });

  it('renders served value kinds without fabricating a unit or description', () => {
    setCatalog({
      data: envelope([
        makeEntry({ field: 'BatteryLevel', value_kind: 'ValueKindFloat' }),
        makeEntry({ field: 'DoorState', value_kind: 'ValueKindBool' }),
      ]),
    });
    renderWidget(STANDARD);

    expect(screen.getByText('Unit and description are not provided by this catalog.')).toBeInTheDocument();
    expect(screen.getByText('ValueKindFloat')).toBeInTheDocument();
    const doorRow = screen.getByText('DoorState').closest('div')?.parentElement as HTMLElement;
    expect(within(doorRow).getByTitle('Value kind')).toHaveTextContent('ValueKindBool');
    expect(within(doorRow).queryByText('%')).toBeNull();
    expect(screen.queryByText('State of charge')).toBeNull();
  });

  it('joins observation counts by signal name and shows 0 for signals with none', () => {
    setCatalog({
      data: envelope([
        makeEntry({ field: 'BatteryLevel' }),
        makeEntry({ field: 'VehicleSpeed' }),
      ]),
    });
    setObservations([
      makeObs({ signal_name: 'BatteryLevel' }),
      makeObs({ signal_name: 'BatteryLevel' }),
      makeObs({ signal_name: 'BatteryLevel' }),
    ]);
    renderWidget(STANDARD);

    const batteryRow = screen.getByText('BatteryLevel').closest('div')?.parentElement as HTMLElement;
    const speedRow = screen.getByText('VehicleSpeed').closest('div')?.parentElement as HTMLElement;
    expect(within(batteryRow).getByText('3')).toBeInTheDocument();
    expect(within(speedRow).getByText('0')).toBeInTheDocument();
  });
});

// ── Search filtering ──────────────────────────────────────────────────────────

describe('SignalCatalogWidget — search', () => {
  beforeEach(() => {
    setCatalog({
      data: envelope([
        makeEntry({ field: 'BatteryLevel', destination: 'battery', value_kind: 'ValueKindFloat' }),
        makeEntry({ field: 'VehicleSpeed', destination: 'drive', value_kind: 'ValueKindDouble' }),
      ]),
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

  it('also matches the value kind and the destination', () => {
    renderWidget(STANDARD);
    const input = screen.getByRole('textbox', { name: 'Search signals' });

    fireEvent.change(input, { target: { value: 'valuekinddouble' } });
    expect(screen.getByText('VehicleSpeed')).toBeInTheDocument();
    expect(screen.queryByText('BatteryLevel')).toBeNull();

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
  it('shows a source failure rather than a silent blank row when required field validation fails', () => {
    setCatalog({ data: undefined, isError: true });
    renderWidget(STANDARD);

    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
    expect(screen.queryByText('BatteryLevel')).toBeNull();
    expect(screen.queryByText('No signals in catalog')).toBeNull();
  });

  it('searches valid retained identities after a malformed refresh without dropping rows', () => {
    setCatalog({ data: envelope([makeEntry()]), isError: true });
    renderWidget(STANDARD);

    fireEvent.change(screen.getByRole('textbox', { name: 'Search signals' }), {
      target: { value: 'batter' },
    });

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

  describe('SignalCatalogWidget — observation sample trust', () => {
    it('shows unknown counts while observations are unavailable', () => {
      setObservations(undefined);
      renderWidget({ cols: 3, rows: 3 });
      expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
      expect(screen.getByText('—')).toBeInTheDocument();
      expect(screen.queryByText('0')).toBeNull();
    });

    it('keeps a cached observation sample while reporting its failed refresh', () => {
      observationsMock.mockReturnValue({ data: [makeObs()], isError: true, error: new Error('refresh') });
      const { container } = renderWidget(STANDARD);
      expect(screen.getByText('BatteryLevel')).toBeInTheDocument();
      expect(screen.getByTitle('Observations in fetched sample')).toHaveTextContent('1');
      expect(container.querySelector('[data-data-state="stale"]')).toBeTruthy();
    });
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
    const q = setCatalog({ data: envelope([makeEntry()]), isFetching: false });
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: /^Refresh/i }));

    expect(q.refetch).toHaveBeenCalledTimes(1);
  });
});
