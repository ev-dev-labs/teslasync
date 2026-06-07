using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="BatteryDegradationForecastViewModel"/> can be in — the native union
/// of the loading / loaded / empty / error / stale / offline branches the web
/// <c>BatteryDegradationForecastWidget</c> renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx). Every branch maps onto a
/// visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>hasData</c> gate (no
/// current-health value AND no projected-80% date) — the friendly "No degradation forecast data" empty
/// state — distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum BatteryDegradationForecastState
{
    /// <summary>Initial fetch with no cached forecast — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh forecast (or non-stale cache) carrying a current-health value or projected date.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or a forecast with no usable data — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached forecast exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached forecast older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached forecast remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One predictive risk-factor row from <c>GET /analytics/battery-degradation</c> (web
/// <c>RiskFactorData</c> in web/src/types/energy.ts): an identity <see cref="Name"/>, a numeric
/// <see cref="Score"/> (severity weight), and the optional human <see cref="Label"/> / <see cref="Detail"/>
/// the web component prefers over the raw name (<c>rf.label ?? rf.name</c>, <c>rf.detail ?? '—'</c>).
/// Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial row never
/// throws and <see cref="Label"/> / <see cref="Detail"/> stay <see langword="null"/> when absent so the
/// projection can apply the web fallbacks.
/// </summary>
public sealed record DegradationRiskFactor(string Name, double Score, string? Label, string? Detail)
{
    /// <summary>Project a single risk-factor JSON object into a tolerant <see cref="DegradationRiskFactor"/>.</summary>
    public static DegradationRiskFactor FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new DegradationRiskFactor(string.Empty, 0, null, null);
        }

        return new DegradationRiskFactor(
            Name: ForecastJson.String(element, "name") ?? string.Empty,
            Score: ForecastJson.Double(element, "score") ?? 0,
            Label: ForecastJson.String(element, "label"),
            Detail: ForecastJson.String(element, "detail"));
    }
}

/// <summary>
/// The predictive battery-degradation forecast read-model the widget consumes — the subset of the
/// <c>GET /analytics/battery-degradation</c> body (web <c>DegradationData</c>) the web
/// <c>BatteryDegradationForecastWidget</c> reads: the current health percentage
/// (<c>current_health_pct ?? current_health</c>), the monthly degradation rate, the projected date the
/// pack reaches 80% capacity, the risk factors, and the textual recommendations. All percentages are
/// already display-ready (the web shows them raw, no unit conversion). Parsing is tolerant so a partial or
/// non-object body yields <see cref="Empty"/> rather than throwing.
/// </summary>
public sealed record DegradationForecast(
    double? CurrentHealthPct,
    double DegradationRatePctPerMonth,
    bool HasProjectedDate,
    DateTimeOffset? ProjectedDate,
    IReadOnlyList<DegradationRiskFactor> RiskFactors,
    IReadOnlyList<string> Recommendations)
{
    /// <summary>A data-free forecast — the parse fallback for an absent/non-object body.</summary>
    public static DegradationForecast Empty { get; } =
        new(null, 0, false, null, Array.Empty<DegradationRiskFactor>(), Array.Empty<string>());

    /// <summary>
    /// True when there is something to render (web <c>hasData = currentHealthPct != null ||
    /// projected_80pct_date != null</c>): a resolved current-health value or a projected-80% date.
    /// </summary>
    public bool HasData => CurrentHealthPct != null || HasProjectedDate;

    /// <summary>Project a <c>GET /analytics/battery-degradation</c> JSON body into a tolerant forecast.</summary>
    public static DegradationForecast FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        // Web parity: current_health_pct wins, then current_health, then null (the ?? chain only falls
        // through on absent/null — a literal 0 is a valid health value and is kept).
        double? currentHealth = ForecastJson.Double(element, "current_health_pct")
            ?? ForecastJson.Double(element, "current_health");

        (bool hasProjected, DateTimeOffset? projected) = ForecastJson.Date(element, "projected_80pct_date");

        return new DegradationForecast(
            CurrentHealthPct: currentHealth,
            DegradationRatePctPerMonth: ForecastJson.Double(element, "degradation_rate_pct_per_month") ?? 0,
            HasProjectedDate: hasProjected,
            ProjectedDate: projected,
            RiskFactors: ReadRiskFactors(element),
            Recommendations: ReadRecommendations(element));
    }

    private static IReadOnlyList<DegradationRiskFactor> ReadRiskFactors(JsonElement element)
    {
        if (!element.TryGetProperty("risk_factors", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<DegradationRiskFactor>();
        }

        var list = new List<DegradationRiskFactor>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            list.Add(DegradationRiskFactor.FromJson(item));
        }

        return list;
    }

    private static IReadOnlyList<string> ReadRecommendations(JsonElement element)
    {
        if (!element.TryGetProperty("recommendations", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<string>();
        }

        var list = new List<string>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.String && item.GetString() is { } rec)
            {
                list.Add(rec);
            }
        }

        return list;
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx.
/// </summary>
public readonly record struct BatteryDegradationForecastSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static BatteryDegradationForecastSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): hide the title, show the compact health stat.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready risk-factor row consumed by the WinUI view — the native analogue of a web
/// risk-factor <c>&lt;li&gt;</c>. Holds the severity glyph (the web <c>riskIcon</c> mapping), the resolved
/// label + detail (the web <c>rf.label ?? rf.name</c> / <c>rf.detail ?? '—'</c> fallbacks), the formatted
/// score and its impact-coloured badge status (the web <c>scoreToImpact</c> mapping), plus a Narrator
/// automation name. Pure data — no WinUI types.
/// </summary>
public sealed record ForecastRiskItem(
    string Id,
    string Glyph,
    string Label,
    string Detail,
    string ScoreText,
    StatusKind ScoreStatus,
    string AutomationName);

