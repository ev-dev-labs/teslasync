import type {
  AutomationStep,
  AutomationStepKind,
} from '@/types/automations';

/**
 * Discriminated-union type guard narrowing an automation step to a `kind`.
 *
 * Accepts (and returns `false` for) a nullish step on purpose: callers routinely
 * probe values that may be absent — an optional field on a partial API payload,
 * the result of a preceding `findStepByKind`, a half-built step in an editor —
 * and a bare `step.kind` access would throw `Cannot read properties of
 * undefined` on those.
 */
export function isStep<K extends AutomationStepKind>(
  step: AutomationStep | null | undefined,
  kind: K,
): step is Extract<AutomationStep, { kind: K }> {
  return step != null && step.kind === kind;
}

/**
 * Returns the first step whose `kind` matches, or `undefined` when none does.
 *
 * Tolerates a nullish `steps` list — automation trigger / condition / action
 * arrays can be omitted on partial API responses — by treating it as empty
 * rather than throwing on `.find`.
 */
export function findStepByKind<K extends AutomationStepKind>(
  steps: AutomationStep[] | null | undefined,
  kind: K,
): Extract<AutomationStep, { kind: K }> | undefined {
  return (steps ?? []).find(
    (s): s is Extract<AutomationStep, { kind: K }> => isStep(s, kind),
  );
}
