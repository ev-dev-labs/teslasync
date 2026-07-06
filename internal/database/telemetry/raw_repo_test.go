package telemetry

import (
	"context"
	"encoding/json"
	"errors"
	"reflect"
	"testing"
	"time"

	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
)

// ---------------------------------------------------------------------------
// Fake Mongo plumbing.
//
// mongo-driver v2's Find/Distinct return concrete *mongo.Cursor /
// *mongo.DistinctResult which cannot be scripted without a live deployment
// (mtest is not vendored). RawTelemetryRepo therefore talks to the unexported
// rawColl port, whose read methods return already-decoded documents. This fake
// substitutes for the production mongoCollAdapter.
// ---------------------------------------------------------------------------

type fakeRawColl struct {
	// scripted outputs
	insertErr      error
	findResult     []*telemetrymodel.RawTelemetrySignal
	findErr        error
	countResult    int64
	countErr       error
	distinctResult []string
	distinctErr    error
	dropErr        error
	streamCursor   *mongo.Cursor
	streamErr      error

	// recorded inputs
	insertedDoc    any
	insertCalls    int
	findFilter     any
	findSort       bson.D
	findLimit      int64
	findSkip       int64
	findCalls      int
	countFilter    any
	countCalls     int
	distinctField  string
	distinctFilter any
	distinctCalls  int
	dropCalls      int
	streamSort     bson.D
	streamCalls    int
}

func (f *fakeRawColl) InsertOne(_ context.Context, doc any) error {
	f.insertCalls++
	f.insertedDoc = doc
	return f.insertErr
}

func (f *fakeRawColl) Find(_ context.Context, filter any, sort bson.D, limit, skip int64) ([]*telemetrymodel.RawTelemetrySignal, error) {
	f.findCalls++
	f.findFilter = filter
	f.findSort = sort
	f.findLimit = limit
	f.findSkip = skip
	if f.findErr != nil {
		return nil, f.findErr
	}
	return f.findResult, nil
}

func (f *fakeRawColl) Count(_ context.Context, filter any) (int64, error) {
	f.countCalls++
	f.countFilter = filter
	if f.countErr != nil {
		return 0, f.countErr
	}
	return f.countResult, nil
}

func (f *fakeRawColl) Distinct(_ context.Context, field string, filter any) ([]string, error) {
	f.distinctCalls++
	f.distinctField = field
	f.distinctFilter = filter
	if f.distinctErr != nil {
		return nil, f.distinctErr
	}
	return f.distinctResult, nil
}

func (f *fakeRawColl) Drop(_ context.Context) error {
	f.dropCalls++
	return f.dropErr
}

func (f *fakeRawColl) Stream(_ context.Context, sort bson.D) (*mongo.Cursor, error) {
	f.streamCalls++
	f.streamSort = sort
	if f.streamErr != nil {
		return nil, f.streamErr
	}
	return f.streamCursor, nil
}

var _ rawColl = (*fakeRawColl)(nil)

func newRawRepo(c rawColl) *RawTelemetryRepo { return &RawTelemetryRepo{coll: c} }

// ---------------------------------------------------------------------------
// Construction contract.
// ---------------------------------------------------------------------------

func TestNewRawTelemetryRepo_NilClientPanics(t *testing.T) {
	t.Parallel()
	defer func() {
		if recover() == nil {
			t.Fatal("NewRawTelemetryRepo(nil) did not panic; a nil client is a wiring bug that must fail fast")
		}
	}()
	_ = NewRawTelemetryRepo(nil)
}

// ---------------------------------------------------------------------------
// Insert.
// ---------------------------------------------------------------------------

func TestRawTelemetryRepo_Insert(t *testing.T) {
	t.Parallel()
	insertBoom := errors.New("write concern timeout")

	t.Run("success_stamps_created_at_utc", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{}
		repo := newRawRepo(fake)
		rec := &telemetrymodel.RawTelemetrySignal{VIN: "VINX", Source: "mqtt", SignalCount: 12}

		before := time.Now().UTC()
		err := repo.Insert(context.Background(), rec)
		after := time.Now().UTC()
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if fake.insertCalls != 1 {
			t.Fatalf("insertCalls = %d, want 1", fake.insertCalls)
		}
		if fake.insertedDoc != any(rec) {
			t.Error("InsertOne did not receive the record pointer")
		}
		if rec.CreatedAt.IsZero() {
			t.Fatal("CreatedAt was not stamped")
		}
		if rec.CreatedAt.Location() != time.UTC {
			t.Errorf("CreatedAt location = %v, want UTC", rec.CreatedAt.Location())
		}
		if rec.CreatedAt.Before(before) || rec.CreatedAt.After(after) {
			t.Errorf("CreatedAt %v not within [%v, %v]", rec.CreatedAt, before, after)
		}
	})

	t.Run("nil_record_rejected", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{}
		repo := newRawRepo(fake)
		err := repo.Insert(context.Background(), nil)
		if err == nil {
			t.Fatal("expected error for nil record")
		}
		if fake.insertCalls != 0 {
			t.Errorf("InsertOne called %d times, want 0 for nil record", fake.insertCalls)
		}
	})

	t.Run("insert_error_wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{insertErr: insertBoom}
		repo := newRawRepo(fake)
		rec := &telemetrymodel.RawTelemetrySignal{VIN: "VINX"}
		err := repo.Insert(context.Background(), rec)
		assertWrappedErr(t, err, insertBoom, "insert raw signal")
	})
}

