export interface Location {
  id: string;
  addressName: string;
  latitude: number;
  longitude: number;
  visitCount: number;
  totalDurationS: number;
  lastVisited: string | null;
}

export interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  alertOnEntry: boolean;
  alertOnExit: boolean;
  enabled: boolean;
  costPerKwh: number | null;
  createdAt: string;
}
