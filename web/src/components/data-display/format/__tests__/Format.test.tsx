import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DateTime,
  Distance,
  Speed,
  Temperature,
  Pressure,
  Energy,
  Power,
  Voltage,
  Current,
  Percentage,
  FormattedNumber,
  Duration,
} from '../';
import { useSettings } from '@/hooks/useSettings';
import { setGlobalPrecision } from '@/lib/numberFormat';

vi.mock('@/hooks/useSettings', () => ({
  useSettings: vi.fn(),
}));

const mockSettings = (overrides: Partial<ReturnType<typeof useSettings>> = {}) => {
  const base = {
    settings: {} as never,
    isMiles: false,
    isFahrenheit: false,
    isPSI: false,
    decimals: 1,
    convertDistance: (mi: number) => mi * 1.60934,
    convertSpeed: (mph: number) => mph * 1.60934,
    convertTemp: (c: number) => c,
    convertEfficiency: (whPerMi: number) => whPerMi,
    convertPressure: (bar: number) => bar,
    distanceUnit: 'km',
    speedUnit: 'km/h',
    tempUnit: '°C',
    efficiencyUnit: 'Wh/km',
    pressureUnit: 'bar',
    rangeType: 'rated' as const,
    fmtDistance: () => '',
    fmtSpeed: () => '',
    fmtTemp: () => '',
    fmtPressure: () => '',
    costPerKwh: 0.12,
    currencySymbol: '$',
    formatEnergyCost: () => '',
    formatCurrency: () => '',
    costPerDistanceUnit: () => null,
    estimateGasCost: () => null,
    ...overrides,
  };
  vi.mocked(useSettings).mockReturnValue(base as never);
};

beforeEach(() => {
  vi.mocked(useSettings).mockReset();
  // Pin global precision so unit-aware tests are deterministic across files.
  setGlobalPrecision(1);
});

