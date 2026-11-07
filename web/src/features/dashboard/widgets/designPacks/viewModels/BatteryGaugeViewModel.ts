import type { ReactNode } from 'react';

/** Render-ready readings and controls from the one battery-gauge controller. */
export interface BatteryGaugePresentationProps {
  status: ReactNode;
  headline: ReactNode;
  pack: ReactNode;
  meter: ReactNode;
  details: ReactNode;
  level: number | null;
}
