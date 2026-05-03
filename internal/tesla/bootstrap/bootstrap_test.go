package bootstrap

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
	"github.com/rs/zerolog"

	"github.com/ev-dev-labs/teslasync/internal/tesla/units"
	unithistory "github.com/ev-dev-labs/teslasync/internal/tesla/unit_history"
)

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

// fakeClient is a recording stand-in for VehicleDataClient. Each call
// pops the next reply off the queue (or repeats the tail reply if the
// queue is exhausted, simulating "Tesla still angry"). Calls are
// counted so retry-budget tests can assert the exact attempt count.
type fakeClient struct {
	mu       sync.Mutex
	replies  []fakeReply
	calls    int
	repeated bool // when true, the last reply repeats forever
}

type fakeReply struct {
	gui GuiSettings
	err error
}

func newFakeClient(replies []fakeReply, repeated bool) *fakeClient {
	return &fakeClient{
		replies:  append([]fakeReply(nil), replies...),
		repeated: repeated,
	}
}

func (f *fakeClient) FetchGuiSettings(_ context.Context, _ int64) (GuiSettings, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls++
	if len(f.replies) == 0 {
		return GuiSettings{}, errors.New("fakeClient: no replies queued")
	}
	idx := f.calls - 1
	if idx >= len(f.replies) {
		if f.repeated {
			return f.replies[len(f.replies)-1].gui, f.replies[len(f.replies)-1].err
		}
		return GuiSettings{}, errors.New("fakeClient: replies exhausted")
	}
	return f.replies[idx].gui, f.replies[idx].err
}

func (f *fakeClient) callCount() int {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.calls
}

// fakeRepo is an in-memory unithistory.Repo for tests. It mirrors
// pgRepo's idempotency contract — the natural-key uniqueness of
// (vehicle_id, unit_kind, effective_from, unit_value, source) — so
// the bootstrap idempotency test can rely on the same semantics as
// production Postgres without spinning up a container.
type fakeRepo struct {
	mu     sync.Mutex
	rows   []unithistory.Entry
	nextID atomic.Int64
}

func newFakeRepo() *fakeRepo { return &fakeRepo{} }

func (r *fakeRepo) Record(_ context.Context, e unithistory.Entry) error {
	if e.VehicleID == 0 || e.Kind == "" || e.Value == "" || e.Source == "" || e.EffectiveFrom.IsZero() {
		return errors.New("fakeRepo.Record: invalid Entry")
	}
	effFrom := e.EffectiveFrom.UTC()
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, existing := range r.rows {
		if existing.VehicleID == e.VehicleID &&
			existing.Kind == e.Kind &&
			existing.EffectiveFrom.Equal(effFrom) &&
			existing.Value == e.Value &&
			existing.Source == e.Source {
			// ON CONFLICT DO NOTHING — duplicate write is a no-op.
			return nil
		}
	}
	r.nextID.Add(1)
	stored := e
	stored.EffectiveFrom = effFrom
	r.rows = append(r.rows, stored)
	return nil
}

func (r *fakeRepo) At(_ context.Context, vehicleID int64, kind unithistory.Kind, t time.Time) (units.ActiveUnit, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidates := make([]unithistory.Entry, 0)
	for _, row := range r.rows {
		if row.VehicleID == vehicleID && row.Kind == kind && !row.EffectiveFrom.After(t.UTC()) {
			candidates = append(candidates, row)
		}
	}
	if len(candidates) == 0 {
		return "", unithistory.ErrNotFound
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].EffectiveFrom.After(candidates[j].EffectiveFrom)
	})
	return candidates[0].Value, nil
}

func (r *fakeRepo) Latest(_ context.Context, vehicleID int64, kind unithistory.Kind) (unithistory.Entry, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	candidates := make([]unithistory.Entry, 0)
	for _, row := range r.rows {
		if row.VehicleID == vehicleID && row.Kind == kind {
			candidates = append(candidates, row)
		}
	}
	if len(candidates) == 0 {
		return unithistory.Entry{}, unithistory.ErrNotFound
	}
	sort.Slice(candidates, func(i, j int) bool {
		return candidates[i].EffectiveFrom.After(candidates[j].EffectiveFrom)
	})
	return candidates[0], nil
}

func (r *fakeRepo) snapshot() []unithistory.Entry {
	r.mu.Lock()
	defer r.mu.Unlock()
	out := make([]unithistory.Entry, len(r.rows))
	copy(out, r.rows)
	return out
}

