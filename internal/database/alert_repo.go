package database

import (
	"context"
	"sort"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// AlertRuleRepo provides alert rule data access.
type AlertRuleRepo struct {
	db *DB
}

func NewAlertRuleRepo(db *DB) *AlertRuleRepo {
	return &AlertRuleRepo{db: db}
}

// alertRuleColumns is the canonical SELECT column list, kept in sync with
// scanAlertRule below. Add new columns here AND in scanAlertRule when extending
// the schema (migration 000158_alert_rule_kinds added kind/metric_*; migration
// 000194 added max_fires_per_resolution; migration 000195 added all_vehicles;
// migration 000196 added escalation_after_min/escalation_severity).
const alertRuleColumns = `id, name, description, enabled, vehicle_id, all_vehicles,
	signal_name, op,
	value_num, value_text, value_bool, value_min, value_max,
	severity, cooldown_min, trigger_mode, snoozed_until,
	kind, metric_id, metric_window, metric_threshold, metric_op,
	max_fires_per_resolution,
	escalation_after_min, escalation_severity,
	created_at, updated_at`

func scanAlertRule(row interface{ Scan(dest ...any) error }, ar *models.AlertRule) error {
	return row.Scan(
		&ar.ID, &ar.Name, &ar.Description, &ar.Enabled, &ar.VehicleID, &ar.AllVehicles,
		&ar.SignalName, &ar.Op, &ar.ValueNum, &ar.ValueText, &ar.ValueBool,
		&ar.ValueMin, &ar.ValueMax, &ar.Severity, &ar.CooldownMin,
		&ar.TriggerMode, &ar.SnoozedUntil,
		&ar.Kind, &ar.MetricID, &ar.MetricWindow, &ar.MetricThreshold, &ar.MetricOp,
		&ar.MaxFiresPerResolution,
		&ar.EscalationAfterMin, &ar.EscalationSeverity,
		&ar.CreatedAt, &ar.UpdatedAt,
	)
}

// hydrateRuleVehicles populates `VehicleIDs` on every rule by issuing a
// single junction-table query keyed on the supplied rule IDs. Always
// initialises VehicleIDs to a non-nil slice so JSON encoding emits `[]`
// instead of `null` (Phase-49 / Slice 0005 / Decision D8 + R3 from
// rubber-duck critique). Safe to call with an empty rules slice.
func (r *AlertRuleRepo) hydrateRuleVehicles(ctx context.Context, q pgxQuerier, rules []*models.AlertRule) error {
	if len(rules) == 0 {
		return nil
	}
	byID := make(map[int64]*models.AlertRule, len(rules))
	ids := make([]int64, 0, len(rules))
	for _, ar := range rules {
		if ar == nil {
			continue
		}
		// Initialise to non-nil empty slice so JSON encodes as `[]`
		// when no junction rows exist for this rule.
		ar.VehicleIDs = []int64{}
		byID[ar.ID] = ar
		ids = append(ids, ar.ID)
	}
	if len(ids) == 0 {
		return nil
	}
	rows, err := q.Query(ctx,
		`SELECT rule_id, vehicle_id FROM alert_rule_vehicles WHERE rule_id = ANY($1)`,
		ids)
	if err != nil {
		return err
	}
	defer rows.Close()
	for rows.Next() {
		var ruleID, vehicleID int64
		if err := rows.Scan(&ruleID, &vehicleID); err != nil {
			return err
		}
		if ar, ok := byID[ruleID]; ok {
			ar.VehicleIDs = append(ar.VehicleIDs, vehicleID)
		}
	}
	if err := rows.Err(); err != nil {
		return err
	}
	// Sort for deterministic equality + JSON output.
	for _, ar := range byID {
		sort.Slice(ar.VehicleIDs, func(i, j int) bool { return ar.VehicleIDs[i] < ar.VehicleIDs[j] })
	}
	return nil
}

// pgxQuerier is the minimal interface satisfied by both *pgxpool.Pool
// (via DB.Pool) and pgx.Tx, so hydrateRuleVehicles can run inside or
// outside a transaction.
type pgxQuerier interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// validateVehicleSelection enforces the multi-select invariants used by
// both Create and Update before any SQL touches the row. Phase-49 /
// Slice 0005 / Decision D9.
func validateVehicleSelection(allVehicles bool, vehicleIDs []int64) error {
	if allVehicles && len(vehicleIDs) > 0 {
		return ErrInvalidVehicleSelection
	}
	if !allVehicles && len(vehicleIDs) == 0 {
		return ErrInvalidVehicleSelection
	}
	for _, vid := range vehicleIDs {
		if vid <= 0 {
			return ErrInvalidVehicleSelection
		}
	}
	return nil
}

// ErrInvalidVehicleSelection is returned by Create/Update when the
// AlertRule's (AllVehicles, VehicleIDs) pair violates the multi-select
// invariant. Handlers translate this to HTTP 422.
var ErrInvalidVehicleSelection = errInvalidVehicleSelection{}

type errInvalidVehicleSelection struct{}

func (errInvalidVehicleSelection) Error() string {
	return "alert rule vehicle selection: must specify either all_vehicles=true or a non-empty vehicle_ids subset (mutually exclusive)"
}

// legacyVehicleIDFor returns the value to write into the deprecated
// `alert_rules.vehicle_id` column. Per Phase-49 / Slice 0005 / Decision
// D7, the legacy column is kept in sync for one release so a downgraded
// API binary still sees a sensible value during a rolling deploy:
//   - AllVehicles=TRUE              -> NULL
//   - AllVehicles=FALSE, len 1      -> that vehicle ID
//   - AllVehicles=FALSE, len > 1    -> MIN(vehicleIDs); other vehicles
//                                      are not visible to the old binary
//                                      until the deploy completes.
func legacyVehicleIDFor(allVehicles bool, vehicleIDs []int64) *int64 {
	if allVehicles || len(vehicleIDs) == 0 {
		return nil
	}
	min := vehicleIDs[0]
	for _, vid := range vehicleIDs[1:] {
		if vid < min {
			min = vid
		}
	}
	return &min
}

// dedupAndSortVehicleIDs returns a sorted slice with duplicates removed.
// Defensive: handlers also dedup, but the repo runs the same pass so an
// unsanitised programmatic caller can't trip the junction PK. Always
// returns a non-nil slice so JSON encoding emits `[]` instead of `null`.
func dedupAndSortVehicleIDs(in []int64) []int64 {
	if len(in) == 0 {
		return []int64{}
	}
	tmp := make([]int64, len(in))
	copy(tmp, in)
	sort.Slice(tmp, func(i, j int) bool { return tmp[i] < tmp[j] })
	out := tmp[:0]
	var prev int64
	for i, v := range tmp {
		if i == 0 || v != prev {
			out = append(out, v)
			prev = v
		}
	}
	return out
}

func (r *AlertRuleRepo) GetAll(ctx context.Context) ([]*models.AlertRule, error) {
	query := `SELECT ` + alertRuleColumns + ` FROM alert_rules ORDER BY id LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.AlertRule
	for rows.Next() {
		ar := &models.AlertRule{}
		if err := scanAlertRule(rows, ar); err != nil {
			return nil, err
		}
		rules = append(rules, ar)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.hydrateRuleVehicles(ctx, r.db.Pool, rules); err != nil {
		return nil, err
	}
	return rules, nil
}

// GetEnabledByKind returns enabled rules of a specific kind. Used by the
// computed-metric scheduled evaluator to skip signal rules cheaply via the
// idx_alert_rules_kind_enabled partial index.
func (r *AlertRuleRepo) GetEnabledByKind(ctx context.Context, kind string) ([]*models.AlertRule, error) {
	query := `SELECT ` + alertRuleColumns + ` FROM alert_rules
		WHERE kind = $1 AND enabled = TRUE ORDER BY id LIMIT 1000`
	rows, err := r.db.Pool.Query(ctx, query, kind)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var rules []*models.AlertRule
	for rows.Next() {
		ar := &models.AlertRule{}
		if err := scanAlertRule(rows, ar); err != nil {
			return nil, err
		}
		rules = append(rules, ar)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if err := r.hydrateRuleVehicles(ctx, r.db.Pool, rules); err != nil {
		return nil, err
	}
	return rules, nil
}

// Update writes the rule and atomically replaces its junction rows in a
// single transaction. The caller-supplied `rule.AllVehicles` and
// `rule.VehicleIDs` are validated and normalised; `rule.VehicleID`
// (deprecated legacy column) is always overwritten with
// `legacyVehicleIDFor(...)` to keep both spellings in sync per Decision
// D7. Phase-49 / Slice 0005.
func (r *AlertRuleRepo) Update(ctx context.Context, id int64, rule *models.AlertRule) error {
	vehicleIDs := dedupAndSortVehicleIDs(rule.VehicleIDs)
	if err := validateVehicleSelection(rule.AllVehicles, vehicleIDs); err != nil {
		return err
	}
	rule.VehicleIDs = vehicleIDs
	rule.VehicleID = legacyVehicleIDFor(rule.AllVehicles, vehicleIDs)

	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		_, err := tx.Exec(ctx,
			`UPDATE alert_rules SET name=$2, description=$3, enabled=$4, vehicle_id=$5,
			all_vehicles=$6,
			signal_name=$7, op=$8, value_num=$9, value_text=$10, value_bool=$11,
			value_min=$12, value_max=$13, severity=$14, cooldown_min=$15,
			trigger_mode=$16, snoozed_until=$17,
			kind=$18, metric_id=$19, metric_window=$20, metric_threshold=$21, metric_op=$22,
			max_fires_per_resolution=$23,
			escalation_after_min=$24, escalation_severity=$25,
			updated_at=$26
			WHERE id=$1`,
			id, rule.Name, rule.Description, rule.Enabled, rule.VehicleID,
			rule.AllVehicles,
			rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText, rule.ValueBool,
			rule.ValueMin, rule.ValueMax, rule.Severity, rule.CooldownMin,
			rule.TriggerMode, rule.SnoozedUntil,
			rule.Kind, rule.MetricID, rule.MetricWindow, rule.MetricThreshold, rule.MetricOp,
			rule.MaxFiresPerResolution,
			rule.EscalationAfterMin, rule.EscalationSeverity,
			time.Now().UTC())
		if err != nil {
			return err
		}
		if _, err := tx.Exec(ctx,
			`DELETE FROM alert_rule_vehicles WHERE rule_id = $1`, id); err != nil {
			return err
		}
		if !rule.AllVehicles && len(vehicleIDs) > 0 {
			batch := &pgx.Batch{}
			for _, vid := range vehicleIDs {
				batch.Queue(
					`INSERT INTO alert_rule_vehicles (rule_id, vehicle_id) VALUES ($1, $2)
					 ON CONFLICT DO NOTHING`,
					id, vid)
			}
			br := tx.SendBatch(ctx, batch)
			defer br.Close()
			for range vehicleIDs {
				if _, err := br.Exec(); err != nil {
					return err
				}
			}
			if err := br.Close(); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *AlertRuleRepo) GetByID(ctx context.Context, id int64) (*models.AlertRule, error) {
	query := `SELECT ` + alertRuleColumns + ` FROM alert_rules WHERE id = $1`
	ar := &models.AlertRule{}
	err := scanAlertRule(r.db.Pool.QueryRow(ctx, query, id), ar)
	if err == pgx.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if err := r.hydrateRuleVehicles(ctx, r.db.Pool, []*models.AlertRule{ar}); err != nil {
		return nil, err
	}
	return ar, nil
}

// Create inserts the rule and its junction rows in a single transaction.
// Same validation + legacy-column-mirroring contract as Update.
// Phase-49 / Slice 0005.
func (r *AlertRuleRepo) Create(ctx context.Context, rule *models.AlertRule) error {
	if rule.Kind == "" {
		rule.Kind = models.AlertRuleKindSignal
	}
	vehicleIDs := dedupAndSortVehicleIDs(rule.VehicleIDs)
	if err := validateVehicleSelection(rule.AllVehicles, vehicleIDs); err != nil {
		return err
	}
	rule.VehicleIDs = vehicleIDs
	rule.VehicleID = legacyVehicleIDFor(rule.AllVehicles, vehicleIDs)

	return r.db.WithTx(ctx, func(tx pgx.Tx) error {
		query := `INSERT INTO alert_rules (name, description, enabled, vehicle_id,
			all_vehicles,
			signal_name, op,
			value_num, value_text, value_bool, value_min, value_max,
			severity, cooldown_min, trigger_mode, snoozed_until,
			kind, metric_id, metric_window, metric_threshold, metric_op,
			max_fires_per_resolution,
			escalation_after_min, escalation_severity,
			created_at, updated_at)
			VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
				$16, $17, $18, $19, $20, $21, $22, $23, $24, NOW(), NOW())
			RETURNING id, created_at, updated_at`
		err := tx.QueryRow(ctx, query, rule.Name, rule.Description, rule.Enabled,
			rule.VehicleID, rule.AllVehicles,
			rule.SignalName, rule.Op, rule.ValueNum, rule.ValueText,
			rule.ValueBool, rule.ValueMin, rule.ValueMax, rule.Severity, rule.CooldownMin,
			rule.TriggerMode, rule.SnoozedUntil,
			rule.Kind, rule.MetricID, rule.MetricWindow, rule.MetricThreshold, rule.MetricOp,
			rule.MaxFiresPerResolution,
			rule.EscalationAfterMin, rule.EscalationSeverity).
			Scan(&rule.ID, &rule.CreatedAt, &rule.UpdatedAt)
		if err != nil {
			return err
		}
		if !rule.AllVehicles && len(vehicleIDs) > 0 {
			batch := &pgx.Batch{}
			for _, vid := range vehicleIDs {
				batch.Queue(
					`INSERT INTO alert_rule_vehicles (rule_id, vehicle_id) VALUES ($1, $2)
					 ON CONFLICT DO NOTHING`,
					rule.ID, vid)
			}
			br := tx.SendBatch(ctx, batch)
			defer br.Close()
			for range vehicleIDs {
				if _, err := br.Exec(); err != nil {
					return err
				}
			}
			if err := br.Close(); err != nil {
				return err
			}
		}
		return nil
	})
}

func (r *AlertRuleRepo) Delete(ctx context.Context, id int64) error {
	// alert_rule_vehicles has ON DELETE CASCADE so junction rows clean up.
	_, err := r.db.Pool.Exec(ctx, `DELETE FROM alert_rules WHERE id = $1`, id)
	return err
}

// FilterExistingIDs returns the subset of `ids` that exist in alert_rules.
// Used by bulk handlers to surface {id, "not_found"} per-id failures.
func (r *AlertRuleRepo) FilterExistingIDs(ctx context.Context, ids []int64) ([]int64, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT id FROM alert_rules WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]int64, 0, len(ids))
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// BulkSetEnabled toggles `enabled` for every rule in `ids` inside a single
// transaction. Returns the actual rows-affected count. Bumps updated_at
// so the audit trail reflects the action.
func (r *AlertRuleRepo) BulkSetEnabled(ctx context.Context, ids []int64, enabled bool) (int64, error) {
	if len(ids) == 0 {
		return 0, nil
	}
	var updated int64
	err := r.db.WithTx(ctx, func(tx pgx.Tx) error {
		tag, err := tx.Exec(ctx,
			`UPDATE alert_rules SET enabled = $2, updated_at = NOW() WHERE id = ANY($1)`,
			ids, enabled)
		if err != nil {
			return err
		}
		updated = tag.RowsAffected()
		return nil
	})
	if err != nil {
		return 0, err
	}
	return updated, nil
}

// SetSnooze sets snoozed_until on a rule. Pass nil to clear the snooze.
// updated_at is bumped so the audit trail reflects the action.
func (r *AlertRuleRepo) SetSnooze(ctx context.Context, id int64, until *time.Time) error {
	_, err := r.db.Pool.Exec(ctx,
		`UPDATE alert_rules SET snoozed_until = $2, updated_at = NOW() WHERE id = $1`,
		id, until)
	return err
}

// RuleAppliesToDB is the database-resident counterpart to
// `(*models.AlertRule).AppliesTo` for callers that don't already have
// the rule loaded in memory (settings export validators, admin tooling).
// Returns true when the rule has all_vehicles=TRUE OR an explicit
// (rule_id, vehicle_id) row exists in the junction table. Phase-49 /
// Slice 0005 / Decision D4.
func (r *AlertRuleRepo) RuleAppliesToDB(ctx context.Context, ruleID, vehicleID int64) (bool, error) {
	var matches bool
	err := r.db.Pool.QueryRow(ctx,
		`SELECT (ar.all_vehicles
			OR EXISTS (
				SELECT 1 FROM alert_rule_vehicles
				 WHERE rule_id = ar.id AND vehicle_id = $2
			))
		   FROM alert_rules ar
		  WHERE ar.id = $1`,
		ruleID, vehicleID).Scan(&matches)
	if err == pgx.ErrNoRows {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return matches, nil
}
