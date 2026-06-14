using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// One per-cell voltage reading from <c>GET /analytics/battery-cells</c> (web <c>CellReading</c> in
/// web/src/features/battery/pages/BatteryCellsPage.tsx). <see cref="Voltage"/> and
/// <see cref="DeltaFromAvg"/> are SI volts; <see cref="Status"/> is the backend's classification
/// (<c>normal</c> / <c>low</c> / <c>high</c> / <c>critical</c>). Parsing is null-tolerant so a partial
/// row never throws.
/// </summary>
public sealed record CellReadingData(int CellId, double Voltage, double DeltaFromAvg, string Status)
{
    /// <summary>Project a single cell JSON object into a tolerant reading.</summary>
    public static CellReadingData FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new CellReadingData(0, 0, 0, "normal");
        }

        return new CellReadingData(
            CellId: (int)(CellsJson.Double(element, "cell_id") ?? 0),
            Voltage: CellsJson.Double(element, "voltage") ?? 0,
            DeltaFromAvg: CellsJson.Double(element, "delta_from_avg") ?? 0,
            Status: CellsJson.String(element, "status") ?? "normal");
    }
}

/// <summary>
/// One historical pack-voltage sample from <c>GET /analytics/battery-cells</c> (web <c>HistoryPoint</c>):
/// the min / max / average cell voltage and the cell imbalance (millivolts) at <see cref="Timestamp"/>.
/// All voltages are SI volts; imbalance is already millivolts on the wire.
/// </summary>
public sealed record CellHistoryPoint(
    string Timestamp,
    double MinVoltage,
    double MaxVoltage,
    double AvgVoltage,
    double ImbalanceMv)
{
    /// <summary>Project a single history JSON object into a tolerant point.</summary>
    public static CellHistoryPoint FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new CellHistoryPoint(string.Empty, 0, 0, 0, 0);
        }

        return new CellHistoryPoint(
            Timestamp: CellsJson.String(element, "timestamp") ?? string.Empty,
            MinVoltage: CellsJson.Double(element, "min_voltage") ?? 0,
            MaxVoltage: CellsJson.Double(element, "max_voltage") ?? 0,
            AvgVoltage: CellsJson.Double(element, "avg_voltage") ?? 0,
            ImbalanceMv: CellsJson.Double(element, "imbalance_mv") ?? 0);
    }
}

/// <summary>
/// The battery-cells analytics slice the page reads from <c>GET /analytics/battery-cells</c> — the native
/// mirror of the web <c>BatteryCellData</c>. Every voltage is SI volts, every temperature is SI Celsius,
/// and the imbalance / spread are already millivolts on the wire (converted at the render boundary only).
/// A <see langword="null"/> parse result models the web query returning no object (<c>data</c> undefined →
/// the page empty surface).
/// </summary>
public sealed record BatteryCellsReport(
    int TotalCells,
    double AvgVoltage,
    double MinVoltage,
    double MaxVoltage,
    double VoltageSpread,
    double ImbalanceMv,
    double PackVoltage,
    double AvgTemperature,
    double MinTemperature,
    double MaxTemperature,
    double TempSpread,
    IReadOnlyList<CellReadingData> Cells,
    IReadOnlyList<CellHistoryPoint> History)
{
    /// <summary>An all-zero report with no cells / history — the projection seed before any data resolves.</summary>
    public static BatteryCellsReport Empty { get; } =
        new(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<CellReadingData>(), Array.Empty<CellHistoryPoint>());

    /// <summary>
    /// Project a <c>GET /analytics/battery-cells</c> response into the report. Mirrors the web
    /// <c>data</c> truthiness gate: only a non-object body returns <see langword="null"/> (the empty
    /// surface); any object yields a report with missing fields defaulting to 0 / empty (the web
    /// <c>?? 0</c> reads).
    /// </summary>
    public static BatteryCellsReport? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new BatteryCellsReport(
            TotalCells: (int)(CellsJson.Double(root, "total_cells") ?? 0),
            AvgVoltage: CellsJson.Double(root, "avg_voltage") ?? 0,
            MinVoltage: CellsJson.Double(root, "min_voltage") ?? 0,
            MaxVoltage: CellsJson.Double(root, "max_voltage") ?? 0,
            VoltageSpread: CellsJson.Double(root, "voltage_spread") ?? 0,
            ImbalanceMv: CellsJson.Double(root, "imbalance_mv") ?? 0,
            PackVoltage: CellsJson.Double(root, "pack_voltage") ?? 0,
            AvgTemperature: CellsJson.Double(root, "avg_temperature") ?? 0,
            MinTemperature: CellsJson.Double(root, "min_temperature") ?? 0,
            MaxTemperature: CellsJson.Double(root, "max_temperature") ?? 0,
            TempSpread: CellsJson.Double(root, "temp_spread") ?? 0,
            Cells: CellsJson.Array(root, "cells", CellReadingData.FromJson),
            History: CellsJson.Array(root, "history", CellHistoryPoint.FromJson));
    }
}

/// <summary>
/// The single read backing the page — the native analogue of the web page's <c>useQuery</c> against
/// <c>/analytics/battery-cells</c>. <see cref="HasData"/> mirrors the web <c>!!data</c> gate (false
/// collapses the page to the empty surface).
/// </summary>
public sealed record BatteryCellsSnapshot(bool HasData, BatteryCellsReport Report)
{
    /// <summary>The empty snapshot (no cells object) — the page-level empty surface.</summary>
    public static BatteryCellsSnapshot Empty { get; } = new(false, BatteryCellsReport.Empty);

