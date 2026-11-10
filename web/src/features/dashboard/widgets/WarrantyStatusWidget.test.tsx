/**
 * WarrantyStatusWidget — behaviour, branch, null-safety, a11y and unit-conversion
 * coverage for the dashboard's vehicle-warranty widget.
 *
 * What this file pins:
 *   - the exported pure helpers `asString` / `asNumber` / `daysUntil` /
 *     `statusVariant` / `statusLabel` — their exact null/empty/NaN guards and
 *     the status-tier boundaries (0 and <0 days → error/"Expired"; ≤90 →
 *     warning; >90 → success);
 *   - every render state fanned out by `WidgetShell` — the loading skeleton, the
 *     empty state when no warranty blob has landed, and the error affordance
 *     (red freshness dot + working Refresh control);
 *   - the populated standard (2×2) layout — expiry badge, coverage-type rows,
 *     the "Included" vs. dated-coverage branch, and the Active/Expired split;
 *   - the compact (1×N) layout — days-left hero + status badge, no panel title;
 *   - the REGRESSION FIX: warranty mileage arrives in MILES (`*_mi` fields) but
 *     `convertDistanceFromSI` expects SI meters. A 50,000 mi limit must render
 *     as "50,000 mi" (and "80,467 km"), never the ~31 mi the raw-value path
 *     produced. Both distance preferences are asserted so the conversion is
 *     proven unit-agnostic;
 *   - the freshness "Refresh" control wiring back to `refetch`.
 *
 * Strategy: the widget's data + preference hooks (`useWarrantyDetails`,
 * `useUnits`, `useDateFormat`) are mocked so no network is touched and every
 * query state / unit preference is controllable per-test, but the REAL
 * `convertDistanceFromSI` runs so the conversion assertions have teeth. i18n is a
 * passthrough honouring the English default so visible copy is asserted verbatim.
 * The widget is rendered inside a MemoryRouter because the shared feedback
 * components it composes may reach for router context.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import type { WidgetSize } from './types';
import { PackBoundary } from './designPacks/PackBoundary';
import { PACK_APPEARANCES, PACK_IDS, type PackId } from './designPacks/types';

// ── Mocks ────────────────────────────────────────────────────────────────────

// i18n passthrough: returns the English default so the widget's copy
// ("Warranty Status", "Active", "Expired", "Covered", …) is asserted verbatim.
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, defaultValue?: unknown, options?: Record<string, unknown>) => {
      const template = typeof defaultValue === 'string' ? defaultValue : key;
      const vars = typeof defaultValue === 'string' ? options : undefined;
      return vars
        ? template.replace(/\{\{(\w+)\}\}/g, (_m, name: string) => String(vars[name] ?? ''))
        : template;
    },
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
}));

const { warrantyMock, warrantyVehicleIdMock, unitsMock, dateFormatMock } = vi.hoisted(() => ({
  warrantyMock: vi.fn(),
  warrantyVehicleIdMock: vi.fn(),
  unitsMock: vi.fn(),
  dateFormatMock: vi.fn(),
}));

vi.mock('@/api/hooks/useVehicles', () => ({
  useWarrantyDetails: (vehicleId?: string) => {
    warrantyVehicleIdMock(vehicleId);
    return warrantyMock();
  },
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => unitsMock(),
}));

vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => dateFormatMock(),
}));

// The widget reads month labels from the route-side `useDateLabels` hook;
// mirror the date mock there so label copy stays deterministic.
vi.mock('@/hooks/useDateLabels', () => ({
  useDateLabels: () => dateFormatMock(),
}));

import WarrantyStatusWidget, {
  asString,
  asNumber,
  daysUntil,
  statusVariant,
  statusLabel,
} from './WarrantyStatusWidget';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const DAY = 86_400_000;
const future = (days: number) => new Date(Date.now() + days * DAY).toISOString();
const past = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** Wrap a warranty blob in the API's VehicleInfoEnvelope shape. */
function envelope(data: Record<string, unknown>) {
  return { data, fetched_at: null };
}

interface QueryResult {
  data: { data: Record<string, unknown>; fetched_at: string | null } | undefined;
  isLoading: boolean;
  isFetching: boolean;
  isStale: boolean;
  isError: boolean;
  dataUpdatedAt: number;
  refetch: () => void;
}

function makeResult(over: Partial<QueryResult> = {}): QueryResult {
  return {
    data: undefined,
    isLoading: false,
    isFetching: false,
    isStale: false,
    isError: false,
    dataUpdatedAt: Date.now(),
    refetch: vi.fn(),
    ...over,
  };
}

