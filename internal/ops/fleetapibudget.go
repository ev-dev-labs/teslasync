package ops

import (
	"io/fs"
	"math"
	"regexp"
	"strconv"
	"strings"
)

const FleetAPIBudgetPolicyPath = "ops/fleet-api-budget/policy.yaml"

type FleetAPIBudgetPolicy struct {
	Version         int                             `yaml:"version"`
	DailyBudget     FleetAPIBudgetLimit             `yaml:"daily_budget"`
	CommandReserve  FleetAPIBudgetLimit             `yaml:"command_reserve"`
	Pricing         FleetAPIBudgetPricing           `yaml:"pricing_micro_usd"`
	IntegrationTest FleetAPIBudgetIntegrationPolicy `yaml:"integration_test"`
	PacingContract  FleetAPIBudgetPacingContract    `yaml:"pacing_contract"`
	Sources         FleetAPIBudgetSources           `yaml:"sources"`
}

type FleetAPIBudgetLimit struct {
	EnvironmentVariable string  `yaml:"environment_variable"`
	ConfigField         string  `yaml:"config_field"`
	HelmValue           string  `yaml:"helm_value"`
	DefaultUSD          float64 `yaml:"default_usd"`
}

type FleetAPIBudgetPricing struct {
	VehicleData  int64 `yaml:"vehicle_data"`
	WakeUp       int64 `yaml:"wake_up"`
	Command      int64 `yaml:"command"`
	VehicleSpecs int64 `yaml:"vehicle_specs"`
	Other        int64 `yaml:"other"`
}

type FleetAPIBudgetIntegrationPolicy struct {
	Schema             string `yaml:"schema"`
	Table              string `yaml:"table"`
	ForbidTempTable    bool   `yaml:"forbid_temp_table"`
	MinimumConnections int    `yaml:"minimum_connections"`
}

type FleetAPIBudgetPacingContract struct {
	PollEngineRequired []string `yaml:"poll_engine_required"`
	PollLifecycleCall  string   `yaml:"poll_lifecycle_call"`
}

type FleetAPIBudgetSources struct {
	GoConfig          string `yaml:"go_config"`
	Compose           string `yaml:"compose"`
	HelmValues        string `yaml:"helm_values"`
	HelmTemplate      string `yaml:"helm_template"`
	Client            string `yaml:"client"`
	PartnerClient     string `yaml:"partner_client"`
	CommandClient     string `yaml:"command_client"`
	Budget            string `yaml:"budget"`
	Repository        string `yaml:"repository"`
	RepositoryTest    string `yaml:"repository_test"`
	CIWorkflow        string `yaml:"ci_workflow"`
	Migration         string `yaml:"migration"`
	PollEngine        string `yaml:"poll_engine"`
	PollingState      string `yaml:"polling_state"`
	PollWorker        string `yaml:"poll_worker"`
	PollLifecycle     string `yaml:"poll_lifecycle"`
	WorkerConfig      string `yaml:"worker_config"`
	AppWiring         string `yaml:"app_wiring"`
	AutomationWiring  string `yaml:"automation_wiring"`
	ResubscribeWiring string `yaml:"resubscribe_wiring"`
	StatusHandler     string `yaml:"status_handler"`
	APIUsageHandler   string `yaml:"api_usage_handler"`
	Documentation     string `yaml:"documentation"`
}

func LoadFleetAPIBudgetPolicy(fsys fs.FS, path string) (*FleetAPIBudgetPolicy, error) {
	var policy FleetAPIBudgetPolicy
	if err := loadYAML(fsys, path, &policy); err != nil {
		return nil, err
	}
	return &policy, nil
}