    /// <summary>Compose a snapshot from the parsed report (may be null → the empty surface).</summary>
    public static BatteryCellsSnapshot Compose(BatteryCellsReport? report) =>
        report is { } r ? new BatteryCellsSnapshot(true, r) : Empty;
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface IBatteryCellsFeed
{
    /// <summary>Fetch the battery-cells analytics report for the active vehicle.</summary>
    Task<BatteryCellsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyBatteryCellsFeed : IBatteryCellsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyBatteryCellsFeed Instance { get; } = new();

    private EmptyBatteryCellsFeed()
    {
    }

    /// <inheritdoc />
    public Task<BatteryCellsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(BatteryCellsSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum BatteryCellsState
{
    /// <summary>The query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no cells object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The report resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>One projected summary / temperature metric tile (web <c>MetricCard</c>): label + value + accent.</summary>
public sealed record CellMetricDisplay(
    string Label,
    string Value,
    string Glyph,
    string AccentBrushKey,
    string AutomationName);

/// <summary>One projected heatmap tile (web grid cell): id + voltage text + deviation status + tooltip.</summary>
public sealed record CellTileDisplay(
    string Id,
    string VoltageText,
    StatusKind Deviation,
    string AutomationName);

/// <summary>One projected cell-details table row (every cell pre-formatted at the render boundary).</summary>
public sealed record CellRowDisplay(
    string Id,
    string CellLabel,
    string VoltageText,
    string DeltaText,
    StatusKind DeltaStatus,
    string StatusGlyph,
    string StatusText,
    StatusKind StatusBadge);

/// <summary>One projected health-recommendation insight card (web insight): icon + title + body + status.</summary>
public sealed record CellInsightDisplay(
    string Glyph,
    string Title,
    string Description,
    StatusKind Status,
    string AutomationName);

/// <summary>One projected bottom-row summary-stat panel (web centered GlassPanel): label + value + accent.</summary>
public sealed record CellSummaryStatDisplay(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>A projected cartesian chart section: its bound series + reference annotations + data flag + empty copy.</summary>
public sealed record CellChartDisplay(
    bool HasData,
    string Title,
    string AxisLabel,
    IReadOnlyList<ChartSeries> Series,
    IReadOnlyList<ChartAnnotation> Annotations,
    string EmptyMessage)
{
    /// <summary>An empty chart section that still renders its title and an empty-state message.</summary>
    public static CellChartDisplay EmptyChart(string title, string axisLabel, string emptyMessage) =>
        new(false, title, axisLabel, Array.Empty<ChartSeries>(), Array.Empty<ChartAnnotation>(), emptyMessage);
}

/// <summary>
/// The fully-projected, render-ready content the view binds to. Every branch selection, number/temperature
/// formatting and i18n is resolved here so the WinUI view stays a thin renderer. The per-region visibility
/// flags drive the four-state matrix (loading / empty / error / success) and each section's own empty
/// fallback.
/// </summary>
public sealed record BatteryCellsDisplay(
    BatteryCellsState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyTitle,
    string EmptyMessage,
    IReadOnlyList<CellMetricDisplay> SummaryMetrics,
    string HeatmapTitle,
    string HeatmapCaption,
    string HeatmapToBarLabel,
    string HeatmapToGridLabel,
    string NominalLabel,
    string SlightLabel,
    string SignificantLabel,
    bool HasCells,
    IReadOnlyList<CellTileDisplay> CellTiles,
    string HeatmapEmptyMessage,
    CellChartDisplay BarChart,
    CellChartDisplay Distribution,
    CellChartDisplay ImbalanceTrend,
    CellChartDisplay OverTime,
    string TableTitle,
    string CountBadgeText,
    string CellColumnHeader,
    string VoltageColumnHeader,
    string DeltaColumnHeader,
    string StatusColumnHeader,
    IReadOnlyList<CellRowDisplay> Rows,
    string TableEmptyMessage,
    CellChartDisplay SpreadTrend,
    string SpreadTrendAria,
    string TempTitle,
    bool HasTemperature,
    IReadOnlyList<CellMetricDisplay> TemperatureMetrics,
    string TempEmptyMessage,
    string RecommendationsTitle,
    IReadOnlyList<CellInsightDisplay> Insights,
    string NoInsightsMessage,
    IReadOnlyList<CellSummaryStatDisplay> SummaryStats,
    string AutomationName);

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page
/// lifecycle (the query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in;
/// tests construct it directly. Pure data — no WinUI types.
/// </summary>
public sealed record BatteryCellsModel(BatteryCellsSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the query is in flight with no data yet.</summary>
    public static BatteryCellsModel Initial { get; } = new(BatteryCellsSnapshot.Empty, true, null);
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every key the web
/// <c>BatteryCellsPage</c> feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection
/// stays readable and the string-coverage test can assert all of them in one pass. Web key names are used
/// verbatim (ADR-014).
/// </summary>
public sealed record BatteryCellStrings
{
    // ── Header / states ──
    /// <summary>Page title (web <c>t('Battery Cells')</c>).</summary>
    public required string Title { get; init; }

    /// <summary>Namespaced page title key (web <c>battery.cells.title</c>).</summary>
    public required string TitleKey { get; init; }

    /// <summary>Page subtitle (web <c>Individual cell voltage monitoring and analysis</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>Generic retry action label.</summary>
    public required string Retry { get; init; }

    /// <summary>Generic error surface title.</summary>
    public required string ErrorTitle { get; init; }

    // ── Summary metrics ──
    /// <summary>Total Cells metric label.</summary>
    public required string TotalCells { get; init; }

    /// <summary>Avg Voltage metric label.</summary>
    public required string AvgVoltage { get; init; }

    /// <summary>Min Cell metric label.</summary>
    public required string MinCell { get; init; }

    /// <summary>Max Cell metric label.</summary>
    public required string MaxCell { get; init; }

    /// <summary>Imbalance metric label.</summary>
    public required string Imbalance { get; init; }

    /// <summary>Pack Voltage metric label.</summary>
    public required string PackVoltage { get; init; }

    // ── Heatmap ──
    /// <summary>Cell Voltage Heatmap section title.</summary>
    public required string HeatmapTitle { get; init; }

    /// <summary>Heatmap caption (Cells colored by deviation from average).</summary>
    public required string HeatmapCaption { get; init; }

    /// <summary>Heatmap toggle label → bar view.</summary>
    public required string BarView { get; init; }

    /// <summary>Heatmap toggle label → grid view.</summary>
    public required string GridView { get; init; }

    /// <summary>Heatmap legend — nominal.</summary>
    public required string Nominal { get; init; }

    /// <summary>Heatmap legend — slight deviation.</summary>
    public required string SlightDeviation { get; init; }

    /// <summary>Heatmap legend — significant deviation.</summary>
    public required string SignificantDeviation { get; init; }

    /// <summary>Heatmap empty message (No cell readings available.).</summary>
    public required string NoCellReadings { get; init; }

    /// <summary>Tooltip prefix for a single cell.</summary>
    public required string Cell { get; init; }

    // ── Charts ──
    /// <summary>Cell Voltage Bar Chart title.</summary>
    public required string CellBarChart { get; init; }

    /// <summary>Cell # axis label / column header.</summary>
    public required string CellHash { get; init; }

    /// <summary>Voltage (V) axis label / column header.</summary>
    public required string VoltageV { get; init; }

    /// <summary>Voltage series name.</summary>
    public required string Voltage { get; init; }

    /// <summary>Average reference-line label.</summary>
    public required string Avg { get; init; }

    /// <summary>Minimum reference-line label.</summary>
    public required string Min { get; init; }

    /// <summary>Maximum reference-line label.</summary>
    public required string Max { get; init; }

    /// <summary>Voltage Distribution histogram title.</summary>
    public required string VoltageDistribution { get; init; }

    /// <summary>Cells axis label.</summary>
    public required string Cells { get; init; }

    /// <summary>Cell Count series name.</summary>
    public required string CellCount { get; init; }

    /// <summary>Imbalance Trend chart title.</summary>
    public required string ImbalanceTrend { get; init; }

    /// <summary>Imbalance (mV) series name.</summary>
    public required string ImbalanceMv { get; init; }

    /// <summary>Nominal threshold reference-line label.</summary>
    public required string NominalRef { get; init; }

    /// <summary>Warning threshold reference-line label.</summary>
    public required string Warning { get; init; }

    /// <summary>Cell Voltage Over Time chart title.</summary>
    public required string CellVoltageOverTime { get; init; }

    /// <summary>Min Voltage series name.</summary>
    public required string MinVoltage { get; init; }

    /// <summary>Avg Voltage series name (over-time).</summary>
    public required string AvgVoltageSeries { get; init; }

    /// <summary>Max Voltage series name.</summary>
    public required string MaxVoltage { get; init; }

    // ── Table ──
    /// <summary>Cell Details table title.</summary>
    public required string CellDetails { get; init; }

    /// <summary>Delta (mV) column header.</summary>
    public required string DeltaMv { get; init; }

    /// <summary>Status column header.</summary>
    public required string Status { get; init; }

    /// <summary>Count-badge suffix (cells).</summary>
    public required string CellsLower { get; init; }

    /// <summary>Table empty message (No cell details available.).</summary>
    public required string NoCellDetails { get; init; }

    /// <summary>Status badge — normal.</summary>
    public required string Normal { get; init; }

    /// <summary>Status badge — low.</summary>
    public required string Low { get; init; }

    /// <summary>Status badge — high.</summary>
    public required string High { get; init; }

    /// <summary>Status badge — critical.</summary>
    public required string Critical { get; init; }

    // ── Spread trend ──
    /// <summary>Voltage Spread Trend chart title (battery.cells.chart.spreadTrend).</summary>
    public required string SpreadTrend { get; init; }

    /// <summary>Voltage Spread Trend accessible summary.</summary>
    public required string SpreadTrendAria { get; init; }

    /// <summary>Voltage Spread (mV) series name.</summary>
    public required string VoltageSpread { get; init; }

    /// <summary>Voltage Spread Trend empty message.</summary>
    public required string NoSpreadTrend { get; init; }

    // ── Temperature ──
    /// <summary>Temperature Summary section title.</summary>
    public required string TempTitle { get; init; }

    /// <summary>Avg Temperature metric label.</summary>
    public required string TempAvg { get; init; }

    /// <summary>Min Temperature metric label.</summary>
    public required string TempMin { get; init; }

    /// <summary>Max Temperature metric label.</summary>
    public required string TempMax { get; init; }

    /// <summary>Temp Spread metric label.</summary>
    public required string TempSpread { get; init; }

    /// <summary>Temperature empty message.</summary>
    public required string TempEmpty { get; init; }

    // ── Recommendations ──
    /// <summary>Health Recommendations section title.</summary>
    public required string Recommendations { get; init; }

    /// <summary>Recommendations empty message.</summary>
    public required string NoInsights { get; init; }

    /// <summary>Insight — high voltage spread title.</summary>
    public required string HighSpread { get; init; }

    /// <summary>Insight — high voltage spread body.</summary>
    public required string HighSpreadDesc { get; init; }

    /// <summary>Insight — watch voltage spread title.</summary>
    public required string WatchSpread { get; init; }

    /// <summary>Insight — watch voltage spread body.</summary>
    public required string WatchSpreadDesc { get; init; }

    /// <summary>Insight — balanced title.</summary>
    public required string Balanced { get; init; }

    /// <summary>Insight — balanced body.</summary>
    public required string BalancedDesc { get; init; }

    /// <summary>Insight — high temperature title.</summary>
    public required string HighTemp { get; init; }

    /// <summary>Insight — high temperature body.</summary>
    public required string HighTempDesc { get; init; }

    /// <summary>Insight — watch temperature title.</summary>
    public required string WatchTemp { get; init; }

    /// <summary>Insight — watch temperature body.</summary>
    public required string WatchTempDesc { get; init; }

    /// <summary>Insight — good temperature title.</summary>
    public required string GoodTemp { get; init; }

    /// <summary>Insight — good temperature body.</summary>
    public required string GoodTempDesc { get; init; }

    /// <summary>Insight — critical cells title.</summary>
    public required string CriticalCells { get; init; }

    /// <summary>Insight — critical cells body template ({{count}}).</summary>
    public required string CriticalCellsDesc { get; init; }

    /// <summary>Insight — healthy title.</summary>
    public required string Healthy { get; init; }

    /// <summary>Insight — healthy body.</summary>
    public required string HealthyDesc { get; init; }

    // ── Summary stats ──
    /// <summary>Summary stat — total cells label.</summary>
    public required string StatTotalCells { get; init; }

    /// <summary>Summary stat — pack voltage label.</summary>
    public required string StatPackVoltage { get; init; }

    /// <summary>Summary stat — average cell voltage label.</summary>
    public required string StatAvgVoltage { get; init; }

    /// <summary>Summary stat — voltage spread label.</summary>
    public required string StatVoltageSpread { get; init; }

    /// <summary>Summary stat — temperature spread label.</summary>
    public required string StatTempSpread { get; init; }

    /// <summary>Summary stat — normal cells label.</summary>
    public required string StatNormalCells { get; init; }

    /// <summary>Resolve every label through <paramref name="localizer"/> using the same keys the web page uses.</summary>
    public static BatteryCellStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return new BatteryCellStrings
        {
            Title = localizer.GetString("Battery Cells", "Battery Cells"),
            TitleKey = localizer.GetString("battery.cells.title", "Battery Cells"),
            Subtitle = localizer.GetString(
                "Individual cell voltage monitoring and analysis",
                "Individual cell voltage monitoring and analysis"),
            Retry = localizer.GetString("Retry", "Retry"),
            ErrorTitle = localizer.GetString("Failed to load data", "Failed to load data"),

            TotalCells = localizer.GetString("Total Cells", "Total Cells"),
            AvgVoltage = localizer.GetString("Avg Voltage", "Avg Voltage"),
            MinCell = localizer.GetString("Min Cell", "Min Cell"),
            MaxCell = localizer.GetString("Max Cell", "Max Cell"),
            Imbalance = localizer.GetString("Imbalance", "Imbalance"),
            PackVoltage = localizer.GetString("Pack Voltage", "Pack Voltage"),

            HeatmapTitle = localizer.GetString("Cell Voltage Heatmap", "Cell Voltage Heatmap"),
            HeatmapCaption = localizer.GetString(
                "Cells colored by deviation from average",
                "Cells colored by deviation from average"),
            BarView = localizer.GetString("Bar View", "Bar View"),
            GridView = localizer.GetString("Grid View", "Grid View"),
            Nominal = localizer.GetString("Nominal", "Nominal"),
            SlightDeviation = localizer.GetString("Slight Deviation", "Slight Deviation"),
            SignificantDeviation = localizer.GetString("Significant Deviation", "Significant Deviation"),
            NoCellReadings = localizer.GetString("No cell readings available.", "No cell readings available."),
            Cell = localizer.GetString("Cell", "Cell"),

            CellBarChart = localizer.GetString("Cell Voltage Bar Chart", "Cell Voltage Bar Chart"),
            CellHash = localizer.GetString("Cell #", "Cell #"),
            VoltageV = localizer.GetString("Voltage (V)", "Voltage (V)"),
            Voltage = localizer.GetString("Voltage", "Voltage"),
            Avg = localizer.GetString("Avg", "Avg"),
            Min = localizer.GetString("Min", "Min"),
            Max = localizer.GetString("Max", "Max"),
            VoltageDistribution = localizer.GetString("Voltage Distribution", "Voltage Distribution"),
            Cells = localizer.GetString("Cells", "Cells"),
            CellCount = localizer.GetString("Cell Count", "Cell Count"),
            ImbalanceTrend = localizer.GetString("Imbalance Trend", "Imbalance Trend"),
            ImbalanceMv = localizer.GetString("Imbalance (mV)", "Imbalance (mV)"),
            NominalRef = localizer.GetString("Nominal", "Nominal"),
            Warning = localizer.GetString("Warning", "Warning"),
            CellVoltageOverTime = localizer.GetString("Cell Voltage Over Time", "Cell Voltage Over Time"),
            MinVoltage = localizer.GetString("Min Voltage", "Min Voltage"),
            AvgVoltageSeries = localizer.GetString("Avg Voltage", "Avg Voltage"),
            MaxVoltage = localizer.GetString("Max Voltage", "Max Voltage"),

            CellDetails = localizer.GetString("Cell Details", "Cell Details"),
            DeltaMv = localizer.GetString("Delta (mV)", "Delta (mV)"),
            Status = localizer.GetString("Status", "Status"),
            CellsLower = localizer.GetString("cells", "cells"),
            NoCellDetails = localizer.GetString("No cell details available.", "No cell details available."),
            Normal = localizer.GetString("Normal", "Normal"),
            Low = localizer.GetString("Low", "Low"),
            High = localizer.GetString("High", "High"),
            Critical = localizer.GetString("Critical", "Critical"),

            SpreadTrend = localizer.GetString("battery.cells.chart.spreadTrend", "Voltage Spread Trend"),
            SpreadTrendAria = localizer.GetString(
                "battery.cells.chart.spreadTrend.aria",
                "Battery cell voltage spread trend area chart over time"),
            VoltageSpread = localizer.GetString("battery.cells.chart.voltageSpread", "Voltage Spread (mV)"),
            NoSpreadTrend = localizer.GetString(
                "battery.cells.chart.noSpreadTrend",
                "Not enough history for spread trend"),

            TempTitle = localizer.GetString("battery.cells.temp.title", "Temperature Summary"),
            TempAvg = localizer.GetString("battery.cells.temp.avg", "Avg Temperature"),
            TempMin = localizer.GetString("battery.cells.temp.min", "Min Temperature"),
            TempMax = localizer.GetString("battery.cells.temp.max", "Max Temperature"),
            TempSpread = localizer.GetString("battery.cells.temp.spread", "Temp Spread"),
            TempEmpty = localizer.GetString("battery.cells.temp.empty", "No temperature data available"),

            Recommendations = localizer.GetString("battery.cells.recommendations", "Health Recommendations"),
            NoInsights = localizer.GetString("battery.cells.noInsights", "Not enough data for recommendations"),
            HighSpread = localizer.GetString("battery.cells.insight.highSpread", "High Voltage Spread"),
            HighSpreadDesc = localizer.GetString(
                "battery.cells.insight.highSpreadDesc",
                "Cell imbalance is significant. Consider a full charge to 100% to allow BMS balancing, then discharge to 90%."),
            WatchSpread = localizer.GetString("battery.cells.insight.watchSpread", "Voltage Spread Increasing"),
            WatchSpreadDesc = localizer.GetString(
                "battery.cells.insight.watchSpreadDesc",
                "Cell balance is slightly off. Periodic full charges can help the BMS equalize cells."),
            Balanced = localizer.GetString("battery.cells.insight.balanced", "Cells Well Balanced"),
            BalancedDesc = localizer.GetString(
                "battery.cells.insight.balancedDesc",
                "Voltage spread is within healthy range. Battery cells are operating normally."),
            HighTemp = localizer.GetString("battery.cells.insight.highTemp", "High Temperature Spread"),
            HighTempDesc = localizer.GetString(
                "battery.cells.insight.highTempDesc",
                "Avoid fast charging in extreme temperatures. Allow the battery to precondition before supercharging."),
            WatchTemp = localizer.GetString("battery.cells.insight.watchTemp", "Module Temperature Variation"),
            WatchTempDesc = localizer.GetString(
                "battery.cells.insight.watchTempDesc",
                "Some temperature variation is normal. Monitor during fast charging sessions."),
            GoodTemp = localizer.GetString("battery.cells.insight.goodTemp", "Thermal Balance Good"),
            GoodTempDesc = localizer.GetString(
                "battery.cells.insight.goodTempDesc",
                "Module temperatures are consistent. Thermal management system is performing well."),
            CriticalCells = localizer.GetString("battery.cells.insight.criticalCells", "Critical Cells Detected"),
            CriticalCellsDesc = localizer.GetString(
                "battery.cells.insight.criticalCellsDesc",
                "{{count}} cell(s) show significant deviation. Consider scheduling a service appointment."),
            Healthy = localizer.GetString("battery.cells.insight.healthy", "All Cells Healthy"),
            HealthyDesc = localizer.GetString(
                "battery.cells.insight.healthyDesc",
                "No critical cells detected. Continue current charging habits for long-term health."),

            StatTotalCells = localizer.GetString("battery.cells.stat.totalCells", "Total Cells"),
            StatPackVoltage = localizer.GetString("battery.cells.stat.packVoltage", "Pack Voltage"),
            StatAvgVoltage = localizer.GetString("battery.cells.stat.avgVoltage", "Avg Cell V"),
            StatVoltageSpread = localizer.GetString("battery.cells.stat.voltageSpread", "V Spread"),
            StatTempSpread = localizer.GetString("battery.cells.stat.tempSpread", "Temp Spread"),
            StatNormalCells = localizer.GetString("battery.cells.stat.normalCells", "Normal Cells"),
        };
    }
}

/// <summary>
/// The UI-free projection that turns a parsed <see cref="BatteryCellsModel"/> into the render-ready
/// <see cref="BatteryCellsDisplay"/> — the native port of the web page's render logic
/// (web/src/features/battery/pages/BatteryCellsPage.tsx). It resolves all i18n once, derives the histogram /
/// min-max cells / spread trend / health insights, formats every number at the display boundary (SI volts +
/// the user's temperature unit), and folds the page lifecycle into the four-state matrix. Pure and
/// deterministic (an injected clock drives date formatting) so it is fully unit-testable without WinUI.
/// </summary>
public static class BatteryCellsProjection
{
    /// <summary>Segoe Fluent — Battery (web <c>Battery</c> icon + the page empty surface).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent — Processor (web <c>Cpu</c>).</summary>
    public const string CpuGlyph = "\uE950";

    /// <summary>Segoe Fluent — Activity / pulse (web <c>Activity</c>).</summary>
    public const string ActivityGlyph = "\uE9D2";

    /// <summary>Segoe Fluent — MarketDown (web <c>TrendingDown</c>).</summary>
    public const string TrendingDownGlyph = "\uEB0F";

    /// <summary>Segoe Fluent — bar chart (web <c>BarChart3</c>).</summary>
    public const string BarChartGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — grid view (web <c>Grid3x3</c>).</summary>
    public const string GridGlyph = "\uE80A";

    /// <summary>Segoe Fluent — down arrow (web <c>ArrowDownRight</c>).</summary>
    public const string ArrowDownGlyph = "\uE74B";

    /// <summary>Segoe Fluent — up arrow (web <c>ArrowUpRight</c>).</summary>
    public const string ArrowUpGlyph = "\uE74A";

    /// <summary>Segoe Fluent — remove / minus (web <c>Minus</c>).</summary>
    public const string MinusGlyph = "\uE738";

    /// <summary>Segoe Fluent — Temperature (web <c>Thermometer</c>).</summary>
    public const string ThermometerGlyph = "\uE9CA";

    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>).</summary>
    public const string LightningGlyph = "\uE945";

    /// <summary>Segoe Fluent — Completed circle (web <c>CheckCircle</c>).</summary>
    public const string CheckCircleGlyph = "\uE930";

    /// <summary>Segoe Fluent — Warning (web <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent — Shield (web <c>Shield</c>).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent — Info (web <c>Info</c>).</summary>
    public const string InfoGlyph = "\uE946";

    /// <summary>Imbalance nominal threshold (web <c>ReferenceLine y=5</c>), millivolts.</summary>
    public const double NominalThresholdMv = 5;

    /// <summary>Imbalance warning threshold (web <c>ReferenceLine y=15</c>), millivolts.</summary>
    public const double WarningThresholdMv = 15;

    private const string EmDash = "\u2014";
    private const string InfoBrush = "TsColorInfoBrush";
    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string TextPrimaryBrush = "TsColorTextPrimaryBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed single-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static BatteryCellsDisplay Project(
        BatteryCellsModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = BatteryCellStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var r = snapshot.Report;

        BatteryCellsState state =
            model.Loading && !snapshot.HasData ? BatteryCellsState.Loading
            : model.ErrorDetail is not null ? BatteryCellsState.Error
            : !snapshot.HasData ? BatteryCellsState.Empty
            : BatteryCellsState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        var cells = r.Cells;
        CellReadingData? minCell = cells.Count == 0 ? null : cells.Aggregate(static (a, b) => a.Voltage <= b.Voltage ? a : b);
        CellReadingData? maxCell = cells.Count == 0 ? null : cells.Aggregate(static (a, b) => a.Voltage >= b.Voltage ? a : b);

        var display = new BatteryCellsDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == BatteryCellsState.Loading,
            ShowError: state == BatteryCellsState.Error,
            ShowEmpty: state == BatteryCellsState.Empty,
            ShowContent: state == BatteryCellsState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyTitle: s.Title,
            EmptyMessage: s.NoCellReadings,
            SummaryMetrics: BuildSummaryMetrics(r, minCell, maxCell, s),
            HeatmapTitle: s.HeatmapTitle,
            HeatmapCaption: s.HeatmapCaption,
            HeatmapToBarLabel: s.BarView,
            HeatmapToGridLabel: s.GridView,
            NominalLabel: s.Nominal,
            SlightLabel: s.SlightDeviation,
            SignificantLabel: s.SignificantDeviation,
            HasCells: cells.Count > 0,
            CellTiles: BuildCellTiles(r, s),
            HeatmapEmptyMessage: s.NoCellReadings,
            BarChart: BuildBarChart(r, s),
            Distribution: BuildDistribution(r, s),
            ImbalanceTrend: BuildImbalanceTrend(r, s, now),
            OverTime: BuildOverTime(r, s, now),
            TableTitle: s.CellDetails,
            CountBadgeText: $"{cells.Count} {s.CellsLower}",
            CellColumnHeader: s.CellHash,
            VoltageColumnHeader: s.VoltageV,
            DeltaColumnHeader: s.DeltaMv,
            StatusColumnHeader: s.Status,
            Rows: BuildRows(r, s),
            TableEmptyMessage: s.NoCellDetails,
            SpreadTrend: BuildSpreadTrend(r, s, now),
            SpreadTrendAria: s.SpreadTrendAria,
            TempTitle: s.TempTitle,
            HasTemperature: snapshot.HasData,
            TemperatureMetrics: BuildTemperatureMetrics(r, units, s),
            TempEmptyMessage: s.TempEmpty,
            RecommendationsTitle: s.Recommendations,
            Insights: BuildInsights(r, s),
            NoInsightsMessage: s.NoInsights,
            SummaryStats: BuildSummaryStats(r, units, s),
            AutomationName: $"{s.Title}. {s.Subtitle}");

        return display;
    }

    /// <summary>Classify a cell's deviation from the pack average (web <c>cellColor</c> mV thresholds).</summary>
    public static StatusKind DeviationStatus(double voltage, double average)
    {
        double deltaMv = Math.Abs(voltage - average) * 1000.0;
        if (deltaMv < NominalThresholdMv)
        {
            return StatusKind.Success;
        }

        return deltaMv < WarningThresholdMv ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Map a backend cell status to a badge variant (web <c>statusVariant</c>).</summary>
    public static StatusKind StatusVariant(string status) => status switch
    {
        "normal" => StatusKind.Success,
        "low" => StatusKind.Warning,
        "high" => StatusKind.Warning,
        "critical" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static string StatusGlyph(string status) => status switch
    {
        "low" => ArrowDownGlyph,
        "high" => ArrowUpGlyph,
        "critical" => TrendingDownGlyph,
        _ => MinusGlyph,
    };

    private static string StatusLabel(string status, BatteryCellStrings s) => status switch
    {
        "low" => s.Low,
        "high" => s.High,
        "critical" => s.Critical,
        _ => s.Normal,
    };

    private static IReadOnlyList<CellMetricDisplay> BuildSummaryMetrics(
        BatteryCellsReport r,
        CellReadingData? minCell,
        CellReadingData? maxCell,
        BatteryCellStrings s)
    {
        string minValue = minCell is { } lo
            ? $"#{lo.CellId.ToString(CultureInfo.InvariantCulture)} {Num(lo.Voltage, 4)} V"
            : EmDash;
        string maxValue = maxCell is { } hi
            ? $"#{hi.CellId.ToString(CultureInfo.InvariantCulture)} {Num(hi.Voltage, 4)} V"
            : EmDash;
        string imbalanceBrush = r.ImbalanceMv > WarningThresholdMv ? DangerBrush
            : r.ImbalanceMv > NominalThresholdMv ? WarningBrush : SuccessBrush;

        return
        [
            Metric(s.TotalCells, Num(r.TotalCells, 0), GridGlyph, InfoBrush),
            Metric(s.AvgVoltage, $"{Num(r.AvgVoltage, 4)} V", BatteryGlyph, SuccessBrush),
            Metric(s.MinCell, minValue, ArrowDownGlyph, WarningBrush),
            Metric(s.MaxCell, maxValue, ArrowUpGlyph, AccentBrush),
            Metric(s.Imbalance, $"{Num(r.ImbalanceMv, 1)} mV", ActivityGlyph, imbalanceBrush),
            Metric(s.PackVoltage, $"{Num(r.PackVoltage, 1)} V", CpuGlyph, InfoBrush),
        ];
    }

    private static CellMetricDisplay Metric(string label, string value, string glyph, string accentBrushKey) =>
        new(label, value, glyph, accentBrushKey, $"{label}, {value}");

    private static IReadOnlyList<CellTileDisplay> BuildCellTiles(BatteryCellsReport r, BatteryCellStrings s)
    {
        if (r.Cells.Count == 0)
        {
            return Array.Empty<CellTileDisplay>();
        }

        var tiles = new List<CellTileDisplay>(r.Cells.Count);
        foreach (var cell in r.Cells)
        {
            double deltaMv = cell.DeltaFromAvg * 1000.0;
            string sign = deltaMv >= 0 ? "+" : string.Empty;
            string tooltip = $"{s.Cell} {cell.CellId.ToString(CultureInfo.InvariantCulture)}: {Num(cell.Voltage, 3)} V ({sign}{Num(deltaMv, 1)} mV)";
            tiles.Add(new CellTileDisplay(
                Id: cell.CellId.ToString(CultureInfo.InvariantCulture),
                VoltageText: Num(cell.Voltage, 3),
                Deviation: DeviationStatus(cell.Voltage, r.AvgVoltage),
                AutomationName: tooltip));
        }

        return tiles;
    }

    private static CellChartDisplay BuildBarChart(BatteryCellsReport r, BatteryCellStrings s)
    {
        if (r.Cells.Count == 0)
        {
            return CellChartDisplay.EmptyChart(s.CellBarChart, s.CellHash, s.NoCellReadings);
        }

        var points = new List<ChartPoint>(r.Cells.Count);
        foreach (var cell in r.Cells)
        {
            points.Add(new ChartPoint(cell.CellId, cell.Voltage, cell.CellId.ToString(CultureInfo.InvariantCulture)));
        }

        var series = new List<ChartSeries>
        {
            new(s.Voltage, points) { Kind = ChartSeriesKind.Bar, ColorIndex = 0, Unit = "V", Decimals = 4 },
        };

        var annotations = new List<ChartAnnotation>
        {
            new("avg", ChartAnnotationKind.HorizontalLine, r.AvgVoltage) { Label = s.Avg },
            new("min", ChartAnnotationKind.HorizontalLine, r.MinVoltage) { Label = s.Min },
            new("max", ChartAnnotationKind.HorizontalLine, r.MaxVoltage) { Label = s.Max },
        };

        return new CellChartDisplay(true, s.CellBarChart, s.VoltageV, series, annotations, s.NoCellReadings);
    }

    private static CellChartDisplay BuildDistribution(BatteryCellsReport r, BatteryCellStrings s)
    {
        var buckets = Histogram(r.Cells);
        if (buckets.Count == 0)
        {
            return CellChartDisplay.EmptyChart(s.VoltageDistribution, s.Cells, s.NoCellReadings);
        }

        var points = new List<ChartPoint>(buckets.Count);
        for (int i = 0; i < buckets.Count; i++)
        {
            points.Add(new ChartPoint(i, buckets[i].Count, buckets[i].Bucket));
        }

        var series = new List<ChartSeries>
        {
            new(s.CellCount, points) { Kind = ChartSeriesKind.Bar, ColorIndex = 2, Decimals = 0 },
        };

        return new CellChartDisplay(true, s.VoltageDistribution, s.Cells, series, Array.Empty<ChartAnnotation>(), s.NoCellReadings);
    }

    private static CellChartDisplay BuildImbalanceTrend(BatteryCellsReport r, BatteryCellStrings s, DateTimeOffset now)
    {
        if (r.History.Count == 0)
        {
            return CellChartDisplay.EmptyChart(s.ImbalanceTrend, s.ImbalanceMv, s.NoCellReadings);
        }

        var points = new List<ChartPoint>(r.History.Count);
        for (int i = 0; i < r.History.Count; i++)
        {
            points.Add(new ChartPoint(i, r.History[i].ImbalanceMv, FormatDate(r.History[i].Timestamp, now)));
        }

        var series = new List<ChartSeries>
        {
            new(s.ImbalanceMv, points) { Kind = ChartSeriesKind.Line, ColorIndex = 3, Unit = "mV", Decimals = 1 },
        };

        var annotations = new List<ChartAnnotation>
        {
            new("nominal", ChartAnnotationKind.HorizontalLine, NominalThresholdMv) { Label = s.NominalRef },
            new("warning", ChartAnnotationKind.HorizontalLine, WarningThresholdMv) { Label = s.Warning },
        };

        return new CellChartDisplay(true, s.ImbalanceTrend, s.ImbalanceMv, series, annotations, s.NoCellReadings);
    }

    private static CellChartDisplay BuildOverTime(BatteryCellsReport r, BatteryCellStrings s, DateTimeOffset now)
    {
        if (r.History.Count == 0)
        {
            return CellChartDisplay.EmptyChart(s.CellVoltageOverTime, s.VoltageV, s.NoCellReadings);
        }

        var min = new List<ChartPoint>(r.History.Count);
        var avg = new List<ChartPoint>(r.History.Count);
        var max = new List<ChartPoint>(r.History.Count);
        for (int i = 0; i < r.History.Count; i++)
        {
            string label = FormatDate(r.History[i].Timestamp, now);
            min.Add(new ChartPoint(i, r.History[i].MinVoltage, label));
            avg.Add(new ChartPoint(i, r.History[i].AvgVoltage, label));
            max.Add(new ChartPoint(i, r.History[i].MaxVoltage, label));
        }

        var series = new List<ChartSeries>
        {
            new(s.MinVoltage, min) { Kind = ChartSeriesKind.Line, ColorIndex = 5, Unit = "V", Decimals = 3 },
            new(s.AvgVoltageSeries, avg) { Kind = ChartSeriesKind.Line, ColorIndex = 0, Unit = "V", Decimals = 3 },
            new(s.MaxVoltage, max) { Kind = ChartSeriesKind.Line, ColorIndex = 1, Unit = "V", Decimals = 3 },
        };

        return new CellChartDisplay(true, s.CellVoltageOverTime, s.VoltageV, series, Array.Empty<ChartAnnotation>(), s.NoCellReadings);
    }

    private static CellChartDisplay BuildSpreadTrend(BatteryCellsReport r, BatteryCellStrings s, DateTimeOffset now)
    {
        if (r.History.Count == 0)
        {
            return CellChartDisplay.EmptyChart(s.SpreadTrend, s.ImbalanceMv, s.NoSpreadTrend);
        }

        var points = new List<ChartPoint>(r.History.Count);
        for (int i = 0; i < r.History.Count; i++)
        {
            double spreadMv = (r.History[i].MaxVoltage - r.History[i].MinVoltage) * 1000.0;
            points.Add(new ChartPoint(i, spreadMv, FormatDate(r.History[i].Timestamp, now)));
        }

        var series = new List<ChartSeries>
        {
            new(s.VoltageSpread, points) { Kind = ChartSeriesKind.Area, ColorIndex = 4, Unit = "mV", Decimals = 1 },
        };

        var annotations = new List<ChartAnnotation>
        {
            new("nominal", ChartAnnotationKind.HorizontalLine, NominalThresholdMv) { Label = s.NominalRef },
            new("warning", ChartAnnotationKind.HorizontalLine, WarningThresholdMv) { Label = s.Warning },
        };

        return new CellChartDisplay(true, s.SpreadTrend, s.ImbalanceMv, series, annotations, s.NoSpreadTrend);
    }

    private static IReadOnlyList<CellRowDisplay> BuildRows(BatteryCellsReport r, BatteryCellStrings s)
    {
        if (r.Cells.Count == 0)
        {
            return Array.Empty<CellRowDisplay>();
        }

        var sorted = r.Cells.OrderBy(static c => c.CellId).ToList();
        var rows = new List<CellRowDisplay>(sorted.Count);
        foreach (var cell in sorted)
        {
            double deltaMv = cell.DeltaFromAvg * 1000.0;
            string sign = deltaMv >= 0 ? "+" : string.Empty;
            StatusKind deltaStatus = deltaMv > 0 ? StatusKind.Success : deltaMv < 0 ? StatusKind.Danger : StatusKind.Neutral;
            rows.Add(new CellRowDisplay(
                Id: cell.CellId.ToString(CultureInfo.InvariantCulture),
                CellLabel: cell.CellId.ToString(CultureInfo.InvariantCulture),
                VoltageText: Num(cell.Voltage, 4),
                DeltaText: $"{sign}{Num(deltaMv, 1)}",
                DeltaStatus: deltaStatus,
                StatusGlyph: StatusGlyph(cell.Status),
                StatusText: StatusLabel(cell.Status, s),
                StatusBadge: StatusVariant(cell.Status)));
        }

        return rows;
    }

    private static IReadOnlyList<CellMetricDisplay> BuildTemperatureMetrics(
        BatteryCellsReport r,
        UnitPref units,
        BatteryCellStrings s)
    {
        string spreadBrush = r.TempSpread > 5 ? DangerBrush : r.TempSpread > 3 ? WarningBrush : SuccessBrush;
        return
        [
            Metric(s.TempAvg, UnitFormatters.FormatTemperature(r.AvgTemperature, units, 1), ThermometerGlyph, SuccessBrush),
            Metric(s.TempMin, UnitFormatters.FormatTemperature(r.MinTemperature, units, 1), ArrowDownGlyph, InfoBrush),
            Metric(s.TempMax, UnitFormatters.FormatTemperature(r.MaxTemperature, units, 1), ArrowUpGlyph, WarningBrush),
            Metric(s.TempSpread, TempDelta(r.TempSpread, units), ActivityGlyph, spreadBrush),
        ];
    }

    private static List<CellInsightDisplay> BuildInsights(BatteryCellsReport r, BatteryCellStrings s)
    {
        var items = new List<CellInsightDisplay>(3);

        if (r.ImbalanceMv > WarningThresholdMv)
        {
            items.Add(new CellInsightDisplay(LightningGlyph, s.HighSpread, s.HighSpreadDesc, StatusKind.Danger, s.HighSpread));
        }
        else if (r.ImbalanceMv > NominalThresholdMv)
        {
            items.Add(new CellInsightDisplay(LightningGlyph, s.WatchSpread, s.WatchSpreadDesc, StatusKind.Warning, s.WatchSpread));
        }
        else
        {
            items.Add(new CellInsightDisplay(CheckCircleGlyph, s.Balanced, s.BalancedDesc, StatusKind.Success, s.Balanced));
        }

        if (r.TempSpread > 5)
        {
            items.Add(new CellInsightDisplay(ThermometerGlyph, s.HighTemp, s.HighTempDesc, StatusKind.Danger, s.HighTemp));
        }
        else if (r.TempSpread > 3)
        {
            items.Add(new CellInsightDisplay(ThermometerGlyph, s.WatchTemp, s.WatchTempDesc, StatusKind.Warning, s.WatchTemp));
        }
        else
        {
            items.Add(new CellInsightDisplay(ThermometerGlyph, s.GoodTemp, s.GoodTempDesc, StatusKind.Success, s.GoodTemp));
        }

        int criticalCells = 0;
        foreach (var cell in r.Cells)
        {
            if (string.Equals(cell.Status, "critical", StringComparison.Ordinal))
            {
                criticalCells++;
            }
        }

        if (criticalCells > 0)
        {
            string desc = s.CriticalCellsDesc.Replace(
                "{{count}}",
                criticalCells.ToString(CultureInfo.InvariantCulture),
                StringComparison.Ordinal);
            items.Add(new CellInsightDisplay(WarningGlyph, s.CriticalCells, desc, StatusKind.Danger, s.CriticalCells));
        }
        else
        {
            items.Add(new CellInsightDisplay(ShieldGlyph, s.Healthy, s.HealthyDesc, StatusKind.Success, s.Healthy));
        }

        return items;
    }

    private static IReadOnlyList<CellSummaryStatDisplay> BuildSummaryStats(
        BatteryCellsReport r,
        UnitPref units,
        BatteryCellStrings s)
    {
        int normalCells = 0;
        foreach (var cell in r.Cells)
        {
            if (string.Equals(cell.Status, "normal", StringComparison.Ordinal))
            {
                normalCells++;
            }
        }

        string spreadBrush = r.ImbalanceMv > WarningThresholdMv ? DangerBrush
            : r.ImbalanceMv > NominalThresholdMv ? WarningBrush : SuccessBrush;
        string tempBrush = r.TempSpread > 5 ? DangerBrush : r.TempSpread > 3 ? WarningBrush : SuccessBrush;

        return
        [
            new CellSummaryStatDisplay(s.StatTotalCells, Num(r.TotalCells, 0), InfoBrush, $"{s.StatTotalCells}, {r.TotalCells}"),
            new CellSummaryStatDisplay(s.StatPackVoltage, $"{Num(r.PackVoltage, 1)} V", SuccessBrush, $"{s.StatPackVoltage}, {Num(r.PackVoltage, 1)} V"),
            new CellSummaryStatDisplay(s.StatAvgVoltage, $"{Num(r.AvgVoltage, 4)} V", TextPrimaryBrush, $"{s.StatAvgVoltage}, {Num(r.AvgVoltage, 4)} V"),
            new CellSummaryStatDisplay(s.StatVoltageSpread, $"{Num(r.ImbalanceMv, 1)} mV", spreadBrush, $"{s.StatVoltageSpread}, {Num(r.ImbalanceMv, 1)} mV"),
            new CellSummaryStatDisplay(s.StatTempSpread, TempDelta(r.TempSpread, units), tempBrush, $"{s.StatTempSpread}, {TempDelta(r.TempSpread, units)}"),
            new CellSummaryStatDisplay(s.StatNormalCells, $"{normalCells.ToString(CultureInfo.InvariantCulture)}/{r.TotalCells.ToString(CultureInfo.InvariantCulture)}", SuccessBrush, $"{s.StatNormalCells}, {normalCells}/{r.TotalCells}"),
        ];
    }

    /// <summary>Build a voltage-distribution histogram (web <c>buildHistogram</c>): 6–12 even buckets.</summary>
    private static IReadOnlyList<(string Bucket, int Count)> Histogram(IReadOnlyList<CellReadingData> cells)
    {
        if (cells.Count == 0)
        {
            return Array.Empty<(string, int)>();
        }

        double min = double.PositiveInfinity;
        double max = double.NegativeInfinity;
        foreach (var cell in cells)
        {
            min = Math.Min(min, cell.Voltage);
            max = Math.Max(max, cell.Voltage);
        }

        double range = max - min;
        int bucketCount = Math.Max(6, Math.Min(12, (int)Math.Ceiling(cells.Count / 4.0)));
        double step = range > 0 ? range / bucketCount : 0.001;

        var counts = new int[bucketCount];
        foreach (var cell in cells)
        {
            int idx = Math.Min((int)Math.Floor((cell.Voltage - min) / step), bucketCount - 1);
            counts[Math.Max(0, idx)]++;
        }

        var buckets = new List<(string, int)>(bucketCount);
        for (int i = 0; i < bucketCount; i++)
        {
            double lo = min + (i * step);
            double hi = min + ((i + 1) * step);
            buckets.Add(($"{Num(lo, 3)}\u2013{Num(hi, 3)}", counts[i]));
        }

        return buckets;
    }

    private static string TempDelta(double celsiusSpread, UnitPref units)
    {
        double scaled = units.Temperature == TemperatureUnit.Fahrenheit ? celsiusSpread * 1.8 : celsiusSpread;
        return $"{Num(scaled, 1)}{UnitLabels.Label(units.Temperature)}";
    }

    private static string FormatDate(string raw, DateTimeOffset now)
    {
        if (DateTimeOffset.TryParse(
                raw,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var dto))
        {
            return DateTimeFormatting.Format(dto, DateTimeVariant.Date, now);
        }

        return string.IsNullOrEmpty(raw) ? EmDash : raw;
    }

    private static double Safe(double value) => double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;

    private static string Num(double value, int precision) => ScalarFormatters.FormatNumber(Safe(value), precision);
}

/// <summary>
/// PII-safe diagnostics for the <c>BatteryCellsPage</c> surface — emits a single <c>view.opened</c> event
/// (slug only; never a VIN / vehicle id) so usage is observable without leaking telemetry.
/// </summary>
public sealed class BatteryCellsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public BatteryCellsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=BatteryCellsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={BatteryCellsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>BatteryCellsPage</c> feature surface — the native mirror of the web page
/// at <c>web/src/features/battery/pages/BatteryCellsPage.tsx</c> (route <c>/battery-cells</c>, nav name
/// <c>BatteryCells</c>). Holds the route name, the generated operation id it binds to, the diagnostics slug,
/// the empty-surface glyph and the localized title.
/// </summary>
public static class BatteryCellsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BatteryCellsPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "BatteryCells";

    /// <summary>The generated operation id for the battery-cells analytics read (web <c>/analytics/battery-cells</c>).</summary>
    public const string CellsOperation = Operations.Analytics.BatteryCells;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface.</summary>
    public const string EmptyGlyph = BatteryCellsProjection.BatteryGlyph;

    /// <summary>The localized page title (web <c>t('Battery Cells')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Battery Cells", "Battery Cells");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case battery-cells JSON wire shape (no camelCaseKeys transform on
/// native): numbers (or numeric strings), strings and arrays of objects. Kept internal to this surface so
/// the page's parsers stay self-contained and never throw on a partial body.
/// </summary>
internal static class CellsJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? s = v.GetString();
            return string.IsNullOrEmpty(s) ? null : s;
        }

        return null;
    }

    /// <summary>Projects each element of an array property through <paramref name="map"/> (empty when absent).</summary>
    public static IReadOnlyList<T> Array<T>(JsonElement obj, string name, Func<JsonElement, T> map)
    {
        if (!obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<T>();
        }

        var list = new List<T>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            list.Add(map(item));
        }

        return list;
    }
}
