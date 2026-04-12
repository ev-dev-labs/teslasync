export interface Trip {
  id: string;
  vehicleId: string;
  startAddress: string;
  endAddress: string;
  distanceMiles: number;
  energyUsedKwh: number;
  efficiencyWhPerMile: number;
  maxSpeedMph: number;
  fsmState: string;
  startedAt: string;
  completedAt?: string;
}
