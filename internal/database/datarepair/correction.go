package datarepair

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/ev-dev-labs/teslasync/internal/tracing"
	"github.com/jackc/pgx/v5"
)

type CorrectionMode string

var ErrCorrectionStale = errors.New("data-repair correction evidence is stale")

const (
	CorrectionDerive       CorrectionMode = "derive"
	CorrectionReplace      CorrectionMode = "replace"
	CorrectionClear        CorrectionMode = "clear"
	CorrectionBoundaryMode CorrectionMode = "boundary"
)

// CorrectionSource retains the nullable, unrounded values used by the
// anomaly detector. It also serves as the optimistic-concurrency snapshot.
type CorrectionSource struct {
	Kind               AnomalyKind `json:"kind"`
	ID                 int64       `json:"id"`
	VehicleID          int64       `json:"vehicle_id"`
	StartedAt          time.Time   `json:"started_at"`
	EndedAt            *time.Time  `json:"ended_at"`
	DurationS          *int64      `json:"duration_s"`
	DistanceM          *float64    `json:"distance_m"`
	StartOdometerM     *float64    `json:"start_odometer_m"`
	EndOdometerM       *float64    `json:"end_odometer_m"`
	StartSocPct        *float64    `json:"start_soc_pct"`
	EndSocPct          *float64    `json:"end_soc_pct"`
	DeltaSocPct        *float64    `json:"delta_soc_pct"`
	EnergyUsedWh       *float64    `json:"energy_used_wh"`
	RegenEnergyWh      *float64    `json:"regen_energy_wh"`
	TotalEnergyAddedWh *float64    `json:"total_energy_added_wh"`
	CostDecimal        *string     `json:"cost_decimal"`
	CostCurrency       *string     `json:"cost_currency"`
	CostSource         *string     `json:"cost_source"`
	RateID             *int64      `json:"rate_id"`
}

type CorrectionChoice struct {
	Field string         `json:"field"`
	Mode  CorrectionMode `json:"mode"`
	Value *float64       `json:"value"`
}

type CorrectionChange struct {
	Field      string   `json:"field"`
	Before     *float64 `json:"before"`
	After      *float64 `json:"after"`
	BeforeText *string  `json:"before_text,omitempty"`
	AfterText  *string  `json:"after_text,omitempty"`
	Unit       *string  `json:"unit,omitempty"`
}

type CorrectionPlan struct {
	Changes  []CorrectionChange     `json:"changes"`
	Fields   map[string]interface{} `json:"-"`
	Boundary *CorrectionBoundary    `json:"-"`
	Other    *CorrectionWindow      `json:"-"`
}

type CorrectionWindow struct {
	Kind      AnomalyKind `json:"kind"`
	ID        int64       `json:"id"`
	StartedAt time.Time   `json:"started_at"`
	EndedAt   *time.Time  `json:"ended_at"`
}

type CorrectionBoundary struct {
	CorrectionWindow
	ProposedEndedAt time.Time
	DurationS       int64
}

// CorrectionRepo reads the same measurements as the anomaly scanner without
// losing SQL NULLs or rounding drive SoC to the public Drive model's integers.
type CorrectionRepo struct {
	db *database.DB
}

func NewCorrectionRepo(db *database.DB) *CorrectionRepo {
	return &CorrectionRepo{db: db}
}

