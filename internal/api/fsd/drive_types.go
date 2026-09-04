package fsd

import "time"

// AttributionConfidence describes what the cumulative counters can support
// for one drive. It deliberately avoids implying exact FSD engagement.
type AttributionConfidence string

const (
	ConfidenceHigh      AttributionConfidence = "high"
	ConfidenceEstimated AttributionConfidence = "estimated"
	ConfidenceAmbiguous AttributionConfidence = "ambiguous"
	ConfidenceUnknown   AttributionConfidence = "unknown"
)

// DriveRecord is the bounded database input used by the pure attribution
// pipeline.
type DriveRecord struct {
	ID              int64
	StartedAt       time.Time
	EndedAt         *time.Time
	StartPlace      *string
	EndPlace        *string
	StartGeofenceID *int64
	EndGeofenceID   *int64
	DistanceM       *float64
	EnergyUsedWh    *float64
}

// VersionSample is one trusted firmware observation.
type VersionSample struct {
	TS                   time.Time
	Version              string
	NormalizationVersion *int16
}

// AnalyticsInput contains all rows needed to derive current and previous
// period drive intelligence without per-drive database calls.
type AnalyticsInput struct {
	// PreviousCounterSamples contains only the preceding comparison window
	// and its raw pre-window baselines. CounterSamples contains the current
	// window and one latest raw baseline per counter.
	PreviousCounterSamples []Sample
	CounterSamples         []Sample
	VersionSamples         []VersionSample
	Drives                 []DriveRecord
}

// EvidenceInterval identifies the time span in which a cumulative FSD counter
// increase occurred. It is approximate evidence, not an engagement segment.
type EvidenceInterval struct {
	StartAt      time.Time             `json:"start_at"`
	EndAt        time.Time             `json:"end_at"`
	FSDDistanceM float64               `json:"fsd_distance_m"`
	Confidence   AttributionConfidence `json:"confidence"`
	Approximate  bool                  `json:"approximate"`
}

// DriveFSDInsight is the per-drive contract shared by the list, detail, route,
// and dashboard views.
type DriveFSDInsight struct {
	DriveID           int64                 `json:"drive_id"`
	StartedAt         time.Time             `json:"started_at"`
	EndedAt           *time.Time            `json:"ended_at"`
	StartPlace        *string               `json:"start_place"`
	EndPlace          *string               `json:"end_place"`
	DistanceM         *float64              `json:"distance_m"`
	EnergyUsedWh      *float64              `json:"energy_used_wh"`
	FSDDistanceM      *float64              `json:"fsd_distance_m"`
	FSDSharePct       *float64              `json:"fsd_share_pct"`
	Confidence        AttributionConfidence `json:"confidence"`
	ResetAffected     bool                  `json:"reset_affected"`
	FirmwareVersion   *string               `json:"firmware_version"`
	Evidence          []EvidenceInterval    `json:"evidence"`
	EvidenceTruncated bool                  `json:"evidence_truncated"`
}

// PeriodComparison compares the requested period with the immediately
// preceding period of the same length.
type PeriodComparison struct {
	PreviousPeriod           Period   `json:"previous_period"`
	PreviousFSDDistanceM     *float64 `json:"previous_fsd_distance_m"`
	PreviousDrivingDistanceM *float64 `json:"previous_driving_distance_m"`
	PreviousFSDSharePct      *float64 `json:"previous_fsd_share_pct"`
	FSDDistanceChangeM       *float64 `json:"fsd_distance_change_m"`
	FSDDistanceChangePct     *float64 `json:"fsd_distance_change_pct"`
	FSDShareChangePctPoints  *float64 `json:"fsd_share_change_pct_points"`
}

// AttributionBreakdown reconciles observed FSD counter distance while keeping
// drive distance with insufficient evidence separate.
type AttributionBreakdown struct {
	AttributedDistanceM   *float64 `json:"attributed_distance_m"`
	EstimatedDistanceM    *float64 `json:"estimated_distance_m"`
	AmbiguousDistanceM    *float64 `json:"ambiguous_distance_m"`
	UnattributedDistanceM *float64 `json:"unattributed_distance_m"`
	UnknownDriveDistanceM float64  `json:"unknown_drive_distance_m"`
}

