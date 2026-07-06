package telemetry

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const rawSignalsCollection = "raw_signals"

// Stable sort orders for the raw_signals collection. Read paths surface the
// newest captures first; the export stream walks oldest-first so a consumer
// sees documents in insertion order.
var (
	sortRawByCreatedDesc = bson.D{{Key: "created_at", Value: -1}}
	sortRawByCreatedAsc  = bson.D{{Key: "created_at", Value: 1}}
)

// rawColl is the minimal MongoDB surface RawTelemetryRepo needs. The production
// adapter (mongoCollAdapter) wraps *mongo.Collection; unit tests substitute a
// scripted fake. The seam returns already-decoded documents (rather than a
// *mongo.Cursor) for the read paths so the repo logic is exercisable without a
// live Mongo deployment — the codebase vendors no mtest/testcontainers harness.
type rawColl interface {
	// InsertOne persists a single document.
	InsertOne(ctx context.Context, doc any) error
	// Find returns documents matching filter, applying sort/limit/skip, decoded
	// into the concrete signal type.
	Find(ctx context.Context, filter any, sort bson.D, limit, skip int64) ([]*telemetrymodel.RawTelemetrySignal, error)
	// Count returns the number of documents matching filter.
	Count(ctx context.Context, filter any) (int64, error)
	// Distinct returns the distinct string values of field across documents
	// matching filter.
	Distinct(ctx context.Context, field string, filter any) ([]string, error)
	// Drop removes the whole collection.
	Drop(ctx context.Context) error
	// Stream returns a live cursor over every document for export. The caller
	// owns closing the cursor.
	Stream(ctx context.Context, sort bson.D) (*mongo.Cursor, error)
}

// mongoCollAdapter is the production rawColl backed by a real *mongo.Collection.
// It is thin, obviously-correct wiring (analogous to *pgxpool.Pool satisfying a
// pgx querier interface directly); all repo logic lives on RawTelemetryRepo.
type mongoCollAdapter struct {
	coll *mongo.Collection
}

func (a mongoCollAdapter) InsertOne(ctx context.Context, doc any) error {
	_, err := a.coll.InsertOne(ctx, doc)
	return err
}

func (a mongoCollAdapter) Find(ctx context.Context, filter any, sort bson.D, limit, skip int64) ([]*telemetrymodel.RawTelemetrySignal, error) {
	opts := options.Find().SetSort(sort).SetLimit(limit).SetSkip(skip)
	cursor, err := a.coll.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var results []*telemetrymodel.RawTelemetrySignal
	if err := cursor.All(ctx, &results); err != nil {
		return nil, err
	}
	return results, nil
}

func (a mongoCollAdapter) Count(ctx context.Context, filter any) (int64, error) {
	return a.coll.CountDocuments(ctx, filter)
}

func (a mongoCollAdapter) Distinct(ctx context.Context, field string, filter any) ([]string, error) {
	result := a.coll.Distinct(ctx, field, filter)
	if err := result.Err(); err != nil {
		return nil, err
	}
	var values []string
	if err := result.Decode(&values); err != nil {
		return nil, err
	}
	return values, nil
}

func (a mongoCollAdapter) Drop(ctx context.Context) error {
	return a.coll.Drop(ctx)
}

func (a mongoCollAdapter) Stream(ctx context.Context, sort bson.D) (*mongo.Cursor, error) {
	return a.coll.Find(ctx, bson.M{}, options.Find().SetSort(sort))
}

var _ rawColl = mongoCollAdapter{}

// RawTelemetryRepo stores raw telemetry signal batches in MongoDB.
type RawTelemetryRepo struct {
	coll rawColl
}

// NewRawTelemetryRepo creates the repo and ensures indexes (including TTL). A
// nil client at construction is a wiring bug, so we fail fast rather than
// deferring the nil-deref to the first write.
func NewRawTelemetryRepo(mc *database.MongoClient) *RawTelemetryRepo {
	if mc == nil {
		panic("telemetry.NewRawTelemetryRepo: mongo client must not be nil")
	}
	coll := mc.Database().Collection(rawSignalsCollection)
	ensureRawSignalIndexes(coll, mc.TTLDays())
	return &RawTelemetryRepo{coll: mongoCollAdapter{coll: coll}}
}

