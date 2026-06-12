using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The lifecycle state the <see cref="CostAnalysisPageViewModel"/> can be in — the native union of the web
/// Cost Analysis page's three data branches
/// (web/src/features/charging/components/cost-analysis, route <c>/charging/costs</c>): the page-level
/// <c>loading</c> skeleton (web <c>if (isLoading) return &lt;LoadingSkeleton/&gt;</c>), the page-level
/// <c>empty</c> surface (web <c>if (!sessions || sessions.length === 0)</c>), and the populated
/// <c>success</c> layout — plus the cached/stale/offline freshness branches the shared cache-then-network
/// engine emits over the same charging-sessions read. The page renders the full section stack for
/// <see cref="Loaded"/>, <see cref="Stale"/> and <see cref="Offline"/>; only a genuinely empty (or
/// session-less) response collapses to <see cref="Empty"/>, and a failed first read with no cache to
/// <see cref="Error"/>.
/// </summary>
public enum CostAnalysisState
{
    /// <summary>Initial fetch with no cached snapshot — the web full-page <c>LoadingSkeleton</c>.</summary>
    Loading,

    /// <summary>A fresh snapshot with at least one charging session — render the full section stack.</summary>
    Loaded,

    /// <summary>The response carried no charging sessions — render the page-level empty state.</summary>
    Empty,

    /// <summary>The first read failed with no cache — render the error banner.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The economics constants the page reuses to project the monthly buckets — the native mirror of
/// web/src/features/charging/components/cost-analysis/constants.ts. They feed the same gas-equivalent
/// arithmetic the web monthly table renders before the interactive SavingsCalculator overrides the price /
/// efficiency assumptions, so the default monthly view matches the web on first paint.
/// </summary>
public static class CostAnalysisConstants
{
    /// <summary>Default gasoline price per gallon (web <c>DEFAULT_GAS_PRICE</c>).</summary>
    public const double DefaultGasPrice = 3.5;

    /// <summary>Default comparison vehicle efficiency in miles-per-gallon (web <c>DEFAULT_MPG</c>).</summary>
    public const double DefaultMpg = 30;

    /// <summary>Energy-equivalent of a gallon of gasoline, in kWh (web <c>KWH_PER_GALLON</c>).</summary>
    public const double KwhPerGallon = 33.7;
}

/// <summary>
/// One charging session row the page aggregates — the native projection of the web <c>ChargingSession</c>
/// (web/src/api/types.ts) limited to the fields <c>useCostAnalysisData</c>
/// (web/src/features/charging/components/cost-analysis/useCostAnalysisData.ts) reads to build the monthly
/// buckets, the per-session cost-per-kWh trend and the charger-type breakdown. Parsing is null-tolerant so a
/// partial row never throws. Energy is SI watt-hours on the wire; the page converts to display kWh only at
/// aggregation time. Pure data — no WinUI types — so the aggregator is unit-tested without a UI host.
/// </summary>
/// <param name="StartedAt">Session start instant (web <c>s.started_at</c>); null when unparseable.</param>
/// <param name="CostDecimal">Recorded session cost (web <c>s.cost_decimal</c>); null when absent.</param>
/// <param name="EnergyAddedWh">Energy added in watt-hours (web <c>s.total_energy_added_wh</c>).</param>
/// <param name="ChargerType">Raw charger type label (web <c>s.charger_type</c>); null when absent.</param>
/// <param name="PeakPowerW">Peak power in watts (web <c>s.peak_power_w</c>); null when absent.</param>
/// <param name="StartPlace">Start place label (web <c>s.start_place</c>); null when absent.</param>
public sealed record CostAnalysisSession(
    DateTimeOffset? StartedAt,
    double? CostDecimal,
    double EnergyAddedWh,
    string? ChargerType,
    double? PeakPowerW,
    string? StartPlace)
{
    /// <summary>Parse a charging-sessions JSON array into a tolerant list of rows.</summary>
    public static IReadOnlyList<CostAnalysisSession> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CostAnalysisSession>();
        }

        var list = new List<CostAnalysisSession>(element.GetArrayLength());
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
    public static CostAnalysisSession FromJson(JsonElement obj) => new(
        StartedAt: GetDate(obj, "started_at"),
        CostDecimal: GetDouble(obj, "cost_decimal"),
        EnergyAddedWh: GetDouble(obj, "total_energy_added_wh") ?? 0,
        ChargerType: GetString(obj, "charger_type"),
        PeakPowerW: GetDouble(obj, "peak_power_w"),
        StartPlace: GetString(obj, "start_place"));

