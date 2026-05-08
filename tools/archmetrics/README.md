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

## Forbidden edges (initial set)

| From | To |
|---|---|
| `cmd/notification-worker` | `internal/api` |
| `cmd/automation-worker` | `internal/api` |
| `internal/domain/*` | `internal/adapter/*` |
| `internal/domain/*` | `internal/database` |
| `internal/handler/v1` | `internal/database` |

Subsequent prompts (06, 09, 10) extend this list as ADRs land.
