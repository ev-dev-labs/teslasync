/**
 * EfficiencyPanel — behaviour + hardening coverage.
 *
 * The panel takes a fully-computed `stats: EfficiencyStats` prop and renders a
 * lifetime charging-efficiency summary: a header (title + hint + "N sessions
 * with data" count), and four metric tiles — average efficiency (with a
 * clamped progress bar), best session, worst session, and wall-to-battery
 * loss. It has no data source of its own, so the network is never touched.
 *
 * This suite drives the facets that matter:
 *   - the panel chrome always frames the section (heading, hint, session count,
 *     a decorative aria-hidden icon),
 *   - each tile renders its metric through the real number/percent formatters
 *     and wires the best/worst dates through `formatDateTime`,
 *   - the average-efficiency progress bar exposes a real `role="progressbar"`
 *     with an accessible name and correct aria-value* bounds, and its fill
 *     width is CLAMPED to [0, 100] — the core bug fix: a value over 100, a
 *     negative value, or a non-finite/undefined value can never emit `NaN%`
 *     or an out-of-range width,
 *   - null-safety: an undefined `avgEfficiency` / missing `best`/`worst`
 *     objects / undefined `count` never throw and degrade to the shared
 *     "0.00%" / "—" / "0" placeholders instead of a blank or crashing panel.
 *
 * `react-i18next` is doubled so the English fallback (2nd arg to `t`) is what
 * renders — assertions read on copy. `@/lib/dateFormat` is doubled with a
 * transparent echo so the best/worst date wiring is observable and non-flaky
 * (the real formatter is timezone-dependent). The number formatters
 * (`@/lib/numberFormat`) and `GlassPanel` are the REAL implementations so the
 * rendered percentages, units and DOM structure are genuinely exercised.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';

import type { EfficiencyStats } from './helpers';
import { EfficiencyPanel } from './EfficiencyPanel';

// ── i18n: resolve the string fallback (2nd arg) so assertions read on copy. ──
vi.mock('react-i18next', () => {
  const t = (key: string, fallback?: unknown): string =>
    typeof fallback === 'string' ? fallback : key;
  return {
    useTranslation: () => ({ t, i18n: { language: 'en', changeLanguage: vi.fn() } }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
    initReactI18next: { type: '3rdParty', init: () => undefined },
  };
});

// ── date formatter double: echo the ISO input so best/worst wiring is
//    observable, and mirror the real "—" fallback for nullish input. The real
//    `formatDateTime` renders in the host timezone, which would make date
//    assertions flaky across CI runners. ──
vi.mock('@/lib/dateFormat', () => ({
  formatDateTime: (iso?: string | Date | null): string =>
    iso ? `dt(${String(iso)})` : '—',
}));

const STATS: EfficiencyStats = {
  avgEfficiency: 85.5,
  best: { id: 1, date: '2026-04-15T12:00:00Z', efficiency: 96.25, added: 50, used: 55 },
  worst: { id: 2, date: '2026-01-02T08:30:00Z', efficiency: 42.1, added: 30, used: 40 },
  wallLoss: 3.2,
  totalAdded: 95,
  totalUsed: 100,
  count: 4,
};

function renderPanel(stats: EfficiencyStats) {
  return render(<EfficiencyPanel stats={stats} />);
}

/** The metric tile (a GlassPanel div) that contains the given label. */
function tileByLabel(label: string): HTMLElement {
  const tile = screen.getByText(label).closest('[data-print-card]');
  if (!tile) throw new Error(`no tile for label "${label}"`);
  return tile as HTMLElement;
}

describe('EfficiencyPanel — panel chrome', () => {
  it('frames the section with the title heading, hint and session count, and a decorative icon', () => {
    const { container } = renderPanel(STATS);

    const heading = screen.getByRole('heading', { name: /Charging Efficiency/i });
    expect(heading).toBeInTheDocument();
    // Hint + "N sessions with data" live inside the heading's sub-span.
    expect(heading).toHaveTextContent('Wall-to-battery energy conversion');
    expect(heading).toHaveTextContent('(4 sessions with data)');
    // The lucide Activity icon in the header is decorative and hidden from AT.
    expect(container.querySelectorAll('svg[aria-hidden="true"]').length).toBe(1);
  });
});

