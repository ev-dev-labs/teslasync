package batterydegradation

import (
	"context"
	"encoding/json"
	"errors"
	"math"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestChargingHabitsSessionEnergyWireIsWh(t *testing.T) {
	for _, energyWh := range []float64{0, 38000, 38125.5, 0.125} {
		t.Run(strconv.FormatFloat(energyWh, 'g', -1, 64), func(t *testing.T) {
			habits := chargingHabitsFromSummary(batterySummaryStats{
				avgEnergyWh: energyWh, fastChargeCount: 40, slowChargeCount: 60,
				deepDischargeCount: 5, fullChargeCount: 3, highSocCount: 8, totalCount: 100,
			})
			wire, err := json.Marshal(batteryHealthResponse{ChargingHabits: habits})
			if err != nil {
				t.Fatal(err)
			}
			var body struct {
				Habits map[string]interface{} `json:"charging_habits"`
			}
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			if body.Habits["avg_energy_per_session_wh"] != energyWh {
				t.Fatalf("SI session energy changed: %s", wire)
			}
			if _, exists := body.Habits["avg_energy_per_session"]; exists {
				t.Fatalf("legacy response shape retained: %s", wire)
			}
			for key, want := range map[string]float64{
				"fast_charge_count": 40, "slow_charge_count": 60, "deep_discharge_count": 5,
				"charge_to_full_count": 3, "high_soc_count": 8, "total_count": 100,
			} {
				if body.Habits[key] != want {
					t.Fatalf("%s changed: %s", key, wire)
				}
			}
		})
	}
}

func TestHealthNumericDomainsPreserveZeroAndFractions(t *testing.T) {
	for _, value := range []float64{-1, 101, math.NaN(), math.Inf(1), math.MaxFloat64, 0, 91.125} {
		t.Run(strconv.FormatFloat(value, 'g', -1, 64), func(t *testing.T) {
			response := batteryHealthResponse{
				CurrentSoh: value, CurrentSohAvailable: true,
				EstimatedCapacityWh: value, EstimatedCapacityAvailable: true,
				DegradationRatePctPerYear: -0.125, DegradationRateAvailable: true,
				History: []batteryHealthHistoryPoint{{
					Date: "2026-01-01", SohPct: value, CapacityWh: value,
					RangeM: &value, OdometerM: &value,
				}},
			}
			wire, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]interface{}
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			validSOH := isFinite(value) && value >= 0 && value <= 100
			if (body["current_soh"] != nil) != validSOH {
				t.Fatalf("SOH domain: %s", wire)
			}
			point := body["history"].([]interface{})[0].(map[string]interface{})
			if (point["soh_pct"] != nil) != validSOH {
				t.Fatalf("history SOH domain: %s", wire)
			}
			validNonnegative := isFinite(value) && value >= 0
			for _, key := range []string{"capacity_wh", "range_m", "odometer_m"} {
				if (point[key] != nil) != validNonnegative {
					t.Fatalf("%s domain: %s", key, wire)
				}
			}
			if validSOH && body["current_soh"] != value {
				t.Fatalf("zero/fraction changed: %s", wire)
			}
			if body["degradation_rate_pct_per_year"] != -0.125 {
				t.Fatalf("signed fractional rate changed: %s", wire)
			}
		})
	}
	wire, err := json.Marshal(batteryHealthResponse{})
	if err != nil {
		t.Fatal(err)
	}
	var missing map[string]interface{}
	if err := json.Unmarshal(wire, &missing); err != nil {
		t.Fatal(err)
	}
	if missing["current_soh"] != nil || missing["estimated_capacity_wh"] != nil {
		t.Fatalf("missing evidence became measured zero: %s", wire)
	}
}

func TestProjectionAndRiskNumericDomains(t *testing.T) {
	for _, bounds := range [][2]float64{{math.NaN(), 91}, {92, 91}, {-1, 91}, {0, 0}, {89.125, 91.25}} {
		wire, err := json.Marshal(predictiveProjection{
			Date: "2026-01", HealthPct: 90.125,
			ConfidenceLow: bounds[0], ConfidenceHigh: bounds[1],
		})
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]interface{}
		if err := json.Unmarshal(wire, &body); err != nil {
			t.Fatal(err)
		}
		valid := isFinite(bounds[0]) && bounds[0] >= 0 && bounds[0] <= bounds[1]
		if (body["confidence_low"] != nil) != valid || (body["confidence_high"] != nil) != valid ||
			body["health_pct"] != 90.125 {
			t.Fatalf("independent projected health/band evidence: %s", wire)
		}
	}
	for _, score := range []int{-1, 101, 0, 25} {
		wire, err := json.Marshal(riskFactor{Score: score})
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]interface{}
		if err := json.Unmarshal(wire, &body); err != nil {
			t.Fatal(err)
		}
		if (body["score"] != nil) != (score >= 0 && score <= 100) {
			t.Fatalf("risk score domain: %s", wire)
		}
	}
}

