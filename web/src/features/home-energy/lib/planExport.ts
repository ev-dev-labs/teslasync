/**
 * Canonical JSON plan export for the Whole-Home Energy Orchestrator.
 *
 * Bundles the exact optimizer input alongside its result into one
 * self-describing, versioned JSON document — enough for a user (or another
 * tool) to fully reconstruct or audit the recommendation. This module
 * NEVER issues any Tesla command; it only serializes a plan for download.
 *
 * `downloadCanonicalPlan` mirrors the Blob/`URL.createObjectURL` technique
 * used by the shared `@/lib/export.ts` helpers, reimplemented locally
 * because the shared `exportAsJSON` forces an array wrapper — this export
 * is a single canonical object, not a record list.
 */

import type { OrchestrationInput, OrchestrationResult } from './types';

export const PLAN_EXPORT_SCHEMA_VERSION = 1;

export interface CanonicalPlanExport {
  schemaVersion: typeof PLAN_EXPORT_SCHEMA_VERSION;
  generatedAtIso: string;
  /** The exact optimizer input the recommendation was computed from. */
  input: OrchestrationInput;
  /** The full optimizer result — recommendation only, never an issued command. */
  result: OrchestrationResult;
  disclaimer: string;
}

const DISCLAIMER =
  'This is a locally-computed recommendation only. TeslaSync does not send any command to a vehicle, Powerwall, or utility as a result of this plan.';

/** Builds the versioned, self-describing export document. Pure — takes `generatedAtIso` explicitly rather than reading the clock. */
export function buildCanonicalPlan(
  input: OrchestrationInput,
  result: OrchestrationResult,
  generatedAtIso: string,
): CanonicalPlanExport {
  return {
    schemaVersion: PLAN_EXPORT_SCHEMA_VERSION,
    generatedAtIso,
    input,
    result,
    disclaimer: DISCLAIMER,
  };
}

/** Deterministic, pretty-printed JSON serialization of a canonical plan. */
export function serializeCanonicalPlan(plan: CanonicalPlanExport): string {
  return JSON.stringify(plan, null, 2);
}

/** Triggers a browser download of the plan as a `.json` file. No-op outside a DOM environment. */
export function downloadCanonicalPlan(plan: CanonicalPlanExport, filename = 'home-energy-plan.json'): void {
  if (typeof document === 'undefined' || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return;
  const json = serializeCanonicalPlan(plan);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