/// <summary>
/// One projected, display-ready recommendation tip consumed by the WinUI view — the native analogue of a
/// web <c>TipItem</c> (the <c>tipItems</c> <c>useMemo</c>). Every recommendation maps to a lightbulb tip
/// with the localized "Tip" title, the recommendation text, and the medium-impact "Recommendation" badge
/// (web <c>impact: 'medium'</c>). Pure data — no WinUI types.
/// </summary>
public sealed record ForecastTip(
    string Id,
    string Glyph,
    string Title,
    string Description,
    string ImpactLabel,
    StatusKind ImpactStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the degradation forecast for one footprint — the native
/// analogue of everything the web component computes via <c>useMemo</c> before returning JSX. Holds the
/// health tier (badge), the compact health readout, the projected-80% hero, the monthly rate, the risk
/// factors, and the recommendation tips, plus the localized section labels. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record BatteryDegradationForecastDisplay(
    bool IsCompact,
    bool HasData,
    string TierKey,
    string TierLabel,
    StatusKind TierStatus,
    bool HasCurrentHealth,
    string CurrentHealthText,
    string CurrentHealthLabel,
    bool HasProjectedDate,
    string ProjectedDateText,
    string ProjectedDateLabel,
    bool ShowRate,
    string RateText,
    string RiskFactorsLabel,
    IReadOnlyList<ForecastRiskItem> RiskFactors,
    string RecommendationsLabel,
    IReadOnlyList<ForecastTip> Tips)
{
    /// <summary>True when there is at least one risk factor to surface (web <c>riskFactors.length &gt; 0</c>).</summary>
    public bool HasRiskFactors => RiskFactors.Count > 0;

    /// <summary>True when there is at least one recommendation tip to surface (web <c>tipItems.length &gt; 0</c>).</summary>
    public bool HasRecommendations => Tips.Count > 0;
}

/// <summary>
/// Pure projection from a raw <see cref="DegradationForecast"/> to the display model — the native port of
/// the <c>healthTier</c> / <c>riskIcon</c> / <c>scoreToImpact</c> helpers and the <c>tipItems</c>
/// <c>useMemo</c> in web/src/features/dashboard/widgets/BatteryDegradationForecastWidget.tsx. Percentages
/// are already display-ready (the web shows them raw, no unit conversion), so this only formats, labels and
/// derives badges; every label resolves through the i18n facade. The projected-80% date is rendered in the
/// app's canonical en-US "MMM yyyy" form (the native <c>DateTimeFormatting</c> convention, the analogue of
/// the web <c>useDateFormat</c> locale binding).
/// </summary>
public static class BatteryDegradationForecastProjection
{
    /// <summary>Segoe Fluent "MarketDown" glyph for the surface header / empty state (web <c>TrendingDown</c>).</summary>
    public const string HeaderGlyph = "\uEB0F";

    /// <summary>Maximum risk-factor rows rendered, mirroring the web <c>riskFactors.slice(0, 5)</c>.</summary>
    public const int MaxRiskFactors = 5;

    /// <summary>Maximum recommendation tips rendered, mirroring the web <c>WidgetTipCards maxTips={3}</c>.</summary>
    public const int MaxRecommendations = 3;

