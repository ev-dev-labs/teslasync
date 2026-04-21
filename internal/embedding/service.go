// Package embedding provides semantic-search infrastructure for TeslaSync.
//
// It generates vector embeddings for vehicle-related entities (drives, charging
// sessions, alerts, daily rollups) and stores them in the pgvector-backed
// `embeddings` table so the chatbot can retrieve relevant context for natural
// language questions via nearest-neighbor similarity.
package embedding

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/rs/zerolog/log"

	"github.com/ev-dev-labs/teslasync/internal/database"
)

// Provider abstracts an embedding generator. Implementations turn raw text
// into fixed-dimension float vectors.
type Provider interface {
	// Embed returns the embedding for a single piece of text.
	Embed(ctx context.Context, text string) ([]float32, error)
	// EmbedBatch returns embeddings for multiple texts in a single call.
	EmbedBatch(ctx context.Context, texts []string) ([][]float32, error)
	// Dimensions returns the length of the vectors produced.
	Dimensions() int
	// Model identifier used for logging/metadata.
	Model() string
}

// SearchResult is a single nearest-neighbor match from the embeddings table.
type SearchResult struct {
	EntityType string                 `json:"entity_type"`
	EntityID   int64                  `json:"entity_id"`
	VehicleID  int64                  `json:"vehicle_id"`
	Content    string                 `json:"content"`
	Metadata   map[string]interface{} `json:"metadata,omitempty"`
	Similarity float64                `json:"similarity"`
}

// Service owns the embeddings table and exposes generate/search operations.
type Service struct {
	db       *database.DB
	provider Provider
}

// NewService constructs an embedding service. provider may be nil, in which
// case write operations return an error and search still works against
// previously-stored embeddings (useful when the feature is disabled at runtime).
func NewService(db *database.DB, provider Provider) *Service {
	return &Service{db: db, provider: provider}
}

// Enabled reports whether a live embedding provider is attached.
func (s *Service) Enabled() bool { return s != nil && s.provider != nil }

// vectorLiteral renders a []float32 in pgvector's text format: "[1.23,4.56,...]".
// We pass this as a text parameter and cast to `vector` inside the SQL so the
// driver does not need pgvector-specific codecs.
func vectorLiteral(v []float32) string {
	var b strings.Builder
	b.Grow(len(v)*8 + 2)
	b.WriteByte('[')
	for i, f := range v {
		if i > 0 {
			b.WriteByte(',')
		}
		b.WriteString(strconv.FormatFloat(float64(f), 'f', -1, 32))
	}
	b.WriteByte(']')
	return b.String()
}

// upsert inserts or updates a single embedding row.
func (s *Service) upsert(ctx context.Context, entityType string, entityID, vehicleID int64, content string, vec []float32, metadata map[string]interface{}) error {
	if metadata == nil {
		metadata = map[string]interface{}{}
	}
	metaJSON, err := json.Marshal(metadata)
	if err != nil {
		return fmt.Errorf("marshal metadata: %w", err)
	}
	_, err = s.db.Pool.Exec(ctx, `
		INSERT INTO embeddings (entity_type, entity_id, vehicle_id, content, embedding, metadata)
		VALUES ($1, $2, $3, $4, $5::vector, $6::jsonb)
		ON CONFLICT (entity_type, entity_id)
		DO UPDATE SET content    = EXCLUDED.content,
		              embedding  = EXCLUDED.embedding,
		              metadata   = EXCLUDED.metadata,
		              updated_at = NOW()
	`, entityType, entityID, vehicleID, content, vectorLiteral(vec), string(metaJSON))
	if err != nil {
		return fmt.Errorf("upsert embedding (%s:%d): %w", entityType, entityID, err)
	}
	return nil
}

