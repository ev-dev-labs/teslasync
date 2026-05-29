package safety

import (
	"testing"
)

func TestDefaultPriority_KnownCategories(t *testing.T) {
	tests := []struct {
		category string
		want     int
	}{
		{"security", DefaultPrioritySecurity},
		{"charging", DefaultPriorityCharging},
		{"climate", DefaultPriorityClimate},
		{"comfort", DefaultPriorityComfort},
		{"media", DefaultPriorityMedia},
	}

	for _, tt := range tests {
		t.Run(tt.category, func(t *testing.T) {
			if got := DefaultPriority(tt.category); got != tt.want {
				t.Errorf("DefaultPriority(%q) = %d, want %d", tt.category, got, tt.want)
			}
		})
	}
}

func TestDefaultPriority_UnknownCategory(t *testing.T) {
	if got := DefaultPriority("unknown"); got != DefaultPriorityComfort {
		t.Errorf("DefaultPriority(unknown) = %d, want %d", got, DefaultPriorityComfort)
	}
}

func TestEnqueue_ValidPriorities(t *testing.T) {
	tests := []struct {
		name     string
		priority int
		wantPri  int // expected priority after enqueue
	}{
		{"min_priority", 1, 1},
		{"max_priority", 100, 100},
		{"mid_priority", 50, 50},
		{"unset_defaults_to_comfort", 0, DefaultPriorityComfort},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pq := NewPriorityQueue()
			err := pq.Enqueue(QueueItem{
				AutomationID: 1,
				Priority:     tt.priority,
				CreatedAt:    1000,
			})
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			items := pq.Drain()
			if len(items) != 1 {
				t.Fatalf("got %d items, want 1", len(items))
			}
			if items[0].Priority != tt.wantPri {
				t.Errorf("priority = %d, want %d", items[0].Priority, tt.wantPri)
			}
		})
	}
}

func TestEnqueue_InvalidPriorities(t *testing.T) {
	tests := []struct {
		name     string
		priority int
	}{
		{"negative", -1},
		{"over_max", 101},
		{"way_over", 500},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			pq := NewPriorityQueue()
			err := pq.Enqueue(QueueItem{
				AutomationID: 1,
				Priority:     tt.priority,
				CreatedAt:    1000,
			})
			if err == nil {
				t.Fatalf("expected error for priority %d, got nil", tt.priority)
			}
		})
	}
}

func TestDrain_OrdersByPriority(t *testing.T) {
	pq := NewPriorityQueue()

	// Enqueue in reverse priority order.
	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 90, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 2, Priority: 10, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 3, Priority: 50, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 4, Priority: 30, CreatedAt: 1000})

	items := pq.Drain()
	wantOrder := []int64{2, 4, 3, 1}
	assertOrder(t, items, wantOrder)
}

func TestDrain_TiebreakByCreatedAt(t *testing.T) {
	pq := NewPriorityQueue()

	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 50, CreatedAt: 3000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 2, Priority: 50, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 3, Priority: 50, CreatedAt: 2000})

	items := pq.Drain()
	wantOrder := []int64{2, 3, 1} // oldest first
	assertOrder(t, items, wantOrder)
}

func TestDrain_TiebreakByAutomationID(t *testing.T) {
	pq := NewPriorityQueue()

	// Same priority, same created_at — fall back to automation ID.
	mustEnqueue(t, pq, QueueItem{AutomationID: 99, Priority: 50, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 5, Priority: 50, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 42, Priority: 50, CreatedAt: 1000})

	items := pq.Drain()
	wantOrder := []int64{5, 42, 99}
	assertOrder(t, items, wantOrder)
}

func TestDrain_MixedPriorityAndCreatedAt(t *testing.T) {
	pq := NewPriorityQueue()

	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 50, CreatedAt: 2000}) // climate, newer
	mustEnqueue(t, pq, QueueItem{AutomationID: 2, Priority: 10, CreatedAt: 3000}) // security
	mustEnqueue(t, pq, QueueItem{AutomationID: 3, Priority: 50, CreatedAt: 1000}) // climate, older
	mustEnqueue(t, pq, QueueItem{AutomationID: 4, Priority: 90, CreatedAt: 500})  // media
	mustEnqueue(t, pq, QueueItem{AutomationID: 5, Priority: 30, CreatedAt: 1500}) // charging

	items := pq.Drain()
	// security(10) → charging(30) → climate-older(50) → climate-newer(50) → media(90)
	wantOrder := []int64{2, 5, 3, 1, 4}
	assertOrder(t, items, wantOrder)
}

