import {
  ChartContainer,
  type ChartContainerProps,
} from './ChartContainer';

export type EmbeddedChartProps = Omit<ChartContainerProps, 'variant'>;

/**
 * Lightweight chart frame for content already hosted by a widget or panel.
 * It keeps the shared semantic, responsive, and resilient chart contract
 * without nesting a second visual surface or duplicating the host title.
 * Controls are opt-in via the canonical capability props or `toolbar`;
 * `toolbar={false}` suppresses the strip without replacing its controller.
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
  exportable = false,
  fullscreen = false,
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
      exportable={exportable}
      fullscreen={fullscreen}
    />
  );
}
