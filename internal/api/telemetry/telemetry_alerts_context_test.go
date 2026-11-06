package telemetry

import "testing"

func TestAlertMessageSignalsPreservesFreshContextAndExplicitClears(t *testing.T) {
	evaluated := map[string]any{"MediaNowPlayingArtist": "old artist", "MediaNowPlayingTitle": "old title"}
	accumulated := map[string]any{"MediaNowPlayingArtist": "latest artist", "MediaNowPlayingStation": "station"}
	current := map[string]any{"MediaNowPlayingTitle": ""}
	got := alertMessageSignals(evaluated, accumulated, current)
	if got["MediaNowPlayingArtist"] != "latest artist" || got["MediaNowPlayingStation"] != "station" || got["MediaNowPlayingTitle"] != "" {
		t.Fatalf("message must use L1 context with triggering batch precedence: %#v", got)
	}
	if evaluated["MediaNowPlayingArtist"] != "old artist" || len(current) != 1 {
		t.Fatal("message context modified rule engine inputs")
	}
}
