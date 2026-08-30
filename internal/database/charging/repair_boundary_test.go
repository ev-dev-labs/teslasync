package charging

import (
	"strings"
	"testing"
)

func TestRepairBoundaryUpdateUsesNullSafeCompareAndSwap(t *testing.T) {
	t.Parallel()

	for _, required := range []string{
		"UPDATE charging_sessions",
		"SET ended_at = $3",
		"WHERE id = $1",
		"ended_at IS NOT DISTINCT FROM $2",
	} {
		if !strings.Contains(updateRepairBoundaryIfUnchangedSQL, required) {
			t.Errorf("repair boundary SQL missing %q", required)
		}
	}
}

func TestGenericPartialUpdateCannotChangeRepairBoundary(t *testing.T) {
	t.Parallel()
	if _, ok := ChargingPartialAllowed["ended_at"]; ok {
		t.Fatal("ended_at must only be writable through the checked repair-boundary path")
	}
}
