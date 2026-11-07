import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function PrecisionVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v3" className="flex min-w-0 flex-col gap-4">
      {sections.identity}
      <div className="min-w-0 overflow-hidden rounded-shape-lg">
        {sections.vehicle}
      </div>
      <div className="border-b border-[var(--border-subtle)] pb-3">{sections.headline}</div>
      {sections.charge}
      {sections.readings}
    </div>
  );
}