func TestCalendarDayAndProjectionMonthContract(t *testing.T) {
	sampledAt := time.Date(2026, 1, 31, 23, 59, 0, 0, time.FixedZone("source", -8*60*60))
	history := []batteryHealthHistoryPoint{
		{Date: "2025-11-30", SohPct: 95, RangeSampledAt: &sampledAt},
		{Date: "2025-12-31", SohPct: 94},
		{Date: "2026-01-31", SohPct: 93},
		{Date: "2025-02-29", SohPct: 92},
		{Date: "", SohPct: 91},
	}
	snapshots := historyToRegressionSnapshots(history)
	if len(snapshots) != 3 {
		t.Fatalf("valid calendar days = %d, want 3", len(snapshots))
	}
	for i, snapshot := range snapshots {
		if snapshot.CreatedAt.Format("2006-01-02") != history[i].Date {
			t.Fatalf("calendar day shifted: %+v", snapshot)
		}
	}
	now := time.Date(2026, 1, 31, 23, 59, 0, 0, time.UTC)
	calls := 0
	h := &Handler{now: func() time.Time {
		calls++
		return now.Add(time.Duration(calls-1) * 24 * time.Hour)
	}}
	result := h.predictDegradation(snapshots)
	if calls != 1 || len(result.Projections) != 61 {
		t.Fatalf("clock calls %d, projections %d", calls, len(result.Projections))
	}
	for i, point := range result.Projections {
		want := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).AddDate(0, i, 0).Format("2006-01")
		if point.Date != want || result.Prediction.ProjectionPoints[i].Month != want {
			t.Fatalf("month %d = %q, want %q", i, point.Date, want)
		}
	}
	if *history[0].RangeSampledAt != sampledAt || history[0].Date != "2025-11-30" {
		t.Fatal("source timestamp or calendar key was rewritten")
	}
}

func TestPredictionFitAndCrossingContract(t *testing.T) {
	first := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	now := first.Add(2 * 365 * 24 * time.Hour)
	h := &Handler{now: func() time.Time { return now }}
	points := func(values ...float64) []batterySnapshotData {
		out := make([]batterySnapshotData, len(values))
		for i, value := range values {
			out[i] = batterySnapshotData{CreatedAt: first.Add(time.Duration(i) * 365 * 24 * time.Hour), HealthScore: value}
		}
		return out
	}
	sameTime := points(95, 94, 93)
	for i := range sameTime {
		sameTime[i].CreatedAt = first
	}
	tests := []struct {
		name   string
		points []batterySnapshotData
		valid  bool
		status string
		sign   int
	}{
		{"missing", nil, false, "insufficient_fit", 0},
		{"too few", points(95, 94), false, "insufficient_fit", 0},
		{"invalid health", points(95, math.NaN(), 94, math.Inf(1)), false, "insufficient_fit", 0},
		{"invalid range", points(95, -1, 101), false, "insufficient_fit", 0},
		{"singular timestamps", sameTime, false, "insufficient_fit", 0},
		{"measured zero", points(0, 0, 0), true, "below_threshold", 0},
		{"flat", points(90, 90, 90), true, "no_future_crossing", 0},
		{"improving fractional", points(90, 90.125, 90.25), true, "no_future_crossing", 1},
		{"declining fractional", points(90, 89.875, 89.75), true, "future_crossing", -1},
		{"below threshold", points(79, 78, 77), true, "below_threshold", -1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			result := h.predictDegradation(tt.points)
			p := result.Prediction
			if p.FitValid != tt.valid || p.HasEnoughData != tt.valid || p.CrossingStatus != tt.status {
				t.Fatalf("fit/crossing = %+v", p)
			}
			wire, err := json.Marshal(p)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]interface{}
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			if !tt.valid {
				if body["slope_per_year"] != nil || fittedMonthlyRate(result) != nil || len(result.Projections) != 0 {
					t.Fatalf("invalid fit presented as evidence: %s", wire)
				}
			} else {
				if tt.sign == 0 && p.SlopePerYear != 0 || tt.sign == 1 && p.SlopePerYear <= 0 || tt.sign == -1 && p.SlopePerYear >= 0 {
					t.Fatalf("signed slope lost: %v", p.SlopePerYear)
				}
				if result.RatePerMonth != -p.SlopePerYear/12 {
					t.Fatal("loss rate must be negative SOH slope")
				}
			}
			if tt.status != "future_crossing" && (body["years_to_80_pct"] != nil || body["predicted_date"] != nil) {
				t.Fatalf("invented crossing: %s", wire)
			}
			if tt.status == "future_crossing" && (p.YearsTo80Pct <= 0 || p.YearsTo80Pct == math.Trunc(p.YearsTo80Pct)) {
				t.Fatalf("fractional future crossing lost: %+v", p)
			}
		})
	}
}

func TestApproximatePredictionIntervalContract(t *testing.T) {
	first := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	year := time.Duration(365.25 * 24 * float64(time.Hour))
	h := &Handler{now: func() time.Time { return first.Add(2 * year) }}
	samples := []batterySnapshotData{
		{CreatedAt: first, HealthScore: 90},
		{CreatedAt: first.Add(year), HealthScore: 88},
		{CreatedAt: first.Add(2 * year), HealthScore: 89},
		{CreatedAt: first.Add(3 * year), HealthScore: math.NaN()},
		{HealthScore: 90},
	}
	result := h.predictDegradation(samples)
	interval := result.Prediction.Interval
	if interval == nil || interval.Method != "approximate_ols_future_observation" ||
		interval.SampleCount != 3 || interval.ResidualDF != 1 ||
		interval.Multiplier != 2 || interval.EmpiricalCoverage != "unmeasured" {
		t.Fatalf("interval sample/model contract = %+v", interval)
	}
	// SSE=1.5, Sxx=2, x-mean(x)=1; the +1 is future-observation noise.
	point := result.Projections[0]
	if point.HealthPct != 88.5 || point.ConfidenceLow != 85.2 || point.ConfidenceHigh != 91.8 {
		t.Fatalf("future observation bounds changed: %+v", point)
	}
	for _, count := range []int{30, 31} {
		points := make([]batterySnapshotData, count)
		for i := range points {
			points[i] = batterySnapshotData{CreatedAt: first.Add(time.Duration(i) * 24 * time.Hour), HealthScore: 90}
		}
		got := h.predictDegradation(points)
		want := 2.0
		if count > 30 {
			want = 1.96
		}
		if got.Prediction.Interval.SampleCount != count || got.Prediction.Interval.Multiplier != want {
			t.Fatalf("multiplier boundary %d: %+v", count, got.Prediction.Interval)
		}
		if len(got.Projections) != 61 || len(got.Horizon.Points) != 3 {
			t.Fatal("populated projection/horizon surfaces lost")
		}
	}
	wire, err := json.Marshal(h.predictDegradation(samples[:2]).Prediction)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]any
	if err := json.Unmarshal(wire, &body); err != nil {
		t.Fatal(err)
	}
	if body["interval"] != nil {
		t.Fatalf("insufficient fit must not claim an interval: %s", wire)
	}
}

