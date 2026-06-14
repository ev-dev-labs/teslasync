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
/// Headless verification of the <c>BatteryCellsPage</c> surface's Microsoft.UI-free logic — the projection
/// (web/src/features/battery/pages/BatteryCellsPage.tsx), the tolerant single-source parser, the four-state
/// matrix (loading / empty / error / success), the histogram / min-max / spread-trend / health-insight
/// derivations, the SI-volt + user-temperature formatting at the display boundary, and the generated-client
/// feed's request shaping (web <c>useQuery(['battery-cells', …])</c>). The WinUI view is exercised by the app
/// build; its per-region visibility is driven entirely by the <see cref="BatteryCellsDisplay"/> flags asserted
/// here.
/// </summary>
public sealed class BatteryCellsPageTests
{
    private static readonly ILocalizer Localizer = PassthroughLocalizer.Instance;
    private static readonly DateTimeOffset Now = new(2026, 6, 13, 12, 0, 0, TimeSpan.Zero);

    // The 73 i18n keys the manifest requires the page to resolve (web key names, verbatim).
    private static readonly string[] RequiredStringKeys =
    [
        "Avg", "Avg Voltage", "Bar View", "Battery Cells", "Cell", "Cell #", "Cell Count", "Cell Details",
        "Cell Voltage Bar Chart", "Cell Voltage Heatmap", "Cell Voltage Over Time", "Cells",
        "Cells colored by deviation from average", "Delta (mV)", "Grid View", "Imbalance", "Imbalance (mV)",
        "Imbalance Trend", "Individual cell voltage monitoring and analysis", "Max", "Max Cell", "Max Voltage",
        "Min", "Min Cell", "Min Voltage", "No cell details available.", "No cell readings available.",
        "Nominal", "Pack Voltage", "Significant Deviation", "Slight Deviation", "Status", "Total Cells",
        "Voltage", "Voltage (V)", "Voltage Distribution", "Warning", "cells",
        "battery.cells.chart.noSpreadTrend", "battery.cells.chart.spreadTrend",
        "battery.cells.chart.spreadTrend.aria", "battery.cells.chart.voltageSpread",
        "battery.cells.insight.balanced", "battery.cells.insight.balancedDesc",
        "battery.cells.insight.criticalCells", "battery.cells.insight.criticalCellsDesc",
        "battery.cells.insight.goodTemp", "battery.cells.insight.goodTempDesc",
        "battery.cells.insight.healthy", "battery.cells.insight.healthyDesc",
        "battery.cells.insight.highSpread", "battery.cells.insight.highSpreadDesc",
        "battery.cells.insight.highTemp", "battery.cells.insight.highTempDesc",
        "battery.cells.insight.watchSpread", "battery.cells.insight.watchSpreadDesc",
        "battery.cells.insight.watchTemp", "battery.cells.insight.watchTempDesc",
        "battery.cells.noInsights", "battery.cells.recommendations", "battery.cells.stat.avgVoltage",
        "battery.cells.stat.normalCells", "battery.cells.stat.packVoltage", "battery.cells.stat.tempSpread",
        "battery.cells.stat.totalCells", "battery.cells.stat.voltageSpread", "battery.cells.temp.avg",
        "battery.cells.temp.empty", "battery.cells.temp.max", "battery.cells.temp.min",
        "battery.cells.temp.spread", "battery.cells.temp.title", "battery.cells.title",
    ];

    private static CellReadingData Cell(int id, double voltage, double delta, string status) =>
        new(id, voltage, delta, status);

    private static CellHistoryPoint History(string ts, double min, double max, double avg, double imbalanceMv) =>
        new(ts, min, max, avg, imbalanceMv);

