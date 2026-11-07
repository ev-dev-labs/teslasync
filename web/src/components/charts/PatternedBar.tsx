import { useId } from 'react';
import { Rectangle, type RectangleProps } from 'recharts';

/** Recharts keeps the bar geometry, tooltip colour and source value unchanged. */
export function PatternedBar({ fill = 'var(--theme-primary)', ...props }: RectangleProps) {
  const patternId = `bar-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  return (
    <g>
      <defs>
        <pattern id={patternId} width={7} height={7} patternUnits="userSpaceOnUse">
          <rect width={7} height={7} fill={fill} />
          <rect y={6} width={7} height={1} fill="var(--surface-1)" fillOpacity={0.7} />
        </pattern>
      </defs>
      <Rectangle {...props} fill={`url(#${patternId})`} />
    </g>
  );
}
