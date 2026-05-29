package aidigest

import "context"

// stubGuardSettings is a minimal in-memory guard.Settings used to
// drive the off-mode contract test without a real DB.
type stubGuardSettings struct {
	mode string
	on   map[string]bool
}

func (s *stubGuardSettings) AIMode(_ context.Context) (string, error) {
	if s.mode == "" {
		return "off", nil
	}
	return s.mode, nil
}

func (s *stubGuardSettings) AIFeatureEnabled(_ context.Context, id string) (bool, error) {
	return s.on[id], nil
}
