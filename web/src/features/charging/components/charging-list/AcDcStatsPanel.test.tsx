/**
 * AcDcStatsPanel — behaviour, regression + hardening cover.
 *
 * The panel splits a fleet's charging into AC vs DC: an energy-split bar, a
 * per-type <DataTable> (sessions / energy / cost / $-per-kWh / averages / free),
 * and a free-charging footer. Its two exports are pinned here:
 *
 *   • `formatEnergyDisplay` — the pure kWh→(kWh|MWh) scaler shared by the footer
 *     and the table's Energy column. Tested directly for its branch (≥1000 kWh
 *     switches to MWh), its boundary, and its nullish/NaN null-safety.
 *   • `AcDcStatsPanel` — rendered end-to-end with the REAL GlassPanel / DataTable
 *     / Currency (Currency's settings come from the global useSettings mock in
 *     test-setup, so the '$' symbol is deterministic). Only react-i18next is
 *     mocked to the English fallback + {{var}} interpolation (repo convention).
 *
 * Headline regression: a zero `total.energy` used to divide to `NaN` and emit an
 * invalid `NaN% NaN%` CSS grid-template, collapsing the split bar. The panel now
 * guards the geometry and shows an empty note instead — pinned in
 * "guards a zero total energy". The undefined-breakdown case pins the `?? 0` /
 * `EMPTY_BUCKET` null-safety that stops `.energy` reads from throwing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import { AcDcStatsPanel, formatEnergyDisplay } from './AcDcStatsPanel';
import type { AcDcBreakdown, AcDcBucket } from './helpers';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>) =>
    vars ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

afterEach(cleanup);

function makeBucket(overrides: Partial<AcDcBucket> = {}): AcDcBucket {
  return {
    energy: 0,
    energyUsed: 0,
    cost: 0,
    count: 0,
    totalDuration: 0,
    freeCount: 0,
    freeEnergy: 0,
    ...overrides,
  };
}

// A representative mixed fleet: AC = 300 kWh over 4 sessions ($12, one free
// 50 kWh); DC = 700 kWh over 6 sessions ($90). Total 1000 kWh → 30% / 70%.
function mixedBreakdown(): AcDcBreakdown {
  return {
    ac: makeBucket({ energy: 300, energyUsed: 300, cost: 12, count: 4, totalDuration: 200, freeCount: 1, freeEnergy: 50 }),
    dc: makeBucket({ energy: 700, energyUsed: 700, cost: 90, count: 6, totalDuration: 300 }),
    total: { energy: 1000, cost: 102, freeEnergy: 50, freeCount: 1 },
  };
}

describe('formatEnergyDisplay', () => {
  it('renders sub-1000 kWh values verbatim and ≥1000 kWh values as MWh', () => {
    expect(formatEnergyDisplay(500)).toBe('500.00 kWh');
    expect(formatEnergyDisplay(999.5)).toBe('999.50 kWh');
    // Branch: 1500 kWh → 1.50 MWh; boundary 1000 kWh also crosses to MWh.
    expect(formatEnergyDisplay(1500)).toBe('1.50 MWh');
    expect(formatEnergyDisplay(1000)).toBe('1.00 MWh');
  });

  it('degrades nullish / non-finite input to "0.00 kWh" instead of leaking NaN', () => {
    expect(formatEnergyDisplay(0)).toBe('0.00 kWh');
    expect(formatEnergyDisplay(undefined)).toBe('0.00 kWh');
    expect(formatEnergyDisplay(null)).toBe('0.00 kWh');
    expect(formatEnergyDisplay(Number.NaN)).toBe('0.00 kWh');
  });
});

describe('AcDcStatsPanel — energy split bar', () => {
  it('exposes an accessible split summary, both percentage chips, and MWh-scaled totals', () => {
    const { container } = render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);

    expect(screen.getByText('Charging Stats by Type')).toBeInTheDocument();

    // The bar is a single labelled image for AT: "30% AC, 70% DC".
    expect(
      screen.getByRole('img', { name: 'Energy split: 30% AC, 70% DC' }),
    ).toBeInTheDocument();

    // Visible chips carry the precise percentages.
    expect(screen.getByText('AC 30.00%')).toBeInTheDocument();
    expect(screen.getByText('DC 70.00%')).toBeInTheDocument();

    // Footer totals: AC/DC in kWh, the 1000 kWh grand total scaled to MWh.
    expect(screen.getByText(/AC: 300\.00 kWh/)).toBeInTheDocument();
    expect(screen.getByText(/Total: 1\.00 MWh/)).toBeInTheDocument();
    expect(screen.getByText(/DC: 700\.00 kWh/)).toBeInTheDocument();

    // No arithmetic ever leaks to the DOM.
    expect(container.textContent).not.toContain('NaN');
  });
});

describe('AcDcStatsPanel — per-type stats table', () => {
  it('renders one row per non-empty bucket with sessions, costs, averages, and free totals', () => {
    render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);

    const table = screen.getByRole('table');
    expect(table).toBeInTheDocument();

    // Both charge types surface as rows.
    expect(within(table).getByText('AC Charging')).toBeInTheDocument();
    expect(within(table).getByText('DC Charging')).toBeInTheDocument();

    // Per-type cost + $/kWh flow through the real <Currency> ('$' from settings).
    expect(within(table).getByText('$12.00')).toBeInTheDocument(); // AC cost
    expect(within(table).getByText('$90.00')).toBeInTheDocument(); // DC cost
    expect(within(table).getByText('$0.04')).toBeInTheDocument(); // AC 12 / 300
    expect(within(table).getByText('$0.13')).toBeInTheDocument(); // DC 90 / 700

    // Avg time = totalDuration / count = 50m for both → two occurrences.
    expect(within(table).getAllByText('50m')).toHaveLength(2);

    // Free column: AC "1 (50.00 kWh)"; DC has none → em-dash.
    expect(within(table).getByText('1 (50.00 kWh)')).toBeInTheDocument();
    expect(within(table).getByText('—')).toBeInTheDocument();
  });

  it('shows the empty-table message when neither bucket has sessions', () => {
    const breakdown: AcDcBreakdown = {
      ac: makeBucket(),
      dc: makeBucket(),
      total: { energy: 0, cost: 0, freeEnergy: 0, freeCount: 0 },
    };
    render(<AcDcStatsPanel breakdown={breakdown} />);

    expect(screen.getByText('No AC/DC charging data')).toBeInTheDocument();
    expect(screen.queryByText('AC Charging')).toBeNull();
  });
});

describe('AcDcStatsPanel — free-charging footer', () => {
  it('shows the free summary when there are free sessions', () => {
    render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);

    expect(screen.getByText(/Free charged/)).toBeInTheDocument();
    // Interpolated count from t('...','{{count}} sessions',{count}).
    expect(screen.getByText('1 sessions')).toBeInTheDocument();
    // Footer free-energy strong renders exactly "50.00 kWh".
    expect(screen.getByText('50.00 kWh')).toBeInTheDocument();
  });

  it('hides the free summary entirely when no session was free', () => {
    const breakdown: AcDcBreakdown = {
      ac: makeBucket({ energy: 300, cost: 20, count: 2, totalDuration: 60 }),
      dc: makeBucket(),
      total: { energy: 300, cost: 20, freeEnergy: 0, freeCount: 0 },
    };
    render(<AcDcStatsPanel breakdown={breakdown} />);

    expect(screen.queryByText(/Free charged/)).toBeNull();
    expect(screen.queryByText(/Free energy/)).toBeNull();
  });
});

describe('AcDcStatsPanel — regression + null safety', () => {
  it('guards a zero total energy: no NaN, no split bar, an explicit empty note', () => {
    // Sessions exist (count > 0) but recorded 0 energy → total.energy === 0.
    // Pre-fix this divided to NaN and emitted `NaN% NaN%` grid-template.
    const breakdown: AcDcBreakdown = {
      ac: makeBucket({ count: 2, totalDuration: 40 }),
      dc: makeBucket(),
      total: { energy: 0, cost: 0, freeEnergy: 0, freeCount: 0 },
    };
    const { container } = render(<AcDcStatsPanel breakdown={breakdown} />);

    expect(container.textContent).not.toContain('NaN');
    expect(screen.getByText('No energy recorded for these sessions yet.')).toBeInTheDocument();
    // The split-bar image is suppressed when there is no energy to split.
    expect(screen.queryByRole('img')).toBeNull();
    // The table still lists the non-empty AC bucket at "0.00 kWh".
    const table = screen.getByRole('table');
    expect(within(table).getByText('AC Charging')).toBeInTheDocument();
    expect(within(table).queryByText('DC Charging')).toBeNull();
    expect(within(table).getAllByText('0.00 kWh').length).toBeGreaterThanOrEqual(1);
  });

  it('does not throw and degrades gracefully when the breakdown is undefined', () => {
    const renderUndefined = () =>
      render(<AcDcStatsPanel breakdown={undefined as unknown as AcDcBreakdown} />);

    expect(renderUndefined).not.toThrow();
    expect(screen.getByText('No energy recorded for these sessions yet.')).toBeInTheDocument();
    expect(screen.getByText('No AC/DC charging data')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it('renders a single-sided split without NaN when one type has no energy', () => {
    const breakdown: AcDcBreakdown = {
      ac: makeBucket({ energy: 1000, energyUsed: 1000, cost: 50, count: 5, totalDuration: 250 }),
      dc: makeBucket({ energy: 0, count: 3, totalDuration: 90 }),
      total: { energy: 1000, cost: 50, freeEnergy: 0, freeCount: 0 },
    };
    const { container } = render(<AcDcStatsPanel breakdown={breakdown} />);

    expect(
      screen.getByRole('img', { name: 'Energy split: 100% AC, 0% DC' }),
    ).toBeInTheDocument();
    expect(screen.getByText('AC 100.00%')).toBeInTheDocument();
    // The 0%-energy DC side renders no visible percentage chip.
    expect(screen.queryByText(/^DC .*%$/)).toBeNull();
    expect(container.textContent).not.toContain('NaN');
    // DC still appears as a (zero-energy) row in the table.
    expect(within(screen.getByRole('table')).getByText('DC Charging')).toBeInTheDocument();
  });
});
