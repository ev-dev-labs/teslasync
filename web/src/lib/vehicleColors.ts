/**
 * Vehicle paint palettes for the Digital Twin SVG.
 *
 * The original Digital Twin used a single hard-coded slate gradient that
 * blended into the dark UI background. This module defines a small set of
 * realistic Tesla paint options, each with a complete set of gradient
 * stops + accent colors that the `VehicleTwin` SVG references through a
 * derived color map.
 *
 * Rules of thumb for tuning a new palette:
 *   - `body` gradient: top→bottom 4 stops. Brightest at top, darkest at
 *     bottom. The contrast ratio drives how much the car "pops" against
 *     the dark UI background — for dark paints, brighten the top stop.
 *   - `surface` gradient: subtler than `body`, used for hood / door
 *     panel highlights. Should read as the same color but lower contrast.
 *   - `lower` shadow: pure shadow (any paint), darkens the rocker area.
 *     Kept paint-agnostic.
 *   - `mirror`: the side mirror should look like polished metal regardless
 *     of body color; tinted slightly by the body for cohesion.
 *   - `bodyStroke / bodyHighlight / bodyChrome / bodyShadow`: rgba accent
 *     strings used by `VehicleTwin.tsx` for trim, panel seams, etc.
 *   - `swatch`: opaque hex used by the picker dot.
 *   - `isDark`: when true, the headlight / soft reflection gradients
 *     bias warmer/brighter so the car doesn't disappear at night.
 */

export interface PaintPalette {
  /** Stable id used for storage, broadcast, and option keys. */
  id: PaintPaletteId;
  /** i18n key for the picker label. */
  labelKey: string;
  /** Fallback string when i18n is missing. */
  defaultLabel: string;
  /** Opaque hex color for the picker swatch dot. */
  swatch: string;
  /** Body gradient (top → bottom, 4 stops). */
  body: readonly [string, string, string, string];
  /** Lower shadow gradient (top → bottom, 3 stops). */
  lower: readonly [string, string, string];
  /** Hood / door / quarter-panel surface gradient (3 stops). */
  surface: readonly [string, string, string];
  /** Side mirror gradient (3 stops). */
  mirror: readonly [string, string, string];
  /** Body stroke rgba (panel seams, trim outline). */
  bodyStroke: string;
  /** Bright body highlight rgba (top edge). */
  bodyHighlight: string;
  /** Chrome accent rgba (mirror caps, badges). */
  bodyChrome: string;
  /** Body shadow rgba (under-panel). */
  bodyShadow: string;
  /** True when the body is so dark that headlights need extra glow. */
  isDark: boolean;
}

export type PaintPaletteId =
  | 'pearl-white'
  | 'midnight-silver'
  | 'deep-blue'
  | 'solid-black'
  | 'red-multicoat';

/**
 * The 5 stock Tesla paint colors, hand-tuned for the Digital Twin SVG.
 * Add new entries here and they automatically appear in the picker.
 */
