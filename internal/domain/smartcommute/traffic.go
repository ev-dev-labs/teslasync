package smartcommute

import (
	"crypto/sha256"
	"encoding/hex"
	"strconv"
	"time"
)

const MaxTrafficTracePoints = 200

type TrafficPreview struct {
	DriveID     int64   `json:"drive_id"`
	Trace       []Point `json:"trace"`
	Fingerprint string  `json:"fingerprint"`
}

type TrafficConsentInput struct {
	VehicleID          int64
	RoutineID          int64
	DriveID            int64
	Fingerprint        string
	ShareWithHERE      bool
	LeadS              int
	MinSavingsS        int64
	ArrivalDeadlineS   *int
	CompareRouteEnergy bool
}

type TrafficConsent struct {
	Trace              []Point
	LeadS              int
	MinSavingsS        int64
	ArrivalDeadlineS   *int
	CompareRouteEnergy bool
	CheckAt            time.Time
	DepartureAt        time.Time
}

type TrafficConsentSummary struct {
	LeadS              int   `json:"lead_s"`
	MinSavingsS        int64 `json:"min_savings_s"`
	CanSkip            bool  `json:"can_skip_today"`
	ArrivalDeadlineS   *int  `json:"arrival_deadline_s,omitempty"`
	CompareRouteEnergy bool  `json:"compare_route_energy"`
}

type TrafficQuery struct {
	// Trace is the user-approved representative route, not automatically selected drive history.
	Trace                  []Point
	DepartureAt            time.Time
	RequireOfferedCoverage bool
	IncludeRouteGeometry   bool
}

type TrafficEstimate struct {
	DurationS     int64
	FlowUpdatedAt time.Time
	RouteLabel    string
}

type TrafficComparison struct {
	Usual                 TrafficEstimate
	Alternative           TrafficEstimate
	AlternativesQualified bool
	OfferedRoutes         []TrafficRoute
}

// TrafficRoute geometry is ephemeral input to locally match completed routes.
type TrafficRoute struct {
	TrafficEstimate
	Geometry []Point
}

type TrafficDecision struct {
	OccurrenceID          string                 `json:"occurrence_id"`
	RoutineID             int64                  `json:"routine_id"`
	VehicleID             int64                  `json:"vehicle_id"`
	RoutineName           string                 `json:"routine_name"`
	VehicleName           string                 `json:"vehicle_name"`
	TimeZone              string                 `json:"time_zone"`
	DepartureAt           time.Time              `json:"departure_at"`
	UsualS                int64                  `json:"usual_s"`
	AlternativeS          int64                  `json:"alternative_s"`
	UsualRouteLabel       string                 `json:"usual_route_label,omitempty"`
	AlternativeRouteLabel string                 `json:"alternative_route_label,omitempty"`
	ObservedAt            time.Time              `json:"observed_at"`
	ExpiresAt             time.Time              `json:"expires_at"`
	ArrivalDeadlineAt     *time.Time             `json:"arrival_deadline_at,omitempty"`
	LatestDepartureAt     *time.Time             `json:"latest_departure_at,omitempty"`
	RouteEnergy           *TrafficEnergyEvidence `json:"route_energy,omitempty"`
	RouteEnergyOnly       bool                   `json:"route_energy_only,omitempty"`
	NavigationOutcome     NavigationOutcome      `json:"navigation_outcome,omitempty"`
	NavigationPaused      bool                   `json:"navigation_paused,omitempty"`
	Origin                Point                  `json:"-"`
}

type TrafficEnergyEvidence struct {
	Fastest   TrafficRouteEnergy `json:"fastest"`
	Saving    TrafficRouteEnergy `json:"saving"`
	OutsideC  float64            `json:"outside_c"`
	ExpiresAt time.Time          `json:"expires_at"`
}

type TrafficRouteEnergy struct {
	ETAS       int64   `json:"eta_s"`
	DriveCount int     `json:"drive_count"`
	LowWh      float64 `json:"low_wh"`
	MedianWh   float64 `json:"median_wh"`
	HighWh     float64 `json:"high_wh"`
}

func TrafficOccurrenceID(routineID int64, departureAt time.Time) string {
	key := strconv.FormatInt(routineID, 10) + ":" + strconv.FormatInt(departureAt.Unix(), 10)
	digest := sha256.Sum256([]byte(key))
	return hex.EncodeToString(digest[:16])
}

func TrafficComparisonPath(vehicleID int64, occurrenceID string) string {
	return "/settings/smart-commute?vehicle_id=" + strconv.FormatInt(vehicleID, 10) +
		"&traffic_occurrence_id=" + occurrenceID
}
