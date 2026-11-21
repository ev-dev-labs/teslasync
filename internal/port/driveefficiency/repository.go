// Package driveefficiency defines storage for a private weekly efficiency review.
package driveefficiency

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/driveefficiency"
)

var (
	ErrNotFound = errors.New("private efficiency scope unavailable")
	ErrChanged  = errors.New("private efficiency review changed")
)

type Scope struct {
	Subject   string
	VehicleID int64
}

type State struct {
	Plan               *domain.Settings `json:"plan"`
	Digest             *domain.Digest   `json:"digest"`
	Dismissed          bool             `json:"dismissed"`
	ReviewAllowedUntil *time.Time       `json:"review_allowed_until"`
}

type Job struct {
	Scope
	Revision int64
	TimeZone string
	Lease    time.Time
	LastWeek string
}

type Drive struct {
	ID        int64
	StartedAt time.Time
	EndedAt   time.Time
	DistanceM float64
}

type Repository interface {
	Read(context.Context, Scope, time.Time) (State, error)
	Replace(context.Context, Scope, domain.Settings) error
	Delete(context.Context, Scope, int64) error
	Dismiss(context.Context, Scope, int64, time.Time, time.Time) error
	Claim(context.Context, time.Time, time.Time) (*Job, error)
	Current(context.Context, Job, time.Time) (bool, error)
	Drives(context.Context, Job, domain.Window, time.Time, int) ([]Drive, error)
	Finish(context.Context, Job, time.Time, time.Time, string, *domain.Digest) (bool, error)
}
