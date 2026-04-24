import { cn } from '@/lib/cn';
import { FSM_REGISTRY } from '@/types/fsm';
import type { VehicleStatus } from '@/api/types';

const _vehicleStates = FSM_REGISTRY.vehicle.states;

interface StatusBadgeProps {
  status: VehicleStatus | (string & {});
  size?: 'sm' | 'md';
  className?: string;
}

const sizes = {
  sm: { dot: 'h-1.5 w-1.5', text: 'text-xs', gap: 'gap-1', px: 'px-1.5 py-0.5' },
  md: { dot: 'h-2 w-2', text: 'text-sm', gap: 'gap-1.5', px: 'px-2 py-1' },
} as const;

export function StatusBadge({ status, size = 'md', className }: StatusBadgeProps) {
  const s = sizes[size];
  const dotColor = _vehicleStates[status as VehicleStatus]?.badgeDot ?? 'bg-gray-400';

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border border-gray-200 bg-gray-50 font-medium dark:border-gray-700 dark:bg-gray-800',
        s.gap,
        s.px,
        s.text,
        className,
      )}
    >
      <span className={cn('inline-block rounded-full', s.dot, dotColor)} />
      <span className="capitalize text-gray-700 dark:text-gray-300">{status}</span>
    </span>
  );
}
