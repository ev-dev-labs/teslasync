/**
 * AlertsSection — the weekly-digest "Alerts" bento panel.
 *
 * AlertsSection exports a single prop-driven component. It renders a
 * state-invariant header (icon + "Alerts" title + an optional total badge)
 * and, beneath it, one of four mutually-exclusive states with a strict
 * precedence: loading > error > empty > data. The populated state is a
 * two-column bento — a per-severity breakdown list on the left and a
 * distribution pie on the right.
 *
 * The behaviours this suite pins (never a smoke render, never real network):
 *
 *   1. State-invariant chrome — the "Alerts" heading + its decorative
 *      (aria-hidden) glyph render in EVERY state because the header lives
 *      outside the state switch. The total badge (fmtInt-formatted) only
 *      appears when `alertTotal > 0`.
 *   2. State precedence — loading pre-empts error, error pre-empts empty,
 *      empty pre-empts data (the four-branch ternary in the source).
 *   3. loading  → Skeleton; no breakdown, no captions, no empty affordance.
 *   4. error    → retriable QueryError; Retry invokes `onRetry`; no data.
 *   5. empty    → the "no alerts" guidance (role=status) with NO total badge.
 *   6. data     → the labelled severity list (role=list) with one listitem
 *      per bucket, each carrying its capitalised label, fmtInt count badge,
 *      severity-mapped icon colour and Badge variant; plus the pie region.
 *   7. Fallback mapping — an unknown severity coalesces to the Info icon,
 *      the default `text-sky-300` colour and the `info` Badge variant
 *      (the `?? 'text-sky-300'` / `?? 'info'` guards).
 *   8. Pie hardening — the pie only renders (as a labelled role="img"
 *      region) when `alertPieData` is non-empty; an empty breakdown shows a
 *      placeholder instead of a blank panel (the `pieData.length > 0` guard).
 *   9. Null-safety — undefined `alertsByType` / `alertPieData` coalesce to
 *      {} / [] so the panel renders instead of throwing, and a non-number
 *      count is formatted as "0" rather than crashing fmtInt.
 *
 * Follows the repo convention (see ReasonBreakdown.test.tsx / YearExtremes):
 * react-i18next is stubbed to echo the English fallback so assertions read
 * real copy, and a MemoryRouter wraps every render because the error branch's
 * <QueryError> reaches for `useNavigate`.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ComponentProps } from 'react';

import { ApiError } from '@/lib/resilience';
import { AlertsSection } from './AlertsSection';
import type { DigestMetrics, AlertPieEntry } from './types';

// Echo the English fallback (2nd arg) for every t() call so the copy we
// assert on is decoupled from the locale resource bundle. QueryError (which
// lives in the same module graph) is covered by this stub too.
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

// ── Fixtures ────────────────────────────────────────────────────────────────

const baseMetrics: DigestMetrics = {
  totalDistanceM: 0,
  prevDistanceM: 0,
  totalDrives: 0,
  prevDriveCount: 0,
  energyUsedWh: 0,
  prevEnergyWh: 0,
  chargingCost: 0,
  prevChargingCost: 0,
  co2Saved: 0,
  prevCo2: 0,
  avgEfficiencyWhPerM: 0,
  prevAvgEfficiencyWhPerM: 0,
  totalDurationS: 0,
  topDrive: undefined,
  chargeEnergyAddedWh: 0,
  prevChargeEnergyWh: 0,
  avgChargePowerW: 0,
  chargingSessionCount: 0,
  batteryStart: 0,
  batteryEnd: 0,
  alertsByType: {},
  alertTotal: 0,
};

function makeMetrics(overrides: Partial<DigestMetrics> = {}): DigestMetrics {
  return { ...baseMetrics, ...overrides };
}

/** A populated three-severity week: 3 critical, 2 warning, 1 info = 6 total. */
function populatedMetrics(): DigestMetrics {
  return makeMetrics({
    alertTotal: 6,
    alertsByType: { critical: 3, warning: 2, info: 1 },
  });
}

const populatedPie: AlertPieEntry[] = [
  { name: 'Critical', value: 3, color: '#ef4444' },
  { name: 'Warning', value: 2, color: '#f59e0b' },
  { name: 'Info', value: 1, color: '#3b82f6' },
];

type SectionProps = ComponentProps<typeof AlertsSection>;

function renderSection(overrides: Partial<SectionProps> = {}) {
  const props: SectionProps = {
    metrics: populatedMetrics(),
    alertPieData: populatedPie,
    isLoading: false,
    isError: false,
    error: null,
    onRetry: vi.fn(),
    ...overrides,
  };
  const utils = render(
    <MemoryRouter>
      <AlertsSection {...props} />
    </MemoryRouter>,
  );
  return { ...utils, props };
}