// noopSleep is used by every test so the suite runs in milliseconds
// instead of the 6+ seconds a real backoff would consume. It still
// honours context cancellation so the cancel-mid-backoff test works.
func noopSleep(ctx context.Context, _ time.Duration) error { return ctx.Err() }

// fixedClock returns a deterministic time function for assertions.
func fixedClock(t time.Time) func() time.Time { return func() time.Time { return t } }

// readPromCounterVec extracts the value of the named child of a
// CounterVec. Mirrors the helper in unit_history's cache_test.go.
func readPromCounterVec(t *testing.T, vec *prometheus.CounterVec, labels ...string) float64 {
	t.Helper()
	c, err := vec.GetMetricWithLabelValues(labels...)
	if err != nil {
		t.Fatalf("GetMetricWithLabelValues: %v", err)
	}
	var m dto.Metric
	if err := c.Write(&m); err != nil {
		t.Fatalf("counter.Write: %v", err)
	}
	if m.Counter == nil || m.Counter.Value == nil {
		return 0
	}
	return *m.Counter.Value
}

// ---------------------------------------------------------------------------
// Mapping table coverage
// ---------------------------------------------------------------------------

// TestSeed_PerKindVariant_All exercises every supported gui_settings
// string and asserts the resulting Entry per kind. This is the
// "table tests" deliverable from the prompt's UNIT_TEST section.
func TestSeed_PerKindVariant_All(t *testing.T) {
	cases := []struct {
		name string
		gui  GuiSettings
		want map[unithistory.Kind]units.ActiveUnit
	}{
		{
			name: "us_metric_combo",
			gui: GuiSettings{
				DistanceUnits:     "mi/hr",
				TemperatureUnits:  "F",
				TirePressureUnits: "Psi",
				ChargeRateUnits:   "mi/hr",
			},
			want: map[unithistory.Kind]units.ActiveUnit{
				unithistory.KindDistance:    units.ActiveUnitMiles,
				unithistory.KindTemperature: units.ActiveUnitFahrenheit,
				unithistory.KindPressure:    units.ActiveUnitPSI,
				unithistory.KindCharge:      units.ActiveUnitDistance,
			},
		},
		{
			name: "eu_metric_combo",
			gui: GuiSettings{
				DistanceUnits:     "km/hr",
				TemperatureUnits:  "C",
				TirePressureUnits: "Bar",
				ChargeRateUnits:   "km/hr",
			},
			want: map[unithistory.Kind]units.ActiveUnit{
				unithistory.KindDistance:    units.ActiveUnitKilometers,
				unithistory.KindTemperature: units.ActiveUnitCelsius,
				unithistory.KindPressure:    units.ActiveUnitBar,
				unithistory.KindCharge:      units.ActiveUnitDistance,
			},
		},
		{
			name: "case_insensitive_and_whitespace",
			gui: GuiSettings{
				DistanceUnits:     "  KM/HR  ",
				TemperatureUnits:  " c ",
				TirePressureUnits: "PSI",
				ChargeRateUnits:   "%",
			},
			want: map[unithistory.Kind]units.ActiveUnit{
				unithistory.KindDistance:    units.ActiveUnitKilometers,
				unithistory.KindTemperature: units.ActiveUnitCelsius,
				unithistory.KindPressure:    units.ActiveUnitPSI,
				unithistory.KindCharge:      units.ActiveUnitPercent,
			},
		},
	}

	const vehicleID int64 = 42
	snapshotAt := time.Date(2026, 5, 3, 0, 0, 0, 0, time.UTC)

	for _, tc := range cases {
		tc := tc
		t.Run(tc.name, func(t *testing.T) {
			repo := newFakeRepo()
			gui := tc.gui
			gui.Now = snapshotAt
			fc := newFakeClient([]fakeReply{{gui: gui}}, false)
			b := New(fc, repo, zerolog.Nop(),
				WithClock(fixedClock(snapshotAt)),
				WithSleep(noopSleep),
			)

			if err := b.Seed(context.Background(), vehicleID); err != nil {
				t.Fatalf("Seed returned err = %v, want nil", err)
			}

			rows := repo.snapshot()
			if len(rows) != 4 {
				t.Fatalf("rows = %d, want 4", len(rows))
			}

			wantEffFrom := snapshotAt.Add(-effectiveFromBuffer).UTC()
			seenKinds := make(map[unithistory.Kind]bool)
			for _, row := range rows {
				want, ok := tc.want[row.Kind]
				if !ok {
					t.Errorf("unexpected kind %q in rows", row.Kind)
					continue
				}
				if row.Value != want {
					t.Errorf("kind %s: value = %q, want %q", row.Kind, row.Value, want)
				}
				if row.Source != unithistory.SourceRESTBootstrap {
					t.Errorf("kind %s: source = %q, want %q", row.Kind, row.Source, unithistory.SourceRESTBootstrap)
				}
				if !row.EffectiveFrom.Equal(wantEffFrom) {
					t.Errorf("kind %s: effective_from = %v, want %v", row.Kind, row.EffectiveFrom, wantEffFrom)
				}
				if row.VehicleID != vehicleID {
					t.Errorf("kind %s: vehicle_id = %d, want %d", row.Kind, row.VehicleID, vehicleID)
				}
				seenKinds[row.Kind] = true
			}
			for _, kind := range []unithistory.Kind{
				unithistory.KindDistance,
				unithistory.KindTemperature,
				unithistory.KindPressure,
				unithistory.KindCharge,
			} {
				if !seenKinds[kind] {
					t.Errorf("missing row for kind %s", kind)
				}
			}
		})
	}
}