func ValidateFleetAPIBudget(fsys fs.FS, policy *FleetAPIBudgetPolicy) []Finding {
	const check = "fleet-api-budget"
	var out []Finding

	if policy.Version != 1 {
		out = append(out, errf(check, FleetAPIBudgetPolicyPath, "unsupported version %d (want 1)", policy.Version))
	}
	if policy.DailyBudget.DefaultUSD <= 0 {
		out = append(out, errf(check, "daily_budget.default_usd", "must be positive so spend is bounded by default"))
	}
	if policy.CommandReserve.DefaultUSD <= 0 || policy.CommandReserve.DefaultUSD >= policy.DailyBudget.DefaultUSD {
		out = append(out, errf(check, "command_reserve.default_usd", "must be positive and lower than the daily budget"))
	}
	for name, price := range map[string]int64{
		"vehicle_data":  policy.Pricing.VehicleData,
		"wake_up":       policy.Pricing.WakeUp,
		"command":       policy.Pricing.Command,
		"vehicle_specs": policy.Pricing.VehicleSpecs,
		"other":         policy.Pricing.Other,
	} {
		if price <= 0 {
			out = append(out, errf(check, "pricing_micro_usd."+name, "must be positive"))
		}
	}
	if policy.IntegrationTest.Schema != "public" ||
		policy.IntegrationTest.Table != "tesla_api_budget_usage" {
		out = append(out, errf(check, "integration_test", "must exercise public.tesla_api_budget_usage from migration 000233"))
	}
	if !policy.IntegrationTest.ForbidTempTable {
		out = append(out, errf(check, "integration_test.forbid_temp_table", "must reject shadow temporary budget tables"))
	}
	if policy.IntegrationTest.MinimumConnections < 2 {
		out = append(out, errf(check, "integration_test.minimum_connections", "must require at least two PostgreSQL connections"))
	}
	requiredPacingMethods := map[string]bool{
		"MarkBudgetExhausted":   false,
		"MarkBudgetUnavailable": false,
		"ApplyBudgetPacing":     false,
		"ReconcileFleet":        false,
	}
	for _, method := range policy.PacingContract.PollEngineRequired {
		if _, required := requiredPacingMethods[method]; required {
			requiredPacingMethods[method] = true
		}
	}
	for method, present := range requiredPacingMethods {
		if !present {
			out = append(out, errf(check, "pacing_contract.poll_engine_required", "must include %s", method))
		}
	}
	if policy.PacingContract.PollLifecycleCall != "PollEngine.ReconcileFleet(vins)" {
		out = append(out, errf(check, "pacing_contract.poll_lifecycle_call", "must pin PollEngine.ReconcileFleet(vins)"))
	}

	sourcePaths := map[string]string{
		"go_config":          policy.Sources.GoConfig,
		"compose":            policy.Sources.Compose,
		"helm_values":        policy.Sources.HelmValues,
		"helm_template":      policy.Sources.HelmTemplate,
		"client":             policy.Sources.Client,
		"partner_client":     policy.Sources.PartnerClient,
		"command_client":     policy.Sources.CommandClient,
		"budget":             policy.Sources.Budget,
		"repository":         policy.Sources.Repository,
		"repository_test":    policy.Sources.RepositoryTest,
		"ci_workflow":        policy.Sources.CIWorkflow,
		"migration":          policy.Sources.Migration,
		"poll_engine":        policy.Sources.PollEngine,
		"polling_state":      policy.Sources.PollingState,
		"poll_worker":        policy.Sources.PollWorker,
		"poll_lifecycle":     policy.Sources.PollLifecycle,
		"worker_config":      policy.Sources.WorkerConfig,
		"app_wiring":         policy.Sources.AppWiring,
		"automation_wiring":  policy.Sources.AutomationWiring,
		"resubscribe_wiring": policy.Sources.ResubscribeWiring,
		"status_handler":     policy.Sources.StatusHandler,
		"api_usage_handler":  policy.Sources.APIUsageHandler,
		"documentation":      policy.Sources.Documentation,
	}
	sources := make(map[string]string, len(sourcePaths))
	for subject, path := range sourcePaths {
		if path == "" {
			out = append(out, errf(check, "sources."+subject, "path is required"))
			continue
		}
		raw, err := fs.ReadFile(fsys, path)
		if err != nil {
			out = append(out, errf(check, "sources."+subject, "read %s: %v", path, err))
			continue
		}
		sources[subject] = string(raw)
	}
	if len(out) > 0 {
		return out
	}

	out = append(out, validateBudgetLimitSurfaces(
		check, policy.DailyBudget, policy.Sources, sources,
	)...)
	out = append(out, validateBudgetLimitSurfaces(
		check, policy.CommandReserve, policy.Sources, sources,
	)...)

	budgetSource := sources["budget"]
	for symbol, value := range map[string]int64{
		"vehicleDataCostMicroUSD":  policy.Pricing.VehicleData,
		"wakeUpCostMicroUSD":       policy.Pricing.WakeUp,
		"commandCostMicroUSD":      policy.Pricing.Command,
		"vehicleSpecsCostMicroUSD": policy.Pricing.VehicleSpecs,
		"otherRequestCostMicroUSD": policy.Pricing.Other,
	} {
		pattern := regexp.MustCompile(regexp.QuoteMeta(symbol) + `\s+int64\s*=\s*([0-9_]+)`)
		match := pattern.FindStringSubmatch(budgetSource)
		if len(match) != 2 {
			out = append(out, errf(check, policy.Sources.Budget, "missing %s price constant", symbol))
			continue
		}
		got, err := strconv.ParseInt(strings.ReplaceAll(match[1], "_", ""), 10, 64)
		if err != nil || got != value {
			out = append(out, errf(check, policy.Sources.Budget, "%s = %s, want %d", symbol, match[1], value))
		}
	}
	for _, required := range []string{
		"ErrBudgetExceeded",
		"ErrBudgetUnavailable",
		"UsesCommandReserve",
		"BackgroundLimitMicroUSD",
		"NewMemoryRequestBudget",
	} {
		if !strings.Contains(budgetSource, required) {
			out = append(out, errf(check, policy.Sources.Budget, "missing budget contract %s", required))
		}
	}
	ciWorkflow := sources["ci_workflow"]
	if !strings.Contains(ciWorkflow, `TESLASYNC_TEST_DSN="$DB_URL"`) ||
		!strings.Contains(ciWorkflow, "TestRepoReserveAgainstPostgres") {
		out = append(out, errf(check, policy.Sources.CIWorkflow, "CI must execute the budget reservation test against PostgreSQL"))
	}

	client := sources["client"]
	for _, required := range []string{
		"requestBudget",
		"SetRequestBudget",
		"reserveBudget(ctx, method, path)",
		"NewMemoryRequestBudget(policy)",
	} {
		if !strings.Contains(client, required) {
			out = append(out, errf(check, policy.Sources.Client, "missing client enforcement %s", required))
		}
	}
	if !strings.Contains(client, "budgetHTTPStatus") {
		out = append(out, errf(check, policy.Sources.Client, "budget exhaustion and budget-store failures must have distinct HTTP status mapping"))
	}
	if !strings.Contains(sources["partner_client"], "reserveBudget(ctx, method, telemetryPath)") {
		out = append(out, errf(check, policy.Sources.PartnerClient, "partner-token requests must reserve against the shared budget"))
	}
	if strings.Count(sources["command_client"], "reserveBudget(ctx,") < 2 {
		out = append(out, errf(check, policy.Sources.CommandClient, "direct proxy and response proxy requests must both reserve against the shared budget"))
	}

	repository := sources["repository"]
	for _, required := range []string{
		"INSERT INTO tesla_api_budget_usage",
		"(NOW() AT TIME ZONE 'UTC')::date",
		"ON CONFLICT (budget_date) DO UPDATE",
		"$1::bigint",
		"$4::text",
		"estimated_cost_microusd + EXCLUDED.estimated_cost_microusd <= $5::bigint",
		"EXCLUDED.background_cost_microusd = 0",
		"OR tesla_api_budget_usage.background_cost_microusd + EXCLUDED.background_cost_microusd <= $6::bigint",
		"pgx.ErrNoRows",
		"BudgetExceededError",
	} {
		if !strings.Contains(repository, required) {
			out = append(out, errf(check, policy.Sources.Repository, "missing atomic reservation contract %q", required))
		}
	}
	repositoryTest := sources["repository_test"]
	for _, required := range []string{
		"TestRepoReserveAgainstPostgres",
		"TestRepoConcurrentReservationsAgainstPostgres",
		"TESLASYNC_TEST_DSN",
		"verifyMigratedBudgetTable",
		"assertMigratedBudgetConstraints",
		"pg_backend_pid()",
		"DELETE FROM tesla_api_budget_usage WHERE budget_date = $1",
	} {
		if !strings.Contains(repositoryTest, required) {
			out = append(out, errf(check, policy.Sources.RepositoryTest, "missing executable PostgreSQL evidence %q", required))
		}
	}
	tempTablePattern := regexp.MustCompile(`(?i)CREATE\s+(?:LOCAL\s+)?TEMP(?:ORARY)?\s+TABLE\s+(?:public\.)?tesla_api_budget_usage`)
	if tempTablePattern.MatchString(repositoryTest) {
		out = append(out, errf(check, policy.Sources.RepositoryTest, "integration test must use migrated public.tesla_api_budget_usage, not a shadow temporary table"))
	}

	migration := sources["migration"]
	for _, required := range []string{
		"CREATE TABLE tesla_api_budget_usage",
		"budget_date date PRIMARY KEY",
		"estimated_cost_microusd bigint NOT NULL",
		"background_cost_microusd bigint NOT NULL",
	} {
		if !strings.Contains(migration, required) {
			out = append(out, errf(check, policy.Sources.Migration, "missing schema contract %q", required))
		}
	}

	for sourceName, path := range map[string]string{
		"app_wiring":         policy.Sources.AppWiring,
		"automation_wiring":  policy.Sources.AutomationWiring,
		"resubscribe_wiring": policy.Sources.ResubscribeWiring,
	} {
		source := sources[sourceName]
		if !strings.Contains(source, "teslabudgetdb.New(") ||
			!strings.Contains(source, "SetRequestBudget(") {
			out = append(out, errf(check, path, "must replace the local budget with the shared PostgreSQL budget"))
		}
	}

	for _, required := range policy.PacingContract.PollEngineRequired {
		if !strings.Contains(sources["poll_engine"], required) {
			out = append(out, errf(check, policy.Sources.PollEngine, "poll engine must expose pacing contract %s", required))
		}
	}
	if !strings.Contains(sources["polling_state"], "tesla.EstimatedCostUSD(tesla.BudgetCategoryVehicleData)") ||
		!strings.Contains(sources["polling_state"], "BudgetPausedUntil") ||
		strings.Contains(sources["polling_state"], "0.00222") {
		out = append(out, errf(check, policy.Sources.PollingState, "polling estimates must use the canonical Fleet API vehicle-data price"))
	}
	for _, required := range []string{
		"PollEngine.MarkBudgetExhausted",
		"PollEngine.MarkBudgetUnavailable",
		"BudgetSnapshot(ctx)",
		"PollEngine.ApplyBudgetPacing",
	} {
		if !strings.Contains(sources["poll_worker"], required) {
			out = append(out, errf(check, policy.Sources.PollWorker, "production polling is missing budget behavior %q", required))
		}
	}
	if !strings.Contains(sources["poll_lifecycle"], policy.PacingContract.PollLifecycleCall) {
		out = append(out, errf(check, policy.Sources.PollLifecycle, "budget pacing must account for every configured vehicle"))
	}
	if !strings.Contains(sources["worker_config"], "discoveryInterval: time.Hour") {
		out = append(out, errf(check, policy.Sources.WorkerConfig, "Fleet API discovery must use the budget-safe hourly default"))
	}

	status := sources["status_handler"]
	for _, scope := range []string{
		"RateLimitScopeTeslaDailySpend",
		"RateLimitScopeTeslaBackground",
		"BudgetSnapshot(ctx)",
		"fleetAPIBudgetUnavailableWarning",
	} {
		if !strings.Contains(status, scope) {
			out = append(out, errf(check, policy.Sources.StatusHandler, "missing operator visibility %s", scope))
		}
	}
	apiUsageHandler := sources["api_usage_handler"]
	if strings.Contains(apiUsageHandler, "0.00222") {
		out = append(out, errf(check, policy.Sources.APIUsageHandler, "stale Fleet API price 0.00222 must not appear in the API usage surface"))
	}
	for _, required := range []string{
		"tesla.ClassifyBudgetCharge(",
		"tesla.EstimatedCostUSD(",
		"tesla.BudgetCategoryVehicleData",
	} {
		if !strings.Contains(apiUsageHandler, required) {
			out = append(out, errf(check, policy.Sources.APIUsageHandler, "API usage pricing must use canonical Tesla budget contract %q", required))
		}
	}

	documentation := sources["documentation"]
	for _, required := range []string{
		policy.DailyBudget.EnvironmentVariable,
		policy.CommandReserve.EnvironmentVariable,
		"fail closed",
		"UTC",
		"Tesla Developer Portal",
	} {
		if !strings.Contains(documentation, required) {
			out = append(out, errf(check, policy.Sources.Documentation, "missing operator guidance %q", required))
		}
	}

	return out
}

