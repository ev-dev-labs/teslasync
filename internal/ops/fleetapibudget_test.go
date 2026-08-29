package ops

import (
	"strings"
	"testing"
	"testing/fstest"
)

func validFleetAPIBudgetFS() fstest.MapFS {
	return fstest.MapFS{
		FleetAPIBudgetPolicyPath: &fstest.MapFile{Data: []byte(`
version: 1
daily_budget:
  environment_variable: TESLA_API_DAILY_BUDGET_USD
  config_field: DailyBudgetUSD
  helm_value: dailyBudgetUsd
  default_usd: 0.30
command_reserve:
  environment_variable: TESLA_API_COMMAND_RESERVE_USD
  config_field: CommandReserveUSD
  helm_value: commandReserveUsd
  default_usd: 0.05
pricing_micro_usd:
  vehicle_data: 2000
  wake_up: 20000
  command: 1000
  vehicle_specs: 100000
  other: 1000
integration_test:
  schema: public
  table: tesla_api_budget_usage
  forbid_temp_table: true
  minimum_connections: 2
pacing_contract:
  poll_engine_required:
    - MarkBudgetExhausted
    - MarkBudgetUnavailable
    - ApplyBudgetPacing
    - ReconcileFleet
  poll_lifecycle_call: PollEngine.ReconcileFleet(vins)
sources:
  go_config: config.go
  compose: compose.yaml
  helm_values: values.yaml
  helm_template: template.yaml
  client: client.go
  partner_client: partner.go
  command_client: command.go
  budget: budget.go
  repository: repo.go
  repository_test: repo_test.go
  ci_workflow: workflow.yaml
  migration: migration.sql
  poll_engine: poll_engine.go
  polling_state: polling_state.go
  poll_worker: poll_worker.go
  poll_lifecycle: poll_lifecycle.go
  worker_config: worker.go
  app_wiring: app.go
  automation_wiring: automation.go
  resubscribe_wiring: resubscribe.go
  status_handler: status.go
  api_usage_handler: health.go
  documentation: docs.md
`)},
		"config.go": &fstest.MapFile{Data: []byte(`
DailyBudgetUSD: envFloat64("TESLA_API_DAILY_BUDGET_USD", 0.30),
CommandReserveUSD: envFloat64("TESLA_API_COMMAND_RESERVE_USD", 0.05),
`)},
		"compose.yaml": &fstest.MapFile{Data: []byte(`
- TESLA_API_DAILY_BUDGET_USD=${TESLA_API_DAILY_BUDGET_USD:-0.30}
- TESLA_API_COMMAND_RESERVE_USD=${TESLA_API_COMMAND_RESERVE_USD:-0.05}
`)},
		"values.yaml": &fstest.MapFile{Data: []byte(`
tesla:
  dailyBudgetUsd: 0.30
  commandReserveUsd: 0.05
`)},
		"template.yaml": &fstest.MapFile{Data: []byte(`
TESLA_API_DAILY_BUDGET_USD: {{ .Values.tesla.dailyBudgetUsd }}
TESLA_API_COMMAND_RESERVE_USD: {{ .Values.tesla.commandReserveUsd }}
`)},
		"client.go": &fstest.MapFile{Data: []byte(`
requestBudget RequestBudget
func SetRequestBudget() {}
func call() { reserveBudget(ctx, method, path); NewMemoryRequestBudget(policy); budgetHTTPStatus(err) }
`)},
		"partner.go": &fstest.MapFile{Data: []byte(`
func call() { reserveBudget(ctx, method, telemetryPath) }
`)},
		"command.go": &fstest.MapFile{Data: []byte(`
func direct() { reserveBudget(ctx, http.MethodPost, path) }
func response() { reserveBudget(ctx, method, path) }
`)},
		"budget.go": &fstest.MapFile{Data: []byte(`
const (
vehicleDataCostMicroUSD int64 = 2_000
wakeUpCostMicroUSD int64 = 20_000
commandCostMicroUSD int64 = 1_000
vehicleSpecsCostMicroUSD int64 = 100_000
otherRequestCostMicroUSD int64 = 1_000
)
var ErrBudgetExceeded error
var ErrBudgetUnavailable error
var UsesCommandReserve bool
func BackgroundLimitMicroUSD() {}
func NewMemoryRequestBudget() {}
`)},
		"repo.go": &fstest.MapFile{Data: []byte(`
INSERT INTO tesla_api_budget_usage
(NOW() AT TIME ZONE 'UTC')::date
$1::bigint
$4::text
ON CONFLICT (budget_date) DO UPDATE
estimated_cost_microusd + EXCLUDED.estimated_cost_microusd <= $5::bigint
background_cost_microusd + EXCLUDED.background_cost_microusd <= $6::bigint
EXCLUDED.background_cost_microusd = 0
OR tesla_api_budget_usage.background_cost_microusd + EXCLUDED.background_cost_microusd <= $6::bigint
pgx.ErrNoRows
BudgetExceededError
`)},
		"repo_test.go": &fstest.MapFile{Data: []byte(`
func TestRepoReserveAgainstPostgres() {
TESLASYNC_TEST_DSN
verifyMigratedBudgetTable
assertMigratedBudgetConstraints
DELETE FROM tesla_api_budget_usage WHERE budget_date = $1
}
func TestRepoConcurrentReservationsAgainstPostgres() {
pg_backend_pid()
}
`)},
		"workflow.yaml": &fstest.MapFile{Data: []byte(`
run: TESLASYNC_TEST_DSN="$DB_URL" go test ./internal/database/teslabudget -run TestRepoReserveAgainstPostgres
`)},
		"migration.sql": &fstest.MapFile{Data: []byte(`
CREATE TABLE tesla_api_budget_usage (
budget_date date PRIMARY KEY,
estimated_cost_microusd bigint NOT NULL,
background_cost_microusd bigint NOT NULL
);
`)},
		"app.go":         &fstest.MapFile{Data: []byte(`SetRequestBudget(teslabudgetdb.New(db))`)},
		"automation.go":  &fstest.MapFile{Data: []byte(`SetRequestBudget(teslabudgetdb.New(db))`)},
		"resubscribe.go": &fstest.MapFile{Data: []byte(`SetRequestBudget(teslabudgetdb.New(db))`)},
		"poll_engine.go": &fstest.MapFile{Data: []byte(`
func MarkBudgetExhausted() {}
func MarkBudgetUnavailable() {}
func ApplyBudgetPacing() {}
func ReconcileFleet() {}
`)},
		"polling_state.go": &fstest.MapFile{Data: []byte(`
BudgetPausedUntil time.Time
var CostPerRequest = tesla.EstimatedCostUSD(tesla.BudgetCategoryVehicleData)
`)},
		"poll_worker.go": &fstest.MapFile{Data: []byte(`
PollEngine.MarkBudgetExhausted(vin, resetAt)
PollEngine.MarkBudgetUnavailable(vin, retryAt)
BudgetSnapshot(ctx)
PollEngine.ApplyBudgetPacing(vin, snapshot)
`)},
		"poll_lifecycle.go": &fstest.MapFile{Data: []byte(`
PollEngine.ReconcileFleet(vins)
`)},
		"worker.go": &fstest.MapFile{Data: []byte(`
discoveryInterval: time.Hour
`)},
		"status.go": &fstest.MapFile{Data: []byte(`
RateLimitScopeTeslaDailySpend
RateLimitScopeTeslaBackground
BudgetSnapshot(ctx)
fleetAPIBudgetUnavailableWarning
`)},
		"health.go": &fstest.MapFile{Data: []byte(`
func usage() {
tesla.ClassifyBudgetCharge(method, endpoint)
tesla.EstimatedCostUSD(tesla.BudgetCategoryVehicleData)
}
`)},
		"docs.md": &fstest.MapFile{Data: []byte(`
TESLA_API_DAILY_BUDGET_USD TESLA_API_COMMAND_RESERVE_USD fail closed UTC Tesla Developer Portal
`)},
	}
}

