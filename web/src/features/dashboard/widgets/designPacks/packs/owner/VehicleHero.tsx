import VehicleHeroLayout from '../../families/VehicleHeroLayout';
import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function OwnerVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v4" className="flex min-w-0 flex-col gap-3">
      {sections.identity}
      <VehicleHeroLayout sections={sections} className="rounded-shape-md bg-[var(--surface-2)] px-3" />
      {sections.readings}
      <div className="min-w-0 border-t border-[var(--border-subtle)]">{sections.vehicle}</div>
    </div>
  );
}
