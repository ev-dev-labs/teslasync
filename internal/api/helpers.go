package api

import (
	"context"
	"net/http"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
)

// writeJSON is a transitional wrapper around httpx.WriteJSON kept for
// the duration of the internal/api -> internal/api/<resource>/
// subpackage migration (Phase R2). New handlers — and handlers being
// moved into resource subpackages — MUST call httpx.WriteJSON
// directly. Deletion of this wrapper is gated on internal/api/
// reaching its irreducible drained shape at end of Phase R2.
func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	httpx.WriteJSON(w, status, data)
}

// httpStatusCode is a transitional wrapper around httpx.HTTPStatusCode.
// New code MUST call httpx.HTTPStatusCode directly. See writeJSON for
// the broader transitional plan.
func httpStatusCode(status int) string {
	return httpx.HTTPStatusCode(status)
}

// writeError is a transitional wrapper around httpx.WriteError. See
// writeJSON for the broader transitional plan.
func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

// writeErrorCode is a transitional wrapper around httpx.WriteErrorCode.
// See writeJSON for the broader transitional plan.
func writeErrorCode(w http.ResponseWriter, status int, msg, code string) {
	httpx.WriteErrorCode(w, status, msg, code)
}

// writeTeslaTokenExpired drained to zero callers by R2d batch 8 (carves
// drained all token-issuing handlers into resource subpackages, which call
// httpx.WriteTeslaTokenExpired directly). Wrapper deleted per the carve
// playbook — see writeJSON for the broader transitional plan.

// writeAppError was the transitional wrapper around apperror.Write.
// Drained to zero callers by R2c (vehicle subpkg carve) — the last
// users moved to `apperror.Write` directly. Wrapper deleted; handlers
// being moved into resource subpackages MUST call apperror.Write
// directly per the carve playbook.

// pagination is a transitional wrapper around apiparams.Pagination
// kept for the duration of the internal/api -> internal/api/<resource>/
// subpackage migration (Phase R2). New handlers — and handlers being
// moved into resource subpackages — MUST call apiparams.Pagination
// directly. Deletion of this wrapper is gated on internal/api/
// reaching its irreducible drained shape at end of Phase R2.
func pagination(r *http.Request) (limit, offset int) {
	return apiparams.Pagination(r)
}

// urlParamInt64 was a transitional wrapper around apiparams.URLParamInt64.
// Removed in R2d batch 9: every parent-package caller has been carved
// into a resource subpackage that imports apiparams directly. Add a new
// caller? Use apiparams.URLParamInt64 instead — do not reintroduce this
// wrapper.

// parseDateRange is a transitional wrapper around apiparams.ParseDateRange.
// See pagination for the broader transitional plan + the detailed
// timezone bug-fix docstring on the canonical apiparams.ParseDateRange.
func parseDateRange(r *http.Request) (startTime, endTime time.Time) {
	return apiparams.ParseDateRange(r)
}

// nullableTime drained to zero callers by R2d batch 8 — the last users
// (carved into resource subpackages) call apiparams.NullableTime
// directly. Wrapper deleted per the carve playbook.

func firstNonEmpty(values ...string) string {
	for _, v := range values {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// EstimateBatteryCapacityWh returns the best-effort battery capacity in Wh
// and a source string indicating how the estimate was derived.
// Uses VIN position 8 decode first, falls back to model name, then 75000 Wh default.
// This is an ESTIMATE — Tesla does not expose exact usable capacity via API.
func EstimateBatteryCapacityWh(vin string, model string) (float64, string) {
	// VIN position 8 (0-indexed 7) for Tesla encodes drivetrain/battery:
	//   E/F = Standard Range (~55-60 kWh usable)
	//   K/L/M = Long Range (~75-82 kWh usable)
	//   S/A = Model S/X Long Range / Plaid (~100 kWh usable)
	//   P = Performance (~100 kWh usable)
	if len(vin) >= 8 {
		switch vin[7] {
		case 'E', 'F':
			return 60000.0, "vin_estimate"
		case 'K', 'L', 'M':
			return 75000.0, "vin_estimate"
		case 'S', 'A':
			return 100000.0, "vin_estimate"
		case 'P':
			return 100000.0, "vin_estimate"
		}
	}
	// Fallback: model name heuristic
	m := strings.ToLower(model)
	if strings.Contains(m, "model s") || strings.Contains(m, "model x") {
		return 100000.0, "model_estimate"
	}
	return 75000.0, "default"
}

// lookupVehicleCapacityWh fetches VIN and model for a vehicle ID and estimates
// battery capacity. Falls back to 75000 Wh / "default" on any lookup error.
func lookupVehicleCapacityWh(ctx context.Context, db *database.DB, vehicleID int64) (float64, string) {
	var vin string
	var model *string
	err := db.Pool.QueryRow(ctx,
		`SELECT vin, model FROM vehicles WHERE id = $1`, vehicleID,
	).Scan(&vin, &model)
	if err != nil {
		return 75000.0, "default"
	}
	m := ""
	if model != nil {
		m = *model
	}
	return EstimateBatteryCapacityWh(vin, m)
}