func loadFleetAPIBudgetForTest(t *testing.T, fsys fstest.MapFS) *FleetAPIBudgetPolicy {
	t.Helper()
	policy, err := LoadFleetAPIBudgetPolicy(fsys, FleetAPIBudgetPolicyPath)
	if err != nil {
		t.Fatalf("LoadFleetAPIBudgetPolicy() error = %v", err)
	}
	return policy
}

func TestValidateFleetAPIBudgetAcceptsCompleteContract(t *testing.T) {
	fsys := validFleetAPIBudgetFS()
	if findings := ValidateFleetAPIBudget(fsys, loadFleetAPIBudgetForTest(t, fsys)); len(findings) != 0 {
		t.Fatalf("unexpected findings: %+v", findings)
	}
}

func TestValidateFleetAPIBudgetRejectsDrift(t *testing.T) {
	tests := []struct {
		name string
		path string
		old  string
		new  string
		want string
	}{
		{"unbounded default", FleetAPIBudgetPolicyPath, "default_usd: 0.30", "default_usd: 0", "bounded by default"},
		{"compose drift", "compose.yaml", ":-0.30", ":-3.00", "budget default is 3"},
		{"price drift", "budget.go", "2_000", "3_000", "vehicleDataCostMicroUSD = 3_000"},
		{"atomic guard missing", "repo.go", "estimated_cost_microusd + EXCLUDED.estimated_cost_microusd <= $5::bigint", "TRUE", "missing atomic reservation"},
		{"command reserve bypass missing", "repo.go", "EXCLUDED.background_cost_microusd = 0", "FALSE", "missing atomic reservation"},
		{"migrated schema evidence missing", "repo_test.go", "verifyMigratedBudgetTable", "assumeMigratedBudgetTable", "missing executable PostgreSQL evidence"},
		{"temporary table shadow", "repo_test.go", "TESLASYNC_TEST_DSN", "TESLASYNC_TEST_DSN\nCREATE TEMP TABLE tesla_api_budget_usage", "not a shadow temporary table"},
		{"poll engine reconciliation missing", "poll_engine.go", "func ReconcileFleet() {}", "func IgnoreFleet() {}", "poll engine must expose pacing contract"},
		{"poll lifecycle reconciliation missing", "poll_lifecycle.go", "PollEngine.ReconcileFleet(vins)", "PollEngine.SetFleetSize(len(vehicles))", "budget pacing must account"},
		{"policy reconciliation method missing", FleetAPIBudgetPolicyPath, "    - ReconcileFleet", "    - SetFleetSize", "must include ReconcileFleet"},
		{"policy lifecycle call drift", FleetAPIBudgetPolicyPath, "poll_lifecycle_call: PollEngine.ReconcileFleet(vins)", "poll_lifecycle_call: PollEngine.SetFleetSize(len(vehicles))", "must pin PollEngine.ReconcileFleet(vins)"},
		{"worker wiring missing", "automation.go", "SetRequestBudget", "IgnoreBudget", "shared PostgreSQL budget"},
		{"operator visibility missing", "status.go", "RateLimitScopeTeslaDailySpend", "OldScope", "missing operator visibility"},
		{"API usage canonical price missing", "health.go", "tesla.EstimatedCostUSD", "legacyEstimatedCostUSD", "canonical Tesla budget contract"},
		{"API usage stale price", "health.go", "func usage() {", "func usage() {\nconst oldPrice = 0.00222", "stale Fleet API price"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			fsys := validFleetAPIBudgetFS()
			file := fsys[tt.path]
			file.Data = []byte(strings.Replace(string(file.Data), tt.old, tt.new, 1))
			findings := ValidateFleetAPIBudget(fsys, loadFleetAPIBudgetForTest(t, fsys))
			if !hasMessage(findings, tt.want) {
				t.Fatalf("want finding containing %q, got %+v", tt.want, findings)
			}
		})
	}
}
