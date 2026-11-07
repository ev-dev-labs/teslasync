import VehicleHeroLayout from '../../families/VehicleHeroLayout';
import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function PixelVehicleHero({ sections }: VehicleHeroPresentationProps) {
  return (
    <div data-vehicle-hero-pack="v7" className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center gap-2 border-b-2 border-[var(--text-secondary)] pb-2">
        <svg viewBox="0 0 16 16" aria-hidden="true" className="h-6 w-6 shrink-0 fill-current text-[var(--text-secondary)]" shapeRendering="crispEdges">
          <path d="M5 3h6v1h1v2h1v1h2v6h-2v1h-2v-2H5v2H3v-1H1V7h2V6h1V4h1zm0 2v3h6V5zM3 9v2h2V9zm8 0v2h2V9z" fillRule="evenodd" />
        </svg>
        <div className="min-w-0 flex-1">{sections.identity}</div>
      </div>
      <div className="grid min-w-0 gap-3 @lg:grid-cols-2">
        <div className="min-w-0 rounded-shape-sm border-2 border-[var(--border-default)]">{sections.vehicle}</div>
        <VehicleHeroLayout sections={sections} className="flex min-w-0 flex-col justify-center gap-3 rounded-shape-sm border-2 border-[var(--border-default)] px-3" />
      </div>
      <div className="border-t-2 border-[var(--border-default)]">{sections.readings}</div>
    </div>
  );
}
