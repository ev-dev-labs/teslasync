package embedding

import (
	"context"
	"strings"
	"testing"

	"github.com/ev-dev-labs/teslasync/internal/models"
)

func TestVectorLiteral(t *testing.T) {
	cases := []struct {
		in   []float32
		want string
	}{
		{nil, "[]"},
		{[]float32{}, "[]"},
		{[]float32{0.5, -1.25, 0}, "[0.5,-1.25,0]"},
	}
	for _, c := range cases {
		got := vectorLiteral(c.in)
		if got != c.want {
			t.Errorf("vectorLiteral(%v) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestLocalProvider_Deterministic(t *testing.T) {
	p := NewLocalProvider(64)
	if p.Dimensions() != 64 {
		t.Fatalf("dimensions: got %d want 64", p.Dimensions())
	}
	v1, err := p.Embed(context.Background(), "battery dropped fast on highway")
	if err != nil {
		t.Fatal(err)
	}
	v2, _ := p.Embed(context.Background(), "battery dropped fast on highway")
	if len(v1) != 64 {
		t.Fatalf("vector len = %d want 64", len(v1))
	}
	for i := range v1 {
		if v1[i] != v2[i] {
			t.Fatalf("non-deterministic embedding at %d: %v vs %v", i, v1[i], v2[i])
		}
	}

	// Different inputs should generally produce different vectors.
	v3, _ := p.Embed(context.Background(), "completely unrelated charging session text")
	same := true
	for i := range v1 {
		if v1[i] != v3[i] {
			same = false
			break
		}
	}
	if same {
		t.Fatal("expected different vectors for different inputs")
	}
}

func TestDriveSummary(t *testing.T) {
	startBat := 80
	endBat := 60
	speedAvg := 90.0
	speedMax := 120.0
	startAddr := "Home"
	endAddr := "Office"
	d := &models.Drive{
		Distance:        100,
		DurationMin:     60,
		StartBatteryLvl: &startBat,
		EndBatteryLvl:   &endBat,
		SpeedAvg:        &speedAvg,
		SpeedMax:        &speedMax,
		StartAddress:    &startAddr,
		EndAddress:      &endAddr,
	}
	s := DriveSummary(d)
	for _, want := range []string{"100.0 km", "60 minutes", "Home", "Office", "80%", "60%"} {
		if !strings.Contains(s, want) {
			t.Errorf("summary missing %q: %s", want, s)
		}
	}
}
