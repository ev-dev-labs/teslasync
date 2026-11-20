package smartreadinesssvc

import (
	"math"
	"testing"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestEvaluateChargingFeasibilityUsesFreshOptimisticPower(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan := Plan{
		Enabled: true, NotifyAt: now, DepartureAt: now.Add(2 * time.Hour),
		TripUseLowPct: 35, TripUseHighPct: 45, ReservePct: 20,
	}
	values := map[string]*signal.Value{
		"BatteryLevel":             {Raw: 40.0, Timestamp: now.Add(-time.Minute)},
		"DetailedChargeState":      {Raw: "Charging", Timestamp: now.Add(-time.Minute)},
		"Gear":                     {Raw: "P", Timestamp: now.Add(-time.Minute)},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now.Add(-time.Minute)},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now.Add(-time.Minute)},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now.Add(-time.Minute)},
		"ACChargingPower":          {Raw: 1000.0, Timestamp: now.Add(-time.Minute)},
	}
	atSite := func(lat, lon float64) bool { return lat == 47.1 && lon == -122.1 }
	decision := Evaluate(plan, values, now, atSite)
	if decision.Reason != ReasonEligible || decision.Kind != domain.DecisionSlowCharging ||
		decision.ChargingPowerW != 1000 || decision.BatteryPct != 40 ||
		decision.ArrivalLowPct != 0 || decision.ArrivalHighPct != 7.5 ||
		!decision.ObservedAt.Equal(now.Add(-time.Minute)) ||
		!decision.ExpiresAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("unexpected feasibility decision: %+v", decision)
	}

	tests := []struct {
		name   string
		change func(*Plan, map[string]*signal.Value, *time.Time)
		want   Reason
	}{
		{"sufficient projected charge", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ACChargingPower"].Raw = 20000.0
		}, ReasonEnoughCharge},
		{"higher fresh dc power avoids pessimistic warning", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["DCChargingPower"] = &signal.Value{Raw: 20000.0, Timestamp: now}
		}, ReasonEnoughCharge},
		{"stopped not charging", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["DetailedChargeState"].Raw = "Stopped"
		}, ReasonPlugged},
		{"starting is not settled charging", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["DetailedChargeState"].Raw = "Starting"
		}, ReasonPlugged},
		{"moving", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["Gear"].Raw = "D" }, ReasonNotParked},
		{"outside chosen site", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["LocationLatitude"].Raw = 48.0 }, ReasonOutsideSite},
		{"missing capacity", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			delete(v, "NominalFullPackEnergyKwh")
		}, ReasonUnknownState},
		{"stale capacity", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["NominalFullPackEnergyKwh"].Timestamp = now.Add(-3 * time.Minute)
		}, ReasonUnknownState},
		{"zero power", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ACChargingPower"].Raw = 0.0
		}, ReasonUnknownState},
		{"stale power", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ACChargingPower"].Timestamp = now.Add(-3 * time.Minute)
		}, ReasonUnknownState},
		{"synthetic power", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ACChargingPower"].TimestampSynthetic = true
		}, ReasonUnknownState},
		{"future power", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ACChargingPower"].Timestamp = now.Add(time.Second)
		}, ReasonUnknownState},
		{"impossible target", func(p *Plan, _ map[string]*signal.Value, _ *time.Time) {
			p.TripUseLowPct, p.TripUseHighPct, p.ReservePct = 85, 90, 20
		}, ReasonUnachievable},
		{"too late to remedy", func(p *Plan, _ map[string]*signal.Value, n *time.Time) {
			*n = p.DepartureAt.Add(-minimumRemedyTime)
		}, ReasonExpired},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			copyPlan := plan
			copyValues := make(map[string]*signal.Value, len(values))
			for key, value := range values {
				copyValue := *value
				copyValues[key] = &copyValue
			}
			copyNow := now
			test.change(&copyPlan, copyValues, &copyNow)
			if got := Evaluate(copyPlan, copyValues, copyNow, atSite).Reason; got != test.want {
				t.Fatalf("reason = %s, want %s", got, test.want)
			}
		})
	}
}

