import { forwardRef } from 'react';
import { cn } from '@/lib/cn';

interface MiniChartProps {
  data: number[];
  color?: string;
  height?: number;
  width?: number;
  className?: string;
}

export const MiniChart = forwardRef<HTMLDivElement, MiniChartProps>(
  function MiniChart({ data, color = '#3b82f6', height = 32, width = 100, className }, ref) {
    if (data.length < 2) return null;

    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min || 1;
    const padding = 2;

    const points = data
      .map((v, i) => {
        const x = (i / (data.length - 1)) * (width - padding * 2) + padding;
        const y = height - padding - ((v - min) / range) * (height - padding * 2);
        return `${x},${y}`;
      })
      .join(' ');

    return (
      <div ref={ref} className={cn('inline-block', className)}>
        <svg width={width} height={height} className="overflow-visible">
          <polyline
            points={points}
            fill="none"
            stroke={color}
            strokeWidth={1.5}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    );
  },
);
