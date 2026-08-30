package datarepair

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/ev-dev-labs/teslasync/internal/database"
	datarepairdb "github.com/ev-dev-labs/teslasync/internal/database/datarepair"
	"github.com/ev-dev-labs/teslasync/internal/metrics"
	systemmodel "github.com/ev-dev-labs/teslasync/internal/models/system"
	"github.com/jackc/pgx/v5"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"
)

const (
	dataRepairScannerTracerName       = "internal/api/datarepair/scanner"
	dataRepairScanLockID        int64 = 0x5453524550414952
	defaultScanTimeout                = 90 * time.Second
	defaultScanLookbackDays           = maxLookbackDays
	defaultScanCandidateLimit         = 100
	defaultScanAnomalyLimit           = 500
	maxScanActorChars                 = 255
	maxScanFailureChars               = 500
)

// ErrScanAlreadyRunning reports that another pod or operator currently owns
// the cluster-wide data-repair scan lock.
var ErrScanAlreadyRunning = errors.New("data-repair scan already running")

type scanCaseRepository interface {
	StartScanRun(context.Context, systemmodel.RepairScanTrigger, *int64, string) (*systemmodel.RepairScanRun, error)
	FinishScanRun(context.Context, int64, systemmodel.RepairScanStatus, int, int, bool, *string) error
	UpsertCaseWithOutcome(context.Context, database.DBTX, *systemmodel.RepairCase) (int64, bool, error)
}

type scanAnomalySource interface {
	ListSessionAnomalies(context.Context, time.Time, *int64, int) (datarepairdb.AnomalyScanResult, error)
}

type scanReportBuilder func(context.Context, diagnosisOptions) (*systemmodel.SessionRepairReport, error)
type scanSourceFactory func(database.DBTX) (scanReportBuilder, scanAnomalySource)
type scanLockRunner func(context.Context, func(database.DBTX) error) (bool, error)

// ScanOptions scopes one bounded integrity scan.
type ScanOptions struct {
	Trigger     systemmodel.RepairScanTrigger
	VehicleID   *int64
	InitiatedBy string
}

// ScanResult is the durable outcome returned to manual callers and logged by
// the scheduled worker.
type ScanResult struct {
	RunID      int64                        `json:"run_id"`
	Status     systemmodel.RepairScanStatus `json:"status"`
	Discovered int                          `json:"discovered"`
	Refreshed  int                          `json:"refreshed"`
	Truncated  bool                         `json:"truncated"`
}

// Scanner discovers evidence-backed boundary repairs and structural
// anomalies, then materializes them as durable cases. It never mutates source
// drive or charging rows.
type Scanner struct {
	cases         scanCaseRepository
	sourceFactory scanSourceFactory
	withLock      scanLockRunner
	now           clockFunc
	timeout       time.Duration
}

// NewScanner constructs the shared scanner used by both the HTTP trigger and
// the lifecycle-bound scheduled worker.
func NewScanner(db *database.DB) *Scanner {
	if db == nil {
		return &Scanner{}
	}
	return &Scanner{
		cases: datarepairdb.NewCaseRepo(db),
		sourceFactory: func(tx database.DBTX) (scanReportBuilder, scanAnomalySource) {
			diagnosisRepo := datarepairdb.NewRepoWithDBTX(tx)
			diagnoser := &DataRepairHandler{diagnosis: diagnosisRepo}
			return diagnoser.buildReport, diagnosisRepo
		},
		withLock: func(ctx context.Context, fn func(database.DBTX) error) (bool, error) {
			acquired := false
			err := db.WithTx(ctx, func(tx pgx.Tx) error {
				if err := tx.QueryRow(ctx, "SELECT pg_try_advisory_xact_lock($1)", dataRepairScanLockID).
					Scan(&acquired); err != nil {
					return fmt.Errorf("acquire data-repair scan lock: %w", err)
				}
				if !acquired {
					return nil
				}
				return fn(tx)
			})
			return acquired, err
		},
		timeout: defaultScanTimeout,
	}
}