func TestEvaluateDepartureWindow(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	departure := now.Add(2 * time.Hour)
	for _, tt := range []struct {
		name        string
		windowKind  domain.OverlapKind
		startOffset time.Duration
		endOffset   time.Duration
		gear        signal.Value
		want        domain.OverlapKind
	}{
		{"service includes start", domain.OverlapService, 0, time.Hour, signal.Value{Raw: "P", Timestamp: now}, domain.OverlapService},
		{"software window", domain.OverlapSoftware, -time.Hour, time.Hour, signal.Value{Raw: "P", Timestamp: now}, domain.OverlapSoftware},
		{"appointment ends at departure", domain.OverlapService, -time.Hour, 0, signal.Value{Raw: "P", Timestamp: now}, ""},
		{"moving", domain.OverlapService, 0, time.Hour, signal.Value{Raw: "D", Timestamp: now}, ""},
		{"park observation is stale", domain.OverlapService, 0, time.Hour, signal.Value{Raw: "P", Timestamp: now.Add(-3 * time.Minute)}, ""},
		{"no confirmed window", "", 0, time.Hour, signal.Value{Raw: "P", Timestamp: now}, ""},
	} {
		t.Run(tt.name, func(t *testing.T) {
			plan := Plan{Enabled: true, NotifyAt: now, DepartureAt: departure, ReservePct: 20}
			window := &domain.DepartureWindow{StartsAt: departure.Add(tt.startOffset), EndsAt: departure.Add(tt.endOffset)}
			switch tt.windowKind {
			case domain.OverlapService:
				plan.ServiceAppointment = window
			case domain.OverlapSoftware:
				plan.SoftwareInstall = window
			}
			decision := Evaluate(plan, map[string]*signal.Value{"Gear": &tt.gear}, now, nil)
			if tt.want == "" {
				if decision.Kind == domain.DecisionDepartureOverlap {
					t.Fatalf("unexpected departure conflict: %+v", decision)
				}
				return
			}
			if decision.Reason != ReasonEligible || decision.Kind != domain.DecisionDepartureOverlap ||
				decision.DepartureOverlap == nil || decision.DepartureOverlap.Kind != tt.want ||
				!decision.DepartureOverlap.EndsAt.Equal(window.EndsAt) ||
				!decision.ExpiresAt.Equal(now.Add(signal.LiveSignalFreshnessThreshold)) {
				t.Fatalf("unexpected departure conflict: %+v", decision)
			}
		})
	}
}

func TestEvaluateDatedScheduleConflict(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	tests := []struct {
		name   string
		change func(*Plan, map[string]*signal.Value)
		want   Reason
	}{
		{"parked and pending with a matching wall clock on a different UTC date", nil, ReasonEligible},
		{"another possible date is not corroboration", func(p *Plan, _ map[string]*signal.Value) {
			p.ScheduledStart.At = p.ScheduledStart.At.Add(24 * time.Hour)
		}, ReasonPlugged},
		{"entered start before departure", func(p *Plan, _ map[string]*signal.Value) {
			p.DepartureAt = p.ScheduledStart.At.Add(time.Minute)
		}, ReasonPlugged},
		{"no dated intent", func(p *Plan, _ map[string]*signal.Value) { p.ScheduledStart = nil }, ReasonPlugged},
		{"charger not locked", func(_ *Plan, v map[string]*signal.Value) { v["ChargePortLatch"].Raw = "Disengaged" }, ReasonPlugged},
		{"pending cleared", func(_ *Plan, v map[string]*signal.Value) { v["ScheduledChargingPending"].Raw = false }, ReasonPlugged},
		{"stale pending", func(_ *Plan, v map[string]*signal.Value) {
			v["ScheduledChargingPending"].Timestamp = now.Add(-3 * time.Minute)
		}, ReasonPlugged},
		{"changed wall clock", func(_ *Plan, v map[string]*signal.Value) {
			v["ScheduledChargingStartTime"].Raw = time.Date(2026, 4, 6, 19, 30, 0, 0, time.UTC)
		}, ReasonPlugged},
		{"synthetic latch", func(_ *Plan, v map[string]*signal.Value) {
			v["ChargePortLatch"].TimestampSynthetic = true
		}, ReasonPlugged},
		{"contradictory charging power", func(_ *Plan, v map[string]*signal.Value) {
			v["ACChargingPower"] = &signal.Value{Raw: 1200.0, Timestamp: now}
		}, ReasonPlugged},
		{"enough charge", func(_ *Plan, v map[string]*signal.Value) { v["BatteryLevel"].Raw = 75.0 }, ReasonEnoughCharge},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			plan := Plan{
				Enabled: true, NotifyAt: now, DepartureAt: now.Add(5 * time.Hour),
				ScheduledStart: &domain.ScheduledStart{At: now.Add(7 * time.Hour), TimeZone: "America/Los_Angeles"},
				TripUseLowPct:  35, TripUseHighPct: 45, ReservePct: 20,
			}
			values := map[string]*signal.Value{
				"BatteryLevel":               {Raw: 40.0, Timestamp: now},
				"DetailedChargeState":        {Raw: "NoPower", Timestamp: now},
				"Gear":                       {Raw: "P", Timestamp: now},
				"LocationLatitude":           {Raw: 47.1, Timestamp: now},
				"LocationLongitude":          {Raw: -122.1, Timestamp: now},
				"ScheduledChargingPending":   {Raw: true, Timestamp: now.Add(-time.Minute)},
				"ScheduledChargingStartTime": {Raw: now, Timestamp: now},
				"ChargePortLatch":            {Raw: "Engaged", Timestamp: now},
			}
			if test.change != nil {
				test.change(&plan, values)
			}
			got := Evaluate(plan, values, now, func(_, _ float64) bool { return true })
			if got.Reason != test.want {
				t.Fatalf("decision = %+v, want %s", got, test.want)
			}
			if test.want == ReasonEligible && (got.Kind != domain.DecisionScheduleConflict ||
				!got.ExpiresAt.Equal(now.Add(time.Minute)) || got.ArrivalHighPct != 5) {
				t.Fatalf("schedule conflict evidence = %+v", got)
			}
		})
	}
}

