package geocoding

import (
	"context"
	"errors"
	"testing"
)

type stubGeocoder struct {
	name string
	res  *GeoResult
	err  error
	hits *int
}

func (s stubGeocoder) ReverseGeocode(_ context.Context, _, _ float64) (*GeoResult, error) {
	if s.hits != nil {
		*s.hits++
	}
	return s.res, s.err
}

func TestChainGeocoder_FallsBackToNextOnError(t *testing.T) {
	var firstHits, secondHits int
	want := &GeoResult{DisplayName: "Second St, Townsville"}
	chain := &chainGeocoder{providers: []namedGeocoder{
		{name: "first", geo: stubGeocoder{err: errors.New("REQUEST_DENIED"), hits: &firstHits}},
		{name: "second", geo: stubGeocoder{res: want, hits: &secondHits}},
	}}

	got, err := chain.ReverseGeocode(context.Background(), 47.6, -122.3)
	if err != nil {
		t.Fatalf("expected fallback success, got error: %v", err)
	}
	if got != want {
		t.Fatalf("expected result from second provider, got %+v", got)
	}
	if firstHits != 1 || secondHits != 1 {
		t.Fatalf("expected both providers tried once, got first=%d second=%d", firstHits, secondHits)
	}
}

func TestChainGeocoder_StopsAtFirstSuccess(t *testing.T) {
	var firstHits, secondHits int
	want := &GeoResult{DisplayName: "First Ave"}
	chain := &chainGeocoder{providers: []namedGeocoder{
		{name: "first", geo: stubGeocoder{res: want, hits: &firstHits}},
		{name: "second", geo: stubGeocoder{res: &GeoResult{}, hits: &secondHits}},
	}}

	got, err := chain.ReverseGeocode(context.Background(), 1, 2)
	if err != nil || got != want {
		t.Fatalf("expected first provider result, got %+v err=%v", got, err)
	}
	if secondHits != 0 {
		t.Fatalf("expected second provider not called, got %d hits", secondHits)
	}
}

func TestChainGeocoder_AllFail(t *testing.T) {
	chain := &chainGeocoder{providers: []namedGeocoder{
		{name: "first", geo: stubGeocoder{err: errors.New("denied")}},
		{name: "second", geo: stubGeocoder{err: errors.New("timeout")}},
	}}

	if _, err := chain.ReverseGeocode(context.Background(), 1, 2); err == nil {
		t.Fatal("expected error when all providers fail")
	}
}

func TestNewGeocoder_AppendsNominatimAsFallback(t *testing.T) {
	// A configured Google key must NOT produce a bare GoogleClient — Nominatim
	// has to remain available as a fallback when Google denies the request.
	g := NewGeocoder("AIzaFake", "")
	chain, ok := g.(*chainGeocoder)
	if !ok {
		t.Fatalf("expected *chainGeocoder, got %T", g)
	}
	if len(chain.providers) != 2 || chain.providers[0].name != "google" || chain.providers[1].name != "nominatim" {
		t.Fatalf("expected [google, nominatim] chain, got %+v", chain.providers)
	}
}

func TestNewGeocoder_NoKeysReturnsNominatimDirectly(t *testing.T) {
	g := NewGeocoder("", "")
	if _, ok := g.(*Client); !ok {
		t.Fatalf("expected bare Nominatim *Client when no keys set, got %T", g)
	}
}
