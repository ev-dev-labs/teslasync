import { useContext, useId, useRef, type ReactNode } from 'react';
import { EmbeddedChart, type EmbeddedChartProps } from '../../charts/EmbeddedChart';
import { LayoutCard } from './LayoutCard';
import { CardPlacementContext } from './CardPlacementContext';
import { containerPolicy } from './layoutPolicy';
import { CardDescription } from './CardDescription';

export type ChartCardProps = Omit<EmbeddedChartProps, 'className' | 'embeddedTitleHeading' | 'visibleTitle' | 'headerDescription' | 'summary' | 'titleId'> & {
  footer?: ReactNode;
  /**
   * Key values that belong to this chart (usually a `<ChartSummary>`),
   * rendered inside the card between the title and the chart so stats never
   * float between cards.
   */
  summary?: ReactNode;
};

/** One host surface/title with opt-in canonical chart controls. Without sizing
 * overrides the viewport retains placement-derived mobile/desktop heights. */
export function ChartCard({
  title, subtitle, children, footer, summary, ariaLabel, ariaDescription, data, dataColumns,
  height, mobileHeight, fluid = false, size, ...props
}: ChartCardProps) {
  const placement = useContext(CardPlacementContext);
  const titleId = `chart-card-title-${useId()}`;
  const chartBoundaryRef = useRef<HTMLDivElement>(null);
  const placementHeight = containerPolicy(placement?.width ?? 0).chartHeight;
  // An explicit sizing contract belongs to the caller; otherwise placement
  // retains the original equal mobile/desktop bounded geometry.
  const sizingOverride = size != null || height != null || mobileHeight != null;
  return (
    <LayoutCard title={title} titleId={titleId} header={null} footer={footer}>
      <div ref={chartBoundaryRef} data-chart data-card-slot="relay" className="flex min-w-0 flex-1 flex-col">
        <EmbeddedChart
          {...props}
          title={title}
          titleId={titleId}
          subtitle={subtitle}
          visibleTitle
          headerDescription={subtitle ? <CardDescription title={title} description={subtitle} boundaryRef={chartBoundaryRef} /> : undefined}
          summary={summary}
          ariaLabel={ariaLabel}
          ariaDescription={ariaDescription}
          data={data}
          dataColumns={dataColumns}
          size={size}
          height={sizingOverride ? height : placementHeight}
          mobileHeight={sizingOverride ? mobileHeight : placementHeight}
          fluid={fluid}
          embeddedTitleHeading={false}
        >
          {children}
        </EmbeddedChart>
      </div>
    </LayoutCard>
  );
}
