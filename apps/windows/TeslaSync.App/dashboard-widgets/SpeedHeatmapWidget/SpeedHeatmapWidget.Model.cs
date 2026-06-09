using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SpeedHeatmapViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SpeedHeatmapWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>totalDrives &gt; 0 ? heatmap : &lt;EmptyState&gt;</c> gate (no vehicle, an empty drive list, or no drive
/// with a usable start time + positive speed) — the friendly "No drive data yet" surface. In the single-column
/// compact layout the body still renders the peak metric (with a "—" fallback) rather than the empty state,
/// faithful to the web's <c>isCompact</c> short-circuit.
/// </summary>
public enum SpeedHeatmapState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying at least one bucketed drive to render.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no drive buckets — render the "No drive data yet" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One drive projected from the drive list (web <c>Drive</c> in web/src/api/types.ts). Only the fields the web
/// <c>SpeedHeatmapWidget</c>'s <c>buildHeatmap</c> reads are kept: the SI average/maximum speeds in
/// meters-per-second (<c>avg_speed_mps</c> / <c>max_speed_mps</c>) and the <c>start_ts</c> instant used to
/// bucket the drive by local day-of-week and hour-of-day. Field names mirror the Go API's snake_case JSON tags
/// and stay SI (Phase-48 canonical); parsing is null-tolerant so a partial row never throws.
/// </summary>
/// <param name="AvgSpeedMps">Average drive speed in SI meters-per-second, or null (web <c>avg_speed_mps</c>).</param>
/// <param name="MaxSpeedMps">Maximum drive speed in SI meters-per-second, or null (web <c>max_speed_mps</c>).</param>
/// <param name="StartInstant">Parsed <c>start_ts</c> instant used to bucket the drive, or null (web <c>start_ts</c>).</param>
public sealed record DriveSample(
    double? AvgSpeedMps,
    double? MaxSpeedMps,
    DateTimeOffset? StartInstant)
{
    /// <summary>Parse a drive-list JSON array into a tolerant list of samples, preserving server order.</summary>
    public static IReadOnlyList<DriveSample> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DriveSample>();
        }

        var list = new List<DriveSample>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single drive JSON object into a tolerant sample.</summary>
    public static DriveSample FromJson(JsonElement obj) => new(
        GetDouble(obj, "avg_speed_mps"),
        GetDouble(obj, "max_speed_mps"),
        GetDateTime(obj, "start_ts"));

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt;= 1</c> and <c>isWide = size.cols &gt;= 3</c> flags in
/// web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx. Compact collapses to the single peak metric;
/// wide swaps the short day labels for full ones and adds intermediate hour ticks.
/// </summary>
public readonly record struct SpeedHeatmapSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SpeedHeatmapSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): show only the peak metric.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>True at three or more columns (web <c>isWide = size.cols &gt;= 3</c>): full labels + more hour ticks.</summary>
    public bool IsWide => Cols >= 3;
}

/// <summary>
/// An immutable RGBA colour produced by <see cref="SpeedHeatmapColors"/> — the native analogue of the web
/// <c>speedToColor</c> return value (either an interpolated <c>rgb(r,g,b)</c> cell or the faint
/// <c>rgba(255,255,255,0.03)</c> "no data" tint). Kept as plain bytes + opacity so the projection is unit-tested
/// without a UI host; the view materialises it into a <c>SolidColorBrush</c> at the render boundary.
/// </summary>
/// <param name="R">Red channel, 0–255.</param>
/// <param name="G">Green channel, 0–255.</param>
/// <param name="B">Blue channel, 0–255.</param>
/// <param name="Opacity">Alpha, 0.0–1.0 (the faint empty tint is 0.03; data cells are opaque).</param>
public readonly record struct HeatColor(byte R, byte G, byte B, double Opacity);

/// <summary>
/// Pure port of the web <c>speedToColor</c> / <c>lerpColor</c> / <c>COLOR_STOPS</c> gradient
/// (web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx): a 4-stop teal → cyan → amber → red ramp the
/// cell's speed is interpolated across (as a fraction of the grid maximum), or the faint empty tint when the
/// cell carries no drives. UI-free so the colour maths is unit-tested.
/// </summary>
public static class SpeedHeatmapColors
{
    // Web COLOR_STOPS: teal-500, cyan-500, amber-500, red-500.
    private static readonly (byte R, byte G, byte B)[] Stops =
    {
        (20, 184, 166),
        (6, 182, 212),
        (245, 158, 11),
        (239, 68, 68),
    };

