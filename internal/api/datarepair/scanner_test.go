package datarepair

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
)

type fakeScanCaseRepository struct {
	upserted       []systemmodel.RepairCase
	insertedByRule map[string]bool
	finished       ScanResult
	failureReason  *string
}

func (f *fakeScanCaseRepository) StartScanRun(
	_ context.Context,
	trigger systemmodel.RepairScanTrigger,
	vehicleID *int64,
	initiatedBy string,
) (*systemmodel.RepairScanRun, error) {
	return &systemmodel.RepairScanRun{
		ID:          17,
		Trigger:     trigger,
		Status:      systemmodel.RepairScanStatusRunning,
		VehicleID:   vehicleID,
		InitiatedBy: initiatedBy,
		StartedAt:   time.Now().UTC(),
	}, nil
}

func (f *fakeScanCaseRepository) FinishScanRun(
	_ context.Context,
	runID int64,
	status systemmodel.RepairScanStatus,
	discovered, refreshed int,
	truncated bool,
	failureReason *string,
) error {
	f.finished = ScanResult{
		RunID:      runID,
		Status:     status,
		Discovered: discovered,
		Refreshed:  refreshed,
		Truncated:  truncated,
	}
	f.failureReason = failureReason
	return nil
}

func (f *fakeScanCaseRepository) UpsertCaseWithOutcome(
	_ context.Context,
	_ database.DBTX,
	repairCase *systemmodel.RepairCase,
) (int64, bool, error) {
	f.upserted = append(f.upserted, *repairCase)
	return int64(len(f.upserted)), f.insertedByRule[repairCase.Rule], nil
}

type fakeScanAnomalySource struct {
	result datarepairdb.AnomalyScanResult
	err    error
}

func (f fakeScanAnomalySource) ListSessionAnomalies(
	context.Context,
	time.Time,
	*int64,
	int,
) (datarepairdb.AnomalyScanResult, error) {
	return f.result, f.err
}

func acquiredScanLock(_ context.Context, fn func(database.DBTX) error) (bool, error) {
	return true, fn(nil)
}

func TestScannerScanMaterializesSuggestionsAndAnomalies(t *testing.T) {
	t.Parallel()

	now := time.Date(2026, time.August, 25, 10, 0, 0, 0, time.UTC)
	contradiction := now.Add(-time.Hour)
	suggested := contradiction.Add(-time.Minute)
	started := suggested.Add(-20 * time.Minute)
	negative := -42.5

	cases := &fakeScanCaseRepository{
		insertedByRule: map[string]bool{
			string(systemmodel.SessionRepairRuleDriveOpenParkObserved): true,
			datarepairdb.RuleNegativeEnergyAddedWh:                     false,
		},
	}
	scanner := &Scanner{
		cases: cases,
		sourceFactory: func(database.DBTX) (scanReportBuilder, scanAnomalySource) {
			return func(context.Context, diagnosisOptions) (*systemmodel.SessionRepairReport, error) {
					return &systemmodel.SessionRepairReport{
						DriveSuggestions: []systemmodel.SessionRepairSuggestion{{
							Kind:       systemmodel.SessionRepairKindDrive,
							SessionID:  11,
							VehicleID:  3,
							Rule:       systemmodel.SessionRepairRuleDriveOpenParkObserved,
							Confidence: systemmodel.SessionRepairConfidenceHigh,
							StartedAt:  started,
							ContradictingEvidence: systemmodel.SessionRepairEvidence{
								Ts:     contradiction,
								Source: systemmodel.SessionRepairSourceDriveTelemetry,
								Field:  "gear",
								Value:  "P",
							},
							SuggestedEndedAt: suggested,
							EvidenceGapS:     60,
							Applicable:       true,
						}},
						ChargingSuggestions: []systemmodel.SessionRepairSuggestion{},
					}, nil
				}, fakeScanAnomalySource{result: datarepairdb.AnomalyScanResult{
					Truncated: true,
					Anomalies: []datarepairdb.Anomaly{{
						Kind:       datarepairdb.AnomalyKindCharging,
						Rule:       datarepairdb.RuleNegativeEnergyAddedWh,
						Confidence: datarepairdb.AnomalyConfidenceHigh,
						VehicleID:  3,
						SessionID:  29,
						StartedAt:  started,
						EndedAt:    &contradiction,
						Facts: datarepairdb.AnomalyFacts{
							NegativeField: "total_energy_added_wh",
							NegativeValue: &negative,
						},
					}},
				}}
		},
		withLock: acquiredScanLock,
		now:      func() time.Time { return now },
		timeout:  time.Second,
	}

	result, err := scanner.Scan(context.Background(), ScanOptions{
		Trigger:     systemmodel.RepairScanTriggerManual,
		InitiatedBy: "operator",
	})
	if err != nil {
		t.Fatalf("Scan() error = %v", err)
	}
	if result.Status != systemmodel.RepairScanStatusCompleted ||
		result.Discovered != 1 ||
		result.Refreshed != 1 ||
		!result.Truncated {
		t.Fatalf("Scan() result = %+v", result)
	}
	if cases.finished != result {
		t.Fatalf("finished run = %+v, want %+v", cases.finished, result)
	}
	if len(cases.upserted) != 2 {
		t.Fatalf("upserted cases = %d, want 2", len(cases.upserted))
	}
	if !cases.upserted[0].Applicable || cases.upserted[0].SuggestedEndedAt == nil {
		t.Fatalf("suggestion case was not materialized as applicable: %+v", cases.upserted[0])
	}
	anomaly := cases.upserted[1]
	if anomaly.Applicable || anomaly.BlockedReason == nil ||
		*anomaly.BlockedReason != structuralAnomalyBlockedReason {
		t.Fatalf("anomaly case was not safely blocked: %+v", anomaly)
	}
	if anomaly.EvidenceContradictionField != "total_energy_added_wh" ||
		anomaly.EvidenceContradictionValue != "-42.5" {
		t.Fatalf("anomaly evidence = %s:%s", anomaly.EvidenceContradictionField, anomaly.EvidenceContradictionValue)
	}
}