func TestHealthRateNullableSignedContract(t *testing.T) {
	for _, value := range []float64{0, -0.125, 0.125} {
		for _, available := range []bool{false, true} {
			wire, err := json.Marshal(batteryHealthResponse{DegradationRatePctPerYear: value, DegradationRateAvailable: available})
			if err != nil {
				t.Fatal(err)
			}

			var body map[string]interface{}
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			got := body["degradation_rate_pct_per_year"]
			if available && got != value || !available && got != nil {
				t.Fatalf("rate = %v for %v/%v", got, value, available)
			}
		}
	}
}

func TestHistoryDistanceEvidenceContract(t *testing.T) {
	sampledAt := time.Date(2026, 10, 12, 15, 4, 3, 0, time.UTC)
	for _, tt := range []struct {
		name  string
		value *float64
		want  any
	}{
		{"missing", nil, nil},
		{"zero", floatPointer(0), float64(0)},
		{"fractional", floatPointer(123.45), 123.5},
		{"negative", floatPointer(-1), nil},
		{"nonfinite", floatPointer(math.NaN()), nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			point := batteryHealthHistoryPoint{
				Date:   "2026-10-14",
				RangeM: distanceEvidence(tt.value), OdometerM: distanceEvidence(tt.value),
			}
			if point.RangeM != nil {
				point.RangeSampledAt = &sampledAt
				point.OdometerSampledAt = &sampledAt
			}
			wire, err := json.Marshal(point)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			for _, field := range []string{"range_m", "odometer_m"} {
				if body[field] != tt.want {
					t.Fatalf("%s = %v, want %v", field, body[field], tt.want)
				}
			}
			for _, field := range []string{"range_sampled_at", "odometer_sampled_at"} {
				if tt.want == nil && body[field] != nil ||
					tt.want != nil && body[field] != sampledAt.Format(time.RFC3339) {
					t.Fatalf("sample timestamp changed: %s", wire)
				}
			}
		})
	}
	if strings.Contains(batteryHealthHistoryQuery, "COALESCE(r.range_m, 0)") ||
		strings.Contains(batteryHealthHistoryQuery, "COALESCE(o.odometer_m, 0)") ||
		!strings.Contains(batteryHealthHistoryQuery, "r.sampled_at") ||
		!strings.Contains(batteryHealthHistoryQuery, "o.sampled_at") {
		t.Fatal("history query must preserve missing samples and their timestamps")
	}
}

func TestLiveHistoryDoesNotInventDistanceEvidence(t *testing.T) {
	h := NewHandler(nil, &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
			switch name {
			case "EnergyRemaining":
				return 30000.0, nil
			case "BatteryLevel":
				return 50.0, nil
			default:
				return nil, nil
			}
		},
	})
	response, _, err := h.buildBatteryHealth(context.Background(), 42)
	if err != nil {
		t.Fatal(err)
	}
	if !response.EstimatedCapacityAvailable || response.EstimatedCapacityWh != 60000 {
		t.Fatalf("live capacity estimator = %+v", response)
	}
	if len(response.History) != 0 {
		t.Fatalf("live estimator invented a dated health or distance sample: %+v", response.History)
	}
}

func TestHealthObservationDurationIsNotPackAge(t *testing.T) {
	now := time.Date(2026, 10, 14, 0, 0, 0, 0, time.UTC)
	charging := now.Add(-400 * 24 * time.Hour)
	drive := now.Add(-800 * 24 * time.Hour)
	future := now.Add(24 * time.Hour)
	zero := time.Time{}
	tests := []struct {
		name     string
		history  []batteryHealthHistoryPoint
		charging *time.Time
		drive    *time.Time
		start    *time.Time
		source   string
	}{
		{"missing", nil, nil, nil, nil, "unavailable"},
		{"invalid", []batteryHealthHistoryPoint{{Date: "invalid"}}, &zero, &future, nil, "unavailable"},
		{"recorded today", nil, &now, nil, &now, "charging_session"},
		{"charging", []batteryHealthHistoryPoint{{Date: "2026-01-01"}}, &charging, nil, &charging, "charging_session"},
		{"earliest drive", []batteryHealthHistoryPoint{{Date: "2026-01-01"}}, &charging, &drive, &drive, "drive_session"},
		{"unsorted retained history", []batteryHealthHistoryPoint{{Date: "2026-01-01"}, {Date: drive.Format("2006-01-02")}}, &charging, nil, &drive, "battery_health_history"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			months, start, source := batteryObservation(now, tt.history, tt.charging, tt.drive)
			if source != tt.source || (start == nil) != (tt.start == nil) {
				t.Fatalf("observation start/source = %v/%s", start, source)
			}
			if tt.start != nil && (!start.Equal(*tt.start) || months == nil ||
				*months != int(now.Sub(*tt.start).Hours()/(24*30.44))) {
				t.Fatalf("populated duration changed: %v/%v", months, start)
			}
			wire, err := json.Marshal(batteryHealthResponse{
				BatteryAgeMonths: 120, ObservationDurationMonths: months,
				ObservationStartedAt: start, ObservationSource: source,
			})
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			if body["battery_age_months"] != nil || body["observation_source"] != tt.source {
				t.Fatalf("telemetry presented as pack age: %s", wire)
			}
			if months == nil && body["observation_duration_months"] != nil ||
				months != nil && body["observation_duration_months"] != float64(*months) {
				t.Fatalf("missing or populated duration changed: %s", wire)
			}
		})
	}
	h := &Handler{now: func() time.Time { return now }}
	response, _, err := h.buildBatteryHealth(context.Background(), 42)
	if err != nil {
		t.Fatal(err)
	}
	if response.ObservationDurationMonths != nil || response.ObservationStartedAt != nil ||
		response.ObservationSource != "unavailable" || response.BatteryAgeMonths != 0 {
		t.Fatalf("missing history invented observation or age: %+v", response)
	}
}

