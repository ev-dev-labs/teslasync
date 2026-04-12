export interface Vehicle {
  id: string;
  userId: string;
  vin: string;
  displayName: string;
  model: string;
  year: number;
  fsmState: string;
  batteryLevel: number;
  rangeMiles: number;
  odometerMiles: number;
  isCharging: boolean;
  latitude: number;
  longitude: number;
  updatedAt: string;
}
