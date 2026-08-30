package datarepair

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/enums"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

// Evidence-based diagnosis tests.
//
// Every case pins the clock to testNow (2026-06-01T12:00:00Z) so the
// liveness/settle windows are deterministic, and states the scenario in terms
// of the durable rows that would exist: drive_telemetry gear/speed rows,
// signal_log DetailedChargeState rows, charging_telemetry power rows, and the
// drives / charging_sessions boundary rows themselves.

func TestDiagnoseDrive_OpenDriveThenChargingStart(t *testing.T) {
	t.Parallel()

	// The reported scenario: the last thing we saw was the car in Drive, then
	// the next meaningful durable event is a charging session starting. The
	// intermediate Park was never recorded, so the drive is still open.
	start := testNow.Add(-6 * time.Hour)
	lastDriving := testNow.Add(-5 * time.Hour)
	chargeStart := testNow.Add(-4 * time.Hour)

	src := &fakeDiagnosis{
		drivingObs:   []datarepairObs{driveTelemetryObs(lastDriving, "Gear", enums.GearDrive)},
		chargeStarts: []sessionStart{{ts: chargeStart, id: 900}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected a suggestion for an open drive contradicted by a charging start")
	}

	if sug.Rule != systemmodel.SessionRepairRuleDriveOpenChargingStarted {
		t.Errorf("rule = %q, want %q", sug.Rule, systemmodel.SessionRepairRuleDriveOpenChargingStarted)
	}
	if sug.Confidence != systemmodel.SessionRepairConfidenceMedium {
		t.Errorf("confidence = %q, want medium", sug.Confidence)
	}
	// The proposed boundary is the last in-drive evidence — never the
	// contradiction itself, which would over-extend the drive.
	if !sug.SuggestedEndedAt.Equal(lastDriving) {
		t.Errorf("suggested_ended_at = %s, want %s", sug.SuggestedEndedAt, lastDriving)
	}
	if !sug.ContradictingEvidence.Ts.Equal(chargeStart) {
		t.Errorf("contradiction ts = %s, want %s", sug.ContradictingEvidence.Ts, chargeStart)
	}
	if sug.ContradictingEvidence.Source != systemmodel.SessionRepairSourceChargingSessions {
		t.Errorf("contradiction source = %q, want charging_sessions", sug.ContradictingEvidence.Source)
	}
	if sug.LastInSessionEvidence == nil || !sug.LastInSessionEvidence.Ts.Equal(lastDriving) {
		t.Fatalf("last in-session evidence = %+v, want ts %s", sug.LastInSessionEvidence, lastDriving)
	}
	if sug.LastInSessionEvidence.Source != systemmodel.SessionRepairSourceDriveTelemetry {
		t.Errorf("in-session source = %q, want drive_telemetry", sug.LastInSessionEvidence.Source)
	}
	if want := int64(3600); sug.EvidenceGapS != want {
		t.Errorf("evidence_gap_s = %d, want %d", sug.EvidenceGapS, want)
	}
	if want := int64(3600); sug.SuggestedDurationS != want {
		t.Errorf("suggested_duration_s = %d, want %d", sug.SuggestedDurationS, want)
	}
	if sug.StoredEndedAt != nil {
		t.Errorf("stored_ended_at = %v, want nil for an open drive", sug.StoredEndedAt)
	}
	if !sug.Applicable || sug.BlockedReason != "" {
		t.Errorf("applicable = %v (%q), want true", sug.Applicable, sug.BlockedReason)
	}
	if src.liveDriveChecks == 0 {
		t.Error("the live-vehicle guard was never consulted for an open drive")
	}
}

func TestDiagnoseDrive_ParkObservedIsTheBoundary(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-6 * time.Hour)
	lastDriving := testNow.Add(-5 * time.Hour)
	park := testNow.Add(-4*time.Hour - 30*time.Minute)

	src := &fakeDiagnosis{
		drivingObs: []datarepairObs{driveTelemetryObs(lastDriving, "Gear", enums.GearDrive)},
		gearObs:    []datarepairObs{driveTelemetryObs(park, "Gear", enums.GearPark)},
		// A charging session starts later; Park is earlier and wins.
		chargeStarts: []sessionStart{{ts: testNow.Add(-4 * time.Hour), id: 900}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected a suggestion for an open drive with a later Park")
	}
	if sug.Rule != systemmodel.SessionRepairRuleDriveOpenParkObserved {
		t.Errorf("rule = %q, want %q", sug.Rule, systemmodel.SessionRepairRuleDriveOpenParkObserved)
	}
	// Gear=P is the exact instant the FSM would have ended the drive at, so
	// the proposal is the contradiction itself rather than the last motion.
	if !sug.SuggestedEndedAt.Equal(park) {
		t.Errorf("suggested_ended_at = %s, want the Park instant %s", sug.SuggestedEndedAt, park)
	}
	if sug.ContradictingEvidence.Field != "Gear" || sug.ContradictingEvidence.Value != enums.GearPark {
		t.Errorf("contradiction = %+v, want Gear=P", sug.ContradictingEvidence)
	}
}

func TestDiagnoseDrive_TransientParkFollowedByDrivingIsNotBoundary(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-6 * time.Hour)
	src := &fakeDiagnosis{
		drivingObs: []datarepairObs{
			driveTelemetryObs(testNow.Add(-5*time.Hour), "Gear", enums.GearDrive),
			driveTelemetryObs(testNow.Add(-4*time.Hour), "Gear", enums.GearDrive),
		},
		gearObs: []datarepairObs{
			driveTelemetryObs(testNow.Add(-4*time.Hour-30*time.Minute), "Gear", enums.GearPark),
		},
	}

	sug, err := newDiagnosisHandler(src).diagnoseDrive(
		context.Background(),
		candidate(1, 7, start, nil),
		testNow,
	)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("transient Park followed by newer driving evidence produced suggestion: %+v", sug)
	}
}