// Scan runs one bounded discovery pass under a transaction-scoped PostgreSQL
// advisory lock. The scan run is finalized even when the caller times out.
func (s *Scanner) Scan(ctx context.Context, opts ScanOptions) (result ScanResult, err error) {
	if err := s.validate(opts); err != nil {
		return result, err
	}
	trigger := string(opts.Trigger)
	started := time.Now()
	scanCtx, cancel := context.WithTimeout(ctx, s.scanTimeout())
	defer cancel()
	scanCtx, span := otel.Tracer(dataRepairScannerTracerName).Start(
		scanCtx,
		"data_repair.scan",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal),
		oteltrace.WithAttributes(attribute.String("data_repair.trigger", trigger)),
	)
	defer func() {
		metrics.DataRepairScanDurationSeconds.WithLabelValues(trigger).Observe(time.Since(started).Seconds())
		span.SetAttributes(
			attribute.Int("data_repair.discovered", result.Discovered),
			attribute.Int("data_repair.refreshed", result.Refreshed),
			attribute.Bool("data_repair.truncated", result.Truncated),
			attribute.String("data_repair.status", string(result.Status)),
		)
		if err != nil && !errors.Is(err, ErrScanAlreadyRunning) {
			span.RecordError(err)
			span.SetStatus(codes.Error, "data-repair scan failed")
		}
		span.End()
	}()

	run, err := s.cases.StartScanRun(
		scanCtx,
		opts.Trigger,
		opts.VehicleID,
		normalizeScanActor(opts.InitiatedBy, opts.Trigger),
	)
	if err != nil {
		result.Status = systemmodel.RepairScanStatusFailed
		metrics.DataRepairScansTotal.WithLabelValues(trigger, string(systemmodel.RepairScanStatusFailed)).Inc()
		return result, fmt.Errorf("start data-repair scan: %w", err)
	}
	result.RunID = run.ID

	findingCounts := make(map[string]int)
	var (
		discovered int
		refreshed  int
		truncated  bool
	)
	acquired, scanErr := s.withLock(scanCtx, func(tx database.DBTX) error {
		buildReport, anomalies := s.sourceFactory(tx)
		report, reportErr := buildReport(scanCtx, diagnosisOptions{
			vehicleID:    opts.VehicleID,
			lookbackDays: defaultScanLookbackDays,
			limit:        defaultScanCandidateLimit,
		})
		if reportErr != nil {
			return fmt.Errorf("build repair diagnosis: %w", reportErr)
		}
		anomalyResult, anomalyErr := anomalies.ListSessionAnomalies(
			scanCtx,
			s.currentTime().AddDate(0, 0, -defaultScanLookbackDays),
			opts.VehicleID,
			defaultScanAnomalyLimit,
		)
		if anomalyErr != nil {
			return fmt.Errorf("scan structural anomalies: %w", anomalyErr)
		}
		truncated = report.Truncated || anomalyResult.Truncated

		cases := materializedCases(report, anomalyResult.Anomalies)
		for i := range cases {
			_, inserted, upsertErr := s.cases.UpsertCaseWithOutcome(scanCtx, tx, &cases[i])
			if upsertErr != nil {
				return fmt.Errorf("materialize %s case for session %d: %w", cases[i].Rule, cases[i].SessionID, upsertErr)
			}
			if inserted {
				discovered++
			} else {
				refreshed++
			}
			findingCounts[string(cases[i].Kind)+"\x00"+cases[i].Rule]++
		}
		return nil
	})
	if scanErr == nil && acquired {
		result.Discovered = discovered
		result.Refreshed = refreshed
		result.Truncated = truncated
	}

	switch {
	case scanErr != nil:
		result.Status = systemmodel.RepairScanStatusFailed
		finishErr := s.finishRun(ctx, result, scanErr)
		metrics.DataRepairScansTotal.WithLabelValues(trigger, string(result.Status)).Inc()
		if finishErr != nil {
			return result, errors.Join(scanErr, finishErr)
		}
		return result, scanErr
	case !acquired:
		result.Status = systemmodel.RepairScanStatusSkipped
		if finishErr := s.finishRun(ctx, result, nil); finishErr != nil {
			result.Status = systemmodel.RepairScanStatusFailed
			metrics.DataRepairScansTotal.WithLabelValues(trigger, string(systemmodel.RepairScanStatusFailed)).Inc()
			return result, finishErr
		}
		metrics.DataRepairScansTotal.WithLabelValues(trigger, string(result.Status)).Inc()
		return result, ErrScanAlreadyRunning
	default:
		result.Status = systemmodel.RepairScanStatusCompleted
		if finishErr := s.finishRun(ctx, result, nil); finishErr != nil {
			result.Status = systemmodel.RepairScanStatusFailed
			metrics.DataRepairScansTotal.WithLabelValues(trigger, string(systemmodel.RepairScanStatusFailed)).Inc()
			return result, finishErr
		}
		for key, count := range findingCounts {
			kind, rule, _ := strings.Cut(key, "\x00")
			metrics.DataRepairFindingsTotal.WithLabelValues(kind, rule).Add(float64(count))
		}
		metrics.DataRepairScansTotal.WithLabelValues(trigger, string(result.Status)).Inc()
		return result, nil
	}
}