func TestEvaluateScheduleBeforeDepartureUsesKnownSiteLimit(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	tests := []struct {
		name        string
		limitW      float64
		capacityAge time.Duration
		want        Reason
	}{
		{"even best-case power misses reserve", 3200, 45 * time.Second, ReasonEligible},
		{"no known power limit", 0, 0, ReasonPlugged},
		{"maximum power could meet reserve", 24000, 0, ReasonEnoughCharge},
		{"stale pack energy", 3200, 3 * time.Minute, ReasonPlugged},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			plan := Plan{
				Enabled: true, NotifyAt: now, DepartureAt: now.Add(5 * time.Hour),
				ScheduledStart: &domain.ScheduledStart{At: now.Add(4 * time.Hour), TimeZone: "UTC"},
				TripUseLowPct:  35, TripUseHighPct: 45, ReservePct: 20,
			}
			if tt.limitW > 0 {
				plan.ScheduledStart.PowerCeilingW = &tt.limitW
			}
			values := map[string]*signal.Value{
				"BatteryLevel":               {Raw: 40.0, Timestamp: now},
				"DetailedChargeState":        {Raw: "NoPower", Timestamp: now},
				"Gear":                       {Raw: "P", Timestamp: now},
				"LocationLatitude":           {Raw: 47.1, Timestamp: now},
				"LocationLongitude":          {Raw: -122.1, Timestamp: now},
				"ScheduledChargingPending":   {Raw: true, Timestamp: now},
				"ScheduledChargingStartTime": {Raw: plan.ScheduledStart.At.AddDate(0, 0, -1), Timestamp: now},
				"ChargePortLatch":            {Raw: "Engaged", Timestamp: now},
				"NominalFullPackEnergyKwh":   {Raw: 80000.0, Timestamp: now.Add(-tt.capacityAge)},
			}
			got := Evaluate(plan, values, now, func(_, _ float64) bool { return true })
			if got.Reason != tt.want {
				t.Fatalf("decision = %+v, want %s", got, tt.want)
			}
			if tt.want == ReasonEligible && (got.Kind != domain.DecisionScheduleConflict || got.ArrivalHighPct != 9 ||
				!got.ExpiresAt.Equal(now.Add(signal.LiveSignalFreshnessThreshold-tt.capacityAge))) {
				t.Fatalf("schedule conflict evidence = %+v", got)
			}
		})
	}
}
func TestEvaluateChargingFeasibilityCurrentLimitEvidence(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan := Plan{
		Enabled: true, NotifyAt: now, DepartureAt: now.Add(2 * time.Hour),
		TripUseLowPct: 35, TripUseHighPct: 45, ReservePct: 20,
	}
	values := map[string]*signal.Value{
		"BatteryLevel":             {Raw: 40.0, Timestamp: now},
		"DetailedChargeState":      {Raw: "Charging", Timestamp: now},
		"Gear":                     {Raw: "P", Timestamp: now},
		"LocationLatitude":         {Raw: 47.1, Timestamp: now},
		"LocationLongitude":        {Raw: -122.1, Timestamp: now},
		"NominalFullPackEnergyKwh": {Raw: 80000.0, Timestamp: now},
		"ACChargingPower":          {Raw: 1000.0, Timestamp: now},
		"ChargeCurrentRequest":     {Raw: 12.0, Timestamp: now.Add(-90 * time.Second)},
		"ChargeCurrentRequestMax":  {Raw: 32.0, Timestamp: now.Add(-75 * time.Second)},
	}
	atSite := func(lat, lon float64) bool { return lat == 47.1 && lon == -122.1 }
	decision := Evaluate(plan, values, now, atSite)
	if decision.Reason != ReasonEligible || decision.CurrentLimit == nil ||
		decision.CurrentLimit.RequestedA != 12 || decision.CurrentLimit.MaximumA != 32 ||
		!decision.ObservedAt.Equal(now.Add(-90*time.Second)) ||
		!decision.ExpiresAt.Equal(now.Add(30*time.Second)) {
		t.Fatalf("fresh current evidence = %+v", decision)
	}

	tests := []struct {
		name   string
		change func(map[string]*signal.Value)
	}{
		{"missing request", func(v map[string]*signal.Value) { delete(v, "ChargeCurrentRequest") }},
		{"stale request", func(v map[string]*signal.Value) { v["ChargeCurrentRequest"].Timestamp = now.Add(-3 * time.Minute) }},
		{"future maximum", func(v map[string]*signal.Value) { v["ChargeCurrentRequestMax"].Timestamp = now.Add(time.Second) }},
		{"synthetic maximum", func(v map[string]*signal.Value) { v["ChargeCurrentRequestMax"].TimestampSynthetic = true }},
		{"unpaired observations", func(v map[string]*signal.Value) { v["ChargeCurrentRequestMax"].Timestamp = now }},
		{"equal request", func(v map[string]*signal.Value) { v["ChargeCurrentRequest"].Raw = 32.0 }},
		{"request exceeds maximum", func(v map[string]*signal.Value) { v["ChargeCurrentRequest"].Raw = 48.0 }},
		{"zero request", func(v map[string]*signal.Value) { v["ChargeCurrentRequest"].Raw = 0.0 }},
		{"nonfinite maximum", func(v map[string]*signal.Value) { v["ChargeCurrentRequestMax"].Raw = math.NaN() }},
		{"invalid request", func(v map[string]*signal.Value) { v["ChargeCurrentRequest"].Raw = "invalid" }},
		{"simultaneous dc power", func(v map[string]*signal.Value) {
			v["DCChargingPower"] = &signal.Value{Raw: 500.0, Timestamp: now}
		}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			copyValues := make(map[string]*signal.Value, len(values))
			for key, value := range values {
				copyValue := *value
				copyValues[key] = &copyValue
			}
			test.change(copyValues)
			got := Evaluate(plan, copyValues, now, atSite)
			if got.Reason != ReasonEligible || got.Kind != domain.DecisionSlowCharging || got.CurrentLimit != nil {
				t.Fatalf("unusable current evidence changed or enriched the charging decision: %+v", got)
			}
		})
	}
}