// ---------------------------------------------------------------------------
// Retry policy
// ---------------------------------------------------------------------------

// TestSeed_TransientRetryExhausted asserts that a fakeClient that
// always returns ErrTransient triggers exactly len(backoffs)+1
// attempts, increments the metric ONCE with the right labels, and
// returns nil so startup is not blocked.
func TestSeed_TransientRetryExhausted(t *testing.T) {
	const vehicleID int64 = 101
	repo := newFakeRepo()
	transientErr := fmt.Errorf("vehicle asleep: %w", ErrTransient)
	fc := newFakeClient([]fakeReply{{err: transientErr}}, true)

	backoffs := []time.Duration{10 * time.Millisecond, 10 * time.Millisecond}
	before := readPromCounterVec(t, bootstrapSkippedTotal, "101", "transient")
	b := New(fc, repo, zerolog.Nop(),
		WithSleep(noopSleep),
		WithBackoffs(backoffs),
	)

	err := b.Seed(context.Background(), vehicleID)
	if err != nil {
		t.Fatalf("Seed returned err = %v, want nil (retries exhausted is non-fatal)", err)
	}

	wantAttempts := len(backoffs) + 1
	if got := fc.callCount(); got != wantAttempts {
		t.Errorf("FetchGuiSettings calls = %d, want %d", got, wantAttempts)
	}

	if rows := repo.snapshot(); len(rows) != 0 {
		t.Errorf("rows = %d, want 0 (REST never succeeded)", len(rows))
	}

	after := readPromCounterVec(t, bootstrapSkippedTotal, "101", "transient")
	if delta := after - before; delta != 1 {
		t.Errorf("bootstrap_skipped_total{vehicle_id=101,reason=transient} delta = %v, want 1", delta)
	}
}

// TestSeed_AuthErrorImmediate asserts that ErrUnauthorized propagates
// after a single attempt with no metric increment.
func TestSeed_AuthErrorImmediate(t *testing.T) {
	const vehicleID int64 = 202
	repo := newFakeRepo()
	authErr := fmt.Errorf("401 token expired: %w", ErrUnauthorized)
	fc := newFakeClient([]fakeReply{{err: authErr}}, true)

	beforeAuth := readPromCounterVec(t, bootstrapSkippedTotal, "202", "transient")
	beforeUnknown := readPromCounterVec(t, bootstrapSkippedTotal, "202", "unknown")

	b := New(fc, repo, zerolog.Nop(),
		WithSleep(noopSleep),
		WithBackoffs([]time.Duration{10 * time.Millisecond, 10 * time.Millisecond}),
	)

	err := b.Seed(context.Background(), vehicleID)
	if !errors.Is(err, ErrUnauthorized) {
		t.Fatalf("Seed err = %v, want errors.Is(ErrUnauthorized) = true", err)
	}

	if got := fc.callCount(); got != 1 {
		t.Errorf("FetchGuiSettings calls = %d, want 1 (no retries on auth)", got)
	}
	if rows := repo.snapshot(); len(rows) != 0 {
		t.Errorf("rows = %d, want 0", len(rows))
	}
	if afterAuth := readPromCounterVec(t, bootstrapSkippedTotal, "202", "transient"); afterAuth != beforeAuth {
		t.Errorf("metric{vehicle_id=202,reason=transient} changed = %v, want unchanged", afterAuth-beforeAuth)
	}
	if afterUnknown := readPromCounterVec(t, bootstrapSkippedTotal, "202", "unknown"); afterUnknown != beforeUnknown {
		t.Errorf("metric{vehicle_id=202,reason=unknown} changed = %v, want unchanged", afterUnknown-beforeUnknown)
	}
}

