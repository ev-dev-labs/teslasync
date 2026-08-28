package fleetstatesvc

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"

	vehiclemodel "github.com/ev-dev-labs/teslasync/internal/models/vehicle"
	"github.com/ev-dev-labs/teslasync/internal/service"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

// vehicleLister is the narrow roster surface the batch needs. Satisfied by
// *vehicledb.VehicleRepo in production and by an in-memory fake in tests, so
// the fan-out semantics are unit-testable without Postgres.
type vehicleLister interface {
	GetAll(ctx context.Context) ([]*vehiclemodel.Vehicle, error)
}

// stateResolver is the per-vehicle current-state assembler. Production is
// *service.VehicleService; the interface keeps the outcome classification and
// the isolation guarantees testable with a deterministic fake.
type stateResolver interface {
	ResolveCurrentState(
		ctx context.Context,
		vehicle *vehiclemodel.Vehicle,
		live signal.LiveSignalStore,
		now time.Time,
	) (service.CurrentState, error)
}

// bulkStateResolver is the OPTIONAL bulk-read capability of a stateResolver.
//
// A resolver that implements it lets the batch take ONE pipelined Redis read,
// ONE set-based signal_log query and ONE set-based fsm_transitions query for
// the whole page instead of three round trips per vehicle. A resolver that
// does not is still correct — it simply keeps the per-vehicle fan-out — so the
// capability is a type assertion rather than a hard requirement.
type bulkStateResolver interface {
	// PrefetchCurrentStates performs the batch's bulk storage reads. It
	// returns an error only when no honest answer is possible at all (an
	// already-cancelled context); every per-layer failure is recorded inside
	// the prefetch and degrades exactly the vehicles it affects.
	PrefetchCurrentStates(
		ctx context.Context,
		vehicleIDs []int64,
		live signal.LiveSignalStore,
		now time.Time,
	) (*service.CurrentStatePrefetch, error)

	// ResolveCurrentStateWith resolves one vehicle from the prefetched inputs,
	// falling back to that layer's own read for anything the prefetch does not
	// cover.
	ResolveCurrentStateWith(
		ctx context.Context,
		vehicle *vehiclemodel.Vehicle,
		live signal.LiveSignalStore,
		now time.Time,
		pre *service.CurrentStatePrefetch,
	) (service.CurrentState, error)
}

// Compile-time proof the production types still satisfy the ports.
var (
	_ stateResolver     = (*service.VehicleService)(nil)
	_ bulkStateResolver = (*service.VehicleService)(nil)
)

// ErrNotConfigured is returned when a required dependency was not wired. The
// handler maps it to 503 for just this route rather than crashing the pod.
var ErrNotConfigured = errors.New("fleet state subsystem not configured on this deployment")

// Defaults chosen for a fleet-scale read.
//
// DefaultWorkers bounds concurrent per-vehicle resolution. With the bulk
// prefetch in place the per-vehicle step is CPU-bound assembly, but the bound
// still matters for the fallback path (a store without the bulk capability),
// where 8 keeps the tail latency of a large fleet well under the per-request
// budget while leaving the connection pool available to the rest of the API.
//
// DefaultPerVehicleTimeout is what turns ONE pathological vehicle (a wedged
// Redis key, a slow signal_log scan) into a single `failed` item instead of a
// timed-out batch that hides the other 99 cars.
//
// DefaultPrefetchTimeout bounds the batch-level bulk reads. It is larger than
// the per-vehicle timeout because it covers the whole page in one query, and
// expiring it is a DEGRADATION (each vehicle falls back to its own reads),
// never a batch failure.
const (
	DefaultWorkers           = 8
	DefaultPerVehicleTimeout = 3 * time.Second
	DefaultPrefetchTimeout   = 5 * time.Second
	DefaultLimit             = 200
	MaxLimit                 = 500
)

// Service orchestrates one fleet-wide current-state read.
type Service struct {
	vehicles          vehicleLister
	resolver          stateResolver
	bulk              bulkStateResolver
	live              signal.LiveSignalStore
	now               func() time.Time
	workers           int
	perVehicleTimeout time.Duration
	prefetchTimeout   time.Duration
	cache             *resultCache
	onResolverError   func(context.Context, int64, error)
	onResolverPanic   func(context.Context, int64, any)
	onPrefetchError   func(context.Context, error)
}