export const PAINT_PALETTES: Record<PaintPaletteId, PaintPalette> = {
  'pearl-white': {
    id: 'pearl-white',
    labelKey: 'paint.pearlWhite',
    defaultLabel: 'Pearl White Multi-Coat',
    swatch: '#e9ecf2',
    // Near-opaque stops: the body must read as a solid painted surface on
    // the dark UI, not a translucent tint (value structure comes from the
    // shading overlays in VehicleTwin, not from see-through stops).
    body: [
      'rgba(255,255,255,0.97)',
      'rgba(244,247,252,0.96)',
      'rgba(228,234,243,0.95)',
      'rgba(188,198,214,0.9)',
    ],
    lower: [
      'rgba(71,85,105,0.18)',
      'rgba(15,23,42,0.5)',
      'rgba(0,0,0,0.78)',
    ],
    surface: [
      'rgba(255,255,255,0.5)',
      'rgba(235,240,248,0.25)',
      'rgba(160,175,195,0.18)',
    ],
    mirror: [
      'rgba(255,255,255,0.95)',
      'rgba(230,236,244,0.9)',
      'rgba(150,163,182,0.85)',
    ],
    bodyStroke: 'rgba(255,255,255,0.25)',
    bodyHighlight: 'rgba(255,255,255,0.32)',
    bodyChrome: 'rgba(241,245,249,0.9)',
    bodyShadow: 'rgba(15,23,42,0.42)',
    isDark: false,
  },
  'midnight-silver': {
    id: 'midnight-silver',
    labelKey: 'paint.midnightSilver',
    defaultLabel: 'Midnight Silver Metallic',
    swatch: '#5b6675',
    body: [
      'rgba(216,226,238,0.95)',
      'rgba(160,174,192,0.94)',
      'rgba(105,120,142,0.94)',
      'rgba(56,68,88,0.92)',
    ],
    lower: [
      'rgba(51,65,85,0.16)',
      'rgba(15,23,42,0.5)',
      'rgba(0,0,0,0.82)',
    ],
    surface: [
      'rgba(226,232,240,0.36)',
      'rgba(100,116,139,0.2)',
      'rgba(15,23,42,0.22)',
    ],
    mirror: [
      'rgba(226,234,244,0.95)',
      'rgba(150,163,182,0.9)',
      'rgba(60,72,92,0.88)',
    ],
    bodyStroke: 'rgba(203,213,225,0.2)',
    bodyHighlight: 'rgba(255,255,255,0.22)',
    bodyChrome: 'rgba(226,232,240,0.85)',
    bodyShadow: 'rgba(15,23,42,0.5)',
    isDark: false,
  },
  'deep-blue': {
    id: 'deep-blue',
    labelKey: 'paint.deepBlue',
    defaultLabel: 'Deep Blue Metallic',
    swatch: '#1f3a72',
    body: [
      'rgba(120,168,240,0.95)',
      'rgba(58,110,205,0.94)',
      'rgba(30,62,132,0.94)',
      'rgba(14,28,66,0.93)',
    ],
    lower: [
      'rgba(30,41,99,0.18)',
      'rgba(15,23,42,0.55)',
      'rgba(0,0,0,0.86)',
    ],
    surface: [
      'rgba(147,197,253,0.4)',
      'rgba(59,130,246,0.22)',
      'rgba(15,23,75,0.32)',
    ],
    mirror: [
      'rgba(180,208,248,0.95)',
      'rgba(70,115,195,0.9)',
      'rgba(18,32,70,0.88)',
    ],
    bodyStroke: 'rgba(147,197,253,0.22)',
    bodyHighlight: 'rgba(191,219,254,0.28)',
    bodyChrome: 'rgba(226,232,240,0.85)',
    bodyShadow: 'rgba(11,18,52,0.62)',
    isDark: false,
  },
  'solid-black': {
    id: 'solid-black',
    labelKey: 'paint.solidBlack',
    defaultLabel: 'Solid Black',
    swatch: '#0d1117',
    body: [
      'rgba(145,158,176,0.92)',
      'rgba(66,77,96,0.94)',
      'rgba(28,35,48,0.96)',
      'rgba(6,9,15,0.97)',
    ],
    lower: [
      'rgba(15,17,22,0.22)',
      'rgba(0,0,0,0.62)',
      'rgba(0,0,0,0.96)',
    ],
    surface: [
      'rgba(203,213,225,0.4)',
      'rgba(71,85,105,0.18)',
      'rgba(0,0,0,0.42)',
    ],
    mirror: [
      'rgba(150,163,182,0.92)',
      'rgba(66,77,96,0.9)',
      'rgba(8,12,20,0.9)',
    ],
    bodyStroke: 'rgba(148,163,184,0.18)',
    bodyHighlight: 'rgba(226,232,240,0.32)',
    bodyChrome: 'rgba(241,245,249,0.92)',
    bodyShadow: 'rgba(0,0,0,0.62)',
    isDark: true,
  },
  'red-multicoat': {
    id: 'red-multicoat',
    labelKey: 'paint.redMulticoat',
    defaultLabel: 'Red Multi-Coat',
    swatch: '#a3001a',
    body: [
      'rgba(250,120,120,0.96)',
      'rgba(226,48,48,0.94)',
      'rgba(155,24,24,0.93)',
      'rgba(70,10,10,0.93)',
    ],
    lower: [
      'rgba(74,7,7,0.2)',
      'rgba(20,3,3,0.6)',
      'rgba(0,0,0,0.88)',
    ],
    surface: [
      'rgba(254,202,202,0.4)',
      'rgba(220,38,38,0.22)',
      'rgba(74,7,7,0.36)',
    ],
    mirror: [
      'rgba(250,140,140,0.95)',
      'rgba(200,55,55,0.9)',
      'rgba(85,12,12,0.88)',
    ],
    bodyStroke: 'rgba(254,202,202,0.22)',
    bodyHighlight: 'rgba(255,228,228,0.3)',
    bodyChrome: 'rgba(241,245,249,0.85)',
    bodyShadow: 'rgba(40,5,5,0.62)',
    isDark: false,
  },
};

