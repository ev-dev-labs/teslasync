export type RouteId = 'dashboard' | 'vehicles' | 'settings';

export interface RouteDefinition {
  id: RouteId;
  label: string;
  shortDescription: string;
  description: string;
  icon: string;
}

export const routes: RouteDefinition[] = [
  {
    id: 'dashboard',
    label: 'Dashboard',
    shortDescription: 'Fleet command',
    description: 'Live fleet health, alerts, and premium operational overview.',
    icon: 'D',
  },
  {
    id: 'vehicles',
    label: 'Vehicles',
    shortDescription: 'Garage state',
    description: 'Native vehicle cards, health state, and route-ready telemetry shells.',
    icon: 'V',
  },
  {
    id: 'settings',
    label: 'Settings',
    shortDescription: 'Platform',
    description: 'API base, platform support, and React Native parity milestones.',
    icon: 'S',
  },
];