func TestHealthCapacityBaselineEvidenceIsSeparateFromEstimator(t *testing.T) {
	for _, tt := range []struct {
		vin, model, source string
		nominal            float64
	}{
		{"1234567E", "", "vin_estimate", 60000},
		{"", "Model S", "model_estimate", 100000},
		{"", "", "default", 75000},
	} {
		t.Run(tt.source, func(t *testing.T) {
			nominal, source := estimateBatteryCapacityWh(tt.vin, tt.model)
			current, available := recentCapacityEvidence([]batteryHealthHistoryPoint{
				{CapacityWh: 70000}, {CapacityWh: 72500}, {CapacityWh: 73000},
			}, 8)
			wire, err := json.Marshal(batteryHealthResponse{
				OriginalCapacityWh: nominal, CapacitySource: source,
				EstimatedCapacityWh: current, EstimatedCapacityAvailable: available,
			})
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(wire, &body); err != nil {
				t.Fatal(err)
			}
			if body["capacity_source"] != tt.source || body["original_capacity_wh"] != tt.nominal ||
				body["estimated_capacity_wh"] != 72500.0 || body["estimated_capacity_wh_available"] != true {
				t.Fatalf("nominal and observed evidence conflated: %s", wire)
			}
		})
	}
}

func TestHealthMissingEvidenceDoesNotProduceHealthyAdvice(t *testing.T) {
	h := &Handler{}
	response, _, err := h.buildBatteryHealth(context.Background(), 42)
	if err != nil {
		t.Fatal(err)
	}
	if response.ChargeHabitsAvailable ||
		response.ValidChargeCount != 0 || response.ValidDoDCount != 0 {
		t.Fatalf("missing evidence represented as measured health: %+v", response)
	}
	if len(response.RiskFactors) != 5 || len(response.Recommendations) != 0 {
		t.Fatalf("risk shells or unavailable advice incorrect: %+v", response)
	}
	if response.TempExposureAvailable || response.TempSampleCount != 0 ||
		response.TempExposureScore != nil || response.TempExposureReason == nil {
		t.Fatalf("missing thermal evidence represented as observed: %+v", response)
	}
	for _, factor := range response.RiskFactors {
		if factor.Available == nil || *factor.Available {
			t.Fatalf("missing risk evidence marked available: %+v", factor)
		}
	}
}

func TestTemperatureRiskRequiresThermalSamples(t *testing.T) {
	cold, hot, invalid := -5.5, 46.0, math.NaN()
	tests := []struct {
		name      string
		temp      *float64
		samples   int
		available bool
		score     int
	}{
		{"missing", nil, 0, false, 0},
		{"missing average", nil, 10, false, 0},
		{"no samples", &hot, 0, false, 0},
		{"below threshold", &hot, 9, false, 0},
		{"invalid average", &invalid, 10, false, 0},
		{"measured cold", &cold, 10, true, 10},
		{"measured hot", &hot, 10, true, 90},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			factors := computeRiskFactors(0, 0, tt.temp, 0, 0, tt.samples)
			thermal := factors[2]
			if thermal.Available == nil || *thermal.Available != tt.available || thermal.Score != tt.score {
				t.Fatalf("unexpected thermal risk: %+v", thermal)
			}
			raw, err := json.Marshal(thermal)
			if err != nil {
				t.Fatal(err)
			}
			if !tt.available {
				if thermal.Label != "Unknown" || thermal.Detail != "" || !strings.Contains(string(raw), `"score":null`) {
					t.Fatalf("unknown risk asserted an observation: %s", raw)
				}
				if recs := generateRecommendations(factors); len(recs) != 0 {
					t.Fatalf("missing thermal samples generated advice: %v", recs)
				}
			} else if thermal.Detail == "" || thermal.Label != riskLabel(tt.score) {
				t.Fatalf("measured risk lost its observation: %+v", thermal)
			}
		})
	}
}

func TestHealthRiskEvidenceGatesOnlyDependentAdvice(t *testing.T) {
	temp := -5.5
	factors := healthRiskEvidence(computeRiskFactors(80, 0, &temp, 0.5, 0, 10),
		true, false, true, true, false)
	recs := generateRecommendations(factors)
	if len(recs) != 1 || !strings.Contains(recs[0], "Supercharging") {
		t.Fatalf("available high risk must retain advice: %v", recs)
	}
	if factors[2].Available == nil || !*factors[2].Available {
		t.Fatal("valid signed temperature must remain available")
	}
	for _, temp := range []float64{math.NaN(), math.Inf(1), math.Inf(-1)} {
		score, reason := temperatureExposure(&temp, 10)
		if score != nil || reason == nil {
			t.Fatalf("invalid temperature %v scored as measured", temp)
		}
	}
	for _, temp := range []float64{0, -5.5} {
		score, reason := temperatureExposure(&temp, 10)
		if score == nil || reason != nil {
			t.Fatalf("valid temperature %v unavailable", temp)
		}
	}
}

func TestHealthSummaryDenominatorsIncludeMeasuredZeroAndExcludeInvalidSOC(t *testing.T) {
	for _, clause := range []string{
		"peak_power_w BETWEEN 0 AND 50000",
		"start_soc_pct BETWEEN 0 AND 100",
		"end_soc_pct BETWEEN 0 AND 100",
		"start_soc_pct >= end_soc_pct",
		"valid_dod_count", "valid_start_count", "valid_end_count",
	} {
		if !strings.Contains(batteryHealthSummaryQuery, clause) {
			t.Fatalf("missing valid denominator clause %q", clause)
		}
	}
}

