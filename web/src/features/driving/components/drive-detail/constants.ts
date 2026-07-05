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

/** Exact miles-per-hour → metres-per-second factor (1 mi = 1609.344 m, 1 h = 3600 s). */
const MPH_TO_MPS = 0.44704;

/** Lower edge — 30 mph in SI m/s. Below this a route segment renders green. */
export const SPEED_SEGMENT_LOW_MPS = 30 * MPH_TO_MPS;

/** Middle edge — 60 mph in SI m/s. Cyan below, amber at/above. */
export const SPEED_SEGMENT_MED_MPS = 60 * MPH_TO_MPS;

/** Upper edge — 100 mph in SI m/s. Amber below, red at/above. */
export const SPEED_SEGMENT_HIGH_MPS = 100 * MPH_TO_MPS;
