import { render } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Delta } from './Delta';

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number, precision = 1) => value.toFixed(precision),
    fmtPercent: (value: number, precision = 1) => `${value.toFixed(precision)}%`,
    fmtInt: (value: number) => String(value),
  }),
}));

vi.mock('@/hooks/useFormatting', () => ({
  useFormatting: () => ({ currencySymbol: '$' }),
}));

vi.mock('@/hooks/useUnits', () => ({
  useUnits: () => ({
    unitPrefs: { distance: 'km', speed: 'km/h', temperature: 'C', pressure: 'bar' },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string, options?: Record<string, unknown>) =>
      fallback.replace(/{{(\w+)}}/g, (_, key: string) => String(options?.[key] ?? key)),
  }),
}));

describe('Delta roundoff comparison', () => {
  it.each([
    [180, 179.99999999999994],
    [0.1 + 0.2, 0.3],
    [0.3, 0.1 + 0.2],
  ])('keeps equivalent measured values %s and %s neutral', (current, previous) => {
    const { container } = render(
      <Delta metric={{ direction: 'lower_better' }} current={current} previous={previous} />,
    );
    expect(container.firstElementChild).toHaveClass('text-[var(--text-muted)]');
    expect(container.querySelector('svg')).toHaveClass('lucide-arrow-right');
    expect(container).toHaveTextContent('0.0%');
  });

  it('retains a real consumption increase and its adverse direction', () => {
    const { container } = render(
      <Delta metric={{ direction: 'lower_better' }} current={198} previous={180} />,
    );
    expect(container.firstElementChild).toHaveClass('text-rose-400');
    expect(container.querySelector('svg')).toHaveClass('lucide-arrow-up');
    expect(container).toHaveTextContent('10.0%');
  });

  it('does not erase a one-count change at large safe integer values', () => {
    const { container } = render(
      <Delta
        metric={{ direction: 'higher_better', unit: 'count' }}
        current={2_000_000_000_000_001}
        previous={2_000_000_000_000_000}
        display="absolute"
      />,
    );
    expect(container.firstElementChild).toHaveClass('text-emerald-400');
    expect(container.querySelector('svg')).toHaveClass('lucide-arrow-up');
    expect(container).toHaveTextContent('1');
  });
});
