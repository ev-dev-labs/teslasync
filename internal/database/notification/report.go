package notification

import (
	"context"
	"fmt"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// ReportKeyCount uses trigger counts for source/type/severity and delivery
// counts for channel/status. Unknown historical attribution is never guessed.
type ReportKeyCount struct {
	Key   string `json:"key"`
	Count int64  `json:"count"`
}

type ReportDay struct {
	Day        string `json:"day"`
	Triggered  int64  `json:"triggered"`
	Deliveries int64  `json:"deliveries"`
}

type Report struct {
	From                   string           `json:"from"`
	To                     string           `json:"to"`
	FromInstant            string           `json:"from_instant"`
	ToExclusive            string           `json:"to_exclusive"`
	Triggered              int64            `json:"triggered"`
	Deliveries             int64            `json:"deliveries"`
	OutboundHTTPCalls      int64            `json:"outbound_http_calls"`
	UncorrelatedDeliveries int64            `json:"uncorrelated_deliveries"`
	BySource               []ReportKeyCount `json:"by_source"`
	ByType                 []ReportKeyCount `json:"by_type"`
	BySeverity             []ReportKeyCount `json:"by_severity"`
	ByChannel              []ReportKeyCount `json:"by_channel"`
	ByStatus               []ReportKeyCount `json:"by_status"`
	Daily                  []ReportDay      `json:"daily"`
}

// Canonical event rows provide the trigger count, including zero-channel and
// WebPush-only firings. Per-channel rows provide the delivery count, including
// historical rows whose trigger cannot be reconstructed safely.
const reportSQL = `
WITH deliveries AS (
  SELECT nl.trigger_id, nl.event_type, nl.severity, nl.status, nl.channel_id, nl.created_at
  FROM notification_logs nl
  WHERE nl.created_at >= $1 AND nl.created_at < $2 AND nl.status <> 'triggered'
), events AS (
  SELECT nl.trigger_id, nl.event_type, nl.severity, nl.created_at
  FROM notification_logs nl
  WHERE nl.created_at >= $1 AND nl.created_at < $2 AND nl.status = 'triggered'
), triggers AS (
  SELECT trigger_id, MIN(created_at) AS fired_at,
         MIN(COALESCE(event_type, '')) AS event_type,
         MIN(COALESCE(severity, '')) AS severity
  FROM events GROUP BY trigger_id
), classified AS (
  SELECT fired_at, COALESCE(NULLIF(event_type, ''), 'unknown') AS event_type,
    COALESCE(NULLIF(severity, ''), 'unknown') AS severity,
    CASE WHEN event_type = '' THEN 'unknown'
         WHEN event_type LIKE 'alert.%' THEN 'alert'
         WHEN event_type LIKE 'system.%' THEN 'system'
         WHEN event_type LIKE 'schedule.%' THEN 'schedule'
         WHEN event_type LIKE 'automation.%' THEN 'automation'
         WHEN event_type LIKE 'test.%' THEN 'test'
         ELSE 'other' END AS source
  FROM triggers
), aggregates AS (
  SELECT 'triggered' AS dimension, '' AS key, '' AS day, COUNT(*)::bigint AS n FROM classified
  UNION ALL SELECT 'deliveries', '', '', COUNT(*)::bigint FROM deliveries
  UNION ALL SELECT 'outbound_http_calls', '', '', COUNT(*)::bigint FROM api_call_logs
    WHERE service = 'notify-generic' AND ts >= $1 AND ts < $2
  UNION ALL SELECT 'uncorrelated', '', '', COUNT(*)::bigint FROM deliveries WHERE trigger_id IS NULL
  UNION ALL SELECT 'source', source, '', COUNT(*)::bigint FROM classified GROUP BY source
  UNION ALL SELECT 'type', event_type, '', COUNT(*)::bigint FROM classified GROUP BY event_type
  UNION ALL SELECT 'severity', severity, '', COUNT(*)::bigint FROM classified GROUP BY severity
  UNION ALL SELECT 'channel', COALESCE(c.kind::text, 'unknown'), '', COUNT(*)::bigint
    FROM deliveries d LEFT JOIN notification_channels c ON c.id = d.channel_id GROUP BY COALESCE(c.kind::text, 'unknown')
  UNION ALL SELECT 'status', status, '', COUNT(*)::bigint FROM deliveries GROUP BY status
  UNION ALL SELECT 'daily_triggered', '', to_char(fired_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), COUNT(*)::bigint
    FROM classified GROUP BY 3
  UNION ALL SELECT 'daily_deliveries', '', to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD'), COUNT(*)::bigint
    FROM deliveries GROUP BY 3
)
SELECT dimension, key, day, n FROM aggregates ORDER BY dimension, key, day`

// GetReport aggregates a UTC, half-open time range in SQL. Rows returned are
// bounded by the number of dimension keys and UTC days, not deliveries.
func (r *NotificationRepo) GetReport(ctx context.Context, from, until time.Time) (*Report, error) {
	return queryReport(ctx, r.db, from, until)
}

func queryReport(ctx context.Context, db *database.DB, from, until time.Time) (*Report, error) {
	rows, err := db.Pool.Query(ctx, reportSQL, from.UTC(), until.UTC())
	if err != nil {
		return nil, fmt.Errorf("query notification report: %w", err)
	}
	defer rows.Close()
	report := &Report{
		From: from.UTC().Format(time.DateOnly), To: until.UTC().Add(-time.Nanosecond).Format(time.DateOnly),
		FromInstant: from.UTC().Format(time.RFC3339Nano), ToExclusive: until.UTC().Format(time.RFC3339Nano),
		BySource: []ReportKeyCount{}, ByType: []ReportKeyCount{}, BySeverity: []ReportKeyCount{},
		ByChannel: []ReportKeyCount{}, ByStatus: []ReportKeyCount{}, Daily: []ReportDay{},
	}
	days := make(map[string]*ReportDay)
	for rows.Next() {
		var dimension, key, day string
		var count int64
		if err := rows.Scan(&dimension, &key, &day, &count); err != nil {
			return nil, fmt.Errorf("scan notification report: %w", err)
		}
		entry := ReportKeyCount{Key: key, Count: count}
		switch dimension {
		case "triggered":
			report.Triggered = count
		case "deliveries":
			report.Deliveries = count
		case "outbound_http_calls":
			report.OutboundHTTPCalls = count
		case "uncorrelated":
			report.UncorrelatedDeliveries = count
		case "source":
			report.BySource = append(report.BySource, entry)
		case "type":
			report.ByType = append(report.ByType, entry)
		case "severity":
			report.BySeverity = append(report.BySeverity, entry)
		case "channel":
			report.ByChannel = append(report.ByChannel, entry)
		case "status":
			report.ByStatus = append(report.ByStatus, entry)
		case "daily_triggered", "daily_deliveries":
			if days[day] == nil {
				days[day] = &ReportDay{Day: day}
			}
			if dimension == "daily_triggered" {
				days[day].Triggered = count
			} else {
				days[day].Deliveries = count
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iterate notification report: %w", err)
	}
	for date := from.UTC().Truncate(24 * time.Hour); date.Before(until.UTC()); date = date.AddDate(0, 0, 1) {
		key := date.Format(time.DateOnly)
		if days[key] == nil {
			days[key] = &ReportDay{Day: key}
		}
		report.Daily = append(report.Daily, *days[key])
	}
	return report, nil
}
