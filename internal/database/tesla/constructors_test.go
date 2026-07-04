package tesla

import (
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// TestConstructors verifies each New*Repo wires the *database.DB's pool into
// the repository without panicking. A zero-value *database.DB (nil Pool) is
// sufficient — the constructors only read the Pool field; they must not deref
// it at construction time.
func TestConstructors(t *testing.T) {
	t.Parallel()
	db := &database.DB{}

	if got := NewTeslaChargingHistoryRepo(db); got == nil {
		t.Error("NewTeslaChargingHistoryRepo returned nil")
	}
	if got := NewTeslaChargingSessionRepo(db); got == nil {
		t.Error("NewTeslaChargingSessionRepo returned nil")
	}
	if got := NewTeslaUserConfigRepo(db); got == nil {
		t.Error("NewTeslaUserConfigRepo returned nil")
	}
	if got := NewTeslaUserOrderRepo(db); got == nil {
		t.Error("NewTeslaUserOrderRepo returned nil")
	}
	if got := NewTeslaUserProfileRepo(db); got == nil {
		t.Error("NewTeslaUserProfileRepo returned nil")
	}
	if got := NewTeslaVehicleDriverRepo(db); got == nil {
		t.Error("NewTeslaVehicleDriverRepo returned nil")
	}
}
