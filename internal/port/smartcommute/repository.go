// Package smartcommute declares the persistence boundary for private routines.
package smartcommute

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

var (
	ErrNotFound      = errors.New("smart commute resource not found")
	ErrDisabled      = errors.New("smart commute or local analysis is disabled")
	ErrTooManyDrives = errors.New("drive history exceeds the analysis limit")
)

type RefreshedSuggestion struct {
	ID      int64
	Learned domain.LearnedRoutine
}

type Analysis struct {
	New       []domain.LearnedRoutine
	Refreshed []RefreshedSuggestion
}

// Learner is called inside the consent-locked transaction, after bounded
// observations and existing subject-owned decisions have been loaded.
type Learner func([]domain.DriveObservation, []domain.Routine, time.Time, *time.Location) Analysis

type Repository interface {
	TrafficRepository
	Read(ctx context.Context, subject string, vehicleID int64, now time.Time) (*domain.Snapshot, error)
	SaveSettings(ctx context.Context, subject string, settings domain.Settings, now time.Time, learner Learner) error
	Analyze(ctx context.Context, subject string, vehicleID int64, now time.Time, learner Learner) error
	CreateRoutine(ctx context.Context, subject string, input domain.RoutineInput, now time.Time) (*domain.Routine, error)
	ConfirmRoutine(ctx context.Context, subject string, routineID int64, input domain.RoutineInput, now time.Time) (*domain.Routine, error)
	DeclineRoutine(ctx context.Context, subject string, vehicleID, routineID int64, now time.Time) error
	SnoozeRoutine(ctx context.Context, subject string, vehicleID, routineID int64, until *time.Time, now time.Time) error
	DeleteRoutine(ctx context.Context, subject string, vehicleID, routineID int64) error
	DeleteAll(ctx context.Context, subject string, vehicleID int64) error
	ListSuggestions(ctx context.Context, subject string, vehicleID *int64, now time.Time, limit int) ([]domain.SuggestedRoutine, error)
}
