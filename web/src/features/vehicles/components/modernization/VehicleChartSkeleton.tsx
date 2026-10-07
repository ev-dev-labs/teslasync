import { containerPolicy, useCardPlacement } from '@/components/layout/layout-reference';
import { ChartBlockSkeleton } from '@/components/feedback';

/** Height comes from the containing grid, not a second width observer. */
export function VehicleChartSkeleton() {
  const placement = useCardPlacement();
  return <ChartBlockSkeleton height={containerPolicy(placement?.width ?? 0).chartHeight} />;
}
