import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { act, render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';

import { AcDcStatsPanel, formatEnergyDisplay } from './AcDcStatsPanel';
import type { AcDcBreakdown, AcDcBucket } from './helpers';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
const translations = vi.hoisted(() => ({ values: {} as Record<string, string> }));

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
          return interpolate(translations.values[key] ?? second, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

afterEach(() => {
  cleanup();
  translations.values = {};
});

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

  it('preserves measured zero', () => {
    expect(formatEnergyDisplay(0)).toBe('0.00 kWh');
  });

  it.each([undefined, null, Number.NaN, Infinity, -Infinity])('marks missing/invalid %s as unknown', (value) => {
    expect(formatEnergyDisplay(value)).toBe('—');
  });

  it.each([
    [-12.5, '-12.50 kWh'],
    [-1000, '-1,000.00 kWh'],
    [0.125, '0.13 kWh'],
    [999.999, '1,000.00 kWh'],
    [1000.125, '1.00 MWh'],
  ])('preserves signed/fractional input %s and the unrounded threshold', (value, expected) => {
    expect(formatEnergyDisplay(value)).toBe(expected);
  });
});

describe('AcDcStatsPanel — energy split bar', () => {
  it('translates authored split labels and summaries without changing numeric geometry', () => {
    translations.values = {
      'charging.detail.ac': 'Alternatif',
      'charging.detail.dc': 'Continu',
      Total: 'Somme',
      'charging.stats.energySplitAria': 'Répartition : {{ac}}% alternatif, {{dc}}% continu',
      'charging.stats.chargingByType': 'Statistiques par type',
      'charging.stats.energySplitLabel': 'Répartition énergétique',
      'charging.table.acCharging': 'Recharge alternative',
      'charging.table.dcCharging': 'Recharge continue',
      'charging.stats.freeSessions': '{{count}} séances',
    };
    render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);
    expect(screen.getByRole('heading', { name: 'Statistiques par type' })).toBeInTheDocument();
    expect(screen.getByText('Répartition énergétique')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Répartition : 30% alternatif, 70% continu' }))
      .toHaveStyle({ gridTemplateColumns: '30% 70%' });
    expect(screen.getByText('Alternatif 30.00%')).toBeInTheDocument();
    expect(screen.getByText('Continu 70.00%')).toBeInTheDocument();
    expect(screen.getByText('Somme: 1.00 MWh')).toBeInTheDocument();
    expect(screen.getByText('Recharge alternative')).toBeInTheDocument();
    expect(screen.getByText('1 séances')).toBeInTheDocument();
  });

  it('keeps a DC-only split in its non-zero second track rather than the empty AC track', () => {
    render(<AcDcStatsPanel breakdown={{
      ac: makeBucket(),
      dc: makeBucket({ energy: 157.5, count: 6 }),
      total: { energy: 157.5, cost: 0, freeEnergy: 0, freeCount: 0 },
    }} />);
    expect(screen.getByRole('img', { name: 'Energy split: 0% AC, 100% DC' })).toHaveStyle({ gridTemplateColumns: '0% 100%' });
    expect(screen.getByText('DC 100.00%')).toHaveClass('col-start-2');
  });

  it('exposes an accessible split summary, both percentage chips, and MWh-scaled totals', () => {
    const { container } = render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);

    expect(screen.getByRole('heading', { name: 'Charging stats by type' })).toBeInTheDocument();

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
    expect(within(table).getByText('AC charging')).toBeInTheDocument();
    expect(within(table).getByText('DC charging')).toBeInTheDocument();

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
    expect(screen.queryByText('AC charging')).toBeNull();
  });
});