/** The panel heading — an <h3> from PanelTitle. */
const heading = () => screen.getByRole('heading', { name: /alerts/i });

/** Find the severity breakdown row (role=listitem) that shows `label`. */
function severityRow(label: string): HTMLElement {
  const el = screen.getByText(label).closest('[role="listitem"]');
  if (!el) throw new Error(`no listitem row for "${label}"`);
  return el as HTMLElement;
}

// ── 1. State-invariant chrome ────────────────────────────────────────────────

describe('AlertsSection — state-invariant chrome', () => {
  it('renders the "Alerts" heading with a decorative icon in every state', () => {
    const cases: Array<Partial<SectionProps>> = [
      { isLoading: true },
      { isError: true, error: new ApiError('boom', 500) },
      { metrics: makeMetrics({ alertTotal: 0 }), alertPieData: [] }, // empty
      {}, // data
    ];

    for (const override of cases) {
      const { unmount } = renderSection(override);
      const h = heading();
      expect(h).toBeInTheDocument();
      // The AlertTriangle glyph is presentational and stays out of the name.
      const icon = h.querySelector('svg');
      expect(icon).not.toBeNull();
      expect(icon?.getAttribute('aria-hidden')).toBe('true');
      unmount();
    }
  });

  it('shows the fmtInt-formatted total badge only when alertTotal > 0', () => {
    // Large total exercises the locale thousands separator in fmtInt.
    renderSection({ metrics: makeMetrics({ alertTotal: 1234, alertsByType: { info: 1234 } }) });
    expect(within(heading()).getByText('1,234')).toBeInTheDocument();
  });

  it('omits the total badge when there are no alerts', () => {
    renderSection({ metrics: makeMetrics({ alertTotal: 0 }), alertPieData: [] });
    // The accessible name is exactly "Alerts" — no trailing count.
    expect(screen.getByRole('heading', { name: 'Alerts' })).toBeInTheDocument();
  });
});

// ── 2 + 3. Loading ───────────────────────────────────────────────────────────

