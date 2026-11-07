import type { ReactNode } from 'react';

/** Render-ready sections produced by the single vehicle-hero controller. */
export interface VehicleHeroSections {
  identity: ReactNode;
  vehicle: ReactNode;
  headline: ReactNode;
  charge: ReactNode;
  readings: ReactNode;
}

export interface VehicleHeroPresentationProps {
  sections: VehicleHeroSections;
}
