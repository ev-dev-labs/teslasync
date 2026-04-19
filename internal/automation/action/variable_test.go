package action

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"testing"
)

// --- Mock ---

type mockVariableRepo struct {
	vars map[string]*VariableEntry
	err  error
}

func newMockVariableRepo() *mockVariableRepo {
	return &mockVariableRepo{vars: make(map[string]*VariableEntry)}
}

func (m *mockVariableRepo) Get(_ context.Context, key string) (*VariableEntry, error) {
	if m.err != nil {
		return nil, m.err
	}
	return m.vars[key], nil
}

func (m *mockVariableRepo) Set(_ context.Context, key, value string, _ *int64) error {
	if m.err != nil {
		return m.err
	}
	m.vars[key] = &VariableEntry{Key: key, Value: value}
	return nil
}

// --- ParseSetVariableConfig Tests ---

func TestParseSetVariableConfig(t *testing.T) {
	tests := []struct {
		name      string
		input     json.RawMessage
		wantKey   string
		wantValue string
		wantErr   string
	}{
		{
			name:      "valid full config",
			input:     json.RawMessage(`{"type":"set_variable","key":"last_charge","value":"85"}`),
			wantKey:   "last_charge",
			wantValue: "85",
		},
		{
			name:      "valid without type",
			input:     json.RawMessage(`{"key":"departure_time","value":"{{timestamp}}"}`),
			wantKey:   "departure_time",
			wantValue: "{{timestamp}}",
		},
		{
			name:      "valid with dots and hyphens",
			input:     json.RawMessage(`{"key":"vehicle.garage-open","value":"true"}`),
			wantKey:   "vehicle.garage-open",
			wantValue: "true",
		},
		{
			name:    "empty config",
			input:   json.RawMessage(``),
			wantErr: "action config is empty",
		},
		{
			name:    "invalid JSON",
			input:   json.RawMessage(`{broken`),
			wantErr: "unmarshal set_variable action config",
		},
		{
			name:    "wrong type",
			input:   json.RawMessage(`{"type":"command","key":"k","value":"v"}`),
			wantErr: `expected type "set_variable"`,
		},
		{
			name:    "missing key",
			input:   json.RawMessage(`{"type":"set_variable","value":"v"}`),
			wantErr: "key is required",
		},
		{
			name:    "missing value",
			input:   json.RawMessage(`{"type":"set_variable","key":"k"}`),
			wantErr: "value is required",
		},
		{
			name:    "invalid key characters",
			input:   json.RawMessage(`{"key":"bad key!","value":"v"}`),
			wantErr: "contains invalid characters",
		},
		{
			name:    "key too long",
			input:   json.RawMessage(fmt.Sprintf(`{"key":"%s","value":"v"}`, strings.Repeat("a", MaxKeyLength+1))),
			wantErr: "exceeds maximum length",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := ParseSetVariableConfig(tt.input)
			if tt.wantErr != "" {
				if err == nil {
					t.Fatalf("expected error containing %q, got nil", tt.wantErr)
				}
				if !strings.Contains(err.Error(), tt.wantErr) {
					t.Fatalf("expected error containing %q, got %q", tt.wantErr, err.Error())
				}
				return
			}
			if err != nil {
				t.Fatalf("unexpected error: %v", err)
			}
			if cfg.Key != tt.wantKey {
				t.Fatalf("expected key %q, got %q", tt.wantKey, cfg.Key)
			}
			if cfg.Value != tt.wantValue {
				t.Fatalf("expected value %q, got %q", tt.wantValue, cfg.Value)
			}
		})
	}
}

// --- Execute Tests ---

