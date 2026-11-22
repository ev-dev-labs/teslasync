package smartmedia

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartmedia"
)

type JourneyScope struct {
	Scope
	JourneyID int64
}

type SoundtrackRepository interface {
	ReadSoundtrack(context.Context, JourneyScope, time.Time) (*domain.SoundtrackSource, error)
	ConfirmSoundtrack(ctx context.Context, scope JourneyScope, confirmation domain.SoundtrackConfirmation, now time.Time) error
	HoldSoundtrack(ctx context.Context, scope JourneyScope, id int64, snoozedUntil *time.Time, now time.Time) error
	ClearSoundtrack(ctx context.Context, scope JourneyScope, id int64) error
}
