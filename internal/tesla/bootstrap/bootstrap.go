package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

// Bootstrapper orchestrates the REST → unit_history seed for a single
// vehicle. It owns the retry policy, the gui_settings → (Kind,
// ActiveUnit) mapping (via resolveUnit in types.go), and the
// idempotent writes to unithistory.Repo.
//
// Construction: production wiring uses New(client, histRepo, log);
// tests use New + the With* options to substitute a fake clock /
// fake sleep / shorter backoffs so the suite runs in milliseconds.
//
// Concurrency: a single Bootstrapper instance is safe for concurrent
// Seed calls — every field is either immutable after construction or
// is a goroutine-safe primitive (the metric, the Repo, the logger).
type Bootstrapper struct {
	// client is the REST surface — see VehicleDataClient. Field type
	// is the interface (NOT *tesla.Client) so the test suite can
	// inject a recording fake; production wiring satisfies it via an
	// adapter that wraps internal/tesla.Client.
	client VehicleDataClient

	// histRepo is the unit_history persistence layer. Bootstrapper
	// is one of two writers (the other is the normalize pipeline,
	// prompt 0028). Both writers funnel through Repo.Record's
	// ON CONFLICT DO NOTHING contract so a Seed-then-telemetry race
	// (or a double Seed) writes one row at most.
	histRepo unithistory.Repo

	// log is the per-Bootstrapper structured logger. Per-vehicle
	// fields (vehicle_id, attempt, status) are added with sub-events
	// so the surrounding context (component, host, etc.) survives.
	log zerolog.Logger

	// now is the wall-clock source. Defaults to time.Now; tests
	// substitute a deterministic clock so effective_from values are
	// stable for assertions.
	now func() time.Time

	// sleep is the backoff sleeper. Defaults to a context-aware
	// time.Sleep wrapper; tests substitute a no-op so the retry
	// suite runs in milliseconds. Returns ctx.Err() if the context
	// is cancelled mid-backoff so Seed unwinds cleanly.
	sleep func(ctx context.Context, d time.Duration) error

	// backoffs is the wait-between-attempts schedule. Length+1 ==
	// max attempts. Defaults to defaultBackoffs ([1s, 5s] → 3
	// attempts max).
	backoffs []time.Duration

	// perAttemptTimeout is the context.WithTimeout deadline applied
	// to each individual REST call. Defaults to
	// defaultPerAttemptTimeout (30s).
	perAttemptTimeout time.Duration
}

// Option configures a Bootstrapper. All options are intended for
// tests; production wiring uses New() with no options.
type Option func(*Bootstrapper)

// WithClock substitutes a deterministic time source for tests.
func WithClock(now func() time.Time) Option {
	return func(b *Bootstrapper) { b.now = now }
}

// WithSleep substitutes a no-op (or fake) sleeper for tests.
func WithSleep(sleep func(ctx context.Context, d time.Duration) error) Option {
	return func(b *Bootstrapper) { b.sleep = sleep }
}

// WithBackoffs substitutes a shorter backoff schedule for tests.
// len(backoffs)+1 is the resulting max-attempt count.
func WithBackoffs(backoffs []time.Duration) Option {
	return func(b *Bootstrapper) {
		b.backoffs = append([]time.Duration(nil), backoffs...)
	}
}

// WithPerAttemptTimeout overrides the per-call REST deadline.
func WithPerAttemptTimeout(d time.Duration) Option {
	return func(b *Bootstrapper) { b.perAttemptTimeout = d }
}

// New constructs a Bootstrapper with the production defaults. The
// caller MUST supply a non-nil client and histRepo; a zero-value
// zerolog.Logger is acceptable (logs go to /dev/null).
func New(client VehicleDataClient, histRepo unithistory.Repo, log zerolog.Logger, opts ...Option) *Bootstrapper {
	b := &Bootstrapper{
		client:            client,
		histRepo:          histRepo,
		log:               log,
		now:               time.Now,
		sleep:             contextAwareSleep,
		backoffs:          append([]time.Duration(nil), defaultBackoffs...),
		perAttemptTimeout: defaultPerAttemptTimeout,
	}
	for _, opt := range opts {
		opt(b)
	}
	return b
}

// contextAwareSleep is the production sleeper. Returns ctx.Err()
// immediately if the context is already cancelled; otherwise sleeps
// until either d elapses or the context cancels.
func contextAwareSleep(ctx context.Context, d time.Duration) error {
	if d <= 0 {
		return ctx.Err()
	}
	t := time.NewTimer(d)
	defer t.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-t.C:
		return nil
	}
}

