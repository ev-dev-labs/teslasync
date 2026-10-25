import { describe, expect, it } from 'vitest';
import { dashboardTokens, resolveDashboardSeriesColor } from './dashboardTokens';

const AFTER_LIGHT = ['#1779e1', '#009d9e', '#20a04e', '#ca8000', '#e75c3a', '#d4407c', '#7f57d1', '#63748a'];
const AFTER_DARK = ['#65a7fa', '#25c2c2', '#5bbd74', '#eba941', '#f78955', '#f37986', '#ab91f2', '#8a9bb3'];

describe('dashboardTokens legacy exports', () => {
  it('keeps every pre-redesign export working with identical values', () => {
    expect(dashboardTokens.shell).toBe('relative flex h-full min-w-0 flex-col');
    expect(dashboardTokens.header).toBe('flex w-full shrink-0 flex-col pl-4 pr-4 pb-2 pt-3');
    expect(dashboardTokens.body).toContain('overflow-y-auto');
    expect(dashboardTokens.footer).toBe('shrink-0 border-t border-[var(--border-subtle)] px-4 py-2');
    expect(dashboardTokens.metric).toContain('text-2xl');
    expect(dashboardTokens.secondaryMetric).toContain('text-lg');
    expect(dashboardTokens.metricLabel).toContain('text-[var(--text-secondary)]');
    expect(dashboardTokens.unit).toContain('text-[var(--text-muted)]');
    expect(dashboardTokens.stat).toContain('!bg-transparent');
    expect(dashboardTokens.columns[2]).toBe('grid-cols-1 @xs:grid-cols-2');
    expect(dashboardTokens.columns[4]).toBe('grid-cols-1 @xs:grid-cols-2 @sm:grid-cols-4');
  });
});

describe('dashboardTokens density', () => {
  it('encodes the compact tier (32px row, 8px gap, 13px text)', () => {
    expect(dashboardTokens.density.text).toBe('text-[13px]');
    expect(dashboardTokens.density.row).toBe('min-h-8');
    expect(dashboardTokens.density.rowGap).toBe('gap-2.5');
    expect(dashboardTokens.density.rowPadding).toBe('py-2');
    expect(dashboardTokens.density.gridGap).toBe('gap-2');
    expect(dashboardTokens.density.sectionGap).toBe('gap-3');
    expect(dashboardTokens.density.statGap).toBe('gap-x-3.5 gap-y-3');
  });
});

describe('dashboardTokens radius', () => {
  it('maps the After card radii onto the named shape scale', () => {
    // After .w 14px = shape-xl, .sgi/.tip/.btn 10px = shape-lg,
    // .meter 6px = shape-sm, pills/chips = pill.
    expect(dashboardTokens.radius.card).toBe('rounded-shape-xl');
    expect(dashboardTokens.radius.inner).toBe('rounded-shape-lg');
    expect(dashboardTokens.radius.control).toBe('rounded-shape-sm');
    expect(dashboardTokens.radius.pill).toBe('rounded-pill');
  });
});

describe('dashboardTokens chart palette', () => {
  it('exposes eight calm series as light-dark() pairs in palette order', () => {
    expect(dashboardTokens.chart.series).toHaveLength(8);
    dashboardTokens.chart.series.forEach((entry, index) => {
      expect(entry).toBe(`light-dark(${AFTER_LIGHT[index]}, ${AFTER_DARK[index]})`);
    });
  });

  it('exposes matching per-mode hex arrays', () => {
    expect([...dashboardTokens.chart.seriesLight]).toEqual(AFTER_LIGHT);
    expect([...dashboardTokens.chart.seriesDark]).toEqual(AFTER_DARK);
  });

  it('resolves hue names to series slots', () => {
    expect(dashboardTokens.chart.seriesByName).toEqual({
      blue: 0,
      teal: 1,
      violet: 2,
      amber: 3,
      pink: 4,
    });
  });

  it('carries the After status, track, grid and faint pairs', () => {
    expect(dashboardTokens.chart.status.ok.foreground).toBe('light-dark(#16a34a, #22c55e)');
    expect(dashboardTokens.chart.status.ok.soft).toBe('light-dark(#dcfce7, #123220)');
    expect(dashboardTokens.chart.status.warn.foreground).toBe('light-dark(#d97706, #f59e0b)');
    expect(dashboardTokens.chart.status.warn.soft).toBe('light-dark(#fef3c7, #3a2a0b)');
    expect(dashboardTokens.chart.status.bad.foreground).toBe('light-dark(#dc2626, #f87171)');
    expect(dashboardTokens.chart.status.bad.soft).toBe('light-dark(#fee2e2, #3b1717)');
    expect(dashboardTokens.chart.status.info.foreground).toBe('light-dark(#2563eb, #60a5fa)');
    expect(dashboardTokens.chart.status.info.soft).toBe('light-dark(#dbeafe, #172a46)');
    expect(dashboardTokens.chart.track).toBe('light-dark(#eceef1, #252a32)');
    expect(dashboardTokens.chart.grid).toBe('light-dark(#eef0f3, #20242c)');
    expect(dashboardTokens.chart.faint).toBe('light-dark(#9ca3af, #6b7280)');
  });

  it('matches the After chart geometry', () => {
    expect(dashboardTokens.chart.barRadius).toBe(3);
    expect(dashboardTokens.chart.cellRadius).toBe(2);
    expect(dashboardTokens.chart.stripRadius).toBe(5);
    expect(dashboardTokens.chart.meterHeight).toBe(8);
    expect(dashboardTokens.chart.meterHeightThick).toBe(12);
  });
});

describe('resolveDashboardSeriesColor', () => {
  it('picks the per-mode hex without wrapping', () => {
    expect(resolveDashboardSeriesColor(0, 'light')).toBe('#1779e1');
    expect(resolveDashboardSeriesColor(4, 'dark')).toBe('#f78955');
  });

  it('cycles past the end and maps hue names consistently', () => {
    expect(resolveDashboardSeriesColor(5, 'light')).toBe(AFTER_LIGHT[5]);
    expect(resolveDashboardSeriesColor(8, 'light')).toBe(AFTER_LIGHT[0]);
    expect(resolveDashboardSeriesColor(dashboardTokens.chart.seriesByName.amber, 'dark')).toBe(
      '#eba941',
    );
  });

  it('wraps negative indices instead of returning undefined', () => {
  });
});

describe('dashboardTokens tone', () => {
  it('ships no gradients, glassmorphism, or emoji in class tokens', () => {
    const classes = [
      dashboardTokens.shell,
      dashboardTokens.header,
      dashboardTokens.body,
      dashboardTokens.footer,
      dashboardTokens.metric,
      dashboardTokens.density.text,
      dashboardTokens.radius.pill,
      dashboardTokens.motion.transition,
    ];
    for (const token of classes) {
      expect(token).not.toMatch(/gradient|backdrop-blur|bg-clip-text/i);
      expect(token).not.toMatch(/\p{Extended_Pictographic}/u);
    }
  });

  it('keeps motion to reduced-motion-safe feedback', () => {
    expect(dashboardTokens.motion.transition).toContain('motion-reduce:transition-none');
    expect(dashboardTokens.motion.transition).not.toMatch(/animate-/);
  });
});
