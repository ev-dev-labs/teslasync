package admin

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

	if got := NewChartAnnotationRepo(db); got == nil {
		t.Error("NewChartAnnotationRepo returned nil")
	}
	if got := NewDashboardLayoutRepo(db); got == nil {
		t.Error("NewDashboardLayoutRepo returned nil")
	}
	if got := NewPinnedRepo(db); got == nil {
		t.Error("NewPinnedRepo returned nil")
	}
	if got := NewSavedViewsRepo(db); got == nil {
		t.Error("NewSavedViewsRepo returned nil")
	}
	if got := NewPlacesCacheRepo(db); got == nil {
		t.Error("NewPlacesCacheRepo returned nil")
	}
}
