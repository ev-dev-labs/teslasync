// Package actioncenter declares persistence ports consumed by actioncentersvc.
package actioncenter

import (
	"context"
	"errors"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain/actioncenter"
)

var (
	ErrStateConflict = errors.New("action center state conflict")
	ErrNotFound      = errors.New("action center recommendation not found")
)

type SourceReader interface {
	ListActiveAlerts(ctx context.Context, vehicleID *int64, since time.Time, limit int) ([]actioncenter.AlertRecord, error)
	ListStaleChargingSessions(ctx context.Context, vehicleID *int64, cutoff time.Time, limit int) ([]actioncenter.ChargingRecord, error)
	ListActiveWorkOrders(ctx context.Context, vehicleID *int64, limit int) ([]actioncenter.WorkOrderRecord, error)
	ListSignalHealth(ctx context.Context, vehicleID *int64, from, to time.Time, limit int) ([]actioncenter.SignalHealthRecord, error)
}

type TransitionRequest struct {
	Subject          string
	RecommendationID string
	Fingerprint      string
	Action           actioncenter.ActionType
	AllowedFrom      []actioncenter.State
	ToState          actioncenter.State
	ExpectedVersion  int
	SnoozedUntil     *time.Time
	Now              time.Time
}

type StateRepository interface {
	ListStates(ctx context.Context, subject string, recommendationIDs []string) (map[string]actioncenter.CurrentState, error)
	ListRecentEvents(ctx context.Context, subject string, recommendationIDs []string, perRecommendation int) (map[string][]actioncenter.ActionEvent, error)
	Transition(ctx context.Context, request TransitionRequest) (*actioncenter.CurrentState, *actioncenter.ActionEvent, error)
	ListHistory(ctx context.Context, subject, recommendationID string, limit, offset int) (*actioncenter.HistoryPage, error)
}