// ---------------------------------------------------------------------------
// GetByVIN / GetAll.
// ---------------------------------------------------------------------------

func TestRawTelemetryRepo_GetByVIN(t *testing.T) {
	t.Parallel()
	findBoom := errors.New("cursor timeout")
	docs := []*telemetrymodel.RawTelemetrySignal{
		{VIN: "VINX", Source: "mqtt"},
		{VIN: "VINX", Source: "poll"},
	}

	t.Run("success_passes_vin_filter_and_desc_sort", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{findResult: docs}
		repo := newRawRepo(fake)
		got, err := repo.GetByVIN(context.Background(), "VINX", 20, 40)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 2 {
			t.Fatalf("len = %d, want 2", len(got))
		}
		if !reflect.DeepEqual(fake.findFilter, bson.M{"vin": "VINX"}) {
			t.Errorf("filter = %v, want {vin: VINX}", fake.findFilter)
		}
		if !reflect.DeepEqual(fake.findSort, sortRawByCreatedDesc) {
			t.Errorf("sort = %v, want newest-first", fake.findSort)
		}
		if fake.findLimit != 20 || fake.findSkip != 40 {
			t.Errorf("limit/skip = %d/%d, want 20/40", fake.findLimit, fake.findSkip)
		}
	})

	t.Run("find_error_wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{findErr: findBoom}
		repo := newRawRepo(fake)
		got, err := repo.GetByVIN(context.Background(), "VINX", 10, 0)
		assertWrappedErr(t, err, findBoom, "find raw signals by vin")
		if got != nil {
			t.Errorf("result = %v, want nil on error", got)
		}
	})
}

func TestRawTelemetryRepo_GetAll(t *testing.T) {
	t.Parallel()
	findBoom := errors.New("network blip")
	docs := []*telemetrymodel.RawTelemetrySignal{{VIN: "A"}, {VIN: "B"}, {VIN: "C"}}

	t.Run("success_passes_empty_filter_and_desc_sort", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{findResult: docs}
		repo := newRawRepo(fake)
		got, err := repo.GetAll(context.Background(), 100, 0)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if len(got) != 3 {
			t.Fatalf("len = %d, want 3", len(got))
		}
		if !reflect.DeepEqual(fake.findFilter, bson.M{}) {
			t.Errorf("filter = %v, want empty {}", fake.findFilter)
		}
		if !reflect.DeepEqual(fake.findSort, sortRawByCreatedDesc) {
			t.Errorf("sort = %v, want newest-first", fake.findSort)
		}
		if fake.findLimit != 100 || fake.findSkip != 0 {
			t.Errorf("limit/skip = %d/%d, want 100/0", fake.findLimit, fake.findSkip)
		}
	})

	t.Run("find_error_wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{findErr: findBoom}
		repo := newRawRepo(fake)
		got, err := repo.GetAll(context.Background(), 10, 0)
		assertWrappedErr(t, err, findBoom, "find raw signals")
		if got != nil {
			t.Errorf("result = %v, want nil on error", got)
		}
	})
}

// ---------------------------------------------------------------------------
// Count.
// ---------------------------------------------------------------------------

func TestRawTelemetryRepo_Count(t *testing.T) {
	t.Parallel()
	countBoom := errors.New("count failed")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{countResult: 4242}
		repo := newRawRepo(fake)
		got, err := repo.Count(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if got != 4242 {
			t.Errorf("count = %d, want 4242", got)
		}
		if !reflect.DeepEqual(fake.countFilter, bson.M{}) {
			t.Errorf("filter = %v, want empty {}", fake.countFilter)
		}
	})

	t.Run("error_wrapped_returns_zero", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{countErr: countBoom}
		repo := newRawRepo(fake)
		got, err := repo.Count(context.Background())
		assertWrappedErr(t, err, countBoom, "count raw signals")
		if got != 0 {
			t.Errorf("count = %d, want 0 on error", got)
		}
	})
}

// ---------------------------------------------------------------------------
// Stats.
// ---------------------------------------------------------------------------

