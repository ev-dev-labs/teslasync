// Built-in read-only tools.
//
// Each tool wraps an existing repository method via a narrow domain
// interface (VehicleSource / DriveSource / ...). Tools never write SQL.
//
// The narrow interfaces serve two purposes:
//
//  1. Tests can substitute deterministic in-memory fakes without
//     spinning up Postgres + Timescale.
//  2. Production wiring can pass the real *database.* repos directly
//     because every method signature here matches an existing repo method.
//
// Every tool here is read-only (Mutates returns false); mutating tools
// belong with the features that use them.

package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"sync"
	"time"

	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"

	drivemodel "github.com/ev-dev-labs/teslasync/internal/models/drive"

	chargingmodel "github.com/ev-dev-labs/teslasync/internal/models/charging"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"

	notificationmodel "github.com/ev-dev-labs/teslasync/internal/models/notification"

	alertmodel "github.com/ev-dev-labs/teslasync/internal/models/alert"
)

// ---------------------------------------------------------------------------
// Narrow domain interfaces (one method each — implementable by the
// real *database.* repos without modification).
// ---------------------------------------------------------------------------

// VehicleSource is the read surface the vehicle-domain tools need.
// Implemented by *vehicledb.VehicleRepo (GetAll, GetByID).
type VehicleSource interface {
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
	GetByID(ctx context.Context, id int64) (*vehiclemodel.Vehicle, error)
}

// VehicleStateSource exposes the latest known state for a vehicle.
// In production this is satisfied by signal.StateReader; tests use a
// trivial map-backed fake.
type VehicleStateSource interface {
	// SignalAt returns the most recent value of (signal) at or before t.
	// Implementations MAY return nil, nil to signal "no data".
	SignalAt(ctx context.Context, vehicleID int64, signal string, at time.Time) (any, error)
}

// DriveSource is the read surface the drive-domain tools need.
// Implemented by *drivedb.DriveRepo.
type DriveSource interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*drivemodel.Drive, error)
	GetByID(ctx context.Context, id int64) (*drivemodel.Drive, error)
}

// ChargeSource is the read surface the charging-domain tools need.
// Implemented by *chargingdb.ChargingRepo.
type ChargeSource interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*chargingmodel.ChargingSession, error)
	GetByID(ctx context.Context, id int64) (*chargingmodel.ChargingSession, error)
}

// AlertRuleSource is the read surface the alert-rule tools need.
// Implemented by *dbalert.AlertRuleRepo.
type AlertRuleSource interface {
	GetAll(ctx context.Context) ([]*alertmodel.AlertRule, error)
}

// NotificationSource is the read surface the recent-alerts tool
// needs. Implemented by *dbnotif.NotificationRepo.GetLogs.
type NotificationSource interface {
	GetLogs(ctx context.Context, limit, offset int) ([]*notificationmodel.NotificationLog, error)
}

// GeofenceSource is the read surface the geofences tool needs.
// Implemented by *geofencedb.GeofenceRepo.
type GeofenceSource interface {
	GetAll(ctx context.Context) ([]*systemmodel.Geofence, error)
}

// EfficiencySource is the read surface the efficiency tool needs.
// Drive aggregates are derived from a window of drives via the same
// DriveSource the listing tool uses, so this is a thin wrapper
// rather than a new repo dependency.
type EfficiencySource interface {
	GetByVehicle(ctx context.Context, vehicleID int64, limit, offset int, startTime, endTime time.Time) ([]*drivemodel.Drive, error)
}

// Sources bundles every narrow source the built-in tools need. One
// struct keeps the registration call site clean ([Register12Builtins]).
type Sources struct {
	Vehicles      VehicleSource
	VehicleState  VehicleStateSource
	Drives        DriveSource
	Charges       ChargeSource
	AlertRules    AlertRuleSource
	Notifications NotificationSource
	Geofences     GeofenceSource
	Efficiency    EfficiencySource
}

