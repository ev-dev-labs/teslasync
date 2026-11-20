package smartcommute

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartcommute"
)

var (
	ErrTrafficTraceUnavailable = errors.New("no suitable observed trace for the selected drive")
	ErrTrafficPreviewChanged   = errors.New("representative trace or routine changed since review")
	ErrTrafficClaimLost        = errors.New("private traffic check is no longer eligible")
)

type TrafficDrive struct {
	Routine   domain.Routine
	Settings  domain.Settings
	StartedAt time.Time
	EndedAt   time.Time
}

type TrafficRepository interface {
	FindTrafficDrive(ctx context.Context, subject string, vehicleID, routineID, driveID int64, now time.Time) (*TrafficDrive, error)
	SaveTrafficConsent(ctx context.Context, subject string, routine domain.Routine, consent domain.TrafficConsent, now time.Time) error
	DeleteTrafficConsent(ctx context.Context, subject string, vehicleID, routineID int64) error
	SkipTrafficToday(ctx context.Context, subject string, vehicleID, routineID int64, now time.Time) error
	ClaimTrafficCheck(context.Context, time.Time, bool, NextTrafficCheck) (*TrafficCheck, error)
	VerifyTrafficCheck(context.Context, TrafficCheck) error
	RecordTrafficDecision(context.Context, TrafficCheck, domain.TrafficDecision, time.Time) (bool, error)
	ListTrafficDecisions(context.Context, string, *int64, time.Time, int) ([]domain.TrafficDecision, error)
}

type TrafficCheck struct {
	ConsentID         int64
	Subject           string
	AlreadyChecked    bool
	Routine           domain.Routine
	Settings          domain.Settings
	SettingsUpdatedAt time.Time
	Consent           domain.TrafficConsent
}

type NextTrafficCheck func(check TrafficCheck) (checkAt, departureAt time.Time, ok bool)

type TrafficSource interface {
	// Compare invokes authorize immediately before every outbound request.
	Compare(ctx context.Context, query domain.TrafficQuery, authorize func(context.Context) error) (domain.TrafficComparison, error)
}
