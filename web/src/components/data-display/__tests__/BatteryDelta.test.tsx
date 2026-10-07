import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BatteryDelta } from '../BatteryDelta';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback: string | undefined, opts?: Record<string, unknown>) => {
      const tpl = fallback ?? '';
      if (!opts) return tpl;
      return Object.entries(opts).reduce(
        (acc, [k, v]) => acc.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), String(v)),
        tpl,
      );
    },
  }),
}));

describe('BatteryDelta', () => {
  it('renders compact negative delta in amber', () => {
    render(<BatteryDelta startPct={79} endPct={78} testId="bd" />);
    expect(screen.getByTestId('bd')).toHaveTextContent('−1%');
    expect(screen.getByTestId('bd').querySelector('.text-amber-300')).not.toBeNull();
  });

  it('renders compact positive delta in emerald with + sign', () => {
    render(<BatteryDelta startPct={20} endPct={80} testId="bd" />);
    expect(screen.getByTestId('bd')).toHaveTextContent('+60%');
    expect(screen.getByTestId('bd').querySelector('.text-emerald-300')).not.toBeNull();
  });

  it('renders dash when start equals end', () => {
    render(<BatteryDelta startPct={50} endPct={50} testId="bd" />);
    expect(screen.getByTestId('bd')).toHaveTextContent('—');
  });

  it.each([
    [null, 50],
    [50, null],
    [null, null],
    [undefined, undefined],
    [NaN, 50],
    [50, NaN],
  ])('renders dash for missing/invalid input (%p, %p)', (start, end) => {
    render(<BatteryDelta startPct={start as number | null} endPct={end as number | null} testId="bd" />);
    expect(screen.getByTestId('bd')).toHaveTextContent('—');
  });

  it('renders pair variant ("79% → 78%")', () => {
    render(<BatteryDelta startPct={79} endPct={78} variant="pair" testId="bd" />);
    expect(screen.getByTestId('bd')).toHaveTextContent('79% → 78%');
  });

  it('hides icon when showIcon is false', () => {
    const { container } = render(
      <BatteryDelta startPct={20} endPct={80} showIcon={false} testId="bd" />,
    );
    // lucide renders an svg; with showIcon=false the badge should have none
    expect(container.querySelector('svg')).toBeNull();
  });

  it('exposes accessible label with start/end percentages', () => {
    render(<BatteryDelta startPct={79} endPct={78} testId="bd" />);
    expect(screen.getByLabelText(/79.*78/)).toBeInTheDocument();
  });

  it('uses an "unknown" aria-label when data is missing', () => {
    render(<BatteryDelta startPct={null} endPct={null} testId="bd" />);
    expect(screen.getByLabelText(/unknown/i)).toBeInTheDocument();
  });
});
