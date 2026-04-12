export interface Location {
  id: string;
  addressName: string;
  latitude: number;
  longitude: number;
  visitCount: number;
  totalDurationMin: number;
  lastVisited: string | null;
}

export interface Geofence {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  radius: number;
  costPerKwh: number | null;
}