// Register12Builtins installs the 12 starter read-only tools on r.
// Panics on duplicate registration (Registry.Register panics) so a
// second call is detected at boot. Pass the same Sources you intend
// production to use; tests may substitute fakes per-tool.
func Register12Builtins(r *Registry, s Sources) {
	r.Register(&queryVehicleCount{src: s.Vehicles})
	r.Register(&queryVehicleState{src: s.VehicleState, vsrc: s.Vehicles})
	r.Register(&queryVehicleLocation{src: s.VehicleState})
	r.Register(&queryDrivesRecent{src: s.Drives})
	r.Register(&queryDriveDetail{src: s.Drives})
	r.Register(&queryChargesRecent{src: s.Charges})
	r.Register(&queryChargeDetail{src: s.Charges})
	r.Register(&queryAlertsActive{src: s.AlertRules})
	r.Register(&queryAlertsRecent{src: s.Notifications})
	r.Register(&queryGeofencesList{src: s.Geofences})
	r.Register(&queryBatteryStatus{src: s.VehicleState})
	r.Register(&queryEfficiencyPeriod{src: s.Efficiency})
}

// BuiltinNames returns the canonical list of starter tool names. The
// registry's order is deterministic by name; this list is the
// expected (sorted) result and is consumed by the schema-fuzz pin
// test to enforce that every named tool is registered.
var BuiltinNames = []string{
	"query_alerts_active",
	"query_alerts_recent",
	"query_battery_status",
	"query_charge_detail",
	"query_charges_recent",
	"query_drive_detail",
	"query_drives_recent",
	"query_efficiency_period",
	"query_geofences_list",
	"query_vehicle_count",
	"query_vehicle_location",
	"query_vehicle_state",
}

// schemaCache memoises Generate(reflect.TypeOf(T{})) per tool input
// type. Schemas never change at runtime so reflection runs once.
// sync.Map for safe concurrent first-access by multiple tool calls.
var schemaCache sync.Map // map[reflect.Type]json.RawMessage

func CachedSchema(v any) json.RawMessage {
	t := reflect.TypeOf(v)
	if cached, ok := schemaCache.Load(t); ok {
		return cached.(json.RawMessage)
	}
	s := Generate(t)
	actual, _ := schemaCache.LoadOrStore(t, s)
	return actual.(json.RawMessage)
}

// ---------------------------------------------------------------------------
// query_vehicle_count — no input.
// ---------------------------------------------------------------------------

type emptyInput struct{}

type queryVehicleCount struct{ src VehicleSource }

func (t *queryVehicleCount) Name() string { return "query_vehicle_count" }
func (t *queryVehicleCount) Description() string {
	return "Discover the fleet: return the vehicle count plus safe summaries containing each numeric vehicle ID, display name, model, and active status. Call this before vehicle-specific tools when the conversation has not established a valid vehicle_id."
}
func (t *queryVehicleCount) InputSchema() json.RawMessage  { return CachedSchema(emptyInput{}) }
func (t *queryVehicleCount) OutputSchema() json.RawMessage { return nil }
func (t *queryVehicleCount) Mutates() bool                 { return false }
func (t *queryVehicleCount) RequiredScope() string         { return "" }
func (t *queryVehicleCount) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[emptyInput](raw)
}
func (t *queryVehicleCount) Execute(ctx context.Context, in any) (any, error) {
	if t.src == nil {
		return nil, fmt.Errorf("query_vehicle_count: no VehicleSource wired")
	}
	vs, err := t.src.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	type vehicleSummary struct {
		ID          int64   `json:"id"`
		DisplayName string  `json:"display_name"`
		Model       *string `json:"model,omitempty"`
		Active      bool    `json:"active"`
	}
	summaries := make([]vehicleSummary, 0, len(vs))
	for _, vehicle := range vs {
		if vehicle == nil {
			continue
		}
		summaries = append(summaries, vehicleSummary{
			ID:          vehicle.ID,
			DisplayName: vehicle.DisplayName,
			Model:       vehicle.Model,
			Active:      vehicle.IsActive(),
		})
	}
	return map[string]any{
		"count":    len(summaries),
		"vehicles": summaries,
	}, nil
}

// ---------------------------------------------------------------------------
// query_vehicle_state — vehicle metadata + last-known driving state.
// ---------------------------------------------------------------------------

type vehicleIDInput struct {
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID from the vehicles array returned by query_vehicle_count."`
}

