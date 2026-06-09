using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="CostHeatmapViewModel"/> can be in — the native
/// union of the branches the web Cost-Heatmap renders
/// (web/src/features/charging/components/charging-list/CostHeatmap.tsx). The web component is a pure child of
/// the charging-list optimizer section (it takes <c>heatmap</c> + <c>peakCostPerKwh</c> props and the parent
/// only mounts it when <c>weekly_heatmap.length &gt; 0</c>); the native surface binds its own
/// cache-then-network read of <c>GET /analytics/charging-optimizer</c>, so it owns the full loading / loaded
/// / empty / error / stale / offline matrix the P2 state contract requires. Every value maps onto a visible
/// surface (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render
/// the 7×24 cost grid (with the stale / offline chip for the latter two), <see cref="Empty"/> renders the
/// friendly empty state (web parity: the parent hides the heatmap when there is nothing to plot),
/// <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the retry surface.
/// </summary>
public enum CostHeatmapState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot carrying at least one weekly-heatmap entry to render.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no weekly-heatmap entry (web parity: parent would hide it).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the grid plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the grid plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// A plain, UI-free RGBA colour — the native mirror of the web component's per-cell / per-swatch
/// <c>rgba(r, g, b, a)</c> string. <see cref="R"/>, <see cref="G"/> and <see cref="B"/> are 0-255 channels and
/// <see cref="Alpha"/> is the 0..1 opacity (web parity). Kept WinUI-free so the colour maths is unit-tested
/// headlessly; the view converts it to a <c>Windows.UI.Color</c> at render time.
/// </summary>
public readonly record struct HeatColor(byte R, byte G, byte B, double Alpha)
{
    /// <summary>
    /// The fill for one grid cell — the native port of the web ternary: a warm cost-tinted colour whose alpha
    /// grows with the session count when <paramref name="sessions"/> &gt; 0, else the faint empty-cell wash
    /// (<c>rgba(255,255,255,0.02)</c>).
    /// </summary>
    /// <param name="intensity">The clamped cost intensity (0..1) — web <c>Math.min(1, cost / maxCost)</c>.</param>
    /// <param name="sessions">The session count in the cell (drives the alpha ramp).</param>
    public static HeatColor ForCell(double intensity, int sessions)
    {
        if (sessions > 0)
        {
            // Web: rgba(round(intensity*239), round((1-intensity)*187), round((1-intensity)*100), min(0.9, 0.15 + sessions*0.12)).
            double alpha = Math.Min(0.9, 0.15 + (sessions * 0.12));
            return new HeatColor(
                Channel(intensity * 239),
                Channel((1 - intensity) * 187),
                Channel((1 - intensity) * 100),
                alpha);
        }

        // Web: rgba(255, 255, 255, 0.02) — the empty-cell wash.
        return new HeatColor(255, 255, 255, 0.02);
    }

    /// <summary>
    /// The fill for one legend swatch — the native port of the web legend map over
    /// <c>[0.15, 0.3, 0.5, 0.7, 0.9]</c>: <c>rgba(round(o*239), round((1-o)*187), round((1-o)*100), 0.6)</c>.
    /// </summary>
    /// <param name="opacity">The legend stop (the web array value), used as the intensity.</param>
    public static HeatColor ForLegend(double opacity) => new(
        Channel(opacity * 239),
        Channel((1 - opacity) * 187),
        Channel((1 - opacity) * 100),
        0.6);

    /// <summary>The 0-255 alpha byte (web's 0..1 opacity scaled for the WinUI ARGB colour).</summary>
    public byte AlphaByte => Channel(Math.Clamp(Alpha, 0, 1) * 255);

    // JS Math.round rounds half toward +∞; every operand here is non-negative so away-from-zero matches it.
    private static byte Channel(double value) =>
        (byte)Math.Clamp((int)Math.Round(value, MidpointRounding.AwayFromZero), 0, 255);
}

/// <summary>
/// One parsed weekly-heatmap entry — the native mirror of the web <c>OptimizerHeatmapEntry</c>
/// (<c>{ day, hour, sessions, avg_cost_per_kwh }</c>). Field names mirror the Go API's snake_case JSON tags;
/// parsing is null-tolerant so a partial row never throws. WinUI-free so the parse is unit-tested without a
/// UI host.
/// </summary>
public sealed record CostHeatmapEntry(int Day, int Hour, int Sessions, double AvgCostPerKwh)
{
    /// <summary>Project a single weekly-heatmap JSON object into a tolerant row.</summary>
    public static CostHeatmapEntry FromJson(JsonElement obj) => new(
        OptimizerHeatmapJson.GetInt(obj, "day") ?? -1,
        OptimizerHeatmapJson.GetInt(obj, "hour") ?? -1,
        Math.Max(0, OptimizerHeatmapJson.GetInt(obj, "sessions") ?? 0),
        OptimizerHeatmapJson.GetDouble(obj, "avg_cost_per_kwh") ?? 0);
}

