# Vendored Tesla `vehicle_data.proto`

This directory vendors the canonical Tesla Fleet Telemetry protobuf schema as the
single source of truth for all generated signal metadata, enum parsers, and
`Datum.value` decoders in TeslaSync. See ADR-004 (`.github/ARCHITECTURE.md`) and
`.github/instructions/tesla-pipeline.instructions.md` for the architectural
rationale.

> **Forward-only.** The hand-curated `internal/enums/signal_types.go::SignalRegistry`
> is being replaced by code generated from this proto (phase-42 prompts 0030–0050).
> Do not hand-edit the vendored `vehicle_data.proto` — re-vendor from upstream
> instead, then re-run `go generate ./...`.

## Provenance

| Field | Value |
|---|---|
| Upstream repository | `github.com/teslamotors/fleet-telemetry` |
| Upstream path | `protos/vehicle_data.proto` |
| Upstream tag | **v0.8.0** |
| Upstream commit | `031553a7d3d6952c1552ed13dc71aaf4fd4a882b` |
| Upstream commit date | 2025-12-12 |
| Upstream raw URL | <https://raw.githubusercontent.com/teslamotors/fleet-telemetry/031553a7d3d6952c1552ed13dc71aaf4fd4a882b/protos/vehicle_data.proto> |
| Upstream tree URL | <https://github.com/teslamotors/fleet-telemetry/blob/v0.8.0/protos/vehicle_data.proto> |
| File size | 21,291 bytes |
| SHA256 | `4596EBA1D26B72EB69BBF747831BF0EB2EEC106A54048D9BC7D6DE765446697C` |
| Fetched on | 2026-05-01 |
| Vendored by | phase-42 prompt 0010 |
| Reviewed by | Staff Engineer + Principal Engineer + Principal Architect (per ADR-004) |

The same checksum is recorded in `CHECKSUM` (one-line hex, uppercase) and the
upstream pin is recorded in `VERSION`. Both files gate against silent drift —
any divergence between the proto bytes and `CHECKSUM` will cause the prompt 0010
gate (and downstream codegen prompts) to fail.

## Why we vendor instead of `go get`-ing

1. **Determinism.** Generated enum tables, signal registries, and unit
   converters MUST be reproducible from a single artifact whose bytes we
   control. A `go get`-ed module can be force-pushed or yanked.
2. **Auditability.** A SHA256 checksum stored next to the file makes any
   accidental edit (line-ending normalization, partial copy, manual tweak)
   immediately visible in CI.
3. **Offline builds.** The codegen pipeline (phase-42 prompt 0030 onward) must
   work in air-gapped CI environments without GitHub access.
4. **Coverage gating.** `cmd/protogen-tesla` and the reflective coverage tests
   (phase-42 prompt 0080) compare the proto's `Field` enum against the
   pipeline's routing table; the vendored copy is the one canonical input.

## Regeneration procedure

When Tesla publishes a new tag of `fleet-telemetry`:

```powershell
# 1. Fetch the new proto (replace <NEW_COMMIT> with the upstream commit SHA).
$url = "https://raw.githubusercontent.com/teslamotors/fleet-telemetry/<NEW_COMMIT>/protos/vehicle_data.proto"
Invoke-WebRequest -Uri $url -OutFile api\proto\tesla\vehicle_data.proto -UseBasicParsing

# 2. Recompute the checksum and overwrite CHECKSUM (single-line uppercase hex).
$h = (Get-FileHash api\proto\tesla\vehicle_data.proto -Algorithm SHA256).Hash.ToUpperInvariant()
$h | Set-Content -NoNewline api\proto\tesla\CHECKSUM
Add-Content api\proto\tesla\CHECKSUM ""   # single trailing newline

# 3. Update VERSION with the new tag + commit + fetch date.
@(
  "teslamotors/fleet-telemetry@<NEW_TAG>",
  "commit=<NEW_COMMIT>",
  "fetched=$(Get-Date -Format yyyy-MM-dd)"
) | Set-Content api\proto\tesla\VERSION

# 4. Update the Provenance table in SOURCE.md (tag, commit, date, SHA256).

# 5. Regenerate Go code from the proto.
go generate ./...

# 6. Run the reflective coverage test.
go test ./internal/tesla/normalize/... -run TestProtoCoverage -v
```

A new vendored proto MUST land in its own commit, separate from any code
changes that consume new fields — this keeps the diff reviewable.

## Why `.gitattributes` marks this file binary

The CHECKSUM gates correctness byte-for-byte. Git's default text attribute can
silently rewrite line endings on Windows checkouts (`CRLF` ↔ `LF`), which
would invalidate the SHA256. Marking the proto as binary disables both EOL
normalization and textual diffs, ensuring the bytes on disk always match what
was committed.