function renderWidget(packId: PackId, size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <PackBoundary requestedPackId={packId}>
        <WarrantyStatusWidget size={size} vehicleId={7} />
      </PackBoundary>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  warrantyMock.mockReset();
  warrantyVehicleIdMock.mockReset();
  unitsMock.mockReset();
  dateFormatMock.mockReset();
  warrantyMock.mockReturnValue(makeResult());
  unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
  dateFormatMock.mockReturnValue({
    // `formatDate` powers the widget's Expiry-Date row; the rest satisfy the
    // shared <FreshnessDot> chip in the WidgetShell header (it destructures
    // `formatTime`). Passthrough strings keep the visible copy deterministic.
    formatDate: (v: unknown) => (v ? 'formatted-date' : ''),
    formatDateTime: () => 'formatted-datetime',
    formatTime: () => '12:00',
    formatDateShort: () => 'formatted-short',
    formatDateWithDay: () => 'formatted-with-day',
    formatRelative: () => 'formatted-relative',
    formatRelativeTime: () => 'formatted-rel-time',
    formatRelativeDays: () => 'formatted-rel-days',
    formatMonthYear: (v: unknown) => (v ? 'formatted-month-year' : ''),
    opts: { locale: 'en-US', tz: 'UTC' },
    tz: 'UTC',
    locale: 'en-US',
  });
});

// ── Pure helper: asString ────────────────────────────────────────────────────

describe('asString', () => {
  it('returns null for nullish, empty-string and non-string/number inputs', () => {
    expect(asString(null)).toBeNull();
    expect(asString(undefined)).toBeNull();
    expect(asString('')).toBeNull();
    expect(asString(true)).toBeNull();
    expect(asString({})).toBeNull();
  });

  it('passes through non-empty strings and stringifies numbers (including 0)', () => {
    expect(asString('hello')).toBe('hello');
    expect(asString(42)).toBe('42');
    expect(asString(0)).toBe('0');
  });
});

// ── Pure helper: asNumber ────────────────────────────────────────────────────

describe('asNumber', () => {
  it('returns finite numbers and parses numeric strings', () => {
    expect(asNumber(42)).toBe(42);
    expect(asNumber('42')).toBe(42);
    expect(asNumber('3.14')).toBe(3.14);
  });

  it('returns null for nullish, non-finite and non-numeric inputs', () => {
    expect(asNumber(null)).toBeNull();
    expect(asNumber(undefined)).toBeNull();
    expect(asNumber('abc')).toBeNull();
    expect(asNumber(NaN)).toBeNull();
    expect(asNumber(Infinity)).toBeNull();
    expect(asNumber({})).toBeNull();
  });
});

// ── Pure helper: daysUntil ───────────────────────────────────────────────────

describe('daysUntil', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null for missing or unparseable dates', () => {
    expect(daysUntil(null)).toBeNull();
    expect(daysUntil('not-a-date')).toBeNull();
  });

  it('computes signed whole-day deltas around now', () => {
    expect(daysUntil('2026-06-20T12:00:00Z')).toBe(5);
    expect(daysUntil('2026-06-10T12:00:00Z')).toBe(-5);
    expect(daysUntil('2026-06-15T12:00:00Z')).toBe(0);
  });
});

// ── Pure helper: statusVariant ───────────────────────────────────────────────

describe('statusVariant', () => {
  it('keeps unknown neutral and expired (≤0 days) in the error tier', () => {
    expect(statusVariant(null)).toBe('neutral');
    expect(statusVariant(0)).toBe('error');
    expect(statusVariant(-5)).toBe('error');
  });

  it('maps the ≤90-day warning tier and the >90-day success tier', () => {
    expect(statusVariant(1)).toBe('warning');
    expect(statusVariant(90)).toBe('warning');
    expect(statusVariant(91)).toBe('success');
    expect(statusVariant(365)).toBe('success');
  });
});

// ── Pure helper: statusLabel ─────────────────────────────────────────────────

describe('statusLabel', () => {
  const t = (_k: string, f: string) => f;

  it('distinguishes unknown from expired warranties', () => {
    expect(statusLabel(null, t)).toBe('Unknown');
    expect(statusLabel(0, t)).toBe('Expired');
    expect(statusLabel(-1, t)).toBe('Expired');
  });

  it('labels a warranty with days remaining "Active"', () => {
    expect(statusLabel(30, t)).toBe('Active');
    expect(statusLabel(400, t)).toBe('Active');
  });
});

