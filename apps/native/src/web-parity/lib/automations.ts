// Native parity port of web/src/lib/automations.ts.
//
// Pure, DOM-free discriminated-union helpers that narrow an `AutomationStep`
// by its `kind` discriminant. The web original imports the `AutomationStep` /
// `AutomationStepKind` types from '@/types/automations'; in the native parity
// tree those exact types are colocated with the automations data hook at
// apps/native/src/web-parity/api/hooks/useAutomations.ts (mirroring how
// web/src/api/types.ts re-exports them), so the type import is redirected
// there. The narrowing logic carries no browser/React dependency and is a
// faithful 1:1 port that runs unchanged under React Native.

import type {
  AutomationStep,
  AutomationStepKind,
} from '../api/hooks/useAutomations';

export function isStep<K extends AutomationStepKind>(
  step: AutomationStep,
  kind: K,
): step is Extract<AutomationStep, {kind: K}> {
  return step.kind === kind;
}

export function findStepByKind<K extends AutomationStepKind>(
  steps: AutomationStep[],
  kind: K,
): Extract<AutomationStep, {kind: K}> | undefined {
  return steps.find(
    (s): s is Extract<AutomationStep, {kind: K}> => s.kind === kind,
  );
}
