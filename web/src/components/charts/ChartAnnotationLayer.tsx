import { ReferenceLine } from 'recharts';
import { ANNOTATION_COLORS } from '@/types/annotations';
import type { DataAnnotation } from '@/types/annotations';

/**
 * Returns an array of ReferenceLine elements for chart annotations.
 * Must be spread directly as children of a Recharts chart component,
 * NOT rendered as a wrapper component (Recharts ignores unknown children).
 */
export function renderAnnotationLines(
  annotations: DataAnnotation[],
  toXValue: (timestamp: string) => number | string,
): React.ReactElement[] {
  return annotations.map((ann) => (
    <ReferenceLine
      key={ann.id}
      x={toXValue(ann.timestamp)}
      stroke={ANNOTATION_COLORS[ann.category]}
      strokeDasharray="4 4"
      strokeWidth={1.5}
      opacity={0.7}
      label={{
        value: ann.label,
        position: 'top',
        fill: ANNOTATION_COLORS[ann.category],
        fontSize: 10,
        fontWeight: 500,
      }}
    />
  ));
}
