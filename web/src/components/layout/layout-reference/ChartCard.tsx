import { useContext, type ReactNode } from 'react';
import { EmbeddedChart, type EmbeddedChartProps } from '../../charts/EmbeddedChart';
import { LayoutCard } from './LayoutCard';
import { CardPlacementContext } from './CardPlacementContext';
import { containerPolicy } from './layoutPolicy';

export type ChartCardProps = Omit<EmbeddedChartProps, 'className' | 'embeddedTitleHeading'> & {
  footer?: ReactNode;
};

/** One host surface/title with opt-in canonical chart controls. Without sizing
 * overrides the viewport retains placement-derived mobile/desktop heights. */
export function ChartCard({
  title, subtitle, children, footer, ariaLabel, ariaDescription, data, dataColumns,
  height, mobileHeight, fluid = false, size, ...props
}: ChartCardProps) {
  const placement = useContext(CardPlacementContext);
  const placementHeight = containerPolicy(placement?.width ?? 0).chartHeight;
  // An explicit sizing contract belongs to the caller; otherwise placement
  // retains the original equal mobile/desktop bounded geometry.
  const sizingOverride = size != null || height != null || mobileHeight != null;
  const toolbarEnabled = props.toolbar !== false && (
    props.toolbar === true || !!(
      props.icon || props.action || props.annotations || props.exportable || props.fullscreen
    )
  );
  return (
    <LayoutCard title={title} description={subtitle} footer={footer}>
      <div data-chart className="min-w-0">
        <EmbeddedChart
          {...props}
          title={title}
          ariaLabel={ariaLabel}
          ariaDescription={ariaDescription}
          data={data}
          dataColumns={dataColumns}
          size={size}
          height={sizingOverride ? height : placementHeight}
          mobileHeight={sizingOverride ? mobileHeight : placementHeight}
          fluid={fluid}
          embeddedTitleHeading={!toolbarEnabled}
        >
          {children}
        </EmbeddedChart>
      </div>
    </LayoutCard>
  );
}
