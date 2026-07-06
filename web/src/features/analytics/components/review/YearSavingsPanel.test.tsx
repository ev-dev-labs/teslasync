/**
 * YearSavingsPanel — behaviour + hardening contract.
 *
 * The panel turns a Year-in-Review payload into the "money saved by driving
 * electric" story: a headline savings figure, a two-bar gas-vs-electric cost
 * comparison, and a playful "cups of coffee" note. These tests pin the derived
 * arithmetic and the null-safety hardening this file carries:
 *   - savings + charging cost are read through `safeNumber`, so a partial
 *     payload with null / NaN / Infinity degrades to 0 instead of leaking
 *     "NaN" into the headline, the bars, or the coffee note;
 *   - the two MetricBars share a single, strictly-positive `barMax` — an
 *     all-zero payload falls back to 1 so MetricBar's `value / max` can never
 *     divide by zero;
 *   - REAL BUG FIXED — the coffee count is now clamped to a non-negative,
 *     finite integer (`Math.max(0, round(savings / 5))`). A break-even or
 *     negative-savings year reads "0 cups of coffee!" rather than the
 *     nonsensical "-20 cups of coffee!" the previous `Math.round` produced;
 *   - a11y — every glyph is decorative (`aria-hidden`), so nothing leaks into
 *     the a11y tree as an unlabelled image.
 *
 * `react-i18next` is mocked to echo the English fallback and interpolate the
 * `{{cupsOfCoffee}}` count (mirrors the sibling HeroGauges convention).
 * `@/hooks/useFormatting` is mocked to a deterministic `$`-symbol +
 * `formatCurrency` spy so the exact value passed to the bar sublabels can be
 * asserted. The animated / bar children are stubbed to surface their props
 * (the panel's real job is computing those props), while the header, caption,
 * coffee note and icons render for real.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';

import { YearSavingsPanel } from './YearSavingsPanel';
import type { YearReview } from '@/api/types';

// `vi.mock` factories are hoisted above the imports, so anything they reference
// must be created with `vi.hoisted`.
const h = vi.hoisted(() => {
  const translate = (key: string, opts?: unknown): string => {
    if (typeof opts === 'string') return opts;
    if (opts && typeof opts === 'object') {
      const o = opts as Record<string, unknown>;
      if (typeof o.defaultValue === 'string') {
        return o.defaultValue.replace(/\{\{(\w+)\}\}/g, (_full: string, name: string) =>
          name in o ? String(o[name]) : `{{${name}}}`,
        );
      }
    }
    return key;
  };
  return {
    translate,
    formatCurrency: vi.fn((amount: number, decimals = 2) => `$${amount.toFixed(decimals)}`),
  };
});

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: h.translate,
    i18n: { language: 'en', changeLanguage: vi.fn() },
  }),
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ formatCurrency: h.formatCurrency, currencySymbol: '$' }),
}));

// Stub the animated / bar children so their computed props are observable.
// The panel's contract is the arithmetic feeding these props; the animation
// internals (requestAnimationFrame / framer-motion) are irrelevant here and
// non-deterministic under jsdom.
vi.mock('@/components/data-display', () => ({
  AnimatedNumber: ({ value, prefix, suffix }: { value: number; prefix?: string; suffix?: string }) => (
    <span data-testid="animated-number" data-value={String(value)}>
      {`${prefix ?? ''}${value}${suffix ?? ''}`}
    </span>
  ),
  MetricBar: ({
    value,
    max,
    color,
    label,
    sublabel,
  }: {
    value: number;
    max: number;
    color: string;
    label: string;
    sublabel?: string;
  }) => (
    <div data-testid="metric-bar" data-value={String(value)} data-max={String(max)} data-color={color}>
      <span data-testid="metric-bar-label">{label}</span>
      <span data-testid="metric-bar-sublabel">{sublabel}</span>
    </div>
  ),
}));

/**
 * Build a YearReview. Overrides are loosely typed so tests can inject the
 * null / NaN that the non-null API type forbids at compile time but a partial
 * payload produces at runtime. The panel only reads these two fields.
 */
function makeReview(overrides: Record<string, unknown> = {}): YearReview {
  return {
    gas_savings: 1200,
    total_charging_cost: 300,
    ...overrides,
  } as unknown as YearReview;
}

function renderPanel(data: YearReview) {
  return render(<YearSavingsPanel data={data} />);
}

beforeEach(() => {
  h.formatCurrency.mockClear();
});