// Options bundles constructor parameters. Nil concrete pointers are left as
// genuinely-nil interfaces so the `== nil` guards return ErrNotConfigured
// instead of panicking on a typed-nil.
type Options struct {
	Vehicles vehicleLister
	Resolver stateResolver
	// Live may be nil (or a no-op store); ResolveCurrentState then answers
	// from durable records only, with freshness `unknown`.
	Live              signal.LiveSignalStore
	Now               func() time.Time
	Workers           int
	PerVehicleTimeout time.Duration
	PrefetchTimeout   time.Duration
	// CacheTTL enables the coalescing + successful-result micro-cache.
	// Zero DISABLES it entirely (every request executes its own read), which
	// is what unit tests that assert per-call behaviour want. Values above
	// MaxCacheTTL are clamped.
	CacheTTL time.Duration
	// SharedWorkTimeout bounds a coalesced execution once it is detached from
	// the request that initiated it. Defaults to DefaultSharedWorkTimeout.
	SharedWorkTimeout time.Duration
	// Resolver failures are reported at the HTTP boundary, where the active
	// trace can be attached without coupling this application service to
	// OpenTelemetry.
	OnResolverError func(context.Context, int64, error)
	OnResolverPanic func(context.Context, int64, any)
	// OnPrefetchError reports a batch-level bulk-read failure. The batch still
	// answers (each vehicle falls back to its own reads), but an operator must
	// be able to see that the fleet-scale path degraded.
	OnPrefetchError func(context.Context, error)
	// OnCacheOutcome reports how a request was served (hit / coalesced /
	// executed). Optional; used by the HTTP boundary for span attributes.
	OnCacheOutcome func(context.Context, CacheOutcome)
}

// New constructs the service.
func New(opt Options) *Service {
	s := &Service{
		live:              opt.Live,
		now:               opt.Now,
		workers:           opt.Workers,
		perVehicleTimeout: opt.PerVehicleTimeout,
		prefetchTimeout:   opt.PrefetchTimeout,
		onResolverError:   opt.OnResolverError,
		onResolverPanic:   opt.OnResolverPanic,
		onPrefetchError:   opt.OnPrefetchError,
	}
	// Guard each interface assignment so a nil concrete pointer does not
	// become a non-nil interface wrapping nil.
	if opt.Vehicles != nil {
		s.vehicles = opt.Vehicles
	}
	if opt.Resolver != nil {
		s.resolver = opt.Resolver
		if bulk, ok := opt.Resolver.(bulkStateResolver); ok {
			s.bulk = bulk
		}
	}
	if s.now == nil {
		s.now = time.Now
	}
	if s.workers <= 0 {
		s.workers = DefaultWorkers
	}
	if s.perVehicleTimeout <= 0 {
		s.perVehicleTimeout = DefaultPerVehicleTimeout
	}
	if s.prefetchTimeout <= 0 {
		s.prefetchTimeout = DefaultPrefetchTimeout
	}
	if opt.CacheTTL > 0 {
		s.cache = newResultCache(opt.CacheTTL, opt.SharedWorkTimeout, s.now, opt.OnCacheOutcome)
	}
	return s
}

// FleetStates resolves the current state of every selected vehicle.
//
// The returned error is reserved for whole-batch failures (unwired subsystem,
// roster read failure). Per-vehicle problems are reported INSIDE the batch as
// `failed` items so one bad live read can never blank the fleet.
//
// When the micro-cache is enabled, identical normalized requests within its
// window share one execution and one result — see cache.go for the key,
// copy-safety and cancellation contract.
func (s *Service) FleetStates(ctx context.Context, q Query) (*Batch, error) {
	if s == nil || s.vehicles == nil || s.resolver == nil {
		return nil, ErrNotConfigured
	}
	// Normalizing BEFORE the cache key is what makes "1,2" and "2,1,1" the
	// same question — and what keeps two genuinely different questions from
	// ever sharing an answer.
	normalized := normalize(q)
	if s.cache == nil {
		return s.fleetStates(ctx, normalized)
	}
	return s.cache.do(ctx, cacheKey(normalized), func(workCtx context.Context) (*Batch, error) {
		return s.fleetStates(workCtx, normalized)
	})
}

