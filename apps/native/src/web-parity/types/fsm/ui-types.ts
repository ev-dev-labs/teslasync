/**
 * Native parity port of web/src/types/fsm/ui-types.ts.
 *
 * API-layer interfaces for the FSM debugger / system pages — NOT the FSM
 * definitions themselves. Covers the transition row shape returned by the
 * backend, the active sub-FSM summary, aggregate FSM stats, the paginated
 * transition-response envelope, and the dropdown option constants the debugger
 * filter UI drives off of. Pure non-visual type/constant code with no DOM,
 * React, Recharts, Leaflet, or web UI dependencies, so every declaration ports
 * verbatim and is fully React Native compatible.
 *
 * The snake_case field names (vehicle_id, from_state, per_page, …) are kept
 * exactly as the Go API serializes them so the native data layer stays wire
 * compatible. The FSM_TYPE_OPTIONS / HOURS_OPTIONS labels are kept as the same
 * literal English strings the web source ships (the web file does not wrap them
 * in i18n), preserving exact behavioral parity; a native screen can translate
 * them at the render boundary just as the web debugger page would.
 */

export interface FSMTransition {
  id: number;
  vehicle_id: number;
  ts: string;
  fsm_name: string;
  from_state: string;
  to_state: string;
  trigger: string;
  details?: Record<string, unknown> | null;
}

export interface ActiveSubFSM {
  type: 'drive' | 'charge';
  state: string;
  start_time: string;
  drive_id?: number;
  session_id?: number;
}

export interface FSMStats {
  enabled: boolean;
  stats: Record<string, number>;
  active_subs?: ActiveSubFSM[];
}

export interface FSMTransitionResponse {
  data: FSMTransition[];
  total: number;
  page: number;
  per_page: number;
}

export type FSMType = 'all' | 'vehicle' | 'telemetry_connection';

export const FSM_TYPE_OPTIONS: {value: FSMType; label: string}[] = [
  {value: 'all', label: 'All FSMs'},
  {value: 'vehicle', label: 'Vehicle'},
  {value: 'telemetry_connection', label: 'Telemetry Connection'},
];

export const HOURS_OPTIONS = [
  {value: '1', label: 'Last 1 hour'},
  {value: '6', label: 'Last 6 hours'},
  {value: '24', label: 'Last 24 hours'},
  {value: '168', label: 'Last 7 days'},
  {value: '720', label: 'Last 30 days'},
  {value: '2160', label: 'Last 90 days'},
  {value: '0', label: 'All time'},
];
