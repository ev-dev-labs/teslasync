/**
 * Tiny, reusable search-query parser.
 *
 * Splits a user-typed query into `key:value` tokens (for structured
 * filtering) and bare substring tokens (the existing free-text behaviour
 * stays intact). Designed to be domain-agnostic: callers wire each
 * `key` they want to support to a predicate function.
 *
 * Examples:
 *   "score:D"           → [{ kind: 'kv', key: 'score', op: '=',  value: 'D' }]
 *   "distance:>10"      → [{ kind: 'kv', key: 'distance', op: '>', value: '10' }]
 *   "Office"            → [{ kind: 'text', value: 'Office' }]
 *   "score:A Office"    → both of the above (combined with AND)
 *   `"san francisco"`   → [{ kind: 'text', value: 'san francisco' }] (quoted literals)
 *
 * The parser is *forgiving*: any token that doesn't match the structured
 * form falls through to a substring search so the user never sees an
 * "invalid query" error. Empty / whitespace input returns an empty
 * token list (callers should treat that as "match all").
 */

export type CompareOp = '=' | '>' | '>=' | '<' | '<=';

export interface KvToken {
  kind: 'kv';
  /** Lowercased filter key, e.g. `'score'`, `'distance'`, `'from'`. */
  key: string;
  /** Comparison operator. Defaults to `=` when no operator was typed. */
  op: CompareOp;
  /** Raw (untrimmed) value substring as the user typed it. */
  value: string;
}

export interface TextToken {
  kind: 'text';
  /** Lowercased substring to match against the configured text fields. */
  value: string;
}

export type SearchToken = KvToken | TextToken;