    /// <summary>Degradation rate (%/mo) at or under which the pack is "Healthy" (web <c>ratePctPerMonth &lt;= 0.05</c>).</summary>
    public const double HealthyMaxRate = 0.05;

    /// <summary>Degradation rate (%/mo) at or under which the pack is "Normal" (web <c>ratePctPerMonth &lt;= 0.12</c>).</summary>
    public const double NormalMaxRate = 0.12;

    /// <summary>Risk score at or above which impact is "high" — a danger badge (web <c>score &gt;= 7</c>).</summary>
    public const double HighImpactScore = 7;

    /// <summary>Risk score at or above which impact is "medium" — a warning badge (web <c>score &gt;= 4</c>).</summary>
    public const double MediumImpactScore = 4;

    private const string EmDash = "\u2014";
    private const string MinusSign = "\u2212";
    private const string TempGlyph = "\uE9CA";      // Segoe Fluent — Temperature (web Thermometer)
    private const string ZapGlyph = "\uE945";       // Segoe Fluent — LightningBolt (web Zap)
    private const string BatteryGlyph = "\uE83F";   // Segoe Fluent — Battery10 (web Battery)
    private const string WarningGlyph = "\uE7BA";   // Segoe Fluent — Warning (web AlertTriangle)
    private const string LightbulbGlyph = "\uEA80"; // Segoe Fluent — Lightbulb (web Lightbulb)

    private static readonly CultureInfo EnUs = CultureInfo.GetCultureInfo("en-US");

    /// <summary>
    /// Classify a monthly degradation rate into a health tier (web <c>healthTier</c>): the stable key
    /// (for the <c>widget.forecast.{key}</c> i18n lookup), the English fallback label, and the badge status.
    /// </summary>
    public static (string Key, string Label, StatusKind Status) TierFor(double ratePctPerMonth)
    {
        if (ratePctPerMonth <= HealthyMaxRate)
        {
            return ("healthy", "Healthy", StatusKind.Success);
        }

        return ratePctPerMonth <= NormalMaxRate
            ? ("normal", "Normal", StatusKind.Warning)
            : ("accelerated", "Accelerated", StatusKind.Danger);
    }

    /// <summary>Map a risk-factor name to its severity glyph (the web <c>riskIcon</c> keyword mapping).</summary>
    public static string RiskGlyph(string name)
    {
        ArgumentNullException.ThrowIfNull(name);

        if (Has(name, "temp") || Has(name, "heat") || Has(name, "thermal"))
        {
            return TempGlyph;
        }

        if (Has(name, "charge") || Has(name, "fast") || Has(name, "dc"))
        {
            return ZapGlyph;
        }

        if (Has(name, "battery") || Has(name, "soc") || Has(name, "depth"))
        {
            return BatteryGlyph;
        }

        return WarningGlyph;
    }

    /// <summary>Map a risk score to its impact badge status (web <c>scoreToImpact</c>: high/medium/low).</summary>
    public static StatusKind ScoreStatus(double score)
    {
        if (score >= HighImpactScore)
        {
            return StatusKind.Danger;
        }

        return score >= MediumImpactScore ? StatusKind.Warning : StatusKind.Success;
    }

    /// <summary>Project <paramref name="forecast"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static BatteryDegradationForecastDisplay Project(
        DegradationForecast forecast,
        BatteryDegradationForecastSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(forecast);
        ArgumentNullException.ThrowIfNull(localizer);

        double rate = forecast.DegradationRatePctPerMonth;
        (string tierKey, string tierFallback, StatusKind tierStatus) = TierFor(rate);

        bool hasCurrentHealth = forecast.CurrentHealthPct is not null;
        string currentHealthText = hasCurrentHealth
            ? $"{Fmt(forecast.CurrentHealthPct, 1)}%"
            : EmDash;

        string projectedText = forecast.HasProjectedDate && forecast.ProjectedDate is { } projectedAt
            ? projectedAt.UtcDateTime.ToString("MMM yyyy", EnUs)
            : EmDash;

        bool showRate = rate > 0;
        string rateText = showRate
            ? $"{MinusSign}{Fmt(rate, 2)}%/{localizer.GetString("widget.mo", "mo")}"
            : string.Empty;