func TestHealthWirePreservesFractionalCyclesAndUnavailableScores(t *testing.T) {
	cycles := 0.5
	response := batteryHealthResponse{
		totalCyclesExact:     &cycles,
		TotalCyclesAvailable: true,
		RiskFactors: healthRiskEvidence(computeRiskFactors(0, 0, nil, 0, 0, 0),
			true, false, false, false, false),
	}
	raw, err := json.Marshal(response)
	if err != nil {
		t.Fatal(err)
	}
	var body map[string]interface{}
	if err := json.Unmarshal(raw, &body); err != nil {
		t.Fatal(err)
	}
	if body["total_cycles"] != 0.5 || body["charge_habits_score"] != nil || body["stress_level"] != nil {
		t.Fatalf("invalid Health wire contract: %s", raw)
	}
	if body["temp_exposure_available"] != false || body["temp_sample_count"] != float64(0) ||
		body["temp_exposure_score"] != nil {
		t.Fatalf("missing thermal evidence lost on the wire: %s", raw)
	}
	factors := body["risk_factors"].([]interface{})
	if factors[0].(map[string]interface{})["score"] != float64(0) ||
		factors[1].(map[string]interface{})["score"] != nil {
		t.Fatalf("measured zero and missing scores conflated: %s", raw)
	}
}

func TestHealthChargeEquivalentsAndDriveDropEvidence(t *testing.T) {
	for _, tt := range []struct {
		name             string
		energy, capacity float64
		samples          int
		want             float64
		available        bool
	}{
		{"partial charge", 37500, 75000, 2, 0.5, true},
		{"populated", 150000, 75000, 4, 2, true},
		{"measured zero", 0, 75000, 1, 0, true},
		{"no samples", 0, 75000, 0, 0, false},
		{"invalid capacity", 37500, math.Inf(1), 2, 0, false},
		{"invalid energy", math.NaN(), 75000, 2, 0, false},
		{"overflow", math.MaxFloat64, math.SmallestNonzeroFloat64, 1, 0, false},
	} {
		t.Run(tt.name, func(t *testing.T) {
			cycles, available := chargeEquivalentCycles(tt.energy, tt.capacity, tt.samples)
			if cycles != tt.want || available != tt.available {
				t.Fatalf("charge equivalents = %v/%v, want %v/%v", cycles, available, tt.want, tt.available)
			}
			response := batteryHealthResponse{
				totalCyclesExact: &cycles, TotalCyclesAvailable: available,
				ValidEnergyCount: tt.samples, ValidDoDCount: 3,
				AvgDepthOfDischargePct: 12.345,
			}
			raw, err := json.Marshal(response)
			if err != nil {
				t.Fatal(err)
			}
			var body map[string]any
			if err := json.Unmarshal(raw, &body); err != nil {
				t.Fatal(err)
			}
			if available && body["total_cycles"] != tt.want || !available && body["total_cycles"] != nil {
				t.Fatalf("cycle availability/precision lost: %s", raw)
			}
			if body["avg_depth_of_discharge_pct"] != 12.345 ||
				body["valid_dod_count"] != float64(3) || body["valid_energy_count"] != float64(tt.samples) {
				t.Fatalf("drive sample/precision lost: %s", raw)
			}
		})
	}
	for _, tt := range []struct {
		samples int
		drop    float64
		want    any
	}{
		{0, 0, nil}, {1, 0, float64(0)}, {2, 12.345, 12.345},
		{1, -1, nil}, {1, 101, nil},
	} {
		raw, err := json.Marshal(batteryHealthResponse{ValidDoDCount: tt.samples, AvgDepthOfDischargePct: tt.drop})
		if err != nil {
			t.Fatal(err)
		}
		var body map[string]any
		if err := json.Unmarshal(raw, &body); err != nil {
			t.Fatal(err)
		}
		if body["avg_depth_of_discharge_pct"] != tt.want {
			t.Fatalf("drive drop unavailable/zero conflated: %s", raw)
		}
	}
}

// newBatteryDegradationRequest builds an *http.Request with vehicle_id
// wired onto the query string so Handler.Predict /
// .Health parse it via r.URL.Query().Get("vehicle_id"). Mirrors the
// pattern used in battery_cells_handler_test.go for the query-param
// driven endpoint.
func newBatteryDegradationRequest(t *testing.T, vehicleID string) *http.Request {
	t.Helper()
	return httptest.NewRequest(http.MethodGet, "/analytics/battery-degradation?vehicle_id="+vehicleID, nil)
}

