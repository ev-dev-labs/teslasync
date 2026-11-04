import { useId } from 'react';
import { fmtNumber } from '@/lib/numberFormat';
import { cn } from '@/lib/cn';
import { dashboardTokens } from '../../lib/dashboardTokens';

interface ChargeMeterProps {
  value: number | null;
  label: string;
  marker?: number | null;
  markerLabel?: string;
  markerTestId?: string;
  active?: boolean;
  color?: string;
  preserveOutOfScaleMarker?: boolean;
}

export function ChargeMeter({
  value, label, marker, markerLabel, markerTestId = 'gauge-marker', active = false, color,
  preserveOutOfScaleMarker = false,
}: ChargeMeterProps) {
  const id = useId();
  const hasReading = value != null && Number.isFinite(value);
  const inScale = hasReading && value >= 0 && value <= 100;
  if (!inScale && !preserveOutOfScaleMarker) return null;
  const hasMarker = marker != null && Number.isFinite(marker) && marker >= 0 && marker <= 100;
  const charging = active && inScale && value > 0 && value < 100;
  const fill = !hasReading ? 'var(--semantic-info)'
    : value <= 20 ? 'var(--semantic-danger)' : value <= 50 ? 'var(--semantic-warning)' : 'var(--semantic-success)';

  return (
    <div
      role={inScale ? 'meter' : 'group'}
      aria-label={label}
      aria-valuenow={inScale ? value : undefined}
      aria-valuemin={inScale ? 0 : undefined}
      aria-valuemax={inScale ? 100 : undefined}
      aria-valuetext={inScale ? `${fmtNumber(value, 0)}%${hasMarker && markerLabel ? `, ${markerLabel}` : ''}` : undefined}
      className={cn('w-full min-w-0', charging && 'widget-activity-active')}
    >
      {hasMarker && (
        <div className="relative h-5" aria-hidden="true">
          <span
            className={cn(
              'absolute bottom-0 whitespace-nowrap',
              marker <= 10 ? 'translate-x-0' : marker >= 90 ? '-translate-x-full' : '-translate-x-1/2',
              dashboardTokens.unit,
            )}
            style={{ left: `${marker}%` }}
          >
            {fmtNumber(marker, 0)}%
          </span>
        </div>
      )}
      <div className="relative h-3 w-full rounded-full bg-[var(--surface-2)]">
        {inScale && <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${value}%`, backgroundColor: color ?? fill }}
        />}
        <svg viewBox="0 0 400 12" preserveAspectRatio="none" aria-hidden="true" focusable="false" className="absolute inset-0 h-full w-full overflow-hidden rounded-full">
          <defs>
            <linearGradient id={`${id}-fill`}>
              <stop offset="0" stopColor="var(--semantic-info)" />
              <stop offset="1" stopColor={fill} />
            </linearGradient>
            <linearGradient id={`${id}-ribbon`}>
              <stop offset="0" stopColor="var(--semantic-info)" stopOpacity="0" />
              <stop offset=".3" stopColor="var(--semantic-purple)" stopOpacity=".6" />
              <stop offset=".55" stopColor="var(--semantic-success)" stopOpacity=".85" />
              <stop offset=".8" stopColor="var(--semantic-warning)" stopOpacity=".5" />
              <stop offset="1" stopColor="var(--semantic-info)" stopOpacity="0" />
            </linearGradient>
            <clipPath id={`${id}-charge`}>
              <rect x="0" y="0" width={inScale ? value * 4 : 0} height="12" rx="6" />
            </clipPath>
          </defs>
          <g clipPath={`url(#${id}-charge)`}>
            <rect x="0" y="0" width="400" height="12" fill={`url(#${id}-fill)`} />
            {charging && (
              <g className="widget-state-motion widget-energy-stream">
                {[-160, 0, 160, 320].map((x) => (
                  <rect key={x} x={x} y="0" width="160" height="12" fill={`url(#${id}-ribbon)`} />
                ))}
              </g>
            )}
          </g>
        </svg>
        {hasMarker && (
          <span
            data-testid={markerTestId}
            title={markerLabel}
            aria-hidden="true"
            className="pointer-events-none absolute -inset-y-1 w-0.5 -translate-x-1/2 rounded-full bg-[var(--text-primary)]"
            style={{ left: `${marker}%` }}
          />
        )}
      </div>
    </div>
  );
}
