using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Battery;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>VampireDrainPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/battery/pages/VampireDrainPage.tsx) with its loading / empty / error / success matrix, the
/// tolerant single-source parser (the nested <c>entries</c> / <c>daily</c> arrays plus the four summary
/// scalars), the percent / hours / kWh formatting at the display boundary, the four summary metric cards, the
/// drain-score gauge, the drain-rate-trend line series, the daily-drain bar series, the date-sorted sessions
/// table and the four tips, the thirty manifest i18n keys, the view-model state matrix, and the generated-client
/// feed's request shaping (web <c>request('/vampire-drain/stats')</c>). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="VampireDrainDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class VampireDrainPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The thirty i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "Vampire Drain",
        "vampire.title",
        "Analyze phantom energy loss while your vehicle is parked",
        "Avg Drain Rate",
        "Total Phantom Loss",
        "Worst Session",
        "Drain Score",
        "Score",
        "Drain Rate Trend",
        "Drain Rate",
        "Daily Drain While Parked",
        "Drain %",
        "Parked Hours",
        "Drain Sessions",
        "sessions",
        "Date",
        "Duration",
        "Start %",
        "End %",
        "Loss %",
        "Rate %/hr",
        "Sentry",
        "On",
        "Off",
        "No drain sessions recorded yet.",
        "Tips to Reduce Vampire Drain",
        "Disable Sentry Mode when parked at home to save 1\u20132 % per day.",
        "Reduce third-party app polling intervals to let the car sleep faster.",
        "Avoid opening the app frequently \u2014 each wake cycle costs battery.",
        "Enable energy-saving mode in vehicle settings for better standby.",
    ];

    // A deterministic stats body: two sessions (one with Sentry on) and two daily buckets with hand-set totals.
    private const string SampleJson = """
    {
      "avg_drain_rate": 1.25,
      "total_energy_lost": 3.4,
      "worst_drain_pct": 6.2,
      "drain_score": 82,
      "entries": [
        {"id":1,"date":"2026-01-10T08:00:00Z","start_battery":80,"end_battery":78,"drain_pct":2.0,"drain_rate_pct_hr":0.5,"duration_hours":4.0,"energy_lost_kwh":1.4,"sentry_active":true},
        {"id":2,"date":"2026-01-12T08:00:00Z","start_battery":70,"end_battery":62,"drain_pct":8.0,"drain_rate_pct_hr":1.0,"duration_hours":8.0,"energy_lost_kwh":5.6,"sentry_active":false}
      ],
      "daily": [
        {"date":"2026-01-10T00:00:00Z","drain_pct":2.0,"hours_parked":12.0},
        {"date":"2026-01-12T00:00:00Z","drain_pct":8.0,"hours_parked":20.0}
      ]
    }
    """;

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private static VampireDrainStats SampleStats() => VampireDrainStats.FromJson(Json(SampleJson))!;

    private static VampireDrainPageModel SuccessModel() =>
        new(VampireDrainSnapshot.Compose(SampleStats()), Loading: false, ErrorDetail: null);

    private static VampireDrainDisplay Project(VampireDrainPageModel model) =>
        VampireDrainProjection.Project(model, Localizer, Now);

    // ---- Parsing: scalars, nested arrays, tolerance --------------------------------

    [Fact]
    public void Stats_FromJson_parses_scalars_and_nested_arrays()
    {
        var stats = SampleStats();

        Assert.Equal(1.25, stats.AvgDrainRate);
        Assert.Equal(3.4, stats.TotalEnergyLost);
        Assert.Equal(6.2, stats.WorstDrainPct);
        Assert.Equal(82, stats.DrainScore);
        Assert.Equal(2, stats.Entries.Count);
        Assert.Equal(2, stats.Daily.Count);
        Assert.True(stats.Entries[0].SentryActive);
        Assert.Equal(8.0, stats.Entries[1].DrainPct);
        Assert.Equal(20.0, stats.Daily[1].HoursParked);
    }

    [Fact]
    public void Stats_FromJson_returns_null_for_non_object()
    {
        Assert.Null(VampireDrainStats.FromJson(Json("[]")));
        Assert.Null(VampireDrainStats.FromJson(Json("3")));
        Assert.Null(VampireDrainStats.FromJson(Json("null")));
    }

    [Fact]
    public void Stats_FromJson_defaults_missing_scalars_to_zero_for_the_backend_shape()
    {
        // The live /vampire-drain/stats handler returns a different rollup shape (event_count, …); the page
        // tolerates it exactly as the web does — the object parses, the page-specific fields read as zero and
        // the nested arrays are empty, so the surface renders Success with zeroed cards and empty charts.
        var stats = VampireDrainStats.FromJson(Json(
            "{\"event_count\":5,\"total_observed_hours\":120,\"avg_drain_pct_per_day\":1.2,\"sample_window_days\":90}"));

        Assert.NotNull(stats);
        Assert.Equal(0, stats!.AvgDrainRate);
        Assert.Equal(0, stats.DrainScore);
        Assert.Empty(stats.Entries);
        Assert.Empty(stats.Daily);
    }

    [Fact]
    public void Entry_FromJson_tolerates_camelCase_and_string_numbers()
    {
        var entry = VampireSessionEntry.FromJson(Json(
            "{\"id\":\"9\",\"date\":\"2026-02-01T00:00:00Z\",\"startBattery\":\"90\",\"drainPct\":3.5,\"sentryActive\":\"true\"}"));

        Assert.Equal(9, entry.Id);
        Assert.Equal(90, entry.StartBattery);
        Assert.Equal(3.5, entry.DrainPct);
        Assert.True(entry.SentryActive);
        Assert.NotNull(entry.Date);
    }

    [Fact]
    public void Daily_FromJson_parses_point()
    {
        var point = VampireDailyDrainPoint.FromJson(Json("{\"date\":\"2026-02-01T00:00:00Z\",\"drain_pct\":4.0,\"hours_parked\":18}"));

        Assert.Equal(4.0, point.DrainPct);
        Assert.Equal(18, point.HoursParked);
    }

    [Fact]
    public void Snapshot_Compose_null_is_empty_and_present_has_data()
    {
        Assert.False(VampireDrainSnapshot.Compose(null).HasData);
        Assert.True(VampireDrainSnapshot.Compose(SampleStats()).HasData);
    }

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(VampireDrainPageModel.Initial);

        Assert.Equal(VampireDrainPageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var display = Project(new VampireDrainPageModel(VampireDrainSnapshot.Empty, Loading: false, ErrorDetail: "boom"));

        Assert.Equal(VampireDrainPageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.Contains("boom", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_empty_when_no_stats_object()
    {
        var display = Project(new VampireDrainPageModel(VampireDrainSnapshot.Empty, Loading: false, ErrorDetail: null));

        Assert.Equal(VampireDrainPageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.Equal("No drain sessions recorded yet.", display.EmptyMessage);
    }

    [Fact]
    public void State_success_when_stats_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(VampireDrainPageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowLoading);
    }

    // ---- Content: cards, gauge, charts, table, tips --------------------------------

    [Fact]
    public void Success_builds_four_metric_cards_with_formatted_values()
    {
        var cards = Project(SuccessModel()).MetricCards;

        Assert.Equal(4, cards.Count);
        Assert.Equal("Avg Drain Rate", cards[0].Label);
        Assert.Equal("1.25%/hr", cards[0].Value);
        Assert.Equal("Total Phantom Loss", cards[1].Label);
        Assert.Equal("3.4 kWh", cards[1].Value);
        Assert.Equal("Worst Session", cards[2].Label);
        Assert.Equal("6.2%", cards[2].Value);
        Assert.Equal("Drain Score", cards[3].Label);
        Assert.Equal("82/100", cards[3].Value);
    }

    [Fact]
    public void Success_gauge_uses_rounded_drain_score_out_of_one_hundred()
    {
        var display = Project(SuccessModel());

        Assert.Equal(82, display.GaugeValue);
        Assert.Equal(100, display.GaugeMax);
        Assert.Equal("Score", display.GaugeLabel);
        Assert.Equal("/100", display.GaugeUnit);
    }

    [Fact]
    public void Success_trend_chart_has_one_line_series_from_entries()
    {
        var trend = Project(SuccessModel()).TrendChart;

        Assert.True(trend.Visible);
        Assert.Equal("Drain Rate Trend", trend.Title);
        var series = Assert.Single(trend.Series);
        Assert.Equal("Drain Rate", series.Name);
        Assert.Equal(ChartSeriesKind.Line, series.Kind);
        Assert.Equal(2, series.Points.Count);
        Assert.Equal(0.5, series.Points[0].Y);
        Assert.Equal(1.0, series.Points[1].Y);
    }

    [Fact]
    public void Success_daily_chart_has_two_bar_series()
    {
        var daily = Project(SuccessModel()).DailyChart;

        Assert.True(daily.Visible);
        Assert.Equal("Daily Drain While Parked", daily.Title);
        Assert.Equal(2, daily.Series.Count);
        Assert.Equal("Drain %", daily.Series[0].Name);
        Assert.Equal("Parked Hours", daily.Series[1].Name);
        Assert.All(daily.Series, s => Assert.Equal(ChartSeriesKind.Bar, s.Kind));
        Assert.Equal(8.0, daily.Series[0].Points[1].Y);
        Assert.Equal(20.0, daily.Series[1].Points[1].Y);
    }

    [Fact]
    public void Success_table_rows_are_date_sorted_descending_and_formatted()
    {
        var display = Project(SuccessModel());

        Assert.Equal(7, display.TableColumns.Count);
        Assert.Equal(new[] { "Date", "Duration", "Start %", "End %", "Loss %", "Rate %/hr", "Sentry" }, display.TableColumns);
        Assert.Equal(2, display.TableRows.Count);

        var first = display.TableRows[0];
        Assert.Equal("2", first.Id);
        Assert.Equal("8.0h", first.Duration);
        Assert.Equal("70%", first.StartPct);
        Assert.Equal("62%", first.EndPct);
        Assert.Equal("8.0%", first.LossPct);
        Assert.Equal("1.00", first.Rate);
        Assert.Equal("Off", first.Sentry);

        Assert.Equal("1", display.TableRows[1].Id);
        Assert.Equal("On", display.TableRows[1].Sentry);
    }

    [Fact]
    public void Success_sessions_count_label_and_tips()
    {
        var display = Project(SuccessModel());

        Assert.Equal("2 sessions", display.SessionsCountLabel);
        Assert.Equal("Drain Sessions", display.SessionsTitle);
        Assert.Equal("Tips to Reduce Vampire Drain", display.TipsTitle);
        Assert.Equal(4, display.Tips.Count);
        Assert.All(display.Tips, tip => Assert.False(string.IsNullOrWhiteSpace(tip.Text)));
    }

    [Fact]
    public void Success_with_no_entries_hides_charts_and_empties_the_table()
    {
        var stats = VampireDrainStats.FromJson(Json("{\"drain_score\":50}"))!;
        var display = Project(new VampireDrainPageModel(VampireDrainSnapshot.Compose(stats), Loading: false, ErrorDetail: null));

        Assert.Equal(VampireDrainPageState.Success, display.State);
        Assert.False(display.TrendChart.Visible);
        Assert.False(display.DailyChart.Visible);
        Assert.Empty(display.TableRows);
        Assert.Equal("0 sessions", display.SessionsCountLabel);
        Assert.Equal("50/100", display.MetricCards[3].Value);
    }

    // ---- i18n key coverage ---------------------------------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = VampireDrainProjection.Project(SuccessModel(), recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = VampireDrainProjection.Project(VampireDrainPageModel.Initial, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_thirty_unique_keys() =>
        Assert.Equal(30, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_success_from_the_feed()
    {
        var snapshot = VampireDrainSnapshot.Compose(SampleStats());
        using var vm = new VampireDrainPageViewModel(new FakeVampireFeed(snapshot), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VampireDrainPageState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_when_the_feed_throws()
    {
        using var vm = new VampireDrainPageViewModel(new ThrowingVampireFeed(), Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VampireDrainPageState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowError);
    }

    [Fact]
    public async Task ViewModel_renders_empty_with_the_default_feed()
    {
        using var vm = new VampireDrainPageViewModel(EmptyVampireDrainFeed.Instance, Localizer, () => Now);

        await vm.LoadAsync();

        Assert.Equal(VampireDrainPageState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    // ---- Generated-client feed (web request('/vampire-drain/stats')) ---------------

    [Fact]
    public async Task ClientFeed_sends_the_stats_operation_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json(SampleJson));
        var feed = new VampireDrainClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(82, snapshot.Stats.DrainScore);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_vampire_drain_stats", request.OperationId);
        Assert.Equal("7", request.Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new VampireDrainClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_composes_empty_for_a_non_object_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        var feed = new VampireDrainClientFeed(api, vehicleId: 2);

        var snapshot = await feed.FetchAsync(default);

        Assert.False(snapshot.HasData);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new VampireDrainPageDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=VampireDrainPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("VampireDrain", VampireDrainRegistration.RouteName);
        Assert.Equal("get_api_v1_vampire_drain_stats", VampireDrainRegistration.StatsOperation);
        Assert.Equal("Vampire Drain", VampireDrainRegistration.Title(Localizer));
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

    private sealed class FakeVampireFeed(VampireDrainSnapshot snapshot) : IVampireDrainFeed
    {
        public Task<VampireDrainSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            Task.FromResult(snapshot);
    }

    private sealed class ThrowingVampireFeed : IVampireDrainFeed
    {
        public Task<VampireDrainSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
