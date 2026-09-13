package journey

import (
	"errors"
	"testing"
)

func TestValidStatus(t *testing.T) {
	for _, s := range []string{StatusPlanned, StatusActive, StatusPaused, StatusCompleted, StatusAborted} {
		if !ValidStatus(s) {
			t.Fatalf("ValidStatus(%q) = false", s)
		}
	}
	if ValidStatus("flying") {
		t.Fatal("ValidStatus(flying) = true")
	}
}

func TestTerminal(t *testing.T) {
	if !Terminal(StatusCompleted) || !Terminal(StatusAborted) {
		t.Fatal("completed/aborted must be terminal")
	}
	for _, s := range []string{StatusPlanned, StatusActive, StatusPaused} {
		if Terminal(s) {
			t.Fatalf("%q must not be terminal", s)
		}
	}
}

func TestTransitionMatrix(t *testing.T) {
	all := []string{StatusPlanned, StatusActive, StatusPaused, StatusCompleted, StatusAborted}
	allowed := map[string]map[string]bool{
		StatusPlanned:   {StatusPlanned: true, StatusActive: true, StatusAborted: true},
		StatusActive:    {StatusActive: true, StatusPaused: true, StatusCompleted: true, StatusAborted: true},
		StatusPaused:    {StatusPaused: true, StatusActive: true, StatusCompleted: true, StatusAborted: true},
		StatusCompleted: {StatusCompleted: true},
		StatusAborted:   {StatusAborted: true},
	}
	for _, from := range all {
		for _, to := range all {
			err := Transition(from, to)
			if allowed[from][to] && err != nil {
				t.Fatalf("Transition(%q, %q) = %v, want nil", from, to, err)
			}
			if !allowed[from][to] {
				var terr *TransitionError
				if !errors.As(err, &terr) {
					t.Fatalf("Transition(%q, %q) = %v, want *TransitionError", from, to, err)
				}
			}
		}
	}
}

func TestTransitionUnknown(t *testing.T) {
	if err := Transition("bogus", StatusActive); err == nil {
		t.Fatal("unknown from-status must fail")
	}
	if err := Transition(StatusPlanned, "bogus"); err == nil {
		t.Fatal("unknown to-status must fail")
	}
}

func TestNextStatuses(t *testing.T) {
	if got := NextStatuses(StatusActive); len(got) != 3 {
		t.Fatalf("active next = %v, want 3", got)
	}
	if got := NextStatuses(StatusCompleted); len(got) != 0 {
		t.Fatalf("completed next = %v, want empty", got)
	}
	if got := NextStatuses("bogus"); got == nil || len(got) != 0 {
		t.Fatalf("bogus next = %v, want empty non-nil", got)
	}
}
