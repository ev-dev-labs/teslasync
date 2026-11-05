package devtools

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	observabilitydb "github.com/ev-dev-labs/teslasync/internal/database/observability"
	"github.com/jackc/pgx/v5/pgxpool"
)

type statsStub struct {
	stats *observabilitydb.DatabaseStats
	err   error
}

func (s statsStub) Stats(context.Context) (*observabilitydb.DatabaseStats, error) {
	return s.stats, s.err
}

func TestDatabaseStatsHTTP(t *testing.T) {
	t.Run("measured bytes and estimate provenance", func(t *testing.T) {
		h := &DevToolsHandler{dbStatsRepo: statsStub{stats: &observabilitydb.DatabaseStats{
			DatabaseSize: 499889843, RowCountsEstimated: true, Tables: []observabilitydb.DatabaseTableInfo{},
		}}}
		w := httptest.NewRecorder()
		h.DatabaseStats(w, httptest.NewRequest(http.MethodGet, "/dev-tools/db-stats", nil))
		var got observabilitydb.DatabaseStats
		if err := json.Unmarshal(w.Body.Bytes(), &got); err != nil {
			t.Fatal(err)
		}
		if w.Code != http.StatusOK || got.DatabaseSize != 499889843 || !got.RowCountsEstimated || got.Tables == nil {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
	})
	t.Run("failed measurement is not a successful zero", func(t *testing.T) {
		h := &DevToolsHandler{dbStatsRepo: statsStub{err: errors.New("private database error")}}
		w := httptest.NewRecorder()
		h.DatabaseStats(w, httptest.NewRequest(http.MethodGet, "/dev-tools/db-stats", nil))
		if w.Code != http.StatusInternalServerError || strings.Contains(w.Body.String(), "database_size") || strings.Contains(w.Body.String(), "private") {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
	})
	t.Run("unconfigured database", func(t *testing.T) {
		h := NewDevToolsHandler(nil, WithDB(&database.DB{}))
		w := httptest.NewRecorder()
		h.DatabaseStats(w, httptest.NewRequest(http.MethodGet, "/dev-tools/db-stats", nil))
		if w.Code != http.StatusServiceUnavailable {
			t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
		}
	})
}

func TestDatabaseStatsIntegration(t *testing.T) {
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL is not set")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	h := NewDevToolsHandler(nil, WithDB(&database.DB{Pool: pool}))
	w := httptest.NewRecorder()
	start := time.Now()
	h.DatabaseStats(w, httptest.NewRequest(http.MethodGet, "/dev-tools/db-stats", nil).WithContext(ctx))
	var stats observabilitydb.DatabaseStats
	if err := json.Unmarshal(w.Body.Bytes(), &stats); err != nil {
		t.Fatal(err)
	}
	if w.Code != http.StatusOK || stats.DatabaseSize <= 0 || !stats.RowCountsEstimated {
		t.Fatalf("status=%d body=%s", w.Code, w.Body.String())
	}
	t.Logf("HTTP %d; database_size=%d bytes; tables=%d; elapsed=%s", w.Code, stats.DatabaseSize, stats.TableCount, time.Since(start))
}