func TestEvaluatePlugInRecommendation(t *testing.T) {
	now := time.Date(2026, 4, 6, 19, 0, 0, 0, time.UTC)
	plan := Plan{
		Enabled: true, NotifyAt: now, DepartureAt: now.Add(12 * time.Hour),
		TripUseLowPct: 35, TripUseHighPct: 45, ReservePct: 20,
	}
	values := map[string]*signal.Value{
		"BatteryLevel":        {Raw: 45.0, Timestamp: now.Add(-time.Minute)},
		"DetailedChargeState": {Raw: "Disconnected", Timestamp: now.Add(-time.Minute)},
		"Gear":                {Raw: "P", Timestamp: now.Add(-time.Minute)},
		"LocationLatitude":    {Raw: 47.1, Timestamp: now.Add(-time.Minute)},
		"LocationLongitude":   {Raw: -122.1, Timestamp: now.Add(-time.Minute)},
	}
	atSite := func(lat, lon float64) bool { return lat == 47.1 && lon == -122.1 }
	decision := Evaluate(plan, values, now, atSite)
	if decision.Reason != ReasonEligible || decision.BatteryPct != 45 ||
		decision.ArrivalLowPct != 0 || decision.ArrivalHighPct != 10 ||
		!decision.ObservedAt.Equal(now.Add(-time.Minute)) ||
		!decision.ExpiresAt.Equal(now.Add(time.Minute)) {
		t.Fatalf("unexpected recommendation: %+v", decision)
	}

	tests := []struct {
		name   string
		change func(*Plan, map[string]*signal.Value, *time.Time)
		want   Reason
	}{
		{"disabled", func(p *Plan, _ map[string]*signal.Value, _ *time.Time) { p.Enabled = false }, ReasonDisabled},
		{"not due", func(p *Plan, _ map[string]*signal.Value, _ *time.Time) { p.NotifyAt = now.Add(time.Minute) }, ReasonNotDue},
		{"too late to remedy", func(p *Plan, _ map[string]*signal.Value, n *time.Time) { *n = p.DepartureAt.Add(-minimumRemedyTime) }, ReasonExpired},
		{"invalid range", func(p *Plan, _ map[string]*signal.Value, _ *time.Time) { p.TripUseLowPct = 50 }, ReasonInvalidPlan},
		{"nonfinite range", func(p *Plan, _ map[string]*signal.Value, _ *time.Time) { p.ReservePct = math.NaN() }, ReasonInvalidPlan},
		{"sufficient charge", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["BatteryLevel"].Raw = 75.0 }, ReasonEnoughCharge},
		{"below material shortfall", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["BatteryLevel"].Raw = 50.0 }, ReasonEnoughCharge},
		{"plugging in cannot meet even the lower trip target", func(p *Plan, _ map[string]*signal.Value, _ *time.Time) {
			p.TripUseLowPct, p.TripUseHighPct = 85, 95
		}, ReasonUnachievable},
		{"connected but stopped", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["DetailedChargeState"].Raw = "Stopped" }, ReasonPlugged},
		{"fresh engaged latch conflicts with disconnected state", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ChargePortLatch"] = &signal.Value{Raw: "Engaged", Timestamp: now}
		}, ReasonPlugged},
		{"stale engaged latch cannot override fresh disconnected state", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["ChargePortLatch"] = &signal.Value{Raw: "Engaged", Timestamp: now.Add(-3 * time.Minute)}
		}, ReasonEligible},
		{"unknown charge state", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["DetailedChargeState"].Raw = "Unknown" }, ReasonUnknownState},
		{"moving", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["Gear"].Raw = "D" }, ReasonNotParked},
		{"outside charging place", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["LocationLatitude"].Raw = 48.0 }, ReasonOutsideSite},
		{"missing battery", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { delete(v, "BatteryLevel") }, ReasonUnknownState},
		{"stale plug state", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["DetailedChargeState"].Timestamp = now.Add(-3 * time.Minute)
		}, ReasonUnknownState},
		{"synthetic timestamp", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["Gear"].TimestampSynthetic = true }, ReasonUnknownState},
		{"future timestamp", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) {
			v["BatteryLevel"].Timestamp = now.Add(time.Second)
		}, ReasonUnknownState},
		{"mismatched location times", func(_ *Plan, v map[string]*signal.Value, _ *time.Time) { v["LocationLatitude"].Timestamp = now }, ReasonUnknownState},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			copyPlan := plan
			copyValues := make(map[string]*signal.Value, len(values))
			for key, value := range values {
				copyValue := *value
				copyValues[key] = &copyValue
			}
			copyNow := now
			test.change(&copyPlan, copyValues, &copyNow)
			if got := Evaluate(copyPlan, copyValues, copyNow, atSite).Reason; got != test.want {
				t.Fatalf("reason = %s, want %s", got, test.want)
			}
		})
	}
}
