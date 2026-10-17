package app

import (
	"context"
	"errors"
	"reflect"
	"strings"
	"testing"
	"time"

	apitelem "github.com/ev-dev-labs/teslasync/internal/api/telemetry"
	"github.com/ev-dev-labs/teslasync/internal/config"
	"github.com/ev-dev-labs/teslasync/internal/database"
	"github.com/ev-dev-labs/teslasync/internal/mqtt"
	"github.com/ev-dev-labs/teslasync/internal/signal"
)

func TestLiveReadInitializationDisabledIngest(t *testing.T) {
	a := &App{Cfg: &config.Config{}}
	a.Cfg.FleetTelemetry.LiveSignalStoreMode = "hybrid"
	if err := a.initLiveSignalStore(); err != nil {
		t.Fatal(err)
	}
	local, live := a.SignalStore, a.LiveSignalStore
	if local == nil || live == nil {
		t.Fatal("API-only App must construct real reader layers")
	}
	ts := time.Now().UTC()
	local.Set(8101, "InsideTemp", float32(21.5), ts)
	if err := a.initTelemetryHandler(context.Background()); err != nil {
		t.Fatal(err)
	}
	if a.TelemetryHandler != nil || a.pipelineSubscriber != nil || a.MQTT != nil || a.SignalHistoryWriter != nil {
		t.Fatal("disabled ingest initialized an ownership/subscriber resource")
	}
	if a.SignalStore != local || a.LiveSignalStore != live {
		t.Fatal("disabled telemetry replaced the reader layers")
	}
	got, err := live.GetSignal(context.Background(), 8101, "InsideTemp", signal.LiveSignalReadDistributed)
	if err != nil || got == nil || got.Raw != float32(21.5) || !got.Timestamp.Equal(ts) {
		t.Fatalf("API-only real L1 read = %#v, %v", got, err)
	}
}

func TestLiveReadInitializationEnabledReusesHydratedLayers(t *testing.T) {
	a := &App{Cfg: &config.Config{}}
	a.Cfg.FleetTelemetry.Enabled = true
	a.Cfg.FleetTelemetry.LiveSignalStoreMode = "local"
	if err := a.initLiveSignalStore(); err != nil {
		t.Fatal(err)
	}
	local, live := a.SignalStore, a.LiveSignalStore
	// The existing repository constructors require a non-nil DB wrapper.
	// No pool is opened or called by this construction/wiring test.
	a.TelemetryHandler = apitelem.NewHandler(&database.DB{}, nil, nil, time.Minute, nil)
	a.wireTelemetryLiveStores()
	if a.TelemetryHandler.GetSignalStore() != local || a.TelemetryHandler.GetLiveSignalStore() != live {
		t.Fatal("telemetry must reuse identical App layer pointers")
	}
	fsmLocal := reflect.ValueOf(a.TelemetryHandler.FSMHandler()).Elem().FieldByName("localSignals").Pointer()
	if fsmLocal != reflect.ValueOf(local).Pointer() {
		t.Fatal("FSM must keep the identical local L1")
	}
	ts := time.Now().UTC()
	local.Set(8102, "InsideTemp", float32(22), ts)
	if err := live.Warm(context.Background(), 8102); err != nil {
		t.Fatal(err)
	}
	local.Hydrate(8102, map[string]interface{}{"InsideTemp": float32(0), "OutsideTemp": float32(10)})
	got, err := live.GetAll(context.Background(), 8102, signal.LiveSignalReadDistributed)
	if err != nil || got["InsideTemp"].Raw != float32(22) || got["OutsideTemp"].Raw != float32(10) {
		t.Fatalf("shared layers after hydration = %#v, %v", got, err)
	}
	if !got["InsideTemp"].Timestamp.Equal(ts) || a.SignalStore != local || a.LiveSignalStore != live {
		t.Fatal("hydration replaced live observations or reader layers")
	}
	// Pin the actual production ordering as well as the behavior above.
	src := readAppSources(t)
	for _, order := range [][]string{
		{"if err := a.initLiveSignalStore();", "if err := a.initTelemetryHandler(ctx);"},
		{"a.wireTelemetryLiveStores()", "liveSignalStore.Warm(", "a.SignalStore.Hydrate(", "sessionTracker.RecoverSessions(", "StartReconcileLoop()", "a.initPipelineSubscriber("},
	} {
		last := -1
		for _, marker := range order {
			at := strings.Index(src, marker)
			if at <= last {
				t.Fatalf("production initialization order lost at %q", marker)
			}
			last = at
		}
	}
}

func TestLiveReadInitializationValidation(t *testing.T) {
	t.Run("invalidModeBeforeOwnership", func(t *testing.T) {
		a := &App{Cfg: &config.Config{}}
		a.Cfg.FleetTelemetry.LiveSignalStoreMode = "invalid"
		err := a.initLiveSignalStore()
		if !errors.Is(err, signal.ErrInvalidLiveSignalStoreMode) || !strings.Contains(err.Error(), "invalid LIVE_SIGNAL_STORE_MODE") {
			t.Fatalf("mode error = %v", err)
		}
		if a.LiveSignalStore != nil || a.SignalStore != nil || a.TelemetryHandler != nil || a.pipelineSubscriber != nil {
			t.Fatal("invalid mode published partially initialized layers")
		}
	})
	t.Run("enabledMQTTError", func(t *testing.T) {
		a := &App{Cfg: &config.Config{}}
		a.Cfg.FleetTelemetry.Enabled = true
		if err := a.initLiveSignalStore(); err != nil {
			t.Fatal(err)
		}
		err := a.initTelemetryHandler(context.Background())
		if err == nil || err.Error() != "fleet telemetry is enabled but MQTT is unavailable" {
			t.Fatalf("enabled MQTT error = %v", err)
		}
	})
	t.Run("enabledTopicError", func(t *testing.T) {
		a := &App{Cfg: &config.Config{}, MQTT: &mqtt.Client{}}
		a.Cfg.FleetTelemetry.Enabled = true
		if err := a.initLiveSignalStore(); err != nil {
			t.Fatal(err)
		}
		err := a.initTelemetryHandler(context.Background())
		if err == nil || err.Error() != "fleet telemetry is enabled but FLEET_TELEMETRY_TOPIC_BASE is empty" {
			t.Fatalf("enabled topic error = %v", err)
		}
	})
	t.Run("nilLocalDependency", func(t *testing.T) {
		_, err := signal.NewLiveSignalStore(nil, nil, "hybrid")
		if !errors.Is(err, signal.ErrNilLocalSignalStore) {
			t.Fatalf("nil L1 error = %v", err)
		}
	})
	t.Run("nilLiveReaderDependency", func(t *testing.T) {
		_, err := signal.NewLiveStateReader(nil, nil)
		if !errors.Is(err, signal.ErrNilLiveSignalStore) {
			t.Fatalf("nil live boundary error = %v", err)
		}
	})
}