        return new BatteryDegradationForecastDisplay(
            IsCompact: size.IsCompact,
            HasData: forecast.HasData,
            TierKey: tierKey,
            TierLabel: localizer.GetString($"widget.forecast.{tierKey}", tierFallback),
            TierStatus: tierStatus,
            HasCurrentHealth: hasCurrentHealth,
            CurrentHealthText: currentHealthText,
            CurrentHealthLabel: localizer.GetString("widget.forecast.currentHealth", "Current Health"),
            HasProjectedDate: forecast.HasProjectedDate,
            ProjectedDateText: projectedText,
            ProjectedDateLabel: localizer.GetString("widget.forecast.projected80", "Projected 80% Capacity"),
            ShowRate: showRate,
            RateText: rateText,
            RiskFactorsLabel: localizer.GetString("widget.forecast.riskFactors", "Risk Factors"),
            RiskFactors: BuildRiskItems(forecast.RiskFactors),
            RecommendationsLabel: localizer.GetString("widget.forecast.recommendations", "Recommendations"),
            Tips: BuildTips(forecast.Recommendations, localizer));
    }

    private static List<ForecastRiskItem> BuildRiskItems(IReadOnlyList<DegradationRiskFactor> factors)
    {
        int take = Math.Min(factors.Count, MaxRiskFactors);
        var items = new List<ForecastRiskItem>(take);
        for (int i = 0; i < take; i++)
        {
            var rf = factors[i];
            string label = rf.Label ?? rf.Name;        // web rf.label ?? rf.name
            string detail = rf.Detail ?? EmDash;       // web rf.detail ?? '—'
            string scoreText = Fmt(rf.Score, 0);

            items.Add(new ForecastRiskItem(
                Id: i.ToString(CultureInfo.InvariantCulture),
                Glyph: RiskGlyph(rf.Name),
                Label: label,
                Detail: detail,
                ScoreText: scoreText,
                ScoreStatus: ScoreStatus(rf.Score),
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", label, detail, scoreText)));
        }

        return items;
    }

    private static List<ForecastTip> BuildTips(IReadOnlyList<string> recommendations, ILocalizer localizer)
    {
        int take = Math.Min(recommendations.Count, MaxRecommendations);
        string tipTitle = localizer.GetString("widget.forecast.tip", "Tip");
        string impactLabel = localizer.GetString("widget.forecast.recommendation", "Recommendation");

        var tips = new List<ForecastTip>(take);
        for (int i = 0; i < take; i++)
        {
            string description = recommendations[i];
            tips.Add(new ForecastTip(
                Id: i.ToString(CultureInfo.InvariantCulture),
                Glyph: LightbulbGlyph,
                Title: tipTitle,
                Description: description,
                ImpactLabel: impactLabel,
                ImpactStatus: StatusKind.Warning, // web TipItem impact 'medium' -> warning badge
                AutomationName: string.Format(CultureInfo.CurrentCulture, "{0}: {1}", tipTitle, description)));
        }

        return tips;
    }

    private static bool Has(string name, string token) =>
        name.Contains(token, StringComparison.OrdinalIgnoreCase);

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
/// <c>RepositoryResult&lt;DegradationForecast&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. The
/// <c>hasData</c> gate (web's outer <c>{hasData ? … : &lt;EmptyState&gt;}</c>) is applied by the view-model,
/// not here, so a populated-but-data-free body still flows through with its freshness intact. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class BatteryDegradationForecastResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<DegradationForecast> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DegradationForecast Parse() => raw.HasValue ? DegradationForecast.FromJson(raw.Value) : DegradationForecast.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DegradationForecast>.Loading(),
            LoadStatus.Cached => RepositoryResult<DegradationForecast>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DegradationForecast>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DegradationForecast>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DegradationForecast>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DegradationForecast>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DegradationForecast>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case battery-degradation JSON wire shape: numbers (or numeric
/// strings), strings, and the projected-80% date (returning both the presence flag the web <c>hasData</c>
/// gate needs and the parsed instant).
/// </summary>
internal static class ForecastJson
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

    /// <summary>
    /// Reads the projected-80% date property as (present, parsed): <c>present</c> is true when the field is
    /// a non-blank string (the web <c>projected_80pct_date != null</c> presence test), and the second item is
    /// the parsed instant (null when the value is absent, JSON null, or unparseable).
    /// </summary>
    public static (bool Present, DateTimeOffset? Value) Date(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return (false, null);
        }

        string? raw = v.GetString();
        if (string.IsNullOrWhiteSpace(raw))
        {
            return (false, null);
        }

        bool parsed = DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsedAt);

        return (true, parsed ? parsedAt : null);
    }
}
