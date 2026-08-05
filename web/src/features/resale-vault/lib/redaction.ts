/**
 * Redaction primitives.
 *
 * Pure functions for the two user-toggleable sensitive fields (VIN
 * disclosure, exact-timestamp precision) plus a generic recursive scrubber
 * for the opaque, untyped Tesla warranty payload (`useWarrantyDetails()`
 * returns `Record<string, unknown>` with no known shape).
 *
 * IMPORTANT scoping decision (documented, not hidden): per the feature
 * spec's literal wording, only VIN disclosure and exact-timestamp
 * precision are exposed as user-facing opt-in toggles. Authentication
 * tokens, precise GPS coordinates, street addresses, raw trip paths, and
 * driver identity are HARD, non-toggleable exclusions in every report,
 * regardless of profile or selection — see `HARD_EXCLUDED_CATEGORIES` in
 * `constants.ts`. There is no legitimate warranty/resale use case for
 * shipping those fields, so they are never offered as a choice at all.
 */
import { maskFor } from '@/lib/maskValue';
import { HARD_EXCLUDED_CATEGORIES } from './constants';
import type { DatePrecision, RedactionManifest, RedactionManifestEntry, SensitiveFieldSelection, VinDisclosure } from './types';
import type { EvidenceSectionId } from './constants';

/** Key-name patterns that must never survive into a report, wherever they appear in an opaque/untyped record. Case-insensitive. */
const SENSITIVE_KEY_PATTERN =
  /vin|serial|token|secret|password|credential|address|street|\blat\b|\blng\b|\blon\b|latitude|longitude|coordinate|geo|email|phone|driver|owner|account|customer|ssn|license/i;

/** Masked VIN representation (Tesla WMI prefix + last 4), reusing the app-wide masking convention. */
export function maskVin(vin: string): string {
  return maskFor(vin, 'vin');
}

/**
 * Resolves the VIN fields for `VehicleIdentityEvidence` from the raw VIN and
 * the user's `VinDisclosure` selection. VIN is excluded by default; a
 * masked form is still the safer default of the two disclosed options.
 */
export function resolveVinDisclosure(
  rawVin: string | null | undefined,
  disclosure: VinDisclosure,
): { vin_masked: string | null; vin_full: string | null } {
  if (!rawVin || disclosure === 'excluded') {
    return { vin_masked: null, vin_full: null };
  }
  const masked = maskVin(rawVin);
  if (disclosure === 'full') {
    return { vin_masked: masked, vin_full: rawVin };
  }
  return { vin_masked: masked, vin_full: null };
}

/** Truncates an ISO date/date-time string to `YYYY-MM-DD` (day precision). Returns null unchanged. Malformed input is returned unchanged rather than throwing, since evidence coming from upstream hooks is not always a strict ISO string. */
export function coarsenToDay(iso: string | null | undefined): string | null {
  if (iso == null) return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(iso);
  return match ? match[1]! : iso;
}

/** Applies the selected date precision to a single timestamp field. */
export function applyDatePrecision(iso: string | null | undefined, precision: DatePrecision): string | null {
  if (iso == null) return null;
  return precision === 'day' ? coarsenToDay(iso) : iso;
}

/**
 * Recursively scrubs an opaque record (e.g. the untyped Tesla warranty
 * payload) by dropping any key whose name matches `SENSITIVE_KEY_PATTERN`,
 * at any nesting depth, in both objects and arrays-of-objects. Because the
 * real shape of this payload is unknown/untyped, this is a defense-in-depth
 * pattern-based scrub rather than an allowlist of known-safe fields — it
 * favors dropping a field it cannot classify with confidence over risking
 * a false negative.
 *
 * Returns a plain JSON-safe value (functions/symbols/undefined dropped,
 * non-plain objects such as Date are stringified) so the result is always
 * safe to hand to `canonicalize()`.
 */
export function scrubSensitiveRecord(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  const t = typeof value;
  if (t === 'string' || t === 'boolean') return value;
  if (t === 'number') return Number.isFinite(value as number) ? value : null;
  if (t === 'function' || t === 'symbol' || t === 'bigint') return null;

  if (Array.isArray(value)) {
    return value.map((item) => scrubSensitiveRecord(item)).filter((item) => item !== undefined);
  }

  if (value instanceof Date) return value.toISOString();

  if (t === 'object') {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      // Unknown class instance (Map/Set/custom) inside an opaque payload —
      // safest to drop rather than guess a serialization.
      return null;
    }
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (SENSITIVE_KEY_PATTERN.test(key)) continue;
      const scrubbed = scrubSensitiveRecord(obj[key]);
      if (scrubbed !== undefined) out[key] = scrubbed;
    }
    return out;
  }

  return null;
}