describe('DateTime', () => {
  beforeEach(() => mockSettings());

  it('renders title attribute with the canonical ISO value', () => {
    const iso = '2026-04-04T14:30:00Z';
    const { container } = render(<DateTime value={iso} />);
    const span = container.querySelector('span');
    expect(span?.title).toBe(new Date(iso).toISOString());
  });

  it('renders — for null value', () => {
    const { container } = render(<DateTime value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders — for invalid date string', () => {
    const { container } = render(<DateTime value="not-a-date" />);
    expect(container.textContent).toBe('—');
  });

  it('uses formatDate for the "date" variant', () => {
    const { container } = render(<DateTime value="2026-04-04T14:30:00Z" variant="date" />);
    // Date-only format never contains a colon (no time component).
    expect(container.textContent).not.toContain(':');
  });

  it('uses formatRelativeTime for the "relative" variant', () => {
    const { container } = render(<DateTime value={new Date()} variant="relative" />);
    expect(container.textContent?.toLowerCase()).toContain('just now');
  });

  it('accepts a Date instance', () => {
    const d = new Date('2026-04-04T14:30:00Z');
    const { container } = render(<DateTime value={d} />);
    const span = container.querySelector('span');
    expect(span?.title).toBe(d.toISOString());
  });
});

describe('Distance', () => {
  it('renders metric distance from km input', () => {
    mockSettings({
      convertDistance: (mi) => mi * 1.60934,
      distanceUnit: 'km',
    });
    const { container } = render(<Distance km={100} precision={1} />);
    expect(container.textContent).toContain('100.0 km');
    expect(container.querySelector('span')?.title).toBe('100.00 km');
  });

  it('renders imperial distance from miles input', () => {
    mockSettings({
      convertDistance: (mi) => mi,
      distanceUnit: 'mi',
    });
    const { container } = render(<Distance miles={62.1371} precision={1} />);
    expect(container.textContent).toContain('62.1 mi');
    expect(container.querySelector('span')?.title).toBe('62.14 mi');
  });

  it('converts km input to miles when user prefers imperial', () => {
    mockSettings({
      convertDistance: (mi) => mi,
      distanceUnit: 'mi',
    });
    const { container } = render(<Distance km={100} precision={1} />);
    // 100 km ≈ 62.1 mi
    expect(container.textContent).toContain('62.1 mi');
  });

  it('renders — for null', () => {
    mockSettings();
    const { container } = render(<Distance miles={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders — when both inputs are nullish', () => {
    mockSettings();
    const { container } = render(<Distance />);
    expect(container.textContent).toBe('—');
  });

  it('renders — for NaN', () => {
    mockSettings();
    const { container } = render(<Distance miles={NaN} />);
    expect(container.textContent).toBe('—');
  });

  it('prefers miles when both miles and km are supplied', () => {
    mockSettings({
      convertDistance: (mi) => mi,
      distanceUnit: 'mi',
    });
    const { container } = render(<Distance miles={50} km={9999} precision={0} />);
    // miles wins; kilometres ignored.
    expect(container.textContent).toContain('50 mi');
  });
});

describe('Speed', () => {
  it('renders mph input as imperial', () => {
    mockSettings({
      convertSpeed: (mph) => mph,
      speedUnit: 'mph',
    });
    const { container } = render(<Speed mph={60} precision={0} />);
    expect(container.textContent).toContain('60 mph');
  });

  it('renders kmh input flipped through metric settings', () => {
    mockSettings({
      convertSpeed: (mph) => mph * 1.60934,
      speedUnit: 'km/h',
    });
    const { container } = render(<Speed kmh={100} precision={0} />);
    expect(container.textContent).toContain('100 km/h');
  });

  it('renders — for null', () => {
    mockSettings();
    const { container } = render(<Speed mph={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Temperature', () => {
  it('renders 20°C as 20°C in metric settings', () => {
    mockSettings({
      convertTemp: (c) => c,
      tempUnit: '°C',
    });
    const { container } = render(<Temperature c={20} precision={0} />);
    expect(container.textContent).toBe('20°C');
  });

  it('renders 20°C as 68°F in imperial settings', () => {
    mockSettings({
      convertTemp: (c) => (c * 9) / 5 + 32,
      tempUnit: '°F',
    });
    const { container } = render(<Temperature c={20} precision={0} />);
    expect(container.textContent).toBe('68°F');
  });

  it('accepts Fahrenheit input and respects user preference', () => {
    mockSettings({
      convertTemp: (c) => c,
      tempUnit: '°C',
    });
    const { container } = render(<Temperature f={68} precision={0} />);
    // 68°F → 20°C
    expect(container.textContent).toBe('20°C');
  });

  it('renders — for null', () => {
    mockSettings();
    const { container } = render(<Temperature c={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Pressure', () => {
  it('renders bar input as bar in metric settings', () => {
    mockSettings({
      convertPressure: (bar) => bar,
      pressureUnit: 'bar',
    });
    const { container } = render(<Pressure bar={2.4} precision={1} />);
    expect(container.textContent).toContain('2.4 bar');
  });

  it('converts bar to PSI when user prefers psi', () => {
    mockSettings({
      convertPressure: (bar) => bar * 14.5038,
      pressureUnit: 'psi',
    });
    const { container } = render(<Pressure bar={2.4} precision={0} />);
    // 2.4 bar ≈ 35 psi
    expect(container.textContent).toContain('35 psi');
  });

  it('accepts PSI input and converts to bar before display', () => {
    mockSettings({
      convertPressure: (bar) => bar,
      pressureUnit: 'bar',
    });
    const { container } = render(<Pressure psi={35} precision={1} />);
    // 35 psi ≈ 2.4 bar
    expect(container.textContent).toMatch(/2\.4 bar/);
  });

  it('renders — for null', () => {
    mockSettings();
    const { container } = render(<Pressure bar={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Energy', () => {
  it('renders kWh for values >= 1', () => {
    const { container } = render(<Energy kwh={42.5} precision={2} />);
    expect(container.textContent).toContain('42.50 kWh');
  });

  it('auto-picks Wh for sub-kWh values', () => {
    const { container } = render(<Energy kwh={0.25} precision={0} />);
    expect(container.textContent).toContain('250 Wh');
  });

  it('respects forced unit override', () => {
    const { container } = render(<Energy kwh={0.25} unit="kWh" precision={2} />);
    expect(container.textContent).toContain('0.25 kWh');
  });

  it('accepts Wh input', () => {
    const { container } = render(<Energy wh={2500} precision={1} />);
    expect(container.textContent).toContain('2.5 kWh');
  });

  it('renders — for null', () => {
    const { container } = render(<Energy kwh={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Power', () => {
  it('renders kW for values >= 1', () => {
    const { container } = render(<Power kw={11} precision={1} />);
    expect(container.textContent).toContain('11.0 kW');
  });

  it('auto-picks W for sub-kW values', () => {
    const { container } = render(<Power kw={0.5} precision={0} />);
    expect(container.textContent).toContain('500 W');
  });

  it('renders — for null', () => {
    const { container } = render(<Power kw={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Voltage', () => {
  it('renders volts with unit', () => {
    const { container } = render(<Voltage volts={400.5} precision={1} />);
    expect(container.textContent).toContain('400.5 V');
  });

  it('renders — for null', () => {
    const { container } = render(<Voltage volts={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Current', () => {
  it('renders amps with unit', () => {
    const { container } = render(<Current amps={32.5} precision={1} />);
    expect(container.textContent).toContain('32.5 A');
  });

  it('renders — for null', () => {
    const { container } = render(<Current amps={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Percentage', () => {
  it('renders a percent value', () => {
    const { container } = render(<Percentage value={85} precision={0} />);
    expect(container.textContent).toBe('85%');
  });

  it('converts a 0–1 ratio to percent', () => {
    const { container } = render(<Percentage ratio={0.5} precision={0} />);
    expect(container.textContent).toBe('50%');
  });

  it('renders — for null', () => {
    const { container } = render(<Percentage value={null} />);
    expect(container.textContent).toBe('—');
  });
});

describe('FormattedNumber', () => {
  it('renders a locale-aware number', () => {
    const { container } = render(<FormattedNumber value={1234.5} precision={1} />);
    expect(container.textContent).toBe('1,234.5');
  });

  it('appends optional unit', () => {
    const { container } = render(<FormattedNumber value={42} precision={0} unit="kWh" />);
    expect(container.textContent).toBe('42 kWh');
  });

  it('renders — for null', () => {
    const { container } = render(<FormattedNumber value={null} />);
    expect(container.textContent).toBe('—');
  });

  it('renders — for non-finite numbers', () => {
    const { container } = render(<FormattedNumber value={Infinity} />);
    expect(container.textContent).toBe('—');
  });
});

describe('Duration', () => {
  it('formats short milliseconds', () => {
    const { container } = render(<Duration ms={250} />);
    expect(container.textContent).toBe('250ms');
  });

  it('formats long durations', () => {
    const { container } = render(<Duration ms={65_000} variant="long" />);
    expect(container.textContent).toBe('1m 5s');
  });

  it('formats compact durations into minutes', () => {
    const { container } = render(<Duration ms={120_000} variant="compact" />);
    expect(container.textContent).toBe('2.0m');
  });

  it('formats clock durations', () => {
    const { container } = render(<Duration ms={187_000} variant="clock" />);
    expect(container.textContent).toBe('3:07');
  });

  it('renders — for null', () => {
    const { container } = render(<Duration ms={null} />);
    expect(container.textContent).toBe('—');
  });

  it('exposes raw ms via title', () => {
    const { container } = render(<Duration ms={1500} />);
    expect(container.querySelector('span')?.title).toBe('1500 ms');
  });
});
