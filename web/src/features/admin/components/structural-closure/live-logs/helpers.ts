import { type LogStreamEvent, type LogStreamLevel } from '@/api/hooks/useLogStream';

// ── helpers ─────────────────────────────────────────────────────────

export const LEVEL_OPTIONS: { value: LogStreamLevel; defaultLabel: string; i18nKey: string }[] = [
  { value: 'debug', defaultLabel: 'Debug', i18nKey: 'liveLogs.level.debug' },
  { value: 'info', defaultLabel: 'Info', i18nKey: 'liveLogs.level.info' },
  { value: 'warn', defaultLabel: 'Warn', i18nKey: 'liveLogs.level.warn' },
  { value: 'error', defaultLabel: 'Error', i18nKey: 'liveLogs.level.error' },
];

export function levelBadgeVariant(
  level: string,
): 'success' | 'info' | 'warning' | 'danger' | 'neutral' {
  const norm = level.toLowerCase();
  if (norm === 'debug' || norm === 'trace') return 'neutral';
  if (norm === 'info') return 'info';
  if (norm === 'warn' || norm === 'warning') return 'warning';
  if (norm === 'error' || norm === 'err' || norm === 'fatal' || norm === 'panic')
    return 'danger';
  return 'neutral';
}

export function formatTime(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  // Use the user's locale-formatted time + millisecond precision so
  // bursty log streams stay distinguishable.
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const sss = String(d.getMilliseconds()).padStart(3, '0');
  return `${hh}:${mm}:${ss}.${sss}`;
}

export function extractMessage(parsed: Record<string, unknown> | null, raw: string): string {
  if (!parsed) return raw;
  if (typeof parsed.message === 'string') return parsed.message;
  if (typeof parsed.msg === 'string') return parsed.msg;
  return raw;
}

export function extractFields(
  parsed: Record<string, unknown> | null,
): Array<[string, string]> {
  if (!parsed) return [];
  const skip = new Set(['level', 'time', 'message', 'msg']);
  const out: Array<[string, string]> = [];
  for (const [k, v] of Object.entries(parsed)) {
    if (skip.has(k)) continue;
    if (v === null || v === undefined) continue;
    let str: string;
    if (typeof v === 'string') str = v;
    else if (typeof v === 'number' || typeof v === 'boolean') str = String(v);
    else {
      try {
        str = JSON.stringify(v);
      } catch {
        str = '[unserialisable]';
      }
    }
    out.push([k, str]);
  }
  return out;
}

export function extractVehicleId(
  parsed: Record<string, unknown> | null,
): string | null {
  if (!parsed) return null;
  const candidates = ['vehicle_id', 'vehicleID', 'vehicleId'];
  for (const k of candidates) {
    const v = parsed[k];
    if (typeof v === 'string' && v.length > 0) return v;
    if (typeof v === 'number') return String(v);
  }
  return null;
}

/**
 * CANONICAL_POSITIVE_INTEGER_RE matches the ONLY string shapes this
 * page accepts as a committed vehicle id: one or more ASCII digits,
 * whose first digit is non-zero. No sign, no decimal point, no
 * exponent, no internal or surrounding whitespace (callers trim
 * first).
 *
 * Decision (documented): leading zeros are REJECTED, not silently
 * normalized. `"007"` is not the canonical textual form of vehicle id
 * `7` — the canonical form is `"7"` — and silently accepting
 * non-canonical digit strings would reopen exactly the class of bug
 * this regex exists to close (a syntactically-different string
 * quietly resolving to the same numeric value). A user who means
 * vehicle 7 must type `"7"`.
 */
const CANONICAL_POSITIVE_INTEGER_RE = /^[1-9][0-9]*$/;