/** Human-readable reasons for each hard-excluded category, surfaced in the redaction manifest. */
const HARD_EXCLUSION_REASONS: Record<(typeof HARD_EXCLUDED_CATEGORIES)[number], string> = {
  authentication_tokens: 'Authentication/API tokens are never included in a disclosure report under any profile or selection.',
  precise_gps_coordinates: 'Precise GPS coordinates are never included — there is no legitimate warranty/resale use case for exact vehicle locations.',
  street_addresses: 'Street addresses (home, work, charging locations) are never included.',
  raw_trip_paths: 'Raw trip path/waypoint data is never included, only aggregate distance/duration/energy summaries.',
  driver_identity: 'Driver/owner identity fields are never included.',
};

/** Builds the always-present "hard excluded" manifest entries. Identical for every report regardless of selection. */
export function buildHardExclusionEntries(): RedactionManifestEntry[] {
  return HARD_EXCLUDED_CATEGORIES.map((category) => ({
    field: category,
    reason: HARD_EXCLUSION_REASONS[category],
  }));
}

/** Manifest entries for evidence sections the current disclosure selection did not include. */
export function buildSectionExclusionEntries(
  allSections: readonly EvidenceSectionId[],
  selectedSections: readonly EvidenceSectionId[],
): RedactionManifestEntry[] {
  const selected = new Set(selectedSections);
  return allSections
    .filter((section) => !selected.has(section))
    .map((section) => ({
      field: `evidence.${section}`,
      reason: 'Not included — this evidence category was not selected in the current disclosure profile.',
    }));
}

/** Manifest entries for the user-toggleable sensitive fields, covering both the "coarsened" and "included with warning" cases. */
export function buildSensitiveFieldEntries(selection: SensitiveFieldSelection): {
  coarsened: RedactionManifestEntry[];
  includedWithWarning: RedactionManifestEntry[];
} {
  const coarsened: RedactionManifestEntry[] = [];
  const includedWithWarning: RedactionManifestEntry[] = [];

  if (selection.exactTimestamps) {
    includedWithWarning.push({
      field: 'timestamps',
      reason:
        'Exact timestamps (to the second) were explicitly selected instead of the default day-level precision. ' +
        'Warning: precise timestamps can make it easier to correlate this report with other data sources ' +
        '(e.g. location logs) and may reveal usage patterns you did not intend to share.',
    });
  } else {
    coarsened.push({
      field: 'timestamps',
      reason: 'All report timestamps are truncated to day precision (YYYY-MM-DD) by default.',
    });
  }

  switch (selection.vinDisclosure) {
    case 'full':
      includedWithWarning.push({
        field: 'vehicle_identity.vin_full',
        reason:
          'The full, unmasked VIN was explicitly selected for inclusion. Warning: a VIN can be used to look up ' +
          'title/registration history and, combined with other public records, may be linkable to your identity.',
      });
      break;
    case 'masked':
      includedWithWarning.push({
        field: 'vehicle_identity.vin_masked',
        reason:
          'A masked VIN (manufacturer prefix + last 4 characters only) was explicitly selected for inclusion, ' +
          'to let a service center or buyer sanity-check the report against the physical vehicle without exposing the full VIN. ' +
          'Warning: even a masked VIN narrows down the vehicle; treat this report as identifying information.',
      });
      break;
    case 'excluded':
    default:
      break;
  }

  return { coarsened, includedWithWarning };
}

/** Assembles the complete redaction manifest for a given disclosure selection. */
export function buildRedactionManifest(
  allSections: readonly EvidenceSectionId[],
  selectedSections: readonly EvidenceSectionId[],
  sensitive: SensitiveFieldSelection,
): RedactionManifest {
  const { coarsened, includedWithWarning } = buildSensitiveFieldEntries(sensitive);
  return {
    hard_excluded: buildHardExclusionEntries(),
    excluded_by_selection: buildSectionExclusionEntries(allSections, selectedSections),
    coarsened,
    included_with_warning: includedWithWarning,
  };
}
