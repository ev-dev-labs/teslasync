using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core.Live;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Telemetry;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>LiveSignalMonitorPage</c> surface's Microsoft.UI-free logic — the tail
/// parser (web/src/features/telemetry/hooks/useLiveSignalStream.ts <c>handleVehicleUpdate</c>), the
/// projection (web/src/features/telemetry/pages/LiveSignalMonitorPage.tsx +
/// web/src/features/telemetry/components/LiveSignalTail.tsx), the four mandated parity strings plus the full
/// tail i18n key set, the view-model's buffer / rate / pause / filter / clear / vehicle-scope flows across
/// the loading / empty / streaming / error data-states, and the live feeds. The WinUI view is exercised by
/// the app build; its per-region visibility is driven entirely by the asserted <see cref="LiveSignalMonitorDisplay"/>.
/// </summary>
public sealed class LiveSignalMonitorPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 14, 0, 0, 0, TimeSpan.Zero);

    // The 4 i18n keys the manifest (string-group:telemetry/LiveSignalMonitor) requires the page to resolve.
    private static readonly string[] ManifestStringKeys =
    [
        "liveMonitor.connected",
        "liveMonitor.disconnected",
        "liveMonitor.subtitle",
        "liveMonitor.title",
    ];

    // The full set the tail projection resolves (the 4 manifest keys + every LiveSignalTail label).
    private static readonly string[] AllTailKeys =
    [
        "liveMonitor.connected", "liveMonitor.disconnected", "liveMonitor.subtitle", "liveMonitor.title",
        "liveMonitor.pause", "liveMonitor.resume", "liveMonitor.filterPlaceholder", "liveMonitor.filterLabel", // parity:allow web i18n key names asserted as data
        "liveMonitor.autoScroll", "liveMonitor.clear", "liveMonitor.sigPerSec", "liveMonitor.bufferSize",
        "liveMonitor.uniqueSignals", "liveMonitor.filtered", "liveMonitor.time", "liveMonitor.signal",
        "liveMonitor.value", "liveMonitor.type", "liveMonitor.freshness", "liveMonitor.waiting",
        "liveMonitor.noMatch",
    ];

    private static SignalTailEntry Entry(
        long id,
        string name,
        string value = "1",
        SignalEntryType type = SignalEntryType.Number,
        DateTimeOffset? timestamp = null) =>
        new(id, name, value, type, timestamp ?? Now);

    private static LiveSignalMonitorModel Model(
        long vehicleId = 7,
        bool connected = false,
        bool connecting = false,
        bool errored = false,
        bool paused = false,
        bool autoScroll = true,
        string filter = "",
        IReadOnlyList<SignalTailEntry>? entries = null,
        int rate = 0,
        int bufferMax = 500) =>
        new(vehicleId, connected, connecting, errored, paused, autoScroll, filter, entries ?? [], rate, bufferMax);

    private static JsonElement Json(string json)
    {
        using var doc = JsonDocument.Parse(json);
        return doc.RootElement.Clone();
    }

    private static VehicleUpdateSnapshot Snapshot(string json, long vehicleId = 7, DateTimeOffset? at = null) =>
        new(vehicleId, Json(json), at ?? Now);

    // ---- i18n key coverage (4 manifest strings + full tail set) ----------------------------------

    [Fact]
    public void Projection_resolves_all_4_manifest_string_keys_in_one_pass()
    {
        var recorder = new RecordingLocalizer();

        _ = LiveSignalMonitorProjection.Project(Model(), recorder);

        foreach (var key in ManifestStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Manifest_string_key_list_has_the_required_count()
    {
        Assert.Equal(4, ManifestStringKeys.Length);
        Assert.Equal(ManifestStringKeys.Length, ManifestStringKeys.Distinct().Count());
    }

    [Fact]
    public void Projection_resolves_the_full_tail_key_set_even_when_idle()
    {
        var recorder = new RecordingLocalizer();

        _ = LiveSignalMonitorProjection.Project(Model(), recorder);

        foreach (var key in AllTailKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_while_streaming()
    {
        var recorder = new RecordingLocalizer();

        _ = LiveSignalMonitorProjection.Project(
            Model(connected: true, entries: [Entry(1, "speed")], rate: 4),
            recorder);

        foreach (var key in AllTailKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ---- connection badge (liveMonitor.connected / .disconnected) --------------------------------

    [Fact]
    public void Connection_badge_reads_connected_when_live()
    {
        var display = LiveSignalMonitorProjection.Project(Model(connected: true), Localizer);
        Assert.True(display.Connected);
        Assert.Equal("Connected", display.ConnectionLabel);
    }

    [Fact]
    public void Connection_badge_reads_disconnected_when_offline()
    {
        var display = LiveSignalMonitorProjection.Project(Model(connected: false), Localizer);
        Assert.False(display.Connected);
        Assert.Equal("Disconnected", display.ConnectionLabel);
    }

    // ---- stat cards (rate / buffer / unique / filtered) ------------------------------------------

    [Fact]
    public void Stat_cards_carry_their_values()
    {
        var entries = new[] { Entry(3, "speed"), Entry(2, "soc"), Entry(1, "speed") };
        var display = LiveSignalMonitorProjection.Project(
            Model(entries: entries, rate: 12, bufferMax: 500),
            Localizer);

        Assert.Equal("Signals / sec", display.RateLabel);
        Assert.Equal("12", display.RateValue);
        Assert.Equal("Buffer Size", display.BufferLabel);
        Assert.Equal("3", display.BufferValue);
        Assert.Equal("/ 500", display.BufferSublabel);
        Assert.Equal("Unique Signals", display.UniqueLabel);
        Assert.Equal("2", display.UniqueValue); // speed + soc
        Assert.Equal("Filtered", display.FilteredLabel);
        Assert.Equal("3", display.FilteredValue);
    }

    [Fact]
    public void Filter_narrows_filtered_count_and_visible_rows()
    {
        var entries = new[] { Entry(3, "vehicle_speed"), Entry(2, "soc"), Entry(1, "wheel_speed") };
        var display = LiveSignalMonitorProjection.Project(Model(entries: entries, filter: "speed"), Localizer);

        Assert.Equal("2", display.FilteredValue);
        Assert.Equal(2, display.Entries.Count);
        Assert.All(display.Entries, e => Assert.Contains("speed", e.Name, StringComparison.Ordinal));
    }

    [Fact]
    public void Pause_label_toggles_between_pause_and_resume()
    {
        Assert.Equal("Pause", LiveSignalMonitorProjection.Project(Model(paused: false), Localizer).PauseLabel);
        Assert.Equal("Resume", LiveSignalMonitorProjection.Project(Model(paused: true), Localizer).PauseLabel);
    }

    // ---- the four data states (loading / empty / streaming / error) ------------------------------

    [Fact]
    public void State_empty_is_the_waiting_default()
    {
        var display = LiveSignalMonitorProjection.Project(Model(), Localizer);
        Assert.Equal(LiveSignalMonitorBodyState.Empty, display.BodyState);
        Assert.Equal("Waiting for signals\u2026", display.WaitingMessage);
    }

    [Fact]
    public void State_loading_when_connecting_with_no_rows()
    {
        var display = LiveSignalMonitorProjection.Project(Model(connecting: true), Localizer);
        Assert.Equal(LiveSignalMonitorBodyState.Loading, display.BodyState);
    }

    [Fact]
    public void State_streaming_when_rows_present()
    {
        var display = LiveSignalMonitorProjection.Project(Model(entries: [Entry(1, "speed")]), Localizer);
        Assert.Equal(LiveSignalMonitorBodyState.Streaming, display.BodyState);
        Assert.False(display.ShowNoMatch);
    }

    [Fact]
    public void State_error_wins_over_rows()
    {
        var display = LiveSignalMonitorProjection.Project(Model(errored: true, entries: [Entry(1, "speed")]), Localizer);
        Assert.Equal(LiveSignalMonitorBodyState.Error, display.BodyState);
    }

    [Fact]
    public void Filtered_empty_shows_the_no_match_message()
    {
        var display = LiveSignalMonitorProjection.Project(
            Model(entries: [Entry(1, "speed")], filter: "zzz"),
            Localizer);

        Assert.Equal(LiveSignalMonitorBodyState.Streaming, display.BodyState);
        Assert.True(display.ShowNoMatch);
        Assert.Empty(display.Entries);
        Assert.Equal("No signals match filter", display.NoMatchMessage);
    }

    // ---- the tail parser (handleVehicleUpdate) ---------------------------------------------------

    [Fact]
    public void Parser_extracts_cold_array_rows()
    {
        var rows = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":7,\"cold\":[{\"name\":\"Soc\",\"value\":80},{\"name\":\"Gear\",\"value\":\"D\"}]}"),
            7,
            Now);

        Assert.Equal(2, rows.Count);
        Assert.Equal("Soc", rows[0].Name);
        Assert.Equal("80", rows[0].Value);
        Assert.Equal(SignalEntryType.Number, rows[0].Type);
        Assert.Equal("Gear", rows[1].Name);
        Assert.Equal("D", rows[1].Value);
        Assert.Equal(SignalEntryType.Text, rows[1].Type);
    }

    [Fact]
    public void Parser_extracts_tables_columns()
    {
        var rows = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":7,\"tables\":{\"drive\":{\"power\":12,\"locked\":true}}}"),
            7,
            Now);

        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, r => r.Name == "power" && r.Type == SignalEntryType.Number);
        Assert.Contains(rows, r => r.Name == "locked" && r.Type == SignalEntryType.Boolean && r.Value == "true");
    }

    [Fact]
    public void Parser_falls_back_to_bare_signals_map_and_skips_reserved_and_compound()
    {
        var rows = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":7,\"ts\":\"x\",\"speed\":10,\"locked\":false,\"loc\":{\"lat\":1},\"trail\":[1,2]}"),
            7,
            Now);

        Assert.Equal(2, rows.Count);
        Assert.Contains(rows, r => r.Name == "speed" && r.Type == SignalEntryType.Number);
        Assert.Contains(rows, r => r.Name == "locked" && r.Type == SignalEntryType.Boolean);
        Assert.DoesNotContain(rows, r => r.Name is "loc" or "trail" or "vehicle_id" or "ts");
    }

    [Fact]
    public void Parser_reads_the_signals_envelope_when_present()
    {
        var rows = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":7,\"signals\":{\"speed\":5}}"),
            7,
            Now);

        Assert.Single(rows);
        Assert.Equal("speed", rows[0].Name);
    }

    [Fact]
    public void Parser_drops_events_for_other_vehicles()
    {
        var rows = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":9,\"cold\":[{\"name\":\"Soc\",\"value\":1}]}"),
            7,
            Now);

        Assert.Empty(rows);
    }

    [Fact]
    public void Parser_passes_system_events_without_a_vehicle_id()
    {
        var rows = LiveSignalTailParser.Extract(
            Json("{\"cold\":[{\"name\":\"Soc\",\"value\":1}]}"),
            7,
            Now);

        Assert.Single(rows);
    }

    [Fact]
    public void Parser_uses_payload_timestamp_when_present_else_the_fallback()
    {
        var withTs = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":7,\"timestamp\":\"2026-06-14T01:02:03Z\",\"cold\":[{\"name\":\"Soc\",\"value\":1}]}"),
            7,
            Now);
        Assert.Equal(new DateTimeOffset(2026, 6, 14, 1, 2, 3, TimeSpan.Zero), withTs[0].Timestamp);

        var fallback = LiveSignalTailParser.Extract(
            Json("{\"vehicle_id\":7,\"cold\":[{\"name\":\"Soc\",\"value\":1}]}"),
            7,
            Now);
        Assert.Equal(Now, fallback[0].Timestamp);
    }

    [Fact]
    public void Render_value_coerces_null_and_compound_safely()
    {
        Assert.Equal("null", LiveSignalTailParser.RenderValue(Json("null")));
        Assert.Equal("true", LiveSignalTailParser.RenderValue(Json("true")));
        Assert.Equal("12.5", LiveSignalTailParser.RenderValue(Json("12.5")));
        Assert.Equal("hi", LiveSignalTailParser.RenderValue(Json("\"hi\"")));
    }

    // ---- the view-model flows --------------------------------------------------------------------

    [Fact]
    public void ViewModel_buffers_updates_newest_first()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);

        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"a\",\"value\":1},{\"name\":\"b\",\"value\":2}]}"));

        Assert.Equal(2, vm.Display.Entries.Count);
        Assert.Equal("a", vm.Display.Entries[0].Name);
        Assert.Equal("2", vm.Display.BufferValue);
        Assert.Equal(LiveSignalMonitorBodyState.Streaming, vm.Display.BodyState);
    }

    [Fact]
    public void ViewModel_caps_the_buffer_and_keeps_the_newest_batch()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7, bufferMax: 3);

        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"a\",\"value\":1},{\"name\":\"b\",\"value\":2}]}"));
        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"c\",\"value\":3},{\"name\":\"d\",\"value\":4}]}"));

        Assert.Equal(3, vm.Display.Entries.Count);
        Assert.Equal("c", vm.Display.Entries[0].Name);
        Assert.Equal("d", vm.Display.Entries[1].Name);
        Assert.Equal("a", vm.Display.Entries[2].Name);
        Assert.DoesNotContain(vm.Display.Entries, e => e.Name == "b");
    }

    [Fact]
    public void ViewModel_ignores_updates_while_paused()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);
        vm.SetPaused(true);

        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"a\",\"value\":1}]}"));

        Assert.Empty(vm.Display.Entries);
        Assert.True(vm.Display.Paused);
        Assert.Equal("Resume", vm.Display.PauseLabel);
    }

    [Fact]
    public void ViewModel_rate_window_publishes_then_resets()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);

        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"a\",\"value\":1},{\"name\":\"b\",\"value\":2}]}"));
        vm.AdvanceRateWindow();
        Assert.Equal("2", vm.Display.RateValue);

        vm.AdvanceRateWindow();
        Assert.Equal("0", vm.Display.RateValue);
    }

    [Fact]
    public void ViewModel_filter_narrows_the_visible_rows()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);
        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"speed\",\"value\":1},{\"name\":\"soc\",\"value\":2}]}"));

        vm.SetFilter("spe");

        Assert.Equal("1", vm.Display.FilteredValue);
        Assert.Single(vm.Display.Entries);
        Assert.Equal("speed", vm.Display.Entries[0].Name);
    }

    [Fact]
    public void ViewModel_clear_empties_the_buffer()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);
        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"a\",\"value\":1}]}"));

        vm.Clear();

        Assert.Empty(vm.Display.Entries);
        Assert.Equal(LiveSignalMonitorBodyState.Empty, vm.Display.BodyState);
    }

    [Fact]
    public void ViewModel_vehicle_switch_clears_the_buffer()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);
        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":7,\"cold\":[{\"name\":\"a\",\"value\":1}]}"));

        vm.SetVehicle(9);

        Assert.Empty(vm.Display.Entries);
    }

    [Fact]
    public void ViewModel_scopes_updates_to_the_selected_vehicle()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);

        vm.ApplyVehicleUpdate(Snapshot("{\"vehicle_id\":9,\"cold\":[{\"name\":\"a\",\"value\":1}]}", vehicleId: 9));

        Assert.Empty(vm.Display.Entries);
    }

    [Fact]
    public void ViewModel_connection_updates_the_badge_and_clears_the_shimmer()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);
        vm.SetConnecting(true);
        Assert.Equal(LiveSignalMonitorBodyState.Loading, vm.Display.BodyState);

        vm.SetConnected(true);

        Assert.True(vm.Display.Connected);
        Assert.Equal("Connected", vm.Display.ConnectionLabel);
        Assert.Equal(LiveSignalMonitorBodyState.Empty, vm.Display.BodyState);
    }

    [Fact]
    public void ViewModel_error_drives_the_error_state()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);

        vm.SetErrored(true);
        Assert.Equal(LiveSignalMonitorBodyState.Error, vm.Display.BodyState);

        vm.SetErrored(false);
        Assert.Equal(LiveSignalMonitorBodyState.Empty, vm.Display.BodyState);
    }

    [Fact]
    public void ViewModel_auto_scroll_defaults_on_and_toggles()
    {
        var vm = new LiveSignalMonitorPageViewModel(Localizer, vehicleId: 7);
        Assert.True(vm.IsAutoScroll);
        Assert.True(vm.Display.AutoScroll);

        vm.ToggleAutoScroll();
        Assert.False(vm.IsAutoScroll);
        Assert.False(vm.Display.AutoScroll);
    }

    // ---- the live feeds --------------------------------------------------------------------------

    [Fact]
    public void Empty_feed_is_disconnected_and_silent()
    {
        Assert.False(EmptyLiveSignalMonitorFeed.Instance.Connected);
    }

    [Fact]
    public void Store_feed_forwards_vehicle_updates()
    {
        var store = new LiveSignalStore(() => Now);
        using var feed = new LiveStoreSignalMonitorFeed(store);
        VehicleUpdateSnapshot? captured = null;
        feed.VehicleUpdated += s => captured = s;

        store.Apply(new LiveEvent.VehicleUpdate(Json("{\"vehicle_id\":7,\"speed\":10}"), null));

        Assert.NotNull(captured);
        Assert.Equal(7, captured!.VehicleId);
    }

    [Fact]
    public void Store_feed_maps_an_open_stream_to_connected()
    {
        var store = new LiveSignalStore(() => Now);
        var monitor = new LiveConnectionMonitor(TimeSpan.FromSeconds(120), () => Now);
        using var feed = new LiveStoreSignalMonitorFeed(store, monitor);
        bool? connected = null;
        feed.ConnectionChanged += c => connected = c;

        Assert.False(feed.Connected);
        monitor.MarkEvent(Now);

        Assert.True(feed.Connected);
        Assert.True(connected);
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public List<string> Keys { get; } = [];

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }
}
