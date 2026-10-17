import { Fragment, type ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { EmbeddedChartProps } from '../../charts/EmbeddedChart';
import { Button } from '../../ui/Button';
import { CardPlacementContext } from './CardPlacementContext';
import { ChartCard, type ChartCardProps } from './ChartCard';

const { renderEmbedded } = vi.hoisted(() => ({
  renderEmbedded: vi.fn<(props: EmbeddedChartProps) => void>(),
}));

// Only the concrete chart boundary is mocked. These tests prove adapter
// forwarding and real card composition, not native chart geometry or a11y.
vi.mock('../../charts/EmbeddedChart', () => ({
  EmbeddedChart: (props: EmbeddedChartProps) => {
    renderEmbedded(props);
    return (
      <div data-testid="embedded-chart-boundary">
        {typeof props.children === 'function' ? null : props.children}
      </div>
    );
  },
}));

const title = 'Complete source chart title';
const ariaLabel = 'All source measurements over the selected time range';
const data: NonNullable<ChartCardProps['data']> = Object.freeze([
  Object.freeze({ time: '10:00', value: 0, secondary: null }),
  Object.freeze({ time: '10:01', value: -3, secondary: 7 }),
  Object.freeze({ time: '10:02', value: 12, secondary: undefined }),
]);
const formatter = vi.fn((value: unknown) => `source:${String(value)}`);
const columns: NonNullable<ChartCardProps['dataColumns']> = Object.freeze([
  Object.freeze({ key: 'time', label: 'Recorded time' }),
  Object.freeze({ key: 'value', label: 'Source value', kind: 'measurement' as const, format: formatter }),
  Object.freeze({ key: 'secondary', label: 'Secondary source' }),
]);

function latestChartProps() {
  const call = renderEmbedded.mock.calls[renderEmbedded.mock.calls.length - 1];
  if (!call) throw new Error('ChartCard did not render its concrete EmbeddedChart boundary');
  return call[0];
}

function placed(width: number, children: ReactNode) {
  return (
    <CardPlacementContext.Provider value={{ size: 'half', span: 6, width }}>
      {children}
    </CardPlacementContext.Provider>
  );
}

beforeEach(() => {
  renderEmbedded.mockClear();
  formatter.mockClear();
});

describe('ChartCard production composition contract', () => {
  it('keeps ariaLabel required and leaves height ownership with placement', () => {
    expectTypeOf<ChartCardProps>().toMatchTypeOf<{ ariaLabel: string }>();
    expectTypeOf<'className'>()
      .extract<keyof ChartCardProps>().toEqualTypeOf<never>();
    expectTypeOf<ChartCardProps>().toMatchTypeOf<{
      height?: number; mobileHeight?: number; fluid?: boolean;
    }>();
  });

  it('forwards exact complete data, columns, formatters and accessible description without converting values', () => {
    const ariaDescription = 'Complete description including source gaps and negative values.';
    render(
      <ChartCard title={title} ariaLabel={ariaLabel} ariaDescription={ariaDescription}
        data={data} dataColumns={columns}>
        <span>Complete plotted source</span>
      </ChartCard>,
    );
    const props = latestChartProps();
    expect(props.data).toBe(data);
    expect(props.dataColumns).toBe(columns);
    expect(props.dataColumns?.[1].format).toBe(formatter);
    expect(props.ariaLabel).toBe(ariaLabel);
    expect(props.ariaDescription).toBe(ariaDescription);
    expect(props.data).toEqual([
      { time: '10:00', value: 0, secondary: null },
      { time: '10:01', value: -3, secondary: 7 },
      { time: '10:02', value: 12, secondary: undefined },
    ]);
    expect(formatter).not.toHaveBeenCalled();
  });

  it('preserves the exact child tree and ordered axes, series, legend and reference nodes once inside the frame', () => {
    const children = (
      <Fragment>
        <span data-source-node="x-axis">Original X axis</span>
        <span data-source-node="y-axis">Original Y axis</span>
        <span data-source-node="first-series">Original first series</span>
        <Fragment>
          <span data-source-node="second-series">Original second series</span>
          <span data-source-node="legend">Original legend</span>
        </Fragment>
        <span data-source-node="reference">Original reference node</span>
      </Fragment>
    );
    const { container } = render(
      <ChartCard title={title} ariaLabel={ariaLabel} data={data} dataColumns={columns}>
        {children}
      </ChartCard>,
    );
    expect(latestChartProps().children).toBe(children);
    const frame = screen.getByTestId('embedded-chart-boundary');
    const expectedOrder = ['x-axis', 'y-axis', 'first-series', 'second-series', 'legend', 'reference'];
    expect(Array.from(frame.querySelectorAll('[data-source-node]'), node =>
      node.getAttribute('data-source-node'))).toEqual(expectedOrder);
    expect(container.querySelectorAll('[data-source-node]')).toHaveLength(expectedOrder.length);
    expect(frame.closest('[data-chart]')).toHaveClass('min-w-0');
    expect(frame.closest('[data-card-content]')).not.toBeNull();
  });

  it('forwards a render function unchanged without prematurely invoking or replacing it', () => {
    const children: Extract<ChartCardProps['children'], (...args: never[]) => ReactNode> =
      vi.fn(() => <span>Caller-owned annotation and hidden-series rendering</span>);
    render(<ChartCard title={title} ariaLabel={ariaLabel}>{children}</ChartCard>);
    expect(latestChartProps().children).toBe(children);
    expect(children).not.toHaveBeenCalled();
  });

  it('does not fabricate table rows, columns or descriptions when the source omits them', () => {
    render(<ChartCard title={title} ariaLabel={ariaLabel}><span>Source-owned chart</span></ChartCard>);
    expect(latestChartProps().data).toBeUndefined();
    expect(latestChartProps().dataColumns).toBeUndefined();
    expect(latestChartProps().ariaDescription).toBeUndefined();
  });

  it.each([
    [320, 200], [639, 200], [640, 240], [1023, 240],
    [1024, 280], [1600, 280], [2560, 280],
  ])('uses allocated placement width %i for bounded height %i, independent of viewport', (width, height) => {
    // The placement is deliberately narrower or wider than this viewport.
    const originalWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width < 640 ? 1920 : 320 });
    try {
      render(placed(width, <ChartCard title={title} ariaLabel={ariaLabel}><span>Source</span></ChartCard>));
      expect(latestChartProps()).toMatchObject({ height, mobileHeight: height, fluid: false });
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
    }
  });

  it('uses the bounded phone fallback without placement and responds to placement changes without losing children', () => {
    const child = <span>Stable complete chart child</span>;
    const card = <ChartCard title={title} ariaLabel={ariaLabel}>{child}</ChartCard>;
    const { rerender } = render(card);
    expect(latestChartProps()).toMatchObject({ height: 200, mobileHeight: 200, fluid: false });
    rerender(placed(1280, card));
    expect(latestChartProps()).toMatchObject({ height: 280, mobileHeight: 280, fluid: false });
    expect(latestChartProps().children).toBe(child);
    rerender(placed(390, card));
    expect(latestChartProps()).toMatchObject({ height: 200, mobileHeight: 200, fluid: false });
    expect(latestChartProps().children).toBe(child);
    expect(screen.getAllByText('Stable complete chart child')).toHaveLength(1);
  });

  it.each([
    { loading: true, empty: false, error: undefined },
    { loading: false, empty: false, error: new Error('Initial source failure') },
    { loading: false, empty: true, error: undefined },
    { loading: false, empty: false, error: undefined },
  ])('retains the source state props and shell for %o', state => {
    const onRetry = vi.fn();
    const emptyAction = { label: 'Retry original source', onClick: vi.fn() };
    const emptyActionTo = { label: 'Open original source', to: '/source' };
    const emptyIcon = <span>Original source illustration</span>;
    const { container } = render(
      <ChartCard title={title} ariaLabel={ariaLabel} {...state}
        onRetry={onRetry} emptyTitle="Original empty title" emptyMessage="Original empty message"
        emptyDescription="Original empty explanation" emptyAction={emptyAction}
        emptyActionTo={emptyActionTo} emptyIcon={emptyIcon} data={data} dataColumns={columns}
        footer={<span>Independent footer evidence</span>}>
        <span>Caller-owned chart nodes</span>
      </ChartCard>,
    );
    expect(latestChartProps()).toMatchObject({
      ...state, onRetry, emptyTitle: 'Original empty title', emptyMessage: 'Original empty message',
      emptyDescription: 'Original empty explanation',
    });
    expect(latestChartProps().emptyAction).toBe(emptyAction);
    expect(latestChartProps().emptyActionTo).toBe(emptyActionTo);
    expect(latestChartProps().emptyIcon).toBe(emptyIcon);
    expect(latestChartProps().data).toBe(data);
    expect(latestChartProps().dataColumns).toBe(columns);
    expect(container.querySelectorAll('[data-card]')).toHaveLength(1);
    expect(screen.getByRole('heading', { name: title })).toBeInTheDocument();
    expect(screen.getByText('Independent footer evidence')).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
    expect(emptyAction.onClick).not.toHaveBeenCalled();
  });

  it('retains metadata, legend identity, export payload and size without inventing toolbar settings', () => {
    const metadata = { rangeLabel: 'Original period', sourceLabel: 'Original source', freshness: 'stale' as const };
    const exportData = [{ source: 'original', value: -3 }];
    render(
      <ChartCard title={title} ariaLabel={ariaLabel} metadata={metadata} chartKey="persisted-source-chart"
        exportData={exportData} exportFilename="original-source" size="detail">
        <span>Original source series</span>
      </ChartCard>,
    );
    expect(latestChartProps().metadata).toBe(metadata);
    expect(latestChartProps().exportData).toBe(exportData);
    expect(latestChartProps()).toMatchObject({
      chartKey: 'persisted-source-chart', exportFilename: 'original-source', size: 'detail',
    });
    for (const prop of ['exportable', 'fullscreen', 'annotations', 'variant', 'action']) {
      expect(latestChartProps()).not.toHaveProperty(prop);
    }
  });

  it('retains the card title, complete subtitle and actionable footer outside the embedded chart', () => {
    const subtitle = 'Complete specialist explanation, not a shortened substitute.';
    const footerAction = vi.fn();
    const { container } = render(
      <ChartCard title={title} subtitle={subtitle} ariaLabel={ariaLabel}
        footer={<Button onClick={footerAction}>Original footer action</Button>}>
        <span>Original chart content</span>
      </ChartCard>,
    );
    const heading = screen.getByRole('heading', { name: title });
    expect(container.querySelector('[data-card]')).toHaveAttribute('aria-labelledby', heading.id);
    expect(container.querySelector('[data-card-desc]')?.textContent).toBe(subtitle);
    expect(screen.getByRole('button', { name: `Read full description for ${title}` }))
      .toHaveAccessibleDescription(subtitle);
    const footer = screen.getByRole('button', { name: 'Original footer action' });
    expect(screen.getByTestId('embedded-chart-boundary')).not.toContainElement(footer);
    fireEvent.click(footer);
    expect(footerAction).toHaveBeenCalledOnce();
    expect(latestChartProps().title).toBe(title);
    expect(latestChartProps()).not.toHaveProperty('footer');
  });
});
