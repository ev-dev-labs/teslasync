package datarepair

import (
	"net/http"
	"strings"
	"time"

	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"
	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type previewStatus string

const (
	previewStatusReady          previewStatus = "ready"
	previewStatusAlreadyApplied previewStatus = "already_applied"
)

type previewValue struct {
	Type      string     `json:"type"`
	Null      bool       `json:"null,omitempty"`
	Timestamp *time.Time `json:"timestamp,omitempty"`
	Int64     *int64     `json:"int64,omitempty"`
	Float64   *float64   `json:"float64,omitempty"`
	String    *string    `json:"string,omitempty"`
}

type previewFieldChange struct {
	Field  string       `json:"field"`
	Before previewValue `json:"before"`
	After  previewValue `json:"after"`
}

type previewFieldPreserved struct {
	Field  string       `json:"field"`
	Value  previewValue `json:"value"`
	Reason string       `json:"reason"`
}

type closePreviewResponse struct {
	Kind              systemmodel.SessionRepairKind `json:"kind"`
	SessionID         int64                         `json:"session_id"`
	Rule              string                        `json:"rule"`
	Source            string                        `json:"source"`
	Status            previewStatus                 `json:"status"`
	StartedAt         time.Time                     `json:"started_at"`
	CurrentEndedAt    *time.Time                    `json:"current_ended_at"`
	ProposedEndedAt   time.Time                     `json:"proposed_ended_at"`
	CurrentDurationS  *int64                        `json:"current_duration_s"`
	ProposedDurationS int64                         `json:"proposed_duration_s"`
	FieldsChanged     []previewFieldChange          `json:"fields_changed"`
	FieldsPreserved   []previewFieldPreserved       `json:"fields_preserved"`
	Warnings          []string                      `json:"warnings"`
}

func nullValue() previewValue {
	return previewValue{Type: "null", Null: true}
}

func timestampValue(t time.Time) previewValue {
	v := t.UTC()
	return previewValue{Type: "timestamp", Timestamp: &v}
}

func nullableTimestampValue(t *time.Time) previewValue {
	if t == nil {
		return nullValue()
	}
	return timestampValue(*t)
}

func int64Value(v int64) previewValue {
	return previewValue{Type: "int64", Int64: &v}
}

func nullableInt64Value(v *int64) previewValue {
	if v == nil {
		return nullValue()
	}
	return int64Value(*v)
}

func nullableInt16Value(v *int16) previewValue {
	if v == nil {
		return nullValue()
	}
	i := int64(*v)
	return int64Value(i)
}

func float64Value(v float64) previewValue {
	return previewValue{Type: "float64", Float64: &v}
}

func nullableFloat64Value(v *float64) previewValue {
	if v == nil {
		return nullValue()
	}
	return float64Value(*v)
}

func nullableStringValue(v *string) previewValue {
	if v == nil {
		return nullValue()
	}
	return previewValue{Type: "string", String: v}
}

func preservedField(field string, value previewValue) previewFieldPreserved {
	return previewFieldPreserved{
		Field:  field,
		Value:  value,
		Reason: "server-read measured value is preserved; preview only changes the reviewed boundary",
	}
}

func previewWarnings(status previewStatus, kind systemmodel.SessionRepairKind) []string {
	if status == previewStatusAlreadyApplied {
		return []string{"requested boundary is already applied; no mutation or audit row would be written"}
	}
	switch kind {
	case systemmodel.SessionRepairKindDrive:
		return []string{"drive preview does not recompute measured distance, energy, speed, power, or SOC fields"}
	case systemmodel.SessionRepairKindCharging:
		return []string{"charging preview does not recompute measured energy, power, cost, or SOC fields"}
	default:
		return []string{}
	}
}

func driveCurrentDurationS(drive *drivemodel.Drive) *int64 {
	if drive == nil || drive.EndTs == nil {
		return nil
	}
	v := drive.DurationS
	return &v
}

func chargingCurrentDurationS(session *chargingmodel.ChargingSession) *int64 {
	if session == nil || session.EndedAt == nil {
		return nil
	}
	v := wholeSeconds(session.EndedAt.Sub(session.StartedAt))
	return &v
}

func previewSource(rule string) string {
	rule = strings.TrimSpace(rule)
	if rule == "" {
		return ""
	}
	return auditSource(rule)
}

func drivePreservedFields(drive *drivemodel.Drive) []previewFieldPreserved {
	return []previewFieldPreserved{
		preservedField("distance_m", float64Value(drive.DistanceM)),
		preservedField("energy_used_wh", nullableFloat64Value(drive.EnergyUsedWh)),
		preservedField("regen_energy_wh", nullableFloat64Value(drive.RegenEnergyWh)),
		preservedField("avg_speed_mps", nullableFloat64Value(drive.AvgSpeedMps)),
		preservedField("max_speed_mps", nullableFloat64Value(drive.MaxSpeedMps)),
		preservedField("avg_power_w", nullableFloat64Value(drive.AvgPowerW)),
		preservedField("start_battery_pct", nullableInt16Value(drive.StartBatteryPct)),
		preservedField("end_battery_pct", nullableInt16Value(drive.EndBatteryPct)),
	}
}

func chargingPreservedFields(session *chargingmodel.ChargingSession) []previewFieldPreserved {
	return []previewFieldPreserved{
		preservedField("total_energy_added_wh", nullableFloat64Value(session.TotalEnergyAddedWh)),
		preservedField("peak_power_w", nullableFloat64Value(session.PeakPowerW)),
		preservedField("avg_power_w", nullableFloat64Value(session.AvgPowerW)),
		preservedField("cost_decimal", nullableFloat64Value(session.CostDecimal)),
		preservedField("cost_currency", nullableStringValue(session.CostCurrency)),
		preservedField("cost_source", nullableStringValue(session.CostSource)),
		preservedField("rate_id", nullableInt64Value(session.RateID)),
		preservedField("geofence_id", nullableInt64Value(session.GeofenceID)),
		preservedField("start_soc_pct", nullableFloat64Value(session.StartSocPct)),
		preservedField("end_soc_pct", nullableFloat64Value(session.EndSocPct)),
		preservedField("delta_soc_pct", nullableFloat64Value(session.DeltaSocPct)),
	}
}

func fieldsChanged(
	status previewStatus,
	currentEndedAt *time.Time,
	proposedEndedAt time.Time,
	currentDurationS *int64,
	proposedDurationS int64,
	includeDuration bool,
) []previewFieldChange {
	if status == previewStatusAlreadyApplied {
		return []previewFieldChange{}
	}
	changed := []previewFieldChange{
		{
			Field:  "ended_at",
			Before: nullableTimestampValue(currentEndedAt),
			After:  timestampValue(proposedEndedAt),
		},
	}
	if includeDuration {
		changed = append(changed, previewFieldChange{
			Field:  "duration_s",
			Before: nullableInt64Value(currentDurationS),
			After:  int64Value(proposedDurationS),
		})
	}
	return changed
}

// PreviewCharging validates a reviewed charging-session boundary and returns
// the exact impact CloseCharging would have, without mutating or auditing.
func (h *DataRepairHandler) PreviewCharging(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "preview_charging")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid charging session ID")
		return
	}

	req, err := decodeCloseRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()
	session, err := h.chargingRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get charging session")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get charging session")
		return
	}
	if session == nil {
		httpx.WriteError(w, http.StatusNotFound, "charging session not found")
		return
	}

	endedAt, closeStatus, _, done := h.resolveCloseBoundary(
		w, r, req,
		systemmodel.SessionRepairKindCharging,
		id, session.VehicleID,
		session.StartedAt, session.EndedAt,
		"charging session",
	)
	if done {
		return
	}

	status := previewStatusReady
	if closeStatus == closeStatusAlreadyApplied {
		status = previewStatusAlreadyApplied
	}
	currentDurationS := chargingCurrentDurationS(session)
	proposedDurationS := wholeSeconds(endedAt.Sub(session.StartedAt))
	rule := strings.TrimSpace(*req.Rule)

	httpx.WriteJSON(w, http.StatusOK, closePreviewResponse{
		Kind:              systemmodel.SessionRepairKindCharging,
		SessionID:         id,
		Rule:              rule,
		Source:            previewSource(rule),
		Status:            status,
		StartedAt:         session.StartedAt.UTC(),
		CurrentEndedAt:    utcPtr(session.EndedAt),
		ProposedEndedAt:   endedAt,
		CurrentDurationS:  currentDurationS,
		ProposedDurationS: proposedDurationS,
		FieldsChanged: fieldsChanged(
			status, session.EndedAt, endedAt, currentDurationS, proposedDurationS, false,
		),
		FieldsPreserved: chargingPreservedFields(session),
		Warnings:        previewWarnings(status, systemmodel.SessionRepairKindCharging),
	})
}