describe('EfficiencyPanel — metric tiles', () => {
  it('renders every metric through the real formatters, scoped to its own tile', () => {
    renderPanel(STATS);

    // Average tile — percent + the label.
    const avg = tileByLabel('Average Efficiency');
    expect(within(avg).getByText('85.50%')).toBeInTheDocument();

    // Best / worst tiles — percent + echoed date, each in the right tile.
    const best = tileByLabel('Best Session');
    expect(within(best).getByText('96.25%')).toBeInTheDocument();
    expect(within(best).getByText('dt(2026-04-15T12:00:00Z)')).toBeInTheDocument();

    const worst = tileByLabel('Worst Session');
    expect(within(worst).getByText('42.10%')).toBeInTheDocument();
    expect(within(worst).getByText('dt(2026-01-02T08:30:00Z)')).toBeInTheDocument();

    // Wall-loss tile — value + the used→added summary line.
    const loss = tileByLabel('Wall-to-Battery Loss');
    expect(within(loss).getByText('3.20 kWh')).toBeInTheDocument();
    expect(loss).toHaveTextContent('100.00 kWh → 95.00 kWh');
  });
});

describe('EfficiencyPanel — progress bar (accessible + clamped)', () => {
  it('exposes an accessible progressbar bound to [0, 100] with the fill width matching the value', () => {
    renderPanel(STATS);

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAccessibleName('Average charging efficiency');
    expect(bar).toHaveAttribute('aria-valuemin', '0');
    expect(bar).toHaveAttribute('aria-valuemax', '100');
    // Math.round(85.5) === 86.
    expect(bar).toHaveAttribute('aria-valuenow', '86');

    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ width: '85.5%' });
  });

  it('clamps a value greater than 100 down to a full (100%) bar', () => {
    renderPanel({ ...STATS, avgEfficiency: 250 });

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '100');
    expect((bar.firstElementChild as HTMLElement)).toHaveStyle({ width: '100%' });
  });

  it('clamps a negative value up to an empty (0%) bar instead of a negative width', () => {
    renderPanel({ ...STATS, avgEfficiency: -30 });

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect((bar.firstElementChild as HTMLElement)).toHaveStyle({ width: '0%' });
  });

  it('treats a non-finite/undefined avgEfficiency as 0 — never NaN% — and shows "0.00%"', () => {
    renderPanel({ ...STATS, avgEfficiency: undefined as unknown as number });

    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    const fill = bar.firstElementChild as HTMLElement;
    expect(fill).toHaveStyle({ width: '0%' });
    expect(fill.style.width).not.toContain('NaN');
    // The average tile still shows a rendered percentage, not "NaN%".
    expect(within(tileByLabel('Average Efficiency')).getByText('0.00%')).toBeInTheDocument();
  });
});

describe('EfficiencyPanel — null safety', () => {
  it('does not throw and degrades to placeholders when best/worst/count are missing', () => {
    const partial = {
      avgEfficiency: 0,
      wallLoss: 0,
      totalAdded: 0,
      totalUsed: 0,
    } as unknown as EfficiencyStats;

    expect(() => renderPanel(partial)).not.toThrow();

    // Missing count degrades to 0 in the header.
    expect(screen.getByRole('heading', { name: /Charging Efficiency/i })).toHaveTextContent(
      '(0 sessions with data)',
    );

    // Missing best/worst objects → guarded "0.00%" + the "—" date fallback.
    const best = tileByLabel('Best Session');
    expect(within(best).getByText('0.00%')).toBeInTheDocument();
    expect(within(best).getByText('—')).toBeInTheDocument();

    const worst = tileByLabel('Worst Session');
    expect(within(worst).getByText('0.00%')).toBeInTheDocument();
    expect(within(worst).getByText('—')).toBeInTheDocument();
  });
});
