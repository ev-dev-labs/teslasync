package database

import (
	"time"
)

// SignalLogReader provides point-in-time signal reconstruction queries against
// the signal_log hypertable. All queries use context.WithTimeout to prevent
// runaway scans on the hypertable.
type SignalLogReader struct {
	db *DB
}

// NewSignalLogReader creates a reader backed by the given Postgres pool.
func NewSignalLogReader(db *DB) *SignalLogReader {
	return &SignalLogReader{db: db}
}

const queryTimeout = 10 * time.Second