describe('AlertsSection — loading', () => {
  it('renders a skeleton and withholds the breakdown, captions and empty state', () => {
    const { container } = renderSection({ isLoading: true });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('Alerts by Severity')).toBeNull();
    expect(screen.queryByText('Alert Distribution')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('prioritises the skeleton over the error branch when both flags are set', () => {
    const { container } = renderSection({
      isLoading: true,
      isError: true,
      error: new ApiError('still broken', 500),
    });

    expect(container.querySelector('.animate-pulse')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// ── 4. Error ─────────────────────────────────────────────────────────────────

describe('AlertsSection — error', () => {
  it('surfaces a retriable error and invokes onRetry when Retry is clicked', () => {
    const onRetry = vi.fn();
    renderSection({ isError: true, error: new ApiError('kaboom', 500), onRetry });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);

    // The data list must not render behind the error affordance.
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('prioritises the error over the empty state (error wins even at zero alerts)', () => {
    renderSection({
      isError: true,
      error: new ApiError('server on fire', 500),
      metrics: makeMetrics({ alertTotal: 0 }),
      alertPieData: [],
    });

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.queryByText('No alerts this week — everything looks great!'),
    ).toBeNull();
  });
});

// ── 5. Empty ─────────────────────────────────────────────────────────────────

describe('AlertsSection — empty (no alerts)', () => {
  it('renders the celebratory guidance and no breakdown when alertTotal is 0', () => {
    renderSection({ metrics: makeMetrics({ alertTotal: 0 }), alertPieData: [] });

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('No alerts this week — everything looks great!');
    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.queryByText('Alert Distribution')).toBeNull();
  });
});

// ── 6. Data — severity breakdown ─────────────────────────────────────────────

describe('AlertsSection — populated breakdown', () => {
  it('renders a labelled list with one listitem per severity bucket', () => {
    renderSection();

    const list = screen.getByRole('list', { name: 'Alerts by Severity' });
    expect(list).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    // Both column captions render (proving we're in the data branch).
    expect(screen.getByText('Alerts by Severity')).toBeInTheDocument();
    expect(screen.getByText('Alert Distribution')).toBeInTheDocument();
  });

  it('shows each bucket label with its fmtInt count badge', () => {
    renderSection();

    expect(within(severityRow('critical')).getByText('3')).toBeInTheDocument();
    expect(within(severityRow('warning')).getByText('2')).toBeInTheDocument();
    expect(within(severityRow('info')).getByText('1')).toBeInTheDocument();
  });

  it('maps each severity to its icon colour and Badge variant', () => {
    renderSection();

    // Icon colour comes from SEVERITY_ICON_CLASS.
    expect(severityRow('critical').querySelector('svg')?.getAttribute('class')).toContain(
      'text-rose-300',
    );
    expect(severityRow('warning').querySelector('svg')?.getAttribute('class')).toContain(
      'text-amber-300',
    );
    expect(severityRow('info').querySelector('svg')?.getAttribute('class')).toContain(
      'text-sky-300',
    );

    // Badge variant → danger/warning/info class families.
    expect(within(severityRow('critical')).getByText('3').className).toContain('bg-red-100');
    expect(within(severityRow('warning')).getByText('2').className).toContain('bg-yellow-100');
    expect(within(severityRow('info')).getByText('1').className).toContain('bg-blue-100');
  });

  it('falls back to the Info icon colour and info Badge for an unknown severity', () => {
    renderSection({
      metrics: makeMetrics({ alertTotal: 4, alertsByType: { mystery: 4 } }),
      alertPieData: [{ name: 'Mystery', value: 4, color: '#3b82f6' }],
    });

    const row = severityRow('mystery');
    // `SEVERITY_ICON_CLASS[severity] ?? 'text-sky-300'`
    expect(row.querySelector('svg')?.getAttribute('class')).toContain('text-sky-300');
    // `SEVERITY_BADGE[severity] ?? 'info'`
    expect(within(row).getByText('4').className).toContain('bg-blue-100');
  });

  it('keeps the source severity string in the DOM (capitalisation is CSS-only)', () => {
    renderSection();
    // The visual capitalise is a Tailwind class; the text node stays lowercase.
    expect(screen.getByText('critical')).toBeInTheDocument();
    expect(screen.queryByText('Critical')).toBeNull();
  });
});

// ── 7 + 8. Pie region hardening ──────────────────────────────────────────────

describe('AlertsSection — distribution pie region', () => {
  it('renders the pie as a labelled image region when breakdown data exists', () => {
    renderSection();

    expect(
      screen.getByRole('img', { name: 'Pie chart of alerts by severity' }),
    ).toBeInTheDocument();
    // No placeholder while real data is present.
    expect(screen.queryByText('No severity breakdown to chart.')).toBeNull();
  });

  it('shows a placeholder instead of a blank chart when the breakdown is empty', () => {
    // Alerts exist (total 3) but the pie payload is empty — the hardened
    // `pieData.length > 0` guard must render guidance, not an empty panel.
    renderSection({
      metrics: makeMetrics({ alertTotal: 3, alertsByType: { critical: 3 } }),
      alertPieData: [],
    });

    expect(screen.getByText('No severity breakdown to chart.')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: /pie chart/i })).toBeNull();
    // The severity list still renders alongside the placeholder.
    expect(screen.getByRole('list', { name: 'Alerts by Severity' })).toBeInTheDocument();
  });
});

// ── 9. Null-safety ───────────────────────────────────────────────────────────

describe('AlertsSection — null-safety hardening', () => {
  it('coalesces an undefined alertsByType to {} without crashing', () => {
    renderSection({
      metrics: makeMetrics({
        alertTotal: 5,
        alertsByType: undefined as unknown as Record<string, number>,
      }),
    });

    // Data branch is reached (total > 0) but the list has zero rows.
    const list = screen.getByRole('list', { name: 'Alerts by Severity' });
    expect(within(list).queryAllByRole('listitem')).toHaveLength(0);
  });

  it('coalesces an undefined alertPieData to [] and shows the pie placeholder', () => {
    renderSection({
      metrics: makeMetrics({ alertTotal: 2, alertsByType: { warning: 2 } }),
      alertPieData: undefined as unknown as AlertPieEntry[],
    });

    expect(screen.getByText('No severity breakdown to chart.')).toBeInTheDocument();
    expect(within(severityRow('warning')).getByText('2')).toBeInTheDocument();
  });

  it('formats a non-number count as "0" rather than throwing in fmtInt', () => {
    renderSection({
      metrics: makeMetrics({
        alertTotal: 1,
        alertsByType: { glitch: undefined as unknown as number },
      }),
      alertPieData: [{ name: 'Glitch', value: 1, color: '#3b82f6' }],
    });

    expect(within(severityRow('glitch')).getByText('0')).toBeInTheDocument();
  });
});
