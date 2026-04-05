/**
 * Parse Tesla's ShiftState enum values to a simple gear letter.
 * Tesla sends: "ShiftStateDrive", "ShiftStateReverse", "ShiftStatePark", "ShiftStateNeutral", "ShiftStateInvalid"
 * Returns: "D", "R", "P", "N", or null if unknown/empty.
 */
export function parseGear(raw?: string | null): 'D' | 'R' | 'P' | 'N' | null {
  if (!raw || raw === '<nil>' || raw === '') return null
  const g = raw.toUpperCase()
  if (g.includes('DRIVE') || g === 'D') return 'D'
  if (g.includes('REVERSE') || g === 'R') return 'R'
  if (g.includes('PARK') || g === 'P') return 'P'
  if (g.includes('NEUTRAL') || g === 'N') return 'N'
  return null
}

export const GEAR_COLORS: Record<string, string> = {
  D: 'text-neon-green',
  R: 'text-neon-red',
  P: 'text-neon-cyan',
  N: 'text-neon-amber',
}

export const GEAR_BG_COLORS: Record<string, string> = {
  D: 'bg-neon-green/10 text-neon-green',
  R: 'bg-neon-red/10 text-neon-red',
  P: 'bg-neon-cyan/10 text-neon-cyan',
  N: 'bg-neon-amber/10 text-neon-amber',
}
