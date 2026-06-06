# OpenAPI client codegen (P1/S2/0001)

Generates strongly-typed API clients from `api/openapi/teslasync.openapi.json` for both shared
platforms, with a drift gate so generated code can never silently fall behind the contract.

| Target | Output | Types |
|---|---|---|
| Kotlin (KMP `commonMain`) | `apps/shared/core/src/commonMain/kotlin/io/teslasync/shared/core/api/generated/` | `kotlinx.serialization` `@Serializable` data classes + `ApiEndpoints` |
| C# (Windows) | `apps/windows/Generated/Api/` | `System.Text.Json` `sealed record`s + `ApiEndpoints` |

Generated files carry a `GENERATED — DO NOT EDIT` header. **Never hand-edit them** — change the
spec or the emitter and regenerate.

## Usage

```powershell
# (re)write the generated clients
pwsh apps/tools/codegen/gen-clients.ps1

# drift gate — non-zero exit if committed output is stale vs the spec
pwsh apps/tools/codegen/gen-clients.ps1 -Check

# full gate — generate + Kotlin compile + C# compile + drift, writes the artifact log
pwsh apps/tools/codegen/gen-clients.ps1 -Gate
```

The emitter itself is `gen-clients.ts` (run via the pinned `tsx@4.22.4`). Config + type mappings
live in `codegen.config.json`.

## Design notes

- **Type mapping** (SI-faithful): `number`→`Double`/`double`, `integer`→`Long`/`long`,
  `boolean`→`Boolean`/`bool`, `string`→`String`/`string`, `string`+`date-time`→
  `kotlin.time.Instant`/`System.DateTimeOffset`. Unsupported constructs (`object`/`array`/`$ref`/
  enum on a property) **fail the generator** rather than degrading to `String`.
- **Nullability**: a field is nullable when its type-union includes `null` **or** it is not in
  `required`; non-required fields default to `null`. (Consumer-friendly approximation for response
  DTOs — absent vs explicit-`null` is not distinguished.)
- **Endpoint descriptors**: every operation is emitted with `operationId`, `method`, `path`
  (with `/api/v1` stripped + a `versioned` flag so S4 prepends the version base exactly once —
  no double prefix), `pathParams`, `queryParams` (name/required/type), `requiresAuth`, and a
  `responseType` label (`Vehicle` / `List<Drive>` / `JsonElement` / `Unit`).
- **Reproducible**: deterministic, locale-independent ordering; LF-normalized output; pinned
  runner and toolchain versions.

## Verification

- **C#** — `verify/csharp/Verify.csproj` compiles the generated records against the in-box net10
  framework (`TreatWarningsAsErrors`).
- **Kotlin** — `verify/kotlin/compile-check.ps1` runs the pinned standalone `kotlinc 2.4.0` with the
  `kotlinx.serialization` plugin and `kotlinx-serialization-core` (explicit-api strict). This is the
  stand-in for the canonical `./gradlew :core:compileKotlinMetadata` until the P1/S3 KMP scaffold
  lands; once it does, `-Gate` runs the canonical Gradle command instead.

## CI

Add the drift gate to the apps CI matrix (kept out of this artifact's committed files because
workflow paths are outside its allowed-files set):

```yaml
- run: npx --yes tsx@4.22.4 apps/tools/codegen/gen-clients.ts --check
- run: dotnet build apps/tools/codegen/verify/csharp/Verify.csproj -c Release --nologo
```

Out of scope (S4): HTTP execution, auth, retries, SSE. The contract declares no request bodies.
