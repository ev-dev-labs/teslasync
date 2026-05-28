package mqtt

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"github.com/rs/zerolog"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"
)

// VINCacheLoader is the data-source side of NewVINCache. It returns every
// (vin, vehicleID) pair the deployment knows about. Production wiring
// passes a closure over *vehicledb.VehicleRepo.GetAll; tests pass a fake.
//
// The cache calls Loader exactly once on construction (preload) and once
// per RefreshInterval thereafter; the data path (Resolve) never invokes
// Loader, so a Loader failure cannot stall ingest beyond the next
// refresh tick.
type VINCacheLoader func(ctx context.Context) (map[string]int64, error)

// VINCacheConfig captures the runtime knobs of the VIN cache.
type VINCacheConfig struct {
	// PreloadTimeout caps how long NewVINCache waits for the initial
	// snapshot before giving up and starting empty (in which case the
	// first per-VIN miss falls back to the DB-backed resolver and the
	// cache fills in opportunistically). Default 5s.
	PreloadTimeout time.Duration

	// RefreshInterval is how often the background refresher reloads the
	// snapshot to pick up newly-registered vehicles. Set to 0 to disable
	// background refresh (only the on-miss fill path then keeps the cache
	// current). Default 5 minutes.
	RefreshInterval time.Duration

	// RefreshTimeout caps how long each background refresh waits before
	// abandoning the snapshot reload. Default 10s.
	RefreshTimeout time.Duration

	// MissTimeout caps how long a per-VIN miss may spend in the
	// DB-backed fallback resolver before giving up. Default 2s.
	MissTimeout time.Duration
}

func (c *VINCacheConfig) withDefaults() {
	if c.PreloadTimeout <= 0 {
		c.PreloadTimeout = 5 * time.Second
	}
	if c.RefreshInterval < 0 {
		c.RefreshInterval = 0
	} else if c.RefreshInterval == 0 {
		c.RefreshInterval = 5 * time.Minute
	}
	if c.RefreshTimeout <= 0 {
		c.RefreshTimeout = 10 * time.Second
	}
	if c.MissTimeout <= 0 {
		c.MissTimeout = 2 * time.Second
	}
}

var (
	vinCacheLookupsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "mqtt_vin_cache",
		Name:      "lookups_total",
		Help:      "VIN cache lookups, labelled by outcome (hit, miss_known, miss_unknown, miss_error).",
	}, []string{"outcome"})
	vinCacheRefreshTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Namespace: "teslasync",
		Subsystem: "mqtt_vin_cache",
		Name:      "refresh_total",
		Help:      "VIN cache full-refresh attempts, labelled by outcome (ok, error).",
	}, []string{"outcome"})
	vinCacheSize = promauto.NewGauge(prometheus.GaugeOpts{
		Namespace: "teslasync",
		Subsystem: "mqtt_vin_cache",
		Name:      "size",
		Help:      "Current number of (vin, vehicleID) pairs cached.",
	})
)

// VINCache is the bidirectional cache that backs the per-field MQTT
// subscriber's hot path. Per-field MQTT amplifies traffic 50-200x relative
// to the proto-batch shape; the previous DB-on-every-message resolver
// pattern would translate into ~200 vehicle-table SELECTs per second per
// vehicle. This cache:
//
//  1. Preloads the full vin->id snapshot on startup so the steady state
//     hit rate is ~100%.
//  2. Refreshes the snapshot periodically (5 min default) so newly-
//     registered vehicles become resolvable without restart.
//  3. On miss, falls back to the wrapped Resolver (DB lookup) and
//     memoises the result — including ErrUnknownVIN, so a flood of
//     mis-routed messages from a foreign tenant cannot DoS the DB.
//  4. Exposes vehicleID -> VIN reverse lookup for any future producer
//     path that needs it (the per-field MQTT path itself only needs
//     vin -> id, but observers and the replay tool both occasionally
//     need the reverse direction).
//
// Concurrency: all public methods are safe for concurrent use. The
// background refresh runs on a dedicated goroutine launched by
// NewVINCache and stopped by Close.
type VINCache struct {
	loader   VINCacheLoader
	resolver VINResolver
	cfg      VINCacheConfig
	logger   zerolog.Logger

	mu      sync.RWMutex
	vinToID map[string]int64
	idToVIN map[int64]string
	// negativeCache holds VINs known to be unregistered. Treated as
	// authoritative until the next full refresh wipes it.
	negativeCache map[string]struct{}

	cancel context.CancelFunc
	done   chan struct{}
}

