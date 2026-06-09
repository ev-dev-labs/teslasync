using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive lifecycle state the <see cref="EnvironmentalImpactViewModel"/> can be in — the
/// native union of the branches the web Environmental-Impact card renders
/// (web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx). The web component is a pure
/// child of the Cost-Analysis page (it takes a pre-computed <c>coreStats: CoreStats | null</c>); the native
/// surface binds its own cache-then-network read of the charging-sessions list and derives the same
/// environmental projection itself, so it owns the full loading / loaded / empty / error / stale / offline
/// matrix the P2 state contract requires. Every value maps onto a visible surface (never a blank panel):
/// <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/> render the green CO₂/tree tiles, the
/// descriptive sentence and the three sub-stats (with the stale / offline chip for the latter two),
/// <see cref="Empty"/> renders the friendly "No data" surface (web parity: <c>coreStats === null</c> when
/// there are no sessions), <see cref="Loading"/> shows the skeleton chrome and <see cref="Error"/> the retry
/// surface.
/// </summary>
public enum EnvironmentalImpactState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carried no charging sessions (web <c>coreStats === null</c>).</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the card plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the card plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The environmental-impact constants shared with the web Cost-Analysis page
/// (web/src/features/charging/components/cost-analysis/constants.ts). Held here, UI-free, so the projection is
/// unit-tested against the same numeric envelope the web renders.
/// </summary>
public static class EnvironmentalImpactConstants
{
    /// <summary>Kilograms of CO₂ per gallon of gasoline burned (web <c>CO2_PER_GAL_KG</c>).</summary>
    public const double Co2PerGallonKg = 8.887;

    /// <summary>Kilograms of CO₂ a single tree absorbs in a year (web <c>KG_CO2_PER_TREE_YEAR</c>).</summary>
    public const double KgCo2PerTreeYear = 22.0;

    /// <summary>Energy-equivalent of one gallon of gasoline in kWh (web <c>KWH_PER_GALLON</c>).</summary>
    public const double KwhPerGallon = 33.7;

    /// <summary>Default gasoline price per gallon (web <c>DEFAULT_GAS_PRICE</c>, the Cost-Analysis default).</summary>
    public const double DefaultGasPrice = 3.5;

    /// <summary>Kilograms per metric ton — the divisor behind the "metric tons CO₂" sub-stat (web <c>/ 1000</c>).</summary>
    public const double KgPerMetricTon = 1000.0;
}

/// <summary>
/// One parsed charging session reduced to just the fields the environmental projection needs — the native
/// mirror of the web <c>ChargingSession</c> subset <c>useCostAnalysisData</c> reads for the core stats
/// (<c>total_energy_added_wh</c> and the optional <c>cost_decimal</c>). Field names mirror the Go API's
/// snake_case JSON tags; parsing is null-tolerant so a partial row never throws. WinUI-free so the parse is
/// unit-tested without a UI host.
/// </summary>
public sealed record EnvironmentalImpactSession(long Id, double? TotalEnergyAddedWh, double? CostDecimal)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows, preserving order.</summary>
    public static IReadOnlyList<EnvironmentalImpactSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<EnvironmentalImpactSession>();
        }

        var list = new List<EnvironmentalImpactSession>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single charging-session JSON object into a tolerant row.</summary>
    public static EnvironmentalImpactSession FromJson(JsonElement obj) => new(
        GetLong(obj, "id") ?? 0,
        GetDouble(obj, "total_energy_added_wh"),
        GetDouble(obj, "cost_decimal"));

    private static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
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
/// The aggregate environmental statistics for a set of charging sessions — the native mirror of the subset of
/// the web <c>CoreStats</c> the Environmental-Impact card reads (<c>co2SavedKg</c>, <c>treeEquiv</c>,
/// <c>gallonsEquiv</c>, <c>savings</c>), plus the intermediate totals they derive from. Pure data, UI-free, so
/// the derivation is asserted headlessly against the web envelope.
/// </summary>
public sealed record EnvironmentalCoreStats(
    double TotalCost,
    double TotalEnergyKwh,
    double GallonsEquiv,
    double GasCost,
    double Savings,
    double Co2SavedKg,
    double TreeEquiv,
    int Count)
{
    /// <summary>Metric tons of CO₂ avoided — the web "metric tons CO₂" sub-stat (<c>co2SavedKg / 1000</c>).</summary>
    public double MetricTonsCo2 => Co2SavedKg / EnvironmentalImpactConstants.KgPerMetricTon;
}