describe('YearSavingsPanel', () => {
  describe('populated payload (happy path)', () => {
    it('renders the header, the animated savings figure and the vs-gas caption', () => {
      renderPanel(makeReview({ gas_savings: 1200, total_charging_cost: 300 }));

      expect(screen.getByText('You saved')).toBeInTheDocument();

      const savings = screen.getByTestId('animated-number');
      expect(savings).toHaveAttribute('data-value', '1200');
      expect(savings).toHaveTextContent('$1200');

      expect(screen.getByText('vs. driving a gas car')).toBeInTheDocument();
    });

    it('wires the gas + electric bars with the summed max and the brand colours', () => {
      renderPanel(makeReview({ gas_savings: 1200, total_charging_cost: 300 }));

      const bars = screen.getAllByTestId('metric-bar');
      expect(bars).toHaveLength(2);

      const [gas, electric] = bars;
      // gasEquiv = savings + electric = 1500; both bars share barMax = 1500.
      expect(gas).toHaveAttribute('data-value', '1500');
      expect(gas).toHaveAttribute('data-max', '1500');
      expect(gas).toHaveAttribute('data-color', '#fb7185');
      expect(within(gas).getByText('Gas would cost')).toBeInTheDocument();

      expect(electric).toHaveAttribute('data-value', '300');
      expect(electric).toHaveAttribute('data-max', '1500');
      expect(electric).toHaveAttribute('data-color', '#34d399');
      expect(within(electric).getByText('Electric cost')).toBeInTheDocument();
    });

    it('formats each bar sublabel through formatCurrency at zero decimals', () => {
      renderPanel(makeReview({ gas_savings: 1200, total_charging_cost: 300 }));

      expect(h.formatCurrency).toHaveBeenCalledWith(1500, 0);
      expect(h.formatCurrency).toHaveBeenCalledWith(300, 0);

      const [gas, electric] = screen.getAllByTestId('metric-bar');
      expect(within(gas).getByTestId('metric-bar-sublabel')).toHaveTextContent('$1500');
      expect(within(electric).getByTestId('metric-bar-sublabel')).toHaveTextContent('$300');
    });

    it('interpolates the coffee note from the savings ($5 per cup)', () => {
      renderPanel(makeReview({ gas_savings: 1200 }));
      // 1200 / 5 = 240 cups.
      expect(screen.getByText("That's 240 cups of coffee!")).toBeInTheDocument();
    });
  });

  describe('coffee-note guard (real bug fixed)', () => {
    it('clamps a negative saving to "0 cups" instead of a negative count', () => {
      renderPanel(makeReview({ gas_savings: -100, total_charging_cost: 50 }));

      expect(screen.getByText("That's 0 cups of coffee!")).toBeInTheDocument();
      // The pre-fix Math.round(-100 / 5) would have rendered "-20".
      expect(screen.queryByText("That's -20 cups of coffee!")).not.toBeInTheDocument();
    });

    it('rounds a fractional cup count to the nearest whole cup', () => {
      // 12 / 5 = 2.4 → rounds to 2.
      renderPanel(makeReview({ gas_savings: 12 }));
      expect(screen.getByText("That's 2 cups of coffee!")).toBeInTheDocument();
    });
  });

  describe('null / NaN hardening (partial payload)', () => {
    it('degrades null savings + cost to $0, a positive bar max and "0 cups", never NaN', () => {
      const { container } = renderPanel(
        makeReview({ gas_savings: null, total_charging_cost: null }),
      );

      const savings = screen.getByTestId('animated-number');
      expect(savings).toHaveAttribute('data-value', '0');
      expect(savings).toHaveTextContent('$0');

      // gasEquiv = 0, so barMax falls back to 1 — MetricBar never divides by 0.
      const [gas, electric] = screen.getAllByTestId('metric-bar');
      expect(gas).toHaveAttribute('data-value', '0');
      expect(gas).toHaveAttribute('data-max', '1');
      expect(electric).toHaveAttribute('data-max', '1');

      expect(screen.getByText("That's 0 cups of coffee!")).toBeInTheDocument();
      expect(container.textContent).not.toContain('NaN');
    });

    it('sanitises a NaN saving to 0 rather than propagating "NaN" into the UI', () => {
      const { container } = renderPanel(
        makeReview({ gas_savings: Number.NaN, total_charging_cost: Number.NaN }),
      );

      expect(screen.getByTestId('animated-number')).toHaveAttribute('data-value', '0');
      expect(h.formatCurrency).toHaveBeenCalledWith(0, 0);
      expect(container.textContent).not.toContain('NaN');
    });
  });

  describe('zero-savings boundary', () => {
    it('treats a break-even year (no saving, some charging) as "0 cups" with a real bar max', () => {
      renderPanel(makeReview({ gas_savings: 0, total_charging_cost: 200 }));

      const [gas, electric] = screen.getAllByTestId('metric-bar');
      // gasEquiv = 0 + 200 = 200 (> 0) → barMax = 200, not the fallback 1.
      expect(gas).toHaveAttribute('data-value', '200');
      expect(gas).toHaveAttribute('data-max', '200');
      expect(electric).toHaveAttribute('data-value', '200');
      expect(screen.getByText("That's 0 cups of coffee!")).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('marks every decorative glyph aria-hidden and exposes no unlabelled image', () => {
      const { container } = renderPanel(makeReview());

      const svgs = Array.from(container.querySelectorAll('svg'));
      expect(svgs.length).toBeGreaterThan(0);
      for (const svg of svgs) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });
  });
});
