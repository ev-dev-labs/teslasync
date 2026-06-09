using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="LifetimeSummaryViewModel"/> can be in — the native
/// superset of the two branches the web Lifetime-Summary renders
/// (web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx). The web component is a pure child
/// of the Cost-Analysis page (it takes <c>lifetimeMetrics</c> + <c>coreStats</c>, both <c>… | null</c>) and
/// shows either its seven-metric grid or a centred "No data" message; the native surface binds its own
/// cache-then-network read of the charging sessions, so it owns the full loading / loaded / empty / error /
/// stale / offline matrix the P2 state contract requires. Every value maps onto a visible surface (never a
/// blank panel): <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the seven lifetime
/// metrics (falling back to the friendly empty surface when a cached snapshot carries no sessions),
/// <see cref="Empty"/> renders the "No data" surface (web parity: <c>coreStats</c> / <c>lifetimeMetrics</c>
/// resolve to null), <see cref="Loading"/> shows the per-metric skeletons, and <see cref="Error"/> the retry
/// surface.
/// </summary>
public enum LifetimeSummaryState
{
    /// <summary>Initial fetch with no cached snapshot — render the per-metric skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session — render the seven lifetime metrics.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no charging sessions — render the "No data" surface (web parity).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The lifetime charging aggregates the web Lifetime-Summary draws — the native mirror of the
/// <c>coreStats</c> + <c>lifetimeMetrics</c> reductions the Cost-Analysis page computes from its
/// charging-sessions query (web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts).
/// Reproduced verbatim for parity:
/// <list type="bullet">
/// <item><see cref="TotalCost"/> sums <c>cost_decimal</c> (a null cost counts as 0, the web <c>?? 0</c>).</item>
/// <item><see cref="TotalEnergyKwh"/> is <c>convertEnergyFromSI(Σ total_energy_added_wh, 'kWh')</c> — the SI
/// watt-hour sum divided by 1000 — matching <c>coreStats.totalEnergy</c>.</item>
/// <item><see cref="TotalDurationMin"/> sums each session's whole-minute duration (0 when a session has no end
/// or a non-positive span, the web <c>durationMinutes</c>).</item>
/// <item><see cref="FreeSessions"/> counts the sessions whose cost is absent or zero (web
/// <c>!cost_decimal || cost_decimal === 0</c>).</item>
/// <item><see cref="FreeEnergyWh"/> sums those free sessions' raw <c>total_energy_added_wh</c> — the web
/// Lifetime-Summary labels that watt-hour sum "kWh" without dividing, so the value is carried in Wh and the
/// projection reproduces the same "kWh" suffix (mirroring the web display exactly — do not "fix" the unit here
/// or the surfaces diverge).</item>
/// </list>
/// WinUI-free so the reduction is unit-tested without a UI host.
/// </summary>
public sealed record LifetimeSummaryStats(
    int TotalSessions,
    double TotalCost,
    double TotalEnergyKwh,
    double TotalDurationMin,
    int FreeSessions,
    double FreeEnergyWh)
{
    /// <summary>The no-sessions snapshot — the parse fallback for an absent/non-array body (web both-null).</summary>
    public static LifetimeSummaryStats Empty { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>True when at least one charging session backed the figures (web <c>coreStats !== null</c>).</summary>
    public bool HasData => TotalSessions > 0;

    /// <summary>
    /// Reduce a <c>GET /charging-sessions</c> JSON array into the lifetime aggregates — the native port of the
    /// Cost-Analysis page's <c>coreStats</c> / <c>lifetimeMetrics</c> memos. A non-array body or an empty array
    /// yields <see cref="Empty"/>. Parsing is null-tolerant (the web <c>?? 0</c>) so a partial row never throws.
    /// </summary>
    public static LifetimeSummaryStats FromSessionsJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int count = 0;
        double totalCost = 0;
        double totalEnergyWh = 0;
        double totalDurationMin = 0;
        int freeSessions = 0;
        double freeEnergyWh = 0;

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;

            double cost = GetDouble(item, "cost_decimal") ?? 0;
            double energyWh = GetDouble(item, "total_energy_added_wh") ?? 0;

            totalCost += cost;
            totalEnergyWh += energyWh;
            totalDurationMin += DurationMinutes(
                GetString(item, "started_at"),
                GetString(item, "ended_at"));

            // web: !s.cost_decimal || s.cost_decimal === 0 → a free session (a null cost counts as free).
            if (cost == 0)
            {
                freeSessions++;
                freeEnergyWh += energyWh;
            }
        }

        if (count == 0)
        {
            return Empty;
        }

        return new LifetimeSummaryStats(
            TotalSessions: count,
            TotalCost: totalCost,
            TotalEnergyKwh: totalEnergyWh / 1000.0,
            TotalDurationMin: totalDurationMin,
            FreeSessions: freeSessions,
            FreeEnergyWh: freeEnergyWh);
    }

