package chatbot

import (
	"strings"
	"testing"
)

func TestClassifyIntentCostBeatsCharging(t *testing.T) {
	if got := classifyIntent(strings.ToLower("what was my charging cost?")); got != "cost" {
		t.Fatalf("intent = %q, want cost", got)
	}
	if got := classifyIntent(strings.ToLower("charging sessions?")); got != "charging" {
		t.Fatalf("intent = %q, want charging", got)
	}
}

func TestIntentLinksPointAtRealRoutes(t *testing.T) {
	for _, intent := range []string{
		"vehicles", "drives", "distance", "efficiency", "battery",
		"charging", "cost", "longest", "maxspeed", "lastdrive",
		"lastcharge", "alerts", "geofences", "status",
	} {
		links := intentLinks(intent)
		if len(links) == 0 {
			t.Fatalf("intent %s has no links", intent)
		}
		for _, l := range links {
			if l.Label == "" || !strings.HasPrefix(l.Path, "/") {
				t.Fatalf("bad link %+v for %s", l, intent)
			}
		}
	}
	if links := intentLinks(""); len(links) != 0 {
		t.Fatalf("fallback must have no links: %+v", links)
	}
}