func (s *Scanner) validate(opts ScanOptions) error {
	if s == nil || s.cases == nil || s.sourceFactory == nil || s.withLock == nil {
		return errors.New("data-repair scanner is unavailable")
	}
	if !opts.Trigger.IsValid() {
		return errors.New("data-repair scan trigger is invalid")
	}
	if opts.VehicleID != nil && *opts.VehicleID <= 0 {
		return errors.New("vehicle_id must be a positive integer")
	}
	return nil
}

func (s *Scanner) scanTimeout() time.Duration {
	if s.timeout > 0 {
		return s.timeout
	}
	return defaultScanTimeout
}

func (s *Scanner) currentTime() time.Time {
	if s.now != nil {
		return s.now().UTC()
	}
	return time.Now().UTC()
}

func (s *Scanner) finishRun(ctx context.Context, result ScanResult, scanErr error) error {
	finishCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	var reason *string
	if scanErr != nil {
		value := boundedScanText(scanErr.Error(), maxScanFailureChars)
		reason = &value
	}
	if err := s.cases.FinishScanRun(
		finishCtx,
		result.RunID,
		result.Status,
		result.Discovered,
		result.Refreshed,
		result.Truncated,
		reason,
	); err != nil {
		return fmt.Errorf("finish data-repair scan run: %w", err)
	}
	return nil
}

func normalizeScanActor(actor string, trigger systemmodel.RepairScanTrigger) string {
	actor = boundedScanText(strings.TrimSpace(actor), maxScanActorChars)
	if actor != "" {
		return actor
	}
	if trigger == systemmodel.RepairScanTriggerScheduled {
		return "system"
	}
	return "anonymous"
}

func boundedScanText(value string, maxChars int) string {
	value = strings.ReplaceAll(value, "\x00", "")
	if utf8.RuneCountInString(value) <= maxChars {
		return value
	}
	runes := []rune(value)
	return string(runes[:maxChars])
}

func materializedCases(
	report *systemmodel.SessionRepairReport,
	anomalies []datarepairdb.Anomaly,
) []systemmodel.RepairCase {
	size := len(anomalies)
	if report != nil {
		size += len(report.DriveSuggestions) + len(report.ChargingSuggestions)
	}
	cases := make([]systemmodel.RepairCase, 0, size)
	if report != nil {
		for _, suggestion := range report.DriveSuggestions {
			cases = append(cases, suggestionCase(suggestion))
		}
		for _, suggestion := range report.ChargingSuggestions {
			cases = append(cases, suggestionCase(suggestion))
		}
	}
	for _, anomaly := range anomalies {
		cases = append(cases, anomalyCase(anomaly))
	}
	return cases
}