// TestSeed_Idempotent_RowCount4 calls Seed twice with the same
// payload; the fake repo must end up with exactly 4 rows because
// Repo.Record treats a duplicate (vehicle_id, kind, effective_from,
// value, source) as ON CONFLICT DO NOTHING.
func TestSeed_Idempotent_RowCount4(t *testing.T) {
	const vehicleID int64 = 303
	snapshotAt := time.Date(2026, 5, 3, 0, 30, 0, 0, time.UTC)
	gui := GuiSettings{
		DistanceUnits:     "mi/hr",
		TemperatureUnits:  "F",
		TirePressureUnits: "Psi",
		ChargeRateUnits:   "mi/hr",
		Now:               snapshotAt,
	}
	repo := newFakeRepo()
	// Two successful replies (one per Seed call); the queue is
	// non-repeating so the test will fail loudly if Seed somehow
	// called the client a third time.
	fc := newFakeClient([]fakeReply{{gui: gui}, {gui: gui}}, false)
	b := New(fc, repo, zerolog.Nop(),
		WithClock(fixedClock(snapshotAt)),
		WithSleep(noopSleep),
	)

	for i := 0; i < 2; i++ {
		if err := b.Seed(context.Background(), vehicleID); err != nil {
			t.Fatalf("Seed call #%d returned err = %v, want nil", i+1, err)
		}
	}

	rows := repo.snapshot()
	if len(rows) != 4 {
		t.Errorf("after two Seed calls: rows = %d, want 4 (Repo.Record is idempotent on the natural key)", len(rows))
	}
	if got := fc.callCount(); got != 2 {
		t.Errorf("client call count = %d, want 2 (one REST per Seed call)", got)
	}
}

// TestSeed_BadGuiSettings asserts that an unrecognised unit string
// fails loudly and writes nothing — partial bootstrap is forbidden.
func TestSeed_BadGuiSettings(t *testing.T) {
	const vehicleID int64 = 404
	snapshotAt := time.Date(2026, 5, 3, 1, 0, 0, 0, time.UTC)
	gui := GuiSettings{
		DistanceUnits:     "mi/hr",
		TemperatureUnits:  "Kelvin", // unrecognised — Tesla never emits this
		TirePressureUnits: "Psi",
		ChargeRateUnits:   "mi/hr",
		Now:               snapshotAt,
	}
	repo := newFakeRepo()
	fc := newFakeClient([]fakeReply{{gui: gui}}, false)
	b := New(fc, repo, zerolog.Nop(),
		WithClock(fixedClock(snapshotAt)),
		WithSleep(noopSleep),
	)

	err := b.Seed(context.Background(), vehicleID)
	if !errors.Is(err, ErrBadGuiSettings) {
		t.Fatalf("Seed err = %v, want errors.Is(ErrBadGuiSettings) = true", err)
	}
	if rows := repo.snapshot(); len(rows) != 0 {
		t.Errorf("rows = %d, want 0 (all-or-nothing on schema drift)", len(rows))
	}
}

// TestSeed_ContextCancelledMidBackoff asserts that ctx cancellation
// during the sleep between attempts unwinds Seed cleanly with the
// context error and does NOT bump the skipped metric (cancellation
// is shutdown noise, not an operational signal).
func TestSeed_ContextCancelledMidBackoff(t *testing.T) {
	const vehicleID int64 = 505
	repo := newFakeRepo()
	transientErr := fmt.Errorf("transient cause: %w", ErrTransient)
	fc := newFakeClient([]fakeReply{{err: transientErr}}, true)

	beforeT := readPromCounterVec(t, bootstrapSkippedTotal, "505", "transient")
	beforeU := readPromCounterVec(t, bootstrapSkippedTotal, "505", "unknown")

	cancelSleep := func(ctx context.Context, _ time.Duration) error {
		return context.Canceled
	}
	b := New(fc, repo, zerolog.Nop(),
		WithSleep(cancelSleep),
		WithBackoffs([]time.Duration{1 * time.Millisecond, 1 * time.Millisecond}),
	)

	err := b.Seed(context.Background(), vehicleID)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("Seed err = %v, want errors.Is(context.Canceled) = true", err)
	}
	if got := fc.callCount(); got != 1 {
		t.Errorf("FetchGuiSettings calls = %d, want 1 (cancel hit before retry #2)", got)
	}
	if afterT := readPromCounterVec(t, bootstrapSkippedTotal, "505", "transient"); afterT != beforeT {
		t.Errorf("metric{reason=transient} changed = %v, want unchanged on context.Canceled", afterT-beforeT)
	}
	if afterU := readPromCounterVec(t, bootstrapSkippedTotal, "505", "unknown"); afterU != beforeU {
		t.Errorf("metric{reason=unknown} changed = %v, want unchanged on context.Canceled", afterU-beforeU)
	}
}

