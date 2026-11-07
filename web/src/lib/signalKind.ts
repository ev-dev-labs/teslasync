import type { SignalKind } from '@/api/types'

const SIGNAL_KINDS = new Map<unknown, SignalKind>([
  [1, 'string'], [2, 'bool'], [3, 'int'], [4, 'int'],
  [5, 'float'], [6, 'float'], [7, 'int'], [9, 'time'],
  ['ValueKindString', 'string'], ['ValueKindBool', 'bool'],
  ['ValueKindInt32', 'int'], ['ValueKindInt64', 'int'], ['ValueKindEnum', 'int'],
  ['ValueKindFloat', 'float'], ['ValueKindDouble', 'float'], ['ValueKindTime', 'time'],
  ['string', 'string'], ['bool', 'bool'], ['int', 'int'], ['float', 'float'], ['time', 'time'],
])

/**
 * Normalize Fleet Telemetry's numeric or long-form ValueKind into the compact
 * signal kind shared by live SSE and route-only signal history queries.
 */
export function normalizeSignalKind(raw: unknown, value?: unknown): SignalKind {
  // Live inspection retains proto Enum metadata after codec string decoding.
  if ((raw === 7 || raw === 'ValueKindEnum') && typeof value === 'string') return 'string'
  return SIGNAL_KINDS.get(raw) ?? 'unknown'
}