// TestBatteryDegradation_AllSignalsCarryForward verifies that the Predict
// fallback branch (entered when no signal_log trace snapshots exist)
// resolves both EnergyRemaining and EstBatteryRange via
// signal.StateReader.SignalAt at time.Now(), and that those carried-
// forward values flow into the JSON response as current_capacity /
// current_range. The handler no longer uses the legacy
// signaldb.SignalLogReader.SignalAt helper. The fake returns last-known
// values for every signal name — emulating StateReader's forward-fold
// semantics where unchanged signals carry their prior emitted value
// rather than disappearing — and the test asserts every downstream
// projection field renders that carried-forward value. A future
// regression that re-points the per-signal lookups at signalLogReader
// (which would reintroduce the deleted helper), drops one of the two
// signal names, or anchors them to a stale "at" would zero the Battery
// Degradation panel and is caught here.
func TestBatteryDegradation_AllSignalsCarryForward(t *testing.T) {
	const (
		energyRemaining  = 60000.0 // capacity_wh
		estBatteryRangeM = 410500.0
		expectedRangeKm  = 410.5
	)
	vid := int64(42)

	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
		"EstBatteryRange": estBatteryRangeM,
	}

	var calls []signalAtCallRecord
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, v int64, name string, at time.Time) (signal.SignalValue, error) {
			calls = append(calls, signalAtCallRecord{vehicleID: v, name: name, at: at})
			if val, ok := carried[name]; ok {
				return val, nil
			}
			return nil, nil
		},
	}
	// db: nil skips the daily aggregate and enters the StateReader fallback.
	h := &Handler{state: fake}

	before := time.Now()
	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))
	after := time.Now()

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	wantNames := map[string]bool{
		"EnergyRemaining": false,
		"EstBatteryRange": false,
	}
	for _, c := range calls {
		if _, ok := wantNames[c.name]; !ok {
			continue
		}
		wantNames[c.name] = true
		if c.vehicleID != vid {
			t.Fatalf("SignalAt(%q).vehicleID = %d, want %d", c.name, c.vehicleID, vid)
		}
		if c.at.Before(before.Add(-time.Second)) || c.at.After(after.Add(time.Second)) {
			t.Fatalf("SignalAt(%q).at = %v, want within [%v, %v] (≈ time.Now())", c.name, c.at, before, after)
		}
	}
	for name, sawIt := range wantNames {
		if !sawIt {
			t.Fatalf("handler never called SignalAt with name=%q; calls=%v", name, calls)
		}
	}

	// Verify the projected response carries the SignalAt-derived values.
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["current_capacity"].(float64); got != energyRemaining {
		t.Fatalf("current_capacity = %#v, want %v (carried forward from EnergyRemaining)", body["current_capacity"], energyRemaining)
	}
	if got, _ := body["current_range"].(float64); got != expectedRangeKm {
		t.Fatalf("current_range = %#v, want %v km (converted from SI EstBatteryRange)", body["current_range"], expectedRangeKm)
	}
}

// TestBatteryDegradation_DegradationCalc_UsesLatestValues verifies that
// the Predict fallback branch derives current_health and
// current_degradation from the StateReader-resolved EnergyRemaining
// signal divided by the looked-up battery capacity (75 kWh default
// when no vehicle row exists). With energy_remaining=60 kWh and the
// default capacity of 75 kWh, expected health = 60000/75000*100 = 80%, and
// expected degradation = 100 - 80 = 20%. A future regression that
// drops the divide-by-capacity step (and degenerates current_health to
// raw kWh), inverts the degradation formula, or short-circuits the
// fallback derivation when no snapshots exist would silently break the
// Battery Degradation panel's headline metric and is caught here.
func TestBatteryDegradation_DegradationCalc_UsesLatestValues(t *testing.T) {
	const (
		nominalCapacity = 75000.0 // default when h.db == nil
		energyRemaining = 60000.0
		expectedHealth  = (energyRemaining / nominalCapacity) * 100 // 80
		expectedDegrad  = 100 - expectedHealth                      // 20
	)

	carried := map[string]float64{
		"EnergyRemaining": energyRemaining,
	}
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
			if v, ok := carried[name]; ok {
				return v, nil
			}
			return nil, nil
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode: %v; body=%s", err, rec.Body.String())
	}
	if got, _ := body["current_health"].(float64); got != expectedHealth {
		t.Fatalf("current_health = %#v, want %v (= EnergyRemaining/%v*100)", body["current_health"], expectedHealth, nominalCapacity)
	}
	if got, _ := body["current_degradation"].(float64); got != expectedDegrad {
		t.Fatalf("current_degradation = %#v, want %v (= 100 - current_health)", body["current_degradation"], expectedDegrad)
	}
	// current_health_pct mirrors current_health on the new predictive shape.
	if got, _ := body["current_health_pct"].(float64); got != expectedHealth {
		t.Fatalf("current_health_pct = %#v, want %v (must mirror current_health)", body["current_health_pct"], expectedHealth)
	}
	// battery_capacity_wh must surface the looked-up (default) capacity
	// — a regression that loses the projection would break the Battery
	// Degradation panel's "estimated capacity" tile.
	if got, _ := body["battery_capacity_wh"].(float64); got != nominalCapacity {
		t.Fatalf("battery_capacity_wh = %#v, want %v (default when no vehicle row)", body["battery_capacity_wh"], nominalCapacity)
	}
}

// TestBatteryDegradation_PropagatesError verifies that a
// StateReader.SignalAt transport error (e.g. pgx connection drop) becomes
// a 500 to the client for the Predict endpoint. The legacy
// *signaldb.SignalLogReader-backed handler silently swallowed SignalAt
// errors and returned a partial / zero-valued payload, which was
// indistinguishable on the frontend from "vehicle truly idle / brand-
// new vehicle with no signal_log history" and rendered the Battery
// Degradation panel as "battery looks dead" even when the underlying
// read had genuinely failed. The stricter error handling lets the
// frontend surface the failure rather than silently
// rendering a dead-battery panel. A future regression that reverts to
// the silent-swallow behavior is caught here.
func TestBatteryDegradation_PropagatesError(t *testing.T) {
	wantErr := errors.New("simulated pgx connection lost")
	fake := &fakeStateReader{
		signalAtFn: func(_ context.Context, _ int64, _ string, _ time.Time) (signal.SignalValue, error) {
			return nil, wantErr
		},
	}
	h := &Handler{state: fake}

	rec := httptest.NewRecorder()
	h.Predict(rec, newBatteryDegradationRequest(t, "42"))

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500; body=%s", rec.Code, rec.Body.String())
	}
}

