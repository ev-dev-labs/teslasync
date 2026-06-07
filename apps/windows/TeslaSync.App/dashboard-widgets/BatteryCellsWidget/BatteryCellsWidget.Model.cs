using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BatteryCellsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>BatteryCellsWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/BatteryCellsWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web outer <c>{data ? … : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle / no response body) — distinct from the inner empty grid (no cells),
/// which is rendered as part of <see cref="Loaded"/> with the "No cell data" message.
/// </summary>
public enum BatteryCellsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a cell summary to show.</summary>
    Loaded,

    /// <summary>No vehicle resolved or no response body — render the "No battery cell data" empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The per-cell severity the voltage heatmap colours a tile with — the native union of the web
/// <c>StatusCell['status']</c> values the shared <c>WidgetStatusGrid</c> renders. Derived from how far
/// a cell's voltage deviates from the pack average (web <c>cellStatus</c>): ≤5&#160;mV → <see cref="Ok"/>,
/// ≤15&#160;mV → <see cref="Warning"/>, &gt;15&#160;mV → <see cref="Error"/>, missing voltage →
/// <see cref="Unknown"/>.
/// </summary>
public enum BatteryCellSeverity
{
    /// <summary>Within 5&#160;mV of the average (web <c>'ok'</c>).</summary>
    Ok,

    /// <summary>5–15&#160;mV from the average (web <c>'warning'</c>).</summary>
    Warning,

    /// <summary>More than 15&#160;mV from the average (web <c>'error'</c>).</summary>
    Error,

    /// <summary>No voltage reported for the cell (web <c>'unknown'</c>).</summary>
    Unknown,
}

/// <summary>
/// One battery brick reading from <c>GET /vehicles/{vehicleID}/battery/cells</c> — the native mirror of
/// the web <c>BatteryCell</c> type (web/src/types/energy.ts): identity (<c>cell_id</c>, <c>module</c>) plus
/// the measured <c>voltage</c> (volts, SI) and <c>temperature</c> (°C, SI). Parsing is null-tolerant so a
/// partial body never throws; <see cref="Voltage"/> stays null when the brick reported no voltage so the
/// heatmap can render the web <c>'unknown'</c> status rather than a fabricated value.
/// </summary>
public sealed record BatteryCell(int CellId, int Module, double? Voltage, double? Temperature)
{
    /// <summary>Project one cell object into a tolerant reading (binds to the web <c>BatteryCell</c> contract).</summary>
    public static BatteryCell FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new BatteryCell(0, 0, null, null);
        }

        return new BatteryCell(
            CellId: (int)Math.Round(JsonNum.Double(element, "cell_id") ?? 0),
            Module: (int)Math.Round(JsonNum.Double(element, "module") ?? 0),
            Voltage: JsonNum.Double(element, "voltage"),
            Temperature: JsonNum.Double(element, "temperature"));
    }
}

/// <summary>
/// The battery cell rollup from <c>GET /vehicles/{vehicleID}/battery/cells</c> (web <c>useBatteryCells</c>,
/// shape <c>BatteryCellSummary</c> in web/src/types/energy.ts). Field names mirror the Go API's snake_case
/// JSON tags. All voltages are volts and temperatures are °C (SI); they are formatted for display only at
/// projection time and never unit-converted (the web widget shows raw volts / °, matching this). Parsing is
/// null-tolerant so a partial body never throws.
/// </summary>
public sealed record BatteryCellSummary(
    double AvgVoltage,
    double MinVoltage,
    double MaxVoltage,
    double VoltageSpread,
    double AvgTemperature,
    double MinTemperature,
    double MaxTemperature,
    double TempSpread,
    int TotalCells,
    IReadOnlyList<BatteryCell> Cells)
{
    /// <summary>An all-zero summary with no cells — the parse fallback for an absent/non-object body.</summary>
    public static BatteryCellSummary Empty { get; } = new(
        0, 0, 0, 0, 0, 0, 0, 0, 0, Array.Empty<BatteryCell>());

    /// <summary>Project a <c>GET /vehicles/{vehicleID}/battery/cells</c> JSON object into a tolerant summary.</summary>
    public static BatteryCellSummary FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new BatteryCellSummary(
            AvgVoltage: JsonNum.Double(element, "avg_voltage") ?? 0,
            MinVoltage: JsonNum.Double(element, "min_voltage") ?? 0,
            MaxVoltage: JsonNum.Double(element, "max_voltage") ?? 0,
            VoltageSpread: JsonNum.Double(element, "voltage_spread") ?? 0,
            AvgTemperature: JsonNum.Double(element, "avg_temperature") ?? 0,
            MinTemperature: JsonNum.Double(element, "min_temperature") ?? 0,
            MaxTemperature: JsonNum.Double(element, "max_temperature") ?? 0,
            TempSpread: JsonNum.Double(element, "temp_spread") ?? 0,
            TotalCells: (int)Math.Round(JsonNum.Double(element, "total_cells") ?? 0),
            Cells: ReadCells(element));
    }

    private static IReadOnlyList<BatteryCell> ReadCells(JsonElement element)
    {
        if (!element.TryGetProperty("cells", out var cells) || cells.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<BatteryCell>();
        }

        var list = new List<BatteryCell>(cells.GetArrayLength());
        foreach (var cell in cells.EnumerateArray())
        {
            list.Add(BatteryCell.FromJson(cell));
        }

        return list;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isWide</c> / heatmap-column logic in
/// web/src/features/dashboard/widgets/BatteryCellsWidget.tsx.
/// </summary>
public readonly record struct BatteryCellsSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static BatteryCellsSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): hide the title, tighten the grid.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide = size.cols &gt;= 3</c>): per-cell temperature + a temp row.</summary>
    public bool IsWide => Cols >= 3;

    /// <summary>Heatmap column count (web <c>cols={isWide ? 4 : isCompact ? 2 : 3}</c>).</summary>
    public int GridColumns => IsWide ? 4 : IsCompact ? 2 : 3;
}