// fleetStates is the uncached read. `q` MUST already be normalized.
func (s *Service) fleetStates(ctx context.Context, q Query) (*Batch, error) {
	// ONE instant for the whole request. Every freshness verdict in this
	// payload is measured against it.
	now := s.now().UTC()

	roster, err := s.vehicles.GetAll(ctx)
	if err != nil {
		return nil, fmt.Errorf("list vehicles for fleet state: %w", err)
	}

	selected := selectVehicles(roster, q.VehicleIDs)
	total := len(selected)

	limit := q.Limit
	offset := q.Offset
	page := selected
	if offset >= len(page) {
		page = nil
	} else {
		page = page[offset:]
	}
	if len(page) > limit {
		page = page[:limit]
	}

	items := make([]VehicleStateItem, len(page))
	pre := s.prefetch(ctx, page, now)
	s.resolveAll(ctx, page, now, pre, items)

	batch := &Batch{
		Now:      now,
		Total:    total,
		Limit:    limit,
		Offset:   offset,
		Vehicles: items,
	}
	for i := range items {
		switch items[i].Outcome {
		case OutcomeResolved:
			batch.Counts.Resolved++
		case OutcomeMissing:
			batch.Counts.Missing++
		default:
			batch.Counts.Failed++
		}
	}
	// Derived from the finished items and the SAME request-level now, so the
	// posture panel and the vehicle list cannot tell different stories.
	batch.Summary = summarise(items, now)
	return batch, nil
}

// prefetch performs the batch-level bulk storage reads.
//
// Returns nil when the resolver has no bulk capability or the page is empty;
// callers pass a nil prefetch straight through and every layer reads per
// vehicle exactly as before. A prefetch FAILURE is reported and then ignored
// for the same reason: the per-vehicle path is still correct.
func (s *Service) prefetch(
	ctx context.Context,
	page []*vehiclemodel.Vehicle,
	now time.Time,
) *service.CurrentStatePrefetch {
	if s.bulk == nil || len(page) == 0 {
		return nil
	}
	ids := make([]int64, 0, len(page))
	for _, vehicle := range page {
		if vehicle != nil {
			ids = append(ids, vehicle.ID)
		}
	}
	if len(ids) == 0 {
		return nil
	}

	// Its own bound: a slow bulk read degrades to the per-vehicle path
	// instead of eating the whole request budget. Derived from ctx, so a
	// cancelled request stops here too.
	prefetchCtx, cancel := context.WithTimeout(ctx, s.prefetchTimeout)
	defer cancel()

	pre, err := s.bulk.PrefetchCurrentStates(prefetchCtx, ids, s.live, now)
	if err != nil {
		if s.onPrefetchError != nil {
			s.onPrefetchError(ctx, err)
		}
		return nil
	}
	return pre
}

// resolveAll fans the page out across a bounded worker pool, writing each
// result into its ORIGINAL index so the response order matches the roster
// order regardless of completion order.
func (s *Service) resolveAll(
	ctx context.Context,
	page []*vehiclemodel.Vehicle,
	now time.Time,
	pre *service.CurrentStatePrefetch,
	out []VehicleStateItem,
) {
	if len(page) == 0 {
		return
	}
	workers := s.workers
	if workers > len(page) {
		workers = len(page)
	}

	indexes := make(chan int)
	var wg sync.WaitGroup
	wg.Add(workers)
	for w := 0; w < workers; w++ {
		go func() {
			defer wg.Done()
			for i := range indexes {
				out[i] = s.resolveOne(ctx, page[i], now, pre)
			}
		}()
	}
	for i := range page {
		indexes <- i
	}
	close(indexes)
	wg.Wait()
}

