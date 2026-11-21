package smartreadiness

import (
	"context"
	"errors"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
)

var (
	ErrSharedChargerActivePlan       = errors.New("charger already has a current shared plan")
	ErrSharedChargerAlreadyConfirmed = errors.New("shared charger vehicle already confirmed at this revision")
	ErrSharedChargerSwapPublished    = errors.New("shared charger swap already published")
)

type SharedChargerRepository interface {
	// Authorization also checks current reviewed charger and active vehicles. A
	// zero expected ref creates a plan; replacing a revision clears its consent.
	AuthorizeSharedCharger(ctx context.Context, operator string, expected domain.SharedChargerRef, spec domain.SharedChargerAuthorization, now time.Time) (domain.SharedChargerRef, error)
	ListSharedChargerPlanning(ctx context.Context, subject string, includeOwned bool, now time.Time, limit, offset int) (SharedChargerPlanning, error)
	FindSharedChargerInvitation(ctx context.Context, subject string, ref domain.SharedChargerRef, vehicleID int64, now time.Time) (*domain.SharedChargerInvitation, error)
	// Confirmation and creation of any pending swap occurrence are one transaction.
	ConfirmSharedCharger(ctx context.Context, subject string, ref domain.SharedChargerRef, confirmation domain.SharedChargerConfirmation) error
	FindConfirmedSharedChargerPlan(ctx context.Context, subject string, ref domain.SharedChargerRef, now time.Time) (*domain.SharedChargerConfirmedPlan, error)
	// A zero vehicle ID is reserved for the authority-checked plan owner. Otherwise
	// subject and vehicle must match one exact participant.
	RevokeSharedCharger(ctx context.Context, subject string, ref domain.SharedChargerRef, vehicleID int64, now time.Time) error
	PublishDueSharedChargerReminders(ctx context.Context, now time.Time, limit int) (int, error)
	FindSharedChargerReminder(ctx context.Context, subject string, ref domain.SharedChargerRef, now time.Time) (*domain.SharedChargerReminder, error)
}

type SharedChargerOwnedPlan struct {
	Ref       domain.SharedChargerRef
	PlaceID   int64
	ExpiresAt time.Time
}

type SharedChargerPlanning struct {
	CanManage   bool
	Owned       []SharedChargerOwnedPlan
	Invitations []domain.SharedChargerInvitation
}
