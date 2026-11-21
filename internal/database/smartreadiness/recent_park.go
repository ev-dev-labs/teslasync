package smartreadiness

import (
	"context"
	"errors"
	"fmt"
	"time"

	domain "github.com/ev-dev-labs/teslasync/internal/domain/smartreadiness"
	"github.com/ev-dev-labs/teslasync/internal/signal"
	"github.com/ev-dev-labs/teslasync/internal/tesla/protomodel"
	"github.com/jackc/pgx/v5"
)

func (r *Repository) LatestRecentPark(ctx context.Context, vehicleID int64, earliest, now time.Time) (*domain.RecentPark, error) {
	var park domain.RecentPark
	err := r.db.Pool.QueryRow(ctx, `SELECT id,ended_at FROM (
		SELECT id,started_at,ended_at FROM drives WHERE vehicle_id=$1 AND started_at<=$3
		ORDER BY started_at DESC,id DESC LIMIT 1
	) latest WHERE ended_at>started_at AND ended_at>$2 AND ended_at<=$3`, vehicleID, earliest, now).
		Scan(&park.DriveID, &park.EndedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("find recent completed park: %w", err)
	}
	return &park, nil
}

// RecentParkObservations keeps individually attested Fields even if another field invalidates the group receipt.
func (r *Repository) RecentParkObservations(ctx context.Context, vehicleID int64, fields []string, from, to time.Time) ([]signal.TimelineRow, error) {
	const maxEvents = 1000
	rows, err := r.db.Pool.Query(ctx, `SELECT ts,field,value_kind,bool_value,str_value,float_value,source_emitted_at,received_at
			FROM signal_log WHERE vehicle_id=$1 AND field=ANY($2) AND ts>=$3 AND ts<=$4
			ORDER BY ts,field LIMIT $5`, vehicleID, fields, from, to, maxEvents+1)
	if err != nil {
		return nil, fmt.Errorf("query recent park observations: %w", err)
	}
	defer rows.Close()
	var result []signal.TimelineRow
	count := 0
	validGroup := false
	for rows.Next() {
		count++
		if count > maxEvents {
			return nil, signal.ErrTimelineEventLimit
		}
		var ts time.Time
		var field string
		var kind protomodel.ValueKind
		var flag *bool
		var text *string
		var number *float64
		var source, received *time.Time
		if err := rows.Scan(&ts, &field, &kind, &flag, &text, &number, &source, &received); err != nil {
			return nil, fmt.Errorf("scan recent park observation: %w", err)
		}
		if len(result) == 0 || !result[len(result)-1].Timestamp.Equal(ts) {
			result = append(result, signal.TimelineRow{Timestamp: ts, Fields: make(signal.State), ObservedAt: make(map[string]time.Time)})
			validGroup = true
		}
		current := &result[len(result)-1]
		current.ObservedAt[field] = ts
		if source == nil || !source.Equal(ts) || received == nil || received.After(to) ||
			received.Before(ts.Add(-signal.LiveSignalFreshnessThreshold)) || received.After(ts.Add(signal.LiveSignalFreshnessThreshold)) {
			validGroup = false
			current.ReceivedAt = nil
			continue
		}
		if validGroup && (current.ReceivedAt == nil || received.After(*current.ReceivedAt)) {
			current.ReceivedAt = received
		}
		switch {
		case kind == protomodel.ValueKindBool && flag != nil:
			current.Fields[field] = *flag
		case kind == protomodel.ValueKindString && text != nil:
			current.Fields[field] = *text
		case (kind == protomodel.ValueKindFloat || kind == protomodel.ValueKindDouble) && number != nil:
			current.Fields[field] = *number
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("read recent park observations: %w", err)
	}
	return result, nil
}
