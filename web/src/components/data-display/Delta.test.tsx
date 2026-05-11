import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Delta } from './Delta';
import { useSettings } from '@/hooks/useSettings';
import { setGlobalPrecision, setGlobalLocale } from '@/lib/numberFormat';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

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

const baseSettings = {
  settings: {
    unit_of_length: 'mi',
    unit_of_temp: 'C',
    unit_of_pressure: 'bar',
    currency_symbol: '$',
    base_cost_per_kwh: 0.12,
    decimal_precision: 1,
    locale: 'en-US',
    preferred_range: 'rated',
  } as never,
  isMiles: true,
  isFahrenheit: false,
  isPSI: false,
  decimals: 1,
  locale: 'en-US',
  density: 'comfortable' as const,
  toDistanceDisplay: (mi: number) => mi,
  toSpeedDisplay: (mph: number) => mph,
  toTemperatureDisplay: (c: number) => c,
  toEfficiencyDisplay: (whPerMi: number) => whPerMi,
  toPressureDisplay: (bar: number) => bar,
  distanceUnit: 'mi' as const,
  speedUnit: 'mph' as const,
  tempUnit: '°C' as const,
  efficiencyUnit: 'Wh/mi' as const,
  pressureUnit: 'bar' as const,
  rangeType: 'rated' as const,
  formatDistance: () => '',
  formatSpeed: () => '',
  formatTemperature: () => '',
  formatPressure: () => '',
  costPerKwh: 0.12,
  currencySymbol: '$',
  formatEnergyCost: () => '',
  formatCurrency: () => '',
  costPerDistanceUnit: () => null,
  estimateGasCost: () => null,
};

beforeEach(() => {
  vi.mocked(useSettings).mockReset();
  vi.mocked(useSettings).mockReturnValue(baseSettings as never);
  // Pin global precision/locale for deterministic assertions.
  setGlobalPrecision(1);
  setGlobalLocale('en-US');
});

describe('Delta — colour by direction', () => {
  it('lower_better + delta>0 (cost went up) renders rose (bad)', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={10} display="absolute" />);
    expect(container.firstChild).toHaveClass('text-rose-400');
  });

  it('lower_better + delta<0 (cost went down) renders emerald (good)', () => {
    const { container } = render(<Delta metric="cost" current={8} previous={10} display="absolute" />);
    expect(container.firstChild).toHaveClass('text-emerald-400');
  });

  it('higher_better + delta>0 (range up) renders emerald (good)', () => {
    const { container } = render(<Delta metric="range" current={280} previous={250} display="absolute" />);
    expect(container.firstChild).toHaveClass('text-emerald-400');
  });

  it('higher_better + delta<0 (range down) renders rose (bad)', () => {
    const { container } = render(<Delta metric="range" current={220} previous={250} display="absolute" />);
    expect(container.firstChild).toHaveClass('text-rose-400');
  });

  it('neutral metric never renders good/bad colour', () => {
    const { container } = render(<Delta metric="distance" current={200} previous={100} display="absolute" />);
    expect(container.firstChild).not.toHaveClass('text-emerald-400');
    expect(container.firstChild).not.toHaveClass('text-rose-400');
  });

  it('zero delta renders the muted text colour', () => {
    const { container } = render(<Delta metric="cost" current={10} previous={10} display="absolute" />);
    const cls = (container.firstChild as HTMLElement).className;
    expect(cls).toContain('text-[var(--text-muted)]');
  });
});

describe('Delta — arrow', () => {
  it('renders an up arrow for positive delta', () => {
    const { container } = render(<Delta metric="range" current={280} previous={250} />);
    expect(container.querySelector('svg.lucide-arrow-up')).not.toBeNull();
  });

  it('renders a down arrow for negative delta', () => {
    const { container } = render(<Delta metric="range" current={220} previous={250} />);
    expect(container.querySelector('svg.lucide-arrow-down')).not.toBeNull();
  });

  it('renders a horizontal arrow for zero delta', () => {
    const { container } = render(<Delta metric="range" current={250} previous={250} />);
    expect(container.querySelector('svg.lucide-arrow-right')).not.toBeNull();
  });

  it('omits the arrow when hideArrow is set', () => {
    const { container } = render(<Delta metric="range" current={280} previous={250} hideArrow />);
    expect(container.querySelector('svg')).toBeNull();
  });
});

describe('Delta — value formatting', () => {
  it('renders a percent display by default and the value is unsigned', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={10} />);
    // Up 20% — encoded by the arrow, not by a "+" sign.
    expect(container.textContent).toContain('20.0%');
    expect(container.textContent).not.toContain('-');
  });

  it('renders an absolute display with the right currency prefix', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={10} display="absolute" />);
    expect(container.textContent).toContain('$2.0');
  });

  it('renders the both display with absolute then percent in parens', () => {
    const { container } = render(<Delta metric="range" current={280} previous={250} display="both" />);
    expect(container.textContent).toContain('30.0 mi');
    expect(container.textContent).toContain('(12.0%)');
  });

  it('appends the comparedTo label after the value', () => {
    const { container } = render(
      <Delta metric="cost" current={12} previous={10} comparedTo="vs last week" />,
    );
    expect(container.textContent).toContain('vs last week');
  });
});

describe('Delta — edge cases', () => {
  it('renders an em-dash when previous is null', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={null} />);
    expect(container.textContent).toContain('—');
    expect(container.querySelector('[data-testid="delta-empty"]')).not.toBeNull();
  });

  it('renders an em-dash when current is undefined', () => {
    const { container } = render(<Delta metric="cost" current={undefined} previous={10} />);
    expect(container.textContent).toContain('—');
  });

  it('renders an em-dash when previous=0 and display=percent (no Infinity%)', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={0} display="percent" />);
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('Infinity');
    expect(container.textContent).not.toContain('NaN');
  });

  it('still renders absolute change when previous=0 and display=absolute', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={0} display="absolute" />);
    expect(container.textContent).toContain('$12.0');
  });

  it('renders the loading skeleton when loading is true', () => {
    const { container } = render(<Delta metric="cost" current={12} previous={10} loading />);
    expect(container.querySelector('[data-testid="delta-skeleton"]')).not.toBeNull();
  });
});

describe('Delta — settings-aware unit suffixes', () => {
  it('uses the metric distance unit from settings', () => {
    vi.mocked(useSettings).mockReturnValue({ ...baseSettings, settings: { ...baseSettings.settings, unit_of_length: 'km' } as never } as never);
    const { container } = render(<Delta metric="range" current={280} previous={250} display="absolute" />);
    expect(container.textContent).toContain('30.0 km');
  });

  it('uses the user currency symbol', () => {
    vi.mocked(useSettings).mockReturnValue({ ...baseSettings, settings: { ...baseSettings.settings, currency_symbol: '€' } as never } as never);
    const { container } = render(<Delta metric="cost" current={12} previous={10} display="absolute" />);
    expect(container.textContent).toContain('€2.0');
  });
});

describe('Delta — inline semantic override', () => {
  it('accepts an inline {direction, unit} object', () => {
    const { container } = render(
      <Delta
        metric={{ direction: 'higher_better', unit: 'percent' }}
        current={88}
        previous={80}
        display="absolute"
      />,
    );
    expect(container.firstChild).toHaveClass('text-emerald-400');
    expect(container.textContent).toContain('8.0%');
  });
});
