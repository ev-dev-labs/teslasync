/**
 * DetailedStatistics — behaviour, hardening + regression cover.
 *
 * <DetailedStatistics stats enhanced /> is the six-tile "Detailed Statistics"
 * summary for the charging list: Total Sessions (an <AnimatedNumber>), Avg
 * Duration (formatDuration), Avg Power (fmtWithUnit kW), Top Charger
 * (mostCommonType name + count), Total Cost and Avg $/kWh (both real
 * <Currency>). It is a pure presentational leaf — every value comes straight
 * from the two already-computed prop objects.
 *
 * What is pinned here:
 *   • RENDER      — the level-3 heading, decorative-icon a11y (aria-hidden),
 *     and all six tile labels wired to the right prop fields.
 *   • VALUES      — 42 sessions, 95 min → "1h 35m", 48.5 kW → "48.50 kW",
 *     Supercharger ×18, $123.45 total, $0.234 /kWh (3-dp Currency).
 *   • REGRESSION  — a malformed/undefined `mostCommonType` used to throw on
 *     `mostCommonType[0]`; the panel now degrades to "—" + "(0×)".
 *   • NULL-SAFETY — entirely-undefined stats/enhanced render zeros + em-dashes
 *     with no NaN/undefined leaking into the DOM.
 *   • EDGE        — zero duration/cost, hours+minutes durations, and a negative
 *     (clock-skew) duration falling back to the em-dash.
 *
 * The real GlassPanel / AnimatedNumber / Currency render; Currency's "$" comes
 * from the global useSettings mock in test-setup. Only react-i18next is mocked
 * to the English fallback (repo convention) and requestAnimationFrame is
 * collapsed so <AnimatedNumber> settles on its final value synchronously.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import type { ReactNode } from 'react';

import { DetailedStatistics } from './DetailedStatistics';
import type { ChargingStats, EnhancedStats } from './helpers';

// English-fallback i18n with {{placeholder}} interpolation (repo convention).
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<typeof import('react-i18next')>('react-i18next');
  const interpolate = (tpl: string, vars?: Record<string, unknown>) =>
    vars ? tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => (k in vars ? String(vars[k]) : `{{${k}}}`)) : tpl;
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, second?: unknown, third?: unknown) => {
        if (typeof second === 'string') {
          const vars = third && typeof third === 'object' ? (third as Record<string, unknown>) : undefined;
          return interpolate(second, vars);
        }
        return key;
      },
      i18n: { language: 'en', changeLanguage: vi.fn() },
    }),
    Trans: ({ children }: { children?: ReactNode }) => <>{children}</>,
  };
});

beforeEach(() => {
  // Collapse <AnimatedNumber>'s ease-out onto its final frame so the rendered
  // value is deterministic and available synchronously after render().
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    cb(1e9);
    return 1;
  });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function makeStats(overrides: Partial<ChargingStats> = {}): ChargingStats {
  return {
    totalEnergy: 900,
    totalCost: 123.45,
    totalDuration: 3990,
    avgPower: 48.5,
    avgCostPerKwh: 0.234,
    homeCount: 10,
    scCount: 18,
    dcCount: 14,
    count: 42,
    ...overrides,
  };
}

function makeEnhanced(overrides: Partial<EnhancedStats> = {}): EnhancedStats {
  return {
    avgDuration: 95,
    mostCommonType: ['Supercharger', 18],
    ...overrides,
  };
}

describe('DetailedStatistics — header + labels', () => {
  it('renders the section heading, a decorative (aria-hidden) icon, and all six tile labels', () => {
    const { container } = render(
      <DetailedStatistics stats={makeStats()} enhanced={makeEnhanced()} />,
    );

    expect(
      screen.getByRole('heading', { level: 3, name: /Detailed Statistics/ }),
    ).toBeInTheDocument();

    // The lucide icon is purely decorative → hidden from the a11y tree so it
    // never pollutes the heading's accessible name.
    const icon = container.querySelector('svg');
    expect(icon).not.toBeNull();
    expect(icon?.getAttribute('aria-hidden')).toBe('true');

    for (const label of ['Total Sessions', 'Avg Duration', 'Avg Power', 'Total Cost', 'Avg $/kWh']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    // The Top-Charger label interpolates the count outside t() → single <p>.
    expect(container.textContent).toContain('Top Charger (18×)');
  });
});

describe('DetailedStatistics — metric values', () => {
  it('wires each tile to the correct prop field and formatter', () => {
    const { container } = render(
      <DetailedStatistics stats={makeStats()} enhanced={makeEnhanced()} />,
    );

    expect(screen.getByText('42')).toBeInTheDocument(); // count via AnimatedNumber
    expect(screen.getByText('1h 35m')).toBeInTheDocument(); // 95 min → h/m
    expect(screen.getByText('48.50 kW')).toBeInTheDocument(); // avgPower @ precision 2
    expect(screen.getByText('Supercharger')).toBeInTheDocument(); // mostCommonType[0]
    expect(screen.getByText('$123.45')).toBeInTheDocument(); // totalCost Currency
    expect(screen.getByText('$0.234')).toBeInTheDocument(); // avgCostPerKwh @ 3dp

    expect(container.textContent).not.toContain('NaN');
  });
});

describe('DetailedStatistics — regression: malformed mostCommonType', () => {
  it('does not throw and shows "—" + "(0×)" when mostCommonType is undefined', () => {
    // Pre-fix, the component read `enhanced.mostCommonType[0]` directly, so an
    // undefined tuple threw a TypeError and blanked the whole panel.
    const enhanced = { avgDuration: 40, mostCommonType: undefined } as unknown as EnhancedStats;
    const renderPanel = () =>
      render(<DetailedStatistics stats={makeStats()} enhanced={enhanced} />);

    expect(renderPanel).not.toThrow(); // mounts exactly once

    expect(screen.getByText('Top Charger (0×)')).toBeInTheDocument();
    // The top-charger name tile falls back to the em-dash placeholder — the
    // only "—" in the tree because every other field is valid.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('undefined');
    expect(document.body.textContent).not.toContain('NaN');
  });
});

describe('DetailedStatistics — null safety', () => {
  it('degrades to zeros + em-dashes when both prop objects are undefined', () => {
    const renderPanel = () =>
      render(
        <DetailedStatistics
          stats={undefined as unknown as ChargingStats}
          enhanced={undefined as unknown as EnhancedStats}
        />,
      );

    expect(renderPanel).not.toThrow();

    // count → 0, avgPower → "0.00 kW", avgDuration → "0m".
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('0.00 kW')).toBeInTheDocument();
    expect(screen.getByText('0m')).toBeInTheDocument();
    // topType, totalCost and avgCostPerKwh all render the "—" fallback.
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(document.body.textContent).not.toContain('NaN');
    expect(document.body.textContent).not.toContain('undefined');
  });
});

describe('DetailedStatistics — edge cases', () => {
  it('renders zero duration/cost and a 3-dp zero $/kWh without NaN', () => {
    const { container } = render(
      <DetailedStatistics
        stats={makeStats({ avgPower: 0, totalCost: 0, avgCostPerKwh: 0 })}
        enhanced={makeEnhanced({ avgDuration: 0 })}
      />,
    );

    expect(screen.getByText('0m')).toBeInTheDocument();
    expect(screen.getByText('0.00 kW')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument(); // totalCost 0 @ default 2dp
    expect(screen.getByText('$0.000')).toBeInTheDocument(); // avgCostPerKwh 0 @ 3dp
    expect(container.textContent).not.toContain('NaN');
  });

  it('formats a multi-hour average duration as "2h 5m"', () => {
    render(<DetailedStatistics stats={makeStats()} enhanced={makeEnhanced({ avgDuration: 125 })} />);

    expect(screen.getByText('2h 5m')).toBeInTheDocument();
  });

  it('falls back to the em-dash for a negative (clock-skew) average duration', () => {
    render(<DetailedStatistics stats={makeStats()} enhanced={makeEnhanced({ avgDuration: -10 })} />);

    // formatDuration guards `minutes < 0` → "—"; every other tile is valid, so
    // the duration tile is the sole em-dash in the tree.
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByText('Supercharger')).toBeInTheDocument();
  });
});
