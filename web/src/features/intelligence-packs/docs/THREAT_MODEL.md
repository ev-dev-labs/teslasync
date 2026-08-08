# Intelligence-Pack Marketplace — Threat Model

This document is the single source of truth for what this feature does and
does **not** guarantee. UI copy (`SecurityMethodologyPanel`) summarizes this;
this file is the detailed version.

## In scope: what a "pack" is

A pack is a JSON document (`SignedPackEnvelope` → `PackManifest`) containing:

- Bounded numeric coefficients (`min <= value <= max`).
- A finite expression AST ("formulas") over those coefficients and a fixed
  allowlist of synthetic sample-data field names.
- A dashboard layout referencing formulas by id and a fixed allowlist of
  shared visualization primitive **kinds** (not components, not markup).
- Plain-text automation "recommendations" — human-readable strings only.

There is no field, anywhere in the schema, that can hold executable code,
markup, a URL to fetch, or a reference to a JS module/component. This is
enforced structurally (the TypeScScript types + validator only accept the
shapes above) not just "checked at runtime and hoped."

## Guarantees

1. **No code execution.** The parser/validator/interpreter never call
   `eval`, `new Function(...)`, dynamic `import()`, `<script>` injection, or
   render an `<iframe>` (same-origin or otherwise) around pack content.
   Formulas are interpreted as data (`expressionInterpreter.ts` — a `switch`
   over a closed `op` vocabulary), not executed as code.
2. **No network requests originate from pack content.** Sandbox preview
   data is a fixed, bundled, synthetic sample dataset
   (`lib/sampleTelemetry.ts`) baked into the client bundle at build time. A
   pack cannot specify a URL, and there is no fetch/XHR/WebSocket call
   anywhere in the pack-execution path.
3. **Signature verification is cryptographic, not heuristic.** SHA-256
   digests and Ed25519 signatures are computed via `crypto.subtle` (Web
   Crypto), never a hand-rolled or bundled pure-JS crypto implementation.
4. **No silent weak fallback.** If `crypto.subtle` is unavailable (non-secure
   context) or this browser's Web Crypto doesn't implement Ed25519,
   installation of a **signed** pack fails explicitly
   (`CryptoUnavailableError` / `Ed25519UnsupportedError` surfaced to the
   user) rather than silently treating the pack as verified, or falling
   back to a weaker check.
5. **Structural resource ceilings**, enforced before/independent of any
   manifest-specific logic: envelope byte size, JSON recursion depth, JSON
   node count, string/array lengths, per-formula AST node count and depth,
   and per-collection entry counts (formulas/coefficients/dashboards/
   widgets/automation recommendations) are all capped — see
   `MANIFEST_LIMITS` in `lib/manifestTypes.ts`.
6. **Runtime execution budgets**, independent of the structural limits
   above: a total AST-node-evaluation step ceiling and a wall-clock deadline
   bound every sandbox preview run (`SANDBOX_BUDGETS` in
   `lib/sandboxRunner.ts`), and row/output-point counts are capped.
7. **Deny-by-default capabilities.** A pack's requested capabilities must
   already be a subset of a fixed, all-read-only/suggestion-only allowlist
   (enforced at PARSE time — anything else is a hard parse failure, not a
   runtime denial). Beyond that, a user must additionally, explicitly grant
   each capability at install time; anything not granted is denied at
   runtime (masked out of the sandbox data, not thrown).
8. **A valid signature proves key possession + content integrity — nothing
   else.** See "Non-guarantees" below; the UI is written to never conflate
   "signature verified" with "publisher is trustworthy."
9. **Local-first persistence.** Installed packs, trust decisions, and the
   audit log live in IndexedDB (or a documented localStorage fallback when
   IndexedDB is unavailable) — no server round-trip.

## Non-guarantees (explicit, by design)

1. **Signature verification does NOT vouch for the publisher's intentions,
   competence, or good faith.** It proves the holder of a specific private
   key produced this exact byte sequence. Anyone can generate an Ed25519
   keypair and sign anything with it. Trusting a *specific* key beyond "it
   is internally self-consistent" is a **local, human** decision — either
   because the fingerprint appears in this build's small, bundled
   `KNOWN_PUBLISHER_FINGERPRINTS` allowlist (itself just "this app's authors
   chose to vouch for this specific key," not a certificate authority), or
   because the user manually decided to trust an unrecognized key's
   signature after reviewing the pack.
2. **This is not a certified RFC 8785 (JCS) implementation.** The
   canonicalization in `lib/canonicalJson.ts` is a documented, pragmatic,
   internally-consistent subset (see that file's header) — it guarantees
   the SAME function produces the SAME bytes for the SAME parsed value on
   both the signing and verifying side, not byte-for-byte interoperability
   with arbitrary third-party JCS tooling.
3. **Unsigned packs are unverified by definition.** They can be previewed
   (read-only inspection of their declared content) but cannot be enabled
   without an explicit, clearly-labeled local-development trust flow that
   states the risk in plain language. This is a convenience for local
   experimentation, not a security boundary — an unsigned pack you choose
   to trust is exactly as trustworthy as your own judgement of its author.
4. **The sandbox proves nothing about a pack's real-world usefulness or
   correctness.** It runs the pack's formulas against a small, fixed,
   synthetic sample dataset. A formula that looks reasonable against the
   sample data could still be a poor or misleading model of real vehicle
   behavior — this feature validates *safety* (bounded, side-effect-free
   computation), not *analytical correctness*.
5. **Automation "recommendations" never execute anything.** They are
   plain strings a human reads and, if they agree, manually recreates using
   the existing Automation Builder. A malicious or careless pack cannot use
   this mechanism to actually create, modify, or trigger any automation,
   vehicle command, or notification.
6. **Browser/runtime dependency.** Ed25519 support in `crypto.subtle` is a
   newer W3C "Secure Curves" addition than SHA-256 support. On older or
   locked-down browsers (or any non-secure-context origin — plain HTTP on a
   LAN IP or custom hostname), signed-pack installation is unavailable by
   design (see guarantee #4) — there is deliberately no fallback that would
   let it "just work" with weaker guarantees.
7. **Storage-medium fallback (IndexedDB → localStorage) is about
   persistence reliability only.** It has zero bearing on cryptographic
   verification, which runs identically regardless of which backend
   `PackRepository` is wired to.
8. **Multi-table writes are not cross-table transactional.** See the
   header comment in `lib/packRepository.ts` — each logical table
   (installed packs / trust decisions / audit log) is written atomically on
   its own, but a sequence like "install, then append an audit entry" is
   not a single atomic unit across both tables.
