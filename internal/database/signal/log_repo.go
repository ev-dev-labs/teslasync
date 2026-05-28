package signal

import (
	"context"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
)

const signalLogCollection = "signal_log"

// SignalLogEntry represents a single signal value at a point in time.
type SignalLogEntry struct {
	VehicleID int64     `bson:"vehicle_id" json:"vehicle_id"`
	Signal    string    `bson:"signal" json:"signal"`
	ValueNum  *float64  `bson:"value_num,omitempty" json:"value_num,omitempty"`
	ValueStr  *string   `bson:"value_str,omitempty" json:"value_str,omitempty"`
	ValueBool *bool     `bson:"value_bool,omitempty" json:"value_bool,omitempty"`
	Timestamp time.Time `bson:"timestamp" json:"timestamp"`
}

// SignalLogRepo stores per-signal telemetry data in MongoDB for full history.
type SignalLogRepo struct {
	coll *mongo.Collection
}

// NewSignalLogRepo creates the repo and ensures indexes.
func NewSignalLogRepo(mc *database.MongoClient) *SignalLogRepo {
	coll := mc.Database().Collection(signalLogCollection)
	repo := &SignalLogRepo{coll: coll}
	repo.ensureIndexes()
	return repo
}

func (r *SignalLogRepo) ensureIndexes() {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	indexes := []mongo.IndexModel{
		{
			Keys: bson.D{
				{Key: "vehicle_id", Value: 1},
				{Key: "signal", Value: 1},
				{Key: "timestamp", Value: -1},
			},
		},
		{
			Keys: bson.D{{Key: "timestamp", Value: -1}},
		},
	}

	if _, err := r.coll.Indexes().CreateMany(ctx, indexes); err != nil {
		log.Warn().Err(err).Msg("MongoDB: failed to create indexes on signal_log")
	}
}

// WriteBatch writes multiple signal values from a single telemetry batch.
// Each signal in the map becomes a separate document for granular querying.
func (r *SignalLogRepo) WriteBatch(ctx context.Context, vehicleID int64, signals map[string]interface{}) error {
	now := time.Now().UTC()
	docs := make([]interface{}, 0, len(signals))

	for name, value := range signals {
		if value == nil {
			continue
		}
		// Skip invalid markers
		if m, isMap := value.(map[string]interface{}); isMap {
			if inv, has := m["invalid"]; has {
				if b, isBool := inv.(bool); isBool && b {
					continue
				}
			}
		}

		entry := SignalLogEntry{
			VehicleID: vehicleID,
			Signal:    name,
			Timestamp: now,
		}

		switch v := value.(type) {
		case float64:
			entry.ValueNum = &v
		case int:
			f := float64(v)
			entry.ValueNum = &f
		case int64:
			f := float64(v)
			entry.ValueNum = &f
		case bool:
			entry.ValueBool = &v
		case string:
			if v != "" && v != "<nil>" && v != "nil" && v != "null" {
				entry.ValueStr = &v
			} else {
				continue
			}
		case map[string]interface{}:
			// Location and other map values — skip in signal_log (handled by specific fields)
			continue
		default:
			s := func() string { return "" }()
			_ = s
			continue
		}

		docs = append(docs, entry)
	}

	if len(docs) == 0 {
		return nil
	}

	opts := options.InsertMany().SetOrdered(false)
	_, err := r.coll.InsertMany(ctx, docs, opts)
	return err
}

// SignalHistoryQuery defines parameters for querying signal history.
type SignalHistoryQuery struct {
	VehicleID int64
	Signal    string
	From      time.Time
	To        time.Time
	Limit     int64
}

// SignalHistoryPoint is a single data point in a signal's history.
type SignalHistoryPoint struct {
	Timestamp time.Time `bson:"timestamp" json:"timestamp"`
	ValueNum  *float64  `bson:"value_num,omitempty" json:"value_num,omitempty"`
	ValueStr  *string   `bson:"value_str,omitempty" json:"value_str,omitempty"`
	ValueBool *bool     `bson:"value_bool,omitempty" json:"value_bool,omitempty"`
}

// GetHistory returns signal history for a vehicle within a time range.
func (r *SignalLogRepo) GetHistory(ctx context.Context, q SignalHistoryQuery) ([]SignalHistoryPoint, error) {
	filter := bson.M{
		"vehicle_id": q.VehicleID,
		"signal":     q.Signal,
		"timestamp": bson.M{
			"$gte": q.From,
			"$lte": q.To,
		},
	}

	limit := q.Limit
	if limit <= 0 || limit > 10000 {
		limit = 1000
	}

	opts := options.Find().
		SetSort(bson.D{{Key: "timestamp", Value: 1}}).
		SetLimit(limit).
		SetProjection(bson.D{
			{Key: "timestamp", Value: 1},
			{Key: "value_num", Value: 1},
			{Key: "value_str", Value: 1},
			{Key: "value_bool", Value: 1},
		})

	cursor, err := r.coll.Find(ctx, filter, opts)
	if err != nil {
		return nil, err
	}
	defer cursor.Close(ctx)

	var points []SignalHistoryPoint
	if err := cursor.All(ctx, &points); err != nil {
		return nil, err
	}
	return points, nil
}

// GetAvailableSignals returns the list of signal names that have data for a vehicle.
func (r *SignalLogRepo) GetAvailableSignals(ctx context.Context, vehicleID int64) ([]string, error) {
	result := r.coll.Distinct(ctx, "signal", bson.M{"vehicle_id": vehicleID})
	if result.Err() != nil {
		return nil, result.Err()
	}

	var raw []interface{}
	if err := result.Decode(&raw); err != nil {
		return nil, err
	}
	signals := make([]string, 0, len(raw))
	for _, v := range raw {
		if s, ok := v.(string); ok {
			signals = append(signals, s)
		}
	}
	return signals, nil
}

// GetStats returns document count and date range for a vehicle.
func (r *SignalLogRepo) GetStats(ctx context.Context, vehicleID int64) (int64, *time.Time, *time.Time, error) {
	filter := bson.M{"vehicle_id": vehicleID}
	count, err := r.coll.CountDocuments(ctx, filter)
	if err != nil {
		return 0, nil, nil, err
	}
	if count == 0 {
		return 0, nil, nil, nil
	}

	// Get oldest
	var oldest SignalLogEntry
	opts := options.FindOne().SetSort(bson.D{{Key: "timestamp", Value: 1}})
	if err := r.coll.FindOne(ctx, filter, opts).Decode(&oldest); err != nil {
		return count, nil, nil, nil
	}

	// Get newest
	var newest SignalLogEntry
	opts = options.FindOne().SetSort(bson.D{{Key: "timestamp", Value: -1}})
	if err := r.coll.FindOne(ctx, filter, opts).Decode(&newest); err != nil {
		return count, &oldest.Timestamp, nil, nil
	}

	return count, &oldest.Timestamp, &newest.Timestamp, nil
}