/// <summary>
/// One projected, render-ready metric — the native mirror of a single web stat tile (the green CO₂/tree tiles
/// and the three sub-stats), carrying the formatted value, its localized label and a composed accessible name.
/// Pure data so the projection is asserted without a UI host.
/// </summary>
public sealed record EnvironmentalMetric(string ValueText, string Label, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the Environmental-Impact surface — the localized title, the two
/// green headline tiles (kg CO₂ saved, tree-years equivalent), the descriptive sentence broken into its plain
/// and emphasized segments (so the view can bold the two figures exactly as the web does), the three sub-stats
/// (gallons avoided, metric tons CO₂, $ saved), the empty-state message and the accessible summary.
/// <see cref="HasData"/> drives the content-vs-empty branch (web parity: <c>coreStats</c> is non-null only when
/// at least one session exists). Pure data so every branch is asserted without a UI host.
/// </summary>
public sealed record EnvironmentalImpactDisplay(
    bool HasData,
    int Count,
    string Title,
    IReadOnlyList<EnvironmentalMetric> Tiles,
    IReadOnlyList<EnvironmentalMetric> Stats,
    string DescriptionPrefix,
    string Co2Emphasis,
    string OfCo2,
    string TreeNote,
    string TreeEmphasis,
    string TreesAbsorbing,
    string DescriptionPlain,
    string EmptyMessage,
    string AriaLabel,
    string AutomationName)
{
    /// <summary>An all-empty display (the friendly "No data" surface) for the loading / empty fallback.</summary>
    public static EnvironmentalImpactDisplay Empty(ILocalizer localizer) =>
        EnvironmentalImpactProjection.Project(Array.Empty<EnvironmentalImpactSession>(), localizer);
}

/// <summary>
/// Pure projection from parsed <see cref="EnvironmentalImpactSession"/> rows to an
/// <see cref="EnvironmentalImpactDisplay"/> — the native port of the <c>coreStats</c> reduction in
/// <c>useCostAnalysisData</c> plus the render logic in EnvironmentalImpact.tsx
/// (web/src/features/charging/components/cost-analysis). It sums the session cost and energy, derives the
/// gallons-equivalent, gas cost, savings, CO₂ saved and tree-years equivalent against the shared constants,
/// then formats every figure exactly as the web does (<c>fmtNumber</c> at the same per-figure precision). Every
/// label resolves through the i18n facade. WinUI-free — unit-tested without a UI host.
/// </summary>
public static class EnvironmentalImpactProjection
{
    /// <summary>Project <paramref name="sessions"/> using the localizer for every label.</summary>
    /// <param name="sessions">The charging sessions (the backend orders <c>started_at DESC</c>, newest first).</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    public static EnvironmentalImpactDisplay Project(
        IReadOnlyList<EnvironmentalImpactSession> sessions,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        ArgumentNullException.ThrowIfNull(localizer);

        var stats = ComputeStats(sessions);

        string title = localizer.GetString("costAnalysis.environment.title", "Environmental Impact");
        string kgCo2 = localizer.GetString("costAnalysis.environment.kgCo2", "kg CO\u2082 saved");
        string treeEquiv = localizer.GetString("costAnalysis.environment.treeEquiv", "tree-years equivalent");
        string descPrefix = localizer.GetString(
            "costAnalysis.environment.desc",
            "By driving electric instead of a gas car, you have avoided the equivalent of");
        string ofCo2 = localizer.GetString("costAnalysis.environment.ofCo2", "of CO\u2082 emissions.");
        string treeNote = localizer.GetString("costAnalysis.environment.treeNote", "That's the same as");
        string treesAbsorbing = localizer.GetString(
            "costAnalysis.environment.treesAbsorbing", "trees absorbing carbon for a full year.");
        string gallons = localizer.GetString("costAnalysis.environment.gallons", "gallons avoided");
        string metricTons = localizer.GetString("costAnalysis.environment.metricTons", "metric tons CO\u2082");
        string dollarsSaved = localizer.GetString("costAnalysis.environment.dollarsSaved", "$ saved total");
        string noData = localizer.GetString("costAnalysis.environment.noData", "No data");

        if (stats is null)
        {
            return new EnvironmentalImpactDisplay(
                HasData: false,
                Count: 0,
                Title: title,
                Tiles: Array.Empty<EnvironmentalMetric>(),
                Stats: Array.Empty<EnvironmentalMetric>(),
                DescriptionPrefix: descPrefix,
                Co2Emphasis: string.Empty,
                OfCo2: ofCo2,
                TreeNote: treeNote,
                TreeEmphasis: string.Empty,
                TreesAbsorbing: treesAbsorbing,
                DescriptionPlain: string.Empty,
                EmptyMessage: noData,
                AriaLabel: Compose(title, noData),
                AutomationName: Compose(title, noData));
        }

        // Web: fmtNumber(co2SavedKg, 1) / fmtNumber(treeEquiv, 1) headline tiles.
        var tiles = new[]
        {
            Metric(Number(stats.Co2SavedKg, 1), kgCo2),
            Metric(Number(stats.TreeEquiv, 1), treeEquiv),
        };

        // Web: gallons fmtNumber(_, 1), metric tons fmtNumber(co2/1000, 2), savings fmtNumber(_, 0).
        var subStats = new[]
        {
            Metric(Number(stats.GallonsEquiv, 1), gallons),
            Metric(Number(stats.MetricTonsCo2, 2), metricTons),
            Metric(Number(stats.Savings, 0), dollarsSaved),
        };

        // Web emphasizes `{fmtNumber(co2SavedKg, 0)} kg` and `{fmtNumber(treeEquiv, 1)}` inside the sentence.
        string co2Emphasis = string.Format(CultureInfo.CurrentCulture, "{0} kg", Number(stats.Co2SavedKg, 0));
        string treeEmphasis = Number(stats.TreeEquiv, 1);
        string descriptionPlain = string.Join(
            ' ', descPrefix, co2Emphasis, ofCo2, treeNote, treeEmphasis, treesAbsorbing);

        string aria = string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, descriptionPlain);

        return new EnvironmentalImpactDisplay(
            HasData: true,
            Count: stats.Count,
            Title: title,
            Tiles: tiles,
            Stats: subStats,
            DescriptionPrefix: descPrefix,
            Co2Emphasis: co2Emphasis,
            OfCo2: ofCo2,
            TreeNote: treeNote,
            TreeEmphasis: treeEmphasis,
            TreesAbsorbing: treesAbsorbing,
            DescriptionPlain: descriptionPlain,
            EmptyMessage: noData,
            AriaLabel: aria,
            AutomationName: aria);
    }

    /// <summary>
    /// Compute the aggregate environmental statistics — the native port of the <c>coreStats</c> reduction.
    /// Returns <c>null</c> when there are no sessions (web parity: <c>if (!sessions || sessions.length === 0)
    /// return null</c>), so the surface can render the friendly empty state.
    /// </summary>
    public static EnvironmentalCoreStats? ComputeStats(IReadOnlyList<EnvironmentalImpactSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        if (sessions.Count == 0)
        {
            return null;
        }

        double totalCost = 0;
        double totalWh = 0;
        foreach (var s in sessions)
        {
            totalCost += s.CostDecimal ?? 0;
            totalWh += s.TotalEnergyAddedWh ?? 0;
        }

        // Web: convertEnergyFromSI(totalWh, 'kWh') === totalWh / 1000.
        double totalEnergyKwh = totalWh / 1000.0;
        double gallonsEquiv = totalEnergyKwh / EnvironmentalImpactConstants.KwhPerGallon;
        double gasCost = gallonsEquiv * EnvironmentalImpactConstants.DefaultGasPrice;
        double savings = gasCost - totalCost;
        double co2SavedKg = gallonsEquiv * EnvironmentalImpactConstants.Co2PerGallonKg;
        double treeEquiv = co2SavedKg / EnvironmentalImpactConstants.KgCo2PerTreeYear;

        return new EnvironmentalCoreStats(
            TotalCost: totalCost,
            TotalEnergyKwh: totalEnergyKwh,
            GallonsEquiv: gallonsEquiv,
            GasCost: gasCost,
            Savings: savings,
            Co2SavedKg: co2SavedKg,
            TreeEquiv: treeEquiv,
            Count: sessions.Count);
    }

    private static EnvironmentalMetric Metric(string value, string label) =>
        new(value, label, Compose(label, value));

    private static string Number(double value, int decimals) =>
        NumberFormatting.Format(value, null, decimals);

    private static string Compose(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;EnvironmentalImpactSession&gt;&gt;</c>, preserving every freshness
/// flag (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class EnvironmentalImpactResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<EnvironmentalImpactSession> Parse() =>
            raw.HasValue ? EnvironmentalImpactSession.ParseList(raw.Value) : Array.Empty<EnvironmentalImpactSession>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<EnvironmentalImpactSession>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the Environmental-Impact feature surface — the native mirror of the web component at
/// web/src/features/charging/components/cost-analysis/EnvironmentalImpact.tsx. The surface reads the same
/// charging-sessions list the web Cost-Analysis page feeds the core-stats reduction.
/// </summary>
public static class EnvironmentalImpactRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "environmental-impact";

    /// <summary>Surface category.</summary>
    public const string Category = "charging";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "EnvironmentalImpact";

    /// <summary>Localized surface name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("costAnalysis.environment.title", "Environmental Impact");
    }
}

/// <summary>
/// PII-safe diagnostics for the Environmental-Impact surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a session id, cost, energy or emissions
/// figure — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class EnvironmentalImpactDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public EnvironmentalImpactDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=EnvironmentalImpact</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={EnvironmentalImpactRegistration.Slug}");
    }
}
