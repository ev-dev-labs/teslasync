package smartfeature

import (
	"slices"

	"github.com/ev-dev-labs/teslasync/internal/domain/personal"
)

type Key string

const (
	RecallWatch      Key = "recall_watch"
	OvernightDrain   Key = "overnight_drain"
	CapacityTrend    Key = "capacity_trend"
	ClimateSchedule  Key = "climate_schedule"
	CabinPrep        Key = "cabin_prep"
	ParkReserve      Key = "park_reserve"
	WindowRain       Key = "window_rain"
	ParkedClosure    Key = "parked_closure"
	ParkedUnlock     Key = "parked_unlock"
	TripMaintenance  Key = "trip_maintenance"
	WarrantyMileage  Key = "warranty_mileage"
	PublicFee        Key = "public_fee"
	BackupCharging   Key = "backup_charging"
	SolarCharging    Key = "solar_charging"
	FavoriteDigest   Key = "favorite_digest"
	ChargingCosts    Key = "charging_cost_digest"
	MonthlyTariff    Key = "monthly_tariff"
	MileageTerm      Key = "mileage_term"
	TripPacket       Key = "trip_packet"
	RenewalReview    Key = "subscription_renewal"
	DriveEfficiency  Key = "drive_efficiency"
	CommuteLearning  Key = "commute_learning"
	TrafficAdvice    Key = "traffic_advice"
	RouteEnergy      Key = "route_energy"
	Navigation       Key = "destination_dispatch"
	ChargingAdvice   Key = "charging_readiness"
	DepartureClash   Key = "departure_overlap"
	ChargingStop     Key = "early_stop"
	SiteRates        Key = "site_rates"
	SitePerformance  Key = "site_performance"
	TripStops        Key = "trip_stops"
	TripReview       Key = "trip_review"
	ColdTire         Key = "cold_tire_drift"
	ServiceCase      Key = "service_case"
	SoftwareWindow   Key = "software_window"
	SharedCharger    Key = "shared_charger"
	SharedTrip       Key = "shared_trip"
	DashcamRetention Key = "dashcam_retention"
	Playlist         Key = "playlist"
	Soundtrack       Key = "soundtrack"
	DriveTrack       Key = "drive_track"
	Episode          Key = "episode"
	InvoiceVariance  Key = "invoice_variance"
	AutomationNotice Key = "automation_notice"
	HERENotice       Key = "here_notice"
)

var keys = []Key{
	SolarCharging, BackupCharging, PublicFee, ParkReserve, OvernightDrain, CapacityTrend,
	CabinPrep, ClimateSchedule, WindowRain, ParkedClosure, ParkedUnlock,
	RecallWatch, TripMaintenance, WarrantyMileage,
	FavoriteDigest, ChargingCosts, MonthlyTariff, MileageTerm, TripPacket, RenewalReview, DriveEfficiency,
	CommuteLearning, TrafficAdvice, RouteEnergy, Navigation,
	ChargingAdvice, DepartureClash, ChargingStop, SiteRates, SitePerformance,
	TripStops, TripReview, ColdTire, ServiceCase, SoftwareWindow, SharedCharger, SharedTrip, DashcamRetention,
	Playlist, Soundtrack, DriveTrack, Episode, InvoiceVariance, AutomationNotice, HERENotice,
}

func Keys() []Key { return slices.Clone(keys) }

func (k Key) Valid() bool { return slices.Contains(keys, k) }

func (k Key) AvailableTo(subject string) bool {
	if !k.Valid() {
		return false
	}
	if subject != personal.OpenSubject {
		return true
	}
	switch k {
	case SolarCharging, PublicFee, CommuteLearning, TrafficAdvice, RouteEnergy, ChargingAdvice, DepartureClash,
		SiteRates, SitePerformance, ColdTire:
		return true
	default:
		return false
	}
}

func ChargingDecision(kind string) Key {
	switch kind {
	case "departure_overlap":
		return DepartureClash
	case "early_stop":
		return ChargingStop
	default:
		return ChargingAdvice
	}
}

type Preference struct {
	Feature Key  `json:"feature"`
	Allowed bool `json:"allowed"`
}
