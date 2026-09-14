package journey

import (
	"context"
	"errors"
	"testing"
)

func TestRouteFactor(t *testing.T) {
	f, trips, ok := RouteFactor([]RouteLeg{
		{DistanceM: 99000, StraightM: 90000},
		{DistanceM: 90000, StraightM: 90000},
	})
	if !ok || trips != 2 || f < 1.049 || f > 1.051 {
		t.Fatalf("factor = %f/%d/%v, want 1.05/2/true", f, trips, ok)
	}
	if _, _, ok := RouteFactor([]RouteLeg{{DistanceM: 99000, StraightM: 90000}}); ok {
		t.Fatal("single trip should not make a factor")
	}
	if _, n, ok := RouteFactor(nil); ok || n != 0 {
		t.Fatalf("nil = %d/%v, want 0/false", n, ok)
	}
	// Partial legs drop out instead of poisoning the mean.
	f, trips, ok = RouteFactor([]RouteLeg{
		{DistanceM: 0, StraightM: 90000},
		{DistanceM: 99000, StraightM: 0},
		{DistanceM: 99000, StraightM: 90000},
		{DistanceM: 90000, StraightM: 90000},
	})
	if !ok || trips != 2 || f < 1.049 || f > 1.051 {
		t.Fatalf("filtered = %f/%d/%v, want 1.05/2/true", f, trips, ok)
	}
	if f, _, ok := RouteFactor([]RouteLeg{
		{DistanceM: 300000, StraightM: 100000},
		{DistanceM: 400000, StraightM: 100000},
	}); !ok || f != 2.0 {
		t.Fatalf("high clamp = %f/%v, want 2.0", f, ok)
	}
	if f, _, ok := RouteFactor([]RouteLeg{
		{DistanceM: 50000, StraightM: 100000},
		{DistanceM: 60000, StraightM: 100000},
	}); !ok || f != 1.0 {
		t.Fatalf("low clamp = %f/%v, want 1.0", f, ok)
	}
}

func TestRouteFactorFor(t *testing.T) {
	ctx := context.Background()
	legs := []RouteLeg{
		{DistanceM: 99000, StraightM: 90000},
		{DistanceM: 90000, StraightM: 90000},
	}
	s := liveSession()
	s.OriginName, s.DestName = "Denver", "KC"
	f, n, err := routeFactorFor(ctx, &fakeTrail{legs: legs}, s)
	if err != nil || f == nil || n != 2 || *f < 1.049 || *f > 1.051 {
		t.Fatalf("factor = %v/%d/%v", f, n, err)
	}
	unnamed := liveSession()
	if f, n, err := routeFactorFor(ctx, &fakeTrail{legs: legs}, unnamed); err != nil || f != nil || n != 0 {
		t.Fatalf("unnamed = %v/%d/%v, want nil/0", f, n, err)
	}
	if f, _, err := routeFactorFor(ctx, &fakeTrail{legs: legs[:1]}, s); err != nil || f != nil {
		t.Fatalf("thin = %v/%v, want nil", f, err)
	}
	if _, _, err := routeFactorFor(ctx, &fakeTrail{legs: legs, err: errors.New("db down")}, s); err == nil {
		t.Fatal("store error should propagate")
	}
}