    /// <summary>The faint "no data" cell tint (web <c>rgba(255,255,255,0.03)</c>).</summary>
    public static HeatColor Empty { get; } = new(255, 255, 255, 0.03);

    /// <summary>
    /// Map a cell <paramref name="speed"/> (display units) to its gradient colour relative to
    /// <paramref name="maxSpeed"/> (web <c>speedToColor</c>): non-positive speed or max collapses to
    /// <see cref="Empty"/>, otherwise the clamped fraction is interpolated across the 3 gradient segments.
    /// </summary>
    public static HeatColor CellColor(double speed, double maxSpeed)
    {
        if (speed <= 0 || maxSpeed <= 0 || double.IsNaN(speed) || double.IsNaN(maxSpeed))
        {
            return Empty;
        }

        double t = Math.Min(speed / maxSpeed, 1);
        int segCount = Stops.Length - 1;
        int seg = Math.Min((int)Math.Floor(t * segCount), segCount - 1);
        double localT = (t * segCount) - seg;
        var a = Stops[seg];
        var b = Stops[seg + 1];
        return new HeatColor(Lerp(a.R, b.R, localT), Lerp(a.G, b.G, localT), Lerp(a.B, b.B, localT), 1.0);
    }

    private static byte Lerp(byte a, byte b, double t) =>
        (byte)Math.Clamp(Math.Round(a + ((b - a) * t), MidpointRounding.AwayFromZero), 0, 255);
}

/// <summary>
/// One projected heatmap cell consumed by the WinUI view — its grid coordinates (<see cref="Day"/> 0=Mon…6=Sun,
/// <see cref="Hour"/> 0–23), the already-resolved <see cref="Color"/>, the drive <see cref="Count"/> and the
/// localized hover/Narrator <see cref="Tooltip"/> (the native analogue of the web SVG <c>&lt;title&gt;</c>).
/// <see cref="AutomationName"/> is non-null only for cells that carry drives, so empty cells stay out of the
/// Narrator tree while still exposing a tooltip.
/// </summary>
public sealed record HeatCellView(
    int Day,
    int Hour,
    HeatColor Color,
    int Count,
    double AvgSpeed,
    string Tooltip,
    string? AutomationName);

/// <summary>
/// The fully projected, render-ready view of the speed heatmap for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the 7×24 grid, the peak/total derivations, the
/// compact peak metric, the summary line, the legend swatches and the day/hour tick labels). Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
public sealed record SpeedHeatmapDisplay(
    bool IsCompact,
    bool IsWide,
    bool HasData,
    double MaxSpeed,
    int TotalDrives,
    string PeakValueText,
    string PeakUnitCaption,
    string PeakAutomationName,
    string SummaryDrivesText,
    string SummaryPeakText,
    IReadOnlyList<HeatCellView> Cells,
    IReadOnlyList<string> DayLabels,
    IReadOnlyList<int> HourLabels,
    IReadOnlyList<HeatColor> LegendColors,
    string SlowLabel,
    string FastLabel,
    string HeatmapAutomationName);

/// <summary>
/// Pure projection from the raw drive list to the display model — the native port of the <c>buildHeatmap</c>
/// accumulator, the <c>maxSpeed</c>/<c>totalDrives</c> derivations, the <c>speedToColor</c> tinting, the compact
/// peak metric, the summary line and the legend in web/src/features/dashboard/widgets/SpeedHeatmapWidget.tsx.
/// Speeds are accumulated in SI meters-per-second and only the per-cell average is converted to the user's
/// display unit (exactly as the web's <c>convertSpeedFromSI(total / count, speedUnit)</c> does, and only here);
/// drives are bucketed by their local day-of-week and hour-of-day. Every label resolves through the i18n facade.
/// </summary>
public static class SpeedHeatmapProjection
{
    /// <summary>Grid rows — Monday … Sunday (web <c>ROWS = 7</c>).</summary>
    public const int Rows = 7;

    /// <summary>Grid columns — hour 0 … 23 (web <c>COLS = 24</c>).</summary>
    public const int Cols = 24;

