# tools/archmetrics

Architecture metrics snapshotter for TeslaSync. Captures package-level file
counts, LOC, import edges, and `doc.go` adoption into a JSON baseline used
by `arch_test.go` (see `internal/arch/`) and CI.

## Update the baseline (after a deliberate refactor)

```sh
make arch-baseline
git add tools/archmetrics/baseline.json tools/archmetrics/baseline.md
git commit -m "chore(arch): refresh baseline after <X>"
```

## Check for regressions (CI runs this)

```sh
make arch-check
```

Non-zero exit means one of:

- A new file landed in a frozen package (currently `internal/api`).
- A new layering violation appeared (e.g., a worker imported `internal/api`).
- `doc.go` coverage dropped below the baseline ratio.

## Walk roots

`tools/archmetrics` walks `cmd/`, `internal/`, and `tools/` (skipping
`vendor/`, `node_modules/`, and dotfile directories). The frontend, helm
chart, and `.github/` workflows are intentionally out of scope.

## Layer magic comment

A package opts into a named layer by including this in its `doc.go`:

```go
// Layer: domain
```

Allowed values: `domain`, `port`, `adapter`, `app`, `handler`, `platform`,
`cmd-internal`, `tool`. Anything else is silently ignored. Phase-47 / 03
adds the `doc.go` files; phase-47 / 02 enforces them via `arch_test.go`.

## Frozen packages

Per ADR-009 (`.github/ARCHITECTURE.md`, phase-47/06), `internal/api` is
frozen against new production `.go` files. New HTTP handlers belong in
`internal/handler/v1`. Test files (`_test.go`) for existing source files
are exempt because tests must live in the same Go package as the code
under test.

To intentionally add a file to a frozen package (e.g. for a critical bug
fix that genuinely belongs in `api/`):

1. Get explicit reviewer approval citing why `handler/v1` is unsuitable.
2. Add the file.
3. Refresh the baseline:

   ```sh
   make arch-baseline
   ```
4. Commit the baseline alongside the new file.
5. Reference the **ADR-009 Exceptions** block in the PR description.

`arch_test`'s `TestFrozenPackagesNoNewFiles` enforces the rule by
diffing the live tree against `tools/archmetrics/baseline.json`'s
`files_by_package` map.

## Forbidden edges (initial set)

| From | To | Status |
|---|---|---|
| `cmd/notification-worker` | `internal/api` | resolved (phase-47/05) |
| `cmd/automation-worker` | `internal/api` | resolved (phase-47/05) |
| `internal/domain/*` | `internal/adapter/*` | advisory until prompt 09 |
| `internal/domain/*` | `internal/database` | advisory until prompt 09 |
| `internal/handler/v1` | `internal/database` | advisory until prompt 10 |

Subsequent prompts (06, 09, 10) extend this list as ADRs land.
