package teslausage

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/models"
)

// TeslaUsageRepo keeps only source evidence; pricing is applied at read time.
type TeslaUsageRepo struct{ db *database.DB }

func NewTeslaUsageRepo(db *database.DB) *TeslaUsageRepo { return &TeslaUsageRepo{db: db} }

// RecordSignal is best effort at the MQTT receive boundary. Deduplication
// covers QoS1 retransmissions, not distinct emissions with identical evidence.
func (r *TeslaUsageRepo) RecordSignal(ctx context.Context, topic string, emittedAt time.Time, payload []byte) error {
	topicHash, payloadHash := signalUsageFingerprints(topic, payload)
	_, err := r.db.Pool.Exec(ctx, `INSERT INTO tesla_stream_usage (topic, emitted_at, payload_sha256)
		VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, topicHash, emittedAt, payloadHash[:])
	if err != nil {
		return fmt.Errorf("record Tesla stream emission: %w", err)
	}

	return nil
}

func signalUsageFingerprints(topic string, payload []byte) (string, [sha256.Size]byte) {
	topicDigest := sha256.Sum256([]byte(topic))
	return fmt.Sprintf("%x", topicDigest), sha256.Sum256(payload)
}

const teslaCycle = 30 * 24 * time.Hour

// UTC windows are fixed 30-day intervals since Unix epoch, never local months.
func TeslaCycleStart(now time.Time) time.Time {
	seconds := int64(teslaCycle / time.Second)
	n := now.UTC().Unix()
	remainder := n % seconds
	if remainder < 0 {
		remainder += seconds
	}
	return time.Unix(n-remainder, 0).UTC()
}

// Billable category attribution is deliberately conservative. Partner/auth,
// specs, telemetry configuration and all unrelated requests are excluded.
func billableTeslaRequest(method, raw string) string {
	u, err := url.Parse(raw)
	if err != nil {
		return ""
	}

	path := u.Path
	if !strings.HasPrefix(path, "/api/1/vehicles/") {
		return ""
	}
	if strings.HasSuffix(path, "/vehicle_data") && method == "GET" {
		return "data"
	}
	if strings.HasSuffix(path, "/wake_up") && method == "POST" {
		return "wake"
	}
	if method == "POST" && strings.Contains(path, "/command/") {
		return "command"
	}
	return ""
}

// A proxy's 4xx can be a local authorization/transport rejection before
// Tesla ever sees the command. Only successful proxy command responses are
// usable evidence; direct Fleet 4xx attempts remain separately billable.
func billableTeslaAudit(service, method, endpoint string, status int) string {
	if status <= 0 || status >= 500 {
		return ""
	}
	category := billableTeslaRequest(method, endpoint)
	// Before proxy callbacks were tagged separately, the audit sink wrote
	// absolute proxy URLs as "tesla-api". Do not mistake those historical
	// proxy-side 4xx responses for direct Fleet responses.
	if service == "tesla-api" {
		if u, err := url.Parse(endpoint); err == nil && u.Host != "" &&
			!strings.HasSuffix(strings.ToLower(u.Hostname()), ".tesla.com") {
			service = "tesla-command-proxy"
		}
	}
	if service == "tesla-command-proxy" {
		if status < 200 || status >= 300 || category != "command" {
			return ""
		}
	} else if service != "tesla-api" {
		return ""
	}
	return category
}

func (r *TeslaUsageRepo) Cycles(ctx context.Context, now time.Time, limit, offset int) (*models.TeslaUsageResponse, error) {
	start := TeslaCycleStart(now)
	earliest := start.Add(-time.Duration(limit+offset) * teslaCycle)
	end := start.Add(teslaCycle)
	cycles := make([]models.TeslaUsageCycle, limit+offset+1)
	lastObserved := -1
	for i := range cycles {
		cycles[i] = models.TeslaUsageCycle{Start: start.Add(-time.Duration(i) * teslaCycle), End: end.Add(-time.Duration(i) * teslaCycle)}
	}
	rows, err := r.db.Pool.Query(ctx, `SELECT ts, service, http_method, endpoint, status_code FROM api_call_logs
		WHERE service IN ($1, $2) AND ts >= $3 AND ts < $4 AND status_code > 0 AND status_code < 500`,
		"tesla-api", "tesla-command-proxy", earliest, end)
	if err != nil {
		return nil, fmt.Errorf("read Tesla outbound calls: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var ts time.Time
		var service, method, endpoint string
		var status int
		if err = rows.Scan(&ts, &service, &method, &endpoint, &status); err != nil {
			break
		}
		idx := int(start.Sub(TeslaCycleStart(ts)) / teslaCycle)
		if idx < 0 || idx >= len(cycles) {
			continue
		}
		switch billableTeslaAudit(service, method, endpoint, status) {
		case "data":
			cycles[idx].DataRequests++
		case "wake":
			cycles[idx].Wakes++
		case "command":
			cycles[idx].Commands++
		}
		if cycles[idx].DataRequests+cycles[idx].Wakes+cycles[idx].Commands > 0 && idx > lastObserved {
			lastObserved = idx
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("scan Tesla outbound calls: %w", err)
	}
	rows, err = r.db.Pool.Query(ctx, `SELECT floor(extract(epoch from received_at) / 2592000)::bigint, count(*)
		FROM tesla_stream_usage WHERE received_at >= $1 AND received_at < $2 GROUP BY 1`, earliest, end)
	if err != nil {
		return nil, fmt.Errorf("read Tesla stream emissions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var bucket int64
		var count int64
		if err = rows.Scan(&bucket, &count); err != nil {
			break
		}
		idx := int(start.Unix()/int64(teslaCycle/time.Second) - bucket)
		if idx >= 0 && idx < len(cycles) {
			cycles[idx].Signals += count
			if idx > lastObserved {
				lastObserved = idx
			}
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return nil, fmt.Errorf("scan Tesla stream emissions: %w", err)
	}
	for i := range cycles {
		c := &cycles[i]
		c.EstimatedUSD = estimateTeslaUSD(*c)
	}

	return &models.TeslaUsageResponse{
		Current: cycles[0], History: observedHistory(cycles, offset, lastObserved),
		RateSource: "https://developer.tesla.com/",
		Disclaimer: "Estimated from locally observed Tesla Fleet traffic only; not an invoice or Tesla billing cycle. Missing deliveries, logging failures, and Tesla billing adjustments are not included.",
	}, nil
}

func observedHistory(cycles []models.TeslaUsageCycle, offset, lastObserved int) []models.TeslaUsageCycle {
	history := []models.TeslaUsageCycle{}
	if lastObserved > offset && offset+1 < len(cycles) {
		history = append(history, cycles[1+offset:min(len(cycles), lastObserved+1)]...)
	}
	return history
}

func estimateTeslaUSD(c models.TeslaUsageCycle) float64 {
	return float64(c.Signals)/150000 + float64(c.Commands)/1000 +
		float64(c.DataRequests)/500 + float64(c.Wakes)/50
}
