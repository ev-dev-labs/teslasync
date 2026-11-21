package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrServiceCaseChanged = errors.New("private service case changed")
var ErrServiceCaseFull = errors.New("private service case evidence limit reached")

type ServiceCaseScope struct {
	Subject   string
	VehicleID int64
}

type ServiceCaseKey struct {
	ID      int64 `json:"expected_case_id"`
	Version int64 `json:"expected_version"`
}

type ServiceCaseCandidate struct {
	ID          int64
	VehicleID   int64
	VehicleName string
	UpdatedAt   time.Time
}

type ServiceCaseRepository interface {
	ReadServiceCase(context.Context, ServiceCaseScope) (domain.ServiceCase, error)
	SaveServiceCaseTitle(context.Context, ServiceCaseScope, ServiceCaseKey, string, time.Time) error
	DeleteServiceCase(context.Context, ServiceCaseScope, ServiceCaseKey) error
	AppendServiceCaseEvidence(context.Context, ServiceCaseScope, ServiceCaseKey, domain.ServiceCaseEvidence, time.Time) error
	DeleteServiceCaseEvidence(context.Context, ServiceCaseScope, ServiceCaseKey, int64, time.Time) error
	ListServiceCaseCandidates(context.Context, string, *int64, time.Time, int) ([]ServiceCaseCandidate, error)
}