// NewVINCache constructs a VIN cache and runs the initial preload
// synchronously (bounded by cfg.PreloadTimeout). A preload failure logs
// + carries on with an empty snapshot — the on-miss fallback path keeps
// ingest working until the next refresh tick succeeds.
//
// loader and resolver MUST be non-nil. The caller MUST call Close on the
// returned cache during shutdown to stop the background refresh
// goroutine.
func NewVINCache(
	ctx context.Context,
	loader VINCacheLoader,
	resolver VINResolver,
	cfg VINCacheConfig,
	logger zerolog.Logger,
) *VINCache {
	if loader == nil {
		panic("mqtt: NewVINCache: loader must be non-nil")
	}
	if resolver == nil {
		panic("mqtt: NewVINCache: resolver must be non-nil")
	}
	cfg.withDefaults()

	c := &VINCache{
		loader:        loader,
		resolver:      resolver,
		cfg:           cfg,
		logger:        logger,
		vinToID:       map[string]int64{},
		idToVIN:       map[int64]string{},
		negativeCache: map[string]struct{}{},
		done:          make(chan struct{}),
	}

	preloadCtx, preloadCancel := context.WithTimeout(ctx, cfg.PreloadTimeout)
	defer preloadCancel()
	if err := c.refresh(preloadCtx); err != nil {
		logger.Warn().
			Err(err).
			Dur("preload_timeout", cfg.PreloadTimeout).
			Msg("mqtt: VINCache preload failed; starting empty, refresh will retry")
	}

	bgCtx, cancel := context.WithCancel(context.Background())
	c.cancel = cancel
	go c.refresher(bgCtx)
	return c
}

// Close stops the background refresher. Idempotent; safe to call from
// any goroutine.
func (c *VINCache) Close() {
	if c.cancel != nil {
		c.cancel()
	}
	<-c.done
}

// Resolve is the VINResolver-shaped entry point that PipelineSubscriber
// uses on the hot path. It checks the cache first, the negative cache
// second, and the wrapped resolver last; the resolver result is
// memoised in either the positive or the negative cache so a repeat
// lookup is O(1).
//
// Phase-10 tracing: emits an `mqtt.vin_resolve` child span under the
// caller's mqtt.consume parent. The span attributes carry result =
// hit | miss_known | miss_unknown | miss_error and vehicle_id (0 for
// negative cache / errors) so an operator can see exactly why a given
// MQTT message was acked/dropped from the trace tree alone, without
// needing to correlate the structured log line. VIN itself is NOT
// added as a span attribute (PII); the upstream mqtt.consume span
// already carries vin_prefix via redactVIN.
func (c *VINCache) Resolve(ctx context.Context, vin string) (id int64, err error) {
	ctx, span := otel.Tracer(vinCacheTracerName).Start(
		ctx,
		"mqtt.vin_resolve",
		trace.WithSpanKind(trace.SpanKindInternal),
	)
	defer func() {
		if err != nil && !errors.Is(err, ErrUnknownVIN) {
			span.RecordError(err)
			span.SetStatus(codes.Error, "vin resolver error")
		}
		span.End()
	}()
	_ = ctx // hot-path: the wrapped resolver re-derives ctx via WithTimeout

	c.mu.RLock()
	if cached, ok := c.vinToID[vin]; ok {
		c.mu.RUnlock()
		vinCacheLookupsTotal.WithLabelValues("hit").Inc()
		span.SetAttributes(
			attribute.String("result", "hit"),
			attribute.Int64("vehicle_id", cached),
		)
		return cached, nil
	}
	if _, ok := c.negativeCache[vin]; ok {
		c.mu.RUnlock()
		vinCacheLookupsTotal.WithLabelValues("miss_known").Inc()
		span.SetAttributes(attribute.String("result", "miss_known"))
		return 0, ErrUnknownVIN
	}
	c.mu.RUnlock()

	// Miss path: bounded fallback to the wrapped resolver so a slow DB
	// cannot block ingest indefinitely.
	missCtx, cancel := context.WithTimeout(ctx, c.cfg.MissTimeout)
	defer cancel()
	resolved, rerr := c.resolver(missCtx, vin)
	if rerr != nil {
		if errors.Is(rerr, ErrUnknownVIN) {
			c.mu.Lock()
			c.negativeCache[vin] = struct{}{}
			c.mu.Unlock()
			vinCacheLookupsTotal.WithLabelValues("miss_unknown").Inc()
			span.SetAttributes(attribute.String("result", "miss_unknown"))
			return 0, ErrUnknownVIN
		}
		vinCacheLookupsTotal.WithLabelValues("miss_error").Inc()
		span.SetAttributes(attribute.String("result", "miss_error"))
		return 0, rerr
	}
	c.mu.Lock()
	c.vinToID[vin] = resolved
	c.idToVIN[resolved] = vin
	delete(c.negativeCache, vin)
	c.mu.Unlock()
	vinCacheSize.Set(float64(c.size()))
	vinCacheLookupsTotal.WithLabelValues("miss_known").Inc()
	span.SetAttributes(
		attribute.String("result", "miss_fill"),
		attribute.Int64("vehicle_id", resolved),
	)
	return resolved, nil
}

