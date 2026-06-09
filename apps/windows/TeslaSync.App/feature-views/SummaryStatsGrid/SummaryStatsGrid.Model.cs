using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="SummaryStatsGridViewModel"/> can be in — the native
/// superset of the branches the web Summary-stats grid renders
/// (web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx). The web component is a pure
/// child of the Charging-Curve page (it takes <c>stats: SummaryStats | null</c>); the native surface binds
/// its own cache-then-network read of the charging sessions, so it owns the full loading / loaded / empty /
/// error / stale / offline matrix the P2 state contract requires. Every value maps onto a visible surface
/// (never a blank panel): <see cref="Loaded"/>, <see cref="Stale"/>, <see cref="Offline"/> and
/// <see cref="Empty"/> all render the six summary cards (the web grid is always visible, falling back to
/// zeroed cards when <c>stats</c> is null), while <see cref="Loading"/> shows the per-card skeletons (the web
/// <c>SummaryCard</c> loading branch) and <see cref="Error"/> the retry surface.
/// </summary>
public enum SummaryStatsState
{
    /// <summary>Initial fetch with no cached snapshot — render the per-card skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no charging sessions — the cards render zeroed (web parity).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The six aggregate charging figures the web Summary-stats grid shows — the native mirror of the web
/// <c>SummaryStats</c> shape (web/src/features/charging/components/charging-curve/types.ts) and of the
/// <c>useMemo</c> reduction the Charging-Curve page computes from its charging-sessions query
/// (web/src/features/charging/pages/ChargingCurvePage.tsx). Reproduced verbatim for parity:
/// <list type="bullet">
/// <item><c>TotalEnergyWh</c> sums the SI <c>total_energy_added_wh</c> field; the web grid labels that sum
/// "kWh" without dividing, so the native surface formats the same value with the same "kWh" suffix (mirroring
/// the web display exactly — do not "fix" the unit here or the surfaces diverge).</item>
/// <item><c>AvgRateKw</c>/<c>PeakRateKw</c> are the average / maximum of <c>peak_power_w / 1000</c> across
/// <i>every</i> session (a null power counts as 0, the web <c>?? 0</c>).</item>
/// <item><c>AvgDurationMin</c> is the average of each session's whole-minute duration (0 when a session has
/// no end or a non-positive span, the web <c>durationMinutes</c>).</item>
/// </list>
/// WinUI-free so the reduction is unit-tested without a UI host.
/// </summary>
public sealed record ChargingSummary(
    int TotalSessions,
    double TotalEnergyWh,
    double AvgRateKw,
    double PeakRateKw,
    double AvgDurationMin,
    double TotalCost)
{
    /// <summary>The no-sessions snapshot — the parse fallback for an absent/non-array body (web <c>stats === null</c>).</summary>
    public static ChargingSummary Empty { get; } = new(0, 0, 0, 0, 0, 0);

    /// <summary>True when at least one charging session contributed to the figures (web <c>stats !== null</c>).</summary>
    public bool HasData => TotalSessions > 0;

    /// <summary>
    /// Reduce a <c>GET /charging-sessions</c> JSON array into the six summary figures — the native port of the
    /// Charging-Curve page <c>useMemo</c>. A non-array body or an empty array yields <see cref="Empty"/>.
    /// Parsing is null-tolerant (the web <c>?? 0</c>) so a partial row never throws.
    /// </summary>
    public static ChargingSummary FromSessionsJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Empty;
        }

        int count = 0;
        double totalEnergyWh = 0;
        double totalCost = 0;
        double sumPowerKw = 0;
        double sumDurationMin = 0;
        double maxPowerKw = double.NegativeInfinity;

        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            count++;
            totalEnergyWh += SummaryStatsJson.GetDouble(item, "total_energy_added_wh") ?? 0;
            totalCost += SummaryStatsJson.GetDouble(item, "cost_decimal") ?? 0;

            double powerKw = (SummaryStatsJson.GetDouble(item, "peak_power_w") ?? 0) / 1000.0;
            sumPowerKw += powerKw;
            if (powerKw > maxPowerKw)
            {
                maxPowerKw = powerKw;
            }