// resolveOne resolves a single vehicle under its own timeout and converts the
// result — or the failure — into a wire item.
//
// The panic guard is deliberate: an assembler bug on ONE vehicle must not take
// down the HTTP goroutine and, with it, the other 99 vehicles' answers.
func (s *Service) resolveOne(
	ctx context.Context,
	vehicle *vehiclemodel.Vehicle,
	now time.Time,
	pre *service.CurrentStatePrefetch,
) (item VehicleStateItem) {
	if vehicle == nil {
		return VehicleStateItem{
			Outcome:        OutcomeFailed,
			DataSource:     DataSourceUnavailable,
			Freshness:      string(service.FreshnessUnknown),
			VerifiedFields: []string{},
			Error:          ErrCodeStateUnavailable,
		}
	}
	item = VehicleStateItem{
		VehicleID:      vehicle.ID,
		Outcome:        OutcomeFailed,
		DataSource:     DataSourceUnavailable,
		Freshness:      string(service.FreshnessUnknown),
		VerifiedFields: []string{},
		Error:          ErrCodeStateUnavailable,
	}

	defer func() {
		if r := recover(); r != nil {
			if s.onResolverPanic != nil {
				s.onResolverPanic(ctx, vehicle.ID, r)
			}
			item = VehicleStateItem{
				VehicleID:      vehicle.ID,
				Outcome:        OutcomeFailed,
				DataSource:     DataSourceUnavailable,
				Freshness:      string(service.FreshnessUnknown),
				VerifiedFields: []string{},
				Error:          ErrCodeStateUnavailable,
			}
		}
	}()

	vehicleCtx, cancel := context.WithTimeout(ctx, s.perVehicleTimeout)
	defer cancel()

	resolved, err := s.resolveWithPrefetch(vehicleCtx, vehicle, now, pre)
	if err != nil {
		if s.onResolverError != nil {
			s.onResolverError(ctx, vehicle.ID, err)
		}
		return item
	}
	if resolved.State == nil {
		// The read succeeded and there is authoritatively nothing to show.
		return VehicleStateItem{
			VehicleID:      vehicle.ID,
			Outcome:        OutcomeMissing,
			DataSource:     DataSourceUnavailable,
			Freshness:      string(service.FreshnessUnknown),
			VerifiedFields: []string{},
		}
	}

	verified := resolved.VerifiedFields
	if verified == nil {
		verified = []string{}
	}
	freshness := resolved.Freshness
	if freshness == "" {
		freshness = service.FreshnessUnknown
	}
	return VehicleStateItem{
		VehicleID:      vehicle.ID,
		Outcome:        OutcomeResolved,
		State:          resolved.State,
		Live:           resolved.Live,
		DataSource:     resolved.DataSource,
		ObservedAt:     resolved.ObservedAt,
		Freshness:      string(freshness),
		VerifiedFields: verified,
	}
}

// resolveWithPrefetch routes one vehicle through the bulk-aware resolver when
// the batch prefetched its inputs, and through the plain per-vehicle resolver
// otherwise. Both produce the SAME verdict from the same data; only the number
// of storage round trips differs.
func (s *Service) resolveWithPrefetch(
	ctx context.Context,
	vehicle *vehiclemodel.Vehicle,
	now time.Time,
	pre *service.CurrentStatePrefetch,
) (service.CurrentState, error) {
	if pre != nil && s.bulk != nil {
		return s.bulk.ResolveCurrentStateWith(ctx, vehicle, s.live, now, pre)
	}
	return s.resolver.ResolveCurrentState(ctx, vehicle, s.live, now)
}

// selectVehicles filters the roster down to the requested ids, preserving
// roster order. An empty id set means the whole fleet.
//
// Ids the roster does not contain are silently dropped rather than echoed
// back: a client asking about a vehicle it does not own must not be able to
// confirm that vehicle's existence from the response shape.
func selectVehicles(roster []*vehiclemodel.Vehicle, ids []int64) []*vehiclemodel.Vehicle {
	out := make([]*vehiclemodel.Vehicle, 0, len(roster))
	if len(ids) == 0 {
		for _, v := range roster {
			if v != nil {
				out = append(out, v)
			}
		}
		return out
	}
	wanted := make(map[int64]struct{}, len(ids))
	for _, id := range ids {
		wanted[id] = struct{}{}
	}
	for _, v := range roster {
		if v == nil {
			continue
		}
		if _, ok := wanted[v.ID]; ok {
			out = append(out, v)
		}
	}
	return out
}