    /// <summary>The <c>YYYY-MM</c> bucket key the web derives from the session start (its calendar month).</summary>
    public string? MonthKey =>
        StartedAt is { } at ? string.Create(CultureInfo.InvariantCulture, $"{at.Year:D4}-{at.Month:D2}") : null;

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

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static DateTimeOffset? GetDate(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// The four already-projected presentational chart models the page hands to its child chart surfaces — the
/// native analogue of the <c>monthlyData</c>, <c>costPerKwhTrend</c> and <c>chargerTypeData</c> slices the web
/// page computes once in <c>useCostAnalysisData</c> and threads into <c>&lt;MonthlyCostChart/&gt;</c>,
/// <c>&lt;CostPerKwhChart/&gt;</c>, <c>&lt;ChargerTypeBreakdown/&gt;</c> and <c>&lt;MonthlyCostTable/&gt;</c>.
/// Building the child render models here (rather than re-fetching per child) keeps the page the single
/// aggregation owner the web page is. Pure data — no WinUI types.
/// </summary>
/// <param name="Monthly">The monthly cost area-chart model (web <c>MonthlyCostChart data</c>).</param>
/// <param name="MonthlyTable">The monthly cost table model (web <c>MonthlyCostTable data</c>).</param>
/// <param name="CostPerKwh">The per-session cost-per-kWh trend model (web <c>CostPerKwhChart data</c>).</param>
/// <param name="ChargerType">The charger-type breakdown model (web <c>ChargerTypeBreakdown data</c>).</param>
public sealed record CostAnalysisCharts(
    MonthlyCostChartModel Monthly,
    MonthlyCostTableModel MonthlyTable,
    CostPerKwhChartModel CostPerKwh,
    ChargerTypeBreakdownModel ChargerType)
{
    /// <summary>The all-empty bundle (no sessions) — every child renders its own empty branch.</summary>
    public static CostAnalysisCharts Empty { get; } = new(
        MonthlyCostChartModel.Empty,
        new MonthlyCostTableModel(Array.Empty<MonthlyBucket>()),
        new CostPerKwhChartModel(false, Array.Empty<CostPerKwhPoint>()),
        new ChargerTypeBreakdownModel(false, 0, Array.Empty<ChargerTypeDatum>()));
}

/// <summary>
/// The native port of the chart-feeding slice of web <c>useCostAnalysisData</c>: it folds the page's
/// charging-session list into the monthly buckets, the per-session cost-per-kWh trend and the charger-type
/// breakdown — the same three derivations the web page threads into its presentational chart children. SI
/// energy is converted to display kWh exactly where the web converts it (<c>convertEnergyFromSI(wh,'kWh')</c>
/// = watt-hours ÷ 1000) and the default gas price / efficiency seed the monthly gas-equivalent line so the
/// first paint matches the web before the interactive calculator overrides them. Pure data — no WinUI types.
/// </summary>
public static class CostAnalysisAggregator
{
    private sealed class Bucket
    {
        public double Cost;
        public double EnergyWh;
        public int Sessions;
    }

    /// <summary>Fold <paramref name="sessions"/> into the four presentational chart models.</summary>
    public static CostAnalysisCharts Build(IReadOnlyList<CostAnalysisSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);
        if (sessions.Count == 0)
        {
            return CostAnalysisCharts.Empty;
        }

        var monthly = BuildMonthly(sessions);
        return new CostAnalysisCharts(
            new MonthlyCostChartModel(monthly.Select(m => new MonthlyCostPoint(m.Month, m.Cost)).ToArray()),
            new MonthlyCostTableModel(monthly),
            new CostPerKwhChartModel(false, BuildCostPerKwhTrend(sessions)),
            BuildChargerType(sessions));
    }

    /// <summary>Categorize a session into one of the four web charger buckets (web <c>categorizeCharger</c>).</summary>
    public static string CategorizeCharger(CostAnalysisSession session)
    {
        ArgumentNullException.ThrowIfNull(session);
        string ct = (session.ChargerType ?? string.Empty).ToLowerInvariant();
        if (ct.Contains("tesla", StringComparison.Ordinal) || ct.Contains("supercharger", StringComparison.Ordinal))
        {
            return "Supercharger";
        }

        if ((session.PeakPowerW ?? 0) > 22_000)
        {
            return "Public DC";
        }

        string loc = (session.StartPlace ?? string.Empty).ToLowerInvariant();
        if (loc.Contains("work", StringComparison.Ordinal) || loc.Contains("office", StringComparison.Ordinal))
        {
            return "Work / L2";
        }

        return "Home";
    }

    private static List<MonthlyBucket> BuildMonthly(IReadOnlyList<CostAnalysisSession> sessions)
    {
        var buckets = new SortedDictionary<string, Bucket>(StringComparer.Ordinal);
        foreach (var s in sessions)
        {
            if (s.MonthKey is not { } key)
            {
                continue;
            }

            if (!buckets.TryGetValue(key, out var bucket))
            {
                bucket = new Bucket();
                buckets[key] = bucket;
            }

            bucket.Cost += s.CostDecimal ?? 0;
            bucket.EnergyWh += s.EnergyAddedWh;
            bucket.Sessions++;
        }

        var rows = new List<MonthlyBucket>(buckets.Count);
        foreach (var (month, v) in buckets)
        {
            double energyKwh = v.EnergyWh / 1000.0;
            double gasEquiv = GasEquivalentCost(energyKwh, CostAnalysisConstants.DefaultMpg, CostAnalysisConstants.DefaultGasPrice);
            rows.Add(new MonthlyBucket(
                Month: month,
                Cost: v.Cost,
                Energy: energyKwh,
                Sessions: v.Sessions,
                AvgCostPerKwh: energyKwh > 0 ? v.Cost / energyKwh : 0,
                GasEquiv: gasEquiv,
                Savings: gasEquiv - v.Cost));
        }

        return rows;
    }

    private static CostPerKwhPoint[] BuildCostPerKwhTrend(IReadOnlyList<CostAnalysisSession> sessions)
    {
        var ordered = sessions
            .Where(s => s.CostDecimal is not null && s.EnergyAddedWh > 0 && s.StartedAt is not null)
            .OrderBy(s => s.StartedAt!.Value)
            .Select(s => new CostPerKwhPoint(
                FormatDateShort(s.StartedAt!.Value),
                (s.CostDecimal ?? 0) / (s.EnergyAddedWh / 1000.0)))
            .ToArray();
        return ordered;
    }

    private static ChargerTypeBreakdownModel BuildChargerType(IReadOnlyList<CostAnalysisSession> sessions)
    {
        var groups = new Dictionary<string, Bucket>(StringComparer.Ordinal);
        double totalCost = 0;
        foreach (var s in sessions)
        {
            string cat = CategorizeCharger(s);
            if (!groups.TryGetValue(cat, out var bucket))
            {
                bucket = new Bucket();
                groups[cat] = bucket;
            }

            double cost = s.CostDecimal ?? 0;
            bucket.Cost += cost;
            bucket.EnergyWh += s.EnergyAddedWh;
            bucket.Sessions++;
            totalCost += cost;
        }

        var items = groups
            .Select(g => new ChargerTypeDatum(g.Key, g.Value.Cost, g.Value.EnergyWh / 1000.0, g.Value.Sessions))
            .OrderByDescending(d => d.Cost)
            .ToArray();
        return new ChargerTypeBreakdownModel(false, totalCost, items);
    }

    // Web gasEquivalentCost(energyKwh, mpg, gasPrice) simplifies to (energyKwh / KWH_PER_GALLON) * gasPrice.
    private static double GasEquivalentCost(double energyKwh, double mpg, double gasPrice)
    {
        double gallonsEquiv = energyKwh / CostAnalysisConstants.KwhPerGallon;
        double milesEquiv = gallonsEquiv * mpg;
        return mpg > 0 ? (milesEquiv / mpg) * gasPrice : 0;
    }

    private static string FormatDateShort(DateTimeOffset value) =>
        value.ToString("MMM d", CultureInfo.InvariantCulture);
}

/// <summary>
/// Maps a raw cache-then-network <see cref="RepositoryResult{T}"/> of the charging-sessions JSON body into a
/// parsed <see cref="CostAnalysisSession"/> list, preserving the load status, freshness and any error so the
/// view-model's state machine can fold each emission. The native analogue of the web page consuming
/// <c>useChargingSessionsPaginated</c>'s <c>data</c> through <c>useCostAnalysisData</c>.
/// </summary>
public static class CostAnalysisResultMapper
{
    /// <summary>Project a JSON emission into the parsed session list, keeping the repository envelope.</summary>
    public static RepositoryResult<IReadOnlyList<CostAnalysisSession>> Map(RepositoryResult<JsonElement> raw) => raw.Status switch
    {
        LoadStatus.Loading => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loading(),
        LoadStatus.Empty => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Empty(raw.FetchedAt),
        LoadStatus.Error => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Failure(
            raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Failed to load charging sessions")),
        LoadStatus.Cached => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Cached(Parse(raw), raw.FetchedAt ?? default, raw.IsStale),
        LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Refreshing(Parse(raw), raw.FetchedAt ?? default, raw.IsStale),
        LoadStatus.Offline => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.OfflineCached(
            Parse(raw), raw.FetchedAt ?? default, raw.Error ?? new RepositoryError(RepositoryErrorKind.Network, "Offline")),
        _ => RepositoryResult<IReadOnlyList<CostAnalysisSession>>.Loaded(Parse(raw), raw.FetchedAt ?? default),
    };

    private static IReadOnlyList<CostAnalysisSession> Parse(RepositoryResult<JsonElement> raw) =>
        raw.HasValue ? CostAnalysisSession.ParseList(raw.Value) : Array.Empty<CostAnalysisSession>();
}

/// <summary>
/// The render-ready page chrome strings — the native projection of the four page-level literals the web Cost
/// Analysis page renders (<c>costAnalysis.title</c>, <c>costAnalysis.subtitle</c>,
/// <c>costAnalysis.empty.title</c>, <c>costAnalysis.empty.message</c>). Pure data — every value already
/// resolved through the i18n facade by <see cref="CostAnalysisProjection"/>.
/// </summary>
/// <param name="Title">Page title (web <c>costAnalysis.title</c>).</param>
/// <param name="Subtitle">Page subtitle (web <c>costAnalysis.subtitle</c>).</param>
/// <param name="EmptyTitle">Empty-state heading (web <c>costAnalysis.empty.title</c>).</param>
/// <param name="EmptyMessage">Empty-state body (web <c>costAnalysis.empty.message</c>).</param>
public sealed record CostAnalysisDisplay(string Title, string Subtitle, string EmptyTitle, string EmptyMessage);

/// <summary>
/// Resolves the page chrome strings through the <see cref="ILocalizer"/> facade with the web key names and
/// English fallbacks, so every visible literal flows through one keyed call site (asserted in the headless
/// string-coverage test and resolved against <c>Strings/*.resw</c> in the app).
/// </summary>
public static class CostAnalysisProjection
{
    /// <summary>Project the four page-level strings.</summary>
    public static CostAnalysisDisplay Project(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new CostAnalysisDisplay(
            Title: CostAnalysisRegistration.Title(localizer),
            Subtitle: CostAnalysisRegistration.Subtitle(localizer),
            EmptyTitle: CostAnalysisRegistration.EmptyTitle(localizer),
            EmptyMessage: CostAnalysisRegistration.EmptyMessage(localizer));
    }
}

/// <summary>
/// The shell registration metadata for the Cost Analysis page — the route name the
/// <see cref="TeslaSync.App.Core.Navigation.RouteTable"/> already maps to <c>/cost-analysis</c> (and the
/// hidden <c>/charging/costs</c> deep link), the diagnostics slug, and the i18n-resolved title / subtitle /
/// empty-state strings the view and the registration share.
/// </summary>
public static class CostAnalysisRegistration
{
    /// <summary>The route name the shell page factory registers this page under.</summary>
    public static string RouteName => "CostAnalysis";