func validateBudgetLimitSurfaces(
	check string,
	limit FleetAPIBudgetLimit,
	sourcePaths FleetAPIBudgetSources,
	sources map[string]string,
) []Finding {
	var out []Finding
	configPattern := regexp.MustCompile(
		regexp.QuoteMeta(limit.ConfigField) + `\s*:\s*envFloat64\(\s*"` +
			regexp.QuoteMeta(limit.EnvironmentVariable) + `"\s*,\s*([0-9.]+)\s*\)`,
	)
	out = appendFloatDefaultFinding(out, check, sourcePaths.GoConfig, sources["go_config"], configPattern, limit.DefaultUSD)

	composePattern := regexp.MustCompile(
		regexp.QuoteMeta(limit.EnvironmentVariable) + `=\$\{` +
			regexp.QuoteMeta(limit.EnvironmentVariable) + `:-([0-9.]+)\}`,
	)
	out = appendFloatDefaultFinding(out, check, sourcePaths.Compose, sources["compose"], composePattern, limit.DefaultUSD)

	helmValuePattern := regexp.MustCompile(
		`(?m)^\s{2}` + regexp.QuoteMeta(limit.HelmValue) + `:\s*([0-9.]+)\s*(?:#.*)?$`,
	)
	out = appendFloatDefaultFinding(out, check, sourcePaths.HelmValues, sources["helm_values"], helmValuePattern, limit.DefaultUSD)

	helmPath := ".Values.tesla." + limit.HelmValue
	if !strings.Contains(sources["helm_template"], limit.EnvironmentVariable+":") ||
		!strings.Contains(sources["helm_template"], helmPath) {
		out = append(out, errf(check, sourcePaths.HelmTemplate,
			"must render %s from %s", limit.EnvironmentVariable, helmPath))
	}
	return out
}

func appendFloatDefaultFinding(
	out []Finding,
	check, path, source string,
	pattern *regexp.Regexp,
	expected float64,
) []Finding {
	match := pattern.FindStringSubmatch(source)
	if len(match) != 2 {
		return append(out, errf(check, path, "budget default %.6g is missing", expected))
	}
	got, err := strconv.ParseFloat(match[1], 64)
	if err != nil {
		return append(out, errf(check, path, "parse budget default %q: %v", match[1], err))
	}
	if math.Abs(got-expected) > 0.0000001 {
		return append(out, errf(check, path, "budget default is %.6g, want %.6g", got, expected))
	}
	return out
}

func CheckFleetAPIBudget(fsys fs.FS) []Finding {
	policy, err := LoadFleetAPIBudgetPolicy(fsys, FleetAPIBudgetPolicyPath)
	if err != nil {
		return []Finding{errf("fleet-api-budget", FleetAPIBudgetPolicyPath, "%v", err)}
	}
	return ValidateFleetAPIBudget(fsys, policy)
}
