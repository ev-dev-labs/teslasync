---
description: "P1/S2 — Generate typed API clients (Kotlin + C# + Swift) from the OpenAPI contract"
---

# P1 · S2 · 0001 — Client codegen from OpenAPI

> **Severity:** Foundation (blocks all networking) · **Delegation:** FORBIDDEN
> Generate strongly-typed clients for every platform from the frozen-ish OpenAPI 3.1 spec
> (S1). KMP client for Android+Apple; C# client for Windows (ADR-004). Generation is
> reproducible and drift-gated — never hand-edit generated code.

## Artifact Metadata

| Field | Value |
|---|---|
| Output | `apps/shared/core/src/commonMain/.../api/generated/**` (Kotlin), `apps/windows/Generated/Api/**` (C#) |
| Allowed files | `apps/shared/core/**`, `apps/windows/Generated/**`, `apps/tools/codegen/**`, the log file |
| Depends on | P1/S1 (`api/openapi/teslasync.openapi.json`), P1/S3 (KMP scaffold) |
| Blocks | P1/S4 (networking), every platform data layer |
| ADR refs | ADR-003, ADR-004 |
| Log | `../logs/p1-s2-0001-codegen.log` |

## Honesty Covenant (binding — verbatim)

```
1 No red-as-green  2 No scope narrowing  3 No skip-and-assume  4 No stubs as final
5 No parity shortcuts  6 No delegation  7 No predecessor bypass  8 No commit on red
9 No silent drift  10 Log ends with EXIT=<int> and STATUS=<DONE|BLOCKED>
```

## Single Goal

A reproducible `apps/tools/codegen` pipeline that turns `teslasync.openapi.json` into typed
Kotlin (kotlinx.serialization models + Ktor request signatures) and C# (System.Text.Json)
clients, plus a **drift gate** that fails CI if generated output is stale vs the spec.

## Spec

- Pick one generator (OpenAPI Generator CLI pinned in version lock, or a small custom emitter
  if the schema needs SI-aware tweaks) invoked via a checked-in script.
- **Kotlin**: `kotlinx.serialization` data classes for every schema; nullable Go pointer fields →
  Kotlin nullables; snake_case JSON preserved via `@SerialName`. No Ktor calls baked in yet —
  emit request DTOs + endpoint descriptors S4 will wire.
- **C#**: records with `System.Text.Json` + `[JsonPropertyName("snake_case")]`; nullable
  reference types on.
- **Drift gate**: `gen --check` regenerates to a temp dir and diffs; non-empty diff → exit 1.
- Generated dirs carry a `// GENERATED — DO NOT EDIT` header and are excluded from manual lint
  fixups but still must compile.

## Implementation steps

1. Add `apps/tools/codegen/gen-clients.ps1` (+ config) pinned to the locked generator version.
2. Emit Kotlin client into `commonMain`; ensure `:core` still compiles.
3. Emit C# client into `apps/windows/Generated/Api` (project may not exist yet → output is
   compile-checked in P2/W phase; here assert files generate + are valid JSON-mapped types via a
   standalone `dotnet build` of a tiny generated-only csproj, or mark C# BLOCKED if no .NET runner).
4. Add the `--check` drift gate; wire into CI (P0/0004 matrix).
5. Run gate.

## Gate

```powershell
& ./apps/tools/codegen/gen-clients.ps1 2>&1 | Tee-Object $log -Append; "GEN_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
Push-Location apps/shared/core; ./gradlew :core:compileKotlinMetadata 2>&1 | Tee-Object $log -Append; "KT_EXIT=$LASTEXITCODE"|Tee-Object $log -Append; Pop-Location
& ./apps/tools/codegen/gen-clients.ps1 -Check 2>&1 | Tee-Object $log -Append; "DRIFT_EXIT=$LASTEXITCODE" | Tee-Object $log -Append
# EXIT=0 only if GEN/KT/DRIFT all 0 (C# compile may be BLOCKED pending .NET runner — note in log)
```

## Acceptance Criteria

- [ ] Every OpenAPI schema → Kotlin model; `:core` compiles with generated client present.
- [ ] C# client files generate (compile verified now or explicitly deferred to P2 with reason).
- [ ] `--check` drift gate green; generated headers present; snake_case preserved.
- [ ] `EXIT=0` / `STATUS=DONE`.

## Out of Scope

HTTP execution, auth, retries, SSE — all S4. Don't hand-edit generated files.

## Commit

```powershell
git add apps/shared/core apps/windows/Generated apps/tools/codegen .github/prompts/monorepo/logs/p1-s2-0001-codegen.log
git commit -m "feat(apps/shared): generate typed API clients from OpenAPI (P1/S2)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

```
EXIT=0
STATUS=DONE
```
