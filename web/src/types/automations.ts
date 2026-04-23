export interface Automation {
  id: number;
  name: string;
  description: string | null;
  enabled: boolean;
  vehicle_id: number | null;
  created_at: string;
  updated_at: string;
}
