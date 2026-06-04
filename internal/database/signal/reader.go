package signal

import (
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// SignalLogReader provides point-in-time signal reconstruction queries against
// the signal_log hypertable. All queries use context.WithTimeout to prevent
// runaway scans on the hypertable.
type SignalLogReader struct {
	db *database.DB
}

// NewSignalLogReader creates a reader backed by the given Postgres pool.
func NewSignalLogReader(db *database.DB) *SignalLogReader {
	return &SignalLogReader{db: db}
}

const queryTimeout = 10 * time.Second