/** All paint options in display order — used by the picker. */
export const PAINT_PALETTE_LIST: readonly PaintPalette[] = [
  PAINT_PALETTES['pearl-white'],
  PAINT_PALETTES['midnight-silver'],
  PAINT_PALETTES['deep-blue'],
  PAINT_PALETTES['solid-black'],
  PAINT_PALETTES['red-multicoat'],
];

/**
 * High-contrast default for cars with no exterior_color metadata. Pearl White
 * pops on the dark TeslaSync UI background, which beats Midnight Silver
 * blending into the panel. (See rubber-duck #3 in design discussion.)
 */
export const FALLBACK_PAINT: PaintPalette = PAINT_PALETTES['pearl-white'];

/**
 * Map a Tesla `exterior_color` code (e.g. `"PearlWhite"`,
 * `"MidnightSilverMetallic"`, `"DeepBlueMetallic"`) to a paint palette.
 *
 * The matching is forgiving: case-insensitive, ignores spaces/dashes/
 * underscores, accepts both the bare name and the `Metallic` / `MultiCoat`
 * suffix variants Tesla emits inconsistently across models. Unknown codes
 * fall back to {@link FALLBACK_PAINT}.
 */
export function inferPaintFromTesla(code: string | null | undefined): PaintPalette {
  if (!code) return FALLBACK_PAINT;
  const normalized = code.toLowerCase().replace(/[\s_-]/g, '');
  // Tesla emits these variants: "PearlWhite", "PearlWhiteMultiCoat",
  // "PearlWhiteMulticoat", "MidnightSilver", "MidnightSilverMetallic",
  // "DeepBlue", "DeepBlueMetallic", "SolidBlack", "Black", "RedMulticoat",
  // "RedMultiCoat", etc.
  if (normalized.startsWith('pearl') || normalized === 'white') return PAINT_PALETTES['pearl-white'];
  if (normalized.startsWith('midnightsilver') || normalized === 'silver') return PAINT_PALETTES['midnight-silver'];
  if (normalized.startsWith('deepblue') || normalized === 'blue' || normalized === 'darkblue') return PAINT_PALETTES['deep-blue'];
  if (normalized.startsWith('solidblack') || normalized === 'black' || normalized === 'obsidianblack') return PAINT_PALETTES['solid-black'];
  if (normalized.startsWith('red') || normalized === 'multicoatred') return PAINT_PALETTES['red-multicoat'];
  return FALLBACK_PAINT;
}

/**
 * Type-guard for the picker — narrows arbitrary strings (e.g. a stale
 * localStorage value) into a known PaintPaletteId.
 */
export function isPaintPaletteId(value: unknown): value is PaintPaletteId {
  return typeof value === 'string' && value in PAINT_PALETTES;
}

/**
 * Color map consumed by `VehicleTwin.tsx`. Mirrors the legacy `C` constant
 * shape but is now derived from the active palette.
 */
