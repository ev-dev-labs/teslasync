// Package journey owns Journey Autopilot trip sessions: one persistent
// record per planned-or-live trip, a strict status machine, and
// versioned plans so every replan keeps its predecessor for diffing.
package journey

import "fmt"

// Statuses of a journey session.
const (
	StatusPlanned   = "planned"
	StatusActive    = "active"
	StatusPaused    = "paused"
	StatusCompleted = "completed"
	StatusAborted   = "aborted"
)

// allowedTransitions is the status machine: keys are current statuses,
// values the statuses they may move to. Terminal states have no exits.
var allowedTransitions = map[string][]string{
	StatusPlanned: {StatusActive, StatusAborted},
	StatusActive:  {StatusPaused, StatusCompleted, StatusAborted},
	StatusPaused:  {StatusActive, StatusCompleted, StatusAborted},
}

// TransitionError describes a rejected status move.
type TransitionError struct {
	From string
	To   string
}

func (e *TransitionError) Error() string {
	return fmt.Sprintf("journey: cannot move session from %q to %q", e.From, e.To)
}

// ValidStatus reports whether s is a known session status.
func ValidStatus(s string) bool {
	switch s {
	case StatusPlanned, StatusActive, StatusPaused, StatusCompleted, StatusAborted:
		return true
	default:
		return false
	}
}

// Terminal reports whether s ends the session lifecycle.
func Terminal(s string) bool { return s == StatusCompleted || s == StatusAborted }

// Transition validates a status move. Pure: no I/O, deterministic.
func Transition(from, to string) error {
	if from == to {
		return nil
	}
	for _, next := range allowedTransitions[from] {
		if next == to {
			return nil
		}
	}
	return &TransitionError{From: from, To: to}
}

// NextStatuses returns the statuses reachable from s (excluding s).
func NextStatuses(s string) []string {
	out := append([]string{}, allowedTransitions[s]...)
	if out == nil {
		return []string{}
	}
	return out
}
