package ops

import (
	"io/fs"
	"sort"
)

// Check is one named static gate.
type Check struct {
	Name        string
	Description string
	Run         func(fs.FS) []Finding
}

// Checks returns the registry consumed by cmd/ops-gate and by the
// readiness scorecard (a scorecard criterion may reference a gate by
// name).
//
// It is a function, not a package-level slice: the scorecard check
// itself calls LookupCheck to validate `gate:` references, which would
// be an initialisation cycle if the registry were a var.
func Checks() []Check {
	return []Check{
		{Name: "epics", Description: "OPS-12 accepted epics have owners, acceptance criteria, and real evidence", Run: CheckEpics},
		{Name: "smoke", Description: "OPS-01 post-deploy smoke manifest is complete and credential-free", Run: CheckSmoke},
		{Name: "rollback", Description: "OPS-02 rollback policy has measurable thresholds and an executable plan", Run: CheckRollback},
		{Name: "restore", Description: "OPS-03 restore drill is scheduled, self-contained by default, and honest about measurement", Run: CheckRestore},
		{Name: "migrations", Description: "OPS-04 every new migration is reviewed for forward compat, rollback, duration, and lock risk", Run: CheckMigrations},
		{Name: "rollout", Description: "OPS-05 staged/canary rollout controls match the Helm chart", Run: CheckRollout},
		{Name: "config-parity", Description: "OPS-06 config exists in Go, Compose, and Helm together", Run: CheckParity},
		{Name: "helm-secrets", Description: "Helm ships no static credentials and consistently supports external Secret sources", Run: CheckHelmSecrets},
		{Name: "supply-chain", Description: "OPS-08 release actions/images are immutable and attestations are required", Run: CheckSupplyChain},
		{Name: "capacity", Description: "OPS-10 capacity profiles are safe, repeatable, and never claim unrun results", Run: CheckCapacity},
		{Name: "retention", Description: "Default signal_log retention is bounded and consistently enforced", Run: CheckRetention},
		{Name: "fleet-api-budget", Description: "Fleet API spend has a shared daily ceiling and protected command reserve", Run: CheckFleetAPIBudget},
		{Name: "runbooks", Description: "OPS-11 every dependency has a complete degraded-mode runbook", Run: CheckRunbooks},
		{Name: "fixtures", Description: "Registered SQL fixtures match the schema reconstructed from migrations", Run: CheckFixtures},
		{Name: "workflows", Description: "CI workflows are free of shell injection and implicit-success() dependency traps", Run: CheckWorkflows},
		{Name: "scorecard", Description: "OPS-13 readiness scorecard definition is well-formed and its evidence resolves", Run: CheckScorecard},
	}
}

// CheckNames returns the registry names, sorted.
func CheckNames() []string {
	registry := Checks()
	out := make([]string, 0, len(registry))
	for _, c := range registry {
		out = append(out, c.Name)
	}
	sort.Strings(out)
	return out
}

// LookupCheck finds a check by name.
func LookupCheck(name string) (Check, bool) {
	for _, c := range Checks() {
		if c.Name == name {
			return c, true
		}
	}
	return Check{}, false
}

// RunChecks executes the named checks (all of them when names is empty)
// and returns the aggregated, deterministically-ordered result.
func RunChecks(fsys fs.FS, names []string) *Result {
	res := &Result{}
	if len(names) == 0 {
		for _, c := range Checks() {
			res.Add(c.Run(fsys)...)
		}
		res.Sort()
		return res
	}
	for _, name := range names {
		c, ok := LookupCheck(name)
		if !ok {
			res.Add(errf("ops-gate", name, "unknown check (available: %v)", CheckNames()))
			continue
		}
		res.Add(c.Run(fsys)...)
	}
	res.Sort()
	return res
}
