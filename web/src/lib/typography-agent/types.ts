/**
 * Connected Typography agent — shared types.
 *
 * The agent runs an Observe-Harmonize-Actuate-Verify loop over the app's
 * typography: it compiles a modular-ratio fluid scale into CSS tokens,
 * applies them to the cascade, then scans the live DOM for regressions
 * (overflows, hardcoded leaks, line-length excess) and self-heals.
 *
 * Ownership split with FontProvider (the single writer of
 * `--font-sans` / `--font-mono` / `--font-scale` / `--leading` /
 * `--tracking` / `--font-weight-bold`): this agent owns ONLY the derived
 * fluid scale layer (`--type-size-*`, `--type-lh-*`, `--type-track-*`).
 * Font families stay in TypographySettings; the agent never writes them.
 */

/** Named modular-scale ratios and their multipliers (see RATIO_VALUES). */
export type ModularRatio =
  | 'minorSecond' // 1.067
  | 'majorSecond' // 1.125
  | 'minorThird' // 1.200
  | 'majorThird' // 1.250
  | 'perfectFourth' // 1.333
  | 'goldenRatio'; // 1.618

/** Density modes driving the leading multiplier. */
export type DensityMode = 'compact' | 'comfortable' | 'relaxed';

/**
 * The full typographic intent the loop harmonizes. Families are
 * deliberately absent — FontProvider owns them (see module doc).
 */
export interface TypographySpec {
  ratio: ModularRatio;
  /** Body size (scale step 0) at the small end of the fluid range, px. */
  baseSizeMinPx: number;
  /** Body size (scale step 0) at the large end of the fluid range, px. */
  baseSizeMaxPx: number;
  /** Viewport width where sizes bottom out, px. */
  viewportMinPx: number;
  /** Viewport width where sizes top out, px. */
  viewportMaxPx: number;
  density: DensityMode;
}

export type AnomalyType = 'TEXT_OVERFLOW' | 'LOW_CONTRAST' | 'HARDCODED_LEAK' | 'LINE_LENGTH_EXCESS';

export type AnomalySeverity = 'critical' | 'warning' | 'info';

export interface NodeAnomaly {
  /** Breadcrumb selector locating the element (stable across renders). */
  selector: string;
  type: AnomalyType;
  severity: AnomalySeverity;
  details: string;
}

export interface VerificationResult {
  passed: boolean;
  /** 0–100; criticals cost 25, warnings 5. */
  score: number;
  anomalies: NodeAnomaly[];
}
