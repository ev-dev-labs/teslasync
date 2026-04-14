export interface FSMTransition {
  id: string;
  entity_id: string;
  fsm_name: string;
  from_state: string;
  to_state: string;
  event: string;
  created_at: string;
}

export interface FSMStats {
  enabled: boolean;
  stats: Record<string, number>;
}

export interface FSMTransitionResponse {
  data: FSMTransition[];
  total: number;
  page: number;
  per_page: number;
}

export type FSMType =
  | 'all'
  | 'vehicle_lifecycle'
  | 'charging_session'
  | 'trip'
  | 'export_job';

export const FSM_TYPE_OPTIONS: { value: FSMType; label: string }[] = [
  { value: 'all', label: 'All FSMs' },
  { value: 'vehicle_lifecycle', label: 'Vehicle Lifecycle' },
  { value: 'charging_session', label: 'Charge Sessions' },
  { value: 'trip', label: 'Trips' },
  { value: 'export_job', label: 'Export Jobs' },
];

export const HOURS_OPTIONS = [
  { value: '1', label: 'Last 1 hour' },
  { value: '6', label: 'Last 6 hours' },
  { value: '24', label: 'Last 24 hours' },
  { value: '168', label: 'Last 7 days' },
];
