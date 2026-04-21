package embedding

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func ptrF64(f float64) *float64 { return &f }
func ptrInt(i int) *int         { return &i }
func ptrStr(s string) *string   { return &s }

func TestBuildDriveContent(t *testing.T) {
	d := &models.Drive{
		ID:        42,
		VehicleID: 1,
		StartDate: time.Date(2024, 1, 15, 14, 30, 0, 0, time.UTC),
		Distance:  123.4,
		DurationMin: 75,
		SpeedAvg:        ptrF64(80),
		SpeedMax:        ptrF64(132),
		StartBatteryLvl: ptrInt(92),
		EndBatteryLvl:   ptrInt(47),
		StartAddress:    ptrStr("Home"),
		EndAddress:      ptrStr("Office"),
		OutsideTempAvg:  ptrF64(12),
		ElevationGain:   ptrF64(200),
		ElevationLoss:   ptrF64(150),
	}

	got := BuildDriveContent(d)
	mustContain := []string{
		"Drive on Jan 15, 2024 2:30 PM",
		"123.4 km",
		"75 minutes",
		"average speed 80 km/h",
		"max speed 132 km/h",
		"battery from 92% to 47%",
		"from Home to Office",
		"outside 12°C",
		"elevation +200/-150 m",
	}
	for _, sub := range mustContain {
		if !strings.Contains(got, sub) {
			t.Errorf("BuildDriveContent missing %q\nfull: %s", sub, got)
		}
	}
}

func TestBuildDriveContent_OmitsNilFields(t *testing.T) {
	d := &models.Drive{
		ID:        1,
		VehicleID: 1,
		StartDate: time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC),
		Distance:  10,
	}
	got := BuildDriveContent(d)
	// Must not reference any of the nilable fields.
	for _, bad := range []string{"battery from", "average speed", "max speed", "elevation", "°C", "from ", " to "} {
		if strings.Contains(got, bad) {
			t.Errorf("BuildDriveContent should not mention %q when fields are nil; got %q", bad, got)
		}
	}
}

func TestBuildChargeContent(t *testing.T) {
	c := &models.ChargingSession{
		ID:                1,
		VehicleID:         1,
		StartDate:         time.Date(2024, 2, 3, 20, 15, 0, 0, time.UTC),
		ChargeEnergyAdded: 42.5,
		StartBatteryLevel: 22,
		EndBatteryLevel:   ptrInt(85),
		ChargerPower:      ptrF64(140.2),
		FastChargerBrand:  ptrStr("Tesla"),
		LocationName:      ptrStr("Supercharger Foo"),
		Cost:              ptrF64(12.34),
		DurationMin:       30,
	}
	got := BuildChargeContent(c)
	for _, sub := range []string{
		"42.5 kWh added",
		"30 minutes",
		"battery from 22% to 85%",
		"peak power 140.2 kW",
		"charger: Tesla",
		"location: Supercharger Foo",
		"cost $12.34",
	} {
		if !strings.Contains(got, sub) {
			t.Errorf("BuildChargeContent missing %q\nfull: %s", sub, got)
		}
	}
}

func TestBuildAlertContent(t *testing.T) {
	a := &models.Alert{
		ID:        7,
		Type:      "battery_low",
		Severity:  "warning",
		Title:     "Low battery",
		Message:   "SOC dropped below 20%",
		CreatedAt: time.Date(2024, 3, 4, 9, 0, 0, 0, time.UTC),
	}
	got := BuildAlertContent(a)
	for _, sub := range []string{"[warning/battery_low]", "Low battery", "SOC dropped below 20%"} {
		if !strings.Contains(got, sub) {
			t.Errorf("BuildAlertContent missing %q\nfull: %s", sub, got)
		}
	}
}

func TestVectorLiteral(t *testing.T) {
	tests := []struct {
		name string
		in   []float32
		want string
	}{
		{"empty", []float32{}, "[]"},
		{"single", []float32{1.5}, "[1.5]"},
		{"multi", []float32{0, 1, -0.5, 2.25}, "[0,1,-0.5,2.25]"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := vectorLiteral(tc.in); got != tc.want {
				t.Errorf("vectorLiteral(%v) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

func TestStubProvider_Deterministic(t *testing.T) {
	p := NewStubProvider(128)
	if p.Dimensions() != 128 {
		t.Fatalf("Dimensions() = %d, want 128", p.Dimensions())
	}
	v1, err := p.Embed(context.Background(), "hello world")
	if err != nil {
		t.Fatal(err)
	}
	v2, err := p.Embed(context.Background(), "hello world")
	if err != nil {
		t.Fatal(err)
	}
	if len(v1) != 128 || len(v2) != 128 {
		t.Fatalf("wrong length: %d %d", len(v1), len(v2))
	}
	for i := range v1 {
		if v1[i] != v2[i] {
			t.Fatalf("stub provider is not deterministic at index %d", i)
		}
	}
}

func TestStubProvider_Batch(t *testing.T) {
	p := NewStubProvider(64)
	vecs, err := p.EmbedBatch(context.Background(), []string{"a", "b", "c"})
	if err != nil {
		t.Fatal(err)
	}
	if len(vecs) != 3 {
		t.Fatalf("got %d vectors, want 3", len(vecs))
	}
	for i, v := range vecs {
		if len(v) != 64 {
			t.Errorf("vec[%d] has dim %d, want 64", i, len(v))
		}
	}
}

func TestNewOpenAIProvider_RequiresAPIKey(t *testing.T) {
	if _, err := NewOpenAIProvider(OpenAIConfig{}); err == nil {
		t.Error("expected error when APIKey is empty")
	}
	p, err := NewOpenAIProvider(OpenAIConfig{APIKey: "sk-test"})
	if err != nil {
		t.Fatal(err)
	}
	if p.Dimensions() != 1536 {
		t.Errorf("default dimensions = %d, want 1536", p.Dimensions())
	}
	if p.Model() != "text-embedding-3-small" {
		t.Errorf("default model = %s", p.Model())
	}
}
