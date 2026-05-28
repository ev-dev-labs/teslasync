package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
	drivedb "github.com/ev-dev-labs/teslasync/internal/database/drive"
	signaldb "github.com/ev-dev-labs/teslasync/internal/database/signal"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	db                *database.DB
	driveRepo         *drivedb.DriveRepo
	posRepo           *database.PositionRepo
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
		posRepo:         database.NewPositionRepo(db),
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