    private static BatteryCellsReport SampleReport(
        IReadOnlyList<CellReadingData>? cells = null,
        IReadOnlyList<CellHistoryPoint>? history = null,
        double imbalanceMv = 20,
        double tempSpread = 3) => new(
        TotalCells: 4,
        AvgVoltage: 3.70,
        MinVoltage: 3.69,
        MaxVoltage: 3.72,
        VoltageSpread: 0.03,
        ImbalanceMv: imbalanceMv,
        PackVoltage: 400,
        AvgTemperature: 25,
        MinTemperature: 24,
        MaxTemperature: 27,
        TempSpread: tempSpread,
        Cells: cells ??
        [
            Cell(1, 3.70, 0.000, "normal"),
            Cell(2, 3.69, -0.010, "low"),
            Cell(3, 3.71, 0.010, "high"),
            Cell(4, 3.72, 0.020, "critical"),
        ],
        History: history ??
        [
            History("2026-01-01", 3.68, 3.72, 3.70, 40),
            History("2026-02-01", 3.69, 3.71, 3.70, 20),
        ]);

    private static BatteryCellsModel SuccessModel(BatteryCellsReport? report = null) =>
        new(BatteryCellsSnapshot.Compose(report ?? SampleReport()), false, null);

    private static BatteryCellsDisplay Project(BatteryCellsModel model, UnitPref? units = null) =>
        BatteryCellsProjection.Project(model, units ?? UnitPref.Metric, Localizer, Now);

    // ---- i18n key coverage (all 73 manifest strings) -------------------------------

    [Fact]
    public void Projection_resolves_every_required_string_key()
    {
        var recorder = new RecordingLocalizer();

        _ = BatteryCellsProjection.Project(SuccessModel(), UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Projection_resolves_all_keys_even_in_the_loading_state()
    {
        var recorder = new RecordingLocalizer();

        _ = BatteryCellsProjection.Project(BatteryCellsModel.Initial, UnitPref.Metric, recorder, Now);

        foreach (var key in RequiredStringKeys)
        {
            Assert.Contains(key, recorder.Keys);
        }
    }

    [Fact]
    public void Required_string_key_set_has_exactly_seventy_three_unique_keys() =>
        Assert.Equal(73, RequiredStringKeys.Distinct(StringComparer.Ordinal).Count());

    // ---- Four data states ----------------------------------------------------------

    [Fact]
    public void State_loading_when_query_in_flight()
    {
        var display = Project(BatteryCellsModel.Initial);

        Assert.Equal(BatteryCellsState.Loading, display.State);
        Assert.True(display.ShowLoading);
        Assert.False(display.ShowContent);
        Assert.False(display.ShowError);
        Assert.False(display.ShowEmpty);
    }

    [Fact]
    public void State_empty_when_resolved_with_no_cells_object()
    {
        var model = new BatteryCellsModel(BatteryCellsSnapshot.Empty, false, null);
        var display = Project(model);

        Assert.Equal(BatteryCellsState.Empty, display.State);
        Assert.True(display.ShowEmpty);
        Assert.False(display.ShowContent);
    }

    [Fact]
    public void State_error_when_query_failed()
    {
        var model = new BatteryCellsModel(BatteryCellsSnapshot.Empty, false, "network down");
        var display = Project(model);

        Assert.Equal(BatteryCellsState.Error, display.State);
        Assert.True(display.ShowError);
        Assert.False(display.ShowContent);
        Assert.Contains("network down", display.ErrorText, StringComparison.Ordinal);
    }

    [Fact]
    public void State_success_when_report_present()
    {
        var display = Project(SuccessModel());

        Assert.Equal(BatteryCellsState.Success, display.State);
        Assert.True(display.ShowContent);
        Assert.False(display.ShowEmpty);
        Assert.False(display.ShowError);
        Assert.False(display.ShowLoading);
    }

    // ---- Summary metrics -----------------------------------------------------------

    [Fact]
    public void Summary_metrics_project_six_cards_with_min_max_cells()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.SummaryMetrics.Count);
        Assert.Equal("Total Cells", display.SummaryMetrics[0].Label);
        Assert.Equal("4", display.SummaryMetrics[0].Value);
        Assert.Equal("Avg Voltage", display.SummaryMetrics[1].Label);
        Assert.Equal("3.7000 V", display.SummaryMetrics[1].Value);
        Assert.Equal("#2 3.6900 V", display.SummaryMetrics[2].Value);
        Assert.Equal("#4 3.7200 V", display.SummaryMetrics[3].Value);
        Assert.Equal("20.0 mV", display.SummaryMetrics[4].Value);
        Assert.Equal("400.0 V", display.SummaryMetrics[5].Value);
    }