    /// <summary>
    /// Newest drives bucketed into the grid (web query <c>?limit=200</c>). The generated
    /// <c>get_api_v1_drives</c> endpoint declares only <c>vehicle_id</c> (no <c>limit</c>) and returns drives
    /// newest-first, so the web's row cap is applied here during projection rather than as a query parameter.
    /// </summary>
    public const int DriveLimit = 200;

    /// <summary>Segoe Fluent "GridView" glyph for the title row + empty state (web <c>Grid3X3</c> icon).</summary>
    public const string HeaderGlyph = "\uE80A";

    private const string EmDash = "\u2014";
    private const string EnDash = "\u2013";

    // Web DAY_LABELS_SHORT / DAY_LABELS_FULL.
    private static readonly string[] DayLabelsShort = { "M", "T", "W", "T", "F", "S", "S" };
    private static readonly string[] DayLabelsFull = { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };

    // Web hour tick rows: wide shows every 3rd hour, otherwise every 6th.
    private static readonly int[] HourLabelsWide = { 0, 3, 6, 9, 12, 15, 18, 21 };
    private static readonly int[] HourLabelsNarrow = { 0, 6, 12, 18 };

    // Web legend stops: [0, 0.25, 0.5, 0.75, 1] across (maxSpeed || 1).
    private static readonly double[] LegendStops = { 0, 0.25, 0.5, 0.75, 1 };

    /// <summary>
    /// Project <paramref name="drives"/> for <paramref name="size"/> using the user's speed unit and the local
    /// <paramref name="timeZone"/> for day/hour bucketing.
    /// </summary>
    public static SpeedHeatmapDisplay Project(
        IReadOnlyList<DriveSample> drives,
        SpeedHeatmapSize size,
        UnitPref units,
        TimeZoneInfo timeZone,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(drives);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(timeZone);
        ArgumentNullException.ThrowIfNull(localizer);

        var total = new double[Rows, Cols];
        var count = new int[Rows, Cols];

        // Web parity: only the newest `limit=200` drives feed the heatmap (the list arrives newest-first).
        int take = Math.Min(drives.Count, DriveLimit);
        for (int i = 0; i < take; i++)
        {
            var d = drives[i];
            if (d.StartInstant is not { } start)
            {
                continue;
            }

            double? speed = d.AvgSpeedMps ?? d.MaxSpeedMps;
            if (speed is not { } mps || mps <= 0 || double.IsNaN(mps) || double.IsInfinity(mps))
            {
                continue;
            }

            var local = TimeZoneInfo.ConvertTime(start, timeZone);
            int day = local.DayOfWeek == DayOfWeek.Sunday ? Rows - 1 : (int)local.DayOfWeek - 1;
            int hour = local.Hour;
            if (day < 0 || day >= Rows || hour < 0 || hour >= Cols)
            {
                continue;
            }

            total[day, hour] += mps;
            count[day, hour] += 1;
        }

        // First pass: per-cell average (display units) + grid maximum + total drive count.
        var avg = new double[Rows, Cols];
        double maxSpeed = 0;
        int totalDrives = 0;
        for (int day = 0; day < Rows; day++)
        {
            for (int hour = 0; hour < Cols; hour++)
            {
                int c = count[day, hour];
                double a = c > 0 ? UnitConverters.SpeedFromSi(total[day, hour] / c, units.Speed) : 0;
                avg[day, hour] = a;
                if (a > maxSpeed)
                {
                    maxSpeed = a;
                }

                totalDrives += c;
            }
        }

        string unitLabel = UnitLabels.Label(units.Speed);
        bool isWide = size.IsWide;
        var dayLabels = isWide ? DayLabelsFull : DayLabelsShort;
        var hourLabels = isWide ? HourLabelsWide : HourLabelsNarrow;

        // Second pass: cells coloured against the grid maximum (web speedToColor(cell.avgSpeed, maxSpeed)).
        var cells = new List<HeatCellView>(Rows * Cols);
        for (int day = 0; day < Rows; day++)
        {
            for (int hour = 0; hour < Cols; hour++)
            {
                int c = count[day, hour];
                double a = avg[day, hour];
                string tooltip = BuildTooltip(dayLabels[day], hour, a, c, unitLabel, localizer);
                cells.Add(new HeatCellView(
                    day,
                    hour,
                    SpeedHeatmapColors.CellColor(a, maxSpeed),
                    c,
                    a,
                    tooltip,
                    c > 0 ? tooltip : null));
            }
        }

        double legendRef = maxSpeed > 0 ? maxSpeed : 1;
        var legend = new List<HeatColor>(LegendStops.Length);
        foreach (double stop in LegendStops)
        {
            legend.Add(SpeedHeatmapColors.CellColor(stop * legendRef, legendRef));
        }

        string peakValueText = maxSpeed > 0 ? ScalarFormatters.FormatNumber(maxSpeed, 0) : EmDash;
        string peakWord = localizer.GetString("widget.speedHeatmap.peak", "Peak");
        string peakUnitCaption = $"{peakWord} {unitLabel}";
        string peakAutomationName = $"{peakWord} {peakValueText} {unitLabel}";

        string drivesText = Fill(
            localizer.GetString("widget.speedHeatmap.drives", "{0} drives"),
            totalDrives.ToString(CultureInfo.InvariantCulture));
        string peakSpeedText = FillSpeed(
            localizer.GetString("widget.speedHeatmap.peakSpeed", "Peak avg {0} {1}"),
            ScalarFormatters.FormatNumber(maxSpeed, 0),
            unitLabel);

        string title = localizer.GetString("widget.speedHeatmap.title", "Speed Heatmap");
        string heatmapAutomationName = $"{title}. {drivesText}. {peakSpeedText}";

        return new SpeedHeatmapDisplay(
            IsCompact: size.IsCompact,
            IsWide: isWide,
            HasData: totalDrives > 0,
            MaxSpeed: maxSpeed,
            TotalDrives: totalDrives,
            PeakValueText: peakValueText,
            PeakUnitCaption: peakUnitCaption,
            PeakAutomationName: peakAutomationName,
            SummaryDrivesText: drivesText,
            SummaryPeakText: peakSpeedText,
            Cells: cells,
            DayLabels: dayLabels,
            HourLabels: hourLabels,
            LegendColors: legend,
            SlowLabel: localizer.GetString("widget.speedHeatmap.slow", "Slow"),
            FastLabel: localizer.GetString("widget.speedHeatmap.fast", "Fast"),
            HeatmapAutomationName: heatmapAutomationName);
    }

