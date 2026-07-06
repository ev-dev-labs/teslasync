/**
 * SignalTypeBreakdown — behaviour + hardening coverage.
 *
 * The panel is a pure presenter: it takes the three already-derived buffer
 * counts (numeric / boolean / string) and renders either a three-row
 * <MetricBar> breakdown or, when the buffer is empty, an <EmptyState>. The
 * facets worth pinning:
 *   - the EMPTY guard (`total === 0`) → the status empty state, no rows, and
 *     the header total caption suppressed;
 *   - the DATA branch → all three rows always rendered (even a zero-count
 *     type is shown, never hidden), each with a "{count} · {percent}%"
 *     sublabel, the correct color-blind-safe series color threaded per row,
 *     the render order (numeric → boolean → string), and the locale-grouped
 *     total caption;
 *   - the a11y contract → an <h3> panel heading and decorative (aria-hidden)
 *     pie-chart icons.
 *
 * Hardening facets (these drove the source fix): `?? 0` alone only guarded
 * null/undefined, so a bad upstream derive (undefined, NaN, Infinity, or a
 * negative) would slip past the empty guard and render broken bars. The
 * component now coerces every count through `Math.max(0, safeNumber(x))`, so:
 *   - undefined / null counts degrade to the empty state;
 *   - NaN / Infinity counts degrade to the empty state (never "NaN%");
 *   - a negative count is clamped to zero rather than yielding a negative
 *     percentage.
 *
 * The real shared components (GlassPanel, MetricBar, EmptyState, Typography)
 * are kept so the accessible DOM is exercised for real. No network is
 * involved — the panel takes its data purely via props. `react-i18next` is
 * stubbed to the English fallback so visible copy is asserted directly.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

// jsdom lacks matchMedia; framer-motion (via <MetricBar>'s motion.div) may
// reach for it. Provide a no-op stub so rows mount without throwing.
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof window.matchMedia;
}

// i18n → English fallback with {{placeholder}} interpolation.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, arg2?: unknown, arg3?: unknown) => {
        let template = key;
        let options: Record<string, unknown> | undefined;
        if (typeof arg2 === 'string') {
          template = arg2;
          if (arg3 && typeof arg3 === 'object') options = arg3 as Record<string, unknown>;
        } else if (arg2 && typeof arg2 === 'object') {
          options = arg2 as Record<string, unknown>;
          if (typeof options.defaultValue === 'string') template = options.defaultValue;
        }
        if (options) {
          template = template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name: string) =>
            options && options[name] != null ? String(options[name]) : '',
          );
        }
        return template;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
  };
});

import { chartTokens } from '@/lib/tokens';
import { SignalTypeBreakdown, type SignalTypeBreakdownProps } from './SignalTypeBreakdown';

// ── Helpers ──────────────────────────────────────────────────────────
function renderBreakdown(props: Partial<SignalTypeBreakdownProps> = {}) {
  const merged: SignalTypeBreakdownProps = {
    numericCount: 0,
    booleanCount: 0,
    stringCount: 0,
    ...props,
  };
  return render(<SignalTypeBreakdown {...merged} />);
}

/**
 * A <MetricBar> renders `<span>{label}</span>` immediately followed by the
 * value `<span style={{color}}>{sublabel}</span>`, so the sublabel is the
 * label span's next sibling.
 */
function sublabelEl(label: string): HTMLElement {
  const el = screen.getByText(label).nextElementSibling as HTMLElement | null;
  if (!el) throw new Error(`no sublabel sibling for "${label}"`);
  return el;
}
function sublabelText(label: string): string {
  return sublabelEl(label).textContent ?? '';
}

/** The three type labels, in the order they are rendered. */
const ROW_LABELS = ['Numeric', 'Boolean', 'String'] as const;

function renderedRowOrder(container: HTMLElement): string[] {
  const list = container.querySelector('.space-y-4');
  return Array.from(list?.children ?? []).map(
    (row) => row.querySelector('span')?.textContent ?? '',
  );
}

