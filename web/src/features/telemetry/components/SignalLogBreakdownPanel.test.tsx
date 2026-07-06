/**
 * SignalLogBreakdownPanel — behavioural + hardening tests.
 *
 * Covers the module's export (the component + its props type) across every
 * branch:
 *   - loading skeletons (which take precedence over the queried/data state)
 *   - not-yet-queried empty state vs the queried-but-zero-rows empty state.
 *     These now render DISTINCT copy — pre-hardening the panel showed the
 *     same "run a query" message after a query returned nothing, which is
 *     the bug fixed here (the user had already queried).
 *   - populated: proportional MetricBars with "count · percent" sublabels
 *     plus the earliest/latest timestamp rows (incl. rounding + null fallback)
 *   - null-safety: an undefined summary must not throw
 *   - className passthrough
 *
 * `react-i18next` is stubbed with a `t` that returns its default string so
 * copy assertions stay stable. `useDateFormat` is stubbed to a deterministic
 * formatter so timestamp assertions don't depend on the runner's locale/tz.
 */

import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// i18n stub — our component only uses `t(key, 'Default')`, so returning the
// default keeps rendered copy identical to the English fallback.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, def?: unknown) => (typeof def === 'string' ? def : key),
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

// Deterministic date formatter — decouples the timestamp rows from the
// runner's locale/timezone so `dt:<iso>` assertions are stable.
vi.mock('@/hooks/useDateFormat', () => ({
  useDateFormat: () => ({
    formatDateTime: (v: string | Date | null | undefined) => (v ? `dt:${String(v)}` : '\u2014'),
  }),
}));

import {
  SignalLogBreakdownPanel,
  type SignalLogBreakdownPanelProps,
} from './SignalLogBreakdownPanel';
import type { SignalLogSummary } from './signalLogSummary';

// ── fixtures ─────────────────────────────────────────────────────────────
const POPULATED: SignalLogSummary = {
  totalRecords: 100,
  signalsSelected: 3,
  distinctSignals: 3,
  numericPoints: 60,
  textPoints: 30,
  boolPoints: 10,
  earliest: '2024-01-01T00:00:00.000Z',
  latest: '2024-01-02T12:30:00.000Z',
};

const EMPTY: SignalLogSummary = {
  totalRecords: 0,
  signalsSelected: 0,
  distinctSignals: 0,
  numericPoints: 0,
  textPoints: 0,
  boolPoints: 0,
  earliest: null,
  latest: null,
};

const EM_DASH = '\u2014';

function renderPanel(props?: Partial<SignalLogBreakdownPanelProps>) {
  const merged: SignalLogBreakdownPanelProps = {
    summary: POPULATED,
    hasQueried: true,
    ...props,
  };
  return render(<SignalLogBreakdownPanel {...merged} />);
}

// The earliest/latest values live in the <dd> beside their labelled <dt>.
function ddFor(label: string): string {
  const dt = screen.getByText(label);
  const dd = dt.closest('div')?.querySelector('dd');
  return dd?.textContent?.trim() ?? '';
}

afterEach(() => {
  vi.clearAllMocks();
});

// ── loading ──────────────────────────────────────────────────────────────
describe('SignalLogBreakdownPanel — loading', () => {
  it('renders three skeletons and no bars/empty copy while loading', () => {
    const { container } = renderPanel({ loading: true });
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(3);
    expect(screen.queryByText('Numeric')).toBeNull();
    expect(screen.queryByText('Run a query to see the value-type breakdown.')).toBeNull();
  });

  it('prioritises the loading state even after a query has resolved with data', () => {
    renderPanel({ loading: true, hasQueried: true, summary: POPULATED });
    // No bar sublabels while loading.
    expect(screen.queryByText(/60 \u00b7 60%/)).toBeNull();
    // The panel title always renders regardless of state.
    expect(screen.getByRole('heading', { name: /Value Composition/ })).toBeInTheDocument();
  });
});

// ── empty states (the bug fix) ───────────────────────────────────────────
describe('SignalLogBreakdownPanel — empty states', () => {
  it('prompts to run a query before the first query has been issued', () => {
    renderPanel({ hasQueried: false, summary: EMPTY });
    expect(
      screen.getByText('Run a query to see the value-type breakdown.'),
    ).toBeInTheDocument();
    // The status role comes from the shared EmptyState.
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('Numeric')).toBeNull();
  });

  it('shows DISTINCT "no records" copy after a query returns zero rows', () => {
    // Pre-hardening this branch reused the "run a query" copy — misleading
    // because the user *had* queried. The two states must now differ.
    renderPanel({ hasQueried: true, summary: EMPTY });
    expect(screen.getByText('No records in the selected range.')).toBeInTheDocument();
    expect(
      screen.queryByText('Run a query to see the value-type breakdown.'),
    ).toBeNull();
  });
});

// ── populated ────────────────────────────────────────────────────────────
describe('SignalLogBreakdownPanel — populated', () => {
  it('renders a labelled bar for each value type', () => {
    renderPanel();
    expect(screen.getByText('Numeric')).toBeInTheDocument();
    expect(screen.getByText('Text')).toBeInTheDocument();
    expect(screen.getByText('Boolean')).toBeInTheDocument();
  });

  it('formats each bar sublabel as "count · percent" of the total', () => {
    renderPanel();
    expect(screen.getByText(/60 \u00b7 60%/)).toBeInTheDocument();
    expect(screen.getByText(/30 \u00b7 30%/)).toBeInTheDocument();
    expect(screen.getByText(/10 \u00b7 10%/)).toBeInTheDocument();
  });

  it('rounds fractional percentages to whole numbers', () => {
    renderPanel({
      summary: { ...EMPTY, totalRecords: 3, numericPoints: 1, textPoints: 1, boolPoints: 1 },
    });
    // 1/3 → 33.33% → "33%" at 0 decimals, for all three bars.
    expect(screen.getAllByText(/1 \u00b7 33%/)).toHaveLength(3);
  });

  it('renders the earliest and latest timestamps through the formatter', () => {
    renderPanel();
    expect(ddFor('Earliest')).toBe('dt:2024-01-01T00:00:00.000Z');
    expect(ddFor('Latest')).toBe('dt:2024-01-02T12:30:00.000Z');
  });

  it('falls back to an em-dash when a timestamp is null', () => {
    renderPanel({ summary: { ...POPULATED, earliest: null, latest: null } });
    expect(ddFor('Earliest')).toBe(EM_DASH);
    expect(ddFor('Latest')).toBe(EM_DASH);
  });
});

// ── hardening ────────────────────────────────────────────────────────────
describe('SignalLogBreakdownPanel — hardening', () => {
  it('does not throw and shows the no-records state when summary is undefined', () => {
    // The page may thread `data?.summary` through before its query resolves.
    expect(() =>
      renderPanel({ summary: undefined as unknown as SignalLogSummary, hasQueried: true }),
    ).not.toThrow();
    expect(screen.getByText('No records in the selected range.')).toBeInTheDocument();
  });

  it('applies an extra className to the panel surface', () => {
    const { container } = renderPanel({ className: 'breakdown-x' });
    expect(container.querySelector('.breakdown-x')).not.toBeNull();
  });

  it('exposes a props type usable by consumers', () => {
    const props: SignalLogBreakdownPanelProps = { summary: EMPTY, hasQueried: false };
    expect(props.hasQueried).toBe(false);
    expect(props.summary.totalRecords).toBe(0);
  });
});