/// <summary>
/// One projected, display-ready heatmap tile consumed by the WinUI view — the native analogue of a web
/// <c>StatusCell</c>. Holds the localized label, the already-formatted value, the derived severity (which
/// the view maps to a themed status brush) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
public sealed record BatteryCellStatusItem(
    string Id,
    string Label,
    BatteryCellSeverity Severity,
    string Value,
    string AutomationName);

/// <summary>
/// One projected stat tile (min/max/avg/spread or per-module temperature) — the native analogue of a web
/// <c>StatCard</c>. Holds the localized label and the already-formatted value. Pure data.
/// </summary>
public sealed record BatteryCellsStat(string Label, string Value);

/// <summary>
/// The fully projected, render-ready view of the battery cell summary for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// heatmap tiles, the four voltage stats, and (when wide) the three temperature stats, plus the footprint
/// flags. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record BatteryCellsDisplay(
    bool IsCompact,
    bool IsWide,
    int GridColumns,
    IReadOnlyList<BatteryCellStatusItem> Cells,
    string CellsEmptyMessage,
    IReadOnlyList<BatteryCellsStat> VoltageStats,
    bool ShowTemperature,
    IReadOnlyList<BatteryCellsStat> TemperatureStats)
{
    /// <summary>True when the heatmap has at least one cell (web <c>cells.length &gt; 0</c>).</summary>
    public bool HasCells => Cells.Count > 0;
}

/// <summary>
/// Pure projection from a raw <see cref="BatteryCellSummary"/> to the display model — the native port of
/// the <c>cellStatus</c> helper and the <c>statusCells</c>/stat <c>useMemo</c>s in
/// web/src/features/dashboard/widgets/BatteryCellsWidget.tsx. Voltages/temperatures are already SI and need
/// no conversion (the web widget shows raw volts / °), so this only formats and labels; every label resolves
/// through the i18n facade.
/// </summary>
public static class BatteryCellsProjection
{
    /// <summary>Fluent "Processor" glyph for the surface header / empty state (web <c>Cpu</c>).</summary>
    public const string HeaderGlyph = "\uE964";

    /// <summary>Deviation (mV) at or under which a cell is healthy (web <c>deviationMv &lt;= 5</c>).</summary>
    public const double OkThresholdMv = 5;

    /// <summary>Deviation (mV) at or under which a cell is a warning (web <c>deviationMv &lt;= 15</c>).</summary>
    public const double WarningThresholdMv = 15;

    private const string Degree = "\u00B0";

    /// <summary>
    /// Derive a cell's severity from how far its voltage deviates from the pack average (web
    /// <c>cellStatus</c>): missing voltage → <see cref="BatteryCellSeverity.Unknown"/>; otherwise
    /// ≤5&#160;mV → <see cref="BatteryCellSeverity.Ok"/>, ≤15&#160;mV → <see cref="BatteryCellSeverity.Warning"/>,
    /// else <see cref="BatteryCellSeverity.Error"/>.
    /// </summary>
    public static BatteryCellSeverity SeverityFor(double? voltage, double avgVoltage)
    {
        if (voltage is not { } v || double.IsNaN(v) || double.IsInfinity(v))
        {
            return BatteryCellSeverity.Unknown;
        }

        double deviationMv = Math.Abs(v - avgVoltage) * 1000;
        if (deviationMv <= OkThresholdMv)
        {
            return BatteryCellSeverity.Ok;
        }

        return deviationMv <= WarningThresholdMv ? BatteryCellSeverity.Warning : BatteryCellSeverity.Error;
    }