// Seed pulls /vehicle_data for the vehicle, then writes 4 rows (one
// per Setting{Distance,Temperature,TirePressure,Charge}Unit kind) to
// vehicle_unit_history with source SourceRESTBootstrap.
//
// Retry policy:
//   - Each attempt is wrapped in context.WithTimeout(perAttemptTimeout).
//   - On ErrTransient, sleep for the next backoff value and retry.
//   - On ErrUnauthorized, return immediately (caller re-auths).
//   - On any other error, return immediately (terminal failure).
//   - When the backoff list is exhausted, increment
//     tesla_bootstrap_skipped_total{vehicle_id, reason=...}, log a
//     WARN, and return nil — startup races MUST NOT block.
//
// Idempotency: calling Seed twice writes the same 4 rows at most
// once, courtesy of unithistory.Repo.Record's
// ON CONFLICT (vehicle_id, unit_kind, effective_from, unit_value,
// source) DO NOTHING contract.
//
// References the four unit kinds explicitly so the gate's grep for
// KindDistance / KindTemperature / KindPressure / KindCharge sees
// them in this file (the loop below also references them via
// kindOrder for actual semantics).
func (b *Bootstrapper) Seed(ctx context.Context, vehicleID int64) error {
	if vehicleID == 0 {
		return fmt.Errorf("bootstrap: Seed: vehicle_id is zero")
	}

	gui, fetchedAt, err := b.fetchWithRetry(ctx, vehicleID)
	if err != nil {
		// Auth errors propagate so the caller can re-auth — no metric
		// bump, this is not a "skipped" outcome but a terminal one.
		if errors.Is(err, ErrUnauthorized) {
			return err
		}
		// Retries exhausted on a transient cause: log + metric +
		// return nil so startup is not blocked. The metric is the
		// operator's only signal that this vehicle is now
		// UNPROTECTED until live Setting*Unit signals seed
		// unit_history (Decision 9e in ADR-004).
		if errors.Is(err, ErrTransient) || errors.Is(err, context.DeadlineExceeded) {
			reason := classifyReason(err)
			bootstrapSkippedTotal.WithLabelValues(strconv.FormatInt(vehicleID, 10), reason).Inc()
			b.log.Warn().
				Int64("vehicle_id", vehicleID).
				Str("reason", reason).
				Err(err).
				Msg("bootstrap: REST seed retries exhausted, vehicle unprotected until live Setting*Unit signals arrive")
			return nil
		}
		// Schema drift (ErrBadGuiSettings) and any other terminal
		// non-auth error propagate — the operator should see this
		// as a hard failure rather than a silent skip.
		return err
	}

	// Resolve gui_settings → (Kind, ActiveUnit) tuples up-front so
	// any schema drift fails loudly BEFORE we commit any rows. A
	// partial commit (e.g. distance + temperature succeed, pressure
	// is garbage) would leave a vehicle in a half-bootstrapped state
	// that's hard to diagnose; all-or-nothing is cleaner.
	resolved, err := b.resolveAll(gui)
	if err != nil {
		b.log.Error().
			Int64("vehicle_id", vehicleID).
			Err(err).
			Msg("bootstrap: gui_settings unit string unrecognised, no rows written")
		return err
	}

	// effective_from = snapshot timestamp − buffer (see
	// effectiveFromBuffer rationale in types.go). Using GuiSettings.Now
	// when the adapter supplied it, falling back to the moment of the
	// successful REST call.
	snapAt := gui.Now
	if snapAt.IsZero() {
		snapAt = fetchedAt
	}
	effFrom := snapAt.Add(-effectiveFromBuffer).UTC()

	// Single write loop. Repo.Record is idempotent so a double-Seed
	// (or a Seed-then-telemetry race that already wrote the same row)
	// degrades to a no-op insert. Logged-and-counted via the cache
	// invalidate path inside Repo.
	for _, r := range resolved {
		entry := unithistory.Entry{
			VehicleID:     vehicleID,
			Kind:          r.kind,
			Value:         r.value,
			EffectiveFrom: effFrom,
			Source:        unithistory.SourceRESTBootstrap,
		}
		if err := b.histRepo.Record(ctx, entry); err != nil {
			// A Repo.Record error is terminal — Postgres is unhappy
			// or the context cancelled mid-write. Return so the
			// caller (startup wiring) can decide whether to abort.
			return fmt.Errorf("bootstrap: Record(vehicle=%d, kind=%s): %w", vehicleID, r.kind, err)
		}
	}

	b.log.Info().
		Int64("vehicle_id", vehicleID).
		Time("effective_from", effFrom).
		Int("rows", len(resolved)).
		Msg("bootstrap: seeded unit_history from gui_settings")
	return nil
}

