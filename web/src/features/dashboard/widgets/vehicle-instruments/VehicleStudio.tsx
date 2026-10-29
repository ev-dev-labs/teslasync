import type { ReactNode } from 'react';
import { VehicleTwin } from '@/components/vehicles';
import type { VehicleTwinProps } from '@/components/vehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { cn } from '@/lib/cn';

interface VehicleStudioProps {
  vehicle: { id: number; model?: string | null; exterior_color?: string | null };
  twinState?: ReturnType<typeof buildTwinState>;
  driving?: boolean;
  size?: VehicleTwinProps['size'];
  compact?: boolean;
  bounded?: boolean;
  children?: ReactNode;
}

export default function VehicleStudio({
  vehicle, twinState, driving = false, size = 'md', compact = false, bounded = false, children,
}: VehicleStudioProps) {
  return (
    <div
      data-vehicle-studio=""
      data-studio-layout={compact ? 'compact' : bounded ? 'bounded' : 'full'}
      data-activity={driving ? 'driving' : 'static'}
      className={cn(
        'relative isolate flex w-full min-w-0 shrink-0 flex-col items-center justify-center overflow-hidden',
        compact ? 'h-20 px-1' : bounded ? 'h-32 px-2' : 'min-h-36 px-3 py-5',
      )}
    >
      <svg viewBox="0 0 560 200" preserveAspectRatio="none" aria-hidden="true" className="pointer-events-none absolute inset-0 h-full w-full text-[var(--border-default)]">
        <path d="M24 176H536" stroke="currentColor" fill="none" />
        {driving && (
          <path
            data-testid="vehicle-road-motion"
            className="widget-state-motion widget-road-motion text-[var(--semantic-info)]"
            d="M536 188H24" stroke="currentColor" strokeWidth="2" strokeDasharray="28 48" fill="none"
          />
        )}
      </svg>
      <VehicleTwin
        {...(twinState ?? buildTwinState(null, null, null))}
        vehicleId={vehicle.id}
        exteriorColor={vehicle.exterior_color}
        model={vehicle.model}
        size={size}
        animateActivity={false}
        driveIn={false}
        className={cn('relative z-10', compact ? '!max-w-[min(180px,100%)]' : bounded && '!max-w-[min(300px,100%)]')}
      />
      {children}
    </div>
  );
}
