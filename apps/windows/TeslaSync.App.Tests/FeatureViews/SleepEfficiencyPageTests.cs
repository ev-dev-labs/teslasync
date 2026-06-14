using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Battery;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>SleepEfficiencyPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/battery/pages/SleepEfficiencyPage.tsx) with its loading / empty / error / success matrix,
/// the tolerant single-source parser, the four metric cards, the state-distribution donut (web
/// <c>STATE_LABELS</c> / <c>STATE_COLORS</c> / <c>pieData</c>), the sentry-comparison series (web
/// <c>comparisonData</c>), the monthly-impact callout, the recent-drain-events table with its SI temperature
/// conversion at the display boundary, the thirty-two manifest i18n keys, the view-model state matrix, and the
/// generated-client feed's request shaping (web <c>useSleepEfficiency</c>). The WinUI view is exercised by the
/// app build; its per-region visibility is driven entirely by the <see cref="SleepEfficiencyDisplay"/> flags
/// asserted here.
/// </summary>
public sealed class SleepEfficiencyPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 12, 12, 0, 0, TimeSpan.Zero);

    // The thirty-two i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "common.off",
        "common.on",
        "sleep.avgBatteryLost",
        "sleep.avgTimeToSleep",
        "sleep.batteryLost",
        "sleep.date",
        "sleep.drainRate",
        "sleep.drainRateCol",
        "sleep.duration",
        "sleep.efficiency",
        "sleep.extraCostMo",
        "sleep.extraDrainHr",
        "sleep.extraMonthly",
        "sleep.monthlySentryImpact",
        "sleep.noData",
        "sleep.noDrainEvents",
        "sleep.noSentryData",
        "sleep.noStateData",
        "sleep.recentDrainEvents",
        "sleep.selectVehicle",
        "sleep.sentry",
        "sleep.sentryComparison",
        "sleep.sentryComparison.aria",
        "sleep.sentryDrainRate",
        "sleep.sentryMonthlyCost",
        "sleep.sentryOff",
        "sleep.sentryOn",
        "sleep.stateDistribution",
        "sleep.stateDistribution.aria",
        "sleep.subtitle",
        "sleep.temp",
        "sleep.title",
    ];

    private static SleepEfficiencySummary Summary(
        double sleepEfficiencyPct = 92.5,
        double timeToSleepAvgMin = 25,
        double sentryOnDrainRate = 1.8,
        double sentryOffDrainRate = 0.5,
        double sentryMonthlyCost = 12.34,
        double sentryMonthlyKwh = 30,
        double sentryExtraDrainRate = 1.3,
        double sentryExtraMonthlyKwh = 18.5,
        double sentryExtraMonthlyCost = 6.78,
        IReadOnlyList<SleepStateMinutes>? stateDistribution = null,
        IReadOnlyList<SentryComparisonRow>? sentryComparison = null,
        IReadOnlyList<SleepDrainEventRecord>? recentEvents = null) =>
        new(
            sleepEfficiencyPct,
            timeToSleepAvgMin,
            sentryOnDrainRate,
            sentryOffDrainRate,
            sentryMonthlyCost,
            sentryMonthlyKwh,
            sentryExtraDrainRate,
            sentryExtraMonthlyKwh,
            sentryExtraMonthlyCost,
            stateDistribution ?? DefaultStates(),
            sentryComparison ?? DefaultComparison(),
            recentEvents ?? [Event()]);

    private static IReadOnlyList<SleepStateMinutes> DefaultStates() =>
        [new("asleep", 6000), new("online", 1200), new("driving", 600)];

    private static IReadOnlyList<SentryComparisonRow> DefaultComparison() =>
        [new(true, 1.8, 3.2), new(false, 0.5, 0.9)];

    private static SleepDrainEventRecord Event(
        long id = 1,
        string? startDate = "2026-05-10T08:00:00Z",
        double durationHours = 8.5,
        double batteryLost = 2.1,
        double drainRate = 0.25,
        bool sentryMode = false,
        double? outsideTemp = 18.0) =>
        new(
            id,
            startDate is null ? null : DateTimeOffset.Parse(startDate, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            durationHours,
            batteryLost,
            drainRate,
            sentryMode,
            outsideTemp);

    private static SleepEfficiencyModel SuccessModel(SleepEfficiencySummary? summary = null) =>
        new(SleepEfficiencySnapshot.Compose(summary ?? Summary()), false, null);

    private static SleepEfficiencyDisplay Project(SleepEfficiencyModel model, UnitPref? units = null) =>
        SleepEfficiencyProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 32 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = SleepEfficiencyProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = SleepEfficiencyProjection.Project(SleepEfficiencyModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_thirty_two_unique_keys() =>
        Assert.Equal(32, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(SleepEfficiencyModel.Initial);

        Assert.Equal(SleepEfficiencyState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_sleep_object()
    {
        var model = new SleepEfficiencyModel(SleepEfficiencySnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(SleepEfficiencyState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal(
            "No sleep data available. Data will appear after your vehicle records sleep/wake events.",
            display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_sleep_query_failed()
    {
        var model = new SleepEfficiencyModel(SleepEfficiencySnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(SleepEfficiencyState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_sleep_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(SleepEfficiencyState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Metric cards (Sleep-Efficiency / Avg-Time-to-Sleep / Sentry-Drain-Rate / Sentry-Monthly-Cost) ----

    [Fact]
    public void Metric_cards_render_four_tiles_with_web_formats()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.MetricCards.Count);

        Assert.Equal("Sleep Efficiency", display.MetricCards[0].Label);
        Assert.EndsWith("%", display.MetricCards[0].Value, StringComparison.Ordinal);
        Assert.Equal(SleepEfficiencyProjection.MoonGlyph, display.MetricCards[0].Glyph);

        Assert.Equal("Avg Time to Sleep", display.MetricCards[1].Label);
        Assert.EndsWith(" min", display.MetricCards[1].Value, StringComparison.Ordinal);

        Assert.Equal("Sentry Drain Rate", display.MetricCards[2].Label);
        Assert.EndsWith("%/hr", display.MetricCards[2].Value, StringComparison.Ordinal);

        Assert.Equal("Sentry Monthly Cost", display.MetricCards[3].Label);
        Assert.StartsWith("$", display.MetricCards[3].Value, StringComparison.Ordinal);
    }

    // ---- State-Distribution donut --------------------------------------------------

    [Fact]
    public void Donut_maps_state_labels_colors_and_hours()
    {
        var display = Project(SuccessModel());
        var donut = display.Donut;

        Assert.True(donut.HasData);
        Assert.Equal(3, donut.Slices.Count);
        Assert.Equal(3, donut.Points.Count);

        Assert.Equal("Sleeping", donut.Slices[0].Name);
        Assert.Equal(0, donut.Slices[0].ColorIndex);
        Assert.EndsWith("h", donut.Slices[0].HoursText, StringComparison.Ordinal);

        Assert.Equal("Online/Idle", donut.Slices[1].Name);
        Assert.Equal(1, donut.Slices[1].ColorIndex);

        // Web pieData value is rounded minutes (web Math.round(s.total_minutes)).
        Assert.Equal(6000, donut.Points[0].Y);
    }

    [Fact]
    public void Donut_is_empty_when_no_state_distribution()
    {
        var display = Project(SuccessModel(Summary(stateDistribution: [])));

        Assert.False(display.Donut.HasData);
        Assert.Empty(display.Donut.Slices);
        Assert.Equal("No state distribution data available", display.Donut.EmptyMessage);
    }

    [Fact]
    public void Donut_unknown_state_falls_back_to_its_position_label_and_color()
    {
        var display = Project(SuccessModel(Summary(stateDistribution: [new("mystery", 300)])));
        var slice = Assert.Single(display.Donut.Slices);

        Assert.Equal("mystery", slice.Name);
        Assert.Equal(0, slice.ColorIndex);
    }

    // ---- Sentry-vs-No-Sentry comparison --------------------------------------------

    [Fact]
    public void Comparison_builds_two_series_from_the_matching_rows()
    {
        var display = Project(SuccessModel());
        var comparison = display.Comparison;

        Assert.True(comparison.HasData);
        Assert.Equal(2, comparison.Series.Count);
        Assert.Equal(2, comparison.Categories.Count);

        var on = comparison.Series[0];
        Assert.Equal("Sentry On", on.Name);
        Assert.Equal(SleepEfficiencyProjection.SentryOnColorIndex, on.ColorIndex);
        Assert.Equal(1.8, on.Points[0].Y);   // avg_drain_rate (sentry on)
        Assert.Equal(3.2, on.Points[1].Y);   // avg_battery_lost (sentry on)

        var off = comparison.Series[1];
        Assert.Equal("Sentry Off", off.Name);
        Assert.Equal(SleepEfficiencyProjection.SentryOffColorIndex, off.ColorIndex);
        Assert.Equal(0.5, off.Points[0].Y);
        Assert.Equal(0.9, off.Points[1].Y);
    }

    [Fact]
    public void Comparison_is_empty_when_every_value_is_zero()
    {
        var display = Project(SuccessModel(Summary(
            sentryComparison: [new(true, 0, 0), new(false, 0, 0)])));

        Assert.False(display.Comparison.HasData);
        Assert.Equal("No sentry comparison data available", display.Comparison.EmptyMessage);
    }

    // ---- Monthly Sentry Mode Impact callout (GlassPanel7) --------------------------

    [Fact]
    public void Impact_callout_formats_three_stats()
    {
        var display = Project(SuccessModel());

        Assert.Equal("Monthly Sentry Mode Impact", display.ImpactTitle);
        Assert.Equal(3, display.ImpactStats.Count);

        Assert.EndsWith("%", display.ImpactStats[0].Value, StringComparison.Ordinal);
        Assert.Equal("Extra drain/hr", display.ImpactStats[0].Label);

        Assert.EndsWith(" kWh", display.ImpactStats[1].Value, StringComparison.Ordinal);
        Assert.Equal("Extra monthly", display.ImpactStats[1].Label);

        Assert.StartsWith("$", display.ImpactStats[2].Value, StringComparison.Ordinal);
        Assert.Equal("Extra cost/mo", display.ImpactStats[2].Label);
    }

    // ---- Recent drain events table (GlassPanel8) -----------------------------------

    [Fact]
    public void Table_has_the_six_web_columns()
    {
        var display = Project(SuccessModel());

        Assert.Equal(
            new[] { "Date", "Duration", "Battery Lost", "Drain Rate", "Sentry", "Temp" },
            display.TableColumns);
    }

    [Fact]
    public void Table_row_formats_each_field_and_labels_sentry_off()
    {
        var display = Project(SuccessModel(Summary(recentEvents: [Event(sentryMode: false)])));
        var row = Assert.Single(display.TableRows);

        Assert.EndsWith("h", row.Duration, StringComparison.Ordinal);
        Assert.EndsWith("%", row.BatteryLost, StringComparison.Ordinal);
        Assert.EndsWith("%/hr", row.DrainRate, StringComparison.Ordinal);
        Assert.Equal("Off", row.Sentry);
        Assert.EndsWith("\u00B0C", row.Temp, StringComparison.Ordinal);
    }

    [Fact]
    public void Table_row_labels_sentry_on_when_active()
    {
        var display = Project(SuccessModel(Summary(recentEvents: [Event(sentryMode: true)])));
        Assert.Equal("On", Assert.Single(display.TableRows).Sentry);
    }

    [Fact]
    public void Table_temperature_converts_to_the_active_unit_at_the_display_boundary()
    {
        var display = Project(SuccessModel(Summary(recentEvents: [Event(outsideTemp: 18.0)])), UnitPref.Imperial);
        var row = Assert.Single(display.TableRows);

        // 18 °C → 64.4 °F, formatted with the Fahrenheit label at the render boundary.
        Assert.EndsWith("\u00B0F", row.Temp, StringComparison.Ordinal);
        Assert.Contains("64.4", row.Temp, StringComparison.Ordinal);
    }

    [Fact]
    public void Table_temperature_is_an_em_dash_when_absent()
    {
        var display = Project(SuccessModel(Summary(recentEvents: [Event(outsideTemp: null)])));
        Assert.Equal("\u2014", Assert.Single(display.TableRows).Temp);
    }

    [Fact]
    public void Table_is_empty_message_when_no_recent_events()
    {
        var display = Project(SuccessModel(Summary(recentEvents: [])));

        Assert.Empty(display.TableRows);
        Assert.Equal("No drain events recorded yet", display.TableEmptyMessage);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void FromJson_returns_null_for_a_non_object_body() =>
        Assert.Null(SleepEfficiencySummary.FromJson(Json("[]")));

    [Fact]
    public void FromJson_tolerates_a_partial_body_with_zero_defaults()
    {
        var summary = SleepEfficiencySummary.FromJson(Json("{\"sleep_efficiency_pct\":88}"));

        Assert.NotNull(summary);
        Assert.Equal(88, summary!.SleepEfficiencyPct);
        Assert.Equal(0, summary.SentryMonthlyCost);
        Assert.Empty(summary.StateDistribution);
        Assert.Empty(summary.SentryComparison);
        Assert.Empty(summary.RecentEvents);
    }

    [Fact]
    public void FromJson_reads_the_full_snake_case_wire_shape()
    {
        var summary = SleepEfficiencySummary.FromJson(Json(
            "{\"sleep_efficiency_pct\":92.5,\"time_to_sleep_avg_min\":25," +
            "\"sentry_on_drain_rate\":1.8,\"sentry_monthly_cost\":12.34," +
            "\"state_distribution\":[{\"state\":\"asleep\",\"total_minutes\":6000}]," +
            "\"sentry_comparison\":[{\"sentry_mode\":true,\"avg_drain_rate\":1.8,\"avg_battery_lost\":3.2}]," +
            "\"recent_events\":[{\"id\":7,\"start_date\":\"2026-05-10T08:00:00Z\",\"duration_hours\":8.5," +
            "\"battery_lost\":2.1,\"drain_rate\":0.25,\"sentry_mode\":false,\"outside_temp\":18}]}"));

        Assert.NotNull(summary);
        Assert.Equal(92.5, summary!.SleepEfficiencyPct);
        Assert.Equal(25, summary.TimeToSleepAvgMin);
        Assert.Equal("asleep", Assert.Single(summary.StateDistribution).State);
        Assert.True(Assert.Single(summary.SentryComparison).SentryMode);

        var ev = Assert.Single(summary.RecentEvents);
        Assert.Equal(7, ev.Id);
        Assert.Equal(18, ev.OutsideTemp);
        Assert.False(ev.SentryMode);
    }

    [Fact]
    public void FromJson_reads_the_camel_case_alias()
    {
        var summary = SleepEfficiencySummary.FromJson(Json("{\"sleepEfficiencyPct\":77}"));

        Assert.NotNull(summary);
        Assert.Equal(77, summary!.SleepEfficiencyPct);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_sleep_into_the_success_state()
    {
        var feed = new FakeSleepFeed(SleepEfficiencySnapshot.Compose(Summary()));
        using var vm = new SleepEfficiencyPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.Equal(1, feed.FetchCount);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new SleepEfficiencyPageViewModel(EmptySleepEfficiencyFeed.Instance, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new SleepEfficiencyPageViewModel(new ThrowingSleepFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(SleepEfficiencyState.Error, vm.State);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeSleepFeed(SleepEfficiencySnapshot.Compose(Summary()));
        using var vm = new SleepEfficiencyPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed request shaping -------------------------------------

    [Fact]
    public async Task ClientFeed_reads_the_sleep_rollup_for_the_vehicle()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"sleep_efficiency_pct\":91}"));
        var feed = new SleepEfficiencyClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(91, snapshot.Summary.SleepEfficiencyPct);
        Assert.Equal(SleepEfficiencyRegistration.SleepOperation, api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("30", api.Requests[0].Query!["days"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_appends_start_end_only_when_both_are_present()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"sleep_efficiency_pct\":50}"));
        var feed = new SleepEfficiencyClientFeed(api, vehicleId: 5, days: 7, start: "2026-01-01", end: "2026-06-01");

        await feed.FetchAsync(default);

        Assert.Equal("2026-01-01", api.Requests[0].Query!["start"]?.ToString());
        Assert.Equal("2026-06-01", api.Requests[0].Query!["end"]?.ToString());
        Assert.Equal("7", api.Requests[0].Query!["days"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_omits_the_range_when_only_one_bound_is_supplied()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"sleep_efficiency_pct\":50}"));
        var feed = new SleepEfficiencyClientFeed(api, vehicleId: 5, start: "2026-01-01");

        await feed.FetchAsync(default);

        Assert.False(api.Requests[0].Query!.ContainsKey("start"));
        Assert.False(api.Requests[0].Query!.ContainsKey("end"));
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new SleepEfficiencyClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_composes_the_empty_snapshot_for_a_non_object_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        var feed = new SleepEfficiencyClientFeed(api, vehicleId: 1);

        var snapshot = await feed.FetchAsync(default);

        Assert.False(snapshot.HasData);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new SleepEfficiencyDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=SleepEfficiencyPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("SleepEfficiency", SleepEfficiencyRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_sleep", SleepEfficiencyRegistration.SleepOperation);
        Assert.Equal("Sleep Efficiency", SleepEfficiencyRegistration.Title(Localizer));
    }

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

    private sealed class FakeSleepFeed(SleepEfficiencySnapshot snapshot) : ISleepEfficiencyFeed
    {
        public int FetchCount { get; private set; }

        public Task<SleepEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingSleepFeed : ISleepEfficiencyFeed
    {
        public Task<SleepEfficiencySnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