    // web durationMinutes(): no end / unparseable / non-positive span -> 0; else whole minutes rounded
    // half-up (JS Math.round, which for positive values matches MidpointRounding.AwayFromZero).
    private static double DurationMinutes(string? startedAt, string? endedAt)
    {
        if (string.IsNullOrEmpty(endedAt)
            || !TryParseInstant(startedAt, out var start)
            || !TryParseInstant(endedAt, out var end))
        {
            return 0;
        }

        double milliseconds = (end - start).TotalMilliseconds;
        return milliseconds <= 0 ? 0 : Math.Round(milliseconds / 60000.0, MidpointRounding.AwayFromZero);
    }

    private static bool TryParseInstant(string? value, out DateTimeOffset instant) =>
        DateTimeOffset.TryParse(
            value,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out instant);

    // Null-tolerant readers (web parity: the page tolerates undefined fields with ?? 0) so a partial or
    // schema-drifted session row never aborts the reduction.
    private static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, render-ready lifetime metric — the native analogue of the web <c>LifetimeMetric</c> tile
/// (a muted label and a pre-formatted value). Pure data so every value is asserted headlessly.
/// </summary>
public sealed record LifetimeMetric(string Label, string Value, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Lifetime-Summary surface — the seven metrics the web
/// component draws plus the localized surface label. <see cref="HasData"/> reflects whether real sessions
/// backed the figures (web <c>coreStats !== null</c>); when false the surface shows its "No data" branch and
/// the metrics are zeroed. Pure data.
/// </summary>
public sealed record LifetimeSummaryDisplay(
    IReadOnlyList<LifetimeMetric> Metrics,
    bool HasData,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="LifetimeSummaryStats"/> to its <see cref="LifetimeSummaryDisplay"/> —
/// the native port of the render logic in
/// web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx. The seven metrics reproduce the web
/// call sites one-for-one: <c>formatCurrency(…, 2)</c> for the spent / average-cost figures, <c>fmtWithUnit(…,
/// 'kWh', 1)</c> for the energy figures, <c>fmtInt</c> for the session counts, and
/// <c>`${fmtNumber(…, 0)} min`</c> for the average duration. The lifetime averages are derived the same way
/// the web <c>lifetimeMetrics</c> memo derives them (<c>count &gt; 0 ? total / count : 0</c>). The unit
/// suffixes ("kWh", "min") are the symbols the web hard-codes, so they stay literal; every translatable label
/// resolves through the i18n facade using the same keys the web source passes to <c>t()</c>. WinUI-free —
/// unit-tested without a UI host.
/// </summary>
public static class LifetimeSummaryProjection
{
    /// <summary>Fraction digits the web currency call sites use (<c>formatCurrency(…, 2)</c>).</summary>
    public const int CurrencyPrecision = 2;

    /// <summary>Fraction digits the web energy call sites use (<c>fmtWithUnit(…, 'kWh', 1)</c>).</summary>
    public const int EnergyPrecision = 1;

    /// <summary>The energy unit the web grid suffixes onto the total / per-session / free-energy values.</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>The duration unit the web grid suffixes onto the average-duration value.</summary>
    public const string DurationUnit = "min";

    /// <summary>Project <paramref name="stats"/> using the user's <paramref name="currencySymbol"/> + i18n facade.</summary>
    public static LifetimeSummaryDisplay Project(
        LifetimeSummaryStats stats,
        string currencySymbol,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int count = stats.TotalSessions;

        double avgSessionCost = count > 0 ? stats.TotalCost / count : 0;
        double avgSessionEnergy = count > 0 ? stats.TotalEnergyKwh / count : 0;
        double avgDuration = count > 0 ? stats.TotalDurationMin / count : 0;

        var metrics = new[]
        {
            Metric(
                localizer.GetString("costAnalysis.lifetime.totalSpent", "Total Spent"),
                ScalarFormatters.FormatCurrency(stats.TotalCost, symbol, CurrencyPrecision)),
            Metric(
                localizer.GetString("costAnalysis.lifetime.totalEnergy", "Total Energy"),
                WithUnit(stats.TotalEnergyKwh, EnergyPrecision, EnergyUnit)),
            Metric(
                localizer.GetString("costAnalysis.lifetime.totalSessions", "Total Sessions"),
                ScalarFormatters.FormatNumber(stats.TotalSessions, 0)),
            Metric(
                localizer.GetString("costAnalysis.lifetime.avgSessionCost", "Avg Session Cost"),
                ScalarFormatters.FormatCurrency(avgSessionCost, symbol, CurrencyPrecision)),
            Metric(
                localizer.GetString("costAnalysis.lifetime.avgEnergy", "Avg Energy / Session"),
                WithUnit(avgSessionEnergy, EnergyPrecision, EnergyUnit)),
            Metric(
                localizer.GetString("costAnalysis.lifetime.avgDuration", "Avg Duration"),
                string.Format(
                    CultureInfo.CurrentCulture,
                    "{0} {1}",
                    ScalarFormatters.FormatNumber(avgDuration, 0),
                    DurationUnit)),
            Metric(
                localizer.GetString("costAnalysis.lifetime.freeSessions", "Free Sessions"),
                string.Format(
                    CultureInfo.CurrentCulture,
                    "{0} ({1})",
                    ScalarFormatters.FormatNumber(stats.FreeSessions, 0),
                    WithUnit(stats.FreeEnergyWh, EnergyPrecision, EnergyUnit))),
        };

        return new LifetimeSummaryDisplay(
            Metrics: metrics,
            HasData: stats.HasData,
            AutomationName: localizer.GetString("costAnalysis.lifetime.title", "Lifetime Summary"));
    }

    private static string WithUnit(double value, int precision, string unit) =>
        string.Format(
            CultureInfo.CurrentCulture,
            "{0} {1}",
            ScalarFormatters.FormatNumber(value, precision),
            unit);

    private static LifetimeMetric Metric(string label, string value) =>
        new(label, value, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value));
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto reduced
/// <c>RepositoryResult&lt;LifetimeSummaryStats&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class LifetimeSummaryResultMapper
{
    /// <summary>Reduce <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<LifetimeSummaryStats> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        LifetimeSummaryStats Parse() =>
            raw.HasValue ? LifetimeSummaryStats.FromSessionsJson(raw.Value) : LifetimeSummaryStats.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<LifetimeSummaryStats>.Loading(),
            LoadStatus.Cached => RepositoryResult<LifetimeSummaryStats>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<LifetimeSummaryStats>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<LifetimeSummaryStats>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<LifetimeSummaryStats>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<LifetimeSummaryStats>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<LifetimeSummaryStats>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Lifetime-Summary surface — the native mirror of the web component at
/// web/src/features/charging/components/cost-analysis/LifetimeSummary.tsx. The surface aggregates the same
/// charging sessions the Cost-Analysis page feeds the component.
/// </summary>
public static class LifetimeSummaryRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "lifetime-summary";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LifetimeSummary";

    /// <summary>Localized surface name (web <c>costAnalysis.lifetime.title</c>).</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("costAnalysis.lifetime.title", "Lifetime Summary");
    }
}

/// <summary>
/// PII-safe diagnostics for the Lifetime-Summary surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a cost, energy figure or session count —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class LifetimeSummaryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LifetimeSummaryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LifetimeSummary</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LifetimeSummaryRegistration.Slug}");
    }
}
