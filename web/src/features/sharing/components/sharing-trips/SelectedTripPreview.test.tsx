/**
 * SelectedTripPreview — behaviour, branch, hardening + a11y cover.
 *
 * <SelectedTripPreview trip formatDistance formatEnergy /> is the redacted
 * "share preview" panel that sits beside the recent-trips listbox on the
 * Sharing → Trips page. It is purely presentational — the parent owns the
 * selection state and injects the two SI-aware formatters from `useUnits()`.
 *
 * The component has exactly one meaningful branch (a trip is selected vs not)
 * plus several derived-row branches: the cost row only appears for a paid
 * trip, the name falls back to "Trip #<id>", and the date caption appends the
 * end date only when present. These tests exercise every one of those facets,
 * pin the null-safety hardening (undefined drive/charge counts → "0"), assert
 * the SI formatter contract (meters / watt-hours in), drive the duration
 * helper's aggregate-vs-timestamp fallback through the rendered value, and
 * verify the accessibility affordances (heading, status region, aria-hidden
 * decorative icons).
 *
 * Network is never touched. `react-i18next` is stubbed so the visible copy is
 * the English fallback; `@/lib/dateFormat` is stubbed to a deterministic
 * `DATE(iso)` marker so date assertions don't depend on the runner timezone;
 * and `@/hooks/useFormatting` (read by the nested <Currency>) is stubbed to a
 * fixed "$" symbol so the cost row renders deterministically.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { Trip } from '@/api/types';
import type { UnitFormatter } from '@/hooks/useUnits';

// i18n stub — resolve the `defaultValue`/fallback string and interpolate any
// `{{token}}` placeholders so assertions read against real user-visible copy.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, opts: Record<string, unknown>) =>
    tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => (k in opts ? String(opts[k]) : `{{${k}}}`));
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOpts?: unknown, maybeOpts?: unknown) => {
        let template = key;
        let opts: Record<string, unknown> | undefined;
        if (typeof fallbackOrOpts === 'string') {
          template = fallbackOrOpts;
          if (maybeOpts && typeof maybeOpts === 'object') opts = maybeOpts as Record<string, unknown>;
        } else if (fallbackOrOpts && typeof fallbackOrOpts === 'object') {
          opts = fallbackOrOpts as Record<string, unknown>;
          if (typeof opts.defaultValue === 'string') template = opts.defaultValue;
        }
        return opts ? interpolate(template, opts) : template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

// Deterministic date rendering — the component only reads `formatDate`, and
// pinning it to a stable marker removes timezone flakiness while still letting
// us assert the start/end wiring + the " – " range branch.
vi.mock('@/lib/dateFormat', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/dateFormat')>();
  return {
    ...actual,
    formatDate: (iso?: string | Date | null) => (iso ? `DATE(${String(iso)})` : '—'),
  };
});

// The nested <Currency> reads `currencySymbol` from useFormatting (which itself
// chains useSettings + useUnits). Stub it to a fixed "$" so the cost row is
// deterministic without pulling the whole settings stack into this unit test.
vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatEnergyCost: (kwh: number) => `$${kwh}`,
    formatCurrency: (amount: number) => `$${amount}`,
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
  }),
}));

import { SelectedTripPreview } from './SelectedTripPreview';

// ── Fixtures ─────────────────────────────────────────────────────────
function makeTrip(overrides: Partial<Trip> = {}): Trip {
  return {
    id: 42,
    vehicle_id: 7,
    name: 'Morning commute',
    start_date: '2024-03-01T08:00:00Z',
    end_date: '2024-03-01T09:00:00Z',
    started_at: '2024-03-01T08:00:00Z',
    ended_at: '2024-03-01T09:00:00Z',
    total_distance_m: 12000,
    total_energy_wh: 3000,
    total_duration_s: 3600,
    total_cost: 0,
    drive_count: 2,
    charge_count: 1,
    created_at: '2024-03-01T08:00:00Z',
    ...overrides,
  };
}

// Fresh spy formatters per render — echo the raw SI input with a unit suffix so
// (a) assertions read cleanly and (b) we can prove the SI contract via the mock
// call args. The narrower `(v) => string` signature is assignable to the wider
// `UnitFormatter` prop (options arg is optional), and keeping the Mock type lets
// us assert `toHaveBeenCalledWith`.
let formatDistance: ReturnType<typeof vi.fn>;
let formatEnergy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  formatDistance = vi.fn((v: number | null | undefined) => `${v ?? 0} m`);
  formatEnergy = vi.fn((v: number | null | undefined) => `${v ?? 0} Wh`);
});

function renderPreview(trip: Trip | null) {
  return render(
    <SelectedTripPreview
      trip={trip}
      formatDistance={formatDistance as unknown as UnitFormatter}
      formatEnergy={formatEnergy as unknown as UnitFormatter}
    />,
  );
}

/** Return the KVList row (dt+dd wrapper <div>) for a given label. */
function kvRow(label: string): HTMLElement {
  const dt = screen.getByText(label);
  const row = dt.closest('div');
  if (!row) throw new Error(`no KVList row for "${label}"`);
  return row;
}

