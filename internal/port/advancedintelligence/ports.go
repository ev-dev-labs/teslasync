// Package advancedintelligence declares focused ports used by the advanced
// intelligence application services.
package advancedintelligence

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/advancedintelligence"
)

var (
	ErrConflict               = errors.New("advanced intelligence version conflict")
	ErrPrivacyBudgetExhausted = errors.New("federated privacy budget exhausted")
)

type CalibrationReader interface {
	Calibration(ctx context.Context, vehicleID int64, from, to time.Time) (*domain.CalibrationEvidence, error)
}

type FirmwareReader interface {
	FirmwareWindow(ctx context.Context, vehicleID int64, asOf time.Time) (*domain.FirmwareWindowEvidence, error)
}

type SurvivalReader interface {
	Survival(ctx context.Context, vehicleID int64, from, to time.Time) (*domain.SurvivalEvidence, error)
}

type HazardReader interface {
	ListHazardEvidence(ctx context.Context, vehicleID int64, from, to time.Time, limit, offset int) ([]domain.HazardEvidence, int, error)
}

type SentinelReader interface {
	Sentinel(ctx context.Context, vehicleID int64, from, to time.Time) (*domain.SentinelEvidence, error)
}

type ChargingForensicsReader interface {
	ListChargingEvidence(ctx context.Context, vehicleID int64, limit, offset int) ([]domain.ChargingSessionEvidence, int, error)
}

type ReadinessReader interface {
	Readiness(ctx context.Context, vehicleID int64, from, to time.Time) (*domain.ReadinessEvidence, error)
}

type LocalTrainingReader interface {
	LocalTrainingAggregate(ctx context.Context, vehicleID int64, from, to time.Time) (*domain.LocalTrainingAggregate, error)
}

type CausalMetricReader interface {
	MetricWindow(ctx context.Context, vehicleID int64, metric domain.CausalMetric, from, to time.Time) (*domain.MetricWindowEvidence, error)
}

type TCOReader interface {
	TCO(ctx context.Context, vehicleID int64, currency string, from, to time.Time) (*domain.TCOEvidence, error)
}

type SourceRepository interface {
	CalibrationReader
	FirmwareReader
	SurvivalReader
	HazardReader
	SentinelReader
	ChargingForensicsReader
	ReadinessReader
	LocalTrainingReader
	CausalMetricReader
	TCOReader
}

type CreateRoundParams struct {
	Subject           string
	VehicleID         int64
	ModelName         string
	ModelVersion      string
	Task              string
	Epsilon           float64
	EpsilonBudget     float64
	ExpectedVersion   int
	SampleCount       int
	LocalMetricWhPerM *float64
	Status            string
	Now               time.Time
}

type CreateExperimentParams struct {
	Subject    string
	Experiment CausalExperimentRecord
	Result     CausalResultRecord
}

type DurableRepository interface {
	ListModelCards(ctx context.Context, subject string, vehicleID int64, limit, offset int) ([]FederatedModelCardRecord, int, float64, float64, error)
	CreateRound(ctx context.Context, params CreateRoundParams) (*FederatedModelCardRecord, *FederatedRoundRecord, error)
	ListExperiments(ctx context.Context, subject string, vehicleID int64, limit, offset int) ([]CausalExperimentRecord, []CausalResultRecord, int, error)
	CreateExperiment(ctx context.Context, params CreateExperimentParams) (*CausalExperimentRecord, *CausalResultRecord, error)
}
