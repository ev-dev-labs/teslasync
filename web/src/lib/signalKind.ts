import type { SignalKind } from '@/api/types'

/**
 * Normalize Fleet Telemetry's numeric or long-form ValueKind into the compact
 * signal kind shared by live SSE and route-only signal history queries.
 */
export function normalizeSignalKind(raw: unknown): SignalKind {
  if (typeof raw === 'number') {
    // Mirrors the iota order in internal/tesla/protomodel/types.go.
    switch (raw) {
      case 1: return 'string'
      case 2: return 'bool'
      case 3: return 'int'    // ValueKindInt32
      case 4: return 'int'    // ValueKindInt64
      case 5: return 'float'  // ValueKindFloat
      case 6: return 'float'  // ValueKindDouble
      case 7: return 'int'    // ValueKindEnum (wire-format integer)
      case 9: return 'time'
      default: return 'unknown'
    }
  }
  if (typeof raw === 'string') {
    switch (raw) {
      case 'ValueKindString':
      case 'string':
        return 'string'
      case 'ValueKindBool':
      case 'bool':
        return 'bool'
      case 'ValueKindInt32':
      case 'ValueKindInt64':
      case 'ValueKindEnum':
      case 'int':
        return 'int'
      case 'ValueKindFloat':
      case 'ValueKindDouble':
      case 'float':
        return 'float'
      case 'ValueKindTime':
      case 'time':
        return 'time'
      default:
        return 'unknown'
    }
  }
  return 'unknown'
}
