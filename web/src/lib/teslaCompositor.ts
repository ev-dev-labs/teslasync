/**
 * Tesla configurator "compositor" image support for the Digital Twin.
 *
 * The compositor is the same public endpoint the Tesla configurator and
 * mobile app use to render studio images of a car. We request the SIDE
 * view in the twin's paint color and overlay live telemetry indicators on
 * top of it (see `VehicleTwin`). When the image cannot load (offline, CSP,
 * endpoint change), the twin falls back to its hand-drawn SVG rendering.
 */

import type { PaintPaletteId } from './vehicleColors';

/** Tesla option codes for the 5 stock paints, per compositor `options=`. */
export const COMPOSITOR_PAINT_CODES: Record<PaintPaletteId, string> = {
  'pearl-white': '$PPSW',
  'midnight-silver': '$PMNG',
  'deep-blue': '$PPSB',
  'solid-black': '$PBSB',
  'red-multicoat': '$PPMR',
};

export type CompositorModelCode = 'my' | 'm3' | 'ms' | 'mx';

/**
 * Map a Tesla `Vehicle.model` string (e.g. "modely", "Model Y", "Y") to a
 * compositor model code. Forgiving on formatting; defaults to Model Y.
 */
export function compositorModelCode(model?: string | null): CompositorModelCode {
  const m = (model ?? '').toLowerCase().replace(/[\s_-]/g, '');
  if (m.includes('model3') || m.endsWith('3')) return 'm3';
  if (m.includes('models') || m === 'ms' || m === 's') return 'ms';
  if (m.includes('modelx') || m === 'mx' || m === 'x') return 'mx';
  return 'my';
}

/** Trim + wheel codes known to produce a valid render per model. */
const MODEL_OPTION_CODES: Record<CompositorModelCode, { trim: string; wheels: string }> = {
  my: { trim: '$MTY07', wheels: '$WY19B' },
  m3: { trim: '$MT322', wheels: '$W38B' },
  ms: { trim: '$MTS10', wheels: '$WS90' },
  mx: { trim: '$MTX10', wheels: '$WX00' },
};

/**
 * Build the SIDE-view compositor URL for a paint + model. The `$`/`,`
 * characters are deliberately left unencoded — that is the URL shape the
 * configurator itself emits.
 */
export function buildCompositorUrl(
  paintId: PaintPaletteId,
  model?: string | null,
  size = 1400,
): string {
  const code = compositorModelCode(model);
  const { trim, wheels } = MODEL_OPTION_CODES[code];
  const paint = COMPOSITOR_PAINT_CODES[paintId];
  return (
    'https://static-assets.tesla.com/configurator/compositor'
    + `?context=design_studio_2&options=${trim},${paint},${wheels},$INPB0`
    + `&view=SIDE&model=${code}&size=${size}&bkba_opt=1`
  );
}

/**
 * Measured geometry of the Model Y SIDE render (alpha-channel trace at the
 * image's natural 1440×810 basis): where the car sits inside the bitmap.
 * The twin's SVG geometry was traced from the same render, so these values
 * let the overlay SVG and the photo share one coordinate system:
 * image `carLeft..carRight` ↔ viewBox x `43..556`, image `ground` ↔
 * viewBox y `263`.
 */
export const COMPOSITOR_METRICS = {
  imgWidth: 1440,
  imgHeight: 810,
  carLeft: 308,
  carRight: 1129,
  ground: 517,
  /**
   * Hub centers measured directly in the 1440×810 Model Y compositor image.
   * Keep these in image space so the photo and rotating crop share one
   * coordinate system; fallback-SVG geometry cannot move the photo pivots.
  */
  wheels: {
    front: { x: 441.3, y: 458.5 },
    rear: { x: 982.3, y: 457.9 },
  },
  /**
   * Rim crop in compositor-image pixels. The final four pixels are only a
   * blend band: the fully rotating area still ends inside the alloy face,
   * while the transparent outer edge lands on the natural rim/tire boundary.
   */
  wheelCropRadius: 54,
  wheelCropFeather: 4,
} as const;
