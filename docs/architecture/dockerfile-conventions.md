# Dockerfile conventions

## Memory-conservative Go compile (Phase-45 / Prompt 10)

Every Dockerfile that builds a Go binary importing `internal/api` MUST
include the following flags:

```Dockerfile
RUN GOMEMLIMIT=2GiB CGO_ENABLED=0 GOOS=linux go build \
    -p 2 \
    -gcflags=all=-l \
    -ldflags="-s -w -X main.Version=${VERSION}" \
    -o /bin/<binary> ./cmd/<binary>
```

Why:

- Go 1.25's inliner crashes on the ~219-file `internal/api` package
  under memory pressure (sync/atomic/type.go nil-pointer panic).
- `GOMEMLIMIT=2GiB` bounds GC growth so peak RSS stays within runner limits.
- `-p 2` caps parallel compile jobs (default = NumCPU, often too high).
- `-gcflags=all=-l` disables inlining (sidesteps the crash with a small
  binary-size / perf cost that's negligible for an I/O-bound service).

Origin: bug #14 in the post-Phase-40 cycle — the `automation-worker`
Docker build crashed with an internal compiler panic at
`sync/atomic/type.go:47:6` while compiling `internal/api`. The fix
originally landed only on `Dockerfile.automation`; Phase-45 / Prompt 10
backported the flags to the three sibling Go Dockerfiles
(`Dockerfile`, `Dockerfile.notification`, `Dockerfile.export-worker`).

## Files in scope

| File | Builds | Backports flags? |
|------|--------|------------------|
| `Dockerfile` | `cmd/teslasync` (API server) | ✅ required |
| `Dockerfile.automation` | `cmd/automation-worker` | ✅ required (origin) |
| `Dockerfile.notification` | `cmd/notification-worker` | ✅ required |
| `Dockerfile.export-worker` | `cmd/export-worker` | ✅ required |
| `Dockerfile.web` | Vite + Nginx (JS only) | ❌ exempt |

When adding a new Dockerfile that builds a Go binary, copy these flags.
The `audit-dockerfile-go-flags.ps1` script in `.github/scripts/` enforces
this convention and should be added to CI to prevent regression.

## Running the audit locally

```powershell
.\.github\scripts\audit-dockerfile-go-flags.ps1
```

Exit code is non-zero if any in-scope Dockerfile is missing one of the
required flags.
