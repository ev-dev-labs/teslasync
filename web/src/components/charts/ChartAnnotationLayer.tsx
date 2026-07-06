import { ReferenceLine } from 'recharts';
import { ANNOTATION_COLORS } from '@/types/annotations';
import type { DataAnnotation } from '@/types/annotations';

/**
 * Returns an array of ReferenceLine elements for chart annotations.
 * Must be spread directly as children of a Recharts chart component,
 * NOT rendered as a wrapper component (Recharts ignores unknown children).
 *
 * Defensive by design: this helper is spread into many chart pages, so it
 * tolerates a nullish `annotations` list (renders nothing instead of throwing
 * on `.map`) and an unknown `category` — falling back to the neutral "custom"
 * color rather than emitting an uncolored, effectively-invisible reference
 * line + label from `stroke={undefined}`.
 */
export function renderAnnotationLines(
  annotations: DataAnnotation[] | null | undefined,
  toXValue: (timestamp: string) => number | string,
): React.ReactElement[] {
  return (annotations ?? []).map((ann) => {
    const color = ANNOTATION_COLORS[ann.category] ?? ANNOTATION_COLORS.custom;
    return (
      <ReferenceLine
        key={ann.id}
        x={toXValue(ann.timestamp)}
        stroke={color}
        strokeDasharray="4 4"
        strokeWidth={1.5}
        opacity={0.7}
        label={{
          value: ann.label ?? '',
          position: 'top',
          fill: color,
          fontSize: 10,
          fontWeight: 500,
        }}
      />
    );
  });
}
