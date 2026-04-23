import type {
  AutomationStep,
  AutomationStepKind,
} from '@/types/automations';

export function isStep<K extends AutomationStepKind>(
  step: AutomationStep,
  kind: K,
): step is Extract<AutomationStep, { kind: K }> {
  return step.kind === kind;
}

export function findStepByKind<K extends AutomationStepKind>(
  steps: AutomationStep[],
  kind: K,
): Extract<AutomationStep, { kind: K }> | undefined {
  return steps.find(
    (s): s is Extract<AutomationStep, { kind: K }> => s.kind === kind,
  );
}