type queryVehicleState struct {
	src  VehicleStateSource
	vsrc VehicleSource
}

func (t *queryVehicleState) Name() string { return "query_vehicle_state" }
func (t *queryVehicleState) Description() string {
	return "Return the vehicle's metadata + most recent driving state (drive/park/charge)."
}
func (t *queryVehicleState) InputSchema() json.RawMessage  { return CachedSchema(vehicleIDInput{}) }
func (t *queryVehicleState) OutputSchema() json.RawMessage { return nil }
func (t *queryVehicleState) Mutates() bool                 { return false }
func (t *queryVehicleState) RequiredScope() string         { return "" }
func (t *queryVehicleState) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[vehicleIDInput](raw)
}
func (t *queryVehicleState) Execute(ctx context.Context, in any) (any, error) {
	input := in.(vehicleIDInput)
	if t.vsrc == nil {
		return nil, fmt.Errorf("query_vehicle_state: no VehicleSource wired")
	}
	v, err := t.vsrc.GetByID(ctx, input.VehicleID)
	if err != nil {
		return nil, err
	}
	if v == nil {
		return nil, fmt.Errorf("vehicle %d not found", input.VehicleID)
	}
	out := map[string]any{
		"id":           v.ID,
		"display_name": v.DisplayName,
		"vin":          v.VIN,
		"timezone":     v.Timezone,
	}
	if t.src != nil {
		now := time.Now().UTC()
		if val, _ := t.src.SignalAt(ctx, input.VehicleID, "VehicleState", now); val != nil {
			out["state"] = val
		}
	}
	return out, nil
}

// ---------------------------------------------------------------------------
// query_vehicle_location — last-known lat/lon/heading.
// ---------------------------------------------------------------------------

type queryVehicleLocation struct{ src VehicleStateSource }

func (t *queryVehicleLocation) Name() string { return "query_vehicle_location" }
func (t *queryVehicleLocation) Description() string {
	return "Return the vehicle's most recent latitude / longitude / heading."
}
func (t *queryVehicleLocation) InputSchema() json.RawMessage  { return CachedSchema(vehicleIDInput{}) }
func (t *queryVehicleLocation) OutputSchema() json.RawMessage { return nil }
func (t *queryVehicleLocation) Mutates() bool                 { return false }
func (t *queryVehicleLocation) RequiredScope() string         { return "" }
func (t *queryVehicleLocation) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[vehicleIDInput](raw)
}
func (t *queryVehicleLocation) Execute(ctx context.Context, in any) (any, error) {
	input := in.(vehicleIDInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_vehicle_location: no VehicleStateSource wired")
	}
	now := time.Now().UTC()
	lat, _ := t.src.SignalAt(ctx, input.VehicleID, "LocationLatitude", now)
	lon, _ := t.src.SignalAt(ctx, input.VehicleID, "LocationLongitude", now)
	heading, _ := t.src.SignalAt(ctx, input.VehicleID, "GpsHeading", now)
	return map[string]any{
		"vehicle_id": input.VehicleID,
		"latitude":   lat,
		"longitude":  lon,
		"heading":    heading,
	}, nil
}

// ---------------------------------------------------------------------------
// query_drives_recent — paginated drives for a vehicle.
// ---------------------------------------------------------------------------

type drivesRecentInput struct {
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
	Limit     int   `json:"limit"      validate:"required,gte=1,lte=100" desc:"Number of rows to return (1..100)."`
}

type queryDrivesRecent struct{ src DriveSource }

func (t *queryDrivesRecent) Name() string { return "query_drives_recent" }
func (t *queryDrivesRecent) Description() string {
	return "Return the most-recent drives for a vehicle, newest first."
}
func (t *queryDrivesRecent) InputSchema() json.RawMessage  { return CachedSchema(drivesRecentInput{}) }
func (t *queryDrivesRecent) OutputSchema() json.RawMessage { return nil }
func (t *queryDrivesRecent) Mutates() bool                 { return false }
func (t *queryDrivesRecent) RequiredScope() string         { return "" }
func (t *queryDrivesRecent) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[drivesRecentInput](raw)
}
func (t *queryDrivesRecent) Execute(ctx context.Context, in any) (any, error) {
	input := in.(drivesRecentInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_drives_recent: no DriveSource wired")
	}
	limit := input.Limit
	if limit == 0 {
		limit = 10
	}
	drives, err := t.src.GetByVehicle(ctx, input.VehicleID, limit, 0, time.Time{}, time.Time{})
	if err != nil {
		return nil, err
	}
	return map[string]any{"drives": drives, "count": len(drives)}, nil
}

