import type { TypographySpec, VerificationResult } from './types';
import { TypographyHarmonizer } from './harmonizer';
import { TypographyActuator } from './actuator';
import { TypographyVerifier } from './verifier';

/** localStorage key following the repo's `teslasync-*` convention. */
export const TYPOGRAPHY_SPEC_STORAGE_KEY = 'teslasync-typography-spec';

/** Conservative factory spec: major-third scale, comfortable density. */
export const DEFAULT_TYPOGRAPHY_SPEC: TypographySpec = {
  ratio: 'majorThird',
  baseSizeMinPx: 15,
  baseSizeMaxPx: 17,
  viewportMinPx: 360,
  viewportMaxPx: 1440,
  density: 'comfortable',
};

export type SpecSubscriber = (spec: TypographySpec, result: VerificationResult) => void;

export interface AgentLoopDeps {
  harmonizer?: TypographyHarmonizer;
  verifier?: TypographyVerifier;
}

/**
 * Master orchestrator binding Harmonize → Actuate → Verify → Heal into one
 * event-driven loop with persistence and subscriber broadcast.
 *
 * Persistence is localStorage + in-memory broadcast today. Backend sync is
 * deliberately NOT wired to an invented endpoint: subscribers (e.g. a
 * future settings-sync effect) receive every committed spec and can push
 * it through the existing `/settings` pipeline. Cross-tab sync rides the
 * `typography.spec.changed` broadcast topic (see TypographyAgentProvider).
 */
export class TypographyAgentLoop {
  private harmonizer: TypographyHarmonizer;
  private verifier: TypographyVerifier;
  private spec: TypographySpec;
  private subscribers = new Set<SpecSubscriber>();

  constructor(initialSpec: TypographySpec = DEFAULT_TYPOGRAPHY_SPEC, deps: AgentLoopDeps = {}) {
    this.spec = { ...initialSpec };
    this.harmonizer = deps.harmonizer ?? new TypographyHarmonizer();
    this.verifier = deps.verifier ?? new TypographyVerifier();
  }

  /**
   * Applies a spec patch through the full loop (harmonize → actuate →
   * verify → heal-once → re-verify), broadcasts, and persists.
   */
  public async dispatch(patch: Partial<TypographySpec>): Promise<VerificationResult> {
    this.spec = { ...this.spec, ...patch };

    TypographyActuator.applyTokens(this.harmonizer.compileTokens(this.spec));

    let verification = await this.verifier.evaluate(this.spec);

    if (!verification.passed) {
      this.spec = this.verifier.heal(this.spec, verification);
      TypographyActuator.applyTokens(this.harmonizer.compileTokens(this.spec));
      verification = await this.verifier.evaluate(this.spec);
    }

    this.subscribers.forEach((cb) => cb(this.spec, verification));
    this.persist();

    return verification;
  }

  /** Re-applies the current spec without changes (mount / tab-sync path). */
  public async refresh(): Promise<VerificationResult> {
    TypographyActuator.applyTokens(this.harmonizer.compileTokens(this.spec));
    const verification = await this.verifier.evaluate(this.spec);
    this.subscribers.forEach((cb) => cb(this.spec, verification));
    return verification;
  }

  public subscribe(cb: SpecSubscriber): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  public get currentSpec(): TypographySpec {
    return { ...this.spec };
  }

  public persist(): void {
    try {
      localStorage.setItem(TYPOGRAPHY_SPEC_STORAGE_KEY, JSON.stringify(this.spec));
    } catch {
      // Private-mode / SSR: the loop still works in-memory.
    }
  }

  /** Reads a previously persisted spec, or null when absent/invalid. */
  public static loadPersisted(): TypographySpec | null {
    try {
      const raw = localStorage.getItem(TYPOGRAPHY_SPEC_STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<TypographySpec>;
      if (
        typeof parsed.ratio !== 'string' ||
        typeof parsed.baseSizeMinPx !== 'number' ||
        typeof parsed.baseSizeMaxPx !== 'number' ||
        typeof parsed.viewportMinPx !== 'number' ||
        typeof parsed.viewportMaxPx !== 'number' ||
        typeof parsed.density !== 'string'
      ) {
        return null;
      }
      return parsed as TypographySpec;
    } catch {
      return null;
    }
  }
}
