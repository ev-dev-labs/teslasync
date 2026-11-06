import { ChartText, axisTick } from '@/components/charts';

interface ArrivalReliabilityRouteTickProps {
  x?: number;
  y?: number;
  payload?: { value?: string | number };
}

export function ArrivalReliabilityRouteTick({
  x = 0,
  y = 0,
  payload,
}: ArrivalReliabilityRouteTickProps) {
  const label = String(payload?.value ?? '');
  const separator = label.indexOf(' \u2192 ');
  const lines = separator < 0
    ? [label]
    : [label.slice(0, separator), `\u2192 ${label.slice(separator + 3)}`];

  return (
    <g className="arrival-route-tick" role="img" aria-label={label}>
      <title>{label}</title>
      {lines.map((line, index) => (
        <ChartText
          key={index}
          {...axisTick}
          x={x}
          y={y + (lines.length === 1 ? 0 : index * 16 - 8)}
          width={144}
          maxLines={1}
          textAnchor="end"
          verticalAnchor="middle"
        >
          {line}
        </ChartText>
      ))}
    </g>
  );
}