func TestScannerScanRecordsSkippedRunWhenLockIsHeld(t *testing.T) {
	t.Parallel()

	cases := &fakeScanCaseRepository{insertedByRule: map[string]bool{}}
	reportCalled := false
	scanner := &Scanner{
		cases: cases,
		sourceFactory: func(database.DBTX) (scanReportBuilder, scanAnomalySource) {
			return func(context.Context, diagnosisOptions) (*systemmodel.SessionRepairReport, error) {
				reportCalled = true
				return nil, nil
			}, fakeScanAnomalySource{}
		},
		withLock: func(context.Context, func(database.DBTX) error) (bool, error) {
			return false, nil
		},
		timeout: time.Second,
	}

	result, err := scanner.Scan(context.Background(), ScanOptions{
		Trigger: systemmodel.RepairScanTriggerScheduled,
	})
	if !errors.Is(err, ErrScanAlreadyRunning) {
		t.Fatalf("Scan() error = %v, want ErrScanAlreadyRunning", err)
	}
	if reportCalled {
		t.Fatal("report builder ran without the advisory lock")
	}
	if result.Status != systemmodel.RepairScanStatusSkipped ||
		cases.finished.Status != systemmodel.RepairScanStatusSkipped {
		t.Fatalf("result=%+v finished=%+v", result, cases.finished)
	}
	if cases.failureReason != nil {
		t.Fatalf("skipped scan failure reason = %q, want nil", *cases.failureReason)
	}
}

func TestScannerScanRecordsFailure(t *testing.T) {
	t.Parallel()

	cases := &fakeScanCaseRepository{insertedByRule: map[string]bool{}}
	scanner := &Scanner{
		cases: cases,
		sourceFactory: func(database.DBTX) (scanReportBuilder, scanAnomalySource) {
			return func(context.Context, diagnosisOptions) (*systemmodel.SessionRepairReport, error) {
				return nil, errors.New("diagnosis unavailable")
			}, fakeScanAnomalySource{}
		},
		withLock: acquiredScanLock,
		timeout:  time.Second,
	}

	result, err := scanner.Scan(context.Background(), ScanOptions{
		Trigger:     systemmodel.RepairScanTriggerManual,
		InitiatedBy: "\x00",
	})
	if err == nil {
		t.Fatal("Scan() error = nil, want failure")
	}
	if result.Status != systemmodel.RepairScanStatusFailed ||
		cases.finished.Status != systemmodel.RepairScanStatusFailed {
		t.Fatalf("result=%+v finished=%+v", result, cases.finished)
	}
	if cases.failureReason == nil || *cases.failureReason == "" {
		t.Fatal("failed scan did not persist a failure reason")
	}
}
