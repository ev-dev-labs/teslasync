package database

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
)

func TestIsTransient(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want bool
	}{
		{"nil error", nil, false},
		{"context cancelled", context.Canceled, false},
		{"context deadline exceeded", context.DeadlineExceeded, true},
		{"wrapped deadline exceeded", fmt.Errorf("query: %w", context.DeadlineExceeded), true},
		{"wrapped cancelled", fmt.Errorf("query: %w", context.Canceled), false},
		{"connection refused string", errors.New("dial tcp 127.0.0.1:5432: connection refused"), true},
		{"connection reset string", errors.New("read: connection reset by peer"), true},
		{"broken pipe string", errors.New("write: broken pipe"), true},
		{"i/o timeout string", errors.New("read tcp 10.0.0.1:5432: i/o timeout"), true},
		{"connection timed out string", errors.New("dial tcp: connection timed out"), true},
		{"no such host string", errors.New("dial tcp: lookup db.example.com: no such host"), true},
		{"pg class 08 connection exception", &pgconn.PgError{Code: "08006"}, true},
		{"pg class 53 insufficient resources", &pgconn.PgError{Code: "53300"}, true},
		{"pg class 57 operator intervention", &pgconn.PgError{Code: "57P01"}, true},
		{"pg class 23 constraint violation", &pgconn.PgError{Code: "23505"}, false},
		{"pg class 42 syntax error", &pgconn.PgError{Code: "42601"}, false},
		{"pg class 22 data exception", &pgconn.PgError{Code: "22003"}, false},
		{"random application error", errors.New("invalid vehicle ID"), false},
		{"empty pg code", &pgconn.PgError{Code: ""}, false},
		{"short pg code", &pgconn.PgError{Code: "0"}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := IsTransient(tt.err)
			if got != tt.want {
				t.Errorf("IsTransient(%v) = %v, want %v", tt.err, got, tt.want)
			}
		})
	}
}

func TestRetryOnTransient_SucceedsFirstAttempt(t *testing.T) {
	calls := 0
	err := RetryOnTransient(context.Background(), "test", func(ctx context.Context) error {
		calls++
		return nil
	})
	if err != nil {
		t.Errorf("RetryOnTransient() error = %v, want nil", err)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1", calls)
	}
}

func TestRetryOnTransient_RetriesOnTransientError(t *testing.T) {
	calls := 0
	err := RetryOnTransient(context.Background(), "test", func(ctx context.Context) error {
		calls++
		if calls < 3 {
			return errors.New("connection refused")
		}
		return nil
	})
	if err != nil {
		t.Errorf("RetryOnTransient() error = %v, want nil", err)
	}
	if calls != 3 {
		t.Errorf("calls = %d, want 3", calls)
	}
}

func TestRetryOnTransient_FailsFastOnPermanentError(t *testing.T) {
	calls := 0
	permErr := &pgconn.PgError{Code: "23505", Message: "unique constraint violation"}
	err := RetryOnTransient(context.Background(), "test", func(ctx context.Context) error {
		calls++
		return permErr
	})
	if !errors.Is(err, permErr) {
		t.Errorf("RetryOnTransient() error = %v, want %v", err, permErr)
	}
	if calls != 1 {
		t.Errorf("calls = %d, want 1 (should not retry permanent error)", calls)
	}
}

func TestRetryOnTransient_ExhaustsAttemptsOnTransientError(t *testing.T) {
	calls := 0
	err := RetryOnTransient(context.Background(), "test", func(ctx context.Context) error {
		calls++
		return errors.New("connection refused")
	})
	if err == nil {
		t.Error("RetryOnTransient() should return error after exhausting attempts")
	}
	if calls != 3 {
		t.Errorf("calls = %d, want 3 (max attempts)", calls)
	}
}

func TestRetryOnTransient_RespectsContextCancellation(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	calls := 0
	err := RetryOnTransient(ctx, "test", func(ctx context.Context) error {
		calls++
		cancel() // Cancel after first attempt
		return errors.New("connection refused")
	})
	if err == nil {
		t.Error("RetryOnTransient() should return error when context cancelled")
	}
	if calls > 2 {
		t.Errorf("calls = %d, want ≤2 (should stop after context cancelled)", calls)
	}
}

// TestRetryOnTransient_CancelledContextInterruptsBlockingRead proves
// that cancelling the caller's context interrupts a blocking
// database/state read while it is in flight, rather than only
// preventing a *future* retry attempt (see
// TestRetryOnTransient_RespectsContextCancellation above for that
// narrower case). fn stands in for a real blocking read (e.g. a pgx
// Query call bound to ctx) — it blocks on ctx.Done() vs. a long timer
// that would hang the test if cancellation were not observed. This is
// the narrowest existing abstraction that models "a read respects
// context cancellation" without a live PostgreSQL or a new mocking
// dependency (per this package's existing no-pgxmock convention — see
// internal/database/audit's hand-rolled fakeDBTX).
func TestRetryOnTransient_CancelledContextInterruptsBlockingRead(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	started := make(chan struct{})
	blockingRead := func(ctx context.Context) error {
		close(started)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(5 * time.Second):
			return errors.New("blocking read did not observe context cancellation")
		}
	}

	go func() {
		<-started
		cancel()
	}()

	start := time.Now()
	err := RetryOnTransient(ctx, "blocking-read", blockingRead)
	elapsed := time.Since(start)

	if !errors.Is(err, context.Canceled) {
		t.Fatalf("RetryOnTransient() error = %v, want context.Canceled", err)
	}
	if elapsed > 1*time.Second {
		t.Fatalf("blocking read was not interrupted promptly by cancellation: took %v", elapsed)
	}
}

func TestRetryOnTransient_RespectsContextTimeout(t *testing.T) {
	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	calls := 0
	err := RetryOnTransient(ctx, "test", func(ctx context.Context) error {
		calls++
		return errors.New("connection refused")
	})
	if err == nil {
		t.Error("RetryOnTransient() should return error when context times out")
	}
	// Should have attempted at least 1 call but not all 3 due to timeout
	if calls == 0 {
		t.Error("calls = 0, want at least 1 attempt")
	}
}

func TestRetryOnTransient_MixedTransientThenPermanent(t *testing.T) {
	calls := 0
	permErr := &pgconn.PgError{Code: "23505", Message: "unique constraint"}
	err := RetryOnTransient(context.Background(), "test", func(ctx context.Context) error {
		calls++
		if calls == 1 {
			return errors.New("connection refused") // transient
		}
		return permErr // permanent on second attempt
	})
	if !errors.Is(err, permErr) {
		t.Errorf("RetryOnTransient() error = %v, want permanent error", err)
	}
	if calls != 2 {
		t.Errorf("calls = %d, want 2 (one transient retry, then permanent fail)", calls)
	}
}
