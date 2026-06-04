# ADR-003 — OpenAPI 3.1 contract generated from the Go API is the single source of truth

**Status:** Accepted · 2026-06 · Supersedes: none

## Context

Four native clients (in three languages: Kotlin, C#, Swift) must call the same
`/api/v1/*` endpoints with identical request/response shapes. The backend serves
**SI-canonical** JSON with snake_case fields (Phase-42/48). A recurring class of web
bugs came from hand-written TypeScript interfaces drifting from Go JSON tags. With four
more clients, hand-maintained models are untenable.

## Decision

The **Go API emits an OpenAPI 3.1 document** (`api/openapi/teslasync.openapi.json`),
generated from the router + typed handlers, and it is the **single source of truth**
for the wire contract. All client models + API call code are **generated** from it:

- **Kotlin** (KMP shared core) — generated client/models (e.g. OpenAPI Generator
  `kotlin` + kotlinx.serialization, or equivalent).
- **C#** (Windows) — generated client/models (NSwag / Kiota / OpenAPI Generator).
- **Swift** (Apple) — generated models (apple/swift-openapi-generator).

Generation is wired into CI; a drift check fails the build if generated code is stale.
Hand-writing DTOs that mirror API responses is **forbidden**.

## Consequences

- ✅ One contract; zero manual model drift; renames/additions propagate by regeneration.
- ✅ Survives UI rewrites and even framework swaps — the contract is language-neutral.
- ✅ Enables contract tests: generated client ⇄ live API in CI.
- ⚠️ The Go API must produce an accurate spec. P1 includes annotating handlers and a
  spec-vs-server conformance test. SI/units semantics live in the spec descriptions.
- ⚠️ Generators differ in quality per language; P1 pins the generator + version per
  platform (ADR-012) and post-processes where needed.

## Alternatives rejected

- **Hand-written models per platform:** the exact failure mode we are eliminating.
- **gRPC/Protobuf contract:** the API is REST/JSON + SSE; introducing gRPC is a backend
  rewrite out of scope. (Tesla proto stays internal to the pipeline.)
