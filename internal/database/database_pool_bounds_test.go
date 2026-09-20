package database

import (
	"context"
	"math"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

func TestNewRejectsInvalidPoolBoundsBeforeConnecting(t *testing.T) {
	for _, bounds := range [][2]int{
		{0, 0}, {-1, 0}, {10, -1}, {10, 11},
		{math.MaxInt32 + 1, 0}, {math.MaxInt32, math.MaxInt32 + 1},
	} {
		db, err := New(context.Background(), config.DatabaseConfig{MaxConns: bounds[0], MinConns: bounds[1]})
		if db != nil || err == nil || !strings.Contains(err.Error(), "invalid database pool bounds") {
			t.Fatalf("bounds %v: db=%v err=%v", bounds, db, err)
		}
	}
}
