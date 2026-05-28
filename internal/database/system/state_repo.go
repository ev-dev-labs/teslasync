package system

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/jackc/pgx/v5"
)

// SystemMode enumerates the operator-controlled service modes that
// drive the top-of-app banner. Phase-46 / Prompt 04.
//
// "ok" is the default; "degraded" indicates partial functionality (e.g.
// an upstream is flapping) and "maintenance" indicates an operator-led
// outage window.
const (
	SystemModeOK          = "ok"
	SystemModeDegraded    = "degraded"
	SystemModeMaintenance = "maintenance"
)

// MaintenanceMessageMaxLen is the server-enforced cap on
// system_state.maintenance_message length. Mirrored as a client-side
// char counter in the admin UI; the backend trims (rather than rejects)
// over-length inputs to match the "graceful degradation" pattern used
// elsewhere in TeslaSync.
const MaintenanceMessageMaxLen = 280

// ErrInvalidSystemMode is returned by ValidateSystemMode when the
// supplied value is not one of the SystemMode* constants.
var ErrInvalidSystemMode = errors.New("invalid system mode")

// SystemState is the single-row materialization of the system_state
// table. Maintenance metadata is only meaningful when Mode is
// "degraded" or "maintenance" but the fields are always selected so
// callers can render a "previously set" hint after returning to "ok".
type SystemState struct {
	Mode               string
	MaintenanceMessage string
	MaintenanceUntil   *time.Time
	UpdatedAt          time.Time
	UpdatedBy          string
}

// SystemStateRepo persists and reads the single-row service-mode state.
// All accessors target row id=1 (enforced by a CHECK constraint in the
// migration) so callers don't pass an ID.
type SystemStateRepo struct {
	db *database.DB
}

// NewSystemStateRepo wires a repository against the shared pool.
func NewSystemStateRepo(db *database.DB) *SystemStateRepo {
	return &SystemStateRepo{db: db}
}

// Get reads the current service-mode row. If the row is missing
// (migration not applied or seed deleted) Get returns a zero-value
// SystemState with Mode == SystemModeOK so callers don't have to
// special-case the empty case in the hot health-check path.
func (r *SystemStateRepo) Get(ctx context.Context) (SystemState, error) {
	if r == nil || r.db == nil {
		return SystemState{Mode: SystemModeOK}, nil
	}
	var s SystemState
	var msg *string
	var by *string
	err := r.db.Pool.QueryRow(ctx,
		`SELECT mode, maintenance_message, maintenance_until, updated_at, updated_by
		 FROM system_state
		 WHERE id = 1`,
	).Scan(&s.Mode, &msg, &s.MaintenanceUntil, &s.UpdatedAt, &by)
	if errors.Is(err, pgx.ErrNoRows) {
		return SystemState{Mode: SystemModeOK}, nil
	}
	if err != nil {
		return SystemState{}, fmt.Errorf("system_state get: %w", err)
	}
	if msg != nil {
		s.MaintenanceMessage = *msg
	}
	if by != nil {
		s.UpdatedBy = *by
	}
	return s, nil
}

// Set updates the single system_state row. Mode is validated; message
// is trimmed and capped at MaintenanceMessageMaxLen. When mode is
// SystemModeOK the message and until are cleared so a stale banner
// can't reappear after a future re-toggle.
func (r *SystemStateRepo) Set(ctx context.Context, mode, message string, until *time.Time, updatedBy string) (SystemState, error) {
	if r == nil || r.db == nil {
		return SystemState{}, errors.New("system_state: repo not initialized")
	}
	mode, err := ValidateSystemMode(mode)
	if err != nil {
		return SystemState{}, err
	}
	message = NormalizeMaintenanceMessage(message)
	if mode == SystemModeOK {
		message = ""
		until = nil
	}

	var msgPtr *string
	if message != "" {
		msgPtr = &message
	}
	var byPtr *string
	if updatedBy != "" {
		byPtr = &updatedBy
	}

	var s SystemState
	var outMsg *string
	var outBy *string
	err = r.db.Pool.QueryRow(ctx,
		`INSERT INTO system_state (id, mode, maintenance_message, maintenance_until, updated_at, updated_by)
		 VALUES (1, $1, $2, $3, NOW(), $4)
		 ON CONFLICT (id) DO UPDATE SET
		   mode                = EXCLUDED.mode,
		   maintenance_message = EXCLUDED.maintenance_message,
		   maintenance_until   = EXCLUDED.maintenance_until,
		   updated_at          = NOW(),
		   updated_by          = EXCLUDED.updated_by
		 RETURNING mode, maintenance_message, maintenance_until, updated_at, updated_by`,
		mode, msgPtr, until, byPtr,
	).Scan(&s.Mode, &outMsg, &s.MaintenanceUntil, &s.UpdatedAt, &outBy)
	if err != nil {
		return SystemState{}, fmt.Errorf("system_state set: %w", err)
	}
	if outMsg != nil {
		s.MaintenanceMessage = *outMsg
	}
	if outBy != nil {
		s.UpdatedBy = *outBy
	}
	return s, nil
}

// ValidateSystemMode normalizes (lower-case + trim) and validates a
// caller-supplied mode string. Returned as a separate exported helper
// so the admin handler can reject invalid input *before* opening a
// transaction; also unit-testable without a live DB.
func ValidateSystemMode(mode string) (string, error) {
	m := strings.ToLower(strings.TrimSpace(mode))
	switch m {
	case SystemModeOK, SystemModeDegraded, SystemModeMaintenance:
		return m, nil
	default:
		return "", fmt.Errorf("%w: %q", ErrInvalidSystemMode, mode)
	}
}

// NormalizeMaintenanceMessage trims whitespace and truncates to
// MaintenanceMessageMaxLen runes (NOT bytes — UTF-8 safe). Pure helper
// so it can be unit-tested without a live DB.
func NormalizeMaintenanceMessage(message string) string {
	m := strings.TrimSpace(message)
	if m == "" {
		return ""
	}
	runes := []rune(m)
	if len(runes) > MaintenanceMessageMaxLen {
		runes = runes[:MaintenanceMessageMaxLen]
	}
	return string(runes)
}
