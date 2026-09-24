import type { NodeAnomaly, TypographySpec, VerificationResult } from './types';
import { TypographyObserver } from './observer';

/** Score penalties per anomaly severity. */
export const CRITICAL_PENALTY = 25;
export const WARNING_PENALTY = 5;

/** Floor for the auto-heal base-size step-down (px). */
export const HEAL_BASE_SIZE_FLOOR_PX = 15;
export const HEAL_BASE_SIZE_STEP_PX = 0.5;

/**
 * Scores a harmonized spec against the live DOM and derives a healed spec
 * when critical regressions appear. `heal` is pure (unit-testable);
 * `evaluate` waits a repaint so computed styles settle, then scans.
 */
export class TypographyVerifier {
  private observer: TypographyObserver;

  constructor(observer: TypographyObserver = new TypographyObserver()) {
    this.observer = observer;
  }

  public async evaluate(
    spec: TypographySpec,
    nextFrame: () => Promise<void> = defaultNextFrame,
  ): Promise<VerificationResult> {
    void spec;
    await nextFrame();
    return scoreAnomalies(this.observer.observe());
  }

  /**
   * Healing policy: text overflow first steps density down (relaxed →
   * comfortable → compact), then shrinks the fluid ceiling toward the
   * floor. Never touches ratio, families, or viewport bounds.
   */
  public heal(spec: TypographySpec, result: VerificationResult): TypographySpec {
    if (!result.anomalies.some((a) => a.type === 'TEXT_OVERFLOW')) {
      return { ...spec };
    }
    if (spec.density === 'relaxed') {
      return { ...spec, density: 'comfortable' };
    }
    if (spec.density === 'comfortable') {
      return { ...spec, density: 'compact' };
    }
    if (spec.baseSizeMaxPx > HEAL_BASE_SIZE_FLOOR_PX) {
      return { ...spec, baseSizeMaxPx: spec.baseSizeMaxPx - HEAL_BASE_SIZE_STEP_PX };
    }
    return { ...spec };
  }
}

/** Pure scoring shared by evaluate and tests. */
export function scoreAnomalies(anomalies: ReadonlyArray<NodeAnomaly>): VerificationResult {
  const criticals = anomalies.filter((a) => a.severity === 'critical');
  const warnings = anomalies.filter((a) => a.severity === 'warning');
  return {
    passed: criticals.length === 0,
    score: Math.max(0, 100 - criticals.length * CRITICAL_PENALTY - warnings.length * WARNING_PENALTY),
    anomalies: [...anomalies],
  };
}

function defaultNextFrame(): Promise<void> {
  if (typeof requestAnimationFrame === 'undefined') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
