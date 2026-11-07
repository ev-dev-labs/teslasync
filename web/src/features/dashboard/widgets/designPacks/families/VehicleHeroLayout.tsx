import type { VehicleHeroPresentationProps } from '../viewModels/VehicleHeroViewModel';

interface VehicleHeroLayoutProps extends VehicleHeroPresentationProps {
  className: string;
}

export default function VehicleHeroLayout({ sections, className }: VehicleHeroLayoutProps) {
  return <div className={className}>{sections.headline}{sections.charge}</div>;
}
