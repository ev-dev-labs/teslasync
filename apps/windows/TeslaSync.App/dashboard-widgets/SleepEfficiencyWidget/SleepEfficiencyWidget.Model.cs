using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SleepEfficiencyViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SleepEfficiencyWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{hasData ? &lt;WidgetGaugeHero&gt; : &lt;EmptyState&gt;}</c> gate (no resolved vehicle → the
/// <c>useSleepEfficiency</c> query is disabled and <c>data</c> is undefined) — the friendly
/// "No sleep efficiency data" surface — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum SleepEfficiencyState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a sleep summary to render the gauge for.</summary>
    Loaded,

    /// <summary>No vehicle resolved (the query is disabled) — render the "No sleep efficiency data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the gauge plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the gauge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One row of the web <c>state_distribution</c> array (<c>{ state, total_minutes }</c>) — the per-state dwell
/// the widget sums to derive total sleep hours (web <c>SleepEfficiencyWidget.tsx</c> L50-56). The native mirror
/// of the slice the component reads off <c>data.state_distribution</c>.
/// </summary>
/// <param name="State">The vehicle FSM state name (web compares against <c>'asleep'</c> / <c>'offline'</c>).</param>
/// <param name="TotalMinutes">Minutes spent in <see cref="State"/> over the window (web <c>total_minutes</c>).</param>
public sealed record SleepStateSlice(string State, double TotalMinutes);

/// <summary>
/// The sleep-efficiency summary the widget reads from <c>GET /analytics/sleep?vehicle_id={id}</c> — the native
/// mirror of the web <c>SleepEfficiencyData</c> slice the component consumes (<c>sleep_efficiency_pct</c>,
/// <c>sentry_off_drain_rate</c>, <c>state_distribution</c>, <c>recent_events</c>; web/src/types/energy.ts).
/// Percentages are read verbatim (0..100); drain rate is a raw %/hour value; the state distribution and the
/// wake-event count feed the gauge stats. Parsing is null-tolerant — every numeric field defaults to 0 exactly
/// as the web's <c>?? 0</c> guards do — so a partial body never throws. A non-object body parses to
/// <see langword="null"/> (the web <c>data</c> being undefined → the empty surface).
/// </summary>
/// <param name="SleepEfficiencyPct">Share of parked time the car spent asleep (web <c>data.sleep_efficiency_pct</c>).</param>
/// <param name="SentryOffDrainRate">Battery loss per hour with Sentry off, in %/hour (web <c>data.sentry_off_drain_rate</c>).</param>
/// <param name="StateDistribution">Per-state dwell rows (web <c>data.state_distribution</c>).</param>
/// <param name="RecentEventsCount">Number of recent wake/drain events (web <c>data.recent_events.length</c>).</param>
public sealed record SleepEfficiencyData(
    double SleepEfficiencyPct,
    double SentryOffDrainRate,
    IReadOnlyList<SleepStateSlice> StateDistribution,
    int RecentEventsCount)
{
    /// <summary>
    /// Project a <c>GET /analytics/sleep</c> response into the summary slice, or <see langword="null"/> when the
    /// body is not an object (web <c>!data</c> → the empty surface). Any object — even all-zero — yields a usable
    /// summary so the gauge renders at 0% (web <c>{hasData ? gauge : empty}</c> with <c>data</c> truthy). Reads
    /// the snake_case wire shape so the camelCase transform the web client layers on is irrelevant to the parse.
    /// </summary>
    public static SleepEfficiencyData? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SleepEfficiencyData(
            SleepEfficiencyPct: ReadDouble(root, "sleep_efficiency_pct") ?? 0,
            SentryOffDrainRate: ReadDouble(root, "sentry_off_drain_rate") ?? 0,
            StateDistribution: ReadStateDistribution(root),
            RecentEventsCount: ReadArrayLength(root, "recent_events"));
    }

    /// <summary>
    /// Sum the minutes the car spent in a sleeping state (<c>asleep</c> or <c>offline</c>) and convert to hours —
    /// the native port of the web <c>totalSleepHours</c> derivation (web <c>SleepEfficiencyWidget.tsx</c> L50-56:
    /// filter the distribution to the sleep states, reduce <c>total_minutes</c>, divide by 60).
    /// </summary>
    public double TotalSleepHours()
    {
        double sleepMinutes = 0;
        foreach (var slice in StateDistribution)
        {
            if (IsSleepState(slice.State))
            {
                sleepMinutes += SafeNumber(slice.TotalMinutes);
            }
        }

        return sleepMinutes / 60.0;
    }

    /// <summary>True when <paramref name="state"/> is one of the web sleep states (<c>asleep</c> / <c>offline</c>).</summary>
    public static bool IsSleepState(string? state) =>
        string.Equals(state, "asleep", StringComparison.Ordinal) ||
        string.Equals(state, "offline", StringComparison.Ordinal);

    private static IReadOnlyList<SleepStateSlice> ReadStateDistribution(JsonElement root)
    {
        if (!root.TryGetProperty("state_distribution", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SleepStateSlice>();
        }

        var list = new List<SleepStateSlice>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string state = item.TryGetProperty("state", out var s) && s.ValueKind == JsonValueKind.String
                ? s.GetString() ?? string.Empty
                : string.Empty;
            double minutes = ReadDouble(item, "total_minutes") ?? 0;
            list.Add(new SleepStateSlice(state, minutes));
        }

        return list;
    }

    private static int ReadArrayLength(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array ? v.GetArrayLength() : 0;

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

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> flag and the <c>WidgetGaugeHero</c> diameter logic in
/// web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx.
/// </summary>
public readonly record struct SleepEfficiencySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (1×2).</summary>
    public static SleepEfficiencySize Default => new(1, 2);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>); collapses the title + stats.</summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>Gauge diameter in pixels (web <c>WidgetGaugeHero size = compact ? 70 : 100</c>).</summary>
    public double GaugeDiameter => IsCompact ? 70 : 100;
}

