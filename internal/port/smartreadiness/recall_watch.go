package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var ErrRecallWatchChanged = errors.New("private recall watch changed")

type RecallWatchScope struct {
	Subject   string
	VehicleID int64
}

type DueRecallWatch struct {
	Subject    string
	ID         int64
	Setup      domain.RecallWatchSetup
	LeaseUntil time.Time
}

type CheckedRecallWatch struct {
	CheckedAt time.Time
	NextCheck time.Time
	Failed    bool
	Matches   []domain.RecallCampaignMatch
}

type RecallWatchCandidate struct {
	VehicleID   int64
	VehicleName string
	WatchID     int64
	Match       domain.RecallCampaignMatch
}

type RecallWatchRepository interface {
	ReadRecallWatch(context.Context, RecallWatchScope, time.Time) (domain.RecallWatch, error)
	ReplaceRecallWatch(context.Context, RecallWatchScope, int64, domain.RecallWatchSetup, time.Time) error
	DeleteRecallWatch(context.Context, RecallWatchScope, int64) error
	ClaimRecallWatch(context.Context, time.Time, time.Time) (*DueRecallWatch, error)
	RecallWatchStillCurrent(context.Context, DueRecallWatch) (bool, error)
	FinishRecallWatch(context.Context, DueRecallWatch, CheckedRecallWatch) (bool, int, error)
	ListRecallWatchMatches(context.Context, string, *int64, time.Time, int) ([]RecallWatchCandidate, error)
}
