import { request } from './client'
import type {
  EnergyStats,
  BatteryReport,
  FleetAnalytics,
  ChargingHeatmapData,
  SpeedProfileData,
  TemperatureImpactData,
  RouteEfficiencyData,
  RouteDetailData,
  TCOAnalytics,
  SleepAnalytics,
  RegenData,
  BatteryDegradationData,
  DailyMileage,
  MonthlyMileage,
  MileageStats,
  VampireDrainEvent,
  VampireDrainEventsResponse,
  VampireDrainStats,
  VisitedLocation,
  Trip,
} from './types'

// === Energy ===
/** Fetches energy consumption and efficiency stats for a vehicle. */
export const getEnergyStats = (vehicleId: number, days = 30, start?: string) =>
  request<EnergyStats>(`/vehicles/${vehicleId}/energy?${start ? `start=${start}` : `days=${days}`}`)

// === Battery Health ===
/** Fetches the battery health report including degradation and capacity trends. */
export const getBatteryReport = (vehicleId: number) =>
  request<BatteryReport>(`/vehicles/${vehicleId}/battery`)

// === Fleet Analytics ===
/** Fetches aggregated fleet-wide analytics (drives, charging, efficiency, trends). */
export const getFleetAnalytics = (days = 30, start?: string) => request<FleetAnalytics>(`/analytics/fleet?${start ? `start=${start}` : `days=${days}`}`)

// === Charging Heatmap ===
export const getChargingHeatmap = (vehicleId: number) =>
  request<ChargingHeatmapData>(`/analytics/charging-heatmap?vehicle_id=${vehicleId}`)

// === Speed Profile ===
export const getSpeedProfile = (vehicleId: number) =>
  request<SpeedProfileData>(`/analytics/speed-profile?vehicle_id=${vehicleId}`)

// === Temperature Impact ===
export const getTemperatureImpact = (vehicleId: number) =>
  request<TemperatureImpactData>(`/analytics/temperature-impact?vehicle_id=${vehicleId}`)

// === Route Efficiency ===
export const getRouteEfficiency = (vehicleId: number) =>
  request<RouteEfficiencyData>(`/analytics/route-efficiency?vehicle_id=${vehicleId}`)

export const getRouteEfficiencyDetail = (vehicleId: number, start: string, end: string) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), start, end })
  return request<RouteDetailData>(`/analytics/route-efficiency/detail?${params}`)
}

// === True Cost of Ownership (TCO) ===
export const getTCOAnalytics = (vehicleId: number) =>
  request<TCOAnalytics>(`/analytics/tco?vehicle_id=${vehicleId}`)

// === Sleep Efficiency ===
export const getSleepAnalytics = (vehicleId: number, days = 30) =>
  request<SleepAnalytics>(`/analytics/sleep?vehicle_id=${vehicleId}&days=${days}`)

// === Regen Braking ===
export const getRegenStats = (vehicleId: number) =>
  request<RegenData>(`/analytics/regen?vehicle_id=${vehicleId}`)

// === Battery Degradation ===
export const getBatteryDegradation = (vehicleId: number) =>
  request<BatteryDegradationData>(`/analytics/battery-degradation?vehicle_id=${vehicleId}`)

// === Mileage ===
/** Fetches daily mileage records for a vehicle (up to 365 days). */
export const getDailyMileage = (vehicleId: number, limit = 365, offset = 0) =>
  request<DailyMileage[]>(`/mileage/daily?vehicle_id=${vehicleId}&limit=${limit}&offset=${offset}`)
/** Fetches monthly mileage aggregates for a vehicle. */
export const getMonthlyMileage = (vehicleId: number) =>
  request<MonthlyMileage[]>(`/mileage/monthly?vehicle_id=${vehicleId}`)
/** Fetches lifetime mileage statistics for a vehicle. */
export const getMileageStats = (vehicleId: number) =>
  request<MileageStats>(`/mileage/stats?vehicle_id=${vehicleId}`)

// === Vampire Drain ===
/** Fetches the latest canonical parked-drain windows for a vehicle. */
export const getVampireDrainEvents = (vehicleId: number, limit = 100) => {
  const params = new URLSearchParams({ vehicle_id: String(vehicleId), limit: String(limit) })
  return request<VampireDrainEventsResponse>(`/vampire-drain?${params}`)
    .then((response): VampireDrainEvent[] => response?.events ?? [])
}
/** Fetches aggregate 90-day parked-drain statistics. */
export const getVampireDrainStats = (vehicleId: number) =>
  request<VampireDrainStats>(`/vampire-drain/stats?vehicle_id=${vehicleId}`)

// === Visited Locations ===
/** Fetches frequently visited locations, optionally filtered by vehicle. */
export const getVisitedLocations = (vehicleId?: number, limit = 100, offset = 0) =>
  request<VisitedLocation[]>(`/locations?${vehicleId ? `vehicle_id=${vehicleId}&` : ''}limit=${limit}&offset=${offset}`)

// === Trips ===
/** Fetches multi-drive trips, optionally filtered by vehicle and date range. */
export const getTrips = (vehicleId?: number, limit = 50, offset = 0, start?: string, end?: string) => {
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (vehicleId) params.set('vehicle_id', String(vehicleId))
  if (start) params.set('start', start)
  if (end) params.set('end', end)
  return request<Trip[]>(`/trips?${params}`)
}
