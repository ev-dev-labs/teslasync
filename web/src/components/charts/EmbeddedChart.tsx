import {
  ChartContainer,
  type ChartContainerProps,
} from './ChartContainer';

export type EmbeddedChartProps = Omit<
  ChartContainerProps,
  | 'variant'
  | 'icon'
  | 'action'
  | 'annotations'
  | 'exportable'
  | 'fullscreen'
>;

/**
 * Lightweight chart frame for content already hosted by a widget or panel.
 * It keeps the shared semantic, responsive, and resilient chart contract
 * without nesting a second visual surface or duplicating the host title.
 */
export function EmbeddedChart({
  size = 'compact',
  fluid = true,
  ...props
}: EmbeddedChartProps) {
  return (
    <ChartContainer
      {...props}
      variant="embedded"
      size={size}
      fluid={fluid}
      exportable={false}
      fullscreen={false}
    />
  );
}