            sumDurationMin += DurationMinutes(
                SummaryStatsJson.GetString(item, "started_at"),
                SummaryStatsJson.GetString(item, "ended_at"));
        }

        if (count == 0)
        {
            return Empty;
        }

        return new ChargingSummary(
            TotalSessions: count,
            TotalEnergyWh: totalEnergyWh,
            AvgRateKw: sumPowerKw / count,
            PeakRateKw: maxPowerKw,
            AvgDurationMin: sumDurationMin / count,
            TotalCost: totalCost);
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
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Summary-stats surface — every getter returns a
/// nullable / fallback rather than throwing so a partial or schema-drifted session row never aborts the
/// reduction (web parity: the page tolerates undefined fields with <c>?? 0</c>). WinUI-free so the parse is
/// unit-tested without a UI host.
/// </summary>
internal static class SummaryStatsJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? GetString(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? GetDouble(JsonElement obj, string name)
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
/// One projected, render-ready summary card — the native analogue of the web <c>SummaryCard</c> (an
/// uppercase label, a pre-formatted value and an optional unit suffix). Pure data so every value is asserted
/// headlessly.
/// </summary>
public sealed record SummaryStatCard(string Label, string Value, string? Unit, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Summary-stats grid — the six cards the web component draws
/// plus the localized surface label. The grid is always populated (web parity: the cards render zeroed when
/// there are no sessions), so <see cref="Cards"/> always has six entries; <see cref="HasData"/> only reflects
/// whether real sessions backed the figures. Pure data.
/// </summary>
public sealed record SummaryStatsDisplay(
    IReadOnlyList<SummaryStatCard> Cards,
    bool HasData,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="ChargingSummary"/> to its <see cref="SummaryStatsDisplay"/> — the
/// native port of the render logic in
/// web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx. The six cards reproduce the web
/// call sites one-for-one: <c>fmtInt</c> for the session count and average duration (zero decimals),
/// <c>fmtNumber</c> at the user's decimal precision for energy / average rate / peak rate, and
/// <c>formatCurrency</c> for the total cost. The unit suffixes ("kWh", "kW", "min") are SI/clock symbols the
/// web hard-codes, so they stay literal; every translatable label resolves through the i18n facade using the
/// same keys the web source passes to <c>t()</c>. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class SummaryStatsProjection
{
    /// <summary>Default decimal precision (the web global <c>fmtNumber</c> / <c>useFormatting</c> default).</summary>
    public const int DefaultPrecision = 2;

    /// <summary>The energy unit the web grid suffixes onto the (Wh-summed) total energy value.</summary>
    public const string EnergyUnit = "kWh";

    /// <summary>The power unit the web grid suffixes onto the average and peak charge-rate values.</summary>
    public const string PowerUnit = "kW";

    /// <summary>The duration unit the web grid suffixes onto the average-duration value.</summary>
    public const string DurationUnit = "min";

    /// <summary>Project <paramref name="stats"/> using the user's <paramref name="currencySymbol"/> + precision + i18n facade.</summary>
    public static SummaryStatsDisplay Project(
        ChargingSummary stats,
        string currencySymbol,
        int decimalPrecision,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(stats);
        ArgumentNullException.ThrowIfNull(localizer);

        string symbol = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;
        int precision = decimalPrecision < 0 ? 0 : decimalPrecision;

        var cards = new[]
        {
            Card(
                localizer.GetString("charging.curve.totalSessions", "Total Sessions"),
                ScalarFormatters.FormatNumber(stats.TotalSessions, 0),
                unit: null),
            Card(
                localizer.GetString("charging.curve.totalEnergy", "Total Energy"),
                ScalarFormatters.FormatNumber(stats.TotalEnergyWh, precision),
                EnergyUnit),
            Card(
                localizer.GetString("charging.curve.avgChargeRate", "Avg Charge Rate"),
                ScalarFormatters.FormatNumber(stats.AvgRateKw, precision),
                PowerUnit),
            Card(
                localizer.GetString("charging.curve.peakRate", "Peak Rate"),
                ScalarFormatters.FormatNumber(stats.PeakRateKw, precision),
                PowerUnit),
            Card(
                localizer.GetString("charging.curve.avgDuration", "Avg Duration"),
                ScalarFormatters.FormatNumber(stats.AvgDurationMin, 0),
                DurationUnit),
            Card(
                localizer.GetString("charging.curve.totalCost", "Total Cost"),
                ScalarFormatters.FormatCurrency(stats.TotalCost, symbol, precision),
                unit: null),
        };

        return new SummaryStatsDisplay(
            Cards: cards,
            HasData: stats.HasData,
            AutomationName: localizer.GetString("charging.curve.summaryAria", "Charging summary statistics"));
    }

    private static SummaryStatCard Card(string label, string value, string? unit)
    {
        string automation = unit is null
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value)
            : string.Format(CultureInfo.CurrentCulture, "{0}: {1} {2}", label, value, unit);
        return new SummaryStatCard(label, value, unit, automation);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto reduced
/// <c>RepositoryResult&lt;ChargingSummary&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline) so the view-model can render the full state matrix. Pure so the parse-and-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class SummaryStatsResultMapper
{
    /// <summary>Reduce <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<ChargingSummary> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        ChargingSummary Parse() =>
            raw.HasValue ? ChargingSummary.FromSessionsJson(raw.Value) : ChargingSummary.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<ChargingSummary>.Loading(),
            LoadStatus.Cached => RepositoryResult<ChargingSummary>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<ChargingSummary>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<ChargingSummary>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<ChargingSummary>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<ChargingSummary>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<ChargingSummary>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Summary-stats grid surface — the native mirror of the web component at
/// web/src/features/charging/components/charging-curve/SummaryStatsGrid.tsx. The surface aggregates the same
/// charging sessions the Charging-Curve page feeds the grid.
/// </summary>
public static class SummaryStatsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "summary-stats-grid";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SummaryStatsGrid";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.curve.title", "Charging Curve");
    }
}

/// <summary>
/// PII-safe diagnostics for the Summary-stats surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never an energy figure, cost or session
/// count — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SummaryStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SummaryStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SummaryStatsGrid</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SummaryStatsRegistration.Slug}");
    }
}
