/**
 * OptimizerSection (charging-list) — behaviour + hardening contract.
 *
 * OptimizerSection is the "Charging Optimizer" body of the Charging list page.
 * It is a *pure presentational* component: the parent hands it a fully-loaded
 * `ChargingOptimizerData` bag and it lays out five things —
 *
 *   1. a conditional "savings" AlertBanner (only when the estimated monthly
 *      saving strictly exceeds $5);
 *   2. a "Charging Habits" panel (sessions/week, home %, avg target, common
 *      start hour + day);
 *   3. a "Battery-Friendly Score" RadialGauge whose colour + caption switch on
 *      three score bands (>=75 good / >=50 fair / else poor);
 *   4. a "Cost Analysis" panel (peak/off-peak rate, % of sessions during peak,
 *      the peak/off-peak hour lists);
 *   5. the sibling <CostHeatmap>; and a "Recommendations" list (or its empty
 *      state).
 *
 * These tests therefore render it directly (no QueryClient / Router — the only
 * context it needs is the globally-stubbed `useSettings` from src/test-setup.ts,
 * consumed transitively by <CostHeatmap>'s `useFormatting`) and pin:
 *
 *   - the savings banner's strict `> 5` gate (shown at 18, hidden at 5 and 3);
 *   - every habits row's formatted value, and the null-safety added here —
 *     a nullish `most_common_start_hour` / `most_common_day` renders "—",
 *     never "undefined:00", while hour `0` (midnight) is preserved as "0:00";
 *   - the three battery-score bands: caption text + the gauge's hex stroke
 *     colour, plus the hardening that `NaN`/`undefined` collapses to 0 (poor,
 *     red) and never leaks "NaN" into the DOM / an SVG offset;
 *   - the cost-analysis rows: 3-dp rates, the peak-session %'s red/emerald
 *     branch, joined hour lists, and their "—" empty fallback;
 *   - the heatmap panel is ALWAYS rendered (elevation fix — it used to be gated
 *     behind `length > 0`, hiding the panel): a labelled role="img" grid when
 *     populated, and CostHeatmap's own empty state (never a blank hole) when
 *     the heatmap is empty;
 *   - the recommendations list (title / priority / conditional savings chip /
 *     detail) across all three priorities, the chip's `> 0` gate, and the
 *     labelled role="status" EmptyState when there are none;
 *   - accessibility: every decorative header/row glyph is `aria-hidden`.
 *
 * `react-i18next` is stubbed so `t(key, fallback)` resolves to its English
 * fallback deterministically (mirrors the sibling CostHeatmap / charging-curve
 * tests). Note the stub does NOT interpolate `{{amount}}`, so banner assertions
 * key off the interpolation-free copy rather than the templated title.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import { OptimizerSection } from './OptimizerSection';
import type {
  ChargingOptimizerData,
  OptimizerCostAnalysis,
  OptimizerHeatmapEntry,
  OptimizerRecommendation,
  OptimizerSchedule,
} from '@/types/charging';

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallback?: unknown) => (typeof fallback === 'string' ? fallback : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

/* ── Fixtures — deliberately distinct magnitudes so text queries never alias. ── */

const baseSchedule: OptimizerSchedule = {
  most_common_start_hour: 22,
  most_common_day: 'Wednesday',
  avg_sessions_per_week: 4.5,
  home_charging_pct: 85,
  avg_charge_to_pct: 80,
};

const baseCost: OptimizerCostAnalysis = {
  peak_hours: [17, 18, 19],
  offpeak_hours: [1, 2, 3],
  peak_cost_per_kwh: 0.42,
  offpeak_cost_per_kwh: 0.11,
  sessions_during_peak_pct: 45,
  potential_monthly_savings: 18,
};

const baseRecs: OptimizerRecommendation[] = [
  {
    type: 'shift_offpeak',
    priority: 'high',
    title: 'Shift charging to off-peak',
    detail: 'Move sessions to after 9pm.',
    estimated_savings: 24,
  },
  {
    type: 'lower_target',
    priority: 'medium',
    title: 'Lower your charge target',
    detail: 'Cap the daily ceiling lower.',
    estimated_savings: 0,
  },
  {
    type: 'home_more',
    priority: 'low',
    title: 'Charge at home more often',
    detail: 'Home charging is cheaper.',
  },
];

const baseHeatmap: OptimizerHeatmapEntry[] = [
  { day: 1, hour: 9, sessions: 4, avg_cost_per_kwh: 0.3 },
];

const BASE_SCORE = 82;

interface OptimizerOverrides {
  schedule?: Partial<OptimizerSchedule>;
  cost?: Partial<OptimizerCostAnalysis>;
  battery_health_score?: number;
  recommendations?: OptimizerRecommendation[];
  weekly_heatmap?: OptimizerHeatmapEntry[];
}

function makeOptimizer(o: OptimizerOverrides = {}): ChargingOptimizerData {
  return {
    current_schedule: { ...baseSchedule, ...o.schedule },
    cost_analysis: { ...baseCost, ...o.cost },
    battery_health_score: o.battery_health_score ?? BASE_SCORE,
    recommendations: o.recommendations ?? baseRecs,
    weekly_heatmap: o.weekly_heatmap ?? baseHeatmap,
  };
}

