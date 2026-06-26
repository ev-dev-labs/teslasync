// Native parity port of web/src/components/vehicles/index.ts.
// Re-exports the vehicles components as their React Native equivalents,
// preserving the web barrel's public API (component + type names) one-for-one.

export {VehicleHeroCard, type VehicleHeroCardProps} from './VehicleHeroCard';
export {
  VehicleTwin,
  type VehicleTwinProps,
  type VehicleTwinSize,
} from './VehicleTwin';
export {
  VehiclePaintPicker,
  type VehiclePaintPickerProps,
} from './VehiclePaintPicker';