/// <summary>
/// The optimizer read-model the heatmap consumes — the subset of the <c>GET /analytics/charging-optimizer</c>
/// object body the web <c>CostHeatmap</c> actually reads (the <c>weekly_heatmap</c> array plus
/// <c>cost_analysis.peak_cost_per_kwh</c>; the sibling schedule / recommendations / battery-score fields are
/// surfaced by other charging surfaces, not this one). Parsing is tolerant so a partial or non-object body
/// yields <see cref="Empty"/> rather than throwing. <see cref="HasData"/> mirrors the parent's
/// <c>weekly_heatmap.length &gt; 0</c> mount gate.
/// </summary>
public sealed record CostHeatmapReport(
    IReadOnlyList<CostHeatmapEntry> Entries,
    double PeakCostPerKwh)
{
    /// <summary>The no-data report — the parse fallback for an absent / non-object / empty body.</summary>
    public static CostHeatmapReport Empty { get; } = new(Array.Empty<CostHeatmapEntry>(), 0);

    /// <summary>True when there is at least one weekly-heatmap entry (web <c>weekly_heatmap.length &gt; 0</c>).</summary>
    public bool HasData => Entries.Count > 0;

    /// <summary>Project a <c>GET /analytics/charging-optimizer</c> JSON body into a tolerant report.</summary>
    public static CostHeatmapReport FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            // Web parity: an absent / non-object body means the parent never mounts the heatmap.
            return Empty;
        }

        var cost = OptimizerHeatmapJson.GetObject(element, "cost_analysis");
        double peak = OptimizerHeatmapJson.GetDouble(cost, "peak_cost_per_kwh") ?? 0;
        return new CostHeatmapReport(ParseEntries(element), peak);
    }

    private static IReadOnlyList<CostHeatmapEntry> ParseEntries(JsonElement element)
    {
        if (!element.TryGetProperty("weekly_heatmap", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostHeatmapEntry>();
        }

        var list = new List<CostHeatmapEntry>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(CostHeatmapEntry.FromJson(item));
            }
        }

        return list;
    }
}

/// <summary>Null-tolerant JSON readers shared by the cost-heatmap parse adapter (snake_case wire shape).</summary>
internal static class OptimizerHeatmapJson
{
    /// <summary>Read a nested object property, or a default (Undefined) element when absent.</summary>
    public static JsonElement GetObject(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var v) &&
        v.ValueKind == JsonValueKind.Object
            ? v
            : default;

    /// <summary>Read a tolerant finite double property (null when absent / NaN / unparseable).</summary>
    public static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    /// <summary>Read a tolerant integer property (null when absent / non-numeric), rounding numbers.</summary>
    public static int? GetInt(JsonElement obj, string name)
    {
        double? raw = GetDouble(obj, name);
        return raw is { } d ? (int)Math.Round(d, MidpointRounding.AwayFromZero) : null;
    }
}

/// <summary>
/// One render-ready heatmap cell — a single (day, hour) square with its session count, average cost, clamped
/// cost <see cref="Intensity"/>, computed <see cref="Fill"/> colour and the localized hover/Narrator
/// <see cref="Tooltip"/> (web's <c>title</c> attribute). Pure data so the colour maths and tooltip text are
/// asserted headlessly.
/// </summary>
public sealed record CostHeatmapCell(
    int Hour,
    int Sessions,
    double Cost,
    double Intensity,
    HeatColor Fill,
    string Tooltip)
{
    /// <summary>True when the cell carries at least one charging session (web <c>sessions &gt; 0</c>).</summary>
    public bool HasSessions => Sessions > 0;
}

/// <summary>
/// One render-ready heatmap row — a localized day label (web's <c>['Sun'..'Sat']</c> entry) plus its 24
/// hour cells in order. Pure data so the grid shape is asserted without a UI host.
/// </summary>
public sealed record CostHeatmapRow(int DayIndex, string DayLabel, IReadOnlyList<CostHeatmapCell> Cells);