// CounterResetEvent surfaces resets instead of silently treating them as
// travelled distance.
type CounterResetEvent struct {
	Field            string    `json:"field"`
	At               time.Time `json:"at"`
	PreviousValueM   float64   `json:"previous_value_m"`
	CurrentValueM    float64   `json:"current_value_m"`
	AffectedDriveIDs []int64   `json:"affected_drive_ids"`
	FirmwareVersion  *string   `json:"firmware_version"`
}

// CommuteMonthShare is one calendar month of a commute identity.
type CommuteMonthShare struct {
	Month           string                 `json:"month"`
	DriveCount      int                    `json:"drive_count"`
	FSDDistanceM    *float64               `json:"fsd_distance_m"`
	DrivingDistanceM float64               `json:"driving_distance_m"`
	FSDSharePct     *float64               `json:"fsd_share_pct"`
	Confidence      AttributionConfidence  `json:"confidence"`
	UnknownDays     int                    `json:"unknown_days"`
}

// CommuteIdentity compares the same route and time-of-day window this month
// versus last. It is a trip-meter correlation, not proof FSD improved.
type CommuteIdentity struct {
	RouteKey             string            `json:"route_key"`
	RouteLabel           string            `json:"route_label"`
	WindowKey            string            `json:"window_key"`
	WindowLabel          string            `json:"window_label"`
	ThisMonth            CommuteMonthShare `json:"this_month"`
	LastMonth            CommuteMonthShare `json:"last_month"`
	ShareChangePctPoints *float64          `json:"share_change_pct_points"`
	Honesty              string            `json:"honesty"`
}

// GroupedFSDInsight is used for repeated routes, time-of-day, and firmware
// comparisons. Only high-confidence drives contribute.
type GroupedFSDInsight struct {
	Key              string   `json:"key"`
	Label            string   `json:"label"`
	DriveCount       int      `json:"drive_count"`
	DrivingDistanceM float64  `json:"driving_distance_m"`
	FSDDistanceM     float64  `json:"fsd_distance_m"`
	FSDSharePct      *float64 `json:"fsd_share_pct"`
}

// RouteEfficiencyComparison contrasts high- and low-FSD drives on the same
// route. It is descriptive correlation only.
type RouteEfficiencyComparison struct {
	RouteKey                  string  `json:"route_key"`
	RouteLabel                string  `json:"route_label"`
	FSDHeavyDriveCount        int     `json:"fsd_heavy_drive_count"`
	LowFSDDriveCount          int     `json:"low_fsd_drive_count"`
	FSDHeavyEfficiencyWhPerKM float64 `json:"fsd_heavy_efficiency_wh_per_km"`
	LowFSDEfficiencyWhPerKM   float64 `json:"low_fsd_efficiency_wh_per_km"`
	DifferencePct             float64 `json:"difference_pct"`
}

// FirmwareRouteSpotlight compares FSD share on one repeated route before and
// after the latest observed firmware pair. It is descriptive correlation only.
type FirmwareRouteSpotlight struct {
	RouteKey               string   `json:"route_key"`
	RouteLabel             string   `json:"route_label"`
	BeforeDriveCount       int      `json:"before_drive_count"`
	AfterDriveCount        int      `json:"after_drive_count"`
	BeforeFSDDistanceM     float64  `json:"before_fsd_distance_m"`
	AfterFSDDistanceM      float64  `json:"after_fsd_distance_m"`
	BeforeDrivingDistanceM float64  `json:"before_driving_distance_m"`
	AfterDrivingDistanceM  float64  `json:"after_driving_distance_m"`
	BeforeFSDSharePct      *float64 `json:"before_fsd_share_pct"`
	AfterFSDSharePct       *float64 `json:"after_fsd_share_pct"`
	ShareChangePctPoints   *float64 `json:"share_change_pct_points"`
}

// FirmwareSpotlight is the latest firmware pair in the period, plus any
// high-confidence routes observed on both versions.
type FirmwareSpotlight struct {
	FromVersion string                   `json:"from_version"`
	ToVersion   string                   `json:"to_version"`
	ChangedAt   *time.Time               `json:"changed_at"`
	Routes      []FirmwareRouteSpotlight `json:"routes"`
}

// ObservatoryKind is one journal row in the FSD observatory.
type ObservatoryKind string

const (
	ObservatoryKindDrive ObservatoryKind = "drive"
	ObservatoryKindReset ObservatoryKind = "reset"
)

