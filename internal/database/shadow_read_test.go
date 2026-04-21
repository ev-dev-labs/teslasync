package database

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
)

// fakeQueryer implements Queryer by dispatching to per-SQL handlers.
type fakeQueryer struct {
	handlers map[string]func() (pgx.Rows, error)
}

func (f *fakeQueryer) Query(_ context.Context, sql string, _ ...any) (pgx.Rows, error) {
	if h, ok := f.handlers[sql]; ok {
		return h()
	}
	return nil, errUnknownSQL
}

var errUnknownSQL = pgxError("no handler for sql")

type pgxError string

func (e pgxError) Error() string { return string(e) }

// TestShadowRead_ReturnsOldResult verifies ShadowRead always returns the old
// query's result and its error, regardless of the shadow outcome.
func TestShadowRead_ReturnsOldResult(t *testing.T) {
	want := 42
	q := &fakeQueryer{
		handlers: map[string]func() (pgx.Rows, error){
			"OLD": func() (pgx.Rows, error) { return nil, nil },
			"NEW": func() (pgx.Rows, error) { return nil, errUnknownSQL },
		},
	}

	scan := func(_ pgx.Rows) (int, error) { return want, nil }

	got, err := ShadowRead[int](
		context.Background(), q, "test",
		"OLD", nil,
		"NEW", nil,
		scan,
	)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != want {
		t.Fatalf("got %d, want %d", got, want)
	}

	// Give the shadow goroutine time to finish and log without affecting the
	// test outcome. Reaching this point with no panic is the assertion.
	time.Sleep(50 * time.Millisecond)
}

// TestShadowRead_OldErrorPropagates verifies that an error from the old query
// is returned to the caller unchanged.
func TestShadowRead_OldErrorPropagates(t *testing.T) {
	q := &fakeQueryer{
		handlers: map[string]func() (pgx.Rows, error){
			"OLD": func() (pgx.Rows, error) { return nil, errUnknownSQL },
			"NEW": func() (pgx.Rows, error) { return nil, nil },
		},
	}
	scan := func(_ pgx.Rows) (int, error) { return 0, nil }

	_, err := ShadowRead[int](
		context.Background(), q, "test-err",
		"OLD", nil,
		"NEW", nil,
		scan,
	)
	if err == nil {
		t.Fatal("expected error from old query, got nil")
	}
}
