package api

import (
	"bytes"
	"encoding/json"
	"math"
	"strings"
	"testing"
)

func TestCircleToPolygonWKT_RoundTripsCenterAndRadius(t *testing.T) {
	const (
		lat    = 47.819844
		lon    = -122.208886
		radius = 100.0
	)
	wkt := circleToPolygonWKT(lat, lon, radius, geofenceCircleSegments)
	if !strings.HasPrefix(wkt, "POLYGON((") || !strings.HasSuffix(wkt, "))") {
		t.Fatalf("WKT not well-formed: %q", wkt)
	}

	g, err := decodeGeofenceWriteBody(bytes.NewReader([]byte(`{
		"name":"Test","latitude":47.819844,"longitude":-122.208886,"radius":100
	}`)))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if g.PolygonWKT == "" {
		t.Fatal("decoder did not synthesize polygon_wkt from circle inputs")
	}

	gotLat, gotLon := g.Centroid()
	if math.Abs(gotLat-lat) > 1e-3 {
		t.Errorf("round-trip latitude drift: want %.6f got %.6f", lat, gotLat)
	}
	if math.Abs(gotLon-lon) > 1e-3 {
		t.Errorf("round-trip longitude drift: want %.6f got %.6f", lon, gotLon)
	}
	gotRadius := g.Radius()
	if gotRadius < radius*0.95 || gotRadius > radius*1.05 {
		t.Errorf("round-trip radius drift: want ~%.0f got %.2f", radius, gotRadius)
	}
}

// TestDecodeGeofenceWriteBody_AcceptsLegacyPolygonWKT ensures non-web
// callers that already produce WKT keep working unchanged.
func TestDecodeGeofenceWriteBody_AcceptsLegacyPolygonWKT(t *testing.T) {
	wkt := "POLYGON((0 0,1 0,1 1,0 1,0 0))"
	body := []byte(`{"name":"Box","polygon_wkt":"` + wkt + `"}`)
	g, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if g.PolygonWKT != wkt {
		t.Errorf("polygon_wkt not preserved: want %q got %q", wkt, g.PolygonWKT)
	}
}

// TestDecodeGeofenceWriteBody_CirclePrecedence — when both shapes are
// supplied the circle wins. This makes the web-client write path
// deterministic regardless of any stale `polygon_wkt` the form may carry.
func TestDecodeGeofenceWriteBody_CirclePrecedence(t *testing.T) {
	body := []byte(`{
		"name":"Mixed",
		"polygon_wkt":"POLYGON((0 0,1 0,1 1,0 1,0 0))",
		"latitude":47.0,"longitude":-122.0,"radius":50
	}`)
	g, err := decodeGeofenceWriteBody(bytes.NewReader(body))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	if !strings.Contains(g.PolygonWKT, "POLYGON((") {
		t.Fatalf("polygon_wkt malformed: %q", g.PolygonWKT)
	}
	gotLat, _ := g.Centroid()
	if math.Abs(gotLat-47.0) > 1e-3 {
		t.Errorf("circle inputs were ignored — centroid lat=%.6f, expected ~47.0", gotLat)
	}
}

// TestGeofence_MarshalJSON_EmitsCircleFields locks in the response shape
// the web Geofence interface depends on (`latitude`, `longitude`, `radius`
// alongside `polygon_wkt`).
func TestGeofence_MarshalJSON_EmitsCircleFields(t *testing.T) {
	g, err := decodeGeofenceWriteBody(bytes.NewReader([]byte(`{
		"name":"Round","latitude":40.0,"longitude":-74.0,"radius":250
	}`)))
	if err != nil {
		t.Fatalf("decode failed: %v", err)
	}
	raw, err := json.Marshal(g)
	if err != nil {
		t.Fatalf("marshal failed: %v", err)
	}
	var out map[string]any
	if err := json.Unmarshal(raw, &out); err != nil {
		t.Fatalf("unmarshal failed: %v", err)
	}
	for _, key := range []string{"latitude", "longitude", "radius", "polygon_wkt"} {
		if _, ok := out[key]; !ok {
			t.Errorf("response missing key %q (have %v)", key, keysOf(out))
		}
	}
	if r, _ := out["radius"].(float64); r < 200 || r > 300 {
		t.Errorf("response radius=%.2f, expected ~250", r)
	}
}

func keysOf(m map[string]any) []string {
	out := make([]string, 0, len(m))
	for k := range m {
		out = append(out, k)
	}
	return out
}
