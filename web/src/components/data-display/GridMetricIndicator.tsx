import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export type GridMetricBand = 'good' | 'info' | 'warning' | 'critical';
export type GridMetricKind = 'battery' | 'efficiency' | 'score';

const bandColors: Record<GridMetricBand, string> = {
  good: 'text-emerald-700 dark:text-emerald-400/80',
  info: 'text-sky-700 dark:text-sky-400/80',
  warning: 'text-amber-700 dark:text-amber-400/80',
  critical: 'text-rose-700 dark:text-rose-400/80',
};

/** Indicators require a meaningful fixed scale or explicit grade, never a row-set maximum. */
export function GridMetricIndicator({ children, kind, band, title, fraction, segments = 0 }: {
  children: ReactNode;
  kind: GridMetricKind;
  band: GridMetricBand;
  title: string;
  fraction: number;
  segments?: number;
}) {
  const fill = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0;
  const circumference = 2 * Math.PI * 5.5;
  return (
    <div className="flex items-center justify-end gap-2" data-range={band} title={title}>
      <svg aria-hidden="true" data-indicator={kind} viewBox="0 0 32 16"
        className={cn('h-4 w-8 shrink-0 opacity-80', bandColors[band])}>
        {kind === 'battery' && (
          <>
            <rect x={2} y={3} width={26} height={10} rx={2} fill="none" stroke="currentColor" opacity={0.65} />
            <rect x={29} y={6} width={2} height={4} rx={0.5} fill="currentColor" opacity={0.65} />
            <rect data-fill x={4} y={5} width={22 * fill} height={6} rx={1} fill="currentColor" />
          </>
        )}
        {kind === 'efficiency' && Array.from({ length: 5 }, (_, index) => (
          <rect key={index} data-fill={index < segments ? '' : undefined}
            x={3 + index * 5.5} y={3} width={4} height={10} rx={1}
            fill="currentColor" opacity={index < segments ? 1 : 0.15} />
        ))}
        {kind === 'score' && (
          <>
            <circle cx={16} cy={8} r={5.5} fill="none" stroke="currentColor" strokeWidth={2.5} opacity={0.15} />
            <circle data-fill cx={16} cy={8} r={5.5} fill="none" stroke="currentColor" strokeWidth={2.5}
              strokeDasharray={`${circumference * fill} ${circumference}`} transform="rotate(-90 16 8)" />
          </>
        )}
      </svg>
      <span>{children}</span>
    </div>
  );
}