// Search returns the top-N most similar embeddings to the supplied query text
// for the given vehicle. When vehicleID is 0 the filter is dropped and results
// may span all vehicles.
func (s *Service) Search(ctx context.Context, query string, vehicleID int64, limit int) ([]SearchResult, error) {
	if s.provider == nil {
		return nil, fmt.Errorf("embedding provider not configured")
	}
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	vec, err := s.provider.Embed(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("embed query: %w", err)
	}

	var rows pgx.Rows
	if vehicleID > 0 {
		rows, err = s.db.Pool.Query(ctx, `
			SELECT entity_type, entity_id, vehicle_id, content, metadata,
			       1 - (embedding <=> $1::vector) AS similarity
			FROM embeddings
			WHERE vehicle_id = $2 AND embedding IS NOT NULL
			ORDER BY embedding <=> $1::vector
			LIMIT $3
		`, vectorLiteral(vec), vehicleID, limit)
	} else {
		rows, err = s.db.Pool.Query(ctx, `
			SELECT entity_type, entity_id, vehicle_id, content, metadata,
			       1 - (embedding <=> $1::vector) AS similarity
			FROM embeddings
			WHERE embedding IS NOT NULL
			ORDER BY embedding <=> $1::vector
			LIMIT $2
		`, vectorLiteral(vec), limit)
	}
	if err != nil {
		return nil, fmt.Errorf("search embeddings: %w", err)
	}
	defer rows.Close()

	var out []SearchResult
	for rows.Next() {
		var r SearchResult
		var metaBytes []byte
		if err := rows.Scan(&r.EntityType, &r.EntityID, &r.VehicleID, &r.Content, &metaBytes, &r.Similarity); err != nil {
			return nil, fmt.Errorf("scan search row: %w", err)
		}
		if len(metaBytes) > 0 {
			_ = json.Unmarshal(metaBytes, &r.Metadata)
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// --------------------------------------------------------------------------
// Content builders — convert DB rows into the human-readable descriptions that
// are embedded. Keeping them as free functions (rather than tied to the
// specific models package) lets us reuse them from SQL-level batch workers
// without importing large models.
// --------------------------------------------------------------------------

// BuildDriveContent produces a natural-language summary of a drive row.
func BuildDriveContent(startDate time.Time, distanceKm, durationMin, avgSpeed, maxSpeed float64, startSOC, endSOC *int, startAddr, endAddr string) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Drive on %s: %.1f km in %.0f min",
		startDate.Format("Jan 2, 2006 3:04 PM"), distanceKm, durationMin)
	if avgSpeed > 0 {
		fmt.Fprintf(&b, ", average speed %.0f km/h", avgSpeed)
	}
	if maxSpeed > 0 {
		fmt.Fprintf(&b, ", max speed %.0f km/h", maxSpeed)
	}
	if startSOC != nil && endSOC != nil {
		fmt.Fprintf(&b, ", battery %d%% → %d%%", *startSOC, *endSOC)
	}
	if startAddr != "" || endAddr != "" {
		fmt.Fprintf(&b, ", from %q to %q", startAddr, endAddr)
	}
	return b.String()
}

// BuildChargeContent produces a natural-language summary of a charging session.
func BuildChargeContent(startDate time.Time, energyKWh, durationMin float64, startSOC int, endSOC *int, location string, cost *float64) string {
	var b strings.Builder
	fmt.Fprintf(&b, "Charge on %s: added %.1f kWh over %.0f min starting at %d%%",
		startDate.Format("Jan 2, 2006 3:04 PM"), energyKWh, durationMin, startSOC)
	if endSOC != nil {
		fmt.Fprintf(&b, " ending at %d%%", *endSOC)
	}
	if location != "" {
		fmt.Fprintf(&b, ", location %q", location)
	}
	if cost != nil && *cost > 0 {
		fmt.Fprintf(&b, ", cost $%.2f", *cost)
	}
	return b.String()
}

// BuildAlertContent produces a natural-language summary of an alert.
func BuildAlertContent(createdAt time.Time, alertType, severity, title, message string) string {
	return fmt.Sprintf("Alert on %s — %s [%s] %s: %s",
		createdAt.Format("Jan 2, 2006 3:04 PM"), alertType, severity, title, message)
}

// --------------------------------------------------------------------------
// Batch worker — embeds any rows that do not yet have embeddings.
// --------------------------------------------------------------------------

// RunBatch embeds up to `limit` drives, `limit` charges and `limit` alerts
// that currently have no corresponding row in the embeddings table. It returns
// the total number of rows embedded, or the first error encountered.
func (s *Service) RunBatch(ctx context.Context, limit int) (int, error) {
	if s.provider == nil {
		return 0, fmt.Errorf("embedding provider not configured")
	}
	if limit <= 0 {
		limit = 50
	}

	total := 0
	if n, err := s.embedMissingDrives(ctx, limit); err != nil {
		return total, err
	} else {
		total += n
	}
	if n, err := s.embedMissingCharges(ctx, limit); err != nil {
		return total, err
	} else {
		total += n
	}
	if n, err := s.embedMissingAlerts(ctx, limit); err != nil {
		return total, err
	} else {
		total += n
	}
	return total, nil
}

func (s *Service) embedMissingDrives(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT d.id, d.vehicle_id, d.start_date, d.distance, d.duration_min,
		       COALESCE(d.speed_avg, 0), COALESCE(d.speed_max, 0),
		       d.start_battery_level, d.end_battery_level,
		       COALESCE(sa.display_name, ''), COALESCE(ea.display_name, '')
		FROM drives d
		LEFT JOIN embeddings e ON e.entity_type = 'drive' AND e.entity_id = d.id
		LEFT JOIN addresses sa ON sa.id = d.start_address_id
		LEFT JOIN addresses ea ON ea.id = d.end_address_id
		WHERE e.id IS NULL
		ORDER BY d.start_date DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("query missing drives: %w", err)
	}
	defer rows.Close()

	type driveRow struct {
		id, vehicleID         int64
		startDate             time.Time
		distance, durationMin float64
		avgSpeed, maxSpeed    float64
		startSOC, endSOC      *int
		startAddr, endAddr    string
		content               string
	}
	var batch []driveRow
	for rows.Next() {
		var d driveRow
		if err := rows.Scan(&d.id, &d.vehicleID, &d.startDate, &d.distance, &d.durationMin,
			&d.avgSpeed, &d.maxSpeed, &d.startSOC, &d.endSOC, &d.startAddr, &d.endAddr); err != nil {
			return 0, fmt.Errorf("scan drive: %w", err)
		}
		d.content = BuildDriveContent(d.startDate, d.distance, d.durationMin,
			d.avgSpeed, d.maxSpeed, d.startSOC, d.endSOC, d.startAddr, d.endAddr)
		batch = append(batch, d)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(batch) == 0 {
		return 0, nil
	}

	texts := make([]string, len(batch))
	for i, d := range batch {
		texts[i] = d.content
	}
	vecs, err := s.provider.EmbedBatch(ctx, texts)
	if err != nil {
		return 0, fmt.Errorf("embed drive batch: %w", err)
	}
	if len(vecs) != len(batch) {
		return 0, fmt.Errorf("embed drive batch: got %d vectors for %d inputs", len(vecs), len(batch))
	}

	count := 0
	for i, d := range batch {
		meta := map[string]interface{}{
			"distance":     d.distance,
			"duration_min": d.durationMin,
			"date":         d.startDate.Format("2006-01-02"),
		}
		if err := s.upsert(ctx, "drive", d.id, d.vehicleID, d.content, vecs[i], meta); err != nil {
			log.Warn().Err(err).Int64("drive_id", d.id).Msg("embed drive failed")
			continue
		}
		count++
	}
	return count, nil
}

func (s *Service) embedMissingCharges(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT c.id, c.vehicle_id, c.start_date, c.charge_energy_added, c.duration_min,
		       c.start_battery_level, c.end_battery_level,
		       COALESCE(c.location_name, COALESCE(a.display_name, '')), c.cost
		FROM charging_sessions c
		LEFT JOIN embeddings e ON e.entity_type = 'charge' AND e.entity_id = c.id
		LEFT JOIN addresses a ON a.id = c.address_id
		WHERE e.id IS NULL
		ORDER BY c.start_date DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("query missing charges: %w", err)
	}
	defer rows.Close()

	type chargeRow struct {
		id, vehicleID       int64
		startDate           time.Time
		energy, durationMin float64
		startSOC            int
		endSOC              *int
		location            string
		cost                *float64
		content             string
	}
	var batch []chargeRow
	for rows.Next() {
		var c chargeRow
		if err := rows.Scan(&c.id, &c.vehicleID, &c.startDate, &c.energy, &c.durationMin,
			&c.startSOC, &c.endSOC, &c.location, &c.cost); err != nil {
			return 0, fmt.Errorf("scan charge: %w", err)
		}
		c.content = BuildChargeContent(c.startDate, c.energy, c.durationMin,
			c.startSOC, c.endSOC, c.location, c.cost)
		batch = append(batch, c)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(batch) == 0 {
		return 0, nil
	}

	texts := make([]string, len(batch))
	for i, c := range batch {
		texts[i] = c.content
	}
	vecs, err := s.provider.EmbedBatch(ctx, texts)
	if err != nil {
		return 0, fmt.Errorf("embed charge batch: %w", err)
	}
	if len(vecs) != len(batch) {
		return 0, fmt.Errorf("embed charge batch: got %d vectors for %d inputs", len(vecs), len(batch))
	}

	count := 0
	for i, c := range batch {
		meta := map[string]interface{}{
			"energy_kwh":   c.energy,
			"duration_min": c.durationMin,
			"date":         c.startDate.Format("2006-01-02"),
		}
		if err := s.upsert(ctx, "charge", c.id, c.vehicleID, c.content, vecs[i], meta); err != nil {
			log.Warn().Err(err).Int64("charge_id", c.id).Msg("embed charge failed")
			continue
		}
		count++
	}
	return count, nil
}

func (s *Service) embedMissingAlerts(ctx context.Context, limit int) (int, error) {
	rows, err := s.db.Pool.Query(ctx, `
		SELECT a.id, COALESCE(a.vehicle_id, 0), a.created_at, a.type, a.severity, a.title, a.message
		FROM alerts a
		LEFT JOIN embeddings e ON e.entity_type = 'alert' AND e.entity_id = a.id
		WHERE e.id IS NULL AND a.vehicle_id IS NOT NULL
		ORDER BY a.created_at DESC
		LIMIT $1
	`, limit)
	if err != nil {
		return 0, fmt.Errorf("query missing alerts: %w", err)
	}
	defer rows.Close()

	type alertRow struct {
		id, vehicleID                   int64
		createdAt                       time.Time
		alertType, severity, title, msg string
		content                         string
	}
	var batch []alertRow
	for rows.Next() {
		var a alertRow
		if err := rows.Scan(&a.id, &a.vehicleID, &a.createdAt, &a.alertType, &a.severity, &a.title, &a.msg); err != nil {
			return 0, fmt.Errorf("scan alert: %w", err)
		}
		a.content = BuildAlertContent(a.createdAt, a.alertType, a.severity, a.title, a.msg)
		batch = append(batch, a)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	if len(batch) == 0 {
		return 0, nil
	}

	texts := make([]string, len(batch))
	for i, a := range batch {
		texts[i] = a.content
	}
	vecs, err := s.provider.EmbedBatch(ctx, texts)
	if err != nil {
		return 0, fmt.Errorf("embed alert batch: %w", err)
	}
	if len(vecs) != len(batch) {
		return 0, fmt.Errorf("embed alert batch: got %d vectors for %d inputs", len(vecs), len(batch))
	}

	count := 0
	for i, a := range batch {
		meta := map[string]interface{}{
			"type":     a.alertType,
			"severity": a.severity,
			"date":     a.createdAt.Format("2006-01-02"),
		}
		if err := s.upsert(ctx, "alert", a.id, a.vehicleID, a.content, vecs[i], meta); err != nil {
			log.Warn().Err(err).Int64("alert_id", a.id).Msg("embed alert failed")
			continue
		}
		count++
	}
	return count, nil
}

// --------------------------------------------------------------------------
// OpenAIProvider — the default Provider implementation.
// --------------------------------------------------------------------------

// OpenAIProvider calls the OpenAI /v1/embeddings endpoint.
// It is intentionally minimal: no SDK, just net/http with a sensible timeout
// and context support. Endpoint is overridable for tests.
type OpenAIProvider struct {
	apiKey     string
	model      string
	dimensions int
	endpoint   string
	http       *http.Client
}

// NewOpenAIProvider builds a Provider backed by OpenAI's embeddings API.
func NewOpenAIProvider(apiKey, model string, dimensions int) *OpenAIProvider {
	if model == "" {
		model = "text-embedding-3-small"
	}
	if dimensions <= 0 {
		dimensions = 1536
	}
	return &OpenAIProvider{
		apiKey:     apiKey,
		model:      model,
		dimensions: dimensions,
		endpoint:   "https://api.openai.com/v1/embeddings",
		http:       &http.Client{Timeout: 30 * time.Second},
	}
}

// Dimensions returns the configured vector size.
func (p *OpenAIProvider) Dimensions() int { return p.dimensions }

// Model returns the OpenAI model identifier.
func (p *OpenAIProvider) Model() string { return p.model }

// Embed is a convenience wrapper around EmbedBatch for a single input.
func (p *OpenAIProvider) Embed(ctx context.Context, text string) ([]float32, error) {
	vecs, err := p.EmbedBatch(ctx, []string{text})
	if err != nil {
		return nil, err
	}
	if len(vecs) != 1 {
		return nil, fmt.Errorf("openai: expected 1 embedding, got %d", len(vecs))
	}
	return vecs[0], nil
}

type openAIEmbedRequest struct {
	Input          []string `json:"input"`
	Model          string   `json:"model"`
	Dimensions     int      `json:"dimensions,omitempty"`
	EncodingFormat string   `json:"encoding_format,omitempty"`
}

type openAIEmbedResponse struct {
	Data []struct {
		Index     int       `json:"index"`
		Embedding []float32 `json:"embedding"`
	} `json:"data"`
	Error *struct {
		Message string `json:"message"`
		Type    string `json:"type"`
	} `json:"error,omitempty"`
}

// EmbedBatch calls the OpenAI embeddings endpoint for the supplied inputs.
func (p *OpenAIProvider) EmbedBatch(ctx context.Context, texts []string) ([][]float32, error) {
	if p.apiKey == "" {
		return nil, fmt.Errorf("openai: api key is required")
	}
	if len(texts) == 0 {
		return nil, nil
	}

	reqBody := openAIEmbedRequest{
		Input:          texts,
		Model:          p.model,
		Dimensions:     p.dimensions,
		EncodingFormat: "float",
	}
	bodyBytes, err := json.Marshal(reqBody)
	if err != nil {
		return nil, fmt.Errorf("marshal embed request: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.endpoint, bytes.NewReader(bodyBytes))
	if err != nil {
		return nil, fmt.Errorf("build embed request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Authorization", "Bearer "+p.apiKey)

	resp, err := p.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("openai embed call: %w", err)
	}
	defer resp.Body.Close()

	respBody, err := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if err != nil {
		return nil, fmt.Errorf("read embed response: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		var parsed openAIEmbedResponse
		_ = json.Unmarshal(respBody, &parsed)
		if parsed.Error != nil {
			return nil, fmt.Errorf("openai embed status %d: %s", resp.StatusCode, parsed.Error.Message)
		}
		return nil, fmt.Errorf("openai embed status %d", resp.StatusCode)
	}

	var parsed openAIEmbedResponse
	if err := json.Unmarshal(respBody, &parsed); err != nil {
		return nil, fmt.Errorf("decode embed response: %w", err)
	}
	if len(parsed.Data) != len(texts) {
		return nil, fmt.Errorf("openai embed: got %d vectors for %d inputs", len(parsed.Data), len(texts))
	}

	// Results are not guaranteed to be ordered by `index` — reassemble.
	out := make([][]float32, len(texts))
	for _, d := range parsed.Data {
		if d.Index < 0 || d.Index >= len(out) {
			return nil, fmt.Errorf("openai embed: out-of-range index %d", d.Index)
		}
		out[d.Index] = d.Embedding
	}
	for i, v := range out {
		if v == nil {
			return nil, fmt.Errorf("openai embed: missing vector for index %d", i)
		}
	}
	return out, nil
}
