/**
 * Capability policy: which declarative capabilities a pack may request, and
 * what each one actually unlocks at runtime. The allowlist itself lives in
 * `manifestTypes.ts` (`PACK_CAPABILITY_IDS`) and is enforced at PARSE time —
 * `manifestValidator.ts` rejects the entire manifest if it requests
 * anything outside that list, so "denial" here is about which ALLOWLISTED
 * capabilities a user has actually granted for a given installed pack, not
 * about the (structurally impossible) case of a non-allowlisted request.
 */

import { PACK_CAPABILITY_CATALOG, SAMPLE_FIELD_CAPABILITY, type PackCapabilityId, type SampleRowField } from './manifestTypes';

export interface CapabilityEvaluation {
  granted: PackCapabilityId[];
  denied: PackCapabilityId[];
}

/**
 * Splits a pack's requested capabilities into granted/denied given the set
 * the user has actually approved for this installation. Anything requested
 * but not user-approved is denied — deny-by-default.
 */
export function evaluateCapabilities(
  requested: readonly PackCapabilityId[],
  userApproved: ReadonlySet<PackCapabilityId>,
): CapabilityEvaluation {
  const granted: PackCapabilityId[] = [];
  const denied: PackCapabilityId[] = [];
  for (const cap of requested) {
    if (userApproved.has(cap)) granted.push(cap);
    else denied.push(cap);
  }
  return { granted, denied };
}

/** Look up the user-facing label/description for a capability id. */
export function describeCapability(id: PackCapabilityId) {
  return PACK_CAPABILITY_CATALOG.find((c) => c.id === id) ?? null;
}

/**
 * Which sample-data fields are readable given a set of granted
 * capabilities. Used by `sandboxRunner.ts` to strip fields a pack didn't
 * get read access to (evaluated as `0` by the interpreter — see
 * `expressionInterpreter.ts` — rather than throwing, so a partially-denied
 * pack still renders a legible, deterministic dashboard).
 */
export function allowedSampleFields(granted: ReadonlySet<PackCapabilityId>): Set<SampleRowField> {
  const out = new Set<SampleRowField>();
  for (const [field, capability] of Object.entries(SAMPLE_FIELD_CAPABILITY) as [SampleRowField, PackCapabilityId][]) {
    if (granted.has(capability)) out.add(field);
  }
  return out;
}
