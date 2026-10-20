package worker

import (
	"context"
	"errors"
	"math"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/port/external"
)

type failingGasPriceProvider struct {
	empty bool
}

func (p failingGasPriceProvider) GetCurrentPrice(context.Context, string) (*external.EnergyPrice, error) {
	if p.empty {
		return nil, nil
	}
	return nil, errors.New("refresh failed")
}

func TestGasPriceSnapshotRetainsDenominationAndRecovers(t *testing.T) {
	w := NewGasPriceWorker(nil, config.GasPriceConfig{PollInterval: "7d"}, failingGasPriceProvider{})
	if w.Status().CurrentPriceUnit != nil {
		t.Fatal("unpolled worker assumed a denomination")
	}
	at := time.Now().UTC()
	w.setPriceSnapshot(at, 1, litersPerUSGallon, 0.53, "liter")
	w.Poll(context.Background())
	retained := w.Status()
	if retained.CurrentPrice != 1 || retained.CurrentPriceUnit == nil ||
		*retained.CurrentPriceUnit != "liter" || retained.LastPollTime != at {
		t.Fatalf("failed refresh changed quote: %+v", retained)
	}
	w.provider = failingGasPriceProvider{empty: true}
	w.Poll(context.Background())
	if got := w.Status(); got.CurrentPrice != retained.CurrentPrice || got.LastPollTime != at {
		t.Fatalf("empty response changed retained quote: %+v", got)
	}
	w.setPriceSnapshot(at.Add(time.Second), 0, 0, 0, "gallon")
	recovered := w.Status()
	if recovered.CurrentPrice != 0 || recovered.CurrentPriceKWhEq != 0 ||
		recovered.CurrentPriceUnit == nil || *recovered.CurrentPriceUnit != "gallon" ||
		recovered.LastPollTime != at.Add(time.Second) {
		t.Fatalf("zero quote recovery = %+v", recovered)
	}
	if *retained.CurrentPriceUnit != "liter" {
		t.Fatal("publishing a new quote mutated a retained snapshot")
	}
}

func TestGasPriceSnapshotIsAtomic(t *testing.T) {
	w := NewGasPriceWorker(nil, config.GasPriceConfig{}, nil)
	var writers sync.WaitGroup
	writers.Add(1)
	go func() {
		defer writers.Done()
		for i := 0; i < 1000; i++ {
			w.setPriceSnapshot(time.Now().UTC(), 1, litersPerUSGallon, 0.5, "liter")
			w.setPriceSnapshot(time.Now().UTC(), 4, 4, 0.6, "gallon")
		}
	}()
	for i := 0; i < 1000; i++ {
		s := w.Status()
		if s.CurrentPriceUnit == nil {
			continue
		}
		if (*s.CurrentPriceUnit == "liter" && s.CurrentPrice != 1) ||
			(*s.CurrentPriceUnit == "gallon" && s.CurrentPrice != 4) {
			t.Fatalf("mixed snapshot: %+v", s)
		}
	}
	writers.Wait()
}

func TestGasPriceWorkerSetPollIntervalResetsActiveTicker(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		w := NewGasPriceWorker(nil, config.GasPriceConfig{PollInterval: "7d"}, nil)
		w.running.Store(true)
		w.lastPollTime = time.Now().UTC()
		w.lastPrice = 3.5
		w.lastPriceKWhEq = 3.5 / gallonToKWhFactor
		w.ticker = time.NewTicker(w.tickerDuration())
		defer w.ticker.Stop()
		originalTicker := w.ticker
		populated := w.Status()

		for _, interval := range []string{"daily", "15d", "30d", "7d"} {
			w.SetPollInterval(interval)
			status := w.Status()
			if status.PollInterval != interval {
				t.Fatalf("status interval = %q, want %q", status.PollInterval, interval)
			}
			if !status.Enabled || status.LastPollTime != populated.LastPollTime ||
				status.CurrentPrice != populated.CurrentPrice ||
				status.CurrentPriceKWhEq != populated.CurrentPriceKWhEq {
				t.Fatalf("interval update changed populated status: %+v", status)
			}
			if w.ticker != originalTicker {
				t.Fatal("interval update replaced the existing ticker")
			}
			start := time.Now()
			select {
			case tick := <-w.ticker.C:
				if elapsed := tick.Sub(start); elapsed != w.tickerDuration() {
					t.Fatalf("tick after %v, want %v", elapsed, w.tickerDuration())
				}
			case <-time.After(w.tickerDuration() + time.Second):
				t.Fatal("active ticker did not adopt the updated interval")
			}
		}

		w.SetPollInterval("invalid")
		if got := w.Status().PollInterval; got != "7d" {
			t.Fatalf("invalid interval changed status to %q", got)
		}
	})
}

func TestGasPriceWorkerIntervalBeforeStart(t *testing.T) {
	w := NewGasPriceWorker(nil, config.GasPriceConfig{PollInterval: "invalid"}, nil)
	if got := w.Status().PollInterval; got != "7d" {
		t.Fatalf("default interval = %q, want 7d", got)
	}
	w.SetPollInterval("daily")
	if got := w.Status().PollInterval; got != "daily" {
		t.Fatalf("configured interval = %q, want daily", got)
	}
	if got := w.tickerDuration(); got != 24*time.Hour {
		t.Fatalf("configured duration = %v, want 24h", got)
	}
}

func TestGasPricePerConfiguredUnit(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name           string
		pricePerGallon float64
		unit           string
		want           float64
	}{
		{
			name:           "gallon",
			pricePerGallon: 3.50,
			unit:           "gallon",
			want:           3.50,
		},
		{
			name:           "liter",
			pricePerGallon: litersPerUSGallon,
			unit:           "liter",
			want:           1,
		},
		{
			name:           "case insensitive litre",
			pricePerGallon: litersPerUSGallon,
			unit:           " LITRE ",
			want:           1,
		},
		{
			name:           "unknown defaults to gallon",
			pricePerGallon: 4,
			unit:           "unknown",
			want:           4,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := gasPricePerConfiguredUnit(tt.pricePerGallon, tt.unit)
			if math.Abs(got-tt.want) > 0.000_001 {
				t.Fatalf("gasPricePerConfiguredUnit() = %f, want %f", got, tt.want)
			}
		})
	}
}
