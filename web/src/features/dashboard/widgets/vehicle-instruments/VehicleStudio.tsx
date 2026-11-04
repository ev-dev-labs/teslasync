import { useRef, type ReactNode } from 'react';
import { VehicleTwin } from '@/components/vehicles';
import type { VehicleTwinProps } from '@/components/vehicles';
import { buildTwinState } from '@/lib/vehicleState';
import { cn } from '@/lib/cn';
import VehicleRoad from './VehicleRoad';

interface VehicleStudioProps {
  vehicle: { id: number; model?: string | null; exterior_color?: string | null };
  twinState?: ReturnType<typeof buildTwinState>;
  driving?: boolean;
  lightsOn?: boolean;
  size?: VehicleTwinProps['size'];
  compact?: boolean;
  bounded?: boolean;
  children?: ReactNode;
}

export default function VehicleStudio({
  vehicle, twinState, driving = false, lightsOn = false, size = 'md', compact = false, bounded = false, children,
}: VehicleStudioProps) {
  const studioRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={studioRef}
      data-vehicle-studio=""
      data-studio-layout={compact ? 'compact' : bounded ? 'bounded' : 'full'}
      data-activity={driving ? 'driving' : 'static'}
      className={cn(
        'relative isolate flex w-full min-w-0 shrink-0 flex-col items-center justify-center overflow-hidden',
        compact ? 'h-24 px-1' : bounded ? 'h-40 px-2' : 'min-h-36 px-3 py-5',
      )}
    >
      <VehicleRoad studioRef={studioRef} driving={driving} lightsOn={lightsOn} />
      <VehicleTwin
        {...(twinState ?? buildTwinState(null, null, null))}
        vehicleId={vehicle.id}
        exteriorColor={vehicle.exterior_color}
        model={vehicle.model}
        size={size}
        isDriving={driving || (twinState?.isDriving ?? false)}
        headlights={lightsOn ? true : twinState?.headlights ?? null}
        wheelMotionClassName={driving ? 'widget-state-motion widget-wheel-motion' : undefined}
        animateActivity={false}
        driveIn={false}
        className={cn('relative z-10', compact ? '!max-w-[min(180px,88%)]'
          : bounded ? '!max-w-[min(340px,88%)]' : '!max-w-[88%]')}
      />
      {children}
    </div>
  );
}
