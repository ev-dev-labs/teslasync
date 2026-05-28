package database

import (
	"context"
	"time"

	telemetrymodel "github.com/ev-dev-labs/teslasync/internal/models/telemetry"

	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const rawSignalsCollection = "raw_signals"

// RawTelemetryRepo stores raw telemetry signal batches in MongoDB.
type RawTelemetryRepo struct {
	coll *mongo.Collection
}

// NewRawTelemetryRepo creates the repo and ensures indexes (including TTL).
func NewRawTelemetryRepo(mc *MongoClient) *RawTelemetryRepo {
	coll := mc.Database().Collection(rawSignalsCollection)
	repo := &RawTelemetryRepo{coll: coll}
	repo.ensureIndexes(mc.TTLDays())
	return repo
}

func (r *RawTelemetryRepo) ensureIndexes(ttlDays int) {
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

	if _, err := r.coll.Indexes().CreateMany(ctx, indexes); err != nil {
		log.Warn().Err(err).Msg("MongoDB: failed to create indexes on raw_signals")
	}
}

// Insert stores a raw signal batch.
func (r *RawTelemetryRepo) Insert(ctx context.Context, rec *telemetrymodel.RawTelemetrySignal) error {
	rec.CreatedAt = time.Now().UTC()
	_, err := r.coll.InsertOne(ctx, rec)
	return err
}

// GetByVIN returns captured signals for a specific VIN, newest first.
func (r *RawTelemetryRepo) GetByVIN(ctx context.Context, vin string, limit, offset int64) ([]*telemetrymodel.RawTelemetrySignal, error) {
	filter := bson.M{"vin": vin}
	opts := options.Find().
		SetSort(bson.D{{Key: "created_at", Value: -1}}).
		SetLimit(limit).
		SetSkip(offset)

	cursor, err := r.coll.Find(ctx, filter, opts)
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

// GetAll returns all captured signals, newest first.
func (r *RawTelemetryRepo) GetAll(ctx context.Context, limit, offset int64) ([]*telemetrymodel.RawTelemetrySignal, error) {
	opts := options.Find().
		SetSort(bson.D{{Key: "created_at", Value: -1}}).
		SetLimit(limit).
		SetSkip(offset)

	cursor, err := r.coll.Find(ctx, bson.M{}, opts)
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

// Count returns the total number of captured documents.
func (r *RawTelemetryRepo) Count(ctx context.Context) (int64, error) {
	return r.coll.CountDocuments(ctx, bson.M{})
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

	result := r.coll.Distinct(ctx, "vin", bson.M{})
	if err := result.Err(); err != nil {
		return nil, err
	}

	var rawVINs []string
	if err := result.Decode(&rawVINs); err != nil {
		return nil, err
	}

	return &CaptureStats{
		TotalDocuments: count,
		DistinctVINs:   rawVINs,
	}, nil
}

// Drop removes all captured data by dropping the collection.
func (r *RawTelemetryRepo) Drop(ctx context.Context) error {
	return r.coll.Drop(ctx)
}

// StreamAll returns a cursor over all documents for export.
func (r *RawTelemetryRepo) StreamAll(ctx context.Context) (*mongo.Cursor, error) {
	opts := options.Find().SetSort(bson.D{{Key: "created_at", Value: 1}})
	return r.coll.Find(ctx, bson.M{}, opts)
}
