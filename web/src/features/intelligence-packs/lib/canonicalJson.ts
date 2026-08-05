/**
 * Canonical JSON serialization for Intelligence-Pack signing/verification.
 *
 * ── Exact algorithm (read before touching this file) ─────────────────────
 *
 * This is a pragmatic, self-consistent subset of RFC 8785 (JSON
 * Canonicalization Scheme / "JCS"):
 *
 *   1. Objects: every own-enumerable key is kept, but the OUTPUT key order
 *      is the ascending order of `Array.prototype.sort()` on the key
 *      strings — i.e. UTF-16 code-unit order, exactly what JCS §3.2.3
 *      mandates for JSON object member ordering.
 *   2. Arrays: element order is preserved as-is. Order is semantically
 *      meaningful for pack content (ranked formulas, dashboard widget
 *      order, …) so — unlike object keys — it is never reordered.
 *   3. Numbers / strings / booleans / null: serialized with the platform's
 *      `JSON.stringify`. V8, SpiderMonkey and JavaScriptCore all implement
 *      the ECMAScript `Number::toString` shortest-round-trip algorithm,
 *      which is the same algorithm JCS §3.2.2 requires — so in practice
 *      this matches JCS for every finite number this manifest format
 *      allows (manifests reject NaN/±Infinity/-0 at the validator level;
 *      see `manifestValidator.ts`).
 *   4. `undefined`, functions, symbols and `bigint` can never legally
 *      appear in a value that came from `JSON.parse` — but
 *      `canonicalize()` still throws `CanonicalizationError` if it
 *      encounters one, so a caller that hands it a live JS object (rather
 *      than parsed JSON) fails loudly instead of silently producing a
 *      corrupt digest.
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 *
 * This is NOT a certified, general-purpose JCS implementation and makes NO
 * claim of byte-for-byte interoperability with arbitrary third-party JCS
 * signers (e.g. a Python/Go tool implementing the full RFC 8785 number
 * formatting edge cases). It only guarantees one thing, which is all this
 * feature needs: **the exact same `canonicalize()` function, run over the
 * exact same parsed JS value, always produces the exact same bytes** — on
 * the publisher-side signing tool and in this browser-side verifier alike.
 * Pack-signing tooling MUST use this file (or a byte-for-byte port of it —
 * see `docs/SIGNED_FIXTURE_PROVENANCE.md` for the Node.js port used to sign
 * the bundled catalog fixture) rather than inventing its own serialization.
 */

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function assertFiniteNumber(value: number): void {
  if (!Number.isFinite(value)) {
    throw new CanonicalizationError('Refusing to canonicalize a non-finite number (NaN/Infinity).');
  }
}

/**
 * Recursively rebuilds a JSON-safe value with object keys sorted so
 * `JSON.stringify` afterwards is insensitive to source key order. Throws
 * `CanonicalizationError` on any non-JSON-safe input (function, symbol,
 * bigint, undefined, or a non-finite number).
 */
export function canonicalize(value: unknown): unknown {
  if (value === null) return null;
  const t = typeof value;

  if (t === 'boolean' || t === 'string') return value;

  if (t === 'number') {
    // Normalize -0 to 0 so `Object.is(-0, 0)`-style discrepancies between a
    // publisher tool and this verifier can never produce different bytes.
    const n = value as number;
    assertFiniteNumber(n);
    return n === 0 ? 0 : n;
  }

  if (t === 'undefined' || t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new CanonicalizationError(`Refusing to canonicalize a JSON-unsafe value of type "${t}".`);
  }

  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }

  // Plain object (typeof 'object', non-null, non-array).
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const out: Record<string, unknown> = {};
  for (const key of sortedKeys) {
    out[key] = canonicalize(obj[key]);
  }
  return out;
}

/** `JSON.stringify` over a `canonicalize()`d value — deterministic, whitespace-free. */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** UTF-8 encode a canonical JSON string into bytes ready for hashing/signing. */
export function canonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalStringify(value));
}