    /// <summary>The diagnostics slug (web component family).</summary>
    public static string Slug => "CostAnalysisPage";

    /// <summary>The localized page title (web <c>costAnalysis.title</c>).</summary>
    public static string Title(ILocalizer localizer) =>
        Require(localizer).GetString("costAnalysis.title", "Cost Analysis");

    /// <summary>The localized page subtitle (web <c>costAnalysis.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer) =>
        Require(localizer).GetString(
            "costAnalysis.subtitle",
            "Electricity cost trends, gas savings, and charging economics");

    /// <summary>The localized empty-state heading (web <c>costAnalysis.empty.title</c>).</summary>
    public static string EmptyTitle(ILocalizer localizer) =>
        Require(localizer).GetString("costAnalysis.empty.title", "No Charging Data");

    /// <summary>The localized empty-state body (web <c>costAnalysis.empty.message</c>).</summary>
    public static string EmptyMessage(ILocalizer localizer) =>
        Require(localizer).GetString(
            "costAnalysis.empty.message",
            "Start charging your vehicle to see cost analysis and savings trends.");

    private static ILocalizer Require(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer;
    }
}

/// <summary>
/// The PII-safe diagnostics sink for the Cost Analysis page — records the <c>view.opened</c> event with the
/// page slug (no vehicle id, route params or session contents). Mirrors the other W7 page diagnostics.
/// </summary>
public sealed class CostAnalysisDiagnostics
{
    private readonly Action<string>? _sink;
    private int _viewsOpened;

    /// <summary>Creates the sink over an optional line emitter (the tests pass a capturing list).</summary>
    public CostAnalysisDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public int ViewsOpened => _viewsOpened;

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=CostAnalysisPage</c>.</summary>
    public void RecordViewOpened()
    {
        _viewsOpened++;
        _sink?.Invoke($"view.opened slug={CostAnalysisRegistration.Slug}");
    }
}
