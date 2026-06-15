using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.Diagnostics;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>AnomalyDashboardPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/diagnostics/pages/AnomalyDashboardPage.tsx) with its loading / empty / error / success
/// matrix, the tolerant anomaly + health-summary parser, the ported <c>severityVariant</c> / <c>typeLabel</c> /
/// <c>signalFrequency</c> helpers, the fifteen manifest i18n keys, the view-model state matrix, and the
/// generated-client feed's request shaping (web <c>useAnomalies</c>). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="AnomalyDashboardDisplay"/> flags
/// asserted here.
/// </summary>
public sealed class AnomalyDashboardPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;

    // The fifteen i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "anomaly.baseline",
        "anomaly.categories",
        "anomaly.count",
        "anomaly.frequency",
        "anomaly.healthSummary",
        "anomaly.last24h",
        "anomaly.last7d",
        "anomaly.monitored",
        "anomaly.noAnomalies",
        "anomaly.noFrequency",
        "anomaly.noHealth",
        "anomaly.subtitle",
        "anomaly.timeline",
        "anomaly.title",
        "anomaly.value",
    ];

    private static AnomalyEntryModel SampleAnomaly(
        string signal = "battery_level",
        string type = "z_score",
        string severity = "warning",
        double value = 12.5,
        double baseline = 10,
        double zScore = 2.4,
        string detectedAt = "2026-06-01T12:00:00Z",
        string message = "Reading drifted from baseline") =>
        new(signal, type, severity, value, baseline, zScore, detectedAt, message);

    private static AnomalySnapshot SampleSnapshot(
        IReadOnlyList<AnomalyEntryModel>? anomalies = null,
        IReadOnlyList<AnomalyHealthEntry>? health = null,
        int signalsMonitored = 42,
        int last7d = 5,
        int last24h = 2) =>
        new(
            anomalies ?? [SampleAnomaly()],
            health ?? [new AnomalyHealthEntry("battery", "info"), new AnomalyHealthEntry("tires", "warning")],
            signalsMonitored,
            last7d,
            last24h);

    private static AnomalyDashboardModel SuccessModel(AnomalySnapshot? snapshot = null) =>
        new(snapshot ?? SampleSnapshot(), false, null);

    private static AnomalyDashboardDisplay Project(AnomalyDashboardModel model, UnitPref? units = null) =>
        AnomalyDashboardProjection.Project(model, units ?? UnitPref.Metric, Localizer);

    // ---- i18n key coverage (all 15 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();
        AnomalyDashboardProjection.Project(SuccessModel(), UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();
        AnomalyDashboardProjection.Project(AnomalyDashboardModel.Initial, UnitPref.Metric, recorder);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_fifteen_unique_keys() =>
        Assert.Equal(15, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- State matrix (loading / empty / error / success) --------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(AnomalyDashboardModel.Initial);

        Assert.Equal(AnomalyDashboardState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_telemetry()
    {
        var model = new AnomalyDashboardModel(AnomalySnapshot.Empty, false, null);

        var display = Project(model);

        Assert.Equal(AnomalyDashboardState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal("No data available", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = new AnomalyDashboardModel(AnomalySnapshot.Empty, false, "network down");

        var display = Project(model);

        Assert.Equal(AnomalyDashboardState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_data_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(AnomalyDashboardState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void State_success_when_only_signal_coverage_present()
    {
        var snapshot = SampleSnapshot(anomalies: [], health: [], signalsMonitored: 17, last7d: 0, last24h: 0);

        var display = Project(SuccessModel(snapshot));

        Assert.Equal(AnomalyDashboardState.Success, display.State);
        Assert.Equal(17, display.SummaryStats[0].Value);
    }

    // ---- Summary tiles (Signals-Monitored / Anomalies-7d / Anomalies-24h / Health-Categories) ----

    [Fact]
    public void Summary_projects_four_tiles_in_web_order()
    {
        var snapshot = SampleSnapshot(signalsMonitored: 42, last7d: 5, last24h: 2);

        var display = Project(SuccessModel(snapshot));

        Assert.Equal(4, display.SummaryStats.Count);
        Assert.Equal("Signals Monitored", display.SummaryStats[0].Label);
        Assert.Equal(42, display.SummaryStats[0].Value);
        Assert.Equal("Anomalies (7d)", display.SummaryStats[1].Label);
        Assert.Equal(5, display.SummaryStats[1].Value);
        Assert.Equal("Anomalies (24h)", display.SummaryStats[2].Label);
        Assert.Equal(2, display.SummaryStats[2].Value);
        Assert.Equal("Health Categories", display.SummaryStats[3].Label);
        Assert.Equal(2, display.SummaryStats[3].Value); // two health entries
    }

    // ---- Health summary cards (GlassPanel5) ----------------------------------------

    [Fact]
    public void HealthCards_project_one_per_entry_with_severity_mapping()
    {
        var snapshot = SampleSnapshot(health:
        [
            new AnomalyHealthEntry("battery", "info"),
            new AnomalyHealthEntry("motors", "warning"),
            new AnomalyHealthEntry("hvac", "critical"),
        ]);

        var display = Project(SuccessModel(snapshot));

        Assert.Equal(3, display.HealthCards.Count);
        Assert.Equal("battery", display.HealthCards[0].Category);
        Assert.Equal(StatusKind.Success, display.HealthCards[0].StatusKind); // info -> success
        Assert.Equal(StatusKind.Warning, display.HealthCards[1].StatusKind);
        Assert.Equal(StatusKind.Danger, display.HealthCards[2].StatusKind);  // critical -> danger
    }

    // ---- Anomaly timeline (GlassPanel6) --------------------------------------------

    [Fact]
    public void Timeline_projects_rows_with_type_label_value_and_baseline()
    {
        var snapshot = SampleSnapshot(anomalies:
        [
            SampleAnomaly(signal: "tpms_fl", type: "range", severity: "critical", value: 1.5, baseline: 2.5, zScore: 0),
        ]);

        var display = Project(SuccessModel(snapshot));

        Assert.Single(display.TimelineRows);
        var row = display.TimelineRows[0];
        Assert.Equal("tpms_fl", row.Signal);
        Assert.Equal("Range", row.TypeLabel);              // range -> Range
        Assert.Equal(StatusKind.Danger, row.SeverityStatus);
        Assert.False(row.ShowZScore);                       // z_score == 0 hides the sigma chip
        Assert.Contains("Value", row.ValueText, StringComparison.Ordinal);
        Assert.Contains("1.50", row.ValueText, StringComparison.Ordinal);
        Assert.Contains("Baseline", row.BaselineText, StringComparison.Ordinal);
        Assert.Contains("2.50", row.BaselineText, StringComparison.Ordinal);
        Assert.NotNull(row.DetectedAt);
    }

    [Fact]
    public void Timeline_shows_sigma_when_z_score_positive()
    {
        var snapshot = SampleSnapshot(anomalies: [SampleAnomaly(zScore: 2.4)]);

        var row = Project(SuccessModel(snapshot)).TimelineRows[0];

        Assert.True(row.ShowZScore);
        Assert.Contains("2.4", row.ZScoreText, StringComparison.Ordinal);
        Assert.Contains("\u03C3", row.ZScoreText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData("critical", StatusKind.Danger)]
    [InlineData("warning", StatusKind.Warning)]
    [InlineData("info", StatusKind.Success)]
    [InlineData("anything-else", StatusKind.Success)]
    public void SeverityStatus_follows_the_web_variant_bands(string severity, StatusKind expected) =>
        Assert.Equal(expected, AnomalyDashboardProjection.SeverityStatus(severity));

    [Theory]
    [InlineData("z_score", "Statistical")]
    [InlineData("range", "Range")]
    [InlineData("trend", "Trend")]
    [InlineData("custom", "custom")]
    public void TypeLabel_follows_the_web_mapping(string type, string expected) =>
        Assert.Equal(expected, AnomalyDashboardProjection.TypeLabel(type));

    // ---- Anomaly frequency bar chart (GlassPanel7) ---------------------------------

    [Fact]
    public void Frequency_aggregates_sorts_descending_limits_to_ten_and_builds_one_bar_series()
    {
        var anomalies = new List<AnomalyEntryModel>();
        for (int i = 0; i < 12; i++)
        {
            // signal_i appears (i + 1) times → counts 1..12, descending sort puts the largest first.
            for (int n = 0; n <= i; n++)
            {
                anomalies.Add(SampleAnomaly(signal: $"signal_{i}"));
            }
        }

        var display = Project(SuccessModel(SampleSnapshot(anomalies: anomalies)));
        var frequency = display.Frequency;

        Assert.True(frequency.HasData);
        Assert.Equal(10, frequency.Rows.Count);              // .slice(0, 10)
        Assert.Equal("signal_11", frequency.Rows[0].Signal);  // highest count first
        Assert.Equal(12, frequency.Rows[0].Count);
        Assert.True(frequency.Rows[0].Count >= frequency.Rows[1].Count);
        Assert.Single(frequency.Series);
        Assert.Equal(ChartSeriesKind.Bar, frequency.Series[0].Kind);
        Assert.Equal("Anomalies", frequency.Series[0].Name);
        Assert.Equal(10, frequency.Series[0].Points.Count);
    }

    [Fact]
    public void Frequency_is_empty_when_no_anomalies()
    {
        var snapshot = SampleSnapshot(anomalies: []);

        var frequency = Project(SuccessModel(snapshot)).Frequency;

        Assert.False(frequency.HasData);
        Assert.Empty(frequency.Series);
        Assert.Equal("Anomaly frequency data will appear after detection runs.", frequency.EmptyMessage);
    }

    // ---- Tolerant parser -----------------------------------------------------------

    [Fact]
    public void Snapshot_parses_anomalies_health_and_counts_from_snake_case()
    {
        var json = Json(
            "{\"anomalies\":[{\"signal\":\"battery_level\",\"type\":\"z_score\",\"severity\":\"warning\"," +
            "\"value\":12.5,\"baseline\":10,\"z_score\":2.4,\"detected_at\":\"2026-06-01T12:00:00Z\"," +
            "\"message\":\"drift\"}]," +
            "\"health_summary\":{\"battery\":\"info\",\"tires\":\"warning\"}," +
            "\"signals_monitored\":42,\"anomalies_last_7d\":5,\"anomalies_last_24h\":2}");

        var snapshot = AnomalySnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        Assert.Single(snapshot.Anomalies);
        Assert.Equal("battery_level", snapshot.Anomalies[0].Signal);
        Assert.Equal(2.4, snapshot.Anomalies[0].ZScore);
        Assert.Equal(2, snapshot.Health.Count);
        Assert.Equal("battery", snapshot.Health[0].Category);
        Assert.Equal("info", snapshot.Health[0].Status);
        Assert.Equal(42, snapshot.SignalsMonitored);
        Assert.Equal(5, snapshot.AnomaliesLast7d);
        Assert.Equal(2, snapshot.AnomaliesLast24h);
    }

    [Fact]
    public void Snapshot_tolerates_camel_case_aliases()
    {
        var json = Json(
            "{\"anomalies\":[{\"signal\":\"s\",\"type\":\"trend\",\"severity\":\"info\"," +
            "\"zScore\":1.1,\"detectedAt\":\"2026-06-01T00:00:00Z\"}]," +
            "\"healthSummary\":{\"motors\":\"info\"}," +
            "\"signalsMonitored\":3,\"anomaliesLast7d\":1,\"anomaliesLast24h\":0}");

        var snapshot = AnomalySnapshot.FromJson(json);

        Assert.True(snapshot.HasData);
        Assert.Equal(1.1, snapshot.Anomalies[0].ZScore);
        Assert.Equal("2026-06-01T00:00:00Z", snapshot.Anomalies[0].DetectedAt);
        Assert.Single(snapshot.Health);
        Assert.Equal(3, snapshot.SignalsMonitored);
    }

    [Fact]
    public void Snapshot_is_empty_for_non_object_or_empty_payload()
    {
        Assert.False(AnomalySnapshot.FromJson(Json("null")).HasData);
        Assert.False(AnomalySnapshot.FromJson(Json("[]")).HasData);
        Assert.False(AnomalySnapshot.FromJson(Json("{\"anomalies\":[],\"health_summary\":{},\"signals_monitored\":0}")).HasData);
    }

    // ---- Generated-client feed (web useAnomalies) ----------------------------------

    [Fact]
    public async Task ClientFeed_requests_anomalies_scoped_to_the_vehicle_with_default_window()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"anomalies\":[],\"signals_monitored\":1}"));
        var feed = new AnomaliesClientFeed(api, vehicleId: 7);

        await feed.FetchAsync(default);

        Assert.Equal("get_api_v1_analytics_anomalies", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("7", api.Requests[0].Query!["days"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_uses_the_supplied_lookback_window()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"anomalies\":[]}"));
        var feed = new AnomaliesClientFeed(api, vehicleId: 5, days: 30);

        await feed.FetchAsync(default);

        Assert.Equal("30", api.Requests[0].Query!["days"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new AnomaliesClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_success_from_the_feed()
    {
        var vm = new AnomalyDashboardPageViewModel(new FakeFeed(SampleSnapshot()), Localizer);

        await vm.LoadAsync();

        Assert.Equal(AnomalyDashboardState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsError);
        Assert.NotNull(vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_empty_state_for_an_empty_payload()
    {
        var vm = new AnomalyDashboardPageViewModel(new FakeFeed(AnomalySnapshot.Empty), Localizer);

        await vm.LoadAsync();

        Assert.Equal(AnomalyDashboardState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_surfaces_the_error_state_on_feed_failure()
    {
        var vm = new AnomalyDashboardPageViewModel(new ThrowingFeed(), Localizer);

        await vm.LoadAsync();

        Assert.Equal(AnomalyDashboardState.Error, vm.State);
        Assert.True(vm.IsError);
        Assert.True(vm.Display.ShowError);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new AnomalyDashboardDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=AnomalyDashboardPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("AnomalyDashboard", AnomalyDashboardRegistration.RouteName);
        Assert.Equal("analytics/anomalies", AnomalyDashboardRegistration.Route);
        Assert.Equal("get_api_v1_analytics_anomalies", AnomalyDashboardRegistration.AnomaliesOperation);
        Assert.Equal("Anomaly Detection", AnomalyDashboardRegistration.Title(Localizer));
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

    private sealed class FakeFeed(AnomalySnapshot snapshot) : IAnomaliesFeed
    {
        public int FetchCount { get; private set; }

        public Task<AnomalySnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingFeed : IAnomaliesFeed
    {
        public Task<AnomalySnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
