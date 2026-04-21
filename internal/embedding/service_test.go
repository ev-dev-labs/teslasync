package embedding

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestVectorLiteral(t *testing.T) {
	tests := []struct {
		name string
		in   []float32
		want string
	}{
		{"empty", []float32{}, "[]"},
		{"single", []float32{1.5}, "[1.5]"},
		{"three", []float32{1, 2, 3}, "[1,2,3]"},
		{"negative", []float32{-0.5, 0.25, -1}, "[-0.5,0.25,-1]"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := vectorLiteral(tt.in)
			if got != tt.want {
				t.Errorf("vectorLiteral(%v) = %q, want %q", tt.in, got, tt.want)
			}
		})
	}
}

func TestBuildDriveContent(t *testing.T) {
	start := time.Date(2026, 4, 21, 15, 30, 0, 0, time.UTC)
	startSOC, endSOC := 80, 55
	got := BuildDriveContent(start, 120.5, 90, 75, 130, &startSOC, &endSOC, "Home", "Work")

	if !strings.Contains(got, "120.5 km") {
		t.Errorf("content missing distance: %q", got)
	}
	if !strings.Contains(got, "80%") || !strings.Contains(got, "55%") {
		t.Errorf("content missing SOC: %q", got)
	}
	if !strings.Contains(got, "Home") || !strings.Contains(got, "Work") {
		t.Errorf("content missing addresses: %q", got)
	}
}

func TestBuildChargeContent(t *testing.T) {
	start := time.Date(2026, 4, 21, 12, 0, 0, 0, time.UTC)
	end := 85
	cost := 12.34
	got := BuildChargeContent(start, 40.5, 120, 30, &end, "Supercharger", &cost)
	if !strings.Contains(got, "40.5 kWh") {
		t.Errorf("content missing energy: %q", got)
	}
	if !strings.Contains(got, "$12.34") {
		t.Errorf("content missing cost: %q", got)
	}
	if !strings.Contains(got, "Supercharger") {
		t.Errorf("content missing location: %q", got)
	}
}

func TestBuildAlertContent(t *testing.T) {
	at := time.Date(2026, 4, 21, 8, 0, 0, 0, time.UTC)
	got := BuildAlertContent(at, "battery_low", "warning", "Battery Low", "Battery dropped to 15%")
	for _, want := range []string{"battery_low", "warning", "Battery Low", "Battery dropped"} {
		if !strings.Contains(got, want) {
			t.Errorf("alert content missing %q: %q", want, got)
		}
	}
}

// TestOpenAIProvider_EmbedBatch uses a stubbed HTTP server to verify request
// shape and response parsing without hitting the real OpenAI API.
func TestOpenAIProvider_EmbedBatch(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer test-key" {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		var req openAIEmbedRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		resp := openAIEmbedResponse{}
		// Return results out of order to verify reassembly.
		for i := len(req.Input) - 1; i >= 0; i-- {
			resp.Data = append(resp.Data, struct {
				Index     int       `json:"index"`
				Embedding []float32 `json:"embedding"`
			}{
				Index:     i,
				Embedding: []float32{float32(i), float32(i) + 0.5, float32(i) + 1},
			})
		}
		w.Header().Set("Content-Type", "application/json")
		_ = json.NewEncoder(w).Encode(resp)
	}))
	defer srv.Close()

	p := NewOpenAIProvider("test-key", "text-embedding-3-small", 3)
	p.endpoint = srv.URL

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	vecs, err := p.EmbedBatch(ctx, []string{"a", "b", "c"})
	if err != nil {
		t.Fatalf("EmbedBatch: %v", err)
	}
	if len(vecs) != 3 {
		t.Fatalf("got %d vecs, want 3", len(vecs))
	}
	for i, v := range vecs {
		if len(v) != 3 {
			t.Errorf("vec[%d] len = %d, want 3", i, len(v))
		}
		if v[0] != float32(i) {
			t.Errorf("vec[%d][0] = %v, want %v (reassembly by index failed)", i, v[0], i)
		}
	}
}

func TestOpenAIProvider_MissingAPIKey(t *testing.T) {
	p := NewOpenAIProvider("", "", 0)
	_, err := p.EmbedBatch(context.Background(), []string{"hi"})
	if err == nil {
		t.Fatal("expected error for missing API key")
	}
}
