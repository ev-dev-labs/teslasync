/**
 * MaintenanceTrackerWidget — behaviour + hardening tests.
 *
 * MaintenanceTrackerWidget is a dashboard tile that reads the fleet maintenance
 * schedule (`useMaintenance`) and the service history (`useServiceRecords`) and
 * renders one of two layouts inside `WidgetShell`:
 *   - compact (cols ≤ 1)  → the soonest item's remaining interval (big number),
 *                           a "months" caption, and the item name.
 *   - standard (cols > 1) → a "Next Service" panel (name, urgency badge, interval
 *                           in months + user distance unit, optional cost) and a
 *                           `Timeline` of the three most-recent service records.
 * The shell owns the loading skeleton and the freshness / refresh affordance; the
 * body is never a blank panel — an explicit `EmptyState` stands in when there is
 * no maintenance data, and a "No service records yet" note stands in when there
 * are items but no history.
 *
 * The pure branch helpers (`getUrgency`, `urgencyBadgeVariant`, `urgencyLabel`)
 * are exported and unit-tested directly. The data hooks and `useUnits` are mocked
 * at their module boundaries so every orchestration branch is deterministic and
 * the network is never touched; the REAL SI converter (`convertDistanceFromSI`)
 * and the REAL `useFormatting` / `useDateFormat` still run (via the global
 * `useSettings` / `useTimezone` stubs in src/test-setup.ts), so the distance-unit
 * fix is proven end-to-end. `react-i18next` is echo-mocked (returns the English
 * fallback, interpolating `{{var}}`). `matchMedia` reports reduced-motion so the
 * freshness chip settles synchronously.
 *
 * Facets covered:
 *   - getUrgency / urgencyBadgeVariant / urgencyLabel: every branch + boundary.
 *   - compact: soonest-item selection, months caption, name; empty state; refresh.
 *   - standard: title, next-service panel, urgency badge, cost show/hide, timeline.
 *   - distance conversion (the fix / regression): km-scaled interval + odometer
 *     values are restated to SI metres before convertDistanceFromSI — 40,000 km
 *     must render at full magnitude ("40,000 km"), and 1,609.344 km must become
 *     "1,000 mi", not the 1000×-too-small legacy value.
 *   - shell states: loading skeleton (never a blank panel), and both empty paths
 *     (no data at all + items-without-records).
 *   - null-safety / hardening: null name → "—", null interval → 0, and null
 *     record fields render without a crash.
 *   - refresh wiring: the freshness control invokes the maintenance refetch.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';

// i18n echo mock: returns the fallback string (or key when none), interpolating
// {{var}} tokens from the options object so assertions target rendered English.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fb?: unknown, opts?: unknown) => {
      const options = (opts && typeof opts === 'object' ? opts : undefined) as
        | Record<string, unknown>
        | undefined;
      let base = typeof fb === 'string' ? fb : key;
      if (options) {
        base = base.replace(/{{\s*(\w+)\s*}}/g, (_m, n: string) =>
          n in options && options[n] != null ? String(options[n]) : `{{${n}}}`,
        );
      }
      return base;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  Trans: ({ children }: { children?: unknown }) => <>{children as never}</>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

// The two data hooks are mocked so the widget's inputs are deterministic.
vi.mock('@/api/hooks/useVehicleSystems', async (importActual) => {
  const actual =
    await importActual<typeof import('@/api/hooks/useVehicleSystems')>();
  return { ...actual, useMaintenance: vi.fn(), useServiceRecords: vi.fn() };
});

// useUnits stub — flip the display distance unit (km / mi) per test while the
// real SI converters in @/lib/unitConversion still execute.
vi.mock('@/hooks/useUnits', () => ({ useUnits: vi.fn() }));

// jsdom lacks matchMedia. Report reduced-motion so the freshness chip settles
// on its final visual synchronously.
window.matchMedia = ((query: string) => ({
  matches: /prefers-reduced-motion/.test(query),
  media: query,
  onchange: null,
  addEventListener: () => {},
  removeEventListener: () => {},
  addListener: () => {},
  removeListener: () => {},
  dispatchEvent: () => false,
})) as unknown as typeof window.matchMedia;

import MaintenanceTrackerWidget, {
  getUrgency,
  urgencyBadgeVariant,
  urgencyLabel,
} from './MaintenanceTrackerWidget';
import { useMaintenance, useServiceRecords } from '@/api/hooks/useVehicleSystems';
import { useUnits } from '@/hooks/useUnits';
import type { MaintenanceItem, ServiceRecord } from '@/types/vehicle-systems';
import type { WidgetProps, WidgetSize } from './types';

const mockMaintenance = vi.mocked(useMaintenance);
const mockRecords = vi.mocked(useServiceRecords);
const mockUnits = vi.mocked(useUnits);

/** Minimal `UseQueryResult`-shaped stub (incl. the DataFreshness fields). */
function qr(over: Record<string, unknown> = {}): never {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
    isFetching: false,
    isStale: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  } as never;
}

