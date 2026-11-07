import type { VehicleHeroPresentationProps } from '../viewModels/VehicleHeroViewModel';

export default function ClassicVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return <div className="flex min-w-0 flex-col gap-3">
    {sections.identity}{sections.vehicle}{sections.headline}{sections.charge}{sections.readings}
  </div>;
}