describe('SignalTypeBreakdown', () => {
  it('renders the panel heading, a decorative icon, and forwards className', () => {
    const { container } = renderBreakdown({ numericCount: 1, className: 'xl:col-span-1' });

    // Semantic <h3> panel heading; the icon inside it is aria-hidden so the
    // accessible name is just the title text.
    expect(screen.getByRole('heading', { level: 3, name: 'Value Types' })).toBeInTheDocument();
    // In the data branch there is exactly one decorative icon (the title's).
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    // className is merged onto the panel root alongside its base padding.
    expect(container.firstChild).toHaveClass('xl:col-span-1');
    expect(container.firstChild).toHaveClass('p-4');
  });

  it('shows the status empty state (and no rows / no total) when the buffer is empty', () => {
    const { container } = renderBreakdown({ numericCount: 0, booleanCount: 0, stringCount: 0 });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No signals buffered yet')).toBeInTheDocument();
    // No breakdown rows.
    for (const label of ROW_LABELS) {
      expect(screen.queryByText(label)).not.toBeInTheDocument();
    }
    // The header total caption is suppressed when total is zero.
    expect(screen.queryByText('0')).not.toBeInTheDocument();
    // Two decorative icons in the empty branch: the title + the empty-state.
    expect(container.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(2);
  });

  it('renders all three type rows with counts, percentages, and the total caption', () => {
    renderBreakdown({ numericCount: 10, booleanCount: 6, stringCount: 4 }); // total 20

    for (const label of ROW_LABELS) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(sublabelText('Numeric')).toBe('10 · 50%');
    expect(sublabelText('Boolean')).toBe('6 · 30%');
    expect(sublabelText('String')).toBe('4 · 20%');
    // Header total caption, locale-grouped.
    expect(screen.getByText('20')).toBeInTheDocument();
    // Data branch → no empty state.
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('keeps every type row visible even when a type has zero samples', () => {
    renderBreakdown({ numericCount: 5, booleanCount: 0, stringCount: 0 }); // total 5

    // A zero-count type is still shown as a 0% row, never hidden.
    expect(sublabelText('Numeric')).toBe('5 · 100%');
    expect(sublabelText('Boolean')).toBe('0 · 0%');
    expect(sublabelText('String')).toBe('0 · 0%');
    expect(screen.getAllByText(/^(Numeric|Boolean|String)$/)).toHaveLength(3);
  });

  it('renders the rows in numeric → boolean → string order', () => {
    const { container } = renderBreakdown({ numericCount: 3, booleanCount: 2, stringCount: 1 });
    expect(renderedRowOrder(container)).toEqual(['Numeric', 'Boolean', 'String']);
  });

  it('threads the color-blind-safe series color into each row', () => {
    renderBreakdown({ numericCount: 3, booleanCount: 2, stringCount: 1 });

    expect(sublabelEl('Numeric')).toHaveStyle({ color: chartTokens.series[5] });
    expect(sublabelEl('Boolean')).toHaveStyle({ color: chartTokens.series[2] });
    expect(sublabelEl('String')).toHaveStyle({ color: chartTokens.series[1] });
  });

  it('formats the total caption with locale grouping', () => {
    renderBreakdown({ numericCount: 12000, booleanCount: 400, stringCount: 100 }); // total 12500
    expect(screen.getByText('12,500')).toBeInTheDocument();
  });

  // ── Hardening: bad upstream derives must degrade, never crash ─────────
  it('degrades to the empty state when counts are undefined instead of crashing', () => {
    renderBreakdown({
      numericCount: undefined as unknown as number,
      booleanCount: undefined as unknown as number,
      stringCount: undefined as unknown as number,
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByText('No signals buffered yet')).toBeInTheDocument();
    expect(screen.queryByText('Numeric')).not.toBeInTheDocument();
  });

  it('coerces NaN and Infinity counts to zero and shows the empty state', () => {
    renderBreakdown({
      numericCount: NaN,
      booleanCount: Infinity,
      stringCount: 0,
    });

    expect(screen.getByRole('status')).toBeInTheDocument();
    // Never leak a broken numeric string into the DOM.
    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();
    expect(screen.queryByText('Boolean')).not.toBeInTheDocument();
  });

  it('clamps a negative count to zero rather than yielding a negative percentage', () => {
    renderBreakdown({ numericCount: -5, booleanCount: 10, stringCount: 0 }); // numeric → 0, total 10

    expect(sublabelText('Numeric')).toBe('0 · 0%');
    expect(sublabelText('Boolean')).toBe('10 · 100%');
    expect(sublabelText('String')).toBe('0 · 0%');
    // The clamped-away -5 must not resurface in the total (10, not 5).
    expect(screen.getByText('10')).toBeInTheDocument();
  });
});
