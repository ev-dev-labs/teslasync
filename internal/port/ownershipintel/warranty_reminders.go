package ownershipintel

import (
	"context"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/ownershipintel"
)

type WarrantyReminderKey struct {
	Subject               string
	VehicleID, WarrantyID int64
}

type WarrantyReminderClaim struct {
	Key        WarrantyReminderKey
	Generation int64
	LeaseUntil time.Time
	Published  bool
	Warranty   WarrantyRecord
}

type WarrantyProjectionUpdate struct {
	Projection *domain.WarrantyDistanceReminder
	CheckedAt  time.Time
	NextAt     time.Time
	Publish    bool
}

type WarrantyReminderCandidate struct {
	Projection  domain.WarrantyDistanceReminder
	Warranty    string
	VehicleName string
}

type WarrantyReminderRepository interface {
	SetWarrantyReminder(context.Context, WarrantyReminderKey, bool, time.Time) error
	WarrantyReminderSettings(context.Context, WarrantyReminderKey, time.Time) (domain.WarrantyReminderSettings, error)
	ClaimWarrantyReminders(context.Context, time.Time, time.Time, int) ([]WarrantyReminderClaim, error)
	WarrantyReminderDrives(context.Context, WarrantyReminderClaim, time.Time, time.Time) ([]DriveRecord, error)
	SaveWarrantyProjection(context.Context, WarrantyReminderClaim, WarrantyProjectionUpdate) (bool, error)
	ListWarrantyReminderCandidates(context.Context, string, *int64, time.Time, time.Time, int) ([]WarrantyReminderCandidate, error)
}
