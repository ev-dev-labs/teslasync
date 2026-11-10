import { experimentalLayouts } from './experimentalLayouts';

const experimentalBattery = () => import('./packs/experimental/BatteryGauge');
const experimentalVehicle = () => import('./packs/experimental/VehicleHero');

export const batteryGaugePresentations = {
  ...experimentalLayouts(() => experimentalBattery),
  v1: () => import('./packs/studio/BatteryGauge'),
  v2: () => import('./packs/elevated/BatteryGauge'),
  v3: () => import('./packs/precision/BatteryGauge'),
  v4: () => import('./packs/owner/BatteryGauge'),
  v5: () => import('./packs/iconic/BatteryGauge'),
  v6: () => import('./packs/expressive/BatteryGauge'),
  v7: () => import('./packs/pixel/BatteryGauge'),
} as const;

export const vehicleHeroPresentations = {
  ...experimentalLayouts(() => experimentalVehicle),
  v1: () => import('./packs/studio/VehicleHero'),
  v2: () => import('./packs/elevated/VehicleHero'),
  v3: () => import('./packs/precision/VehicleHero'),
  v4: () => import('./packs/owner/VehicleHero'),
  v5: () => import('./packs/iconic/VehicleHero'),
  v6: () => import('./packs/expressive/VehicleHero'),
  v7: () => import('./packs/pixel/VehicleHero'),
} as const;
