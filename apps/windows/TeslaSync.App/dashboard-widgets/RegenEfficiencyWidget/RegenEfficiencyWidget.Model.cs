using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="RegenEfficiencyViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>RegenEfficiencyWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{data ? gauge : &lt;EmptyState&gt;}</c>
/// gate (no resolved vehicle → the <c>useRegenEfficiency</c> query is disabled and <c>data</c> is undefined) —
/// the friendly "No regen data" surface — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum RegenEfficiencyState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a regen summary to render the gauge for.</summary>
    Loaded,

    /// <summary>No vehicle resolved (the query is disabled) — render the "No regen data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauge plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The regenerative-braking summary the widget reads from <c>GET /analytics/regen?vehicle_id={id}</c> — the
/// native mirror of the web <c>RegenEfficiencyData</c> slice the component consumes (<c>total_regen_wh</c>,
/// <c>regen_ratio</c>, <c>monthly_avg_regen</c>, <c>free_charges</c>; web/src/types/driving.ts). Energy is SI
/// watt-hours and power is SI watts (converted at the display boundary by <see cref="UnitFormatters"/>);
/// <see cref="RegenRatio"/> is read verbatim from the wire (the web reads <c>data.regenRatio</c> the same way).
/// Parsing is null-tolerant — every numeric field defaults to 0 exactly as the web's <c>?? 0</c> guards do — so
/// a partial body never throws. A non-object body parses to <see langword="null"/> (the web <c>data</c> being
/// undefined → the empty surface).
/// </summary>
/// <param name="TotalRegenWh">Lifetime energy recovered in watt-hours (web <c>data.totalRegenWh</c>).</param>
/// <param name="RegenRatio">Raw recovery ratio read from the wire <c>regen_ratio</c> (web <c>data.regenRatio</c>).</param>
/// <param name="MonthlyAvgRegen">Average monthly regen power in watts (web <c>data.monthlyAvgRegen</c>).</param>
/// <param name="FreeCharges">Equivalent free full charges recovered (web <c>data.freeCharges</c>).</param>
public sealed record RegenEfficiencyData(
    double TotalRegenWh,
    double RegenRatio,
    double MonthlyAvgRegen,
    double FreeCharges)
{
    /// <summary>
    /// Project a <c>GET /analytics/regen</c> response into the summary slice, or <see langword="null"/> when the
    /// body is not an object (web <c>!data</c> → the empty surface). Any object — even all-zero — yields a usable
    /// summary so the gauge renders at 0% (web <c>{data ? gauge : empty}</c> with <c>data</c> truthy). Reads the
    /// snake_case wire shape so the camelCase transform the web client layers on is irrelevant to the parse.
    /// </summary>
    public static RegenEfficiencyData? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new RegenEfficiencyData(
            TotalRegenWh: ReadDouble(root, "total_regen_wh") ?? 0,
            RegenRatio: ReadDouble(root, "regen_ratio") ?? 0,
            MonthlyAvgRegen: ReadDouble(root, "monthly_avg_regen") ?? 0,
            FreeCharges: ReadDouble(root, "free_charges") ?? 0);
    }

    private static double? ReadDouble(JsonElement obj, string name)
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

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> flag and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx.
/// </summary>
public readonly record struct RegenEfficiencySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static RegenEfficiencySize Default => new(1, 2);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>); collapses the title + stats.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// One projected gauge-hero stat (Total Recovered / Monthly Avg / Free Charges) — its localized label, the
/// formatted display value and the Narrator measure name. The native analogue of one entry in the web
/// <c>stats</c> array rendered by <c>WidgetGaugeHero</c>.
/// </summary>
public sealed record RegenEfficiencyStat(string Label, string ValueText, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the regen gauge for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the <c>regenPct</c> derivation, the
/// <c>regenColor</c> threshold, the clamped gauge value, the "%" caption, the "recovery" unit, the three
/// unit-formatted stats and the compact layout gate). Pure data so the projection is unit-tested without a UI
/// host.
/// </summary>
public sealed record RegenEfficiencyDisplay(
    double GaugeValue,
    double GaugeMax,
    string GaugeValueText,
    string GaugeUnit,
    string GaugeCaption,
    StatusKind Status,
    IReadOnlyList<RegenEfficiencyStat> Stats,
    bool IsCompact,
    bool ShowStats,
    double GaugeDiameter,
    string GaugeAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="RegenEfficiencyData"/> to the display model — the native port of the
/// <c>regenColor</c> helper, the <c>regenPct</c> derivation and the <c>WidgetGaugeHero</c> composition in
/// web/src/features/dashboard/widgets/RegenEfficiencyWidget.tsx. It derives the recovery percentage, colours the
/// arc by the web threshold, clamps the gauge value and unit-formats the stats; every label resolves through the
/// i18n facade and energy/power format through the user's <see cref="UnitPref"/>.
/// </summary>
public static class RegenEfficiencyProjection
{
    /// <summary>Segoe Fluent "UpdateRestore" glyph (circular regeneration arrows) for the title row + empty state (web <c>RotateCcw</c> icon).</summary>
    public const string HeaderGlyph = "\uE777";

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxPercent = 100;

    /// <summary>Above this recovery percentage the arc is excellent/green (web <c>regenColor pct &gt; 30</c>).</summary>
    public const double GreenThreshold = 30;

    /// <summary>Above this recovery percentage the arc is fair/amber (web <c>regenColor pct &gt; 15</c>).</summary>
    public const double AmberThreshold = 15;

    /// <summary>
    /// Map a recovery percentage to the semantic status its arc is tinted with (web <c>regenColor</c>):
    /// &gt;30 → <see cref="StatusKind.Success"/> (#10B981), &gt;15 → <see cref="StatusKind.Warning"/> (#F59E0B),
    /// otherwise <see cref="StatusKind.Danger"/> (#EF4444). The native status tokens carry the exact web hexes.
    /// The comparison is strict (web uses <c>&gt;</c>, not <c>&gt;=</c>).
    /// </summary>
    public static StatusKind StatusFor(double percent)
    {
        double safe = SafeNumber(percent);
        if (safe > GreenThreshold)
        {
            return StatusKind.Success;
        }

        return safe > AmberThreshold ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the localizer + units for every label/value.</summary>
    public static RegenEfficiencyDisplay Project(
        RegenEfficiencyData data,
        RegenEfficiencySize size,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity (RegenEfficiencyWidget.tsx L32): regenPct = (data?.regenRatio ?? 0) * 100. The web derives
        // the gauge percentage by multiplying the wire `regen_ratio` by 100, so the native mirrors it exactly to
        // stay at display parity — the gauge value / caption / colour are all driven by this same `regenPct`.
        double regenPct = SafeNumber(data.RegenRatio) * 100;
        double rounded = Math.Round(regenPct, MidpointRounding.AwayFromZero);
        double clamped = Math.Clamp(rounded, 0, MaxPercent);

        // Web RadialGauge: the centre shows fmtNumber(clamp(value,0,max)) (integers → 0 decimals); the caption
        // below shows the raw `${Math.round(regenPct)}%`; the inline unit is the localized "recovery".
        string valueText = ScalarFormatters.FormatNumber(clamped, 0);
        string unit = localizer.GetString("widget.regenEfficiency.recovery", "recovery");
        string caption = $"{ScalarFormatters.FormatNumber(rounded, 0)}%";

        var stats = new List<RegenEfficiencyStat>(3)
        {
            Stat(
                "widget.regenEfficiency.totalKwh",
                "Total Recovered",
                UnitFormatters.FormatEnergy(data.TotalRegenWh, units, 1),
                localizer),
            Stat(
                "widget.regenEfficiency.monthlyAvg",
                "Monthly Avg",
                UnitFormatters.FormatPower(data.MonthlyAvgRegen, units, 1),
                localizer),
            Stat(
                "widget.regenEfficiency.freeCharges",
                "Free Charges",
                ScalarFormatters.FormatNumber(SafeNumber(data.FreeCharges), 0),
                localizer),
        };

        // Web parity: stats render only when !compact; the gauge (with its caption) always renders.
        bool showStats = !size.IsCompact;
        string title = localizer.GetString("widget.regenEfficiency.title", "Regen Braking");

        return new RegenEfficiencyDisplay(
            GaugeValue: clamped,
            GaugeMax: MaxPercent,
            GaugeValueText: valueText,
            GaugeUnit: unit,
            GaugeCaption: caption,
            Status: StatusFor(regenPct),
            Stats: stats,
            IsCompact: size.IsCompact,
            ShowStats: showStats,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: $"{title} {caption} {unit}");
    }

    private static RegenEfficiencyStat Stat(string key, string fallback, string valueText, ILocalizer localizer)
    {
        string label = localizer.GetString(key, fallback);
        return new RegenEfficiencyStat(label, valueText, $"{label} {valueText}");
    }

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;RegenEfficiencyData&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body is not an object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{data ? gauge : empty}</c> gate.
/// Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class RegenEfficiencyResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<RegenEfficiencyData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        RegenEfficiencyData? Parse() => raw.HasValue ? RegenEfficiencyData.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<RegenEfficiencyData>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<RegenEfficiencyData>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<RegenEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<RegenEfficiencyData>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<RegenEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<RegenEfficiencyData>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<RegenEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<RegenEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<RegenEfficiencyData>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<RegenEfficiencyData>.Empty(raw.FetchedAt),
            _ => RepositoryResult<RegenEfficiencyData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