func (r *CorrectionRepo) GetSource(
	ctx context.Context,
	tx database.DBTX,
	kind AnomalyKind,
	id int64,
	lock bool,
) (*CorrectionSource, error) {
	if lock && tx == nil {
		return nil, errors.New("data-repair correction requires a transaction to lock the source")
	}
	if tx == nil {
		if r == nil || r.db == nil || r.db.Pool == nil {
			return nil, ErrNoDatabase
		}
		tx = r.db.Pool
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_source")
	defer span.End()

	source := &CorrectionSource{Kind: kind}
	var err error
	switch kind {
	case AnomalyKindDrive:
		query := `SELECT id, vehicle_id, started_at, ended_at, duration_s, distance_m,
			start_odometer_m, end_odometer_m, start_soc_pct, end_soc_pct,
			energy_used_wh, regen_energy_wh
			FROM drives WHERE id = $1`
		if lock {
			query += ` FOR UPDATE`
		}
		err = tx.QueryRow(ctx, query, id).Scan(
			&source.ID, &source.VehicleID, &source.StartedAt, &source.EndedAt,
			&source.DurationS, &source.DistanceM, &source.StartOdometerM, &source.EndOdometerM,
			&source.StartSocPct, &source.EndSocPct, &source.EnergyUsedWh, &source.RegenEnergyWh,
		)
	case AnomalyKindCharging:
		query := `SELECT id, vehicle_id, started_at, ended_at, start_odometer_m,
			end_odometer_m, start_soc_pct, end_soc_pct, delta_soc_pct, total_energy_added_wh,
			cost_decimal::text, cost_currency, cost_source, rate_id
			FROM charging_sessions WHERE id = $1`
		if lock {
			query += ` FOR UPDATE`
		}
		err = tx.QueryRow(ctx, query, id).Scan(
			&source.ID, &source.VehicleID, &source.StartedAt, &source.EndedAt,
			&source.StartOdometerM, &source.EndOdometerM, &source.StartSocPct,
			&source.EndSocPct, &source.DeltaSocPct, &source.TotalEnergyAddedWh,
			&source.CostDecimal, &source.CostCurrency, &source.CostSource, &source.RateID,
		)
	default:
		return nil, fmt.Errorf("unsupported correction source kind %q", kind)
	}
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("read correction source %s %d: %w", kind, id, err)
	}
	return source, nil
}

// HasBoundaryOverlap checks both session kinds before a manual end change.
func (r *CorrectionRepo) HasBoundaryOverlap(
	ctx context.Context,
	tx database.DBTX,
	source CorrectionSource,
	endedAt time.Time,
) (bool, error) {
	if tx == nil {
		if r == nil || r.db == nil || r.db.Pool == nil {
			return false, ErrNoDatabase
		}
		tx = r.db.Pool
	}
	ctx, cancel := context.WithTimeout(ctx, queryTimeout)
	defer cancel()
	ctx, span := tracing.DBSpan(ctx, "select", "data_repair_boundary_overlap")
	defer span.End()
	const query = `
		SELECT EXISTS (
			SELECT 1 FROM drives
			WHERE vehicle_id = $1 AND ($2 <> 'drive' OR id <> $3)
			  AND started_at < $5 AND (ended_at IS NULL OR ended_at > $4)
			UNION ALL
			SELECT 1 FROM charging_sessions
			WHERE vehicle_id = $1 AND ($2 <> 'charging' OR id <> $3)
			  AND started_at < $5 AND (ended_at IS NULL OR ended_at > $4)
		)`
	var overlap bool
	if err := tx.QueryRow(ctx, query, source.VehicleID, string(source.Kind), source.ID,
		source.StartedAt, endedAt).Scan(&overlap); err != nil {
		return false, fmt.Errorf("check correction boundary overlaps: %w", err)
	}
	return overlap, nil
}

func (source CorrectionSource) anomalies() []Anomaly {
	switch source.Kind {
	case AnomalyKindDrive:
		return classifyDriveRow(driveAnomalyRow{
			ID: source.ID, VehicleID: source.VehicleID, StartedAt: source.StartedAt,
			EndedAt: source.EndedAt, DurationS: source.DurationS, DistanceM: source.DistanceM,
			StartOdometerM: source.StartOdometerM, EndOdometerM: source.EndOdometerM,
			StartSocPct: source.StartSocPct, EndSocPct: source.EndSocPct,
			EnergyUsedWh: source.EnergyUsedWh, RegenEnergyWh: source.RegenEnergyWh,
		})
	case AnomalyKindCharging:
		return classifyChargingRow(chargingAnomalyRow{
			ID: source.ID, VehicleID: source.VehicleID, StartedAt: source.StartedAt,
			EndedAt: source.EndedAt, StartOdometerM: source.StartOdometerM,
			EndOdometerM: source.EndOdometerM, StartSocPct: source.StartSocPct,
			EndSocPct: source.EndSocPct, TotalEnergyAddedWh: source.TotalEnergyAddedWh,
		})
	default:
		return nil
	}
}

