// Package main is the cmd/rollback-evaluator entrypoint.
//
// Layer: cmd-internal
//
// OPS-02 — turns ops/rollback/policy.yaml plus observed release-health
// signals into a verdict: proceed, hold, or rollback.
//
// It NEVER performs a rollback. It decides and it prints the plan; the
// destructive action stays behind the manually-gated
// .github/workflows/deploy-rollback.yml job. Separating the decision
// from the action is what makes automatic evaluation safe to run on
// every deploy.
//
// See package internal/ops (rollback.go) for the policy schema and the
// evaluation rules.
package main