export interface PaintColorMap {
  readonly bodyStroke: string;
  readonly bodyHighlight: string;
  readonly bodyChrome: string;
  readonly bodyShadow: string;
  readonly cladding: string;
  readonly glassClosed: string; // url(#...) ref written by callsite
  readonly glassStroke: string;
  readonly glassOpen: string;
  readonly glassPartial: string;
  readonly glassUnknown: string;
  readonly doorClosed: string;
  readonly doorOpen: string;
  readonly doorUnknown: string;
  readonly headlightOff: string;
  readonly headlightOn: string;
  readonly headlightBeam: string;
  readonly headlightGlow: string;
  readonly taillightBase: string;
  readonly taillightActive: string;
  readonly amber: string;
  readonly amberFill: string;
  readonly chargeGreen: string;
  readonly chargeGreenFill: string;
  readonly lockedGreen: string;
  readonly unlockedRed: string;
  readonly sentryRed: string;
  readonly sentryGlow: string;
  readonly seatOccupied: string;
  readonly frunkTrunkOpen: string;
  readonly neutral: string;
  readonly shadow: string;
  readonly wheelDark: string;
  readonly wheelSidewall: string;
  readonly wheelStroke: string;
}

/**
 * Build the `C`-equivalent color map for a paint palette. The non-paint
 * accent colors (lights, locks, charging) are intentionally fixed so that
 * status semantics stay consistent across paints.
 *
 * `glassClosedRef` should be the rendered `url(#…)` string for the per-twin
 * glass gradient (constructed by the caller via `useId()`).
 */
export function buildColorMap(paint: PaintPalette, glassClosedRef: string): PaintColorMap {
  return {
    bodyStroke: paint.bodyStroke,
    bodyHighlight: paint.bodyHighlight,
    bodyChrome: paint.bodyChrome,
    bodyShadow: paint.bodyShadow,
    cladding: 'rgba(2,6,23,0.7)',
    glassClosed: glassClosedRef,
    glassStroke: 'rgba(125,211,252,0.32)',
    glassOpen: 'rgba(3,7,18,0.72)',
    glassPartial: 'rgba(100,200,255,0.05)',
    glassUnknown: 'rgba(255,255,255,0.04)',
    doorClosed: 'rgba(255,255,255,0.13)',
    doorOpen: 'rgba(251,191,36,0.72)',
    doorUnknown: 'rgba(255,255,255,0.07)',
    headlightOff: 'rgba(255,255,255,0.14)',
    // Dark cars get a slightly warmer / brighter beam so the front of the
    // car still has some definition against a dark background.
    headlightOn: paint.isDark ? 'rgba(255,250,205,0.95)' : 'rgba(255,255,220,0.9)',
    headlightBeam: paint.isDark ? 'rgba(255,250,205,0.12)' : 'rgba(255,255,220,0.08)',
    headlightGlow: 'rgba(34,211,238,0.35)',
    taillightBase: 'rgba(239,68,68,0.45)',
    taillightActive: 'rgba(239,68,68,0.85)',
    amber: 'rgba(251,191,36,0.78)',
    amberFill: 'rgba(251,191,36,0.18)',
    chargeGreen: 'rgba(34,197,94,0.82)',
    chargeGreenFill: 'rgba(34,197,94,0.22)',
    lockedGreen: 'rgba(34,197,94,0.9)',
    unlockedRed: 'rgba(239,68,68,0.9)',
    sentryRed: 'rgba(239,68,68,0.8)',
    sentryGlow: 'rgba(239,68,68,0.35)',
    seatOccupied: 'rgba(34,211,238,0.32)',
    frunkTrunkOpen: 'rgba(251,191,36,0.2)',
    neutral: 'rgba(255,255,255,0.05)',
    shadow: 'rgba(0,0,0,0.48)',
    wheelDark: 'rgba(0,0,0,0.94)',
    wheelSidewall: 'rgba(7,12,24,0.96)',
    wheelStroke: 'rgba(255,255,255,0.12)',
  };
}
