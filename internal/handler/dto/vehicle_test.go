package dto

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/domain"
)

// validVIN is a syntactically well-formed 17-character VIN used across the
// vehicle DTO tests. The DTO validator only checks length/presence, not the
// ISO-3779 checksum (that is a domain-layer concern).
const validVIN = "5YJ3E1EA7HF000316"

func TestCreateVehicleRequest_Validate(t *testing.T) {
	maxYear := time.Now().Year() + 1
	longName := strings.Repeat("a", 101)
	boundaryName := strings.Repeat("a", 100)

	tests := []struct {
		name       string
		req        CreateVehicleRequest
		wantErr    bool
		wantFields []string
	}{
		{"valid, year omitted", CreateVehicleRequest{VIN: validVIN, DisplayName: "Model 3"}, false, nil},
		{"valid with year", CreateVehicleRequest{VIN: validVIN, DisplayName: "Model 3", Year: 2023}, false, nil},
		{"year lower boundary 2012", CreateVehicleRequest{VIN: validVIN, DisplayName: "M", Year: 2012}, false, nil},
		{"year upper boundary now+1", CreateVehicleRequest{VIN: validVIN, DisplayName: "M", Year: maxYear}, false, nil},
		{"display name at 100 boundary", CreateVehicleRequest{VIN: validVIN, DisplayName: boundaryName}, false, nil},
		{"empty vin", CreateVehicleRequest{VIN: "", DisplayName: "M"}, true, []string{"vin"}},
		{"vin too short", CreateVehicleRequest{VIN: "SHORT", DisplayName: "M"}, true, []string{"vin"}},
		{"vin too long", CreateVehicleRequest{VIN: validVIN + "X", DisplayName: "M"}, true, []string{"vin"}},
		{"empty display name", CreateVehicleRequest{VIN: validVIN, DisplayName: ""}, true, []string{"displayName"}},
		{"display name too long", CreateVehicleRequest{VIN: validVIN, DisplayName: longName}, true, []string{"displayName"}},
		{"year too low", CreateVehicleRequest{VIN: validVIN, DisplayName: "M", Year: 2011}, true, []string{"year"}},
		{"year too high", CreateVehicleRequest{VIN: validVIN, DisplayName: "M", Year: maxYear + 1}, true, []string{"year"}},
		{"multiple failures", CreateVehicleRequest{VIN: "", DisplayName: "", Year: 1900}, true, []string{"vin", "displayName", "year"}},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := tt.req.Validate()
			if (err != nil) != tt.wantErr {
				t.Fatalf("Validate() error = %v, wantErr %v", err, tt.wantErr)
			}
			if !tt.wantErr {
				return
			}
			if !errors.Is(err, domain.ErrValidation) {
				t.Errorf("error should wrap domain.ErrValidation, got %v", err)
			}
			gotFields := validationFields(t, err)
			for _, f := range tt.wantFields {
				if !containsStr(gotFields, f) {
					t.Errorf("expected validation error on field %q; got fields %v", f, gotFields)
				}
			}
		})
	}
}

func TestVehicleResponse_JSON(t *testing.T) {
	updated := time.Date(2024, 3, 4, 5, 6, 7, 0, time.UTC)
	v := VehicleResponse{
		ID:            "veh-1",
		UserID:        "user-1",
		VIN:           validVIN,
		DisplayName:   "My Tesla",
		Model:         "Model 3",
		Year:          2023,
		FSMState:      "online",
		BatteryLevel:  82,
		RangeMiles:    240.5,
		OdometerMiles: 12345.6,
		IsCharging:    true,
		Latitude:      37.42,
		Longitude:     -122.08,
		UpdatedAt:     updated,
	}

	m := marshalToMap(t, v)
	assertKeys(t, m,
		"id", "userId", "vin", "displayName", "model", "year", "fsmState",
		"batteryLevel", "rangeMiles", "odometerMiles", "isCharging",
		"latitude", "longitude", "updatedAt",
	)
	if got := string(m["isCharging"]); got != "true" {
		t.Errorf("isCharging = %s, want true", got)
	}
	if got, want := string(m["vin"]), `"`+validVIN+`"`; got != want {
		t.Errorf("vin = %s, want %s", got, want)
	}
	if got := string(m["batteryLevel"]); got != "82" {
		t.Errorf("batteryLevel = %s, want 82", got)
	}
	assertRoundTrip(t, v)
}