// ensureRawSignalIndexes creates the TTL index on created_at and the
// (vin, created_at) lookup index. Index creation failures are logged and
// tolerated: the collection is still usable, just without the optimisation.
func ensureRawSignalIndexes(coll *mongo.Collection, ttlDays int) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	indexes := []mongo.IndexModel{
		{
			Keys:    bson.D{{Key: "created_at", Value: 1}},
			Options: options.Index().SetExpireAfterSeconds(int32(ttlDays * 86400)),
		},
		{
			Keys: bson.D{{Key: "vin", Value: 1}, {Key: "created_at", Value: -1}},
		},
	}

	if _, err := coll.Indexes().CreateMany(ctx, indexes); err != nil {
		log.Warn().Err(err).Msg("MongoDB: failed to create indexes on raw_signals")
	}
}

// Insert stores a raw signal batch, stamping CreatedAt with the capture time.
func (r *RawTelemetryRepo) Insert(ctx context.Context, rec *telemetrymodel.RawTelemetrySignal) error {
	if rec == nil {
		return fmt.Errorf("insert raw signal: nil record")
	}
	rec.CreatedAt = time.Now().UTC()
	if err := r.coll.InsertOne(ctx, rec); err != nil {
		return fmt.Errorf("insert raw signal: %w", err)
	}
	return nil
}

// GetByVIN returns captured signals for a specific VIN, newest first.
func (r *RawTelemetryRepo) GetByVIN(ctx context.Context, vin string, limit, offset int64) ([]*telemetrymodel.RawTelemetrySignal, error) {
	results, err := r.coll.Find(ctx, bson.M{"vin": vin}, sortRawByCreatedDesc, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("find raw signals by vin: %w", err)
	}
	return results, nil
}

// GetAll returns all captured signals, newest first.
func (r *RawTelemetryRepo) GetAll(ctx context.Context, limit, offset int64) ([]*telemetrymodel.RawTelemetrySignal, error) {
	results, err := r.coll.Find(ctx, bson.M{}, sortRawByCreatedDesc, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("find raw signals: %w", err)
	}
	return results, nil
}

// Count returns the total number of captured documents.
func (r *RawTelemetryRepo) Count(ctx context.Context) (int64, error) {
	count, err := r.coll.Count(ctx, bson.M{})
	if err != nil {
		return 0, fmt.Errorf("count raw signals: %w", err)
	}
	return count, nil
}

// CaptureStats holds aggregate info about captured telemetry.
type CaptureStats struct {
	TotalDocuments int64    `json:"total_documents"`
	DistinctVINs   []string `json:"distinct_vins"`
}

// Stats returns aggregate statistics.
func (r *RawTelemetryRepo) Stats(ctx context.Context) (*CaptureStats, error) {
	count, err := r.Count(ctx)
	if err != nil {
		return nil, err
	}

	vins, err := r.coll.Distinct(ctx, "vin", bson.M{})
	if err != nil {
		return nil, fmt.Errorf("distinct raw signal vins: %w", err)
	}

	return &CaptureStats{
		TotalDocuments: count,
		DistinctVINs:   vins,
	}, nil
}

// Drop removes all captured data by dropping the collection.
func (r *RawTelemetryRepo) Drop(ctx context.Context) error {
	if err := r.coll.Drop(ctx); err != nil {
		return fmt.Errorf("drop raw signals: %w", err)
	}
	return nil
}

// StreamAll returns a cursor over all documents for export, oldest first. The
// caller owns closing the returned cursor.
func (r *RawTelemetryRepo) StreamAll(ctx context.Context) (*mongo.Cursor, error) {
	cursor, err := r.coll.Stream(ctx, sortRawByCreatedAsc)
	if err != nil {
		return nil, fmt.Errorf("stream raw signals: %w", err)
	}
	return cursor, nil
}