func TestBatteryHealthQueryUsesBoundedDailyAggregate(t *testing.T) {
	for _, clause := range []string{
		"FROM cagg_battery_daily",
		"max_soc - min_soc >= $2",
		"LIMIT $3",
		"field = 'EstBatteryRange'",
		"field = 'Odometer'",
		"ORDER BY ts DESC",
	} {
		if !strings.Contains(batteryHealthHistoryQuery, clause) {
			t.Fatalf("batteryHealthHistoryQuery missing %q", clause)
		}
	}
	if batteryHistoryLimit != 180 {
		t.Fatalf("batteryHistoryLimit = %d, want 180", batteryHistoryLimit)
	}
}

func TestBatteryHealthCoalescesConcurrentColdLoads(t *testing.T) {
	fixedNow := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	h := &Handler{
		now:         func() time.Time { return fixedNow },
		healthCache: make(map[int64]batteryHealthCacheEntry),
	}
	var loadCount atomic.Int32
	h.healthLoader = func(context.Context, int64) (*batteryHealthResponse, batteryHealthTimings, error) {
		loadCount.Add(1)
		time.Sleep(25 * time.Millisecond)
		return &batteryHealthResponse{
			VehicleID:       42,
			History:         []batteryHealthHistoryPoint{},
			Projections:     []predictiveProjection{},
			RiskFactors:     []riskFactor{},
			Recommendations: []string{},
			ChargingAnalysis: batteryChargingAnalysis{
				ChargeLevelDistribution: []chargeLevelBucket{},
			},
		}, batteryHealthTimings{}, nil
	}

	const callers = 12
	var requests sync.WaitGroup
	requests.Add(callers)
	statuses := make(chan int, callers)
	for range callers {
		go func() {
			defer requests.Done()
			rec := httptest.NewRecorder()
			h.Health(rec, httptest.NewRequest(http.MethodGet, "/analytics/battery-health?vehicle_id=42", nil))
			statuses <- rec.Code
		}()
	}
	requests.Wait()
	close(statuses)

	for status := range statuses {
		if status != http.StatusOK {
			t.Fatalf("status = %d, want 200", status)
		}
	}
	if got := loadCount.Load(); got != 1 {
		t.Fatalf("health loader calls = %d, want 1", got)
	}
	h.healthLoadLocksMu.Lock()
	defer h.healthLoadLocksMu.Unlock()
	if got := len(h.healthLoadLocks); got != 0 {
		t.Fatalf("retained load locks = %d, want 0", got)
	}
}

func TestBatteryHealthResponseUsesCanonicalSIFields(t *testing.T) {
	odometer, rangeM := 20_000.0, 410_000.0
	h := &Handler{
		now:         time.Now,
		healthCache: make(map[int64]batteryHealthCacheEntry),
	}
	h.healthLoader = func(context.Context, int64) (*batteryHealthResponse, batteryHealthTimings, error) {
		return &batteryHealthResponse{
			VehicleID:           42,
			EstimatedCapacityWh: 72_500,
			OriginalCapacityWh:  75_000,
			History: []batteryHealthHistoryPoint{{
				Date:       "2026-08-23",
				OdometerM:  &odometer,
				CapacityWh: 72_500,
				RangeM:     &rangeM,
			}},
			Projections:     []predictiveProjection{},
			RiskFactors:     []riskFactor{},
			Recommendations: []string{},
			ChargingAnalysis: batteryChargingAnalysis{
				ChargeLevelDistribution: []chargeLevelBucket{},
			},
		}, batteryHealthTimings{}, nil
	}

	rec := httptest.NewRecorder()
	h.Health(rec, httptest.NewRequest(http.MethodGet, "/analytics/battery-health?vehicle_id=42", nil))
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	if got := rec.Header().Get("Cache-Control"); got != "private, max-age=300" {
		t.Fatalf("Cache-Control = %q, want private max-age", got)
	}
	if got := rec.Header().Get("Server-Timing"); !strings.Contains(got, `cache;desc="miss"`) {
		t.Fatalf("Server-Timing = %q, want cache miss timing", got)
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	for _, field := range []string{"estimated_capacity_wh", "original_capacity_wh"} {
		if _, ok := body[field]; !ok {
			t.Fatalf("response missing %q: %s", field, rec.Body.String())
		}
	}
	for _, legacyField := range []string{"estimated_capacity", "original_capacity"} {
		if _, ok := body[legacyField]; ok {
			t.Fatalf("response unexpectedly contains legacy field %q", legacyField)
		}
	}
	history := body["history"].([]any)
	point := history[0].(map[string]any)
	for _, field := range []string{"capacity_wh", "range_m", "odometer_m"} {
		if _, ok := point[field]; !ok {
			t.Fatalf("history point missing %q: %v", field, point)
		}
	}
	for _, legacyField := range []string{"range_km", "odometer"} {
		if _, ok := point[legacyField]; ok {
			t.Fatalf("history point unexpectedly contains legacy field %q", legacyField)
		}
	}
}

func TestBatteryHealthLiveCapacityNormalizesEnergyBySOC(t *testing.T) {
	values := map[string]float64{
		"EnergyRemaining": 30000,
		"BatteryLevel":    50,
		"EstBatteryRange": 400000,
	}
	h := &Handler{
		state: &fakeStateReader{
			signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
				return values[name], nil
			},
		},
		now: time.Now,
	}

	capacityWh, rangeM, err := h.loadLiveBatteryCapacity(context.Background(), 42, 75000)
	if err != nil {
		t.Fatalf("loadLiveBatteryCapacity() error = %v", err)
	}
	if capacityWh == nil || *capacityWh != 60000 {
		t.Fatalf("capacityWh = %v, want 60000", capacityWh)
	}
	if rangeM == nil || *rangeM != 400000 {
		t.Fatalf("rangeM = %v, want 400000", rangeM)
	}
}