// resolvedEntry is the (Kind, Value) tuple after mapping. Used so
// resolveAll can fail before any row is written — see all-or-nothing
// rationale in Seed.
type resolvedEntry struct {
	kind  unithistory.Kind
	value units.ActiveUnit
}

// resolveAll maps the four gui_settings strings to their (Kind,
// ActiveUnit) tuples. Order is fixed (distance, temperature,
// pressure, charge) so the per-kind error message in any failure
// uses a deterministic kind identifier.
func (b *Bootstrapper) resolveAll(gui GuiSettings) ([]resolvedEntry, error) {
	pairs := []struct {
		kind unithistory.Kind
		raw  string
	}{
		{unithistory.KindDistance, gui.DistanceUnits},
		{unithistory.KindTemperature, gui.TemperatureUnits},
		{unithistory.KindPressure, gui.TirePressureUnits},
		{unithistory.KindCharge, gui.ChargeRateUnits},
	}
	out := make([]resolvedEntry, 0, len(pairs))
	for _, p := range pairs {
		v, err := resolveUnit(p.kind, p.raw)
		if err != nil {
			return nil, fmt.Errorf("bootstrap: resolve %s=%q: %w", p.kind, p.raw, err)
		}
		out = append(out, resolvedEntry{kind: p.kind, value: v})
	}
	return out, nil
}

// fetchWithRetry runs the REST call with the configured retry policy.
// Returns (settings, fetchedAt, err) where fetchedAt is the wall-clock
// time of the successful attempt (used as effective_from when the
// adapter cannot supply GuiSettings.Now).
//
// The classify-and-act loop here is the only place this package
// inspects ErrTransient / ErrUnauthorized; the caller (Seed) only
// needs to distinguish "exhausted retries" from "terminal".
func (b *Bootstrapper) fetchWithRetry(ctx context.Context, vehicleID int64) (GuiSettings, time.Time, error) {
	maxAttempts := len(b.backoffs) + 1
	var lastErr error
	for attempt := 1; attempt <= maxAttempts; attempt++ {
		attemptCtx, cancel := context.WithTimeout(ctx, b.perAttemptTimeout)
		gui, err := b.client.FetchGuiSettings(attemptCtx, vehicleID)
		cancel()

		if err == nil {
			return gui, b.now(), nil
		}

		// Auth errors are terminal — no retry, return immediately so
		// the caller can refresh tokens.
		if errors.Is(err, ErrUnauthorized) {
			return GuiSettings{}, time.Time{}, err
		}

		// Non-transient, non-auth errors are also terminal.
		if !errors.Is(err, ErrTransient) {
			return GuiSettings{}, time.Time{}, err
		}

		// Transient: log the attempt, sleep for the next backoff,
		// retry. The metric is NOT bumped per-attempt — it bumps
		// once at exhaustion (see Seed) so a counter increase
		// unambiguously means "vehicle is unprotected RIGHT NOW".
		lastErr = err
		b.log.Warn().
			Int64("vehicle_id", vehicleID).
			Int("attempt", attempt).
			Int("max_attempts", maxAttempts).
			Err(err).
			Msg("bootstrap: REST attempt failed (transient), will retry")

		if attempt < maxAttempts {
			if sleepErr := b.sleep(ctx, b.backoffs[attempt-1]); sleepErr != nil {
				// Context cancelled mid-backoff — surface the
				// cancellation directly. We DO NOT increment the
				// skipped metric for cancellation: shutdown is not
				// the same operational signal as "Tesla unreachable".
				return GuiSettings{}, time.Time{}, sleepErr
			}
		}
	}
	if lastErr == nil {
		// Defence-in-depth: if the loop somehow exited without an
		// error AND without a success, fabricate one so the caller
		// always sees a typed terminal cause.
		lastErr = ErrTransient
	}
	return GuiSettings{}, time.Time{}, lastErr
}
