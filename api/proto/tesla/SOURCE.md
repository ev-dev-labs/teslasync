# Vendored Tesla `vehicle_data.proto`

This directory vendors the canonical Tesla Fleet Telemetry protobuf schema as the
single source of truth for all generated signal metadata, enum parsers, and
`Datum.value` decoders in TeslaSync. See ADR-004 (`.github/ARCHITECTURE.md`) and
`.github/instructions/tesla-pipeline.instructions.md` for the architectural
rationale.

> **Forward-only.** Signal metadata, enum parsers, and decoders are generated
> from this proto. Do not hand-edit the vendored `vehicle_data.proto` — re-vendor
> from upstream instead, then re-run `go generate ./internal/tesla/protomodel/...`.

## Provenance

| Field | Value |
|---|---|
| Upstream repository | `github.com/teslamotors/fleet-telemetry` |
| Upstream path | `protos/vehicle_data.proto` |
| Upstream tag | untagged (`Cabin12vPortKeepOn` / `Cabin48vPortKeepOn`) |
| Upstream commit | `3d366a3da23c41b6fe4eb538409d071402c4884b` |
| Upstream commit date | 2026-09-24 |
| Upstream raw URL | <https://raw.githubusercontent.com/teslamotors/fleet-telemetry/3d366a3da23c41b6fe4eb538409d071402c4884b/protos/vehicle_data.proto> |
| Upstream tree URL | <https://github.com/teslamotors/fleet-telemetry/blob/3d366a3da23c41b6fe4eb538409d071402c4884b/protos/vehicle_data.proto> |
| File size | 22,007 bytes |
| SHA256 | `7E82B52A098B156671DC75701928792DC84B69D1C3A80956CAC68693AA00A301` |
| Fetched on | 2026-09-25 |
| Vendored by | upstream proto refresh |

The same checksum is recorded in `CHECKSUM` (one-line hex, uppercase) and the
upstream pin is recorded in `VERSION`. Both files gate against silent drift —
any divergence between the proto bytes and `CHECKSUM` will cause the prompt 0010
gate (and downstream codegen prompts) to fail.

The daily `fleet-proto-drift` workflow compares the vendored file to upstream
`main`, opens or updates a tracking issue when it changes, and lists added or
renumbered `Field` values and `Value` oneof variants. Review changes before
re-vendoring; the workflow never modifies production code automatically.
The two Semi cabin-port states are subscribed from generated metadata, decoded
to canonical `Off` / `On` / `Unknown` strings, persisted in `signal_log`, and
available in the existing live-signal explorer and signal history UI.

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

When Tesla publishes a new schema revision (tagged or untagged):

```powershell
# 1. Fetch the new proto (replace <NEW_COMMIT> with the upstream commit SHA).
$url = "https://raw.githubusercontent.com/teslamotors/fleet-telemetry/<NEW_COMMIT>/protos/vehicle_data.proto"
Invoke-WebRequest -Uri $url -OutFile api\proto\tesla\vehicle_data.proto -UseBasicParsing

# 2. Recompute the checksum and overwrite CHECKSUM (single-line uppercase hex).
$h = (Get-FileHash api\proto\tesla\vehicle_data.proto -Algorithm SHA256).Hash.ToUpperInvariant()
$h | Set-Content -NoNewline api\proto\tesla\CHECKSUM
Add-Content api\proto\tesla\CHECKSUM ""   # single trailing newline

# 3. Update VERSION with the new upstream revision + fetch date.
@(
  "teslamotors/fleet-telemetry@<NEW_COMMIT>",
  "commit=<NEW_COMMIT>",
  "fetched=$(Get-Date -Format yyyy-MM-dd)"
) | Set-Content api\proto\tesla\VERSION

# 4. Update the Provenance table in SOURCE.md (tag, commit, date, SHA256).

# 5. Upgrade the matching upstream Go module (its generated protobuf types
#    must include any new Field identifiers and Value oneof variants).
go get github.com/teslamotors/fleet-telemetry@<NEW_COMMIT>

# 6. Classify each new field in cmd/protogen-tesla/emit.go, regenerate
#    metadata/decoders, and add one routing.yaml entry per atomic field.
go generate ./internal/tesla/protomodel/...

# 7. Run the reflective metadata and routing coverage tests.
go test ./internal/tesla/protomodel/ ./internal/tesla/router/ -run 'TestCoverage|TestRoutingCoverage'
```

A new vendored proto MUST land in its own commit, separate from any code
changes that consume new fields — this keeps the diff reviewable.

## Why `.gitattributes` marks this file binary

The CHECKSUM gates correctness byte-for-byte. Git's default text attribute can
silently rewrite line endings on Windows checkouts (`CRLF` ↔ `LF`), which
would invalidate the SHA256. Marking the proto as binary disables both EOL
normalization and textual diffs, ensuring the bytes on disk always match what
was committed.
