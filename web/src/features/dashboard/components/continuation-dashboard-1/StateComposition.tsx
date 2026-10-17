import { CompositionRail, KVList, type CompositionRailSegment } from '@/components/data-display';

interface StateCompositionProps {
  segments: readonly CompositionRailSegment[];
  summary: string;
}

export function StateComposition({ segments, summary }: StateCompositionProps) {
  const validScale = segments.every(segment =>
    Number.isFinite(segment.widthPercent) && segment.widthPercent >= 0 && segment.widthPercent <= 100);

  return validScale ? (
    <CompositionRail segments={segments} summary={summary} />
  ) : (
    <div role="group" aria-label={summary}>
      <KVList layout="responsive" wrap items={segments.map(segment => ({
        id: segment.id,
        label: segment.label,
        value: segment.detail,
      }))} />
    </div>
  );
}
