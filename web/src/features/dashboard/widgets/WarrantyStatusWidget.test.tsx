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

function renderWidget(size: WidgetSize = { cols: 2, rows: 2 }) {
  return render(
    <MemoryRouter>
      <WarrantyStatusWidget size={size} vehicleId={7} />
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
    // shared <DataFreshness> chip in the WidgetShell header (it destructures
    // `formatTime`). Passthrough strings keep the visible copy deterministic.
    formatDate: (v: unknown) => (v ? 'formatted-date' : ''),
    formatDateTime: () => 'formatted-datetime',
    formatTime: () => '12:00',
    formatDateShort: () => 'formatted-short',
    formatDateWithDay: () => 'formatted-with-day',
    formatRelative: () => 'formatted-relative',
    formatRelativeTime: () => 'formatted-rel-time',
    formatRelativeDays: () => 'formatted-rel-days',
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
  it('maps unknown / expired (≤0 days) to error at the exact boundary', () => {
    expect(statusVariant(null)).toBe('error');
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

  it('labels unknown / expired warranties "Expired"', () => {
    expect(statusLabel(null, t)).toBe('Expired');
    expect(statusLabel(0, t)).toBe('Expired');
    expect(statusLabel(-1, t)).toBe('Expired');
  });

  it('labels a warranty with days remaining "Active"', () => {
    expect(statusLabel(30, t)).toBe('Active');
    expect(statusLabel(400, t)).toBe('Active');
  });
});

// ── Widget render states ─────────────────────────────────────────────────────

describe('WarrantyStatusWidget — states', () => {
  it('renders a loading skeleton while the query is pending', () => {
    warrantyMock.mockReturnValue(makeResult({ isLoading: true, data: undefined }));
    const { container } = renderWidget();
    expect(warrantyVehicleIdMock).toHaveBeenCalledWith('7');
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByText('Warranty Status')).toBeNull();
    expect(screen.queryByText('No warranty data')).toBeNull();
  });

  it('shows the empty state when no warranty blob has landed', () => {
    warrantyMock.mockReturnValue(makeResult({ data: undefined }));
    renderWidget();
    expect(screen.getByText('No warranty data')).toBeInTheDocument();
    expect(screen.queryByText('Mileage Limit')).toBeNull();
  });

  it('surfaces an error affordance (red freshness dot + Refresh) on failure', () => {
    warrantyMock.mockReturnValue(
      makeResult({ isError: true, dataUpdatedAt: 0, data: undefined }),
    );
    const { container } = renderWidget();
    expect(container.querySelector('.bg-red-400')).not.toBeNull();
    expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    // No data yet → an empty panel, never a blank one.
    expect(screen.getByText('No warranty data')).toBeInTheDocument();
  });
});

// ── Standard layout + the miles→meters conversion fix ────────────────────────

describe('WarrantyStatusWidget — standard layout', () => {
  const populated = () =>
    envelope({
      warranty_expiry_date: future(100),
      warranty_start_date: past(200),
      mileage_limit_mi: 50000,
      current_mileage_mi: 20000,
    });

  it('renders the title, an Active badge, days remaining and the expiry date', () => {
    warrantyMock.mockReturnValue(makeResult({ data: populated() }));
    renderWidget();
    expect(screen.getByText('Warranty Status')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('formatted-date')).toBeInTheDocument();
  });

  it('converts MILES warranty mileage to the mi display unit (regression: not ~31 mi)', () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'mi' } });
    warrantyMock.mockReturnValue(makeResult({ data: populated() }));
    renderWidget();
    // 50,000 mi limit, 20,000 mi current, 30,000 mi remaining.
    expect(screen.getByText('50,000 mi')).toBeInTheDocument();
    expect(screen.getByText('20,000 mi')).toBeInTheDocument();
    expect(screen.getByText('30,000 mi')).toBeInTheDocument();
    // The old bug fed raw miles into an SI-meters converter → ~31 mi.
    expect(screen.queryByText('31 mi')).toBeNull();
  });

  it('converts the same MILES mileage into km when that is the display unit', () => {
    unitsMock.mockReturnValue({ unitPrefs: { distance: 'km' } });
    warrantyMock.mockReturnValue(makeResult({ data: populated() }));
    renderWidget();
    // 50,000 mi → 80,467 km; 20,000 mi → 32,187 km.
    expect(screen.getByText('80,467 km')).toBeInTheDocument();
    expect(screen.getByText('32,187 km')).toBeInTheDocument();
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
    renderWidget();
    expect(screen.getByText('Basic')).toBeInTheDocument();
    expect(screen.getByText('Battery/Drive Unit')).toBeInTheDocument();
    expect(screen.getByText('Corrosion')).toBeInTheDocument();
    expect(screen.getByText('Included')).toBeInTheDocument();
    expect(screen.getByText('Jun 2040')).toBeInTheDocument();
    expect(screen.getByText('Jan 2010')).toBeInTheDocument();
    // basic + corrosion are covered; the past-dated battery coverage is expired.
    expect(screen.getAllByText('Covered').length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('refetches when the freshness control is activated', () => {
    const refetch = vi.fn();
    warrantyMock.mockReturnValue(makeResult({ data: populated(), refetch }));
    renderWidget();
    fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });
});

// ── Compact layout ───────────────────────────────────────────────────────────

describe('WarrantyStatusWidget — compact layout', () => {
  it('renders the days-left hero + Active badge and no panel title', () => {
    warrantyMock.mockReturnValue(
      makeResult({ data: envelope({ warranty_expiry_date: future(100) }) }),
    );
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByText('100')).toBeInTheDocument();
    expect(screen.getByText('days left')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    // The compact variant is title-less.
    expect(screen.queryByText('Warranty Status')).toBeNull();
  });

  it('shows the empty state in the compact variant when no data has landed', () => {
    warrantyMock.mockReturnValue(makeResult({ data: undefined }));
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByText('No warranty data')).toBeInTheDocument();
    expect(screen.queryByText('days left')).toBeNull();
  });

  it('flags an expired warranty (past expiry date) as Expired', () => {
    warrantyMock.mockReturnValue(
      makeResult({ data: envelope({ warranty_expiry_date: past(10) }) }),
    );
    renderWidget({ cols: 1, rows: 2 });
    expect(screen.getByText('Expired')).toBeInTheDocument();
    expect(screen.getByText('0')).toBeInTheDocument(); // days floored at 0
  });
});
