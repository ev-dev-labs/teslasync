package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	db                *database.DB
	driveRepo         *database.DriveRepo
	posRepo           *database.PositionRepo
	signalLogReader   *database.SignalLogReader
	redisCache        *signal.RedisSignalCache
	forwardAuthHeader string
	// bulkOverride lets tests substitute the bulk store without standing up a
	// real *database.DriveRepo. Always nil in production.
	bulkOverride driveBulkStore
}

func NewDriveHandler(db *database.DB) *DriveHandler {
	return &DriveHandler{
		db:              db,
		driveRepo:       database.NewDriveRepo(db),
		posRepo:         database.NewPositionRepo(db),
		signalLogReader: database.NewSignalLogReader(db),
	}
}

// WithRedisCache sets the Redis signal cache for computing live in-progress drive values.
func (h *DriveHandler) WithRedisCache(cache *signal.RedisSignalCache) *DriveHandler {
	h.redisCache = cache
	return h
}

// WithForwardAuthHeader wires the auth header used to attribute audit log
// entries written by the bulk endpoints. When unset, audit rows still record
// IP/User-Agent but Actor is empty (dev mode behaviour).
func (h *DriveHandler) WithForwardAuthHeader(name string) *DriveHandler {
	h.forwardAuthHeader = name
	return h
}