    /// <summary>
    /// Build a single cell's hover/Narrator label (web SVG <c>&lt;title&gt;</c>): "{day} {hour}:00 – {speed}
    /// {unit} ({count} drives)" for a populated cell, or "{day} {hour}:00 – No data" for an empty one.
    /// </summary>
    public static string BuildTooltip(
        string dayLabel, int hour, double avgSpeed, int count, string unitLabel, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        string head = string.Create(CultureInfo.InvariantCulture, $"{dayLabel} {hour}:00 {EnDash} ");
        if (count > 0)
        {
            string drivesSuffix = localizer.GetString("widget.speedHeatmap.drivesSuffix", "drives");
            string speedText = ScalarFormatters.FormatNumber(avgSpeed, 0);
            return head + string.Create(CultureInfo.InvariantCulture, $"{speedText} {unitLabel} ({count} {drivesSuffix})");
        }

        return head + localizer.GetString("widget.speedHeatmap.noData", "No data");
    }

    private static string Fill(string template, string value) =>
        template
            .Replace("{{count}}", value, StringComparison.Ordinal)
            .Replace("{count}", value, StringComparison.Ordinal)
            .Replace("{0}", value, StringComparison.Ordinal);

    private static string FillSpeed(string template, string speed, string unit) =>
        template
            .Replace("{{speed}}", speed, StringComparison.Ordinal)
            .Replace("{speed}", speed, StringComparison.Ordinal)
            .Replace("{0}", speed, StringComparison.Ordinal)
            .Replace("{{unit}}", unit, StringComparison.Ordinal)
            .Replace("{unit}", unit, StringComparison.Ordinal)
            .Replace("{1}", unit, StringComparison.Ordinal);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;DriveSample&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// empty-grid gate (web's <c>totalDrives === 0</c>) is applied by the view-model after projection, so a
/// populated-but-unbucketable list still flows through with its freshness intact. Kept pure so the
/// parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SpeedHeatmapResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<DriveSample>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<DriveSample> Parse() =>
            raw.HasValue ? DriveSample.ParseList(raw.Value) : Array.Empty<DriveSample>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<DriveSample>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<DriveSample>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<DriveSample>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<DriveSample>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<DriveSample>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<DriveSample>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<DriveSample>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
