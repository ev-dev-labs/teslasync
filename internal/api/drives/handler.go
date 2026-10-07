package drives

import (
	"math"
	"net/http"
	"strconv"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/api/apiparams"
	"github.com/ev-dev-labs/teslasync/internal/api/httpx"
	"github.com/ev-dev-labs/teslasync/internal/database"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	positiondb "github.com/ev-dev-labs/teslasync/internal/database/position"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	db                *database.DB
	driveRepo         *drivedb.DriveRepo
	posRepo           *positiondb.PositionRepo
	signalLogReader   *signaldb.SignalLogReader
	live              signal.LiveStateReader
	forwardAuthHeader string
	// bulkOverride lets tests substitute the bulk store without standing up a
	// real *drivedb.DriveRepo. Always nil in production.
	bulkOverride driveBulkStore
}

// NewDriveHandler constructs a DriveHandler. live is the layered live-state
// reader used by the live-drive enrichment path; pass nil only in tests that
// do not exercise the live path.
func NewDriveHandler(db *database.DB, live signal.LiveStateReader) *DriveHandler {
	return &DriveHandler{
		db:              db,
		driveRepo:       drivedb.NewDriveRepo(db),
		posRepo:         positiondb.NewPositionRepo(db),
		signalLogReader: signaldb.NewSignalLogReader(db),
		live:            live,
	}
}

// WithForwardAuthHeader wires the auth header used to attribute audit log
// entries written by the bulk endpoints. When unset, audit rows still record
// IP/User-Agent but Actor is empty (dev mode behaviour).
func (h *DriveHandler) WithForwardAuthHeader(name string) *DriveHandler {
	h.forwardAuthHeader = name
	return h
}

func writeJSON(w http.ResponseWriter, status int, data interface{}) {
	httpx.WriteJSON(w, status, data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpx.WriteError(w, status, msg)
}

func pagination(r *http.Request) (limit, offset int) {
	return apiparams.Pagination(r)
}

func urlParamInt64(r *http.Request, key string) (int64, error) {
	return apiparams.URLParamInt64(r, key)
}

func parseDateRange(r *http.Request) (startTime, endTime time.Time) {
	return apiparams.ParseDateRange(r)
}

func toFloatOk(v interface{}) (float64, bool) {
	return signal.Float64(v)
}

func signalFloat(signals map[string]interface{}, keys ...string) (float64, bool) {
	for _, key := range keys {
		if v, ok := signals[key]; ok {
			return toFloatOk(v)
		}
	}
	return 0, false
}

func safeFloat(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

func parseInt64(s string) (int64, error) {
	return strconv.ParseInt(s, 10, 64)
}