func TestDiagnoseDrive_ChargingStartWithoutInSessionEvidenceIsNotSuggested(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-6 * time.Hour)
	src := &fakeDiagnosis{
		chargeStarts: []sessionStart{{ts: testNow.Add(-4 * time.Hour), id: 900}},
	}

	sug, err := newDiagnosisHandler(src).diagnoseDrive(
		context.Background(),
		candidate(1, 7, start, nil),
		testNow,
	)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("cross-kind contradiction without in-session evidence produced suggestion: %+v", sug)
	}
}

func TestDiagnoseDrive_NoLaterContradiction(t *testing.T) {
	t.Parallel()

	// An open drive with nothing contradictory after it. Age alone is NEVER a
	// reason to close a session — the car may genuinely still be out.
	start := testNow.Add(-72 * time.Hour)
	src := &fakeDiagnosis{
		drivingObs: []datarepairObs{driveTelemetryObs(testNow.Add(-71*time.Hour), "Gear", enums.GearDrive)},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("expected no suggestion without contradictory evidence, got %+v", sug)
	}
}

func TestDiagnoseDrive_LiveVehicleIsNotSuggested(t *testing.T) {
	t.Parallel()

	// A contradiction exists and is old enough, but the car produced driving
	// telemetry a minute ago — closing it would truncate a live session.
	start := testNow.Add(-6 * time.Hour)
	src := &fakeDiagnosis{
		drivingObs: []datarepairObs{
			driveTelemetryObs(testNow.Add(-5*time.Hour), "Gear", enums.GearDrive),
			driveTelemetryObs(testNow.Add(-1*time.Minute), "VehicleSpeed", "18.0 m/s"),
		},
		chargeStarts: []sessionStart{{ts: testNow.Add(-4 * time.Hour), id: 900}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("expected no suggestion while the vehicle is live, got %+v", sug)
	}
}

func TestDiagnoseDrive_FreshContradictionIsNotSuggested(t *testing.T) {
	t.Parallel()

	// The contradiction landed 2 minutes ago — inside the settle window, where
	// a late-arriving telemetry batch could still reorder the picture.
	start := testNow.Add(-2 * time.Hour)
	src := &fakeDiagnosis{
		drivingObs:   []datarepairObs{driveTelemetryObs(testNow.Add(-90*time.Minute), "Gear", enums.GearDrive)},
		chargeStarts: []sessionStart{{ts: testNow.Add(-2 * time.Minute), id: 900}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("expected no suggestion for a contradiction inside the settle window, got %+v", sug)
	}
}

func TestDiagnoseDrive_ClosedDriveThatRanPastTheEvidence(t *testing.T) {
	t.Parallel()

	// The crash-recovery signature: the drive was closed at "last signal of any
	// kind", hours after a charging session had already started.
	start := testNow.Add(-30 * time.Hour)
	lastDriving := testNow.Add(-29 * time.Hour)
	chargeStart := testNow.Add(-28 * time.Hour)
	storedEnd := testNow.Add(-2 * time.Hour)

	src := &fakeDiagnosis{
		drivingObs:   []datarepairObs{driveTelemetryObs(lastDriving, "Gear", enums.GearDrive)},
		chargeStarts: []sessionStart{{ts: chargeStart, id: 900}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, timePtr(storedEnd)), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected a suggestion for a drive that ends after its contradiction")
	}
	if sug.Rule != systemmodel.SessionRepairRuleDriveEndAfterContradiction {
		t.Errorf("rule = %q, want %q", sug.Rule, systemmodel.SessionRepairRuleDriveEndAfterContradiction)
	}
	if sug.Confidence != systemmodel.SessionRepairConfidenceMedium {
		t.Errorf("confidence = %q, want medium for a rewrite of a closed row", sug.Confidence)
	}
	if sug.StoredEndedAt == nil || !sug.StoredEndedAt.Equal(storedEnd) {
		t.Errorf("stored_ended_at = %v, want %s", sug.StoredEndedAt, storedEnd)
	}
	if !sug.SuggestedEndedAt.Equal(lastDriving) {
		t.Errorf("suggested_ended_at = %s, want %s", sug.SuggestedEndedAt, lastDriving)
	}
}

func TestDiagnoseDrive_ClosedDriveWithinToleranceIsHealthy(t *testing.T) {
	t.Parallel()

	// Closed a minute after Park — the normal completion lag, not a defect.
	start := testNow.Add(-30 * time.Hour)
	park := testNow.Add(-28 * time.Hour)
	storedEnd := park.Add(time.Minute)

	src := &fakeDiagnosis{
		drivingObs: []datarepairObs{driveTelemetryObs(testNow.Add(-29*time.Hour), "Gear", enums.GearDrive)},
		gearObs:    []datarepairObs{driveTelemetryObs(park, "Gear", enums.GearPark)},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, timePtr(storedEnd)), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("expected no suggestion for a healthy closed drive, got %+v", sug)
	}
}

func TestDiagnoseDrive_EvidenceAfterNextDriveIsIgnored(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-6 * time.Hour)
	lastDriving := testNow.Add(-2 * time.Hour)
	chargeStart := testNow.Add(-90 * time.Minute)
	// Another drive row already starts before both observations. Neither
	// telemetry from that newer drive nor its later charge start belongs to
	// this older candidate.
	nextDrive := testNow.Add(-3 * time.Hour)

	src := &fakeDiagnosis{
		drivingObs:   []datarepairObs{driveTelemetryObs(lastDriving, "Gear", enums.GearDrive)},
		chargeStarts: []sessionStart{{ts: chargeStart, id: 900}},
		driveStarts:  []sessionStart{{ts: nextDrive, id: 55}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseDrive(context.Background(), candidate(1, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("evidence from after the next drive produced a suggestion: %+v", sug)
	}
}

func TestDiagnoseDrive_LaterSessionParkDoesNotCloseOlderDrive(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	nextDrive := testNow.Add(-4 * time.Hour)
	preNextPark := testNow.Add(-6 * time.Hour)
	src := &fakeDiagnosis{
		drivingObs: []datarepairObs{
			driveTelemetryObs(testNow.Add(-7*time.Hour), "Gear", enums.GearDrive),
			driveTelemetryObs(testNow.Add(-3*time.Hour), "Gear", enums.GearDrive),
		},
		gearObs: []datarepairObs{
			driveTelemetryObs(preNextPark, "Gear", enums.GearPark),
			driveTelemetryObs(testNow.Add(-2*time.Hour), "Gear", enums.GearPark),
		},
		driveStarts: []sessionStart{{ts: nextDrive, id: 55}},
	}

	sug, err := newDiagnosisHandler(src).diagnoseDrive(
		context.Background(),
		candidate(1, 7, start, timePtr(testNow.Add(-time.Hour))),
		testNow,
	)
	if err != nil {
		t.Fatalf("diagnoseDrive returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected the Park before the next drive to remain usable")
	}
	if !sug.SuggestedEndedAt.Equal(preNextPark) {
		t.Errorf("suggested_ended_at = %s, want pre-next-session Park %s", sug.SuggestedEndedAt, preNextPark)
	}
}

func TestDiagnoseCharging_OpenSessionWithChargeStopped(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	lastPower := testNow.Add(-6*time.Hour - 5*time.Minute)
	stopped := testNow.Add(-6 * time.Hour)

	src := &fakeDiagnosis{
		powerObs: []datarepairObs{chargingPowerObs(lastPower, 11000)},
		chargeStates: []datarepairObs{
			chargeStateObs(testNow.Add(-7*time.Hour), enums.ChargeStateCharging),
			chargeStateObs(stopped, enums.ChargeStateComplete),
		},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseCharging(context.Background(), candidate(3, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected a suggestion for an open charge contradicted by a Complete state")
	}
	if sug.Rule != systemmodel.SessionRepairRuleChargingOpenChargeEnded {
		t.Errorf("rule = %q, want %q", sug.Rule, systemmodel.SessionRepairRuleChargingOpenChargeEnded)
	}
	if sug.Confidence != systemmodel.SessionRepairConfidenceHigh {
		t.Errorf("confidence = %q, want high", sug.Confidence)
	}
	// A charge-state transition IS the durable boundary instant.
	if !sug.SuggestedEndedAt.Equal(stopped) {
		t.Errorf("suggested_ended_at = %s, want the transition instant %s", sug.SuggestedEndedAt, stopped)
	}
	if sug.LastInSessionEvidence == nil {
		t.Fatal("expected the last charging-power observation as in-session evidence")
	}
	if !sug.LastInSessionEvidence.Ts.Equal(testNow.Add(-7 * time.Hour)) {
		// The newest in-session evidence is the later of the power sample and
		// the last Charging state; here the Charging state at -7h is older than
		// the power sample at -6h05, so the power sample must win.
		if !sug.LastInSessionEvidence.Ts.Equal(lastPower) {
			t.Errorf("in-session evidence ts = %s, want %s", sug.LastInSessionEvidence.Ts, lastPower)
		}
	}
	if sug.Kind != systemmodel.SessionRepairKindCharging {
		t.Errorf("kind = %q, want charging", sug.Kind)
	}
}

func TestDiagnoseCharging_UnknownStateIsNotAContradiction(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	src := &fakeDiagnosis{
		powerObs: []datarepairObs{
			chargingPowerObs(testNow.Add(-7*time.Hour), 11000),
		},
		chargeStates: []datarepairObs{
			chargeStateObs(testNow.Add(-7*time.Hour), enums.ChargeStateCharging),
			chargeStateObs(testNow.Add(-6*time.Hour), "Unknown"),
		},
	}

	sug, err := newDiagnosisHandler(src).diagnoseCharging(
		context.Background(),
		candidate(3, 7, start, nil),
		testNow,
	)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("unknown charge state must not create a repair suggestion: %+v", sug)
	}
}

func TestDiagnoseCharging_OpenSessionWithDriveStarted(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	lastPower := testNow.Add(-7 * time.Hour)
	gearDrive := testNow.Add(-5 * time.Hour)

	src := &fakeDiagnosis{
		powerObs: []datarepairObs{chargingPowerObs(lastPower, 7000)},
		gearObs:  []datarepairObs{driveTelemetryObs(gearDrive, "Gear", enums.GearDrive)},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseCharging(context.Background(), candidate(3, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected a suggestion for an open charge contradicted by Gear=D")
	}
	if sug.Rule != systemmodel.SessionRepairRuleChargingOpenDriveStarted {
		t.Errorf("rule = %q, want %q", sug.Rule, systemmodel.SessionRepairRuleChargingOpenDriveStarted)
	}
	if sug.Confidence != systemmodel.SessionRepairConfidenceMedium {
		t.Errorf("confidence = %q, want medium", sug.Confidence)
	}
	// Gear=D only BOUNDS the charge; the proposal falls back to the newest
	// proof the session was still delivering energy.
	if !sug.SuggestedEndedAt.Equal(lastPower) {
		t.Errorf("suggested_ended_at = %s, want %s", sug.SuggestedEndedAt, lastPower)
	}
	if want := int64(2 * 3600); sug.EvidenceGapS != want {
		t.Errorf("evidence_gap_s = %d, want %d", sug.EvidenceGapS, want)
	}
}

func TestDiagnoseCharging_DriveStartWithoutInSessionEvidenceIsNotSuggested(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	src := &fakeDiagnosis{
		gearObs: []datarepairObs{
			driveTelemetryObs(testNow.Add(-5*time.Hour), "Gear", enums.GearDrive),
		},
	}

	sug, err := newDiagnosisHandler(src).diagnoseCharging(
		context.Background(),
		candidate(3, 7, start, nil),
		testNow,
	)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("cross-kind contradiction without in-session evidence produced suggestion: %+v", sug)
	}
}

func TestDiagnoseCharging_LiveChargingIsNotSuggested(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-8 * time.Hour)
	src := &fakeDiagnosis{
		powerObs: []datarepairObs{
			chargingPowerObs(testNow.Add(-7*time.Hour), 7000),
			chargingPowerObs(testNow.Add(-2*time.Minute), 7000),
		},
		gearObs: []datarepairObs{driveTelemetryObs(testNow.Add(-5*time.Hour), "Gear", enums.GearDrive)},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseCharging(context.Background(), candidate(3, 7, start, nil), testNow)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("expected no suggestion while the session is live, got %+v", sug)
	}
	if src.liveChargeChecks == 0 {
		t.Error("the live-charging guard was never consulted")
	}
}

func TestDiagnoseCharging_ClosedSessionThatRanPastTheEvidence(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-40 * time.Hour)
	lastPower := testNow.Add(-38 * time.Hour)
	driveStart := testNow.Add(-36 * time.Hour)
	storedEnd := testNow.Add(-10 * time.Hour)

	src := &fakeDiagnosis{
		powerObs:    []datarepairObs{chargingPowerObs(lastPower, 7000)},
		driveStarts: []sessionStart{{ts: driveStart, id: 77}},
	}
	h := newDiagnosisHandler(src)

	sug, err := h.diagnoseCharging(context.Background(), candidate(3, 7, start, timePtr(storedEnd)), testNow)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug == nil {
		t.Fatal("expected a suggestion for a charge that ends after its contradiction")
	}
	if sug.Rule != systemmodel.SessionRepairRuleChargingEndAfterContradiction {
		t.Errorf("rule = %q, want %q", sug.Rule, systemmodel.SessionRepairRuleChargingEndAfterContradiction)
	}
	if !sug.SuggestedEndedAt.Equal(lastPower) {
		t.Errorf("suggested_ended_at = %s, want %s", sug.SuggestedEndedAt, lastPower)
	}
}

func TestDiagnoseCharging_EvidenceAfterNextChargeIsIgnored(t *testing.T) {
	t.Parallel()

	start := testNow.Add(-10 * time.Hour)
	nextCharge := testNow.Add(-5 * time.Hour)
	src := &fakeDiagnosis{
		chargeStarts: []sessionStart{{ts: nextCharge, id: 44}},
		chargeStates: []datarepairObs{
			chargeStateObs(testNow.Add(-4*time.Hour), enums.ChargeStateComplete),
		},
		driveStarts: []sessionStart{{ts: testNow.Add(-3 * time.Hour), id: 77}},
		powerObs: []datarepairObs{
			chargingPowerObs(testNow.Add(-8*time.Hour), 7000),
			chargingPowerObs(testNow.Add(-4*time.Hour), 11000),
		},
	}

	sug, err := newDiagnosisHandler(src).diagnoseCharging(
		context.Background(),
		candidate(3, 7, start, nil),
		testNow,
	)
	if err != nil {
		t.Fatalf("diagnoseCharging returned error: %v", err)
	}
	if sug != nil {
		t.Fatalf("evidence from after the next charge produced a suggestion: %+v", sug)
	}
}

// ---- GET /data-repair/suggestions ----------------------------------------

func TestGetSuggestions_HappyPath(t *testing.T) {
	t.Parallel()

	driveStart := testNow.Add(-6 * time.Hour)
	src := &fakeDiagnosis{
		openDrives:   []datarepairCandidate{candidate(1, 7, driveStart, nil)},
		drivingObs:   []datarepairObs{driveTelemetryObs(testNow.Add(-5*time.Hour), "Gear", enums.GearDrive)},
		chargeStarts: []sessionStart{{ts: testNow.Add(-4 * time.Hour), id: 900}},
		openCharges:  []datarepairCandidate{candidate(3, 7, testNow.Add(-8*time.Hour), nil)},
		powerObs:     []datarepairObs{chargingPowerObs(testNow.Add(-7*time.Hour), 11000)},
		chargeStates: []datarepairObs{chargeStateObs(testNow.Add(-6*time.Hour), enums.ChargeStateComplete)},
	}
	h := newDiagnosisHandler(src)

	rec := doReq(t, h, http.MethodGet, "/data-repair/suggestions", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200. body=%s", rec.Code, rec.Body.String())
	}

	var report systemmodel.SessionRepairReport
	if err := json.Unmarshal(rec.Body.Bytes(), &report); err != nil {
		t.Fatalf("decode report: %v", err)
	}
	if report.LookbackDays != defaultLookbackDays {
		t.Errorf("lookback_days = %d, want %d", report.LookbackDays, defaultLookbackDays)
	}
	if len(report.DriveSuggestions) != 1 {
		t.Fatalf("drive suggestions = %d, want 1", len(report.DriveSuggestions))
	}
	if len(report.ChargingSuggestions) != 1 {
		t.Fatalf("charging suggestions = %d, want 1", len(report.ChargingSuggestions))
	}
	if report.ScannedDrives != 1 || report.ScannedChargingSessions != 1 {
		t.Errorf("scanned = (%d, %d), want (1, 1)", report.ScannedDrives, report.ScannedChargingSessions)
	}
	if !report.GeneratedAt.Equal(testNow) {
		t.Errorf("generated_at = %s, want %s", report.GeneratedAt, testNow)
	}
}

func TestGetSuggestions_EmptyListsSerializeAsArrays(t *testing.T) {
	t.Parallel()

	h := newDiagnosisHandler(&fakeDiagnosis{})
	rec := doReq(t, h, http.MethodGet, "/data-repair/suggestions", nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", rec.Code)
	}
	var raw map[string]json.RawMessage
	if err := json.Unmarshal(rec.Body.Bytes(), &raw); err != nil {
		t.Fatalf("decode: %v", err)
	}
	for _, key := range []string{"drive_suggestions", "charging_suggestions"} {
		if string(raw[key]) != "[]" {
			t.Errorf("%s = %s, want [] (never null — the UI iterates it directly)", key, raw[key])
		}
	}
}

func TestGetSuggestions_NoDiagnosisSourceIs503(t *testing.T) {
	t.Parallel()

	// A handler without an evidence source must NOT report an empty worklist:
	// that would read as "your data is clean" when nothing was inspected.
	h := newTestHandler(&fakeChargingRepo{}, &fakeDriveRepo{})
	h.diagnosis = nil
	rec := doReq(t, h, http.MethodGet, "/data-repair/suggestions", nil)
	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status = %d, want 503. body=%s", rec.Code, rec.Body.String())
	}
}

func TestGetSuggestions_ParamValidation(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name       string
		query      string
		wantStatus int
	}{
		{"bad vehicle_id", "?vehicle_id=abc", http.StatusBadRequest},
		{"zero vehicle_id", "?vehicle_id=0", http.StatusBadRequest},
		{"negative lookback", "?lookback_days=-1", http.StatusBadRequest},
		{"bad limit", "?limit=x", http.StatusBadRequest},
		{"valid scope", "?vehicle_id=7&lookback_days=7&limit=5", http.StatusOK},
		{"over-cap lookback clamps", "?lookback_days=99999", http.StatusOK},
	}
	for _, tc := range tests {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			h := newDiagnosisHandler(&fakeDiagnosis{})
			rec := doReq(t, h, http.MethodGet, "/data-repair/suggestions"+tc.query, nil)
			if rec.Code != tc.wantStatus {
				t.Fatalf("status = %d, want %d. body=%s", rec.Code, tc.wantStatus, rec.Body.String())
			}
		})
	}
}

func TestGetSuggestions_RepoErrorIs500(t *testing.T) {
	t.Parallel()

	h := newDiagnosisHandler(&fakeDiagnosis{listErr: errBoom})
	rec := doReq(t, h, http.MethodGet, "/data-repair/suggestions", nil)
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d, want 500", rec.Code)
	}
	if got := bodyError(t, rec); got != "failed to build repair suggestions" {
		t.Errorf("error = %q", got)
	}
}
