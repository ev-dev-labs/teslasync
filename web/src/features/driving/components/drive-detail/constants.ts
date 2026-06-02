// Route-map speed-colour thresholds, expressed in SI (m/s). Telemetry speed
// arrives as raw m/s, so the segment colours are compared against these SI
// values directly. The route legend converts the same thresholds to the user's
// display unit, keeping labels and colours in lock-step. Values correspond to
// 30 / 60 / 100 mph (1 mph = 0.44704 m/s).
export const SPEED_SEGMENT_LOW_MPS = 30 * 0.44704;
export const SPEED_SEGMENT_MED_MPS = 60 * 0.44704;
export const SPEED_SEGMENT_HIGH_MPS = 100 * 0.44704;
