package worker

import (
	"context"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/rs/zerolog/log"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	oteltrace "go.opentelemetry.io/otel/trace"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

// gasPriceTracerName scopes spans for the gas-price polling worker.
const gasPriceTracerName = "internal/worker/gas_price"

func gasPriceTracer() oteltrace.Tracer { return otel.Tracer(gasPriceTracerName) }

// gallonToKWhFactor converts a gallon price to kWh-equivalent cost.
// Must match the factor in the EIA adapter.
const gallonToKWhFactor = 7.14

const litersPerUSGallon = 3.785411784

// GasPriceWorker polls an external price provider for the latest gasoline price.
type GasPriceWorker struct {
	db       *database.DB
	cfg      config.GasPriceConfig
	provider external.GasPriceProvider

	mu             sync.Mutex
	pollInterval   string
	ticker         *time.Ticker
	lastPollTime   time.Time
	lastPrice      float64 // price in the configured gas unit
	lastPriceGal   float64 // provider price persisted in backward-compatible gallons
	lastPriceKWhEq float64 // kWh-equivalent price
	lastPriceUnit  *string // denomination of lastPrice, not the current settings
	running        atomic.Bool

	// stopCh is used to signal the ticker loop to stop.
	stopCh chan struct{}
	// resumeCh is used to signal the ticker loop to resume.
	resumeCh chan struct{}
}

// NewGasPriceWorker creates a new gas price polling worker.
func NewGasPriceWorker(db *database.DB, cfg config.GasPriceConfig, provider external.GasPriceProvider) *GasPriceWorker {
	interval, _ := gasPricePollInterval(cfg.PollInterval)
	return &GasPriceWorker{
		db:           db,
		cfg:          cfg,
		provider:     provider,
		pollInterval: interval,
		stopCh:       make(chan struct{}, 1),
		resumeCh:     make(chan struct{}, 1),
	}
}

// Start runs the gas price polling loop. It blocks until ctx is cancelled.
func (w *GasPriceWorker) Start(ctx context.Context) {
	// Restore persisted state from the database
	w.restoreState(ctx)

	if !w.IsRunning() && w.cfg.Enabled {
		w.running.Store(true)
	}

	w.mu.Lock()
	pollInterval, interval := gasPricePollInterval(w.pollInterval)
	w.pollInterval = pollInterval
	ticker := time.NewTicker(interval)
	w.ticker = ticker
	w.mu.Unlock()
	defer func() {
		w.mu.Lock()
		ticker.Stop()
		w.ticker = nil
		w.mu.Unlock()
	}()

	log.Info().
		Bool("enabled", w.cfg.Enabled).
		Str("poll_interval", pollInterval).
		Dur("ticker_duration", interval).
		Msg("gas price worker started")

	// Initial poll shortly after startup if enabled
	if w.IsRunning() {
		select {
		case <-ctx.Done():
			return
		case <-time.After(30 * time.Second):
			w.Poll(ctx)
		}
	}

	for {
		select {
		case <-ctx.Done():
			return
		case <-w.stopCh:
			w.running.Store(false)
			log.Info().Msg("gas price auto-poll stopped")
			// Wait for resume or context cancellation
			select {
			case <-ctx.Done():
				return
			case <-w.resumeCh:
				w.running.Store(true)
				// Reset ticker with current interval
				w.mu.Lock()
				_, duration := gasPricePollInterval(w.pollInterval)
				ticker.Reset(duration)
				w.mu.Unlock()
				log.Info().Msg("gas price auto-poll resumed")
			}
		case <-ticker.C:
			if w.IsRunning() {
				w.Poll(ctx)
			}
		}
	}
}

// Poll fetches the latest gas price via the configured provider and records it.
func (w *GasPriceWorker) Poll(ctx context.Context) {
	ctx, span := gasPriceTracer().Start(ctx, "gas_price.refresh_tick",
		oteltrace.WithSpanKind(oteltrace.SpanKindInternal))
	defer span.End()

	if w.provider == nil {
		span.SetAttributes(attribute.String("gas_price.outcome", "skipped_no_provider"))
		log.Warn().Msg("gas price poll skipped: no provider configured")
		return
	}

	result, err := w.provider.GetCurrentPrice(ctx, "US")
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "provider fetch failed")
		log.Error().Err(err).Msg("gas price poll: provider fetch failed")
		return
	}
	if result == nil {
		span.SetStatus(codes.Error, "provider returned no quote")
		log.Warn().Msg("gas price poll: provider returned no quote")
		return
	}

	pricePerGallon := result.PricePerGallon
	kwhEqPrice := result.PricePerKWh

	// Persist the provider's per-gallon quote in the user's configured unit.
	pricePerUnit, gasUnit, err := w.recordPrice(ctx, pricePerGallon)
	if err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, "record price failed")
		log.Error().
			Err(err).
			Float64("price_per_gallon", pricePerGallon).
			Msg("gas price poll: failed to record price")
		return
	}

	w.setPriceSnapshot(time.Now().UTC(), pricePerUnit, pricePerGallon, kwhEqPrice, gasUnit)

	// Persist poll state
	w.persistState(ctx)

	span.SetAttributes(
		attribute.Float64("gas_price.value", pricePerUnit),
		attribute.String("gas_price.unit", gasUnit),
		attribute.String("gas_price.region", result.Region),
		attribute.String("gas_price.currency", result.Currency),
		attribute.String("gas_price.outcome", "ok"),
	)
	log.Info().
		Float64("price", pricePerUnit).
		Str("unit", gasUnit).
		Str("region", result.Region).
		Str("currency", result.Currency).
		Msg("gas price poll: updated successfully")
}

