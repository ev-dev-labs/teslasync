import { usePackPresentation } from '../../PackBoundary';
import { EXPERIMENTAL_LAYOUTS, isExperimentalAppearance } from '../../experimentalLayouts';
import type { VehicleHeroPresentationProps } from '../../viewModels/VehicleHeroViewModel';

export default function ExperimentalVehicleHero({ sections }: VehicleHeroPresentationProps) {
  const packId = usePackPresentation();
  if (!isExperimentalAppearance(packId)) return null;
  const layout = EXPERIMENTAL_LAYOUTS[packId];
  const vehicle = <div key="vehicle" className={layout.visual}>{sections.vehicle}</div>;
  const readings = <div key="readings" className={layout.details}>{sections.readings}</div>;
  const slots = {
    lead: <div key="headline" className={layout.lead}>{sections.headline}</div>,
    visual: vehicle,
    details: readings,
  };
  return <div data-vehicle-hero-pack={packId} className="flex min-w-0 flex-col gap-3">
    {sections.identity}
    <div className={layout.body}>
      {layout.order.map(slot => slots[slot])}
      <div key="charge" className="min-w-0 @lg:col-span-2">{sections.charge}</div>
    </div>
  </div>;
}
