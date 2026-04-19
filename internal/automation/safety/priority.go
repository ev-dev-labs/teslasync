// Package safety implements pre-execution safety checks for automations.
package safety

import (
	"fmt"
	"sort"

	"github.com/rs/zerolog"
	"github.com/rs/zerolog/log"
)

// ─── Default Category Priorities ───────────────────────
//
// Recommended default priorities per automation category.
// These are advisory constants for the UI/API layer when creating automations;
// the PriorityQueue orders by the automation's actual priority field value.
// Lower numbers execute first (1 = highest priority, 100 = lowest).
const (
	DefaultPrioritySecurity = 10
	DefaultPriorityCharging = 30
	DefaultPriorityClimate  = 50
	DefaultPriorityComfort  = 70
	DefaultPriorityMedia    = 90
)

// minPriority and maxPriority define the valid priority range.
const (
	minPriority = 1
	maxPriority = 100
)

// DefaultPriority returns the recommended default priority for an automation
// category. Returns DefaultPriorityComfort (70) for unknown categories.
func DefaultPriority(category string) int {
	switch category {
	case "security":
		return DefaultPrioritySecurity
	case "charging":
		return DefaultPriorityCharging
	case "climate":
		return DefaultPriorityClimate
	case "comfort":
		return DefaultPriorityComfort
	case "media":
		return DefaultPriorityMedia
	default:
		return DefaultPriorityComfort
	}
}

// ─── Queue Item ────────────────────────────────────────

// QueueItem represents a triggered automation waiting to be executed.
// The caller populates these from the triggered automation set.
type QueueItem struct {
	AutomationID int64       // unique automation ID — final tiebreaker
	Priority     int         // 1 (highest) to 100 (lowest)
	CreatedAt    int64       // unix timestamp from automation.CreatedAt; older = first
	Payload      interface{} // opaque — caller attaches full automation or execution context
}

// ─── Priority Queue ────────────────────────────────────
//
// PriorityQueue orders a batch of simultaneously triggered automations for
// sequential execution. It is designed to be used per-dispatch-batch (e.g.,
// per vehicle, per trigger event) — not as a process-wide scheduler.
//
// Ordering rules:
//  1. Lower priority number executes first (1 = highest priority).
//  2. Equal priority: earlier CreatedAt executes first.
//  3. Equal priority and CreatedAt: lower AutomationID executes first.
type PriorityQueue struct {
	items  []QueueItem
	logger zerolog.Logger
}

// PriorityQueueOption configures a PriorityQueue.
type PriorityQueueOption func(*PriorityQueue)

// WithLogger sets a custom logger for the queue.
func WithLogger(logger zerolog.Logger) PriorityQueueOption {
	return func(pq *PriorityQueue) { pq.logger = logger }
}

// NewPriorityQueue creates a PriorityQueue with the given options.
func NewPriorityQueue(opts ...PriorityQueueOption) *PriorityQueue {
	pq := &PriorityQueue{
		logger: log.With().
			Str("component", "priority_queue").
			Logger(),
	}
	for _, opt := range opts {
		opt(pq)
	}
	return pq
}

// ─── Enqueue / Sort / Drain ────────────────────────────

// Enqueue adds a triggered automation to the queue.
//
// Returns an error if the priority is outside the valid range [1, 100].
// A priority of 0 is treated as "unset" and defaults to DefaultPriorityComfort (70).
func (pq *PriorityQueue) Enqueue(item QueueItem) error {
	if item.Priority == 0 {
		item.Priority = DefaultPriorityComfort
		pq.logger.Debug().
			Int64("automation_id", item.AutomationID).
			Int("priority", item.Priority).
			Msg("priority unset, defaulting to comfort level")
	}

	if item.Priority < minPriority || item.Priority > maxPriority {
		return fmt.Errorf(
			"invalid priority %d for automation %d: must be %d–%d",
			item.Priority, item.AutomationID, minPriority, maxPriority,
		)
	}

	pq.items = append(pq.items, item)
	return nil
}

// Len returns the number of items in the queue.
func (pq *PriorityQueue) Len() int {
	return len(pq.items)
}

// Drain sorts the queued items by priority and returns them in execution order.
// The queue is emptied after this call.
//
// Ordering: priority ASC → created_at ASC → automation_id ASC.
func (pq *PriorityQueue) Drain() []QueueItem {
	if len(pq.items) == 0 {
		return nil
	}

	sort.SliceStable(pq.items, func(i, j int) bool {
		a, b := pq.items[i], pq.items[j]

		if a.Priority != b.Priority {
			return a.Priority < b.Priority
		}
		if a.CreatedAt != b.CreatedAt {
			return a.CreatedAt < b.CreatedAt
		}
		return a.AutomationID < b.AutomationID
	})

	result := pq.items
	pq.items = nil

	pq.logger.Debug().
		Int("count", len(result)).
		Msg("drained priority queue")

	return result
}

// Peek returns the items in priority order without draining the queue.
// Returns a copy so the caller cannot mutate internal state.
func (pq *PriorityQueue) Peek() []QueueItem {
	if len(pq.items) == 0 {
		return nil
	}

	cp := make([]QueueItem, len(pq.items))
	copy(cp, pq.items)

	sort.SliceStable(cp, func(i, j int) bool {
		a, b := cp[i], cp[j]

		if a.Priority != b.Priority {
			return a.Priority < b.Priority
		}
		if a.CreatedAt != b.CreatedAt {
			return a.CreatedAt < b.CreatedAt
		}
		return a.AutomationID < b.AutomationID
	})

	return cp
}

// Reset clears all items from the queue.
func (pq *PriorityQueue) Reset() {
	pq.items = nil
}

// ─── Validation Helper ─────────────────────────────────

// ValidatePriority checks whether a priority value is within the allowed range.
// Returns nil for valid values, an error otherwise. A value of 0 is allowed
// (treated as "unset" and defaulted at enqueue time).
func ValidatePriority(priority int) error {
	if priority == 0 {
		return nil
	}
	if priority < minPriority || priority > maxPriority {
		return fmt.Errorf("invalid priority %d: must be 0 (unset) or %d–%d", priority, minPriority, maxPriority)
	}
	return nil
}