func TestSetVariableExecutor_Execute(t *testing.T) {
	t.Run("stores variable with resolved template", func(t *testing.T) {
		repo := newMockVariableRepo()
		exec := NewSetVariableExecutor(repo)

		raw := json.RawMessage(`{
			"type": "set_variable",
			"key": "last_charge_level",
			"value": "{{battery_level}}",
			"vars": {"battery_level": "85"}
		}`)

		resultJSON, err := exec.Execute(context.Background(), nil, raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var result SetVariableResult
		if err := json.Unmarshal(resultJSON, &result); err != nil {
			t.Fatalf("unmarshal result: %v", err)
		}

		if result.Key != "last_charge_level" {
			t.Fatalf("expected key 'last_charge_level', got %q", result.Key)
		}
		if result.Value != "85" {
			t.Fatalf("expected resolved value '85', got %q", result.Value)
		}
		if result.PreviousValue != nil {
			t.Fatalf("expected nil previous value, got %q", *result.PreviousValue)
		}

		// Verify stored in repo.
		entry := repo.vars["last_charge_level"]
		if entry == nil {
			t.Fatal("expected variable to be stored in repo")
		}
		if entry.Value != "85" {
			t.Fatalf("expected stored value '85', got %q", entry.Value)
		}
	})

	t.Run("returns previous value on overwrite", func(t *testing.T) {
		repo := newMockVariableRepo()
		repo.vars["counter"] = &VariableEntry{Key: "counter", Value: "10"}
		exec := NewSetVariableExecutor(repo)

		raw := json.RawMessage(`{"key":"counter","value":"11"}`)

		resultJSON, err := exec.Execute(context.Background(), nil, raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var result SetVariableResult
		if err := json.Unmarshal(resultJSON, &result); err != nil {
			t.Fatalf("unmarshal result: %v", err)
		}

		if result.PreviousValue == nil {
			t.Fatal("expected previous value, got nil")
		}
		if *result.PreviousValue != "10" {
			t.Fatalf("expected previous value '10', got %q", *result.PreviousValue)
		}
		if result.Value != "11" {
			t.Fatalf("expected new value '11', got %q", result.Value)
		}
	})

	t.Run("passes vehicleID through", func(t *testing.T) {
		var capturedVehicleID *int64
		repo := &trackingVariableRepo{
			inner:       newMockVariableRepo(),
			onSet:       func(_ string, _ string, vid *int64) { capturedVehicleID = vid },
		}
		exec := NewSetVariableExecutor(repo)

		vid := int64(42)
		raw := json.RawMessage(`{"key":"test","value":"val"}`)

		_, err := exec.Execute(context.Background(), &vid, raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		if capturedVehicleID == nil || *capturedVehicleID != 42 {
			t.Fatalf("expected vehicleID 42 passed to repo")
		}
	})

	t.Run("unresolved template stored as-is", func(t *testing.T) {
		repo := newMockVariableRepo()
		exec := NewSetVariableExecutor(repo)

		raw := json.RawMessage(`{"key":"test","value":"{{unknown}}"}`)

		resultJSON, err := exec.Execute(context.Background(), nil, raw)
		if err != nil {
			t.Fatalf("unexpected error: %v", err)
		}

		var result SetVariableResult
		if err := json.Unmarshal(resultJSON, &result); err != nil {
			t.Fatalf("unmarshal result: %v", err)
		}

		if result.Value != "{{unknown}}" {
			t.Fatalf("expected unresolved template, got %q", result.Value)
		}
	})

	t.Run("repo error propagates", func(t *testing.T) {
		repo := newMockVariableRepo()
		repo.err = fmt.Errorf("db connection failed")
		exec := NewSetVariableExecutor(repo)

		raw := json.RawMessage(`{"key":"test","value":"val"}`)

		_, err := exec.Execute(context.Background(), nil, raw)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "db connection failed") {
			t.Fatalf("expected repo error, got %q", err.Error())
		}
	})

	t.Run("invalid config rejected", func(t *testing.T) {
		repo := newMockVariableRepo()
		exec := NewSetVariableExecutor(repo)

		raw := json.RawMessage(`{"type":"set_variable"}`)

		_, err := exec.Execute(context.Background(), nil, raw)
		if err == nil {
			t.Fatal("expected error, got nil")
		}
		if !strings.Contains(err.Error(), "key is required") {
			t.Fatalf("expected validation error, got %q", err.Error())
		}
	})
}

// trackingVariableRepo wraps a mock and captures Set arguments.
type trackingVariableRepo struct {
	inner VariableRepo
	onSet func(key, value string, vehicleID *int64)
}

func (r *trackingVariableRepo) Get(ctx context.Context, key string) (*VariableEntry, error) {
	return r.inner.Get(ctx, key)
}

func (r *trackingVariableRepo) Set(ctx context.Context, key, value string, vehicleID *int64) error {
	if r.onSet != nil {
		r.onSet(key, value, vehicleID)
	}
	return r.inner.Set(ctx, key, value, vehicleID)
}
