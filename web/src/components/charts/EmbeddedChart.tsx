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
 *
 * Explicit height props select the bounded fixed-height contract. Without an
 * explicit height, embedded charts preserve fluid host sizing; callers can
 * still force either mode with `fluid`.
 */
export function EmbeddedChart({
  size = 'compact',
  fluid,
  height,
  mobileHeight,
  ...props
}: EmbeddedChartProps) {
  const resolvedFluid = fluid ?? (height == null && mobileHeight == null);

  return (
    <ChartContainer
      {...props}
      variant="embedded"
      size={size}
      height={height}
      mobileHeight={mobileHeight}
      fluid={resolvedFluid}
      exportable={false}
      fullscreen={false}
    />
  );
}
