/**
 * Writes the harmonized token layer into the CSS cascade.
 *
 * Token-layer ONLY: this actuator manages root custom properties without
 * injecting a stylesheet blocked by CSP. It emits no element selectors, so it cannot
 * fight Tailwind utilities or FontProvider (the single writer of family /
 * scale / leading / tracking vars). Components opt into the fluid scale
 * by referencing `var(--type-size-*)` / `var(--type-lh-*)` /
 * `--type-track-*` — plain `var(--*)` references the observer treats as
 * compliant.
 *
 * No-DOM environments (SSR, unit tests) are safe no-ops.
 */
export class TypographyActuator {
  private static previousValues = new Map<string, { value: string; priority: string }>();

  public static applyTokens(tokens: Record<string, string>): void {
    if (typeof document === 'undefined') return;
    this.clearTokens();
    const style = document.documentElement.style;
    for (const [property, value] of Object.entries({ ...tokens, '--type-system-active': '1' })) {
      this.previousValues.set(property, {
        value: style.getPropertyValue(property),
        priority: style.getPropertyPriority(property),
      });
      style.setProperty(property, value);
    }
  }

  /** Restores prior values without clearing unrelated font or theme properties. */
  public static clearTokens(): void {
    if (typeof document === 'undefined') return;
    const style = document.documentElement.style;
    for (const [property, previous] of this.previousValues) {
      if (previous.value) style.setProperty(property, previous.value, previous.priority);
      else style.removeProperty(property);
    }
    this.previousValues.clear();
  }
}