    [Fact]
    public void Summary_min_max_cells_are_em_dash_when_no_cells()
    {
        var report = SampleReport(cells: []);
        var display = Project(SuccessModel(report));

        Assert.Equal("\u2014", display.SummaryMetrics[2].Value);
        Assert.Equal("\u2014", display.SummaryMetrics[3].Value);
    }

    // ---- Heatmap tiles -------------------------------------------------------------

    [Fact]
    public void Heatmap_tiles_classify_deviation_from_average()
    {
        var display = Project(SuccessModel());

        Assert.True(display.HasCells);
        Assert.Equal(4, display.CellTiles.Count);
        Assert.Equal(StatusKind.Success, display.CellTiles[0].Deviation);   // 0 mV
        Assert.Equal(StatusKind.Warning, display.CellTiles[1].Deviation);   // 10 mV
        Assert.Equal(StatusKind.Warning, display.CellTiles[2].Deviation);   // 10 mV
        Assert.Equal(StatusKind.Danger, display.CellTiles[3].Deviation);    // 20 mV
    }

    [Theory]
    [InlineData(3.700, StatusKind.Success)]
    [InlineData(3.708, StatusKind.Warning)]
    [InlineData(3.720, StatusKind.Danger)]
    public void Deviation_status_follows_millivolt_thresholds(double voltage, StatusKind expected) =>
        Assert.Equal(expected, BatteryCellsProjection.DeviationStatus(voltage, 3.700));

    // ---- Bar chart -----------------------------------------------------------------

    [Fact]
    public void Bar_chart_builds_one_voltage_series_with_avg_min_max_lines()
    {
        var display = Project(SuccessModel());

        Assert.True(display.BarChart.HasData);
        var series = Assert.Single(display.BarChart.Series);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal(4, series.Points.Count);
        Assert.Equal(3, display.BarChart.Annotations.Count);
    }

    // ---- Voltage distribution histogram --------------------------------------------

    [Fact]
    public void Distribution_builds_a_bucketed_bar_series()
    {
        var display = Project(SuccessModel());

        Assert.True(display.Distribution.HasData);
        var series = Assert.Single(display.Distribution.Series);
        Assert.Equal(ChartSeriesKind.Bar, series.Kind);
        Assert.Equal(6, series.Points.Count);   // max(6, min(12, ceil(4/4))) = 6 buckets
    }

    [Fact]
    public void Distribution_is_empty_when_no_cells()
    {
        var display = Project(SuccessModel(SampleReport(cells: [])));
        Assert.False(display.Distribution.HasData);
    }

    // ---- Imbalance trend + over-time -----------------------------------------------

    [Fact]
    public void Imbalance_trend_builds_a_line_with_nominal_and_warning_lines()
    {
        var display = Project(SuccessModel());

        Assert.True(display.ImbalanceTrend.HasData);
        var series = Assert.Single(display.ImbalanceTrend.Series);
        Assert.Equal(ChartSeriesKind.Line, series.Kind);
        Assert.Equal(40, series.Points[0].Y);
        Assert.Equal(2, display.ImbalanceTrend.Annotations.Count);
    }

    [Fact]
    public void Over_time_builds_min_avg_max_voltage_lines()
    {
        var display = Project(SuccessModel());

        Assert.True(display.OverTime.HasData);
        Assert.Equal(3, display.OverTime.Series.Count);
        Assert.All(display.OverTime.Series, s => Assert.Equal(ChartSeriesKind.Line, s.Kind));
    }

