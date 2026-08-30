// Package main is the cmd/release-annotate entrypoint.
//
// Layer: cmd-internal
//
// OPS-07 — posts a Grafana annotation for every deploy, rollback, and
// stage promotion, tagged with the build SHA, version, environment,
// rollout stage, and the high-risk feature flags that were enabled.
//
// The point is correlation: when a burn-rate alert fires, the operator
// looking at a dashboard should be able to see the release boundary
// on the same time axis without cross-referencing a CI log.
//
// Credentials come from the environment (GRAFANA_URL, GRAFANA_TOKEN)
// and are never read from the repository.
package main