func TestBatteryHealthCapacityAvailability(t *testing.T) {
	tests := []struct {
		name        string
		energy, soc signal.SignalValue
		want        *float64
	}{
		{name: "missing energy", soc: 50.0},
		{name: "missing soc", energy: 30000.0},
		{name: "invalid energy", energy: "invalid", soc: 50.0},
		{name: "invalid soc", energy: 30000.0, soc: "invalid"},
		{name: "nonfinite energy", energy: math.NaN(), soc: 50.0},
		{name: "infinite energy", energy: math.Inf(1), soc: 50.0},
		{name: "infinite soc", energy: 30000.0, soc: math.Inf(1)},
		{name: "negative energy", energy: -1.0, soc: 50.0},
		{name: "negative soc", energy: 30000.0, soc: -50.0},
		{name: "small soc", energy: 30000.0, soc: 4.5},
		{name: "excessive capacity", energy: 100000.0, soc: 50.0},
		{name: "zero soc", energy: 0.0, soc: 0.0},
		{name: "zero energy", energy: 0.0, soc: 50.0, want: floatPointer(0)},
		{name: "fractional energy and soc", energy: 30000.25, soc: 50.5, want: floatPointer(30000.25 / 0.505)},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := NewHandler(nil, &fakeStateReader{
				signalAtFn: func(_ context.Context, _ int64, name string, _ time.Time) (signal.SignalValue, error) {
					switch name {
					case "EnergyRemaining":
						return tt.energy, nil
					case "BatteryLevel":
						return tt.soc, nil
					default:
						return nil, nil
					}
				},
			})
			response, _, err := h.buildBatteryHealth(context.Background(), 42)
			if err != nil {
				t.Fatal(err)
			}
			available := tt.want != nil
			if response.CurrentSohAvailable != available || response.EstimatedCapacityAvailable != available {
				t.Fatalf("availability = %v/%v, want %v", response.CurrentSohAvailable, response.EstimatedCapacityAvailable, available)
			}
			if available && response.EstimatedCapacityWh != roundTo(*tt.want, 1) {
				t.Fatalf("capacity = %v, want %v", response.EstimatedCapacityWh, roundTo(*tt.want, 1))
			}
			if len(response.History) != 0 {
				t.Fatalf("invented history: %v", response.History)
			}
			if response.ObservationStartedAt != nil || response.ObservationDurationMonths != nil ||
				len(response.Projections) != 0 || response.Prediction.HasEnoughData {
				t.Fatalf("live estimator fabricated dated evidence or a fit: %+v", response)
			}
		})
	}
}

func TestBatteryHealthWithoutStateHasNoCapacityEvidence(t *testing.T) {
	h := NewHandler(nil, nil)
	response, _, err := h.buildBatteryHealth(context.Background(), 42)
	if err != nil {
		t.Fatal(err)
	}
	if response.CurrentSohAvailable || response.EstimatedCapacityAvailable || len(response.History) != 0 {
		t.Fatalf("invented battery evidence: %+v", response)
	}
}

func floatPointer(value float64) *float64 { return &value }

func TestReadSignalFloatPreservesSignedFractionalValues(t *testing.T) {
	for _, value := range []float64{0, -12.5, 0.125} {
		h := NewHandler(nil, &fakeStateReader{
			signalAtFn: func(context.Context, int64, string, time.Time) (signal.SignalValue, error) {
				return value, nil
			},
		})
		got, err := h.readSignalFloat(context.Background(), 42, "EnergyRemaining", time.Now())
		if err != nil || got == nil || *got != value {
			t.Fatalf("readSignalFloat(%v) = %v, %v", value, got, err)
		}
	}
}

func TestRecentCapacityEvidence(t *testing.T) {
	for _, tt := range []struct {
		name      string
		values    []float64
		want      float64
		available bool
	}{
		{name: "missing"},
		{name: "invalid", values: []float64{math.NaN(), math.Inf(1), -1}},
		{name: "measured zero", values: []float64{0}, available: true},
		{name: "fractional median", values: []float64{0, 1.25}, want: 0.625, available: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			history := make([]batteryHealthHistoryPoint, len(tt.values))
			for i, value := range tt.values {
				history[i].CapacityWh = value
			}
			got, available := recentCapacityEvidence(history, 8)
			if got != tt.want || available != tt.available {
				t.Fatalf("evidence = %v/%v, want %v/%v", got, available, tt.want, tt.available)
			}
		})
	}
}
func TestCalculateStressLevelMatchesPredictiveContract(t *testing.T) {
	tests := []struct {
		name               string
		fastChargePct      float64
		deepDischargeCount int
		fullChargeCount    int
		totalCount         int
		want               string
	}{
		{name: "low", fastChargePct: 20, deepDischargeCount: 2, fullChargeCount: 2, totalCount: 20, want: "Low"},
		{name: "medium fast charging", fastChargePct: 30, totalCount: 20, want: "Medium"},
		{name: "high deep discharge", deepDischargeCount: 21, totalCount: 40, want: "High"},
		{name: "high full charging", fullChargeCount: 6, totalCount: 10, want: "High"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := calculateStressLevel(
				tt.fastChargePct,
				tt.deepDischargeCount,
				tt.fullChargeCount,
				tt.totalCount,
			)
			if got != tt.want {
				t.Fatalf("calculateStressLevel() = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestBatteryHealthCacheIsBounded(t *testing.T) {
	fixedNow := time.Date(2026, time.August, 23, 12, 0, 0, 0, time.UTC)
	h := &Handler{
		now:         func() time.Time { return fixedNow },
		healthCache: make(map[int64]batteryHealthCacheEntry),
	}
	for vehicleID := int64(1); vehicleID <= batteryHealthCacheMaxSize+10; vehicleID++ {
		h.cacheBatteryHealth(vehicleID, &batteryHealthResponse{VehicleID: vehicleID})
	}
	if got := len(h.healthCache); got != batteryHealthCacheMaxSize {
		t.Fatalf("cache size = %d, want %d", got, batteryHealthCacheMaxSize)
	}
}
