package trigger

import (
	"encoding/json"
	"testing"
)

func TestValidateTriggerConfig_UnknownType(t *testing.T) {
	err := ValidateTriggerConfig("nonexistent", json.RawMessage(`{}`))
	if err == nil {
		t.Fatal("expected error for unknown trigger type")
	}
}

func TestValidateTriggerConfig_EmptyConfig(t *testing.T) {
	err := ValidateTriggerConfig("cron", nil)
	if err == nil {
		t.Fatal("expected error for empty config")
	}
}

func TestValidateTriggerConfig_Cron(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid every 5 min", `{"cron_expr":"*/5 * * * *","timezone":"UTC"}`, false},
		{"valid no timezone", `{"cron_expr":"0 8 * * 1-5"}`, false},
		{"missing cron_expr", `{"timezone":"UTC"}`, true},
		{"invalid cron_expr", `{"cron_expr":"not-a-cron"}`, true},
		{"invalid timezone", `{"cron_expr":"*/5 * * * *","timezone":"Not/A/Zone"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("cron", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(cron, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_VehicleState(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid wakes_up", `{"event":"wakes_up"}`, false},
		{"valid state_change", `{"event":"state_change"}`, false},
		{"valid with filters", `{"event":"wakes_up","from_state":"asleep","to_state":"online"}`, false},
		{"missing event", `{}`, true},
		{"unsupported event", `{"event":"explodes"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("vehicle_state", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(vehicle_state, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_Geofence(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid enter", `{"geofence_id":1,"event":"enter"}`, false},
		{"valid both", `{"geofence_id":5,"event":"both"}`, false},
		{"missing geofence_id", `{"event":"enter"}`, true},
		{"missing event", `{"geofence_id":1}`, true},
		{"invalid event", `{"geofence_id":1,"event":"fly_over"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("geofence", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(geofence, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_Battery(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid below", `{"operator":"below","threshold":20}`, false},
		{"valid above 80", `{"operator":"above","threshold":80}`, false},
		{"missing operator", `{"threshold":50}`, true},
		{"invalid operator", `{"operator":"explode","threshold":50}`, true},
		{"threshold out of range", `{"operator":"below","threshold":150}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("battery", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(battery, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_SunriseSunset(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid sunrise", `{"event":"sunrise","offset_minutes":-30}`, false},
		{"valid sunset", `{"event":"sunset"}`, false},
		{"missing event", `{"offset_minutes":10}`, true},
		{"invalid event", `{"event":"noon"}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("sunrise_sunset", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(sunrise_sunset, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_Energy(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid solar_above", `{"event":"solar_above","threshold":1000,"energy_site_id":1}`, false},
		{"missing event", `{"threshold":500,"energy_site_id":1}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("energy", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(energy, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_MQTT(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid", `{"topic":"home/sensor/#"}`, false},
		{"missing topic", `{}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("mqtt", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(mqtt, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_Webhook(t *testing.T) {
	tests := []struct {
		name    string
		config  string
		wantErr bool
	}{
		{"valid", `{"webhook_token":"abc123"}`, false},
		{"missing token", `{}`, true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := ValidateTriggerConfig("webhook", json.RawMessage(tt.config))
			if (err != nil) != tt.wantErr {
				t.Errorf("ValidateTriggerConfig(webhook, %s) error = %v, wantErr %v", tt.config, err, tt.wantErr)
			}
		})
	}
}

func TestValidateTriggerConfig_Calendar(t *testing.T) {
	err := ValidateTriggerConfig("calendar", json.RawMessage(`{"offset_minutes":-15}`))
	if err != nil {
		t.Errorf("expected valid calendar config, got: %v", err)
	}
}

func TestSupportedTriggerTypes(t *testing.T) {
	types := SupportedTriggerTypes()
	if len(types) != 9 {
		t.Errorf("expected 9 trigger types, got %d", len(types))
	}
	expected := map[string]bool{
		"cron": true, "vehicle_state": true, "geofence": true,
		"battery": true, "sunrise_sunset": true, "energy": true,
		"mqtt": true, "webhook": true, "calendar": true,
	}
	for _, tt := range types {
		if !expected[tt] {
			t.Errorf("unexpected trigger type %q", tt)
		}
	}
}

func TestComputeNextCronFireTime(t *testing.T) {
	// Every minute — next fire should be within the next minute
	next := ComputeNextCronFireTime("* * * * *", "UTC")
	if next == nil {
		t.Fatal("expected non-nil next fire time for * * * * *")
	}

	// Invalid expression
	next = ComputeNextCronFireTime("invalid", "UTC")
	if next != nil {
		t.Fatal("expected nil for invalid cron expression")
	}

	// Empty expression
	next = ComputeNextCronFireTime("", "UTC")
	if next != nil {
		t.Fatal("expected nil for empty cron expression")
	}

	// Invalid timezone
	next = ComputeNextCronFireTime("* * * * *", "Not/Valid")
	if next != nil {
		t.Fatal("expected nil for invalid timezone")
	}
}