// vinCacheTracerName is the OpenTelemetry tracer name for VIN cache
// spans. Kept as a package constant so the Phase-10 trace-coverage
// audit can grep for it.
const vinCacheTracerName = "mqtt"

// VINByID returns the cached VIN for a vehicleID, or ("", false) if no
// reverse mapping has been established yet. Used by observers and the
// replay tool; the hot subscriber path uses Resolve.
func (c *VINCache) VINByID(id int64) (string, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	vin, ok := c.idToVIN[id]
	return vin, ok
}

// Size returns the number of positive entries currently cached.
func (c *VINCache) Size() int {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.size()
}

func (c *VINCache) size() int {
	return len(c.vinToID)
}

// refresh re-runs the loader and atomically swaps the snapshot. Any VIN
// that was in the negative cache but appears in the new snapshot is
// promoted out of negative; any VIN that had been positively cached but
// is no longer in the snapshot is evicted (so a deleted vehicle stops
// resolving on the next refresh tick).
func (c *VINCache) refresh(ctx context.Context) error {
	snapshot, err := c.loader(ctx)
	if err != nil {
		vinCacheRefreshTotal.WithLabelValues("error").Inc()
		return fmt.Errorf("mqtt: VINCache refresh: %w", err)
	}

	idToVIN := make(map[int64]string, len(snapshot))
	for vin, id := range snapshot {
		idToVIN[id] = vin
	}

	c.mu.Lock()
	c.vinToID = snapshot
	c.idToVIN = idToVIN
	// Clear negatives that the new snapshot makes positive.
	for vin := range c.negativeCache {
		if _, ok := snapshot[vin]; ok {
			delete(c.negativeCache, vin)
		}
	}
	c.mu.Unlock()
	vinCacheRefreshTotal.WithLabelValues("ok").Inc()
	vinCacheSize.Set(float64(len(snapshot)))
	c.logger.Debug().Int("size", len(snapshot)).Msg("mqtt: VINCache refreshed")
	return nil
}

// refresher is the background goroutine that periodically refreshes the
// snapshot. It exits when the context handed in by NewVINCache is
// cancelled (which Close does) and signals exit via c.done.
func (c *VINCache) refresher(ctx context.Context) {
	defer close(c.done)
	if c.cfg.RefreshInterval <= 0 {
		// Refresh disabled — wait for cancel.
		<-ctx.Done()
		return
	}
	t := time.NewTicker(c.cfg.RefreshInterval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			refreshCtx, cancel := context.WithTimeout(ctx, c.cfg.RefreshTimeout)
			if err := c.refresh(refreshCtx); err != nil {
				c.logger.Warn().
					Err(err).
					Msg("mqtt: VINCache background refresh failed; serving stale snapshot")
			}
			cancel()
		}
	}
}
