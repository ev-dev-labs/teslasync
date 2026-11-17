/** SI canonical synthetic data only. No API/domain identities or write payloads. */
export interface PreviewJourney {
  id: string;
  route: 'harbor' | 'park' | 'studio' | 'library' | 'market' | 'garden';
  distance_m: number;
  energy_wh: number | null;
  completeness: 'complete' | 'partial';
}

export const PREVIEW_JOURNEYS: PreviewJourney[] = [
  { id: 'sample-1', route: 'harbor', distance_m: 18200, energy_wh: 2900, completeness: 'complete' },
  { id: 'sample-2', route: 'park', distance_m: 0, energy_wh: 0, completeness: 'complete' },
  { id: 'sample-3', route: 'studio', distance_m: 8700, energy_wh: null, completeness: 'partial' },
  { id: 'sample-4', route: 'library', distance_m: 6400, energy_wh: 1100, completeness: 'complete' },
  { id: 'sample-5', route: 'market', distance_m: 12500, energy_wh: 2100, completeness: 'complete' },
  { id: 'sample-6', route: 'garden', distance_m: 4200, energy_wh: 650, completeness: 'complete' },
];

export const PREVIEW_CHART = [
  { minute: 0, battery: 78, reference: 80 },
  { minute: 5, battery: 77, reference: 79 },
  { minute: 10, battery: 75, reference: 78 },
  { minute: 15, battery: null, reference: 77 },
  { minute: 20, battery: 74, reference: 76 },
  { minute: 25, battery: 72, reference: 75 },
  { minute: 30, battery: 71, reference: 74 },
];

/** Fictional itinerary placed in the ocean, never a user's recorded location. */
export const PREVIEW_ROUTE: [number, number][] = [
  [0.008, -0.015], [0.012, -0.007], [0.005, 0.001], [0.014, 0.012],
];