    [Fact]
    public void History_charts_are_empty_when_no_history()
    {
        var display = Project(SuccessModel(SampleReport(history: [])));

        Assert.False(display.ImbalanceTrend.HasData);
        Assert.False(display.OverTime.HasData);
        Assert.False(display.SpreadTrend.HasData);
        Assert.Equal("Not enough history for spread trend", display.SpreadTrend.EmptyMessage);
    }

    // ---- Spread trend --------------------------------------------------------------

    [Fact]
    public void Spread_trend_builds_an_area_series_in_millivolts()
    {
        var display = Project(SuccessModel());

        Assert.True(display.SpreadTrend.HasData);
        var series = Assert.Single(display.SpreadTrend.Series);
        Assert.Equal(ChartSeriesKind.Area, series.Kind);
        Assert.Equal(40, series.Points[0].Y, 3);   // (3.72 - 3.68) * 1000
        Assert.Equal(20, series.Points[1].Y, 3);   // (3.71 - 3.69) * 1000
    }

    // ---- Cell details table --------------------------------------------------------

    [Fact]
    public void Table_rows_are_sorted_by_id_and_format_voltage_and_delta()
    {
        var display = Project(SuccessModel());

        Assert.Equal(4, display.Rows.Count);
        Assert.Equal("1", display.Rows[0].CellLabel);
        Assert.Equal("3.7000", display.Rows[0].VoltageText);
        Assert.Equal("+0.0", display.Rows[0].DeltaText);
        Assert.Equal(StatusKind.Neutral, display.Rows[0].DeltaStatus);

        Assert.Equal("-10.0", display.Rows[1].DeltaText);   // cell 2: -0.010 V
        Assert.Equal(StatusKind.Danger, display.Rows[1].DeltaStatus);
        Assert.Equal("Low", display.Rows[1].StatusText);
        Assert.Equal(StatusKind.Warning, display.Rows[1].StatusBadge);

        Assert.Equal("Critical", display.Rows[3].StatusText);
        Assert.Equal(StatusKind.Danger, display.Rows[3].StatusBadge);
    }

    [Fact]
    public void Table_is_empty_with_message_when_no_cells()
    {
        var display = Project(SuccessModel(SampleReport(cells: [])));

        Assert.Empty(display.Rows);
        Assert.Equal("No cell details available.", display.TableEmptyMessage);
    }

    // ---- Temperature summary -------------------------------------------------------

    [Fact]
    public void Temperature_metrics_format_absolute_temps_and_spread()
    {
        var display = Project(SuccessModel(), UnitPref.Metric);

        Assert.True(display.HasTemperature);
        Assert.Equal(4, display.TemperatureMetrics.Count);
        Assert.Equal(UnitFormatters.FormatTemperature(25, UnitPref.Metric, 1), display.TemperatureMetrics[0].Value);
        Assert.Equal("3.0\u00B0C", display.TemperatureMetrics[3].Value);
    }

    [Fact]
    public void Temperature_spread_scales_for_fahrenheit()
    {
        var display = Project(SuccessModel(), UnitPref.Imperial);
        Assert.Equal("5.4\u00B0F", display.TemperatureMetrics[3].Value);   // 3 °C delta = 5.4 °F delta
    }

    // ---- Health recommendations ----------------------------------------------------