    /// <summary>Maps a cell severity to the shared semantic status used for its themed heatmap brush.</summary>
    public static StatusKind ToStatusKind(BatteryCellSeverity severity) => severity switch
    {
        BatteryCellSeverity.Ok => StatusKind.Success,
        BatteryCellSeverity.Warning => StatusKind.Warning,
        BatteryCellSeverity.Error => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static BatteryCellsDisplay Project(
        BatteryCellSummary data,
        BatteryCellsSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        bool wide = size.IsWide;
        string cellWord = localizer.GetString("widget.batteryCells.cell", "Cell");
        double avgV = data.AvgVoltage;

        var cells = new List<BatteryCellStatusItem>(data.Cells.Count);
        foreach (var cell in data.Cells)
        {
            var severity = SeverityFor(cell.Voltage, avgV);
            string label = wide
                ? string.Create(CultureInfo.CurrentCulture, $"{cellWord} {cell.CellId} \u00B7 M{cell.Module}")
                : string.Create(CultureInfo.CurrentCulture, $"C{cell.CellId}");
            string value = wide
                ? $"{Fmt(cell.Voltage, 3)} V / {Fmt(cell.Temperature, 1)}{Degree}"
                : $"{Fmt(cell.Voltage, 3)} V";

            cells.Add(new BatteryCellStatusItem(
                Id: cell.CellId.ToString(CultureInfo.InvariantCulture),
                Label: label,
                Severity: severity,
                Value: value,
                AutomationName: $"{label}, {value}"));
        }

        var voltageStats = new List<BatteryCellsStat>(4)
        {
            new(localizer.GetString("widget.batteryCells.minV", "Min V"), $"{Fmt(data.MinVoltage, 3)} V"),
            new(localizer.GetString("widget.batteryCells.maxV", "Max V"), $"{Fmt(data.MaxVoltage, 3)} V"),
            new(localizer.GetString("widget.batteryCells.avgV", "Avg V"), $"{Fmt(avgV, 3)} V"),
            new(localizer.GetString("widget.batteryCells.spread", "Spread"), $"{Fmt(data.VoltageSpread * 1000, 1)} mV"),
        };

        IReadOnlyList<BatteryCellsStat> temperatureStats = wide
            ? new List<BatteryCellsStat>(3)
            {
                new(localizer.GetString("widget.batteryCells.minTemp", "Min Temp"), $"{Fmt(data.MinTemperature, 1)}{Degree}"),
                new(localizer.GetString("widget.batteryCells.avgTemp", "Avg Temp"), $"{Fmt(data.AvgTemperature, 1)}{Degree}"),
                new(localizer.GetString("widget.batteryCells.maxTemp", "Max Temp"), $"{Fmt(data.MaxTemperature, 1)}{Degree}"),
            }
            : Array.Empty<BatteryCellsStat>();

        return new BatteryCellsDisplay(
            IsCompact: size.IsCompact,
            IsWide: wide,
            GridColumns: size.GridColumns,
            Cells: cells,
            CellsEmptyMessage: localizer.GetString("widget.batteryCells.noCells", "No cell data"),
            VoltageStats: voltageStats,
            ShowTemperature: wide,
            TemperatureStats: temperatureStats);
    }

    /// <summary>
    /// Format a number exactly as the web <c>fmtNumber</c> does: coerce null / NaN / ±∞ to 0 (web
    /// <c>safeNumber</c>) then render with fixed <paramref name="decimals"/> fraction digits and en-US grouping.
    /// </summary>
    private static string Fmt(double? value, int decimals)
    {
        double safe = value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0.0;
        return ScalarFormatters.FormatNumber(safe, decimals);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;BatteryCellSummary&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class BatteryCellsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<BatteryCellSummary> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        BatteryCellSummary Parse() => raw.HasValue ? BatteryCellSummary.FromJson(raw.Value) : BatteryCellSummary.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<BatteryCellSummary>.Loading(),
            LoadStatus.Cached => RepositoryResult<BatteryCellSummary>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<BatteryCellSummary>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<BatteryCellSummary>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<BatteryCellSummary>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<BatteryCellSummary>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<BatteryCellSummary>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>Null-tolerant numeric readers for the snake_case battery-cells JSON wire shape.</summary>
internal static class JsonNum
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
}