const renderSection = (o?: OptimizerOverrides) =>
  render(<OptimizerSection optimizer={makeOptimizer(o)} />);

/** The single hex-stroked circle in the section is the RadialGauge's progress arc. */
const gaugeStroke = (container: HTMLElement) =>
  container.querySelector('circle[stroke^="#"]')?.getAttribute('stroke');

const SAVINGS_DETAIL =
  'Based on your charging patterns, shifting to off-peak hours could reduce your monthly costs.';

describe('OptimizerSection — savings banner', () => {
  it('shows the banner (with its detail copy) only when savings strictly exceed $5', () => {
    renderSection({ cost: { potential_monthly_savings: 18 } });

    // The interpolation-free detail line is the stable proof the banner mounted.
    expect(screen.getByText(SAVINGS_DETAIL)).toBeInTheDocument();
    // The templated title still renders (the mock leaves {{amount}} un-substituted).
    expect(screen.getByText(/adjusting your charging schedule/)).toBeInTheDocument();
  });

  it('hides the banner at the $5 boundary and below (strict >, not >=)', () => {
    renderSection({ cost: { potential_monthly_savings: 5 } });
    expect(screen.queryByText(SAVINGS_DETAIL)).toBeNull();

    // …and for a small saving well under the threshold.
    renderSection({ cost: { potential_monthly_savings: 3 } });
    expect(screen.queryByText(SAVINGS_DETAIL)).toBeNull();
  });
});

describe('OptimizerSection — charging habits', () => {
  it('renders every habit row with its formatted, unit-suffixed value', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: 'Charging Habits' })).toBeInTheDocument();
    expect(screen.getByText('4.5')).toBeInTheDocument(); // sessions/week (1 dp)
    expect(screen.getByText('85%')).toBeInTheDocument(); // home charging
    expect(screen.getByText('80%')).toBeInTheDocument(); // avg charge target
    expect(screen.getByText('22:00')).toBeInTheDocument(); // common start hour
    expect(screen.getByText('Wednesday')).toBeInTheDocument(); // common day
  });

  it('falls back to "—" for a nullish start hour / day (never "undefined:00")', () => {
    const opt = makeOptimizer();
    const dirty: ChargingOptimizerData = {
      ...opt,
      current_schedule: {
        ...opt.current_schedule,
        most_common_start_hour: undefined as unknown as number,
        most_common_day: undefined as unknown as string,
      },
    };
    const { container } = render(<OptimizerSection optimizer={dirty} />);

    // Both nullish rows collapse to the em-dash placeholder — and nothing else does.
    expect(screen.getAllByText('—')).toHaveLength(2);
    expect(container.textContent).not.toContain('undefined:00');
    expect(container.textContent).not.toContain('undefined');
  });

  it('preserves hour 0 (midnight) as "0:00" rather than treating it as empty', () => {
    renderSection({ schedule: { most_common_start_hour: 0 } });
    // `!= null` guard keeps the falsy-but-valid 0 — it must not become "—".
    expect(screen.getByText('0:00')).toBeInTheDocument();
  });
});

describe('OptimizerSection — battery-friendly score', () => {
  it('paints the gauge green + "battery-friendly" caption for a high score', () => {
    const { container } = renderSection({ battery_health_score: 82 });

    expect(screen.getByText('Your habits are battery-friendly')).toBeInTheDocument();
    expect(gaugeStroke(container)).toBe('#22c55e');
    expect(screen.getByText('82')).toBeInTheDocument(); // gauge value
  });

  it('paints amber + "room for improvement" for a mid-band score', () => {
    const { container } = renderSection({ battery_health_score: 60 });

    expect(screen.getByText('Room for improvement')).toBeInTheDocument();
    expect(gaugeStroke(container)).toBe('#f59e0b');
  });

  it('paints red + "consider adjusting" for a low score', () => {
    const { container } = renderSection({ battery_health_score: 30 });

    expect(screen.getByText('Consider adjusting your habits')).toBeInTheDocument();
    expect(gaugeStroke(container)).toBe('#ef4444');
  });

  it('collapses a NaN/undefined score to 0 (poor, red) without leaking "NaN"', () => {
    const opt = makeOptimizer();
    const dirty: ChargingOptimizerData = {
      ...opt,
      battery_health_score: NaN as unknown as number,
    };
    const { container } = render(<OptimizerSection optimizer={dirty} />);

    expect(screen.getByText('Consider adjusting your habits')).toBeInTheDocument();
    expect(gaugeStroke(container)).toBe('#ef4444');
    // safeNumber neutralises NaN → 0, so neither the caption nor the SVG offset
    // (stroke-dashoffset) leaks "NaN" anywhere in the tree.
    expect(container.textContent).not.toContain('NaN');
    expect(container.innerHTML).not.toContain('NaN');
  });
});

