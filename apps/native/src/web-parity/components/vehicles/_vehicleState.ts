// Native parity port of the Digital-Twin view-model types from
// web/src/lib/vehicleState.ts.
//
// VehicleTwin.tsx consumes only the *types* from the web module
// (`VehicleTwinState`, `WindowState`, `TurnSignalState`, and the nested
// `DoorStates`). The web file's runtime parsers/builders (parseDoorState,
// buildTwinState, mapLiveToTwinState, …) depend on browser-side modules
// (@/api/types, parseEnums, typeGuards, useVehicleLive) that are converted in
// their own files; only the render-facing types are needed here and they are
// pure TypeScript, so they are ported one-for-one to preserve field names.

/** Per-door open state. `null` = unknown (telemetry not yet seen). */
export interface DoorStates {
  driverFront: boolean | null;
  passengerFront: boolean | null;
  driverRear: boolean | null;
  passengerRear: boolean | null;
  trunkFront: boolean | null;
  trunkRear: boolean | null;
}

/** Window position. `null` = unknown. Ported verbatim from web. */
export type WindowState = 'open' | 'closed' | 'partial' | null;

/** Turn-signal state. `null` = unknown. Ported verbatim from web. */
export type TurnSignalState = 'left' | 'right' | 'both' | 'off' | null;

/**
 * Combined Digital-Twin view-model. Field names mirror the web interface
 * exactly so callers and the SI/telemetry merge logic stay source-compatible.
 */
export interface VehicleTwinState {
  doors: DoorStates;
  windowFD: WindowState;
  windowFP: WindowState;
  windowRD: WindowState;
  windowRP: WindowState;
  frunkOpen: boolean | null;
  trunkOpen: boolean | null;
  chargePortOpen: boolean | null;
  isCharging: boolean;
  isDriving: boolean;
  locked: boolean | null;
  sentryMode: boolean | null;
  headlights: boolean | null;
  hazards: boolean | null;
  turnSignal: TurnSignalState;
  driverSeatOccupied: boolean | null;
  vehicleColor: string;
  lastUpdated: string | Date | null;
}
