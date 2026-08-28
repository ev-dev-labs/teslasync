package sse

import "testing"

func TestChannelSaturation(t *testing.T) {
	ch := make(chan []byte, 4)
	ch <- []byte("one")
	ch <- []byte("two")

	if got := channelSaturation(ch); got != 0.5 {
		t.Fatalf("channelSaturation() = %v, want 0.5", got)
	}
	if got := channelSaturation(make(chan []byte)); got != 0 {
		t.Fatalf("unbuffered channel saturation = %v, want 0", got)
	}
}
