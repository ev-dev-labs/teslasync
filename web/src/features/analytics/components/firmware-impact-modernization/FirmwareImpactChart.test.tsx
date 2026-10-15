import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { chartTokens } from '@/lib/tokens';
import { FirmwareImpactChart, type FirmwareImpactChartRow } from './FirmwareImpactChart';
import { firmwareImpactState } from './firmwareImpactState';

const captured = vi.hoisted(() => ({
  frame: {} as Record<string, unknown>,
  xAxis: {} as Record<string, unknown>,
  yAxis: {} as Record<string, unknown>,
  reference: {} as Record<string, unknown>,
  bar: {} as Record<string, unknown>,
  fills: [] as string[],
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (_key: string, fallback: string) => fallback }),
}));
vi.mock('@/components/charts', () => {
  const passthrough = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    ChartContainer: (props: Record<string, unknown> & { children: ReactNode }) => {
      captured.frame = props;
      return <figure>{props.children}</figure>;
    },
    ResponsiveContainer: passthrough,
    BarChart: passthrough,
    Bar: (props: Record<string, unknown> & { children: ReactNode }) => {
      captured.bar = props;
      return <div>{props.children}</div>;
    },
    Cell: ({ fill }: { fill: string }) => { captured.fills.push(fill); return null; },
    XAxis: (props: Record<string, unknown>) => { captured.xAxis = props; return null; },
    YAxis: (props: Record<string, unknown>) => { captured.yAxis = props; return null; },
    ReferenceLine: (props: Record<string, unknown>) => { captured.reference = props; return null; },
    CartesianGrid: () => null,
    Tooltip: () => null,
    ChartTooltip: () => null,
  };
});
afterEach(() => { cleanup(); captured.fills = []; });

const rows: FirmwareImpactChartRow[] = [
  { version: '2026.20', delta: -20.1, share: -11.1, p: 0.002, verdict: 'better' },
  { version: '2026.18', delta: 20.2, share: 10.8, p: null, verdict: 'worse' },
  { version: '2026.16', delta: 0.1, share: 0.1, p: 0.8, verdict: 'noChange' },
];

describe('firmware chart delegates the complete existing chart contract', () => {
  it('keeps the action-owning panel, exact table/CSV rows, axes, series and verdict colors', () => {
    const exported = rows.map(({ verdict, ...rest }) => ({ ...rest, verdict: String(verdict) }));
    const before = JSON.stringify(rows);
    render(<FirmwareImpactChart chartData={rows} exportData={exported}
      state={firmwareImpactState({ data: [] }, { data: [] })} onRetry={vi.fn()} />);
    expect(captured.frame.variant).not.toBe('embedded');
    expect(captured.frame.exportable).not.toBe(false);
    expect(captured.frame.height).toBe(340);
    expect(captured.frame.data).toBe(exported);
    expect(captured.frame.exportData).toBe(exported);
    expect((captured.frame.dataColumns as Array<{ key: string }>).map(column => column.key))
      .toEqual(['version', 'delta', 'share', 'p', 'verdict']);
    expect(captured.xAxis).toMatchObject({ dataKey: 'version', angle: -30, textAnchor: 'end', height: 56 });
    expect(captured.yAxis.unit).toBe(' Wh/km');
    expect(captured.reference.y).toBe(0);
    expect(captured.bar).toMatchObject({ dataKey: 'delta', radius: [3, 3, 0, 0] });
    expect(captured.fills).toEqual([chartTokens.series[2], chartTokens.series[5], chartTokens.series[7]]);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it('does not put a refresh failure into the chart error slot or empty retained rows', () => {
    render(<FirmwareImpactChart chartData={rows} exportData={rows}
      state={firmwareImpactState({ data: [], error: new Error('offline') }, { data: [] })}
      onRetry={vi.fn()} />);
    expect(captured.frame.error).toBeNull();
    expect(captured.frame.empty).toBe(false);
    expect(captured.frame.loading).toBe(false);
  });

  it('gives the persistent chart frame a fatal source error and the existing retry', () => {
    const failure = new Error('history unavailable');
    const retry = vi.fn();
    render(<FirmwareImpactChart chartData={[]} exportData={[]}
      state={firmwareImpactState({ error: failure }, { isPending: true })} onRetry={retry} />);
    expect(captured.frame.error).toBe(failure);
    expect(captured.frame.loading).toBe(false);
    expect(captured.frame.onRetry).toBe(retry);
  });
});