// ── Widget render states ─────────────────────────────────────────────────────

describe.each(PACK_IDS)('WarrantyStatusWidget — states (%s)', (packId) => {
  it('renders a loading skeleton while the query is pending', () => {
    warrantyMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget(packId);
    expect(warrantyVehicleIdMock).toHaveBeenCalledWith('7');
    expect(container.querySelector('[class*="--skeleton-bg"]')).not.toBeNull();
    expect(screen.queryByText('Warranty status')).toBeInTheDocument();
    expect(screen.queryByText('No warranty data')).toBeNull();
  });

  it('shows the empty state when no warranty blob has landed', () => {
    warrantyMock.mockReturnValue(makeResult({ data: undefined }));
    renderWidget(packId);
    expect(screen.getByText('No warranty data')).toBeInTheDocument();
    expect(screen.getByText('Mileage limit')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it('surfaces an error affordance (red freshness dot + Refresh) on failure', () => {
    warrantyMock.mockReturnValue(
      makeResult({ isError: true, dataUpdatedAt: 0, data: undefined }),
    );
    const { container } = renderWidget(packId);
    expect(container.querySelector('[class*="bg-[var(--semantic-danger)]"]')).not.toBeNull();
    expect(screen.getAllByRole('button', { name: /refresh/i }).length).toBeGreaterThan(0);
    expect(screen.getByText("Can't reach server")).toBeInTheDocument();
  });
});

// ── Standard layout + the miles→meters conversion fix ────────────────────────

describe.each(PACK_IDS)('WarrantyStatusWidget — standard layout (%s)', (packId) => {
  it('rejects invalid dates and unknown coverage without an active claim', () => {
    warrantyMock.mockReturnValue(makeResult({
      data: envelope({ warranty_expiry_date: 'invalid', corrosion: true, corrosion_expiry_date: 'also-invalid' }),
    }));
    expect(() => renderWidget(packId)).not.toThrow();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(screen.queryByText('Covered')).not.toBeInTheDocument();
    expect(screen.getAllByText('Unknown')).toHaveLength(2);
  });

  it('ends protection at the mileage limit even when the expiry date is future', () => {
    warrantyMock.mockReturnValue(makeResult({
      data: envelope({ warranty_expiry_date: future(100), mileage_limit_mi: 50_000, current_mileage_mi: 50_000 }),
    }));
    renderWidget(packId);
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
  });

  it('keeps cached warranty details on a transient refresh failure', () => {
    warrantyMock.mockReturnValue(makeResult({ data: envelope({ warranty_expiry_date: future(100) }), isError: true }));
    const { container } = renderWidget(packId);
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(container.querySelector('[data-data-state="stale"]')).toBeInTheDocument();
  });

  const populated = () =>
    envelope({
      warranty_expiry_date: future(100),
      warranty_start_date: past(200),
      mileage_limit_mi: 50000,
      current_mileage_mi: 20000,
    });

  it('renders the title, an Active badge, days remaining and the expiry date', () => {
    warrantyMock.mockReturnValue(makeResult({ data: populated() }));
    const { container } = renderWidget(packId);
    expect(screen.getByText('Warranty status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getAllByText('100')).toHaveLength(2);
    expect(screen.getByText('formatted-date')).toBeInTheDocument();
    expect(container.querySelector('[data-widget-pack]')).toHaveAttribute('data-widget-pack', packId);
    const timeline = container.querySelector('[data-timeline-appearance]');
    if (packId === 'classic') {
      expect(timeline).toBeNull();
    } else {
      expect(timeline).toHaveAttribute('data-timeline-appearance', PACK_APPEARANCES[packId]);
    }
  });

  const mileageSources = [
    { source: 'miles', mileage: { mileage_limit_mi: 50_000, current_mileage_mi: 20_000 } },
    { source: 'SI meters', mileage: { mileage_limit_m: 80_467_200, current_mileage_m: 32_186_880 } },
  ];

  it.each(mileageSources)('converts $source warranty mileage to the mi display unit (regression: not ~31 mi)', ({ mileage }) => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    warrantyMock.mockReturnValue(makeResult({ data: envelope({
      warranty_expiry_date: future(100),
      warranty_start_date: past(200),
      ...mileage,
    }) }));
    renderWidget(packId);
    // 50,000 mi limit, 20,000 mi current, 30,000 mi remaining.
    expect(screen.getByText('50,000.00 mi')).toBeInTheDocument();
    expect(screen.getByText('20,000.00 mi')).toBeInTheDocument();
    expect(screen.getByText('30,000.00 mi')).toBeInTheDocument();
    // The old bug fed raw miles into an SI-meters converter → ~31 mi.
    expect(screen.queryByText('31 mi')).toBeNull();
  });

  it.each(mileageSources)('converts $source warranty mileage into km when that is the display unit', ({ mileage }) => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
    warrantyMock.mockReturnValue(makeResult({ data: envelope({
      warranty_expiry_date: future(100),
      warranty_start_date: past(200),
      ...mileage,
    }) }));
    renderWidget(packId);
    // One mile is exactly 1.609344 kilometres.
    expect(screen.getByText('80,467.20 km')).toBeInTheDocument();
    expect(screen.getByText('32,186.88 km')).toBeInTheDocument();
  });

  it('renders dated coverage rows and the "Included" branch with correct badges', () => {
    warrantyMock.mockReturnValue(
      makeResult({
        data: envelope({
          warranty_expiry_date: '2040-01-01',
          basic: true,
          basic_expiry_date: '2040-06-15',
          battery_drive_unit: true,
          battery_drive_unit_expiry_date: '2010-01-10',
          corrosion: true, // no expiry date → "Included"
        }),
      }),
    );
    renderWidget(packId);
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('Battery/drive unit')).toBeInTheDocument();
    expect(screen.getByText('Corrosion')).toBeInTheDocument();
    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.getAllByText('formatted-month-year')).toHaveLength(2);
    // basic + corrosion are covered; the past-dated battery coverage is expired.
    expect(screen.getAllByText('Covered')).toHaveLength(1);
    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('refetches when the freshness control is activated', () => {
    const refetch = vi.fn();
    warrantyMock.mockReturnValue(makeResult({ data: populated(), refetch }));
    renderWidget(packId);
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Compact layout ───────────────────────────────────────────────────────────

describe.each(PACK_IDS)('WarrantyStatusWidget — compact layout (%s)', (packId) => {
  it('renders the days-left hero, Active badge and panel title', () => {
    warrantyMock.mockReturnValue(
      makeResult({ data: envelope({ warranty_expiry_date: future(100) }) }),
    );
    const { container } = renderWidget(packId, { cols: 1, rows: 2 });
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('days left')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Warranty status', level: 3 })).toBeInTheDocument();
    if (packId !== 'classic') {
      expect(container.querySelector('[data-timeline-appearance]')).toHaveAttribute(
        'data-timeline-appearance', PACK_APPEARANCES[packId],
      );
    }
  });

  it('shows the empty state in the compact variant when no data has landed', () => {
    warrantyMock.mockReturnValue(makeResult({ data: undefined }));
    renderWidget(packId, { cols: 1, rows: 2 });
    expect(screen.getByText('No warranty data')).toBeInTheDocument();
    expect(screen.getByText('days left')).toBeInTheDocument();
    expect(screen.getByText('Unknown')).toBeInTheDocument();
  });

  it.each([0, 10])('flags a warranty expired %i days ago as Expired', (daysAgo) => {
    warrantyMock.mockReturnValue(
      makeResult({ data: envelope({ warranty_expiry_date: past(daysAgo) }) }),
    );
    renderWidget(packId, { cols: 1, rows: 2 });
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument(); // days floored at 0
  });

  it.each([
    { name: 'known zero mileage', mileage: 0, limit: 80_000, status: 'Active', days: '100' },
    { name: 'zero mileage limit', mileage: 0, limit: 0, status: 'Expired', days: '0' },
    { name: 'unknown mileage', mileage: null, limit: 80_000, status: 'Unknown', days: null },
    { name: 'invalid mileage', mileage: NaN, limit: 80_000, status: 'Unknown', days: null },
  ])('preserves $name without fabricating coverage', ({ mileage, limit, status, days }) => {
    warrantyMock.mockReturnValue(makeResult({ data: envelope({
      warranty_expiry_date: future(100),
      mileage_limit_m: limit,
      current_mileage_m: mileage,
    }) }));
    renderWidget(packId, { cols: 1, rows: 2 });
    expect(screen.getByText(status)).toBeInTheDocument();
    if (days == null) {
      expect(screen.queryByText('100')).not.toBeInTheDocument();
      expect(screen.queryByText('0')).not.toBeInTheDocument();
      expect(screen.queryByText('Active')).not.toBeInTheDocument();
    } else {
      expect(screen.getByText(days)).toBeInTheDocument();
    }
  });
});