// ObservatoryEvent is one stitched journal entry. Drive rows may have a null
// FSD distance (unknown). Reset rows never contribute travelled distance.
type ObservatoryEvent struct {
	Kind             ObservatoryKind        `json:"kind"`
	At               time.Time              `json:"at"`
	EndAt            *time.Time             `json:"end_at"`
	DriveID          *int64                 `json:"drive_id"`
	RouteKey         *string                `json:"route_key"`
	RouteLabel       *string                `json:"route_label"`
	FirmwareVersion  *string                `json:"firmware_version"`
	FSDDistanceM     *float64               `json:"fsd_distance_m"`
	DrivingDistanceM *float64               `json:"driving_distance_m"`
	Confidence       *AttributionConfidence `json:"confidence"`
	ResetBreak       bool                   `json:"reset_break"`
	Approximate      bool                   `json:"approximate"`
	Field            *string                `json:"field"`
}

// ObservatoryTotals rolls up the journal without turning absence into zero.
type ObservatoryTotals struct {
	StitchedFSDDistanceM  *float64 `json:"stitched_fsd_distance_m"`
	HighFSDDistanceM      *float64 `json:"high_fsd_distance_m"`
	EstimatedFSDDistanceM *float64 `json:"estimated_fsd_distance_m"`
	AmbiguousFSDDistanceM *float64 `json:"ambiguous_fsd_distance_m"`
	UnknownDriveDistanceM float64  `json:"unknown_drive_distance_m"`
	ResetBreakCount       int      `json:"reset_break_count"`
	DriveCount            int      `json:"drive_count"`
	MeasuredDriveCount    int      `json:"measured_drive_count"`
	UnknownDriveCount     int      `json:"unknown_drive_count"`
}

// ObservatoryCommuteChapter is one firmware era of a repeated commute.
type ObservatoryCommuteChapter struct {
	FirmwareVersion  *string   `json:"firmware_version"`
	FirstAt          time.Time `json:"first_at"`
	LastAt           time.Time `json:"last_at"`
	DriveCount       int       `json:"drive_count"`
	HighCount        int       `json:"high_count"`
	EstimatedCount   int       `json:"estimated_count"`
	AmbiguousCount   int       `json:"ambiguous_count"`
	UnknownCount     int       `json:"unknown_count"`
	ResetBreaks      int       `json:"reset_breaks"`
	FSDDistanceM     *float64  `json:"fsd_distance_m"`
	DrivingDistanceM float64   `json:"driving_distance_m"`
	FSDSharePct      *float64  `json:"fsd_share_pct"`
}

// ObservatoryCommuteStory is one repeated route told across firmware chapters.
type ObservatoryCommuteStory struct {
	RouteKey   string                      `json:"route_key"`
	RouteLabel string                      `json:"route_label"`
	DriveCount int                         `json:"drive_count"`
	Chapters   []ObservatoryCommuteChapter `json:"chapters"`
}

// Observatory is a reset-safe journal of reported FSD kilometres. It never
// claims exact engagement segments.
type Observatory struct {
	Honesty        string                    `json:"honesty"`
	Truncated      bool                      `json:"truncated"`
	Totals         ObservatoryTotals         `json:"totals"`
	Timeline       []ObservatoryEvent        `json:"timeline"`
	CommuteStories []ObservatoryCommuteStory `json:"commute_stories"`
}

// DriveAnalytics contains the enhanced dashboard and per-drive intelligence.
type DriveAnalytics struct {
	Comparison            PeriodComparison            `json:"comparison"`
	Attribution           AttributionBreakdown        `json:"attribution"`
	ContributingDrives    []DriveFSDInsight           `json:"contributing_drives"`
	ResetEvents           []CounterResetEvent         `json:"reset_events"`
	RepeatedRoutes        []GroupedFSDInsight         `json:"repeated_routes"`
	TimeOfDay             []GroupedFSDInsight         `json:"time_of_day"`
	Firmware              []GroupedFSDInsight         `json:"firmware"`
	FirmwareSpotlight     FirmwareSpotlight           `json:"firmware_spotlight"`
	RouteEfficiency       []RouteEfficiencyComparison `json:"route_efficiency"`
	Observatory           Observatory                 `json:"observatory"`
	CommuteIdentities     []CommuteIdentity           `json:"commute_identities"`
	CorrelationDisclaimer string                      `json:"correlation_disclaimer"`
}
