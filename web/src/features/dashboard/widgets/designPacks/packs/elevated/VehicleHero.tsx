import VehicleHeroLayout from '../../families/VehicleHeroLayout';
import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function ElevatedVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v2" className="flex min-w-0 flex-col gap-4">
      <div className="rounded-shape-lg bg-[var(--surface-2)] px-3 pt-3">
        {sections.identity}
        {sections.vehicle}
      </div>
      <VehicleHeroLayout sections={sections} className="rounded-shape-md border border-[var(--border-subtle)] px-3 pb-2" />
      {sections.readings}
    </div>
  );
}