func (source CorrectionSource) hasAnomaly(rule string) bool {
	for _, anomaly := range source.anomalies() {
		if anomaly.Rule == rule {
			return true
		}
	}
	return false
}

func correctionFieldAllowed(kind AnomalyKind, rule, field string) bool {
	switch rule {
	case RuleDurationMismatch, RuleNegativeDurationS:
		return kind == AnomalyKindDrive && field == "duration_s"
	case RuleNegativeDistanceM:
		return kind == AnomalyKindDrive && field == "distance_m"
	case RuleNegativeEnergyUsedWh:
		return kind == AnomalyKindDrive && field == "energy_used_wh"
	case RuleNegativeRegenEnergyWh:
		return kind == AnomalyKindDrive && field == "regen_energy_wh"
	case RuleNegativeEnergyAddedWh:
		return kind == AnomalyKindCharging && field == "total_energy_added_wh"
	case RuleOdometerRollback:
		return field == "start_odometer_m" || field == "end_odometer_m"
	case RuleSocInconsistent:
		return field == "start_soc_pct" || field == "end_soc_pct"
	default:
		return false
	}
}

func (source *CorrectionSource) measurement(field string) **float64 {
	switch field {
	case "distance_m":
		return &source.DistanceM
	case "energy_used_wh":
		return &source.EnergyUsedWh
	case "regen_energy_wh":
		return &source.RegenEnergyWh
	case "total_energy_added_wh":
		return &source.TotalEnergyAddedWh
	case "start_odometer_m":
		return &source.StartOdometerM
	case "end_odometer_m":
		return &source.EndOdometerM
	case "start_soc_pct":
		return &source.StartSocPct
	case "end_soc_pct":
		return &source.EndSocPct
	default:
		return nil
	}
}

func sameCorrectionValue(left, right *float64) bool {
	if left == nil || right == nil {
		return left == nil && right == nil
	}
	return *left == *right
}

func correctionFieldValue(value *float64) interface{} {
	if value == nil {
		return nil
	}
	return *value
}

