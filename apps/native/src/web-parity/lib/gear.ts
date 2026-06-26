// Native parity port of web/src/lib/gear.ts.
//
// Tesla ShiftState enum -> gear-letter parser plus the gear color/badge token
// maps. Pure string logic with no DOM/web-UI dependency. The Tailwind class
// strings in GEAR_COLORS / GEAR_BG_COLORS are preserved verbatim as plain data
// (a future native consumer maps them to RN style tokens) so the centralized
// re-export surface through parseEnums.ts stays identical. Created as a
// supporting module because parseEnums.ts re-exports
// parseGear / GEAR_COLORS / GEAR_BG_COLORS from here and the web module is not a
// separate file-parity manifest entry. Only native house style differs:
// semicolons and @react-native eslint `curly` braces around the single-line
// `if` bodies (behavior unchanged).

/**
 * Parse Tesla's ShiftState enum values to a simple gear letter.
 * Tesla sends: "ShiftStateDrive", "ShiftStateReverse", "ShiftStatePark", "ShiftStateNeutral", "ShiftStateInvalid"
 * Returns: "D", "R", "P", "N", or null if unknown/empty.
 */
export function parseGear(raw?: string | null): 'D' | 'R' | 'P' | 'N' | null {
  if (!raw || raw === '<nil>' || raw === '') {
    return null;
  }
  // Strip "ShiftState" prefix: Tesla sends "ShiftStateD", "ShiftStateP", etc.
  const g = raw.toUpperCase().replace('SHIFTSTATE', '');
  if (g === 'D' || g.includes('DRIVE')) {
    return 'D';
  }
  if (g === 'R' || g.includes('REVERSE')) {
    return 'R';
  }
  if (g === 'P' || g.includes('PARK')) {
    return 'P';
  }
  if (g === 'N' || g.includes('NEUTRAL')) {
    return 'N';
  }
  return null;
}

export const GEAR_COLORS: Record<string, string> = {
  D: 'text-emerald-300',
  R: 'text-rose-300',
  P: 'text-cyan-300',
  N: 'text-amber-300',
};

export const GEAR_BG_COLORS: Record<string, string> = {
  D: 'bg-neon-green/10 text-neon-green',
  R: 'bg-neon-red/10 text-neon-red',
  P: 'bg-neon-cyan/10 text-neon-cyan',
  N: 'bg-neon-amber/10 text-neon-amber',
};

/** Badge color name for the shared Badge component */
export const GEAR_BADGE_COLORS: Record<
  string,
  'green' | 'red' | 'cyan' | 'amber' | 'neutral'
> = {
  D: 'green',
  R: 'red',
  P: 'cyan',
  N: 'amber',
};