/// <summary>
/// One projected gauge-hero stat (Avg Drain/Day / Total Sleep / Wake Events) — its localized label, the
/// formatted display value, the small inline unit suffix (web <c>stat.unit</c>; may be empty) and the Narrator
/// measure name. The native analogue of one entry in the web <c>stats</c> array rendered by
/// <c>WidgetGaugeHero</c>.
/// </summary>
public sealed record SleepEfficiencyStat(string Label, string ValueText, string Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the sleep gauge for one footprint — the native analogue of
/// everything the web component computes before returning JSX (the <c>efficiencyPct</c> read, the
/// <c>efficiencyColor</c> threshold, the clamped gauge value, the "%" unit, the "Efficiency" caption, the three
/// derived stats and the compact layout gate). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record SleepEfficiencyDisplay(
    double GaugeValue,
    double GaugeMax,
    string GaugeValueText,
    string GaugeUnit,
    string GaugeCaption,
    StatusKind Status,
    IReadOnlyList<SleepEfficiencyStat> Stats,
    bool IsCompact,
    bool ShowStats,
    double GaugeDiameter,
    string GaugeAutomationName);

/// <summary>
/// Pure projection from a raw <see cref="SleepEfficiencyData"/> to the display model — the native port of the
/// <c>efficiencyColor</c> helper, the gauge config and the derived stats in
/// web/src/features/dashboard/widgets/SleepEfficiencyWidget.tsx. It reads the efficiency percentage, colours the
/// arc by the web threshold, clamps the gauge value and formats the three plain-number stats; every label
/// resolves through the i18n facade. The widget reads SI-agnostic scalars (a percentage, a %/hour drain rate,
/// minutes and a count) so — unlike the web's unit-bearing siblings — no <c>useUnits</c> preference applies.
/// </summary>
public static class SleepEfficiencyProjection
{
    /// <summary>Segoe Fluent "QuietHours" glyph (crescent moon) for the title row + empty state (web <c>Moon</c> icon).</summary>
    public const string HeaderGlyph = "\uE708";

    /// <summary>The gauge maximum (web <c>max={100}</c>).</summary>
    public const double MaxPercent = 100;

    /// <summary>Above this efficiency percentage the arc is excellent/green (web <c>efficiencyColor pct &gt; 95</c>).</summary>
    public const double GreenThreshold = 95;

    /// <summary>Above this efficiency percentage the arc is fair/amber (web <c>efficiencyColor pct &gt; 85</c>).</summary>
    public const double AmberThreshold = 85;

    /// <summary>The literal gauge unit the web passes verbatim (web gauge <c>unit: '%'</c>).</summary>
    public const string PercentUnit = "%";

