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

// Compile-time proof the production types still satisfy the ports.
var _ stateResolver = (*service.VehicleService)(nil)

// ErrNotConfigured is returned when a required dependency was not wired. The
// handler maps it to 503 for just this route rather than crashing the pod.
var ErrNotConfigured = errors.New("fleet state subsystem not configured on this deployment")

// Defaults chosen for a fleet-scale read.
//
// DefaultWorkers bounds concurrent live-store reads so a 500-vehicle fleet
// cannot open 500 simultaneous Redis round trips; 8 keeps the tail latency of
// a large fleet well under the per-request budget while leaving the connection
// pool available to the rest of the API.
//
// DefaultPerVehicleTimeout is what turns ONE pathological vehicle (a wedged
// Redis key, a slow signal_log scan) into a single `failed` item instead of a
// timed-out batch that hides the other 99 cars.
const (
	DefaultWorkers           = 8
	DefaultPerVehicleTimeout = 3 * time.Second
	DefaultLimit             = 200
	MaxLimit                 = 500
)

// Service orchestrates one fleet-wide current-state read.
type Service struct {
	vehicles          vehicleLister
	resolver          stateResolver
	live              signal.LiveSignalStore
	now               func() time.Time
	workers           int
	perVehicleTimeout time.Duration
	onResolverError   func(context.Context, int64, error)
	onResolverPanic   func(context.Context, int64, any)
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
	// Resolver failures are reported at the HTTP boundary, where the active
	// trace can be attached without coupling this application service to
	// OpenTelemetry.
	OnResolverError func(context.Context, int64, error)
	OnResolverPanic func(context.Context, int64, any)
}

// New constructs the service.
func New(opt Options) *Service {
	s := &Service{
		live:              opt.Live,
		now:               opt.Now,
		workers:           opt.Workers,
		perVehicleTimeout: opt.PerVehicleTimeout,
		onResolverError:   opt.OnResolverError,
		onResolverPanic:   opt.OnResolverPanic,
	}
	// Guard each interface assignment so a nil concrete pointer does not
	// become a non-nil interface wrapping nil.
	if opt.Vehicles != nil {
		s.vehicles = opt.Vehicles
	}
	if opt.Resolver != nil {
		s.resolver = opt.Resolver
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
	return s
}

// FleetStates resolves the current state of every selected vehicle.
//
// The returned error is reserved for whole-batch failures (unwired subsystem,
// roster read failure). Per-vehicle problems are reported INSIDE the batch as
// `failed` items so one bad live read can never blank the fleet.
func (s *Service) FleetStates(ctx context.Context, q Query) (*Batch, error) {
	if s == nil || s.vehicles == nil || s.resolver == nil {
		return nil, ErrNotConfigured
	}

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
	if limit <= 0 {
		limit = DefaultLimit
	}
	if limit > MaxLimit {
		limit = MaxLimit
	}
	offset := q.Offset
	if offset < 0 {
		offset = 0
	}
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
	s.resolveAll(ctx, page, now, items)

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
	return batch, nil
}

// resolveAll fans the page out across a bounded worker pool, writing each
// result into its ORIGINAL index so the response order matches the roster
// order regardless of completion order.
func (s *Service) resolveAll(
	ctx context.Context,
	page []*vehiclemodel.Vehicle,
	now time.Time,
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
				out[i] = s.resolveOne(ctx, page[i], now)
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

	resolved, err := s.resolver.ResolveCurrentState(vehicleCtx, vehicle, s.live, now)
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
