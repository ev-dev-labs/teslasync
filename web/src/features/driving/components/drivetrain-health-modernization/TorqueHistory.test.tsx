import { getChartFontSize } from '@/lib/chartTypography';
import { cloneElement, type ComponentProps, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { deriveDataState } from '@/api/dataState';
import { chartTokens } from '@/lib/tokens';
import type { MotorChartRow } from './model';
import type { PreservedChartFrame } from './PreservedChartFrame';
import { TorqueHistory } from './TorqueHistory';

type FrameProps = ComponentProps<typeof PreservedChartFrame>;
const { frame } = vi.hoisted(() => ({ frame: vi.fn<(props: FrameProps) => void>() }));

vi.mock('@/components/motion/ambient', async importOriginal => ({
  ...await importOriginal<typeof import('@/components/motion/ambient')>(),
  prefersReducedMotion: () => true,
}));

vi.mock('@/hooks/useNumberFormatting', () => ({
  useNumberFormatting: () => ({
    fmtNumber: (value: number) => new Intl.NumberFormat('en-US', {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(value),
  }),
}));

vi.mock('recharts', async importOriginal => ({
  ...await importOriginal<typeof import('recharts')>(),
  ResponsiveContainer: ({ children }: {
    children: ReactElement<{ width: number; height: number }>;
  }) => cloneElement(children, { width: 640, height: 280 }),
}));

vi.mock('./PreservedChartFrame', () => ({
  PreservedChartFrame: (props: FrameProps) => {
    frame(props);
    return (
      <section aria-label={props.title}>
        <h2>{props.title}</h2>
        <p>{props.subtitle}</p>
        {props.loading || props.empty ? null : props.children}
      </section>
    );
  },
}));

function row(time: string, torque: number | null): MotorChartRow {
  return { time, torque, stator: null, statorRel: null, statorRer: null, speed: null, axle: null };
}

const rows = [
  row('09:00', 0),
  row('09:05', -35),
  row('09:10', null),
  row('09:15', 1234.5),
];

function stateFor(data: MotorChartRow[] = rows) {
  return deriveDataState({ data, isSuccess: true, dataUpdatedAt: 1000 }, {
    provenance: 'historical',
    now: () => 1000,
  });
}

function frameProps(): FrameProps {
  const props = frame.mock.lastCall?.[0];
  if (!props) throw new Error('TorqueHistory did not render its chart frame');
  return props;
}

beforeEach(() => {
  frame.mockClear();
});

describe('TorqueHistory presentation preservation', () => {
  it('renders a restrained torque series with its original gradient identity and zero reference', () => {
    const { container } = render(<TorqueHistory rows={rows} state={stateFor()} loading={false} />);

    const series = container.querySelectorAll('.recharts-area-curve');
    expect(series).toHaveLength(1);
    expect(series[0]).toHaveAttribute('stroke', chartTokens.series[0]);
    expect(series[0]).toHaveAttribute('stroke-width', '2');
    expect(container.querySelector('.recharts-area-area')).toHaveAttribute('fill', 'url(#dtTorqueGrad)');
    const gradient = container.querySelector('#dtTorqueGrad');
    expect(gradient?.querySelector('stop[offset="0%"]')).toHaveAttribute('stop-color', chartTokens.series[0]);
    expect(gradient?.querySelector('stop[offset="0%"]')).toHaveAttribute('stop-opacity', '0.08');
    expect(gradient?.querySelector('stop[offset="95%"]')).toHaveAttribute('stop-opacity', '0.02');
    const reference = container.querySelector('.recharts-reference-line-line');
    expect(reference).toHaveAttribute('stroke', chartTokens.axisStroke);
    expect(reference).toHaveAttribute('stroke-dasharray', '2 2');
    const zeroTick = [...container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')]
      .find(tick => tick.textContent === '0.0');
    expect(zeroTick).toBeInTheDocument();
    expect(reference).toHaveAttribute('y1', zeroTick?.getAttribute('y') ?? '');
    expect(reference).toHaveAttribute('y2', zeroTick?.getAttribute('y') ?? '');
    expect(screen.getByText('Torque (Nm)')).toBeInTheDocument();
    expect(container.querySelector('.recharts-cartesian-grid-horizontal line')).toHaveAttribute(
      'stroke', chartTokens.gridStroke,
    );
  });

  it('uses the scalable caption role for both axes and keeps localized numeric tick formatting', () => {
    const { container } = render(<TorqueHistory rows={rows} state={stateFor()} loading={false} />);

    const xTicks = container.querySelectorAll('.recharts-xAxis .recharts-cartesian-axis-tick-value');
    const yTicks = container.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value');
    expect(xTicks.length).toBeGreaterThan(0);
    expect(yTicks.length).toBeGreaterThan(0);
    for (const tick of [...xTicks, ...yTicks]) {
      expect(tick).toHaveAttribute('font-size', String(getChartFontSize()));
      expect(tick).toHaveAttribute('fill', chartTokens.axisStroke);
      expect(tick).not.toHaveAttribute('font-size', '10');
    }
    expect(xTicks[0]).toHaveTextContent('09:00');
    for (const tick of yTicks) {
      expect(tick).toHaveTextContent(/^-?[\d,]+\.\d$/);
    }
  });

  it('keeps source torque unchanged and preserves zero negative and missing readings in table and export', () => {
    const source = rows.map(point => Object.freeze({ ...point }));
    const before = source.map(point => ({ ...point }));
    render(<TorqueHistory rows={source} state={stateFor(source)} loading={false} />);

    expect(source).toEqual(before);
    const expected = [
      { time: '09:00', torque: '0.0 Nm' },
      { time: '09:05', torque: '-35.0 Nm' },
      { time: '09:10', torque: '—' },
      { time: '09:15', torque: '1,234.5 Nm' },
    ];
    expect(frameProps().data).toEqual(expected);
    expect(frameProps().exportData).toEqual(expected);
    expect(frameProps().dataColumns).toEqual([
      { key: 'time', label: 'Time' },
      { key: 'torque', label: 'Torque (Nm)' },
    ]);
    expect(frameProps()).toMatchObject({
      height: 280,
      loading: false,
      empty: false,
      ariaLabel: 'Motor inverter torque output history area chart',
      ariaDescription: 'Torque uses the front motor reading when supplied, otherwise the rear motor reading, in newton-metres. Missing readings remain gaps, not zero.',
    });
  });

  it('retains the chart and original source trust during refresh failure and paused refresh', () => {
    const error = new Error('Refresh failed');
    const stale = deriveDataState({ data: rows, error, isError: true }, {
      provenance: 'historical',
    });
    const view = render(<TorqueHistory rows={rows} state={stale} loading />);
    expect(frameProps().state).toBe(stale);
    expect(frameProps().state.refreshError).toBe(error);
    expect(frameProps().loading).toBe(false);
    expect(view.container.querySelector('.recharts-area-curve')).toBeInTheDocument();

    const paused = deriveDataState({ data: rows, fetchStatus: 'paused' }, {
      provenance: 'historical',
    });
    view.rerender(<TorqueHistory rows={rows} state={paused} loading />);
    expect(frameProps().state).toBe(paused);
    expect(frameProps().state.isRefreshBlocked).toBe(true);
    expect(frameProps().loading).toBe(false);
    expect(view.container.querySelector('.recharts-area-curve')).toBeInTheDocument();
  });

  it('passes initial loading and fatal failure through the existing frame without inventing torque', () => {
    const initial = deriveDataState<MotorChartRow[]>({ isPending: true });
    const view = render(<TorqueHistory rows={[]} state={initial} loading />);
    expect(frameProps()).toMatchObject({ state: initial, loading: true, empty: true, data: [], exportData: [] });
    expect(screen.getByRole('heading', { name: 'Motor Torque' })).toBeInTheDocument();
    expect(view.container.querySelector('.recharts-area-curve')).not.toBeInTheDocument();

    const error = new Error('Initial history failed');
    const failed = deriveDataState<MotorChartRow[]>({ error, isError: true });
    view.rerender(<TorqueHistory rows={[]} state={failed} loading={false} />);
    expect(frameProps().state).toBe(failed);
    expect(frameProps().state.fatalError).toBe(error);
    expect(frameProps().data).toEqual([]);
    expect(frameProps().loading).toBe(false);
  });

  it.each([
    { name: 'empty history', data: [] },
    { name: 'single snapshot', data: [row('09:00', 15)] },
    { name: 'all missing readings', data: [row('09:00', null), row('09:05', null)] },
  ])('keeps the frame empty for $name', ({ data }) => {
    const view = render(<TorqueHistory rows={data} state={stateFor(data)} loading={false} />);
    expect(frameProps().empty).toBe(true);
    expect(frameProps().exportData).toEqual(frameProps().data);
    expect(screen.getByRole('heading', { name: 'Motor Torque' })).toBeInTheDocument();
    expect(view.container.querySelector('.recharts-area-curve')).not.toBeInTheDocument();
  });

  it('renders a measured zero beside a missing reading without closing the missing gap', () => {
    const data = [row('09:00', null), row('09:05', 0)];
    const view = render(<TorqueHistory rows={data} state={stateFor(data)} loading={false} />);
    expect(frameProps().empty).toBe(false);
    expect(frameProps().data).toEqual([
      { time: '09:00', torque: '—' },
      { time: '09:05', torque: '0.0 Nm' },
    ]);
    expect(view.container.querySelectorAll('.recharts-area-dot')).toHaveLength(0);
    expect(view.container.querySelector('.recharts-area-curve')).toBeInTheDocument();
    expect(data).toEqual([row('09:00', null), row('09:05', 0)]);
  });
});
