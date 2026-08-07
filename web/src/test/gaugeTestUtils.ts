/**
 * Test helpers for reading a rendered {@link LinearGauge}.
 *
 * These exist so gauge assertions are written against one place. The suite used
 * to reach into SVG internals (`circle[stroke="#10b981"]`,
 * `stroke-dashoffset`) because the gauges were radial rings; when the rings
 * were replaced by linear tracks, every one of those assertions broke in a way
 * that said nothing about the behaviour under test. Centralising the DOM shape
 * here means a future change to the gauge's markup is a one-file edit.
 */

/** jsdom serialises inline colours as `rgb(r, g, b)`; tests speak hex. */
export function rgbToHex(value: string): string {
  const m = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return value;
  const hex = (n: string) => Number(n).toString(16).padStart(2, '0');
  return `#${hex(m[1])}${hex(m[2])}${hex(m[3])}`;
}

/** Every gauge fill element in render order (one per LinearGauge). */
export function gaugeFills(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[style*="width"]')).filter((el) =>
    el.style.backgroundColor !== '',
  );
}

/**
 * The fill colour of every gauge, as lowercase hex.
 *
 * Drop-in replacement for the old `circleStrokes()` helpers, so existing
 * `expect(...).toContain('#10b981')` assertions keep reading naturally.
 */
export function gaugeColors(container: HTMLElement): string[] {
  return gaugeFills(container).map((el) => rgbToHex(el.style.backgroundColor).toLowerCase());
}

/** The fill colour of a single gauge (defaults to the first one rendered). */
export function gaugeColor(container: HTMLElement, index = 0): string | undefined {
  return gaugeColors(container)[index];
}

/** Whether any gauge in the tree is painted the given colour. */
export function hasGaugeColor(container: HTMLElement, hex: string): boolean {
  return gaugeColors(container).includes(hex.toLowerCase());
}

/**
 * Whether a gauge was rendered at all.
 *
 * Replaces presence checks that used to select the ring's rotated `<svg>`
 * (`svg[class~="-rotate-90"]`), which no longer exists.
 */
export function hasGauge(container: HTMLElement): boolean {
  return gaugeFills(container).length > 0;
}

/**
 * The filled fraction of a gauge as a `"NN%"` string — the linear equivalent of
 * the old `stroke-dashoffset` arc-length assertions.
 */
export function gaugeWidth(container: HTMLElement, index = 0): string {
  return gaugeFills(container)[index]?.style.width ?? '';
}

/** The filled fraction of a gauge as a number in [0, 100]. */
export function gaugeFraction(container: HTMLElement, index = 0): number {
  return Number.parseFloat(gaugeWidth(container, index)) || 0;
}
