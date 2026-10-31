import { useId } from 'react';
import { cn } from '@/lib/cn';

interface ChargeBatteryPackProps {
  level: number | null | undefined;
  active?: boolean;
  className?: string;
}

export function ChargeBatteryPack({ level, active = false, className }: ChargeBatteryPackProps) {
  const id = useId();
  const inScale = level != null && Number.isFinite(level) && level >= 0 && level <= 100;
  const charging = active && inScale && level > 0 && level < 100;
  const cells = Array.from({ length: 10 }, (_, index) => ({
    x: 10 + index * 9,
    width: inScale ? Math.max(0, Math.min(1, (level - index * 10) / 10)) * 6 : 0,
  }));
  const fill = !inScale ? 'var(--semantic-info)'
    : level <= 20 ? 'var(--semantic-danger)' : level <= 50 ? 'var(--semantic-warning)' : 'var(--semantic-success)';

  return (
    <svg
      viewBox="0 0 114 66"
      aria-hidden="true"
      focusable="false"
      data-charge-pack={inScale ? 'measured' : 'unknown'}
      data-charge-level={inScale ? level : undefined}
      className={cn('h-auto w-28 max-w-full shrink-0 rounded-shape-lg', charging && 'widget-activity-active', className)}
    >
      <defs>
        <linearGradient id={`${id}-cells`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="var(--semantic-info)" />
          <stop offset="1" stopColor={fill} />
        </linearGradient>
        <linearGradient id={`${id}-ribbon`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--semantic-info)" stopOpacity="0" />
          <stop offset=".35" stopColor="var(--semantic-purple)" stopOpacity=".5" />
          <stop offset=".6" stopColor="var(--semantic-success)" stopOpacity=".9" />
          <stop offset=".85" stopColor="var(--semantic-warning)" stopOpacity=".45" />
          <stop offset="1" stopColor="var(--semantic-success)" stopOpacity="0" />
        </linearGradient>
        <clipPath id={`${id}-charge`}>
          {cells.map((cell, index) => (
            <rect key={index} x={cell.x} y="20" width={cell.width} height="27" rx="2" />
          ))}
        </clipPath>
      </defs>
      <rect x="3" y="12" width="102" height="43" rx="8" fill="var(--surface-2)" stroke="var(--border-subtle)" />
      <path d="M109 25v17" stroke="var(--semantic-info)" strokeWidth="4" strokeLinecap="round" />
      {cells.map((cell, index) => (
        <rect key={index} x={cell.x} y="20" width="6" height="27" rx="2" fill="var(--semantic-info)" fillOpacity=".13" />
      ))}
      <g clipPath={`url(#${id}-charge)`}>
        <rect x="10" y="20" width="87" height="27" fill={`url(#${id}-cells)`} />
        {charging && (
          <g className="widget-state-motion widget-cell-stream">
            <rect x="10" y="20" width="87" height="48" fill={`url(#${id}-ribbon)`} />
            <rect x="10" y="68" width="87" height="48" fill={`url(#${id}-ribbon)`} />
          </g>
        )}
      </g>
    </svg>
  );
}