// PlanCorrection reuses the scanner's classifiers to ensure that the case
// still exists and that the reviewed change removes this specific anomaly.
// No value is inferred for an unknown measurement.
func PlanCorrection(source CorrectionSource, rule string, choice CorrectionChoice) (CorrectionPlan, error) {
	plan := CorrectionPlan{Changes: []CorrectionChange{}, Fields: make(map[string]interface{})}
	if !correctionFieldAllowed(source.Kind, rule, choice.Field) {
		return plan, errors.New("the selected field cannot correct this finding")
	}
	if source.EndedAt == nil || !source.EndedAt.After(source.StartedAt) {
		return plan, errors.New("correct the session boundaries before changing its measurements")
	}
	if !source.hasAnomaly(rule) {
		return plan, fmt.Errorf("%w: the finding no longer matches the current session", ErrCorrectionStale)
	}

	if choice.Field == "duration_s" {
		if choice.Mode != CorrectionDerive || choice.Value != nil || source.DurationS == nil {
			return plan, errors.New("duration can only be recalculated from the reviewed session boundaries")
		}
		const maxExactJSONInteger = int64(1<<53 - 1)
		if *source.DurationS < -maxExactJSONInteger || *source.DurationS > maxExactJSONInteger {
			return plan, errors.New("stored duration is too large to preview safely")
		}
		duration := int64(source.EndedAt.Sub(source.StartedAt).Round(time.Second).Seconds())
		before, after := float64(*source.DurationS), float64(duration)
		plan.Fields["duration_s"] = duration
		plan.Changes = append(plan.Changes, CorrectionChange{Field: "duration_s", Before: &before, After: &after})
		return plan, nil
	}

	field := source.measurement(choice.Field)
	if field == nil || *field == nil {
		return plan, errors.New("the selected measurement is no longer available")
	}
	before := *field
	var after *float64
	switch choice.Mode {
	case CorrectionClear:
		if choice.Value != nil {
			return plan, errors.New("marking a measurement unknown must not include a replacement value")
		}
		switch choice.Field {
		case "regen_energy_wh", "start_odometer_m", "end_odometer_m":
		default:
			return plan, errors.New("this measurement requires a verified replacement because existing views may display an unknown reading as a real value")
		}
	case CorrectionReplace:
		if choice.Value == nil || math.IsNaN(*choice.Value) || math.IsInf(*choice.Value, 0) || *choice.Value < 0 {
			return plan, errors.New("replacement must be a finite non-negative measurement")
		}
		value := *choice.Value
		if rule == RuleSocInconsistent {
			if value > 100 {
				return plan, errors.New("battery percentage must be between 0 and 100")
			}
			// Drive SoC columns are PostgreSQL REAL; preview their actual
			// stored precision rather than promising a different value.
			if source.Kind == AnomalyKindDrive {
				value = float64(float32(value))
			}
		}
		after = &value
	default:
		return plan, errors.New("select a replacement value or mark the measurement unknown")
	}
	if sameCorrectionValue(before, after) {
		return plan, errors.New("the replacement does not change the selected measurement")
	}
	*field = after
	if source.hasAnomaly(rule) {
		return plan, errors.New("the selected change does not resolve this finding")
	}
	plan.Fields[choice.Field] = correctionFieldValue(after)
	plan.Changes = append(plan.Changes, CorrectionChange{Field: choice.Field, Before: before, After: after})

	if source.Kind == AnomalyKindCharging && rule == RuleSocInconsistent {
		var delta *float64
		if source.StartSocPct != nil && source.EndSocPct != nil {
			value := *source.EndSocPct - *source.StartSocPct
			delta = &value
		}
		if !sameCorrectionValue(source.DeltaSocPct, delta) {
			plan.Fields["delta_soc_pct"] = correctionFieldValue(delta)
			plan.Changes = append(plan.Changes, CorrectionChange{
				Field: "delta_soc_pct", Before: source.DeltaSocPct, After: delta,
			})
		}
	}
	if source.Kind == AnomalyKindCharging && choice.Field == "total_energy_added_wh" &&
		source.CostDecimal != nil && source.CostSource != nil &&
		(*source.CostSource == systemmodel.CostSourceGeofenceTariff ||
			*source.CostSource == systemmodel.CostSourceDefaultEstimate) {
		unknown := systemmodel.CostSourceUnknown
		plan.Fields["cost_decimal"] = nil
		plan.Fields["cost_source"] = unknown
		plan.Changes = append(plan.Changes,
			CorrectionChange{Field: "cost_decimal", BeforeText: source.CostDecimal, Unit: source.CostCurrency},
			CorrectionChange{Field: "cost_source", BeforeText: source.CostSource, AfterText: &unknown},
		)
	}
	return plan, nil
}