// ---------------------------------------------------------------------------
// query_drive_detail — one drive by id.
// ---------------------------------------------------------------------------

type driveIDInput struct {
	DriveID int64 `json:"drive_id" validate:"required,gte=1" desc:"Numeric drive ID."`
}

type queryDriveDetail struct{ src DriveSource }

func (t *queryDriveDetail) Name() string { return "query_drive_detail" }
func (t *queryDriveDetail) Description() string {
	return "Return one drive by its ID, including SI distance/duration/energy fields."
}
func (t *queryDriveDetail) InputSchema() json.RawMessage  { return CachedSchema(driveIDInput{}) }
func (t *queryDriveDetail) OutputSchema() json.RawMessage { return nil }
func (t *queryDriveDetail) Mutates() bool                 { return false }
func (t *queryDriveDetail) RequiredScope() string         { return "" }
func (t *queryDriveDetail) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[driveIDInput](raw)
}
func (t *queryDriveDetail) Execute(ctx context.Context, in any) (any, error) {
	input := in.(driveIDInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_drive_detail: no DriveSource wired")
	}
	d, err := t.src.GetByID(ctx, input.DriveID)
	if err != nil {
		return nil, err
	}
	if d == nil {
		return nil, fmt.Errorf("drive %d not found", input.DriveID)
	}
	return d, nil
}

// ---------------------------------------------------------------------------
// query_charges_recent / query_charge_detail.
// ---------------------------------------------------------------------------