afterEach(cleanup);

/* ── EMPTY (no trip selected) ──────────────────────────────────────── */

describe('SelectedTripPreview — empty', () => {
  it('keeps the panel + heading visible and shows the EmptyState instead of a blank', () => {
    renderPreview(null);

    // The heading is always visible — the panel is never blank.
    expect(screen.getByRole('heading', { name: 'Share preview' })).toBeInTheDocument();

    // EmptyState (role="status") with the guidance copy, not a KVList.
    const status = screen.getByRole('status');
    expect(status).toBeInTheDocument();
    expect(
      within(status).getByText(/Select a trip above to preview what you/i),
    ).toBeInTheDocument();

    // None of the summary rows / privacy note leak when nothing is selected.
    expect(screen.queryByText('Distance')).not.toBeInTheDocument();
    expect(screen.queryByText('Energy')).not.toBeInTheDocument();
    expect(screen.queryByText(/Only this redacted summary/i)).not.toBeInTheDocument();

    // With no trip the injected formatters must never be invoked.
    expect(formatDistance).not.toHaveBeenCalled();
    expect(formatEnergy).not.toHaveBeenCalled();
  });
});

/* ── READY (trip selected) ─────────────────────────────────────────── */

describe('SelectedTripPreview — populated', () => {
  it('renders the name, date range, every core row, and the privacy note', () => {
    renderPreview(makeTrip());

    // Trip name headline.
    expect(screen.getByText('Morning commute')).toBeInTheDocument();

    // Date caption: start present, end appended after the en-dash.
    expect(
      screen.getByText('DATE(2024-03-01T08:00:00Z) – DATE(2024-03-01T09:00:00Z)'),
    ).toBeInTheDocument();

    // Core KVList rows — labels + formatted values, scoped per-row so the bare
    // "2" / "1" figures are unambiguous.
    expect(within(kvRow('Distance')).getByText('12000 m')).toBeInTheDocument();
    expect(within(kvRow('Energy')).getByText('3000 Wh')).toBeInTheDocument();
    expect(within(kvRow('Duration')).getByText('1h')).toBeInTheDocument();
    expect(within(kvRow('Drives')).getByText('2')).toBeInTheDocument();
    expect(within(kvRow('Charges')).getByText('1')).toBeInTheDocument();

    // Privacy reassurance is shown, and no EmptyState in the ready branch.
    expect(screen.getByText(/Only this redacted summary is shared/i)).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('feeds the SI formatters the raw meters / watt-hours (never a pre-converted value)', () => {
    renderPreview(makeTrip({ total_distance_m: 87650, total_energy_wh: 14200 }));

    expect(formatDistance).toHaveBeenCalledWith(87650);
    expect(formatEnergy).toHaveBeenCalledWith(14200);
    // The formatted output surfaces verbatim in the rows.
    expect(within(kvRow('Distance')).getByText('87650 m')).toBeInTheDocument();
    expect(within(kvRow('Energy')).getByText('14200 Wh')).toBeInTheDocument();
  });
});

/* ── COST ROW (conditional) ────────────────────────────────────────── */

describe('SelectedTripPreview — cost row', () => {
  it('renders the Cost row with the currency symbol when the trip cost is positive', () => {
    renderPreview(makeTrip({ total_cost: 12.5 }));

    expect(screen.getByText('Cost')).toBeInTheDocument();
    expect(within(kvRow('Cost')).getByText('$12.50')).toBeInTheDocument();
  });

  it('hides the Cost row for a free trip (0) and for a nullish cost', () => {
    const { rerender } = renderPreview(makeTrip({ total_cost: 0 }));
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();

    rerender(
      <SelectedTripPreview
        trip={makeTrip({ total_cost: null as unknown as number })}
        formatDistance={formatDistance as unknown as UnitFormatter}
        formatEnergy={formatEnergy as unknown as UnitFormatter}
      />,
    );
    expect(screen.queryByText('Cost')).not.toBeInTheDocument();
    // The rest of the summary still renders — hiding cost never blanks the panel.
    expect(within(kvRow('Distance')).getByText('12000 m')).toBeInTheDocument();
  });
});

/* ── NAME + DATE BRANCHES ──────────────────────────────────────────── */

describe('SelectedTripPreview — name + date fallbacks', () => {
  it('falls back to "Trip #<id>" when the trip has no name', () => {
    renderPreview(makeTrip({ id: 103, name: null }));

    expect(screen.getByText('Trip #103')).toBeInTheDocument();
    expect(screen.queryByText('Morning commute')).not.toBeInTheDocument();
  });

  it('omits the en-dash range when the trip has no end date', () => {
    renderPreview(makeTrip({ end_date: null }));

    // Single date, no trailing " – <end>".
    expect(screen.getByText('DATE(2024-03-01T08:00:00Z)')).toBeInTheDocument();
    expect(
      screen.queryByText(/DATE\(2024-03-01T08:00:00Z\) – /),
    ).not.toBeInTheDocument();
  });
});

/* ── NULL SAFETY ───────────────────────────────────────────────────── */

describe('SelectedTripPreview — null safety', () => {
  it('degrades undefined drive / charge counts to "0" without leaking "undefined"', () => {
    const { container } = renderPreview(
      makeTrip({
        drive_count: undefined as unknown as number,
        charge_count: undefined as unknown as number,
      }),
    );

    expect(within(kvRow('Drives')).getByText('0')).toBeInTheDocument();
    expect(within(kvRow('Charges')).getByText('0')).toBeInTheDocument();
    expect(container.textContent).not.toContain('undefined');
  });
});

/* ── DURATION HELPER (aggregate vs timestamp fallback) ─────────────── */

describe('SelectedTripPreview — duration derivation', () => {
  it('prefers the SI aggregate, falls back to the timestamp delta, and shows "—" when unknown', () => {
    // 1) Canonical aggregate wins: 1800s → "30m".
    const { rerender } = renderPreview(makeTrip({ total_duration_s: 1800 }));
    expect(within(kvRow('Duration')).getByText('30m')).toBeInTheDocument();

    // 2) Missing aggregate (0) → derive from start/end delta: 90 min → "1h 30m".
    rerender(
      <SelectedTripPreview
        trip={makeTrip({
          total_duration_s: 0,
          start_date: '2024-03-01T08:00:00Z',
          end_date: '2024-03-01T09:30:00Z',
        })}
        formatDistance={formatDistance as unknown as UnitFormatter}
        formatEnergy={formatEnergy as unknown as UnitFormatter}
      />,
    );
    expect(within(kvRow('Duration')).getByText('1h 30m')).toBeInTheDocument();

    // 3) No aggregate AND no end date → unknown → em-dash placeholder.
    rerender(
      <SelectedTripPreview
        trip={makeTrip({ total_duration_s: 0, end_date: null })}
        formatDistance={formatDistance as unknown as UnitFormatter}
        formatEnergy={formatEnergy as unknown as UnitFormatter}
      />,
    );
    expect(within(kvRow('Duration')).getByText('—')).toBeInTheDocument();
  });
});

/* ── ACCESSIBILITY ─────────────────────────────────────────────────── */

describe('SelectedTripPreview — accessibility', () => {
  it('marks the decorative shield icons aria-hidden so they are not announced', () => {
    const { container } = renderPreview(makeTrip({ total_cost: 5 }));

    // The two ShieldCheck glyphs (heading + privacy note) are the only svgs the
    // component renders, and both are decorative — every one is aria-hidden.
    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs.length).toBe(2);
    for (const svg of svgs) {
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    }

    // The heading's accessible name excludes the hidden icon.
    expect(screen.getByRole('heading', { name: 'Share preview' })).toBeInTheDocument();
  });
});
