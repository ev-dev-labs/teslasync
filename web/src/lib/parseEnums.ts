/**
 * Centralized Tesla Fleet Telemetry enum parsers.
 * Tesla sends enums as strings like "SentryModeStateArmed",
 * "DetailedChargeStateComplete", "HvacPowerStateOff", etc.
 */

/** Convert Tesla enum string to boolean. True if not "Off"/"false"/"". */
export function parseEnumBool(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return raw !== '' && !raw.includes('Off') && raw !== 'false' && raw !== '0'
  if (typeof raw === 'number') return raw !== 0
  return false
}

/** Convert Tesla BuckleStatus enum to boolean.
 * "BuckleStatusLatched" → true (buckled), anything else → false. */
export function parseBuckleStatus(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'string') return raw === 'BuckleStatusLatched'
  if (typeof raw === 'number') return raw !== 0
  return false
}

/** Check if DetailedChargeState indicates active charging. */
export function isCharging(raw: string): boolean {
  return raw.includes('Charging') || raw.includes('Starting') || raw === 'Enable'
}

/** Check if DetailedChargeState indicates charge complete. */
export function isChargeComplete(raw: string): boolean {
  return raw.includes('Complete')
}

/** Parse HVAC power state to boolean. */
export function parseHvacPower(raw: string): boolean {
  return raw.includes('On') || raw.includes('Precondition')
}

/** Parse window state to clean display value. */
export function parseWindowState(raw: string): string {
  const g = raw.replace(/WindowState/i, '')
  if (g.includes('Closed')) return 'Closed'
  if (g.includes('Partial')) return 'Partial'
  if (g.includes('Open')) return 'Open'
  return g || raw
}

/** Parse cabin overheat protection mode. */
export function parseCabinOverheatMode(raw: string): string {
  const g = raw.replace(/CabinOverheatProtectionModeState/i, '')
  if (g.includes('On')) return 'On'
  if (g.includes('Off')) return 'Off'
  if (g.includes('FanOnly')) return 'Fan Only'
  return g || raw
}

/** Parse climate keeper mode. */
export function parseClimateKeeperMode(raw: string): string {
  const g = raw.replace(/ClimateKeeperModeState/i, '')
  if (g.includes('Off')) return 'Off'
  if (g.includes('On')) return 'On'
  if (g.includes('Dog')) return 'Dog Mode'
  if (g.includes('Camp')) return 'Camp Mode'
  return g || raw
}

/** Parse charge port state. */
export function parseChargePort(raw: string): string {
  const g = raw.replace(/^ChargePort/i, '')
  if (g.includes('Open')) return 'Open'
  if (g.includes('Closed')) return 'Closed'
  return g || raw
}

/** Parse charge port latch state. */
export function parseChargePortLatch(raw: string): string {
  const g = raw.replace(/^ChargePortLatch/i, '')
  if (g.includes('Engaged')) return 'Engaged'
  if (g.includes('Disengaged')) return 'Disengaged'
  return g || raw
}

// Re-export existing centralized parsers for convenience
export { parseGear, GEAR_COLORS, GEAR_BG_COLORS } from './gear'
export { parseSettingEnum } from './parseSettingEnum'