func TestDrain_Empty(t *testing.T) {
	pq := NewPriorityQueue()
	items := pq.Drain()
	if items != nil {
		t.Errorf("Drain() on empty queue = %v, want nil", items)
	}
}

func TestDrain_SingleItem(t *testing.T) {
	pq := NewPriorityQueue()
	mustEnqueue(t, pq, QueueItem{AutomationID: 42, Priority: 10, CreatedAt: 1000})

	items := pq.Drain()
	if len(items) != 1 {
		t.Fatalf("got %d items, want 1", len(items))
	}
	if items[0].AutomationID != 42 {
		t.Errorf("item ID = %d, want 42", items[0].AutomationID)
	}
}

func TestDrain_EmptiesQueue(t *testing.T) {
	pq := NewPriorityQueue()
	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 10, CreatedAt: 1000})

	_ = pq.Drain()
	if pq.Len() != 0 {
		t.Errorf("Len() after Drain() = %d, want 0", pq.Len())
	}

	second := pq.Drain()
	if second != nil {
		t.Errorf("second Drain() = %v, want nil", second)
	}
}

func TestPeek_ReturnsOrderedCopy(t *testing.T) {
	pq := NewPriorityQueue()
	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 90, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 2, Priority: 10, CreatedAt: 1000})

	peeked := pq.Peek()
	assertOrder(t, peeked, []int64{2, 1})

	// Queue is NOT emptied.
	if pq.Len() != 2 {
		t.Errorf("Len() after Peek() = %d, want 2", pq.Len())
	}
}

func TestPeek_Empty(t *testing.T) {
	pq := NewPriorityQueue()
	if got := pq.Peek(); got != nil {
		t.Errorf("Peek() on empty queue = %v, want nil", got)
	}
}

func TestLen(t *testing.T) {
	pq := NewPriorityQueue()
	if pq.Len() != 0 {
		t.Errorf("Len() on new queue = %d, want 0", pq.Len())
	}

	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 10, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 2, Priority: 20, CreatedAt: 2000})
	if pq.Len() != 2 {
		t.Errorf("Len() = %d, want 2", pq.Len())
	}
}

func TestReset(t *testing.T) {
	pq := NewPriorityQueue()
	mustEnqueue(t, pq, QueueItem{AutomationID: 1, Priority: 10, CreatedAt: 1000})
	mustEnqueue(t, pq, QueueItem{AutomationID: 2, Priority: 20, CreatedAt: 2000})

	pq.Reset()
	if pq.Len() != 0 {
		t.Errorf("Len() after Reset() = %d, want 0", pq.Len())
	}
}

func TestDrain_PreservesPayload(t *testing.T) {
	pq := NewPriorityQueue()
	payload := map[string]string{"action": "lock_doors"}

	mustEnqueue(t, pq, QueueItem{
		AutomationID: 1,
		Priority:     10,
		CreatedAt:    1000,
		Payload:      payload,
	})

	items := pq.Drain()
	got, ok := items[0].Payload.(map[string]string)
	if !ok {
		t.Fatalf("payload type = %T, want map[string]string", items[0].Payload)
	}
	if got["action"] != "lock_doors" {
		t.Errorf("payload[action] = %q, want %q", got["action"], "lock_doors")
	}
}

func TestValidatePriority(t *testing.T) {
	tests := []struct {
		name     string
		priority int
		wantErr  bool
	}{
		{"zero_unset", 0, false},
		{"min", 1, false},
		{"max", 100, false},
		{"mid", 50, false},
		{"negative", -1, true},
		{"over_max", 101, true},
		{"way_over", 999, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidatePriority(tt.priority)
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidatePriority(%d) error = %v, wantErr %v", tt.priority, err, tt.wantErr)
			}
		})
	}
}

func mustEnqueue(t *testing.T, pq *PriorityQueue, item QueueItem) {
	t.Helper()
	if err := pq.Enqueue(item); err != nil {
		t.Fatalf("Enqueue(%+v) unexpected error: %v", item, err)
	}
}

func assertOrder(t *testing.T, items []QueueItem, wantIDs []int64) {
	t.Helper()
	if len(items) != len(wantIDs) {
		t.Fatalf("got %d items, want %d", len(items), len(wantIDs))
	}
	for i, want := range wantIDs {
		if items[i].AutomationID != want {
			t.Errorf("items[%d].AutomationID = %d, want %d", i, items[i].AutomationID, want)
		}
	}
}
