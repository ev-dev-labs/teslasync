using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.VehicleSystems;
using TeslaSync.App.Tests.Data;
using Xunit;

namespace TeslaSync.App.Tests.FeatureViews;

/// <summary>
/// Headless verification of the <c>TirePressurePage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/vehicle-systems/pages/TirePressurePage.tsx) with its loading / empty / error / success
/// matrix, the tolerant two-source parsers, the SI-Pascal → display-unit pressure formatting at the boundary,
/// the ported <c>pressureStatus</c> / <c>statusVariant</c> / <c>hasTpmsWarning</c> / summary-stat / chart-data
/// helpers, the nineteen manifest i18n keys, and the generated-client feed's history parsing. The WinUI view is
/// exercised by the app build; its per-region visibility is driven entirely by the
/// <see cref="TirePressureDisplay"/> flags asserted here.
/// </summary>
public sealed class TirePressurePageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // The nineteen i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "Avg Pressure",
        "Current Readings",
        "Hard Warning",
        "Hard Warning Active",
        "History Table",
        "Last Updated",
        "Min Pressure",
        "No History Data",
        "Ok",
        "Pressure History",
        "Soft Warning",
        "Soft Warning Active",
        "Time",
        "Warning Count",
        "Warnings",
        "error.loadFailed",
        "tirePressure.selectVehicle",
        "tirePressure.subtitle",
        "tirePressure.title",
    ];

    private static TirePressureRow Latest(
        double? fl = 280_000,
        double? fr = 285_000,
        double? rl = 290_000,
        double? rr = 295_000,
        string? hard = null,
        string? soft = null) =>
        new(0, null, fl, fr, rl, rr, hard, soft);

    private static TirePressureRow HistoryRow(
        long id = 1,
        string? createdAt = "2026-06-12T08:00:00Z",
        double? fl = 280_000,
        double? fr = 285_000,
        double? rl = 290_000,
        double? rr = 295_000,
        string? hard = null,
        string? soft = null) =>
        new(
            id,
            createdAt is null ? null : DateTimeOffset.Parse(createdAt, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal),
            fl,
            fr,
            rl,
            rr,
            hard,
            soft);

    private static TirePressureModel SuccessModel(
        TirePressureRow? latest = null, IReadOnlyList<TirePressureRow>? history = null) =>
        new(TirePressureSnapshot.Compose(latest ?? Latest(), history ?? [HistoryRow()]), false, null);

    private static TirePressureDisplay Project(TirePressureModel model, UnitPref? units = null) =>
        TirePressureProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 19 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key_in_success()
    {
        var recorder = new RecordingLocalizer();

        _ = TirePressureProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = TirePressureProjection.Project(TirePressureModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_nineteen_unique_keys() =>
        Assert.Equal(19, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(TirePressureModel.Initial);

        Assert.Equal(TirePressurePageState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_latest_and_no_history()
    {
        var model = new TirePressureModel(TirePressureSnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(TirePressurePageState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowLoading);
        Assert.False(display.ShowError);
        Assert.Equal("No History Data", display.EmptyMessage);
    }

    [Fact]
    public void State_error_when_latest_query_failed()
    {
        var model = new TirePressureModel(TirePressureSnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(TirePressurePageState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_latest_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(TirePressurePageState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    [Fact]
    public void State_success_when_only_history_present()
    {
        var model = new TirePressureModel(
            TirePressureSnapshot.Compose(null, [HistoryRow()]), false, null);
        var display = Project(model);

        Assert.Equal(TirePressurePageState.Success, display.State);
        Assert.True(display.ShowContent);
    }

    // ---- Pressure bands (web pressureStatus / statusVariant) -----------------------

    [Theory]
    [InlineData(280_000, TirePressureBand.Normal)]
    [InlineData(230_000, TirePressureBand.Low)]
    [InlineData(380_000, TirePressureBand.High)]
    [InlineData(150_000, TirePressureBand.Critical)]
    [InlineData(420_000, TirePressureBand.Critical)]
    public void Band_follows_the_web_pressure_thresholds(double pa, TirePressureBand expected) =>
        Assert.Equal(expected, TirePressurePageThresholds.Band(pa));

    [Theory]
    [InlineData(TirePressureBand.Normal, StatusKind.Success)]
    [InlineData(TirePressureBand.Low, StatusKind.Warning)]
    [InlineData(TirePressureBand.High, StatusKind.Warning)]
    [InlineData(TirePressureBand.Critical, StatusKind.Danger)]
    public void Variant_maps_band_to_status(TirePressureBand band, StatusKind expected) =>
        Assert.Equal(expected, TirePressurePageThresholds.Variant(band));

    // ---- Four corner gauges (GlassPanel2 / GlassPanel3 + RadialGauge) --------------

    [Fact]
    public void Gauges_project_four_corners_in_web_order()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.Gauges.Count);
        Assert.Equal(new[] { "fl", "fr", "rl", "rr" }, display.Gauges.Select(g => g.Key).ToArray());
        Assert.All(display.Gauges, g => Assert.Equal(500.0, g.GaugeMax)); // 500_000 Pa -> 500 kPa
        Assert.Equal(StatusKind.Success, display.Gauges[0].BadgeStatus);
        Assert.Equal("Normal", display.Gauges[0].BadgeLabel);
    }

    [Fact]
    public void Gauge_null_corner_coerces_to_zero_and_reads_critical()
    {
        var display = Project(SuccessModel(Latest(fl: null)));

        Assert.Equal(0.0, display.Gauges[0].GaugeValue);
        Assert.Equal(StatusKind.Danger, display.Gauges[0].BadgeStatus);
        Assert.Equal("Critical", display.Gauges[0].BadgeLabel);
    }

    // ---- Four summary metric cards -------------------------------------------------

    [Fact]
    public void Summary_cards_project_four_tiles_with_average_min_and_warning_count()
    {
        var display = Project(SuccessModel(Latest(fl: 280_000, fr: 280_000, rl: 280_000, rr: 230_000)));

        Assert.Equal(4, display.SummaryCards.Count);
        Assert.Equal("Avg Pressure", display.SummaryCards[0].Label);
        Assert.Equal("Min Pressure", display.SummaryCards[1].Label);
        Assert.Equal("Warning Count", display.SummaryCards[2].Label);
        Assert.Equal("Last Updated", display.SummaryCards[3].Label);

        // One corner (230 kPa) is below the 250 kPa normal floor -> warning count 1.
        Assert.Equal("1", display.SummaryCards[2].Value);
        Assert.Contains("267.5", display.SummaryCards[0].Value, StringComparison.Ordinal); // (280+280+280+230)/4
        Assert.Contains("230.0", display.SummaryCards[1].Value, StringComparison.Ordinal); // min
    }

    [Fact]
    public void Summary_cards_show_em_dash_when_no_latest()
    {
        var model = new TirePressureModel(TirePressureSnapshot.Compose(null, [HistoryRow()]), false, null);
        var display = Project(model);

        Assert.Equal("\u2014", display.SummaryCards[0].Value);
        Assert.Equal("\u2014", display.SummaryCards[1].Value);
        Assert.Equal("0", display.SummaryCards[2].Value);
    }

    [Fact]
    public void Last_updated_card_uses_the_newest_history_timestamp()
    {
        var history = new[]
        {
            HistoryRow(1, "2026-06-10T08:00:00Z"),
            HistoryRow(2, "2026-06-12T09:30:00Z"),
            HistoryRow(3, "2026-06-11T08:00:00Z"),
        };
        var display = Project(SuccessModel(history: history));

        // The newest row (Jun 12 09:30Z) drives the label — compared via the same formatter so the assertion is
        // timezone-independent.
        string expected = DateTimeFormatting.Format(history[1].CreatedAt, DateTimeVariant.Full, Now);
        Assert.NotEqual("\u2014", display.SummaryCards[3].Value);
        Assert.Equal(expected, display.SummaryCards[3].Value);
    }

    // ---- Pressure-history chart (GlassPanel8 / LineChart) --------------------------

    [Fact]
    public void Chart_projects_four_series_with_web_corner_colours()
    {
        var display = Project(SuccessModel(history: [HistoryRow(1), HistoryRow(2, "2026-06-12T10:00:00Z")]));

        Assert.Equal(4, display.HistoryChart.Series.Count);
        Assert.True(display.HistoryChart.HasData);
        Assert.Equal(new[] { 0, 2, 1, 3 }, display.HistoryChart.Series.Select(s => s.ColorIndex).ToArray());
        Assert.All(display.HistoryChart.Series, s => Assert.Equal(2, s.Points.Count));
    }

    [Fact]
    public void Chart_has_no_data_when_history_empty()
    {
        var display = Project(SuccessModel(history: []));

        Assert.False(display.HistoryChart.HasData);
        Assert.Equal("No History Data", display.HistoryChart.EmptyMessage);
    }

    // ---- Pressure-history table (GlassPanel9) --------------------------------------

    [Fact]
    public void Table_projects_six_columns_and_orders_rows_newest_first()
    {
        var history = new[]
        {
            HistoryRow(1, "2026-06-10T08:00:00Z"),
            HistoryRow(2, "2026-06-12T09:30:00Z"),
        };
        var display = Project(SuccessModel(history: history));

        Assert.Equal(6, display.TableColumns.Count);
        Assert.Equal("Time", display.TableColumns[0]);
        Assert.Contains("kPa", display.TableColumns[1], StringComparison.Ordinal);
        Assert.Equal("Warnings", display.TableColumns[5]);

        Assert.Equal(2, display.TableRows.Count);
        Assert.Equal("2", display.TableRows[0].Id); // newest first
        Assert.Equal("1", display.TableRows[1].Id);
    }

    [Theory]
    [InlineData("{\"fl\":true}", null, "Hard Warning")]
    [InlineData(null, "{\"fl\":true}", "Soft Warning")]
    [InlineData(null, null, "Ok")]
    public void Table_warning_cell_reflects_tpms_blobs(string? hard, string? soft, string expected)
    {
        var display = Project(SuccessModel(history: [HistoryRow(1, hard: hard, soft: soft)]));

        Assert.Equal(expected, display.TableRows[0].Warnings);
    }

    // ---- TPMS warning banner (GlassPanel1) ----------------------------------------

    [Fact]
    public void Warning_banner_hidden_when_no_active_warning()
    {
        var display = Project(SuccessModel());

        Assert.False(display.HasWarning);
    }

    [Fact]
    public void Warning_banner_shows_hard_warning_with_danger_status()
    {
        var display = Project(SuccessModel(Latest(hard: "{\"fl\":true}")));

        Assert.True(display.HasWarning);
        Assert.Equal(StatusKind.Danger, display.WarningStatus);
        Assert.Equal("Hard Warning Active", display.WarningBannerText);
    }

    [Fact]
    public void Warning_banner_shows_soft_warning_with_warning_status()
    {
        var display = Project(SuccessModel(Latest(soft: "{\"rr\":true}")));

        Assert.True(display.HasWarning);
        Assert.Equal(StatusKind.Warning, display.WarningStatus);
        Assert.Equal("Soft Warning Active", display.WarningBannerText);
    }

    [Theory]
    [InlineData("{\"fl\":false,\"fr\":false}", false)]
    [InlineData("{\"fl\":false,\"fr\":true}", true)]
    [InlineData("", false)]
    [InlineData("true", true)]
    [InlineData("false", false)]
    public void HasTpmsWarning_matches_the_web_any_true_heuristic(string? raw, bool expected) =>
        Assert.Equal(expected, TirePressurePageThresholds.HasTpmsWarning(raw));

    // ---- Tolerant parsers ----------------------------------------------------------

    [Fact]
    public void FromJson_parses_snake_case_corners_warnings_and_timestamp()
    {
        using var doc = JsonDocument.Parse(
            "{\"id\":7,\"created_at\":\"2026-06-12T08:00:00Z\",\"front_left\":280000,\"front_right\":285000," +
            "\"rear_left\":290000,\"rear_right\":295000,\"tpms_hard_warnings\":\"{\\\"fl\\\":true}\"}");

        var row = TirePressureRow.FromJson(doc.RootElement);

        Assert.Equal(7, row.Id);
        Assert.Equal(280000, row.FrontLeftPa);
        Assert.Equal(295000, row.RearRightPa);
        Assert.NotNull(row.CreatedAt);
        Assert.True(TirePressurePageThresholds.HasTpmsWarning(row.HardWarnings));
    }

    [Fact]
    public void FromJson_tolerates_a_non_object_payload()
    {
        using var doc = JsonDocument.Parse("[]");

        var row = TirePressureRow.FromJson(doc.RootElement);

        Assert.False(row.HasAnyValue);
    }

    [Fact]
    public void ParseHistory_reads_an_array_of_rows_and_skips_non_objects()
    {
        using var doc = JsonDocument.Parse(
            "[{\"id\":1,\"front_left\":280000},42,{\"id\":2,\"front_left\":290000}]");

        var rows = TirePressureClientFeed.ParseHistory(doc.RootElement);

        Assert.Equal(2, rows.Count);
        Assert.Equal(1, rows[0].Id);
        Assert.Equal(2, rows[1].Id);
    }

    [Fact]
    public void ParseHistory_returns_empty_for_a_non_array_body()
    {
        using var doc = JsonDocument.Parse("{}");

        Assert.Empty(TirePressureClientFeed.ParseHistory(doc.RootElement));
    }

    // ---- Imperial units convert at the display boundary ----------------------------

    [Fact]
    public void Gauge_max_converts_to_psi_under_imperial_units()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);

        // 500 kPa / 6.894757 ≈ 72.5 psi.
        Assert.Equal(72.5, Math.Round(display.Gauges[0].GaugeMax, 1));
        Assert.Equal("psi", display.Gauges[0].GaugeUnit);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_readings_into_the_success_state()
    {
        var feed = new FakeTirePressureFeed(TirePressureSnapshot.Compose(Latest(), [HistoryRow()]));
        using var vm = new TirePressurePageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TirePressurePageState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new TirePressurePageViewModel(EmptyTirePressureFeed.Instance, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TirePressurePageState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new TirePressurePageViewModel(new ThrowingTirePressureFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(TirePressurePageState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeTirePressureFeed(TirePressureSnapshot.Compose(Latest(), [HistoryRow()]));
        using var vm = new TirePressurePageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web latest + history queries) ----------------------

    [Fact]
    public async Task ClientFeed_sends_both_operations_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"front_left\":280000,\"front_right\":285000,\"rear_left\":290000,\"rear_right\":295000}"));
        api.ReturnsValue(Json("[{\"id\":1,\"front_left\":280000,\"created_at\":\"2026-06-12T08:00:00Z\"}]"));
        var feed = new TirePressureClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasLatest);
        Assert.Equal(280000, snapshot.Latest.FrontLeftPa);
        Assert.Single(snapshot.History);
        Assert.Equal(2, api.Requests.Count);
        Assert.Equal("get_api_v1_tire_pressure_latest", api.Requests[0].OperationId);
        Assert.Equal("7", api.Requests[0].Query!["vehicle_id"]?.ToString());
        Assert.Equal("get_api_v1_tire_pressure", api.Requests[1].OperationId);
        Assert.Equal("7", api.Requests[1].Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_latest_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new TirePressureClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_degrades_gracefully_when_only_history_fails()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"front_left\":280000}"));
        api.Throws(new ApiException("history subsystem down", 503));
        var feed = new TirePressureClientFeed(api, vehicleId: 3);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasLatest);
        Assert.Equal(280000, snapshot.Latest.FrontLeftPa);
        Assert.Empty(snapshot.History);
    }

    [Fact]
    public async Task ClientFeed_appends_the_range_to_the_history_query()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{}"));
        api.ReturnsValue(Json("[]"));
        var feed = new TirePressureClientFeed(api, vehicleId: 5, start: "2026-01-01", end: "2026-06-01");

        await feed.FetchAsync(default);

        Assert.Equal("2026-01-01", api.Requests[1].Query!["start"]?.ToString());
        Assert.Equal("2026-06-01", api.Requests[1].Query!["end"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_treats_a_non_object_latest_as_no_snapshot()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("[]"));
        api.ReturnsValue(Json("[]"));
        var feed = new TirePressureClientFeed(api, vehicleId: 9);

        var snapshot = await feed.FetchAsync(default);

        Assert.False(snapshot.HasLatest);
        Assert.False(snapshot.HasData);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new TirePressureDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=TirePressurePage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operations()
    {
        Assert.Equal("TirePressure", TirePressureRegistration.RouteName);
        Assert.Equal("get_api_v1_tire_pressure_latest", TirePressureRegistration.LatestOperation);
        Assert.Equal("get_api_v1_tire_pressure", TirePressureRegistration.HistoryOperation);
        Assert.Equal("Tire Pressure", TirePressureRegistration.Title(Localizer));
    }

    private static JsonElement Json(string raw)
    {
        using var doc = JsonDocument.Parse(raw);
        return doc.RootElement.Clone();
    }

    private sealed class FakeTirePressureFeed(TirePressureSnapshot snapshot) : ITirePressureFeed
    {
        public int FetchCount { get; private set; }

        public Task<TirePressureSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingTirePressureFeed : ITirePressureFeed
    {
        public Task<TirePressureSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }

    /// <summary>An <see cref="ILocalizer"/> that records every requested key while returning the fallback.</summary>
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
