/**
 * Centralized Tesla Fleet Telemetry enum parsers.
 * Tesla sends enums as strings like "SentryModeStateArmed",
 * "DetailedChargeStateComplete", "HvacPowerStateOff", etc.
 *
 * Post per-field MQTT cutover (Phase-42a) the backend serializes raw
 * `signal.SignalValue` (`interface{}`) directly, so a "string-enum" signal
 * may also arrive as bool/number for some signals. Every parser here
 * accepts `unknown` and narrows defensively. We do NOT coerce non-strings
 * to strings — `String(false)` would erroneously match enum substrings
 * like "Off" and silently flip semantic state.
 */

import { asNonEmptyString } from './typeGuards'

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
export function isCharging(raw: unknown): boolean {
  const s = asNonEmptyString(raw)
  if (!s) return false
  return s.includes('Charging') || s.includes('Starting') || s === 'Enable'
}

/** Check if DetailedChargeState indicates charge complete. */
export function isChargeComplete(raw: unknown): boolean {
  const s = asNonEmptyString(raw)
  if (!s) return false
  return s.includes('Complete')
}

/** Parse HVAC power state to boolean. Accepts native booleans transparently. */
export function parseHvacPower(raw: unknown): boolean {
  if (typeof raw === 'boolean') return raw
  const s = asNonEmptyString(raw)
  if (!s) return false
  return s.includes('On') || s.includes('Precondition')
}

/** Parse window state to clean display value. */
export function parseWindowState(raw: unknown): string {
  const s = asNonEmptyString(raw)
  if (!s) return ''
  const g = s.replace(/WindowState/i, '')
  if (g.includes('Closed')) return 'Closed'
  if (g.includes('Partial')) return 'Partial'
  if (g.includes('Open')) return 'Open'
  return g || s
}

/** Parse cabin overheat protection mode.
 *  Check multi-word variants (FanOnly, NoCooling) before single-word (On)
 *  because "FanOnly" contains the substring "On". */
export function parseCabinOverheatMode(raw: unknown): string {
  const s = asNonEmptyString(raw)
  if (!s) return ''
  const g = s.replace(/CabinOverheatProtectionModeState/i, '')
  if (g.includes('FanOnly')) return 'Fan Only'
  if (g.includes('NoCooling')) return 'No Cooling'
  if (g.includes('On')) return 'On'
  if (g.includes('Off')) return 'Off'
  return g || s
}

/** Parse climate keeper mode. */
export function parseClimateKeeperMode(raw: unknown): string {
  const s = asNonEmptyString(raw)
  if (!s) return ''
  const g = s.replace(/ClimateKeeperModeState/i, '')
  if (g.includes('Off')) return 'Off'
  if (g.includes('On')) return 'On'
  if (g.includes('Dog')) return 'Dog Mode'
  if (g.includes('Camp')) return 'Camp Mode'
  return g || s
}

/** Parse charge port state. */
export function parseChargePort(raw: unknown): string {
  const s = asNonEmptyString(raw)
  if (!s) return ''
  const g = s.replace(/^ChargePort/i, '')
  if (g.includes('Open')) return 'Open'
  if (g.includes('Closed')) return 'Closed'
  return g || s
}

/** Parse charge port latch state. */
export function parseChargePortLatch(raw: unknown): string {
  const s = asNonEmptyString(raw)
  if (!s) return ''
  const g = s.replace(/^ChargePortLatch/i, '')
  if (g.includes('Engaged')) return 'Engaged'
  if (g.includes('Disengaged')) return 'Disengaged'
  return g || s
}

// Re-export existing centralized parsers for convenience
export { parseGear, GEAR_COLORS, GEAR_BG_COLORS } from './gear'
export { parseSettingEnum } from './parseSettingEnum'
