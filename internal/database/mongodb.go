package database

import (
	"context"
	"fmt"
	"time"

	"github.com/rs/zerolog/log"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"go.mongodb.org/mongo-driver/v2/mongo/options"
	"go.mongodb.org/mongo-driver/v2/mongo/readpref"

	"github.com/ev-dev-labs/teslasync/internal/config"
)

// MongoClient wraps a MongoDB connection for raw telemetry capture.
type MongoClient struct {
	client   *mongo.Client
	database *mongo.Database
	ttlDays  int
}

// NewMongoClient connects to MongoDB and returns a client wrapper.
func NewMongoClient(cfg config.MongoDBConfig) (*MongoClient, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()

	client, err := mongo.Connect(options.Client().ApplyURI(cfg.URI))
	if err != nil {
		return nil, fmt.Errorf("mongo connect: %w", err)
	}

	if err := client.Ping(ctx, readpref.Primary()); err != nil {
		return nil, fmt.Errorf("mongo ping: %w", err)
	}

	log.Info().Str("database", cfg.Database).Msg("MongoDB connected")

	return &MongoClient{
		client:   client,
		database: client.Database(cfg.Database),
		ttlDays:  cfg.TTLDays,
	}, nil
}

func (mc *MongoClient) Database() *mongo.Database {
	return mc.database
}

func (mc *MongoClient) TTLDays() int {
	return mc.ttlDays
}

func (mc *MongoClient) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := mc.client.Disconnect(ctx); err != nil {
		log.Warn().Err(err).Msg("MongoDB disconnect error")
	}
	log.Info().Msg("MongoDB disconnected")
}