describe('AcDcStatsPanel — mobile field access', () => {
  const observers: { element: Element; callback: ResizeObserverCallback }[] = [];

  function resize(width: number) {
    act(() => observers.forEach(({ element, callback }) => callback(
      [{ target: element, contentRect: { width } } as ResizeObserverEntry],
      {} as ResizeObserver,
    )));
  }

  beforeEach(() => {
    localStorage.clear();
    observers.length = 0;
    vi.stubGlobal('ResizeObserver', class {
      constructor(private callback: ResizeObserverCallback) {}
      observe(element: Element) { observers.push({ element, callback: this.callback }); }
      unobserve() {}
      disconnect() {}
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it.each(['Enter', ' '])('opens all eight AC fields with %s and restores focus on Escape', async (key) => {
    const user = userEvent.setup();
    render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);
    resize(335);

    expect(screen.queryByRole('table')).toBeNull();
    const card = screen.getByRole('button', { name: 'AC charging' });
    expect(within(card).getByText('300.00 kWh')).toBeInTheDocument();
    expect(within(card).getByText('$12.00')).toBeInTheDocument();
    card.focus();
    await user.keyboard(key === 'Enter' ? '{Enter}' : ' ');
    const dialog = screen.getByRole('dialog', { name: 'AC charging' });
    const fields = dialog.querySelectorAll('dl > div');
    expect(fields).toHaveLength(8);
    expect(Array.from(fields, field => field.querySelector('dt')?.textContent)).toEqual([
      'Type', 'Sessions', 'Energy', 'Cost', '$/kWh', 'Avg energy', 'Avg time', 'Free',
    ]);
    expect(Array.from(fields, field => field.querySelector('dd')?.textContent)).toEqual([
      'AC charging', '4', '300.00 kWh', '$12.00', '$0.04', '75.00 kWh', '50m', '1 (50.00 kWh)',
    ]);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(card).toHaveFocus();

    resize(1200);
    expect(screen.getByRole('table').querySelectorAll('thead th')).toHaveLength(8);
    expect(screen.queryByRole('button', { name: 'AC charging' })).toBeNull();
  });

  it('keeps DC details reachable through quick view and preserves unknown cost in mobile summaries', async () => {
    const user = userEvent.setup();
    const breakdown = mixedBreakdown();
    breakdown.dc.cost = null;
    render(<AcDcStatsPanel breakdown={breakdown} />);
    resize(335);
    expect(within(screen.getByRole('button', { name: 'DC charging' })).getByText('—')).toBeInTheDocument();
    const quickView = screen.getAllByRole('button', { name: 'Quick view' })[1];
    expect(quickView).toHaveClass('min-h-11', 'min-w-11');
    await user.click(quickView);
    const dialog = screen.getByRole('dialog', { name: 'DC charging' });
    expect(dialog.querySelectorAll('dt')).toHaveLength(8);
    expect(within(dialog).getAllByText('—')).toHaveLength(3);
    await user.click(within(dialog).getByText('Close', { exact: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(quickView).toHaveFocus();
  });
});

describe('AcDcStatsPanel — free-charging footer', () => {
  it('shows the free summary when there are free sessions', () => {
    render(<AcDcStatsPanel breakdown={mixedBreakdown()} />);

    expect(screen.getByRole('heading', { name: /Free charged/ })).toBeInTheDocument();
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
    expect(within(table).getByText('AC charging')).toBeInTheDocument();
    expect(within(table).queryByText('DC charging')).toBeNull();
    expect(within(table).getAllByText('0.00 kWh').length).toBeGreaterThanOrEqual(1);
  });

  it.each([undefined, null])('does not throw when the breakdown is %s', (breakdown) => {
    const renderUndefined = () =>
      render(<AcDcStatsPanel breakdown={breakdown} />);

    expect(renderUndefined).not.toThrow();
    expect(screen.getByText('No reading')).toBeInTheDocument();
    expect(screen.getByText('No AC/DC charging data')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
  });

  it.each([Number.NaN, Infinity, -Infinity])('keeps invalid cost %s distinct from a zero-cost session', (cost) => {
    const breakdown = mixedBreakdown();
    breakdown.ac.cost = cost;
    breakdown.ac.freeCount = 0;
    breakdown.total.freeCount = 0;
    const { container } = render(<AcDcStatsPanel breakdown={breakdown} />);
    const row = screen.getByRole('row', { name: /AC charging/ });
    expect(within(row).getAllByText('—')).toHaveLength(3);
    expect(screen.queryByRole('heading', { name: /Free charged/ })).toBeNull();
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it.each([Number.NaN, Infinity, -Infinity])('does not present invalid energy %s as measured zero', (energy) => {
    const breakdown = mixedBreakdown();
    breakdown.ac.energy = energy;
    breakdown.total.energy = energy;
    const { container } = render(<AcDcStatsPanel breakdown={breakdown} />);
    expect(screen.getByText('No reading')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    const row = screen.getByRole('row', { name: /AC charging/ });
    expect(within(row).getAllByText('—')).toHaveLength(3);
    expect(container.textContent).not.toMatch(/NaN|Infinity/);
  });

  it('shows unknown readings when a returned bucket omits energy', () => {
    const breakdown = mixedBreakdown();
    Reflect.deleteProperty(breakdown.ac, 'energy');
    render(<AcDcStatsPanel breakdown={breakdown} />);
    expect(screen.getByText('No reading')).toBeInTheDocument();
    expect(screen.queryByRole('img')).toBeNull();
    expect(within(screen.getByRole('row', { name: /AC charging/ })).getAllByText('—')).toHaveLength(3);
  });

  it('retains signed fractional costs and energy rather than replacing them with zero', () => {
    const breakdown = mixedBreakdown();
    breakdown.ac.energy = -12.5;
    breakdown.ac.cost = -3.25;
    render(<AcDcStatsPanel breakdown={breakdown} />);
    const row = screen.getByRole('row', { name: /AC charging/ });
    expect(within(row).getByText('-12.50 kWh')).toBeInTheDocument();
    expect(within(row).getByText('-3.13 kWh')).toBeInTheDocument();
    expect(within(row).getByText(/3\.25/)).toBeInTheDocument();
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
    expect(within(screen.getByRole('table')).getByText('DC charging')).toBeInTheDocument();
  });
});
