package api

import (
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// DriveHandler handles drive-related HTTP requests.
type DriveHandler struct {
	db              *database.DB
	driveRepo       *database.DriveRepo
	posRepo         *database.PositionRepo
	signalLogReader *database.SignalLogReader
	redisCache      *signal.RedisSignalCache
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
