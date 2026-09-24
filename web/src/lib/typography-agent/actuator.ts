/**
 * Writes the harmonized token layer into the CSS cascade.
 *
 * Token-layer ONLY: this actuator manages a single `<style>` tag holding
 * `:root` custom properties. It emits no element selectors, so it cannot
 * fight Tailwind utilities or FontProvider (the single writer of family /
 * scale / leading / tracking vars). Components opt into the fluid scale
 * by referencing `var(--type-size-*)` / `var(--type-lh-*)` /
 * `--type-track-*` — plain `var(--*)` references the observer treats as
 * compliant.
 *
 * No-DOM environments (SSR, unit tests) are safe no-ops.
 */
export class TypographyActuator {
  static readonly STYLE_ID = 'connected-typography-layer';

  public static applyTokens(tokens: Record<string, string>): void {
    if (typeof document === 'undefined') return;
    let styleTag = document.getElementById(this.STYLE_ID) as HTMLStyleElement | null;
    if (!styleTag) {
      styleTag = document.createElement('style');
      styleTag.id = this.STYLE_ID;
      document.head.appendChild(styleTag);
    }

    const cssTokens = Object.entries(tokens)
      .map(([prop, val]) => `  ${prop}: ${val};`)
      .join('\n');

    styleTag.textContent = `:root {\n  --type-system-active: 1;\n${cssTokens}\n}\n`;
  }

  /** Removes the token layer (used by tests and the reset path). */
  public static clearTokens(): void {
    if (typeof document === 'undefined') return;
    document.getElementById(this.STYLE_ID)?.remove();
  }
}
