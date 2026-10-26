// Route-map speed-colour thresholds, expressed in SI (m/s). Telemetry speed
// arrives as raw m/s (VehicleSpeed), so `useDriveDetailData` compares each
// segment against these SI values directly. `RouteMapSection` converts the same
// thresholds back to the user's display unit via `convertSpeedFromSI`, keeping
// the legend labels and the segment colours in lock-step.
//
// The three edges correspond to 30 / 60 / 100 mph and MUST stay strictly
// ascending: the colour ladder paints a segment green (< LOW) → cyan (LOW–MED)
// → amber (MED–HIGH) → red (≥ HIGH), so an out-of-order edge would silently
// mis-band the map. `constants.test.ts` pins each edge to its exact mph value
// through the real display converter and guards the ordering.

import { convertSpeedToSI } from '@/lib/unitConversion';

/** Lower edge — 30 mph in SI m/s. Below this a route segment renders green. */
export const SPEED_SEGMENT_LOW_MPS = convertSpeedToSI(30, 'mph');

/** Middle edge — 60 mph in SI m/s. Cyan below, amber at/above. */
export const SPEED_SEGMENT_MED_MPS = convertSpeedToSI(60, 'mph');

/** Upper edge — 100 mph in SI m/s. Amber below, red at/above. */
export const SPEED_SEGMENT_HIGH_MPS = convertSpeedToSI(100, 'mph');