    [Fact]
    public void Insights_follow_imbalance_temperature_and_critical_cells()
    {
        var display = Project(SuccessModel());   // imbalance 20 (>15), temp_spread 3, 1 critical cell

        Assert.Equal(3, display.Insights.Count);
        Assert.Equal(StatusKind.Danger, display.Insights[0].Status);   // high voltage spread
        Assert.Equal("High Voltage Spread", display.Insights[0].Title);
        Assert.Equal(StatusKind.Success, display.Insights[1].Status);  // thermal balance good
        Assert.Equal("Critical Cells Detected", display.Insights[2].Title);
        Assert.StartsWith("1 cell(s)", display.Insights[2].Description, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(2, "Cells Well Balanced", StatusKind.Success)]
    [InlineData(10, "Voltage Spread Increasing", StatusKind.Warning)]
    [InlineData(20, "High Voltage Spread", StatusKind.Danger)]
    public void Imbalance_insight_tiers_match_web(double imbalanceMv, string title, StatusKind status)
    {
        var report = SampleReport(
            cells: [Cell(1, 3.70, 0, "normal")],   // no critical cells
            imbalanceMv: imbalanceMv);
        var display = Project(SuccessModel(report));

        Assert.Equal(title, display.Insights[0].Title);
        Assert.Equal(status, display.Insights[0].Status);
    }

    // ---- Bottom summary stats ------------------------------------------------------

    [Fact]
    public void Summary_stats_project_six_panels()
    {
        var display = Project(SuccessModel());

        Assert.Equal(6, display.SummaryStats.Count);
        Assert.Equal("4", display.SummaryStats[0].Value);
        Assert.Equal("400.0 V", display.SummaryStats[1].Value);
        Assert.Equal("3.7000 V", display.SummaryStats[2].Value);
        Assert.Equal("20.0 mV", display.SummaryStats[3].Value);
        Assert.Equal("3.0\u00B0C", display.SummaryStats[4].Value);
        Assert.Equal("1/4", display.SummaryStats[5].Value);   // one "normal" cell of four
    }

    // ---- Tolerant JSON parsing -----------------------------------------------------

    [Fact]
    public void Report_parses_scalars_cells_and_history()
    {
        using var doc = JsonDocument.Parse(
            "{\"total_cells\":4,\"avg_voltage\":3.7,\"min_voltage\":3.69,\"max_voltage\":3.72," +
            "\"voltage_spread\":0.03,\"imbalance_mv\":20,\"pack_voltage\":400,\"avg_temperature\":25," +
            "\"min_temperature\":24,\"max_temperature\":27,\"temp_spread\":3," +
            "\"cells\":[{\"cell_id\":1,\"voltage\":3.7,\"delta_from_avg\":0,\"status\":\"normal\"}]," +
            "\"history\":[{\"timestamp\":\"2026-01-01\",\"min_voltage\":3.68,\"max_voltage\":3.72,\"avg_voltage\":3.7,\"imbalance_mv\":40}]}");

        var report = BatteryCellsReport.FromJson(doc.RootElement);

        Assert.NotNull(report);
        Assert.Equal(4, report!.TotalCells);
        Assert.Equal(400, report.PackVoltage);
        var cell = Assert.Single(report.Cells);
        Assert.Equal(1, cell.CellId);
        Assert.Equal("normal", cell.Status);
        var point = Assert.Single(report.History);
        Assert.Equal(40, point.ImbalanceMv);
    }

    [Fact]
    public void Report_is_null_for_a_non_object_body() =>
        Assert.Null(BatteryCellsReport.FromJson(JsonDocument.Parse("null").RootElement));

    [Fact]
    public void Snapshot_compose_treats_null_report_as_no_data()
    {
        var snapshot = BatteryCellsSnapshot.Compose(null);
        Assert.False(snapshot.HasData);
    }

    // ---- View-model state matrix ---------------------------------------------------

    [Fact]
    public async Task ViewModel_loads_report_into_the_success_state()
    {
        var feed = new FakeBatteryCellsFeed(BatteryCellsSnapshot.Compose(SampleReport()));
        using var vm = new BatteryCellsPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Success, vm.State);
        Assert.True(vm.Display.ShowContent);
        Assert.False(vm.IsFetching);
        Assert.False(vm.IsError);
        Assert.Equal(Now, vm.UpdatedAt);
    }

