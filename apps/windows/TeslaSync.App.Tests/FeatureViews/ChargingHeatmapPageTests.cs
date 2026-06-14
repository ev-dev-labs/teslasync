using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Charging;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>ChargingHeatmapPage</c> surface's Microsoft.UI-free logic — the tolerant
/// charging-sessions parser, the page projection (web/src/features/charging/pages/ChargingHeatmapPage.tsx) with
/// its loading / empty / success / error matrix, the ported <c>heatColor</c> / <c>buildGrid</c> /
/// <c>durationMinutes</c> helpers and the top-locations reduction, the twelve manifest i18n keys, the data
/// state-holder, and the generated-client feed's request shaping (web <c>useChargingSessionsPaginated</c>). The
/// WinUI view is exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="ChargingHeatmapDisplay"/> flags asserted here.
/// </summary>
public sealed class ChargingHeatmapPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly TimeZoneInfo Utc = TimeZoneInfo.Utc;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The twelve i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "charging.heatmap.avgDuration",
        "charging.heatmap.favorite",
        "charging.heatmap.gridTitle",
        "charging.heatmap.less",
        "charging.heatmap.more",
        "charging.heatmap.subtitle",
        "charging.heatmap.title",
        "charging.heatmap.topLocations",
        "charging.heatmap.totalCost",
        "charging.heatmap.totalEnergy",
        "charging.heatmap.totalSessions",
        "common.noData",
    ];

    // ---- Snapshot parsing ----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_a_sessions_array()
    {
        var snapshot = ChargingHeatmapSnapshot.FromJson(Json(
            "[{\"id\":5,\"started_at\":\"2026-06-01T10:00:00Z\",\"ended_at\":\"2026-06-01T11:00:00Z\"," +
            "\"total_energy_added_wh\":50000,\"cost_decimal\":12.5,\"start_place\":\"Home\"}]"));

        Assert.True(snapshot.HasData);
        var session = Assert.Single(snapshot.Sessions);
        Assert.Equal(5, session.Id);
        Assert.Equal(50000, session.TotalEnergyAddedWh);
        Assert.Equal(12.5, session.CostDecimal);
        Assert.Equal("Home", session.StartPlace);
    }

    [Fact]
    public void Snapshot_non_array_is_empty()
    {
        Assert.False(ChargingHeatmapSnapshot.FromJson(Json("{}")).HasData);
        Assert.False(ChargingHeatmapSnapshot.FromJson(Json("[]")).HasData);
    }

    [Fact]
    public void Snapshot_tolerates_a_partial_row()
    {
        var snapshot = ChargingHeatmapSnapshot.FromJson(Json("[{\"id\":1}]"));

        var session = Assert.Single(snapshot.Sessions);
        Assert.Null(session.StartedAt);
        Assert.Null(session.TotalEnergyAddedWh);
        Assert.Null(session.StartPlace);
    }

    // ---- i18n key coverage (the twelve manifest strings) ---------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingHeatmapProjection.Project(SuccessModel(), recorder, Utc);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_every_required_string_key_in_empty()
    {
        var recorder = new RecordingLocalizer();

        _ = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(ChargingHeatmapSnapshot.Empty, false, null), recorder, Utc);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_twelve_unique_keys() =>
        Assert.Equal(12, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Data-state matrix ---------------------------------------------------------

    [Fact]
    public void Loading_model_is_the_loading_state()
    {
        var display = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(ChargingHeatmapSnapshot.Empty, true, null), Localizer, Utc);

        Assert.Equal(ChargingHeatmapState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void Empty_snapshot_is_the_empty_state_with_zeroed_content()
    {
        var display = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(ChargingHeatmapSnapshot.Empty, false, null), Localizer, Utc);

        Assert.Equal(ChargingHeatmapState.Empty, display.State);
        Assert.True(display.ShowContent); // web parity: the layout renders with zeros, not a blank gate.
        Assert.Equal("0", display.TotalSessionsValue);
        Assert.False(display.HasFavorite);
        Assert.False(display.HasLocationData);
        Assert.Equal(0, display.MaxCount);
        Assert.Equal(7, display.Rows.Count);
        Assert.All(display.Rows, row => Assert.Equal(24, row.Cells.Count));
        Assert.Equal(24, display.HourLabels.Count);
    }

    [Fact]
    public void Populated_snapshot_is_the_success_state()
    {
        var display = ChargingHeatmapProjection.Project(SuccessModel(), Localizer, Utc);

        Assert.Equal(ChargingHeatmapState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.True(display.HasFavorite);
        Assert.Equal(5, display.LegendSwatches.Count);
    }

    [Fact]
    public void Error_detail_is_the_error_state()
    {
        var display = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(ChargingHeatmapSnapshot.Empty, false, "boom"), Localizer, Utc);

        Assert.Equal(ChargingHeatmapState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Equal("boom", display.ErrorText);
    }

    // ---- heatColor buckets (web heatColor) -----------------------------------------

    [Theory]
    [InlineData(0, 5, 0, 240, 255, 0.04)]    // no sessions → empty wash
    [InlineData(5, 0, 0, 240, 255, 0.04)]    // empty grid → empty wash
    [InlineData(1, 100, 0, 240, 255, 0.15)]  // ratio 0.01 < 0.25
    [InlineData(30, 100, 16, 185, 129, 0.4)] // ratio 0.30 < 0.5
    [InlineData(60, 100, 245, 158, 11, 0.55)] // ratio 0.60 < 0.75
    [InlineData(80, 100, 239, 68, 68, 0.75)]  // ratio 0.80 >= 0.75
    public void HeatColor_buckets_match_the_web_ladder(int count, int max, int r, int g, int b, double alpha)
    {
        var color = ChargingHeatColor.ForCount(count, max);

        Assert.Equal((byte)r, color.R);
        Assert.Equal((byte)g, color.G);
        Assert.Equal((byte)b, color.B);
        Assert.Equal(alpha, color.Alpha, 3);
    }

    [Fact]
    public void Legend_has_the_five_web_bucket_colors() =>
        Assert.Equal(5, ChargingHeatColor.Legend.Count);

    // ---- buildGrid (web buildGrid) -------------------------------------------------

    [Fact]
    public void Grid_bins_sessions_by_day_and_hour_and_tracks_the_busiest_cell()
    {
        // Three sessions on Mon 2026-06-01 10:00Z, one on Tue 2026-06-02 14:00Z.
        var monday = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero);
        var tuesday = new DateTimeOffset(2026, 6, 2, 14, 0, 0, TimeSpan.Zero);
        var sessions = new List<ChargingHeatmapSession>
        {
            SessionAt(1, monday, 10000),
            SessionAt(2, monday, 10000),
            SessionAt(3, monday, 10000),
            SessionAt(4, tuesday, 8000),
        };

        var grid = ChargingHeatmapGrid.Build(sessions, Utc);

        Assert.Equal(3, grid.MaxCount);
        Assert.Equal((int)monday.UtcDateTime.DayOfWeek, grid.FavoriteDay);
        Assert.Equal(10, grid.FavoriteHour);
        Assert.Equal(3, grid.Cells[(int)monday.UtcDateTime.DayOfWeek][10].Count);
        Assert.Equal(1, grid.Cells[(int)tuesday.UtcDateTime.DayOfWeek][14].Count);
    }

    [Fact]
    public void Grid_skips_sessions_with_no_start_instant()
    {
        var grid = ChargingHeatmapGrid.Build(
            new[] { new ChargingHeatmapSession(1, null, null, 1000, 1, null) }, Utc);

        Assert.Equal(0, grid.MaxCount);
    }

    [Fact]
    public void Favorite_line_reflects_the_busiest_cell()
    {
        var monday = new DateTimeOffset(2026, 6, 1, 9, 0, 0, TimeSpan.Zero);
        var snapshot = new ChargingHeatmapSnapshot(new[] { SessionAt(1, monday, 5000), SessionAt(2, monday, 5000) });

        var display = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(snapshot, false, null), Localizer, Utc);

        Assert.True(display.HasFavorite);
        Assert.Contains("09:00", display.FavoriteMain, StringComparison.Ordinal);
        Assert.Contains("2", display.FavoriteCount, StringComparison.Ordinal);
    }

    // ---- stats (count / energy / cost / durationMinutes) ---------------------------

    [Fact]
    public void Stats_reduce_count_energy_cost_and_average_duration()
    {
        var start = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero);
        var sessions = new List<ChargingHeatmapSession>
        {
            new(1, start, start.AddMinutes(30), 50000, 10, "Home"),
            new(2, start, start.AddMinutes(90), 30000, 5, "Home"),
        };

        var stats = ChargingHeatmapStats.From(sessions);

        Assert.Equal(2, stats.Count);
        Assert.Equal(80, stats.TotalEnergyKwh, 3);       // (50000 + 30000) Wh → 80 kWh
        Assert.Equal(15, stats.TotalCost, 3);
        Assert.Equal(60, stats.AvgDurationMinutes, 3);   // (30 + 90) / 2
    }

    [Theory]
    [InlineData(0, true, 0)]      // zero span
    [InlineData(45, true, 45)]    // 45-minute span
    [InlineData(45, false, 0)]    // no end instant → 0
    public void DurationMinutes_matches_the_web_helper(int spanMinutes, bool hasEnd, double expected)
    {
        var start = new DateTimeOffset(2026, 6, 1, 8, 0, 0, TimeSpan.Zero);
        DateTimeOffset? end = hasEnd ? start.AddMinutes(spanMinutes) : null;

        Assert.Equal(expected, ChargingHeatmapStats.DurationMinutes(start, end), 3);
    }

    [Fact]
    public void Stats_treat_missing_energy_and_cost_as_zero()
    {
        var start = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero);
        var stats = ChargingHeatmapStats.From(new[] { new ChargingHeatmapSession(1, start, null, null, null, null) });

        Assert.Equal(0, stats.TotalEnergyKwh, 3);
        Assert.Equal(0, stats.TotalCost, 3);
    }

    // ---- top locations (web locationData) ------------------------------------------

    [Fact]
    public void Locations_filter_under_two_then_rank_and_cap()
    {
        var start = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero);
        var sessions = new List<ChargingHeatmapSession>
        {
            SessionAtPlace(1, start, "Home"),
            SessionAtPlace(2, start, "Home"),
            SessionAtPlace(3, start, "Home"),
            SessionAtPlace(4, start, "Work"),
            SessionAtPlace(5, start, "Work"),
            SessionAtPlace(6, start, "Mall"), // single visit — filtered out (< 2)
        };

        var display = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(new ChargingHeatmapSnapshot(sessions), false, null), Localizer, Utc);

        Assert.True(display.HasLocationData);
        Assert.Equal(2, display.Locations.Count);
        Assert.Equal("Home", display.Locations[0].Name);
        Assert.Equal(3, display.Locations[0].Count);
        Assert.Equal("Work", display.Locations[1].Name);
        var series = Assert.Single(display.LocationSeries);
        Assert.Equal(2, series.Points.Count);
    }

    [Fact]
    public void Locations_empty_when_no_place_repeats_twice()
    {
        var start = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero);
        var display = ChargingHeatmapProjection.Project(
            new ChargingHeatmapModel(
                new ChargingHeatmapSnapshot(new[] { SessionAtPlace(1, start, "Home"), SessionAtPlace(2, start, "Work") }),
                false,
                null),
            Localizer,
            Utc);

        Assert.False(display.HasLocationData);
        Assert.Empty(display.LocationSeries);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_sessions_into_the_success_state()
    {
        var feed = new FakeChargingHeatmapFeed(SampleSnapshot());
        using var vm = new ChargingHeatmapPageViewModel(feed, Localizer, () => Now, Utc);

        await vm.LoadAsync();

        Assert.Equal(ChargingHeatmapState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_feed_is_the_empty_state()
    {
        using var vm = new ChargingHeatmapPageViewModel(EmptyChargingHeatmapFeed.Instance, Localizer, () => Now, Utc);

        await vm.LoadAsync();

        Assert.Equal(ChargingHeatmapState.Empty, vm.State);
        Assert.True(vm.Display.ShowContent);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new ChargingHeatmapPageViewModel(new ThrowingChargingHeatmapFeed(), Localizer, () => Now, Utc);

        await vm.LoadAsync();

        Assert.Equal(ChargingHeatmapState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeChargingHeatmapFeed(SampleSnapshot());
        using var vm = new ChargingHeatmapPageViewModel(feed, Localizer, () => Now, Utc);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web useChargingSessionsPaginated) ------------------

    [Fact]
    public async Task ClientFeed_sends_the_sessions_operation_with_the_vehicle_id_and_limit()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[{\"id\":3,\"started_at\":\"2026-06-01T10:00:00Z\",\"total_energy_added_wh\":8000}]"));
        var feed = new ChargingHeatmapClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_charging_sessions", request.OperationId);
        Assert.Equal("7", request.Query!["vehicle_id"]?.ToString());
        Assert.Equal("2000", request.Query!["limit"]?.ToString());
    }

    // ---- Fixtures ------------------------------------------------------------------

    private static ChargingHeatmapModel SuccessModel() => new(SampleSnapshot(), false, null);

    private static ChargingHeatmapSnapshot SampleSnapshot()
    {
        var start = new DateTimeOffset(2026, 6, 1, 10, 0, 0, TimeSpan.Zero);
        return new ChargingHeatmapSnapshot(new[]
        {
            new ChargingHeatmapSession(1, start, start.AddMinutes(45), 50000, 12.5, "Home"),
            new ChargingHeatmapSession(2, start, start.AddMinutes(30), 30000, 8.0, "Home"),
        });
    }

    private static ChargingHeatmapSession SessionAt(long id, DateTimeOffset started, double energyWh) =>
        new(id, started, started.AddMinutes(30), energyWh, 5, "Home");

    private static ChargingHeatmapSession SessionAtPlace(long id, DateTimeOffset started, string place) =>
        new(id, started, started.AddMinutes(30), 5000, 5, place);

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
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

    private sealed class FakeChargingHeatmapFeed(ChargingHeatmapSnapshot snapshot) : IChargingHeatmapFeed
    {
        public int FetchCount { get; private set; }

        public Task<ChargingHeatmapSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingChargingHeatmapFeed : IChargingHeatmapFeed
    {
        public Task<ChargingHeatmapSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