// PreviewDrive validates a reviewed drive boundary and returns the exact impact
// CloseDrive would have, without mutating or auditing.
func (h *DataRepairHandler) PreviewDrive(w http.ResponseWriter, r *http.Request) {
	r, span := startHandlerSpan(r, "preview_drive")
	defer span.End()

	id, err := apiparams.URLParamInt64(r, "id")
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid drive ID")
		return
	}

	req, err := decodeCloseRequest(r)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, err.Error())
		return
	}

	ctx := r.Context()
	drive, err := h.driveRepo.GetByID(ctx, id)
	if err != nil {
		recordHandlerError(ctx, err)
		log.Error().Err(err).
			Str("trace_id", activeTraceID(ctx)).
			Int64("id", id).
			Msg("failed to get drive")
		httpx.WriteError(w, http.StatusInternalServerError, "failed to get drive")
		return
	}
	if drive == nil {
		httpx.WriteError(w, http.StatusNotFound, "drive not found")
		return
	}

	endedAt, closeStatus, _, done := h.resolveCloseBoundary(
		w, r, req,
		systemmodel.SessionRepairKindDrive,
		id, drive.VehicleID,
		drive.StartTs, drive.EndTs,
		"drive",
	)
	if done {
		return
	}

	status := previewStatusReady
	if closeStatus == closeStatusAlreadyApplied {
		status = previewStatusAlreadyApplied
	}
	currentDurationS := driveCurrentDurationS(drive)
	proposedDurationS := wholeSeconds(endedAt.Sub(drive.StartTs))
	rule := strings.TrimSpace(*req.Rule)

	httpx.WriteJSON(w, http.StatusOK, closePreviewResponse{
		Kind:              systemmodel.SessionRepairKindDrive,
		SessionID:         id,
		Rule:              rule,
		Source:            previewSource(rule),
		Status:            status,
		StartedAt:         drive.StartTs.UTC(),
		CurrentEndedAt:    utcPtr(drive.EndTs),
		ProposedEndedAt:   endedAt,
		CurrentDurationS:  currentDurationS,
		ProposedDurationS: proposedDurationS,
		FieldsChanged: fieldsChanged(
			status, drive.EndTs, endedAt, currentDurationS, proposedDurationS, true,
		),
		FieldsPreserved: drivePreservedFields(drive),
		Warnings:        previewWarnings(status, systemmodel.SessionRepairKindDrive),
	})
}