    [Fact]
    public async Task ViewModel_empty_snapshot_is_the_empty_state()
    {
        using var vm = new BatteryCellsPageViewModel(EmptyBatteryCellsFeed.Instance, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Empty, vm.State);
        Assert.True(vm.Display.ShowEmpty);
    }

    [Fact]
    public async Task ViewModel_feed_failure_is_the_error_state()
    {
        using var vm = new BatteryCellsPageViewModel(new ThrowingBatteryCellsFeed(), Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();

        Assert.Equal(BatteryCellsState.Error, vm.State);
        Assert.True(vm.Display.ShowError);
        Assert.True(vm.IsError);
    }

    [Fact]
    public async Task ViewModel_refresh_reloads_through_the_feed()
    {
        var feed = new FakeBatteryCellsFeed(BatteryCellsSnapshot.Compose(SampleReport()));
        using var vm = new BatteryCellsPageViewModel(feed, Localizer, UnitPref.Metric, () => Now);

        await vm.LoadAsync();
        await vm.RefreshAsync();

        Assert.Equal(2, feed.FetchCount);
    }

    // ---- Generated-client feed (web /analytics/battery-cells?vehicle_id=) ----------

    [Fact]
    public async Task ClientFeed_sends_the_analytics_operation_with_the_vehicle_id()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("{\"total_cells\":4,\"pack_voltage\":400}"));
        var feed = new BatteryCellsClientFeed(api, vehicleId: 7);

        var snapshot = await feed.FetchAsync(default);

        Assert.True(snapshot.HasData);
        Assert.Equal(4, snapshot.Report.TotalCells);
        var request = Assert.Single(api.Requests);
        Assert.Equal("get_api_v1_analytics_battery_cells", request.OperationId);
        Assert.Equal("7", request.Query!["vehicle_id"]?.ToString());
    }

    [Fact]
    public async Task ClientFeed_propagates_a_failed_read()
    {
        var api = new FakeApiClient();
        api.Throws(new ApiException("boom", 500));
        var feed = new BatteryCellsClientFeed(api, vehicleId: 1);

        await Assert.ThrowsAsync<ApiException>(() => feed.FetchAsync(default));
    }

    [Fact]
    public async Task ClientFeed_composes_empty_for_a_non_object_body()
    {
        var api = new FakeApiClient();
        api.ReturnsValue(Json("null"));
        var feed = new BatteryCellsClientFeed(api, vehicleId: 2);

        var snapshot = await feed.FetchAsync(default);

        Assert.False(snapshot.HasData);
    }

    // ---- Diagnostics + registration ------------------------------------------------

    [Fact]
    public void Diagnostics_record_only_view_opened()
    {
        var lines = new List<string>();
        var diagnostics = new BatteryCellsDiagnostics(lines.Add);

        diagnostics.RecordViewOpened();

        Assert.Equal(1, diagnostics.ViewsOpened);
        Assert.Equal("view.opened slug=BatteryCellsPage", Assert.Single(lines));
    }

    [Fact]
    public void Registration_exposes_route_and_operation()
    {
        Assert.Equal("BatteryCells", BatteryCellsRegistration.RouteName);
        Assert.Equal("get_api_v1_analytics_battery_cells", BatteryCellsRegistration.CellsOperation);
        Assert.Equal("Battery Cells", BatteryCellsRegistration.Title(Localizer));
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

    private sealed class FakeBatteryCellsFeed(BatteryCellsSnapshot snapshot) : IBatteryCellsFeed
    {
        public int FetchCount { get; private set; }

        public Task<BatteryCellsSnapshot> FetchAsync(CancellationToken cancellationToken)
        {
            FetchCount++;
            return Task.FromResult(snapshot);
        }
    }

    private sealed class ThrowingBatteryCellsFeed : IBatteryCellsFeed
    {
        public Task<BatteryCellsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
            throw new ApiException("Failed to load data", 500);
    }
}