describe('OptimizerSection — cost analysis', () => {
  it('renders 3-dp peak/off-peak rates and the joined hour lists', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: 'Cost Analysis' })).toBeInTheDocument();
    expect(screen.getByText('$0.420/kWh')).toBeInTheDocument();
    expect(screen.getByText('$0.110/kWh')).toBeInTheDocument();
    expect(screen.getByText('17:00, 18:00, 19:00')).toBeInTheDocument();
    expect(screen.getByText('1:00, 2:00, 3:00')).toBeInTheDocument();
  });

  it('flags a high peak-session share red and a low share emerald', () => {
    renderSection({ cost: { sessions_during_peak_pct: 45 } });
    expect(screen.getByText('45%').className).toContain('text-red-400');

    renderSection({ cost: { sessions_during_peak_pct: 10 } });
    expect(screen.getByText('10%').className).toContain('text-emerald-300');
  });

  it('shows "—" for empty peak / off-peak hour lists (never a blank cell)', () => {
    renderSection({ cost: { peak_hours: [], offpeak_hours: [] } });
    // Exactly the two hour rows fall back to the em-dash (habits day/hour are set).
    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});

describe('OptimizerSection — cost heatmap (always-on panel)', () => {
  it('renders the labelled heatmap grid when there is heatmap data', () => {
    renderSection();

    expect(screen.getByRole('heading', { name: 'Charging Cost Heatmap' })).toBeInTheDocument();
    expect(
      screen.getByRole('img', {
        name: 'Average charging cost per kWh by weekday and hour of day',
      }),
    ).toBeInTheDocument();
  });

  it('still renders the heatmap panel + its empty state when the heatmap is empty', () => {
    renderSection({ weekly_heatmap: [] });

    // Elevation fix: the panel shell (title) is NEVER hidden — only its body
    // swaps to CostHeatmap's own empty state. The grid image is gone.
    expect(screen.getByRole('heading', { name: 'Charging Cost Heatmap' })).toBeInTheDocument();
    expect(
      screen.getByText('The charging cost heatmap will appear after more charging sessions.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('img', {
        name: 'Average charging cost per kWh by weekday and hour of day',
      }),
    ).toBeNull();
  });
});

describe('OptimizerSection — recommendations', () => {
  it('lists each recommendation with its title, priority and conditional savings chip', () => {
    renderSection();

    expect(
      screen.getByRole('heading', { name: 'Optimization Recommendations' }),
    ).toBeInTheDocument();

    // All three recommendation titles + details render.
    expect(screen.getByText('Shift charging to off-peak')).toBeInTheDocument();
    expect(screen.getByText('Move sessions to after 9pm.')).toBeInTheDocument();
    expect(screen.getByText('Lower your charge target')).toBeInTheDocument();
    expect(screen.getByText('Charge at home more often')).toBeInTheDocument();

    // Every priority label surfaces.
    expect(screen.getByText('high')).toBeInTheDocument();
    expect(screen.getByText('medium')).toBeInTheDocument();
    expect(screen.getByText('low')).toBeInTheDocument();

    // Savings chip only appears for the > 0 estimate (the high rec's $24) —
    // the medium rec's $0 and the low rec's missing estimate render no chip.
    expect(screen.getByText('~$24/mo')).toBeInTheDocument();
    expect(screen.queryByText('~$0/mo')).toBeNull();
  });

  it('renders the labelled empty state (never a blank panel) when there are none', () => {
    renderSection({ recommendations: [] });

    // Panel title stays; the body swaps to the accessible empty state.
    expect(
      screen.getByRole('heading', { name: 'Optimization Recommendations' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Recommendations will appear after more charging sessions.'),
    ).toBeInTheDocument();
    // No recommendation titles leak through.
    expect(screen.queryByText('Shift charging to off-peak')).toBeNull();
  });

  it('does not crash on an undefined recommendations array', () => {
    const opt = makeOptimizer();
    const dirty: ChargingOptimizerData = {
      ...opt,
      recommendations: undefined as unknown as OptimizerRecommendation[],
    };
    expect(() => render(<OptimizerSection optimizer={dirty} />)).not.toThrow();
    expect(
      screen.getByText('Recommendations will appear after more charging sessions.'),
    ).toBeInTheDocument();
  });
});

describe('OptimizerSection — accessibility', () => {
  it('marks every decorative icon glyph as aria-hidden (only the gauge arc is not)', () => {
    const { container } = renderSection();

    const svgs = Array.from(container.querySelectorAll('svg'));
    expect(svgs.length).toBeGreaterThan(1);

    // Every lucide glyph (banner $, Calendar, cost $, Clock, Lightbulb, Shields)
    // is decorative and hidden from assistive tech. The lone exception is the
    // RadialGauge's hand-drawn arc <svg class="-rotate-90">, a chart primitive.
    const notHidden = svgs.filter((s) => s.getAttribute('aria-hidden') !== 'true');
    expect(notHidden).toHaveLength(1);
    expect(notHidden[0].getAttribute('class') ?? '').toContain('-rotate-90');
  });
});