    /// <summary>
    /// Map an efficiency percentage to the semantic status its arc is tinted with (web <c>efficiencyColor</c>):
    /// &gt;95 → <see cref="StatusKind.Success"/> (#10B981), &gt;85 → <see cref="StatusKind.Warning"/> (#F59E0B),
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

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static SleepEfficiencyDisplay Project(
        SleepEfficiencyData data,
        SleepEfficiencySize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        // Web parity (SleepEfficiencyWidget.tsx L37): efficiencyPct = data?.sleep_efficiency_pct ?? 0. The gauge
        // value is the raw percentage; RadialGauge clamps it into [0, max] and formats integers with 0 decimals,
        // fractions with the global precision (2) — mirrored here by the Floor check (web Number.isInteger).
        double efficiencyPct = SafeNumber(data.SleepEfficiencyPct);
        double clamped = Math.Clamp(efficiencyPct, 0, MaxPercent);
        int decimals = clamped == Math.Floor(clamped) ? 0 : 2;
        string valueText = ScalarFormatters.FormatNumber(clamped, decimals);

        // Web parity: the gauge `label` (the caption beneath the ring) is the localized "Efficiency" string, and
        // is blanked on compact widgets (web `label: isCompact ? '' : t('...efficiency')`).
        string caption = size.IsCompact
            ? string.Empty
            : localizer.GetString("widget.sleepEfficiency.efficiency", "Efficiency");

        // Web parity (L48): avgDrainPerDay = fmtNumber((sentry_off_drain_rate ?? 0) * 24, 2). The %/hour drain
        // rate is annualised to a %/day figure shown with a literal "%" suffix.
        double avgDrainPerDay = SafeNumber(data.SentryOffDrainRate) * 24;
        string avgDrainText = ScalarFormatters.FormatNumber(avgDrainPerDay, 2);

        // Web parity (L50-56, L62): totalSleepHours = sum(asleep|offline minutes)/60, shown with 0 decimals and
        // the localized "h" suffix.
        string totalSleepText = ScalarFormatters.FormatNumber(data.TotalSleepHours(), 0);
        string hoursUnit = localizer.GetString("widget.sleepEfficiency.hours", "h");

        // Web parity (L58, L63): wakeEventsCount = recent_events.length, shown as a bare integer (no unit).
        string wakeText = ScalarFormatters.FormatNumber(data.RecentEventsCount, 0);

        var stats = new List<SleepEfficiencyStat>(3)
        {
            Stat("widget.sleepEfficiency.avgDrain", "Avg Drain/Day", avgDrainText, PercentUnit, localizer),
            Stat("widget.sleepEfficiency.totalSleep", "Total Sleep", totalSleepText, hoursUnit, localizer),
            Stat("widget.sleepEfficiency.wakeEvents", "Wake Events", wakeText, string.Empty, localizer),
        };

        // Web parity: stats render only when !compact; the gauge always renders.
        bool showStats = !size.IsCompact;
        string title = localizer.GetString("widget.sleepEfficiency.title", "Sleep Efficiency");
        string gaugeName = caption.Length > 0
            ? $"{title} {valueText}{PercentUnit} {caption}"
            : $"{title} {valueText}{PercentUnit}";

        return new SleepEfficiencyDisplay(
            GaugeValue: clamped,
            GaugeMax: MaxPercent,
            GaugeValueText: valueText,
            GaugeUnit: PercentUnit,
            GaugeCaption: caption,
            Status: StatusFor(efficiencyPct),
            Stats: stats,
            IsCompact: size.IsCompact,
            ShowStats: showStats,
            GaugeDiameter: size.GaugeDiameter,
            GaugeAutomationName: gaugeName);
    }

    private static SleepEfficiencyStat Stat(string key, string fallback, string valueText, string unit, ILocalizer localizer)
    {
        string label = localizer.GetString(key, fallback);
        string automation = unit.Length > 0 ? $"{label} {valueText}{unit}" : $"{label} {valueText}";
        return new SleepEfficiencyStat(label, valueText, unit, automation);
    }

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;SleepEfficiencyData&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body is not an object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{hasData ? gauge : empty}</c>
/// gate. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SleepEfficiencyResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<SleepEfficiencyData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SleepEfficiencyData? Parse() => raw.HasValue ? SleepEfficiencyData.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SleepEfficiencyData>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<SleepEfficiencyData>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SleepEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<SleepEfficiencyData>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SleepEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<SleepEfficiencyData>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<SleepEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<SleepEfficiencyData>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<SleepEfficiencyData>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<SleepEfficiencyData>.Empty(raw.FetchedAt),
            _ => RepositoryResult<SleepEfficiencyData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
