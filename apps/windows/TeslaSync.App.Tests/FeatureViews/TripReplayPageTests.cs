using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Driving;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TripReplayPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/trips/pages/TripReplayPage.tsx), the tolerant drive parser + position ↔ telemetry merge,
/// the four-state matrix (loading / empty / error / success), the eight drive-summary tiles, the six per-frame
/// current-position metric tiles (with SI → display unit conversion), the elevation / sparkline projections, the
/// generated-client feed's request shaping (web <c>useDrive</c>) and the view-model's replay-clock wiring. The
/// WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="TripReplayPageDisplay"/> flags asserted here.
/// </summary>
public sealed class TripReplayPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The i18n keys the page must resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "replay.title",
        "replay.drive",
        "replay.backToDrive",
        "replay.currentStats",
        "replay.stat.speed",
        "replay.stat.power",
        "replay.stat.battery",
        "replay.stat.elevation",
        "replay.stat.range",
        "replay.stat.temp",
        "replay.summary.title",
        "replay.summary.distance",
        "replay.summary.duration",
        "replay.summary.efficiency",
        "replay.summary.elevGain",
        "replay.summary.elevLoss",
        "replay.summary.maxSpeed",
        "replay.summary.avgSpeed",
        "replay.summary.battery",
        "replay.playback",
        "replay.noGps",
        "replay.error",
        "replay.retry",
        "replay.loading",
    ];

    private const string DriveJson = """
    {
      "id": 42,
      "start_ts": "2026-01-01T10:00:00Z",
      "start_address": "Home",
      "end_address": "Office",
      "distance_m": 12000,
      "duration_s": 1800,
      "start_soc_pct": 80,
      "end_soc_pct": 60,
      "max_speed_mps": 30,
      "avg_speed_mps": 18,
      "positions": [
        { "latitude": 47.60, "longitude": -122.30, "speed": 0,  "timestamp": "2026-01-01T10:00:00Z" },
        { "latitude": 47.61, "longitude": -122.31, "speed": 20, "timestamp": "2026-01-01T10:00:30Z" },
        { "latitude": 47.62, "longitude": -122.32, "speed": 25, "timestamp": "2026-01-01T10:01:00Z" },
        { "latitude": 0,     "longitude": 0,       "speed": 99, "timestamp": "2026-01-01T10:01:30Z" }
      ],
      "telemetry": [
        { "created_at": "2026-01-01T10:00:00Z", "power": -5, "battery_level": 80, "elevation": 100, "outside_temp": 15, "rated_range": 400000 },
        { "created_at": "2026-01-01T10:00:30Z", "power": 30, "battery_level": 78, "elevation": 120, "outside_temp": 15, "rated_range": 395000 },
        { "created_at": "2026-01-01T10:01:00Z", "power": 25, "battery_level": 76, "elevation": 140, "outside_temp": 16, "rated_range": 390000 }
      ]
    }
    """;

    private static JsonElement Json(string text) => JsonDocument.Parse(text).RootElement.Clone();

    private static TripReplayDrive Drive() => TripReplayDrive.FromJson(Json(DriveJson))!;

    private static TripReplayPageModel SuccessModel() => new(new TripReplayPageSnapshot(Drive()), false, null);

    private static TripReplayPageDisplay Project(TripReplayPageModel model, UnitPref? units = null) =>
        TripReplayPageProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ── i18n key coverage ─────────────────────────────────────────────────────────────

    [Fact]
    public void Required_string_keys_are_all_requested()
    {
        var recorder = new RecordingLocalizer();
        TripReplayPageProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);
        TripReplayPageProjection.CurrentStats(Drive().Positions, 0, UnitPref.Metric, recorder);

        foreach (string key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    // ── Four-state matrix ─────────────────────────────────────────────────────────────

    [Fact]
    public void Loading_state_when_loading_with_no_data()
    {
        var display = Project(TripReplayPageModel.Initial);

        Assert.Equal(TripReplayPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void Empty_state_when_resolved_with_no_positions()
    {
        var display = Project(new TripReplayPageModel(TripReplayPageSnapshot.Empty, false, null));

        Assert.Equal(TripReplayPageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(string.IsNullOrEmpty(display.EmptyMessage));
    }

    [Fact]
    public void Error_state_when_error_detail_present()
    {
        var display = Project(new TripReplayPageModel(TripReplayPageSnapshot.Empty, false, "boom"));

        Assert.Equal(TripReplayPageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Equal("boom", display.ErrorText);
    }

    [Fact]
    public void Success_state_with_positions()
    {
        var display = Project(SuccessModel());

        Assert.Equal(TripReplayPageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.Contains("42", display.Subtitle);
        Assert.Contains("Home", display.Subtitle);
    }

    // ── Drive summary (eight tiles) ───────────────────────────────────────────────────

    [Fact]
    public void Summary_has_eight_tiles_with_metric_values()
    {
        var display = Project(SuccessModel());

        Assert.Equal(8, display.SummaryCards.Count);
        Assert.Contains("12", display.SummaryCards[0].Value); // 12000 m → 12.0 km
        Assert.Equal("km", display.SummaryCards[0].Unit);
        Assert.Contains("30", display.SummaryCards[1].Value); // 1800 s → 30m
        Assert.NotEqual("\u2014", display.SummaryCards[2].Value); // efficiency present
        Assert.Contains("\u2192", display.SummaryCards[7].Value); // "80% → 60%"
        Assert.Contains("80", display.SummaryCards[7].Value);
        Assert.Contains("60", display.SummaryCards[7].Value);
    }

    [Fact]
    public void Summary_max_speed_converts_to_imperial()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        // Max speed tile is the sixth (index 5); 30 m/s → mph.
        Assert.Equal("mph", display.SummaryCards[5].Unit);
        Assert.Equal("mi", display.SummaryCards[0].Unit);
    }

    // ── Current-position metrics (six tiles) ──────────────────────────────────────────

    [Fact]
    public void Current_stats_have_six_tiles_and_track_the_index()
    {
        var positions = Drive().Positions;

        var first = TripReplayPageProjection.CurrentStats(positions, 0, UnitPref.Metric, Localizer);
        var last = TripReplayPageProjection.CurrentStats(positions, 2, UnitPref.Metric, Localizer);

        Assert.Equal(6, first.Count);
        Assert.Equal("Battery", first[2].Label);
        Assert.Contains("80", first[2].Value);       // start SoC 80%
        Assert.Contains("90", last[0].Value);        // 25 m/s → 90 km/h
        Assert.NotEqual(first[0].Value, last[0].Value);
    }

    [Fact]
    public void Current_stats_convert_to_imperial_units()
    {
        var positions = Drive().Positions;

        var stats = TripReplayPageProjection.CurrentStats(positions, 2, UnitPref.Imperial, Localizer);

        Assert.Contains("mph", stats[0].Value);      // speed
        Assert.Contains("mi", stats[4].Value);       // range
        Assert.Contains("F", stats[5].Value);        // temperature in °F
    }

    [Fact]
    public void Current_stats_dash_when_no_positions()
    {
        var stats = TripReplayPageProjection.CurrentStats(Array.Empty<TripReplayPagePosition>(), 0, UnitPref.Metric, Localizer);

        Assert.Equal(6, stats.Count);
        Assert.All(stats, m => Assert.Equal("\u2014", m.Value));
    }

    // ── Elevation profile + sparkline ─────────────────────────────────────────────────

    [Fact]
    public void Elevation_and_spark_match_the_position_count()
    {
        var display = Project(SuccessModel());

        Assert.Equal(3, display.ElevationPoints.Count);
        Assert.Equal("m", display.ElevationUnit);
        Assert.Equal(3, display.SpeedSparkData.Count);
        Assert.Equal(100.0, display.ElevationPoints[0].Y); // elevation of the first merged sample
    }

    // ── Position ↔ telemetry merge ────────────────────────────────────────────────────

    [Fact]
    public void Merge_joins_nearest_telemetry_and_drops_null_island()
    {
        var positions = Drive().Positions;

        Assert.Equal(3, positions.Count); // the (0,0) sample is filtered
        Assert.Equal(80.0, positions[0].BatteryPct);
        Assert.Equal(-5.0, positions[0].PowerKw!.Value);
        Assert.Equal(100.0, positions[0].ElevationM!.Value);
        Assert.Equal(400000.0, positions[0].RatedRangeM!.Value);
        Assert.Equal(16.0, positions[2].OutsideTempC!.Value);
    }

    // ── Generated-client feed request shaping ─────────────────────────────────────────

    [Fact]
    public async Task Client_feed_reads_the_drive_operation()
    {
        var api = new FakeApiClient().ReturnsValue(Json(DriveJson));
        var feed = new TripReplayPageClientFeed(api);

        var snapshot = await feed.FetchAsync(42, CancellationToken.None);

        Assert.NotNull(snapshot.Drive);
        Assert.Equal(3, snapshot.Drive!.Positions.Count);
        Assert.Single(api.Requests);
        Assert.Equal(TripReplayPageRegistration.DriveOperation, api.Requests[0].OperationId);
        Assert.Equal("42", api.Requests[0].PathParams!["driveID"]);
    }

    [Fact]
    public async Task Empty_feed_resolves_to_the_empty_snapshot()
    {
        var snapshot = await EmptyTripReplayPageFeed.Instance.FetchAsync(42, CancellationToken.None);

        Assert.False(snapshot.HasDrive);
        Assert.False(snapshot.HasPositions);
    }

    // ── View-model replay wiring ──────────────────────────────────────────────────────

    [Fact]
    public async Task ViewModel_loads_success_and_seek_updates_stats()
    {
        var vm = new TripReplayPageViewModel(new FakeFeed(new TripReplayPageSnapshot(Drive())), Localizer, 42);
        await vm.LoadAsync();

        Assert.Equal(TripReplayPageState.Success, vm.State);
        Assert.True(vm.HasTimeline);

        string firstSpeed = vm.CurrentStats[0].Value;
        vm.SeekToIndex(2);

        Assert.Equal(2, vm.CurrentIndex);
        Assert.NotEqual(firstSpeed, vm.CurrentStats[0].Value);

        vm.Dispose();
    }

    [Fact]
    public async Task ViewModel_play_then_tick_advances_to_the_end()
    {
        var vm = new TripReplayPageViewModel(new FakeFeed(new TripReplayPageSnapshot(Drive())), Localizer, 42);
        await vm.LoadAsync();

        vm.SetSpeed(100);
        vm.Play();
        Assert.True(vm.IsPlaying);

        for (int i = 0; i < 200 && vm.IsPlaying; i++)
        {
            vm.Tick();
        }

        Assert.False(vm.IsPlaying);
        Assert.Equal(2, vm.CurrentIndex);

        vm.Dispose();
    }

    [Fact]
    public async Task ViewModel_surfaces_error_state()
    {
        var vm = new TripReplayPageViewModel(new FakeFeed(new InvalidOperationException("nope")), Localizer, 42);
        await vm.LoadAsync();

        Assert.Equal(TripReplayPageState.Error, vm.State);
        Assert.True(vm.IsError);

        vm.Dispose();
    }

    private sealed class RecordingLocalizer : ILocalizer
    {
        public HashSet<string> Keys { get; } = new(StringComparer.Ordinal);

        public string GetString(string key, string fallback)
        {
            Keys.Add(key);
            return fallback;
        }
    }

    private sealed class FakeFeed : ITripReplayPageFeed
    {
        private readonly TripReplayPageSnapshot? _snapshot;
        private readonly Exception? _error;

        public FakeFeed(TripReplayPageSnapshot snapshot) => _snapshot = snapshot;

        public FakeFeed(Exception error) => _error = error;

        public Task<TripReplayPageSnapshot> FetchAsync(long driveId, CancellationToken cancellationToken)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return _error is { } error
                ? Task.FromException<TripReplayPageSnapshot>(error)
                : Task.FromResult(_snapshot ?? TripReplayPageSnapshot.Empty);
        }
    }
}