function makeItem(over: Partial<MaintenanceItem> = {}): MaintenanceItem {
  return {
    id: 'brakes',
    name: 'Brake Fluid',
    description: 'Flush and replace brake fluid',
    intervalKm: 40_000,
    intervalMonths: 24,
    category: 'fluids',
    estimatedCostUsd: 120,
    ...over,
  };
}

function makeRecord(over: Partial<ServiceRecord> = {}): ServiceRecord {
  return {
    itemId: 'tires',
    date: '2025-03-10',
    odometerKm: 15_000,
    notes: 'Rotated',
    ...over,
  };
}

const COMPACT: WidgetSize = { cols: 1, rows: 2 };
const STANDARD: WidgetSize = { cols: 2, rows: 4 };

function renderWidget(size: WidgetSize, props: Partial<WidgetProps> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <MaintenanceTrackerWidget size={size} {...props} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mockUnits.mockReturnValue({ unitPrefs: { distance: 'km' } } as never);
  mockMaintenance.mockReturnValue(qr({ data: [] }));
  mockRecords.mockReturnValue(qr({ data: [] }));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('getUrgency', () => {
  it('classifies a non-positive interval as overdue (boundary at 0)', () => {
    expect(getUrgency(0)).toBe('overdue');
    expect(getUrgency(-6)).toBe('overdue');
  });

  it('classifies 1–3 months out as soon and > 3 as good (boundary at 3)', () => {
    expect(getUrgency(1)).toBe('soon');
    expect(getUrgency(3)).toBe('soon');
    expect(getUrgency(4)).toBe('good');
    expect(getUrgency(24)).toBe('good');
  });
});

describe('urgencyBadgeVariant & urgencyLabel', () => {
  it('maps each urgency to its badge variant', () => {
    expect(urgencyBadgeVariant('overdue')).toBe('danger');
    expect(urgencyBadgeVariant('soon')).toBe('warning');
    expect(urgencyBadgeVariant('good')).toBe('success');
  });

  it('maps each urgency to its translated label', () => {
    const echo = (_k: string, f: string) => f;
    expect(urgencyLabel('overdue', echo)).toBe('Overdue');
    expect(urgencyLabel('soon', echo)).toBe('Soon');
    expect(urgencyLabel('good', echo)).toBe('Good');
  });

  it('resolves the label through the provided translator function', () => {
    const t = vi.fn((k: string) => `T:${k}`);
    expect(urgencyLabel('soon', t)).toBe('T:widget.maintenance.soon');
    expect(t).toHaveBeenCalledWith('widget.maintenance.soon', 'Soon');
  });
});

describe('MaintenanceTrackerWidget — compact layout', () => {
  it('shows the soonest item (by interval months), the caption, and its name', () => {
    mockMaintenance.mockReturnValue(
      qr({
        data: [
          makeItem({ id: 'tires', name: 'Tire Rotation', intervalMonths: 12 }),
          makeItem({ id: 'brakes', name: 'Brake Fluid', intervalMonths: 2 }),
        ],
      }),
    );
    renderWidget(COMPACT);

    // Soonest = the 2-month item; its name and the "months" caption render.
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('months')).toBeInTheDocument();
    expect(screen.getByText('Brake Fluid')).toBeInTheDocument();
    // No title in compact mode → no header label.
    expect(screen.queryByText('Maintenance')).toBeNull();
  });

  it('renders an explicit empty state (never a blank panel) when there is no data', () => {
    renderWidget(COMPACT);

    expect(screen.getByText('No maintenance data')).toBeInTheDocument();
    expect(screen.queryByText('months')).toBeNull();
  });

  it('invokes the maintenance refetch when the freshness control is activated', () => {
    const refetch = vi.fn();
    mockMaintenance.mockReturnValue(
      qr({ data: [makeItem({ intervalMonths: 2 })], refetch }),
    );
    renderWidget(COMPACT);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('MaintenanceTrackerWidget — standard layout', () => {
  it('renders the title, next-service panel, urgency badge, and cost', () => {
    mockMaintenance.mockReturnValue(
      qr({
        data: [
          makeItem({
            id: 'brakes',
            name: 'Brake Fluid',
            intervalMonths: 2,
            intervalKm: 40_000,
            estimatedCostUsd: 120,
          }),
        ],
      }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Maintenance')).toBeInTheDocument();
    expect(screen.getByText('Next Service')).toBeInTheDocument();
    expect(screen.getByText('Brake Fluid')).toBeInTheDocument();
    // intervalMonths 2 → 'soon' → 'Soon' badge.
    expect(screen.getByText('Soon')).toBeInTheDocument();
    // estimatedCostUsd 120 → currency (real useFormatting, '$' + 2 dp).
    expect(screen.getByText('$120.00')).toBeInTheDocument();
  });

  it('hides the cost row when the estimated cost is zero', () => {
    mockMaintenance.mockReturnValue(
      qr({ data: [makeItem({ estimatedCostUsd: 0, intervalMonths: 6 })] }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText('Brake Fluid')).toBeInTheDocument();
    expect(screen.queryByText(/^\$/)).toBeNull();
  });

  it('maps the three most-recent service records into the timeline (name via itemId)', () => {
    mockMaintenance.mockReturnValue(
      qr({
        data: [
          makeItem({ id: 'brakes', name: 'Brake Fluid', intervalMonths: 2 }),
          makeItem({ id: 'tires', name: 'Tire Rotation', intervalMonths: 12 }),
        ],
      }),
    );
    mockRecords.mockReturnValue(
      qr({
        data: [
          makeRecord({ itemId: 'tires', date: '2025-03-10', notes: 'Rotated' }),
        ],
      }),
    );
    const { container } = renderWidget(STANDARD);

    expect(screen.getByText('Recent Service')).toBeInTheDocument();
    // The record's itemId 'tires' resolves to the maintenance item name.
    expect(screen.getByText('Tire Rotation')).toBeInTheDocument();
    // Subtitle carries the (converted) odometer + notes.
    expect(container).toHaveTextContent('15,000 km · Rotated');
  });

  it('shows a "no records yet" note when there are items but no history', () => {
    mockMaintenance.mockReturnValue(
      qr({ data: [makeItem({ intervalMonths: 2 })] }),
    );
    mockRecords.mockReturnValue(qr({ data: [] }));
    renderWidget(STANDARD);

    expect(screen.getByText('No service records yet')).toBeInTheDocument();
  });

  it('renders records even when there is no upcoming item (records-only branch)', () => {
    mockMaintenance.mockReturnValue(qr({ data: [] }));
    mockRecords.mockReturnValue(
      qr({ data: [makeRecord({ itemId: 'wipers', notes: 'New blades' })] }),
    );
    const { container } = renderWidget(STANDARD);

    // No next-service panel (no items) but the history still renders.
    expect(screen.queryByText('Next Service')).toBeNull();
    expect(screen.getByText('Recent Service')).toBeInTheDocument();
    // itemId falls back to its own value when no matching item exists.
    expect(screen.getByText('wipers')).toBeInTheDocument();
    expect(container).toHaveTextContent('New blades');
  });
});

describe('MaintenanceTrackerWidget — distance conversion (regression)', () => {
  it('restates the km-scaled interval to SI metres so km renders at full magnitude', () => {
    // intervalKm 40,000. The bug (feeding km × 0.621371 to the metres
    // converter) rendered "25 km"; the fix restores "40,000 km".
    mockMaintenance.mockReturnValue(
      qr({ data: [makeItem({ intervalKm: 40_000, intervalMonths: 6 })] }),
    );
    const { container } = renderWidget(STANDARD);

    expect(container).toHaveTextContent('40,000 km');
    expect(container).not.toHaveTextContent('25 km');
  });

  it('converts the km-scaled interval + odometer to miles for imperial users', () => {
    mockUnits.mockReturnValue({ unitPrefs: { distance: 'mi' } } as never);
    // 1,609.344 km is exactly 1,000 mi.
    mockMaintenance.mockReturnValue(
      qr({
        data: [makeItem({ intervalKm: 1_609.344, intervalMonths: 6 })],
      }),
    );
    mockRecords.mockReturnValue(
      qr({ data: [makeRecord({ itemId: 'brakes', odometerKm: 1_609.344, notes: '' })] }),
    );
    const { container } = renderWidget(STANDARD);

    // Both the interval and the odometer restate to "1,000 mi", not "1 mi".
    expect(container).toHaveTextContent('1,000 mi');
    expect(container).not.toHaveTextContent('1 mi');
  });
});

describe('MaintenanceTrackerWidget — urgency badge variants', () => {
  it.each([
    [0, 'Overdue'],
    [3, 'Soon'],
    [12, 'Good'],
  ])('labels an interval of %i months as "%s"', (months, label) => {
    mockMaintenance.mockReturnValue(
      qr({ data: [makeItem({ intervalMonths: months })] }),
    );
    renderWidget(STANDARD);

    expect(screen.getByText(label)).toBeInTheDocument();
  });
});

describe('MaintenanceTrackerWidget — shell states', () => {
  it('shows a skeleton (never a blank panel) while either query is loading', () => {
    mockMaintenance.mockReturnValue(qr({ isLoading: true, data: undefined }));
    const { container } = renderWidget(STANDARD);

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Maintenance')).toBeNull();
    expect(screen.queryByText('No maintenance data')).toBeNull();
  });

  it('renders the empty state when both sources resolve to no data', () => {
    renderWidget(STANDARD);

    expect(screen.getByText('No maintenance data')).toBeInTheDocument();
    expect(screen.queryByText('Recent Service')).toBeNull();
  });

  it('invokes the maintenance refetch from the standard-layout freshness control', () => {
    const refetch = vi.fn();
    mockMaintenance.mockReturnValue(
      qr({ data: [makeItem({ intervalMonths: 2 })], refetch }),
    );
    renderWidget(STANDARD);

    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

describe('MaintenanceTrackerWidget — null-safety & hardening', () => {
  it('renders a null name as "—" and a null interval as 0 without crashing (compact)', () => {
    mockMaintenance.mockReturnValue(
      qr({
        data: [
          makeItem({
            name: null as unknown as string,
            intervalMonths: null as unknown as number,
          }),
        ],
      }),
    );
    renderWidget(COMPACT);

    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('months')).toBeInTheDocument();
  });

  it('renders records with null fields without crashing (standard timeline)', () => {
    mockMaintenance.mockReturnValue(qr({ data: [] }));
    mockRecords.mockReturnValue(
      qr({
        data: [
          {
            itemId: null as unknown as string,
            date: null as unknown as string,
            odometerKm: null as unknown as number,
            notes: null as unknown as string,
          },
        ],
      }),
    );
    const { container } = renderWidget(STANDARD);

    // The history section still renders; the null odometer degrades to "0 km".
    expect(screen.getByText('Recent Service')).toBeInTheDocument();
    expect(container).toHaveTextContent('0 km');
  });
});