const TOKEN_RE = /(?:[^\s"]+|"[^"]*")+/g;
const KV_RE = /^([a-z][a-z0-9_-]*):(>=|<=|=|>|<)?(.*)$/i;

/**
 * Parse a free-form search string into structured tokens. Pass the
 * resulting tokens to {@link matchesTokens} (or use them directly to
 * drive bespoke filters).
 */
export function parseSearchQuery(input: string): SearchToken[] {
  const trimmed = input.trim();
  if (!trimmed) return [];
  const out: SearchToken[] = [];
  const matches = trimmed.match(TOKEN_RE) ?? [];
  for (const raw of matches) {
    // Strip surrounding quotes for the value but preserve the original
    // characters inside — quoted phrases let users search for substrings
    // that contain spaces (e.g. `"san francisco"`).
    const unquoted = raw.startsWith('"') && raw.endsWith('"') && raw.length >= 2
      ? raw.slice(1, -1)
      : raw;
    if (!unquoted) continue;
    const kv = KV_RE.exec(unquoted);
    if (kv) {
      const [, key, op, value] = kv;
      out.push({
        kind: 'kv',
        key: key.toLowerCase(),
        op: (op as CompareOp | undefined) ?? '=',
        value: value ?? '',
      });
    } else {
      out.push({ kind: 'text', value: unquoted.toLowerCase() });
    }
  }
  return out;
}

/**
 * Predicate signature used by {@link matchesTokens} for one item in the
 * caller's collection. Returns:
 *  - `true`  → token is satisfied
 *  - `false` → token is recognised but doesn't match → exclude the item
 *  - `null`  → token is not handled here; let the caller fall through
 */
export type KvHandler<T> = (item: T, token: KvToken) => boolean | null;

export interface MatchOptions<T> {
  /** Returns the substring-haystack strings for free-text tokens. */
  text: (item: T) => Array<string | null | undefined>;
  /** Optional handlers for `key:value` tokens, keyed by lowercased `key`.
   *  Tokens whose key isn't handled fall through to the text fields so
   *  e.g. `foo:bar` still matches a row whose address contains "foo:bar". */
  kv?: Record<string, KvHandler<T>>;
}

/**
 * Test whether `item` satisfies *all* of the supplied `tokens`. Combine
 * with `Array.prototype.filter` to apply the parsed query.
 */
export function matchesTokens<T>(
  item: T,
  tokens: readonly SearchToken[],
  opts: MatchOptions<T>,
): boolean {
  if (tokens.length === 0) return true;
  const fields = opts.text(item).map((s) => String(s ?? '').toLowerCase());
  for (const token of tokens) {
    if (token.kind === 'text') {
      if (!fields.some((f) => f.includes(token.value))) return false;
      continue;
    }
    const handler = opts.kv?.[token.key];
    if (handler) {
      const verdict = handler(item, token);
      if (verdict === false) return false;
      if (verdict === true) continue;
      // verdict === null → fall through to substring as if the user
      // typed `key:value` literally (graceful degradation).
    }
    // Unhandled key → match against the original raw token as a substring
    // so a typo like `addr:home` still finds rows mentioning "home".
    const literal = `${token.key}:${token.value}`.toLowerCase();
    if (!fields.some((f) => f.includes(literal))) return false;
  }
  return true;
}

/**
 * Compare two numbers using a {@link CompareOp}. Returns `false` for
 * non-finite inputs so handlers can pass them through unchanged.
 */
export function compareNumeric(value: number, op: CompareOp, target: number): boolean {
  if (!Number.isFinite(value) || !Number.isFinite(target)) return false;
  switch (op) {
    case '>':  return value >  target;
    case '>=': return value >= target;
    case '<':  return value <  target;
    case '<=': return value <= target;
    case '=':
    default:   return Math.abs(value - target) < 1e-9;
  }
}

/**
 * Parse a human-typed duration literal into minutes. Supports common
 * shorthand the user is likely to type into a search box:
 *
 *   "30"        → 30      (bare number = minutes)
 *   "30m"       → 30
 *   "1h"        → 60
 *   "1h30m"     → 90
 *   "1.5h"      → 90
 *   "2d"        → 2880    (24 × 60 × 2)
 *   "1d2h30m"   → 1590
 *
 * Returns `null` when the token is unparseable so callers can fall
 * through (e.g. treat `dur:later` as a literal substring match).
 */
export function parseDurationToken(input: string): number | null {
  if (!input) return null;
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Bare number → minutes
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  const re = /(\d+(?:\.\d+)?)\s*(d|h|m|s)/g;
  let total = 0;
  let matched = false;
  let m: RegExpExecArray | null;
  while ((m = re.exec(trimmed)) !== null) {
    matched = true;
    const value = Number(m[1]);
    if (!Number.isFinite(value)) return null;
    switch (m[2]) {
      case 'd': total += value * 24 * 60; break;
      case 'h': total += value * 60;      break;
      case 'm': total += value;           break;
      case 's': total += value / 60;      break;
    }
  }
  if (!matched) return null;
  // Reject tokens with leftover non-whitespace after the last unit
  // ('1h2foo' should be unparseable, not silently 60).
  const consumed = trimmed.replace(/\s+/g, '').match(/(\d+(?:\.\d+)?[dhms])+/g)?.join('');
  if (consumed !== trimmed.replace(/\s+/g, '')) return null;
  return total;
}

/**
 * Test whether an ISO date (or YMD prefix) `value` matches a YMD `prefix`
 * the user typed for an `in:` query.
 *
 *   matchesYmdPrefix('2026-04-15', '2026')      // true
 *   matchesYmdPrefix('2026-04-15', '2026-04')   // true
 *   matchesYmdPrefix('2026-04-15', '2026-04-15')// true
 *   matchesYmdPrefix('2026-04-15', '2025')      // false
 *   matchesYmdPrefix('',           '2026')      // false
 *
 * Returns `false` for unparseable / empty input so the caller can
 * treat the row as a non-match without throwing.
 */
export function matchesYmdPrefix(value: string | null | undefined, prefix: string): boolean {
  const v = (value ?? '').trim();
  const p = (prefix ?? '').trim();
  if (!v || !p) return false;
  // Normalise: take the first 10 chars (YYYY-MM-DD) of the value side.
  const ymd = v.length >= 10 ? v.slice(0, 10) : v;
  return ymd.startsWith(p);
}