/// <summary>
/// The fully projected, render-ready view of the Cost-Heatmap surface — the localized panel title, the
/// Cheap / Expensive legend labels, the 24 sparse hour labels (web shows the hour only every third column),
/// the seven day <see cref="Rows"/> of 24 cells, the five legend swatches and the effective
/// <see cref="MaxCost"/> denominator. <see cref="HasData"/> drives the content-vs-empty branch (web parity:
/// the heatmap renders when the optimizer returned at least one weekly entry). Pure data so every branch is
/// asserted without a UI host.
/// </summary>
public sealed record CostHeatmapDisplay(
    bool HasData,
    string Title,
    string AriaLabel,
    string CheapLabel,
    string ExpensiveLabel,
    string EmptyMessage,
    double MaxCost,
    IReadOnlyList<string> HourLabels,
    IReadOnlyList<CostHeatmapRow> Rows,
    IReadOnlyList<HeatColor> LegendSwatches)
{
    /// <summary>An all-empty display (the friendly empty state) for the loading / empty fallback.</summary>
    public static CostHeatmapDisplay Empty(ILocalizer localizer) =>
        CostHeatmapProjection.Project(CostHeatmapReport.Empty, localizer);
}

/// <summary>
/// Pure projection from a parsed <see cref="CostHeatmapReport"/> to a <see cref="CostHeatmapDisplay"/> — the
/// native port of the render logic in web/src/features/charging/components/charging-list/CostHeatmap.tsx. It
/// builds the dense 7×24 grid from the sparse weekly-heatmap entries (web's
/// <c>heatmap.find(e =&gt; e.day === d &amp;&amp; e.hour === h)</c>), derives every cell colour from the
/// shared cost <c>maxCost = peakCostPerKwh || 0.30</c> denominator, and resolves every label through the i18n
/// facade. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class CostHeatmapProjection
{
    /// <summary>Days in a week (rows). Web grid is fixed Sun..Sat.</summary>
    public const int Days = 7;

    /// <summary>Hours in a day (columns). Web grid is fixed 0..23.</summary>
    public const int Hours = 24;

    /// <summary>Hour labels are shown only every third column (web <c>i % 3 === 0</c>).</summary>
    public const int HourLabelInterval = 3;

    /// <summary>The fallback cost denominator when no peak rate is known (web <c>peakCostPerKwh || 0.30</c>).</summary>
    public const double DefaultMaxCost = 0.30;

    /// <summary>The cost symbol used in the cell tooltip (web <c>formatCurrency</c> default).</summary>
    public const string CurrencySymbol = "$";

    /// <summary>The cost precision used in the cell tooltip (web <c>formatCurrency(cost, 3)</c>).</summary>
    public const int CostDecimals = 3;

    /// <summary>The legend stops the swatches sample (web <c>[0.15, 0.3, 0.5, 0.7, 0.9]</c>).</summary>
    public static readonly IReadOnlyList<double> LegendOpacities = new[] { 0.15, 0.3, 0.5, 0.7, 0.9 };

    private static readonly (string Key, string Fallback)[] DayLabels =
    {
        ("quietHours.weekday.sun", "Sun"),
        ("quietHours.weekday.mon", "Mon"),
        ("quietHours.weekday.tue", "Tue"),
        ("quietHours.weekday.wed", "Wed"),
        ("quietHours.weekday.thu", "Thu"),
        ("quietHours.weekday.fri", "Fri"),
        ("quietHours.weekday.sat", "Sat"),
    };

    /// <summary>Project <paramref name="report"/> using the localizer for every label.</summary>
    /// <param name="report">The parsed optimizer read-model (weekly heatmap + peak rate).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static CostHeatmapDisplay Project(CostHeatmapReport report, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(report);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web: const maxCost = peakCostPerKwh || 0.30 — a non-finite or zero peak falls back to 0.30.
        double maxCost = double.IsFinite(report.PeakCostPerKwh) && report.PeakCostPerKwh != 0
            ? report.PeakCostPerKwh
            : DefaultMaxCost;

        var lookup = BuildLookup(report.Entries);
        string sessionsWord = localizer.GetString("charging.curve.sessions", "sessions");

        var rows = new List<CostHeatmapRow>(Days);
        for (int day = 0; day < Days; day++)
        {
            string dayLabel = localizer.GetString(DayLabels[day].Key, DayLabels[day].Fallback);
            var cells = new List<CostHeatmapCell>(Hours);
            for (int hour = 0; hour < Hours; hour++)
            {
                lookup.TryGetValue((day * Hours) + hour, out var entry);
                int sessions = entry?.Sessions ?? 0;
                double cost = entry?.AvgCostPerKwh ?? 0;
                double intensity = maxCost > 0 ? Math.Min(1, cost / maxCost) : 0;

                cells.Add(new CostHeatmapCell(
                    Hour: hour,
                    Sessions: sessions,
                    Cost: cost,
                    Intensity: intensity,
                    Fill: HeatColor.ForCell(intensity, sessions),
                    Tooltip: BuildTooltip(dayLabel, hour, sessions, cost, sessionsWord)));
            }

            rows.Add(new CostHeatmapRow(day, dayLabel, cells));
        }

        var hourLabels = new List<string>(Hours);
        for (int hour = 0; hour < Hours; hour++)
        {
            hourLabels.Add(hour % HourLabelInterval == 0
                ? hour.ToString(CultureInfo.InvariantCulture)
                : string.Empty);
        }

        var swatches = new List<HeatColor>(LegendOpacities.Count);
        foreach (double opacity in LegendOpacities)
        {
            swatches.Add(HeatColor.ForLegend(opacity));
        }

        string title = localizer.GetString("charging.optimizer.heatmap", "Charging Cost Heatmap");
        return new CostHeatmapDisplay(
            HasData: report.HasData,
            Title: title,
            AriaLabel: title,
            CheapLabel: localizer.GetString("charging.optimizer.cheap", "Cheap"),
            ExpensiveLabel: localizer.GetString("charging.optimizer.expensive", "Expensive"),
            EmptyMessage: localizer.GetString("common.noData", "No data available"),
            MaxCost: maxCost,
            HourLabels: hourLabels,
            Rows: rows,
            LegendSwatches: swatches);
    }

    /// <summary>
    /// Build the (day, hour) → entry lookup keyed by <c>day * 24 + hour</c>. Mirrors the web
    /// <c>Array.find</c> semantics: only in-range entries are indexed and the first match for a coordinate
    /// wins (later duplicates are ignored).
    /// </summary>
    private static Dictionary<int, CostHeatmapEntry> BuildLookup(IReadOnlyList<CostHeatmapEntry> entries)
    {
        var lookup = new Dictionary<int, CostHeatmapEntry>(entries.Count);
        foreach (var entry in entries)
        {
            if (entry.Day is >= 0 and < Days && entry.Hour is >= 0 and < Hours)
            {
                lookup.TryAdd((entry.Day * Hours) + entry.Hour, entry);
            }
        }

        return lookup;
    }

    private static string BuildTooltip(string dayLabel, int hour, int sessions, double cost, string sessionsWord)
    {
        string time = string.Create(CultureInfo.InvariantCulture, $"{dayLabel} {hour}:00");
        if (sessions <= 0)
        {
            // Web: `${dayLabel} ${hourIdx}:00` when no sessions.
            return time;
        }

        // Web: `${dayLabel} ${hourIdx}:00 — ${sessions} sessions, ${formatCurrency(cost, 3)}/kWh`.
        string costText = ScalarFormatters.FormatCurrency(cost, CurrencySymbol, CostDecimals);
        return string.Create(
            CultureInfo.InvariantCulture,
            $"{time} \u2014 {sessions} {sessionsWord}, {costText}/kWh");
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;CostHeatmapReport&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class CostHeatmapResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<CostHeatmapReport> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CostHeatmapReport Parse() =>
            raw.HasValue ? CostHeatmapReport.FromJson(raw.Value) : CostHeatmapReport.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CostHeatmapReport>.Loading(),
            LoadStatus.Cached => RepositoryResult<CostHeatmapReport>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<CostHeatmapReport>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<CostHeatmapReport>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<CostHeatmapReport>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<CostHeatmapReport>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<CostHeatmapReport>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Cost-Heatmap feature surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-list/CostHeatmap.tsx. The surface reads the same
/// charging-optimizer payload the web charging-list optimizer section feeds the heatmap.
/// </summary>
public static class CostHeatmapRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "cost-heatmap";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (per the P2 prompt).</summary>
    public const string Slug = "CostHeatmap";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.optimizer.heatmap", "Charging Cost Heatmap");
    }
}

/// <summary>
/// PII-safe diagnostics for the Cost-Heatmap surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, session count, day or hour — so
/// a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class CostHeatmapDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public CostHeatmapDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostHeatmap</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={CostHeatmapRegistration.Slug}");
    }
}
