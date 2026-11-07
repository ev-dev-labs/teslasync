import VehicleHeroLayout from '../../families/VehicleHeroLayout';
import { CarFront } from 'lucide-react';
import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function IconicVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v5" className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <CarFront aria-hidden="true" className="h-7 w-7 shrink-0 text-[var(--text-secondary)]" />
        <div className="min-w-0 flex-1">{sections.identity}</div>
      </div>
      <div className="rounded-shape-lg border border-[var(--border-default)] bg-[var(--surface-2)]">
        {sections.vehicle}
      </div>
      <VehicleHeroLayout sections={sections} className="rounded-shape-md px-2" />
      {sections.readings}
    </div>
  );
}