func TestRawTelemetryRepo_Stats(t *testing.T) {
	t.Parallel()
	countBoom := errors.New("count down")
	distinctBoom := errors.New("distinct down")

	t.Run("success_composes_count_and_distinct", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{countResult: 7, distinctResult: []string{"VIN1", "VIN2"}}
		repo := newRawRepo(fake)
		stats, err := repo.Stats(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if stats.TotalDocuments != 7 {
			t.Errorf("TotalDocuments = %d, want 7", stats.TotalDocuments)
		}
		if !reflect.DeepEqual(stats.DistinctVINs, []string{"VIN1", "VIN2"}) {
			t.Errorf("DistinctVINs = %v, want [VIN1 VIN2]", stats.DistinctVINs)
		}
		if fake.distinctField != "vin" {
			t.Errorf("distinct field = %q, want vin", fake.distinctField)
		}
		if fake.countCalls != 1 || fake.distinctCalls != 1 {
			t.Errorf("countCalls/distinctCalls = %d/%d, want 1/1", fake.countCalls, fake.distinctCalls)
		}
	})

	t.Run("count_error_short_circuits", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{countErr: countBoom}
		repo := newRawRepo(fake)
		stats, err := repo.Stats(context.Background())
		assertWrappedErr(t, err, countBoom, "count raw signals")
		if stats != nil {
			t.Errorf("stats = %v, want nil on error", stats)
		}
		if fake.distinctCalls != 0 {
			t.Errorf("distinct called %d times, want 0 (count failed first)", fake.distinctCalls)
		}
	})

	t.Run("distinct_error_wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{countResult: 3, distinctErr: distinctBoom}
		repo := newRawRepo(fake)
		stats, err := repo.Stats(context.Background())
		assertWrappedErr(t, err, distinctBoom, "distinct raw signal vins")
		if stats != nil {
			t.Errorf("stats = %v, want nil on error", stats)
		}
	})
}

// ---------------------------------------------------------------------------
// Drop.
// ---------------------------------------------------------------------------

func TestRawTelemetryRepo_Drop(t *testing.T) {
	t.Parallel()
	dropBoom := errors.New("drop denied")

	t.Run("success", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{}
		repo := newRawRepo(fake)
		if err := repo.Drop(context.Background()); err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if fake.dropCalls != 1 {
			t.Errorf("dropCalls = %d, want 1", fake.dropCalls)
		}
	})

	t.Run("error_wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{dropErr: dropBoom}
		repo := newRawRepo(fake)
		err := repo.Drop(context.Background())
		assertWrappedErr(t, err, dropBoom, "drop raw signals")
	})
}

// ---------------------------------------------------------------------------
// StreamAll.
// ---------------------------------------------------------------------------

func TestRawTelemetryRepo_StreamAll(t *testing.T) {
	t.Parallel()
	streamBoom := errors.New("no cursor")

	t.Run("success_uses_ascending_sort", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{} // nil cursor is fine; we assert delegation + sort
		repo := newRawRepo(fake)
		cur, err := repo.StreamAll(context.Background())
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}
		if cur != nil {
			t.Errorf("cursor = %v, want nil (fake returns nil cursor)", cur)
		}
		if fake.streamCalls != 1 {
			t.Fatalf("streamCalls = %d, want 1", fake.streamCalls)
		}
		if !reflect.DeepEqual(fake.streamSort, sortRawByCreatedAsc) {
			t.Errorf("sort = %v, want oldest-first for export", fake.streamSort)
		}
	})

	t.Run("error_wrapped", func(t *testing.T) {
		t.Parallel()
		fake := &fakeRawColl{streamErr: streamBoom}
		repo := newRawRepo(fake)
		cur, err := repo.StreamAll(context.Background())
		assertWrappedErr(t, err, streamBoom, "stream raw signals")
		if cur != nil {
			t.Errorf("cursor = %v, want nil on error", cur)
		}
	})
}

// ---------------------------------------------------------------------------
// Package-level invariants: sort orders, collection name, CaptureStats shape.
// ---------------------------------------------------------------------------

func TestRawSignalSortOrders(t *testing.T) {
	t.Parallel()
	if rawSignalsCollection != "raw_signals" {
		t.Errorf("collection = %q, want raw_signals", rawSignalsCollection)
	}
	if !reflect.DeepEqual(sortRawByCreatedDesc, bson.D{{Key: "created_at", Value: -1}}) {
		t.Errorf("desc sort = %v, want created_at:-1", sortRawByCreatedDesc)
	}
	if !reflect.DeepEqual(sortRawByCreatedAsc, bson.D{{Key: "created_at", Value: 1}}) {
		t.Errorf("asc sort = %v, want created_at:1", sortRawByCreatedAsc)
	}
}

func TestCaptureStats_JSONShape(t *testing.T) {
	t.Parallel()
	stats := CaptureStats{TotalDocuments: 5, DistinctVINs: []string{"VIN1"}}
	b, err := json.Marshal(stats)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var round map[string]json.RawMessage
	if err := json.Unmarshal(b, &round); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{"total_documents", "distinct_vins"} {
		if _, ok := round[key]; !ok {
			t.Errorf("CaptureStats JSON missing key %q; got %s", key, b)
		}
	}
}
