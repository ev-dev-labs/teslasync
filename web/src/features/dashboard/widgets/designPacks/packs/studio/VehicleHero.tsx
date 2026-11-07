import VehicleHeroLayout from '../../families/VehicleHeroLayout';
import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function StudioVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v1" className="flex min-w-0 flex-col gap-3">
      {sections.identity}
      <div className="grid min-w-0 gap-3 @lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <div className="min-w-0 rounded-shape-md bg-[var(--surface-2)]">{sections.vehicle}</div>
        <VehicleHeroLayout sections={sections} className="flex min-w-0 flex-col justify-center gap-3" />
      </div>
      <div className="rounded-shape-md border border-[var(--border-subtle)] px-3">{sections.readings}</div>
    </div>
  );
}