// recordPrice atomically records history and updates the configured comparison price.
func (w *GasPriceWorker) recordPrice(
	ctx context.Context,
	pricePerGallon float64,
) (float64, string, error) {
	tx, err := w.db.Pool.Begin(ctx)
	if err != nil {
		return 0, "", fmt.Errorf("begin tx: %w", err)
	}
	defer tx.Rollback(ctx)

	// Close current active period
	if _, err := tx.Exec(ctx,
		`UPDATE gas_price_history SET effective_to = NOW() WHERE effective_to IS NULL`); err != nil {
		return 0, "", fmt.Errorf("close period: %w", err)
	}

	// Get current efficiency from settings (key-value table)
	var gasUnit string
	var efficiencyMPG float64
	err = tx.QueryRow(ctx,
		`SELECT
			COALESCE((SELECT value_text FROM settings WHERE key = 'gas_unit'), 'gallon'),
			COALESCE((SELECT value_num FROM settings WHERE key = 'gas_efficiency_mpg'), 25)`).Scan(&gasUnit, &efficiencyMPG)
	if err != nil {
		return 0, "", fmt.Errorf("read gas price settings: %w", err)
	}
	gasUnit = normalizeGasPriceUnit(gasUnit)
	pricePerUnit := gasPricePerConfiguredUnit(pricePerGallon, gasUnit)

	// Insert new period
	if _, err := tx.Exec(ctx,
		`INSERT INTO gas_price_history (price_per_unit, unit, efficiency_mpg, effective_from) VALUES ($1, $2, $3, NOW())`,
		pricePerUnit, gasUnit, efficiencyMPG); err != nil {
		return 0, "", fmt.Errorf("insert period: %w", err)
	}

	if _, err := tx.Exec(ctx,
		`INSERT INTO settings (key, value_num, data_kind, created_at, updated_at)
		VALUES ('gas_price_per_unit', $1, 'number', NOW(), NOW())
		ON CONFLICT (key) DO UPDATE SET value_num = $1, updated_at = NOW()`,
		pricePerUnit,
	); err != nil {
		return 0, "", fmt.Errorf("update setting: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return 0, "", fmt.Errorf("commit price: %w", err)
	}
	return pricePerUnit, gasUnit, nil
}

// Stop signals the worker to stop auto-polling.
func (w *GasPriceWorker) Stop() {
	select {
	case w.stopCh <- struct{}{}:
	default:
	}
}

// Resume signals the worker to resume auto-polling.
func (w *GasPriceWorker) Resume() {
	select {
	case w.resumeCh <- struct{}{}:
	default:
	}
}

// IsRunning returns whether the worker is currently auto-polling.
func (w *GasPriceWorker) IsRunning() bool {
	return w.running.Load()
}

// SetPollInterval resets the existing ticker before publishing the new interval.
func (w *GasPriceWorker) SetPollInterval(interval string) {
	validInterval, duration := gasPricePollInterval(interval)
	if validInterval != interval {
		log.Warn().Str("poll_interval", interval).Msg("gas price worker: rejected invalid poll interval")
		return
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.pollInterval == interval {
		return
	}
	if w.ticker != nil {
		w.ticker.Reset(duration)
	}
	w.pollInterval = interval
}

// Status returns the current worker state.
func (w *GasPriceWorker) Status() GasPriceStatus {
	w.mu.Lock()
	defer w.mu.Unlock()
	return GasPriceStatus{
		Enabled:           w.IsRunning(),
		PollInterval:      w.pollInterval,
		LastPollTime:      w.lastPollTime,
		CurrentPrice:      w.lastPrice,
		CurrentPriceKWhEq: w.lastPriceKWhEq,
		CurrentPriceUnit:  w.lastPriceUnit,
	}
}

// GasPriceStatus holds the polling status for the API response.
type GasPriceStatus struct {
	Enabled           bool      `json:"enabled"`
	PollInterval      string    `json:"poll_interval"`
	LastPollTime      time.Time `json:"last_poll_time"`
	CurrentPrice      float64   `json:"current_price"`
	CurrentPriceKWhEq  float64   `json:"current_price_kwh_eq"`
	// Nil means no quote has been recorded; numeric zero alone is not evidence.
	CurrentPriceUnit *string `json:"current_price_unit"`
}

func (w *GasPriceWorker) setPriceSnapshot(at time.Time, price, priceGal, priceKWhEq float64, unit string) {
	w.mu.Lock()
	defer w.mu.Unlock()
	w.lastPollTime = at
	w.lastPrice = price
	w.lastPriceGal = priceGal
	w.lastPriceKWhEq = priceKWhEq
	w.lastPriceUnit = &unit
}

// tickerDuration converts the poll interval string to a time.Duration.
func (w *GasPriceWorker) tickerDuration() time.Duration {
	w.mu.Lock()
	defer w.mu.Unlock()
	_, duration := gasPricePollInterval(w.pollInterval)
	return duration
}

func gasPricePollInterval(interval string) (string, time.Duration) {
	switch interval {
	case "daily":
		return interval, 24 * time.Hour
	case "7d":
		return interval, 7 * 24 * time.Hour
	case "15d":
		return interval, 15 * 24 * time.Hour
	case "30d":
		return interval, 30 * 24 * time.Hour
	default:
		return "7d", 7 * 24 * time.Hour
	}
}

// persistState saves the worker's poll state to the database so it survives restarts.
func (w *GasPriceWorker) persistState(ctx context.Context) {
	w.mu.Lock()
	lastPoll := w.lastPollTime
	lastPriceGal := w.lastPriceGal
	interval := w.pollInterval
	w.mu.Unlock()

	running := w.IsRunning()

	_, err := w.db.Pool.Exec(ctx, `
		INSERT INTO gas_price_poll_state (id, enabled, poll_interval, last_poll_time, last_price)
		VALUES (1, $1, $2, $3, $4)
		ON CONFLICT (id) DO UPDATE SET
			enabled = EXCLUDED.enabled,
			poll_interval = EXCLUDED.poll_interval,
			last_poll_time = EXCLUDED.last_poll_time,
			last_price = EXCLUDED.last_price
	`, running, interval, lastPoll, lastPriceGal)
	if err != nil {
		log.Warn().Err(err).Msg("gas price worker: failed to persist state")
	}
}

// restoreState loads persisted poll state from the database.
func (w *GasPriceWorker) restoreState(ctx context.Context) {
	var enabled bool
	var interval string
	var lastPoll time.Time
	var lastPrice float64

	err := w.db.Pool.QueryRow(ctx,
		`SELECT
			enabled,
			poll_interval,
			last_poll_time,
			last_price
		FROM gas_price_poll_state
		WHERE id = 1`,
	).Scan(&enabled, &interval, &lastPoll, &lastPrice)
	if err != nil {
		// Table may not exist yet or no row — use config defaults
		return
	}

	w.mu.Lock()
	w.pollInterval, _ = gasPricePollInterval(interval)
	w.mu.Unlock()
	// Persisted last_price is per gallon, independent of today's settings.
	if !lastPoll.IsZero() {
		w.setPriceSnapshot(lastPoll, lastPrice, lastPrice, lastPrice/gallonToKWhFactor, "gallon")
	}

	w.running.Store(enabled)
	log.Info().
		Bool("enabled", enabled).
		Str("poll_interval", interval).
		Time("last_poll_time", lastPoll).
		Float64("last_price", lastPrice).
		Msg("gas price worker: restored persisted state")
}

func normalizeGasPriceUnit(unit string) string {
	switch strings.ToLower(strings.TrimSpace(unit)) {
	case "liter", "liters", "litre", "litres":
		return "liter"
	default:
		return "gallon"
	}
}

func gasPricePerConfiguredUnit(pricePerGallon float64, unit string) float64 {
	if normalizeGasPriceUnit(unit) == "liter" {
		return pricePerGallon / litersPerUSGallon
	}
	return pricePerGallon
}
