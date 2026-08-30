// Package ops holds the loaders, validators, and evaluators for the
// machine-readable release/operations manifests under ops/.
//
// Layer: platform
//
// It depends only on the standard library plus gopkg.in/yaml.v3 so every
// gate is runnable from `go run ./cmd/...` on a laptop with no database,
// no cluster, and no credentials.
//
// The manifests it owns:
//
//	ops/epics.yaml                 OPS-12  accepted epics + owners + acceptance
//	ops/smoke/checks.yaml          OPS-01  post-deploy smoke checks
//	ops/rollback/policy.yaml       OPS-02  rollback thresholds + verdict rules
//	ops/restore/drill.yaml         OPS-03  backup restore drill definition
//	ops/migrations/manifest.yaml   OPS-04  migration review manifest
//	ops/rollout/stages.yaml        OPS-05  staged/canary rollout controls
//	ops/config/parity.yaml         OPS-06  config parity classification+baseline
//	ops/release/supply-chain.yaml  OPS-08  immutability + attestation policy
//	ops/capacity/profiles.yaml     OPS-10  capacity test profiles
//	ops/retention/policy.yaml      OP-04   bounded telemetry storage retention
//	ops/runbooks/dependencies.yaml OPS-11  degraded-mode runbook coverage
//	ops/scorecard/dimensions.yaml  OPS-13  readiness scorecard definition
//
// Every loader takes an fs.FS rooted at the repository root so tests can
// drive it from fstest.MapFS without touching the real tree.
package ops