/**
 * parseCanonicalVehicleId converts committed-filter text into a
 * vehicle id, or `null` when the text is not a canonical positive
 * integer digit string.
 *
 * This is the single choke point between free-typed filter text and
 * `Number(...)` for vehicle scope. `Number()` alone is far too
 * permissive to gate a real scope change: `Number("1e2")` is `100`,
 * `Number("1.0")` is `1`, `Number("+7")` is `7` — every one of those
 * would silently become a committed vehicle id under a bare
 * `Number.isInteger(Number(text)) && n > 0` check, even though NONE
 * of them is the canonical digit string a real vehicle id ever takes.
 * Validating the STRING SHAPE first — before any `Number` conversion
 * — closes that loophole: only a plain run of digits with a non-zero
 * leading digit converts to an id at all. `Number.isSafeInteger` is a
 * final belt-and-suspenders guard against a digit string so long it
 * would lose precision as a JS number.
 *
 * Exported for direct unit testing; production code reaches it only
 * through {@link commitVehicleFilter} inside {@link default LiveLogsPage}.
 */
export function parseCanonicalVehicleId(text: string): number | null {
  const trimmed = text.trim();
  if (!CANONICAL_POSITIVE_INTEGER_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  if (!Number.isSafeInteger(n) || n <= 0) return null;
  return n;
}

/**
 * deriveAiVehicleScope computes the vehicle scope handed to
 * AILogTraceSummarization. It MUST track the same committed/validated
 * identity {@link commitVehicleFilter}-equivalent logic produces — a
 * positive integer id that is a member of `vehicles` — never the raw
 * in-progress `vehicleFilter` draft text.
 *
 * Rationale: `vehicleFilter` updates on every keystroke. Deriving AI
 * scope straight from it (a bare `Number(trimmed)` parse) let an
 * un-committed, invalid, or unknown draft silently become "AI scope":
 * a fractional value like `"1.5"` or scientific notation like `"1e2"`
 * parses to a finite positive number and would be sent to the backend
 * as if it were a real vehicle id, and an id that is not in `vehicles`
 * would "broaden" the AI request to a vehicle the user never actually
 * selected. Because AILogTraceSummarization keys its useAiStream
 * scopeKey on this value (AI-01), every one of those keystrokes would
 * ALSO abort an in-flight summary or wipe a completed one — well
 * before the user ever committed anything. {@link parseCanonicalVehicleId}
 * additionally closes the loophole at the COMMIT boundary itself: even
 * a blurred/Entered `"1e2"` can never become a committed vehicleId in
 * the first place, so this function never has a "1e2-shaped" committed
 * value to reflect.
 *
 * Only two outcomes are valid AI scope:
 *
 *   1. The filter is cleared to empty — an unambiguous, immediate
 *      request for fleet-wide scope, mirroring how `filteredEvents`
 *      already treats an empty filter as "show every vehicle" with no
 *      commit required.
 *   2. The filter is non-empty — AI scope tracks the already-
 *      committed `vehicleId`, re-validated with the EXACT same
 *      positive-integer + known-vehicle membership check
 *      `commitVehicleFilter` uses. Until the user blurs/Enters a
 *      valid, known id, the draft has no effect on AI scope — the
 *      prior committed scope (or fleet-wide, if none was committed)
 *      is preserved, so an active/completed summary is never
 *      disturbed by in-progress typing, and a fractional/scientific-
 *      notation/unknown draft is never sent to the backend.
 *
 * Exported for direct unit testing; production code reaches it only
 * through the `aiVehicleId` memo in {@link default LiveLogsPage}.
 */
export function deriveAiVehicleScope(
  vehicleFilter: string,
  vehicleId: number | null,
  vehicles: ReadonlyArray<{ id: number }>,
): number | undefined {
  const trimmed = vehicleFilter.trim();
  if (trimmed.length === 0) return undefined;
  if (
    typeof vehicleId === 'number'
    && Number.isInteger(vehicleId)
    && vehicleId > 0
    && vehicles.some((candidate) => candidate.id === vehicleId)
  ) {
    return vehicleId;
  }
  return undefined;
}

export function downloadFilename(template: string): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[:]/g, '-')
    .replace(/\.\d+Z$/, 'Z');
  return template.replace('{{ts}}', stamp);
}

export function eventToText(ev: LogStreamEvent): string {
  return `[${formatTime(ev.receivedAt)}] ${ev.level.toUpperCase()} ${ev.payload}`;
}