type chargesRecentInput struct {
	VehicleID int64 `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
	Limit     int   `json:"limit"      validate:"required,gte=1,lte=100" desc:"Number of rows to return (1..100)."`
}

type queryChargesRecent struct{ src ChargeSource }

func (t *queryChargesRecent) Name() string { return "query_charges_recent" }
func (t *queryChargesRecent) Description() string {
	return "Return the most-recent charging sessions for a vehicle, newest first."
}
func (t *queryChargesRecent) InputSchema() json.RawMessage  { return CachedSchema(chargesRecentInput{}) }
func (t *queryChargesRecent) OutputSchema() json.RawMessage { return nil }
func (t *queryChargesRecent) Mutates() bool                 { return false }
func (t *queryChargesRecent) RequiredScope() string         { return "" }
func (t *queryChargesRecent) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[chargesRecentInput](raw)
}
func (t *queryChargesRecent) Execute(ctx context.Context, in any) (any, error) {
	input := in.(chargesRecentInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_charges_recent: no ChargeSource wired")
	}
	limit := input.Limit
	if limit == 0 {
		limit = 10
	}
	cs, err := t.src.GetByVehicle(ctx, input.VehicleID, limit, 0, time.Time{}, time.Time{})
	if err != nil {
		return nil, err
	}
	return map[string]any{"charges": cs, "count": len(cs)}, nil
}

type chargeIDInput struct {
	ChargeID int64 `json:"charge_id" validate:"required,gte=1" desc:"Numeric charging session ID."`
}

type queryChargeDetail struct{ src ChargeSource }

func (t *queryChargeDetail) Name() string { return "query_charge_detail" }
func (t *queryChargeDetail) Description() string {
	return "Return one charging session by its ID, including SI energy/power fields."
}
func (t *queryChargeDetail) InputSchema() json.RawMessage  { return CachedSchema(chargeIDInput{}) }
func (t *queryChargeDetail) OutputSchema() json.RawMessage { return nil }
func (t *queryChargeDetail) Mutates() bool                 { return false }
func (t *queryChargeDetail) RequiredScope() string         { return "" }
func (t *queryChargeDetail) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[chargeIDInput](raw)
}
func (t *queryChargeDetail) Execute(ctx context.Context, in any) (any, error) {
	input := in.(chargeIDInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_charge_detail: no ChargeSource wired")
	}
	c, err := t.src.GetByID(ctx, input.ChargeID)
	if err != nil {
		return nil, err
	}
	if c == nil {
		return nil, fmt.Errorf("charging session %d not found", input.ChargeID)
	}
	return c, nil
}

// ---------------------------------------------------------------------------
// query_alerts_active / query_alerts_recent.
// ---------------------------------------------------------------------------

type queryAlertsActive struct{ src AlertRuleSource }

func (t *queryAlertsActive) Name() string { return "query_alerts_active" }
func (t *queryAlertsActive) Description() string {
	return "Return every alert rule whose 'enabled' flag is true."
}
func (t *queryAlertsActive) InputSchema() json.RawMessage  { return CachedSchema(emptyInput{}) }
func (t *queryAlertsActive) OutputSchema() json.RawMessage { return nil }
func (t *queryAlertsActive) Mutates() bool                 { return false }
func (t *queryAlertsActive) RequiredScope() string         { return "" }
func (t *queryAlertsActive) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[emptyInput](raw)
}
func (t *queryAlertsActive) Execute(ctx context.Context, in any) (any, error) {
	if t.src == nil {
		return nil, fmt.Errorf("query_alerts_active: no AlertRuleSource wired")
	}
	rules, err := t.src.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	active := make([]*alertmodel.AlertRule, 0, len(rules))
	for _, r := range rules {
		if r.Enabled {
			active = append(active, r)
		}
	}
	return map[string]any{"rules": active, "count": len(active)}, nil
}

type alertsRecentInput struct {
	Limit int `json:"limit" validate:"required,gte=1,lte=100" desc:"Number of rows to return (1..100)."`
}

type queryAlertsRecent struct{ src NotificationSource }

func (t *queryAlertsRecent) Name() string { return "query_alerts_recent" }
func (t *queryAlertsRecent) Description() string {
	return "Return the most-recent fired alerts (notification log entries), newest first."
}
func (t *queryAlertsRecent) InputSchema() json.RawMessage  { return CachedSchema(alertsRecentInput{}) }
func (t *queryAlertsRecent) OutputSchema() json.RawMessage { return nil }
func (t *queryAlertsRecent) Mutates() bool                 { return false }
func (t *queryAlertsRecent) RequiredScope() string         { return "" }
func (t *queryAlertsRecent) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[alertsRecentInput](raw)
}
func (t *queryAlertsRecent) Execute(ctx context.Context, in any) (any, error) {
	input := in.(alertsRecentInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_alerts_recent: no NotificationSource wired")
	}
	limit := input.Limit
	if limit == 0 {
		limit = 10
	}
	logs, err := t.src.GetLogs(ctx, limit, 0)
	if err != nil {
		return nil, err
	}
	return map[string]any{"alerts": logs, "count": len(logs)}, nil
}

// ---------------------------------------------------------------------------
// query_geofences_list.
// ---------------------------------------------------------------------------

type queryGeofencesList struct{ src GeofenceSource }

func (t *queryGeofencesList) Name() string                  { return "query_geofences_list" }
func (t *queryGeofencesList) Description() string           { return "Return every configured geofence." }
func (t *queryGeofencesList) InputSchema() json.RawMessage  { return CachedSchema(emptyInput{}) }
func (t *queryGeofencesList) OutputSchema() json.RawMessage { return nil }
func (t *queryGeofencesList) Mutates() bool                 { return false }
func (t *queryGeofencesList) RequiredScope() string         { return "" }
func (t *queryGeofencesList) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[emptyInput](raw)
}
func (t *queryGeofencesList) Execute(ctx context.Context, in any) (any, error) {
	if t.src == nil {
		return nil, fmt.Errorf("query_geofences_list: no GeofenceSource wired")
	}
	gs, err := t.src.GetAll(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"geofences": gs, "count": len(gs)}, nil
}

// ---------------------------------------------------------------------------
// query_battery_status — last-known SoC + range + charge state.
// ---------------------------------------------------------------------------

type queryBatteryStatus struct{ src VehicleStateSource }

func (t *queryBatteryStatus) Name() string { return "query_battery_status" }
func (t *queryBatteryStatus) Description() string {
	return "Return the vehicle's most recent state of charge, range, and charging status."
}
func (t *queryBatteryStatus) InputSchema() json.RawMessage  { return CachedSchema(vehicleIDInput{}) }
func (t *queryBatteryStatus) OutputSchema() json.RawMessage { return nil }
func (t *queryBatteryStatus) Mutates() bool                 { return false }
func (t *queryBatteryStatus) RequiredScope() string         { return "" }
func (t *queryBatteryStatus) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[vehicleIDInput](raw)
}
func (t *queryBatteryStatus) Execute(ctx context.Context, in any) (any, error) {
	input := in.(vehicleIDInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_battery_status: no VehicleStateSource wired")
	}
	now := time.Now().UTC()
	soc, _ := t.src.SignalAt(ctx, input.VehicleID, "Soc", now)
	rangeM, _ := t.src.SignalAt(ctx, input.VehicleID, "RatedRange", now)
	chargeState, _ := t.src.SignalAt(ctx, input.VehicleID, "ChargeState", now)
	return map[string]any{
		"vehicle_id":   input.VehicleID,
		"soc_pct":      soc,
		"range_m":      rangeM,
		"charge_state": chargeState,
	}, nil
}

// ---------------------------------------------------------------------------
// query_efficiency_period — Wh/km derived over a window of drives.
// ---------------------------------------------------------------------------

type efficiencyPeriodInput struct {
	VehicleID int64  `json:"vehicle_id" validate:"required,gte=1" desc:"Numeric vehicle ID."`
	Period    string `json:"period"     validate:"required,oneof=day week month year" desc:"Window length: day | week | month | year."`
}

type queryEfficiencyPeriod struct{ src EfficiencySource }

func (t *queryEfficiencyPeriod) Name() string { return "query_efficiency_period" }
func (t *queryEfficiencyPeriod) Description() string {
	return "Return the vehicle's average Wh/km efficiency over the requested period (day|week|month|year)."
}
func (t *queryEfficiencyPeriod) InputSchema() json.RawMessage {
	return CachedSchema(efficiencyPeriodInput{})
}
func (t *queryEfficiencyPeriod) OutputSchema() json.RawMessage { return nil }
func (t *queryEfficiencyPeriod) Mutates() bool                 { return false }
func (t *queryEfficiencyPeriod) RequiredScope() string         { return "" }
func (t *queryEfficiencyPeriod) Validate(raw json.RawMessage) (any, error) {
	return ValidateStruct[efficiencyPeriodInput](raw)
}
func (t *queryEfficiencyPeriod) Execute(ctx context.Context, in any) (any, error) {
	input := in.(efficiencyPeriodInput)
	if t.src == nil {
		return nil, fmt.Errorf("query_efficiency_period: no EfficiencySource wired")
	}
	since := periodCutoff(input.Period, time.Now().UTC())
	drives, err := t.src.GetByVehicle(ctx, input.VehicleID, 1000, 0, since, time.Time{})
	if err != nil {
		return nil, err
	}
	var totalDistM, totalEnergyWh float64
	for _, d := range drives {
		if d.EnergyUsedWh == nil {
			continue
		}
		totalDistM += d.DistanceM
		totalEnergyWh += *d.EnergyUsedWh
	}
	out := map[string]any{
		"vehicle_id":      input.VehicleID,
		"period":          input.Period,
		"drive_count":     len(drives),
		"total_dist_m":    totalDistM,
		"total_energy_wh": totalEnergyWh,
	}
	if totalDistM > 0 {
		out["wh_per_km"] = totalEnergyWh / (totalDistM / 1000.0)
	}
	return out, nil
}

func periodCutoff(period string, now time.Time) time.Time {
	switch period {
	case "day":
		return now.Add(-24 * time.Hour)
	case "week":
		return now.Add(-7 * 24 * time.Hour)
	case "month":
		return now.AddDate(0, -1, 0)
	case "year":
		return now.AddDate(-1, 0, 0)
	}
	return time.Time{}
}