// TestSeed_RecoversOnLateAttempt asserts that a transient run that
// flips to success on the final attempt commits all 4 rows and does
// NOT bump the skipped metric.
func TestSeed_RecoversOnLateAttempt(t *testing.T) {
	const vehicleID int64 = 606
	snapshotAt := time.Date(2026, 5, 3, 2, 0, 0, 0, time.UTC)
	gui := GuiSettings{
		DistanceUnits:     "km/hr",
		TemperatureUnits:  "C",
		TirePressureUnits: "Bar",
		ChargeRateUnits:   "km/hr",
		Now:               snapshotAt,
	}
	transientErr := fmt.Errorf("rate limited: %w", ErrTransient)
	fc := newFakeClient([]fakeReply{
		{err: transientErr},
		{err: transientErr},
		{gui: gui},
	}, false)
	repo := newFakeRepo()
	beforeAny := readPromCounterVec(t, bootstrapSkippedTotal, "606", "transient")

	b := New(fc, repo, zerolog.Nop(),
		WithClock(fixedClock(snapshotAt)),
		WithSleep(noopSleep),
		WithBackoffs([]time.Duration{1 * time.Millisecond, 1 * time.Millisecond}),
	)
	if err := b.Seed(context.Background(), vehicleID); err != nil {
		t.Fatalf("Seed returned err = %v, want nil (recovered on attempt 3)", err)
	}
	if got := fc.callCount(); got != 3 {
		t.Errorf("FetchGuiSettings calls = %d, want 3", got)
	}
	if rows := repo.snapshot(); len(rows) != 4 {
		t.Errorf("rows = %d, want 4 after late recovery", len(rows))
	}
	if after := readPromCounterVec(t, bootstrapSkippedTotal, "606", "transient"); after != beforeAny {
		t.Errorf("metric{reason=transient} changed = %v, want unchanged on success", after-beforeAny)
	}
}

// TestSeed_ZeroVehicleID asserts the input-guard at the top of Seed.
func TestSeed_ZeroVehicleID(t *testing.T) {
	repo := newFakeRepo()
	fc := newFakeClient([]fakeReply{{}}, false)
	b := New(fc, repo, zerolog.Nop(), WithSleep(noopSleep))
	err := b.Seed(context.Background(), 0)
	if err == nil {
		t.Fatal("Seed(vehicleID=0) returned nil, want a non-nil error")
	}
	if fc.callCount() != 0 {
		t.Errorf("REST called %d times for vehicleID=0, want 0", fc.callCount())
	}
}

// TestSeed_FallbackToWallClock asserts that when GuiSettings.Now is
// zero, effective_from is derived from the configured clock at the
// moment of the successful REST call (minus the buffer).
func TestSeed_FallbackToWallClock(t *testing.T) {
	const vehicleID int64 = 707
	wallNow := time.Date(2026, 5, 3, 3, 0, 0, 0, time.UTC)
	gui := GuiSettings{
		DistanceUnits:     "mi/hr",
		TemperatureUnits:  "F",
		TirePressureUnits: "Psi",
		ChargeRateUnits:   "mi/hr",
		// Now intentionally zero — adapter could not extract it.
	}
	repo := newFakeRepo()
	fc := newFakeClient([]fakeReply{{gui: gui}}, false)
	b := New(fc, repo, zerolog.Nop(),
		WithClock(fixedClock(wallNow)),
		WithSleep(noopSleep),
	)
	if err := b.Seed(context.Background(), vehicleID); err != nil {
		t.Fatalf("Seed returned err = %v, want nil", err)
	}
	wantEff := wallNow.Add(-effectiveFromBuffer).UTC()
	for _, row := range repo.snapshot() {
		if !row.EffectiveFrom.Equal(wantEff) {
			t.Errorf("kind %s: effective_from = %v, want %v (wall-clock fallback)", row.Kind, row.EffectiveFrom, wantEff)
		}
	}
}
