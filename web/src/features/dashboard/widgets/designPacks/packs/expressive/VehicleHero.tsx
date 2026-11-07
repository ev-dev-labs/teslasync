import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function ExpressiveVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v6" className="flex min-w-0 flex-col gap-3">
      <div className="rounded-shape-lg bg-[var(--surface-2)] p-3">
        {sections.identity}
        <div className="mt-2 rounded-shape-md bg-[var(--surface-1)] px-3">{sections.headline}</div>
      </div>
      <div className="min-w-0">{sections.vehicle}</div>
      <div className="rounded-shape-lg bg-[var(--surface-2)] p-3">{sections.charge}{sections.readings}</div>
    </div>
  );
}
