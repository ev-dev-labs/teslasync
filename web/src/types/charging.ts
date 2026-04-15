export interface ChargingSession {
  id: string;
  vehicleId: string;
  chargerType: string;
  startBatteryLevel: number;
  endBatteryLevel: number;
  energyAddedKwh: number;
  maxPowerKw: number;
  costCents: number;
  fsmState: string;
  subFsmState?: string;
  startedAt: string;
  completedAt?: string;
}
