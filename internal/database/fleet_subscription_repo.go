package database

import (
	"context"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

type FleetSubscriptionRepo struct {
	db *DB
}

func NewFleetSubscriptionRepo(db *DB) *FleetSubscriptionRepo {
	return &FleetSubscriptionRepo{db: db}
}

func (r *FleetSubscriptionRepo) Create(ctx context.Context, sub *models.FleetTelemetrySubscription) error {
	query := `
		INSERT INTO fleet_telemetry_subscriptions (
			vehicle_id, vin, signals, interval_seconds, hostname, port, protocol,
			ca_pem, subscribed_at, expires_at, status, response_code, response_body
		) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
		RETURNING id`
	return r.db.Pool.QueryRow(ctx, query,
		sub.VehicleID, sub.VIN, sub.Signals, sub.IntervalSeconds,
		sub.Hostname, sub.Port, sub.Protocol, sub.CaPEM,
		sub.SubscribedAt, sub.ExpiresAt, sub.Status,
		sub.ResponseCode, sub.ResponseBody,
	).Scan(&sub.ID)
}

func (r *FleetSubscriptionRepo) GetLatestByVIN(ctx context.Context, vin string) (*models.FleetTelemetrySubscription, error) {
	query := `SELECT id, vehicle_id, vin, signals, interval_seconds, hostname, port, protocol,
		ca_pem, subscribed_at, expires_at, status, response_code, response_body, created_at
		FROM fleet_telemetry_subscriptions WHERE vin = $1
		ORDER BY created_at DESC LIMIT 1`
	sub := &models.FleetTelemetrySubscription{}
	err := r.db.Pool.QueryRow(ctx, query, vin).Scan(
		&sub.ID, &sub.VehicleID, &sub.VIN, &sub.Signals, &sub.IntervalSeconds,
		&sub.Hostname, &sub.Port, &sub.Protocol, &sub.CaPEM,
		&sub.SubscribedAt, &sub.ExpiresAt, &sub.Status,
		&sub.ResponseCode, &sub.ResponseBody, &sub.CreatedAt,
	)
	if err != nil {
		return nil, err
	}
	return sub, nil
}

func (r *FleetSubscriptionRepo) List(ctx context.Context, limit int) ([]*models.FleetTelemetrySubscription, error) {
	query := `SELECT id, vehicle_id, vin, signals, interval_seconds, hostname, port, protocol,
		ca_pem, subscribed_at, expires_at, status, response_code, response_body, created_at
		FROM fleet_telemetry_subscriptions
		ORDER BY created_at DESC LIMIT $1`
	rows, err := r.db.Pool.Query(ctx, query, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var subs []*models.FleetTelemetrySubscription
	for rows.Next() {
		sub := &models.FleetTelemetrySubscription{}
		if err := rows.Scan(
			&sub.ID, &sub.VehicleID, &sub.VIN, &sub.Signals, &sub.IntervalSeconds,
			&sub.Hostname, &sub.Port, &sub.Protocol, &sub.CaPEM,
			&sub.SubscribedAt, &sub.ExpiresAt, &sub.Status,
			&sub.ResponseCode, &sub.ResponseBody, &sub.CreatedAt,
		); err != nil {
			return nil, err
		}
		subs = append(subs, sub)
	}
	return subs, rows.Err()
}