// PlanBoundaryCorrection only accepts an operator-supplied end time; it never
// guesses which session or timestamp is correct.
func PlanBoundaryCorrection(
	source CorrectionSource,
	related *CorrectionSource,
	rule, target string,
	endedAt, latestAllowed time.Time,
) (CorrectionPlan, error) {
	plan := CorrectionPlan{Changes: []CorrectionChange{}}
	if source.EndedAt == nil {
		return plan, fmt.Errorf("%w: session is no longer closed", ErrCorrectionStale)
	}
	selected := source
	switch rule {
	case RuleEndedBeforeStarted:
		if related != nil || target != "primary" || !source.hasAnomaly(rule) {
			return plan, fmt.Errorf("%w: the finding no longer matches the current session", ErrCorrectionStale)
		}
	case RuleSameKindOverlapDrive, RuleSameKindOverlapCharging, RuleCrossKindOverlap:
		if related == nil || related.EndedAt == nil || source.VehicleID != related.VehicleID ||
			!source.EndedAt.After(source.StartedAt) || !related.EndedAt.After(related.StartedAt) {
			return plan, fmt.Errorf("%w: the related session is no longer comparable", ErrCorrectionStale)
		}
		sameKind := source.Kind == related.Kind
		if (rule == RuleSameKindOverlapDrive && (!sameKind || source.Kind != AnomalyKindDrive)) ||
			(rule == RuleSameKindOverlapCharging && (!sameKind || source.Kind != AnomalyKindCharging)) ||
			(rule == RuleCrossKindOverlap && (source.Kind != AnomalyKindDrive || related.Kind != AnomalyKindCharging)) {
			return plan, errors.New("the sessions do not match this finding")
		}
		lo := source.StartedAt
		if related.StartedAt.After(lo) {
			lo = related.StartedAt
		}
		hi := *source.EndedAt
		if related.EndedAt.Before(hi) {
			hi = *related.EndedAt
		}
		if hi.Sub(lo) <= time.Duration(overlapToleranceS)*time.Second ||
			(sameKind && source.StartedAt.Equal(related.StartedAt) && source.EndedAt.Equal(*related.EndedAt)) {
			return plan, fmt.Errorf("%w: the sessions no longer have this overlap", ErrCorrectionStale)
		}
		if target == "related" {
			selected = *related
			plan.Other = &CorrectionWindow{Kind: source.Kind, ID: source.ID, StartedAt: source.StartedAt, EndedAt: source.EndedAt}
		} else if target == "primary" {
			plan.Other = &CorrectionWindow{Kind: related.Kind, ID: related.ID, StartedAt: related.StartedAt, EndedAt: related.EndedAt}
		} else {
			return plan, errors.New("select which session has the incorrect end")
		}
		if !selected.StartedAt.Before(plan.Other.StartedAt) || endedAt.After(plan.Other.StartedAt) {
			return plan, errors.New("the earlier session must end no later than the other session starts")
		}
	default:
		return plan, errors.New("this finding cannot be corrected by changing an end time")
	}
	if !endedAt.After(selected.StartedAt) || endedAt.After(latestAllowed) {
		return plan, errors.New("the corrected end must be after the start and not in the future")
	}
	if selected.EndedAt.Equal(endedAt) {
		return plan, errors.New("the corrected end is unchanged")
	}
	before, after := selected.EndedAt.UTC().Format(time.RFC3339Nano), endedAt.UTC().Format(time.RFC3339Nano)
	duration := int64(endedAt.Sub(selected.StartedAt).Round(time.Second).Seconds())
	plan.Boundary = &CorrectionBoundary{
		CorrectionWindow: CorrectionWindow{Kind: selected.Kind, ID: selected.ID, StartedAt: selected.StartedAt, EndedAt: selected.EndedAt},
		ProposedEndedAt:  endedAt.UTC(), DurationS: duration,
	}
	plan.Changes = append(plan.Changes, CorrectionChange{Field: "ended_at", BeforeText: &before, AfterText: &after})
	if selected.Kind == AnomalyKindDrive {
		const maxExactJSONInteger = int64(1<<53 - 1)
		var beforeDuration *float64
		if selected.DurationS != nil {
			if *selected.DurationS < -maxExactJSONInteger || *selected.DurationS > maxExactJSONInteger {
				return plan, errors.New("stored duration is too large to preview safely")
			}
			value := float64(*selected.DurationS)
			beforeDuration = &value
		}
		afterDuration := float64(duration)
		plan.Changes = append(plan.Changes, CorrectionChange{Field: "duration_s", Before: beforeDuration, After: &afterDuration})
	}
	return plan, nil
}
