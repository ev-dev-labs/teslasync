export const GEOFENCE_CATEGORY_VALUES = [
  'home',
  'work',
  'restricted',
  'custom',
] as const;

export type GeofenceCategoryValue = (typeof GEOFENCE_CATEGORY_VALUES)[number];

export const GEOFENCE_CATEGORY_LABELS: Record<
  GeofenceCategoryValue,
  { key: string; fallback: string }
> = {
  home: { key: 'chargingPlaces.category.home', fallback: 'Home' },
  work: { key: 'chargingPlaces.category.work', fallback: 'Work' },
  restricted: { key: 'chargingPlaces.category.restricted', fallback: 'Restricted' },
  custom: { key: 'chargingPlaces.category.custom', fallback: 'Custom' },
};
