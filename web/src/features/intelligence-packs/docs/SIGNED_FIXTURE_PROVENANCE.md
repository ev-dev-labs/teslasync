# Signed Fixture Provenance

This document explains exactly how the one **signed** catalog fixture —
"Efficiency Insights Starter Pack" (`efficiency-insights-starter`) in
`lib/catalogFixtures.ts` — was produced, so its signature can be
independently re-derived and audited without trusting this repository's
word for it.

## What is committed, and what is not

Committed (all public/derivable information):

- The manifest JSON (deterministic, human-readable pack content).
- The Ed25519 **public** key, base64-encoded (`publicKeyBase64`).
- The Ed25519 **signature**, base64-encoded (`signatureBase64`), computed
  over the manifest's canonical JSON bytes (see `lib/canonicalJson.ts`).
- The SHA-256 content digest of those same canonical bytes.
- The SHA-256 fingerprint of the public key (`publisher.fingerprint` in the
  manifest, and the key in `lib/trust.ts`'s `KNOWN_PUBLISHER_FINGERPRINTS`).

**Never committed, and never will be:** the Ed25519 **private** key. It was
generated in local Node.js process memory, used once to produce the
signature above, and discarded when the process exited. It was never
written to disk, logged, or transmitted anywhere.

## Exact generation procedure

The script `docs/generate-signed-fixture.mjs` in this same directory is the
**exact tool** used:

```sh
node docs/generate-signed-fixture.mjs
```

It performs, in order:

1. `crypto.generateKeyPairSync('ed25519')` — generates a fresh Ed25519
   keypair using Node's CSPRNG.
2. Exports the public key as a JWK and takes its `x` field (base64url) as
   the raw 32-byte public key — the exact format `crypto.subtle.importKey('raw', ..., { name: 'Ed25519' }, ...)`
   expects in the browser.
3. Computes `publisher.fingerprint = SHA-256(raw public key bytes)` and
   fills it into the manifest (so the manifest's OWN claimed fingerprint
   matches the key that will sign it — `verifyEnvelope.ts` independently
   re-derives this fingerprint and flags any mismatch, so this step isn't
   "trust me", it's what makes the claim verifiable).
4. Serializes the manifest with `canonicalStringify()` — a **byte-for-byte
   port** of `lib/canonicalJson.ts`'s `canonicalize()`/`canonicalStringify()`
   (see that file's header comment for the exact algorithm). Any future
   change to the app's canonicalization MUST be mirrored here, or
   previously-issued signatures will stop verifying.
5. Signs the resulting UTF-8 bytes with `crypto.sign(null, message, privateKey)`
   — Node's Ed25519 signing produces the same raw 64-byte `R‖S` signature
   format Web Crypto's `subtle.verify('Ed25519', ...)` expects, with no
   pre-hashing step needed on the caller's side (Ed25519 hashes internally).
6. Computes the SHA-256 content digest of the same message bytes.
7. Prints the manifest, `publicKeyBase64`, `signatureBase64`,
   `contentDigestSha256Hex`, and `publisherFingerprint` to stdout — and
   nothing else. The private key variable falls out of scope when the
   script exits.

## Reproducing / auditing this yourself

Running the script again will print a **different** public key, signature,
and fingerprint every time (a fresh keypair is generated on every run) —
that is expected. To confirm the COMMITTED fixture's signature is valid
right now, independently, without trusting this repo's test suite:

```js
const { webcrypto } = require('node:crypto');
const { manifest, publicKeyBase64, signatureBase64 } = /* copy from lib/catalogFixtures.ts */;

function canonicalize(v) {
  if (v === null) return null;
  const t = typeof v;
  if (t === 'boolean' || t === 'string') return v;
  if (t === 'number') return v === 0 ? 0 : v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
  return out;
}

(async () => {
  const message = Buffer.from(JSON.stringify(canonicalize(manifest)), 'utf8');
  const key = await webcrypto.subtle.importKey(
    'raw', Buffer.from(publicKeyBase64, 'base64'), { name: 'Ed25519' }, false, ['verify'],
  );
  const ok = await webcrypto.subtle.verify(
    'Ed25519', key, Buffer.from(signatureBase64, 'base64'), message,
  );
  console.log('signature valid:', ok); // true
})();
```

This is exactly what `verifyPackEnvelope()` in `lib/verifyEnvelope.ts` does
at runtime in the browser, via `crypto.subtle` instead of Node's
`node:crypto` webcrypto — the two are the same W3C Web Crypto API surface.

## The "tampered demo" fixture

`lib/catalogFixtures.ts` also ships a **deliberately tampered** third
catalog entry (`TAMPERED_DEMO_ENVELOPE`), built by taking a structural
clone of the valid signed envelope above and mutating one field of the
manifest (a coefficient value) AFTER signing, while keeping the original
signature bytes untouched. It exists purely so the marketplace UI's
"Signature Invalid — Do Not Trust" state is something you can see live in
the app, verified by the real `verifyPackEnvelope()` code path — not a
hardcoded UI mock of what that state would look like.
