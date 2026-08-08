/**
 * Canonical JSON serialization.
 *
 * Produces a byte-stable string for any JSON-safe value: object keys are
 * sorted (UTF-16 code-unit order, i.e. default JS string comparison) at
 * every level, arrays keep their order, and whitespace is never emitted.
 * The same logical document ALWAYS canonicalizes to the same string,
 * regardless of how its keys were inserted — this is what makes the
 * SHA-256 digest and ECDSA signature reproducible/verifiable across
 * browsers and machines.
 *
 * Deliberately narrow scope (not a full RFC 8785 implementation): we only
 * need to canonicalize the report shapes this feature produces, which are
 * plain objects/arrays/strings/finite numbers/booleans/null. Anything else
 * (undefined in an array, NaN, Infinity, functions, symbols, bigint, class
 * instances) throws `CanonicalizationError` rather than silently coercing —
 * a silently-dropped or silently-coerced field would corrupt the digest a
 * signature is supposed to protect.
 */

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export class CanonicalizationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CanonicalizationError';
  }
}

function canonicalizeValue(value: unknown, path: string): JsonValue {
  if (value === null) return null;

  const t = typeof value;

  if (t === 'string') return value as string;
  if (t === 'boolean') return value as boolean;

  if (t === 'number') {
    if (!Number.isFinite(value as number)) {
      throw new CanonicalizationError(
        `Cannot canonicalize non-finite number (NaN/Infinity) at ${path}`,
      );
    }
    return value as number;
  }

  if (t === 'undefined') {
    throw new CanonicalizationError(`Cannot canonicalize "undefined" at ${path}`);
  }

  if (t === 'function' || t === 'symbol' || t === 'bigint') {
    throw new CanonicalizationError(`Cannot canonicalize a ${t} at ${path}`);
  }

  if (Array.isArray(value)) {
    return value.map((item, i) => {
      if (item === undefined) {
        throw new CanonicalizationError(
          `Cannot canonicalize "undefined" inside an array at ${path}[${i}] — arrays are positional, so a skipped element would silently shift every later index`,
        );
      }
      return canonicalizeValue(item, `${path}[${i}]`);
    });
  }

  // Plain object (Date/Map/Set/class instances are intentionally rejected —
  // callers must pass already-normalized plain data).
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    throw new CanonicalizationError(
      `Cannot canonicalize a non-plain object at ${path} (${(value as object).constructor?.name ?? 'unknown'}) — normalize to a plain object/array first`,
    );
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const out: Record<string, JsonValue> = {};
  for (const key of keys) {
    const v = obj[key];
    // An explicit `undefined` object property is treated the same as an
    // absent property (matches `JSON.stringify`'s own behavior) — safe
    // because, unlike arrays, dropping an object key never changes the
    // meaning of any other key.
    if (v === undefined) continue;
    out[key] = canonicalizeValue(v, `${path}.${key}`);
  }
  return out;
}

/** Recursively normalize a value into a canonical (sorted-key) JSON structure. Throws on unsupported input. */
export function canonicalize(value: unknown): JsonValue {
  return canonicalizeValue(value, '$');
}

/** Canonical JSON string — deterministic across key-insertion order and machines. */
export function toCanonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Canonical JSON encoded as UTF-8 bytes, ready for `crypto.subtle.digest`/`sign`/`verify`. */
export function toCanonicalBytes(value: unknown): Uint8Array {
  return new TextEncoder().encode(toCanonicalJson(value));
}
