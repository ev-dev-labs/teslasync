using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DrivingCoachViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DrivingCoachWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetTipCards</c>
/// (web/src/features/dashboard/widgets/DrivingCoachWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> covers a resolved coaching response that carries
/// nothing to coach with — no score, no efficiency savings and no recommendations (the disabled-query
/// case the web hook hits when <c>vehicleId</c> is absent, where <c>data</c> is undefined) — so a friendly
/// "No tips available" surface shows instead of a meaningless lone zero.
/// </summary>
public enum DrivingCoachState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a score, savings or at least one tip.</summary>
    Loaded,

    /// <summary>The snapshot resolved with nothing to coach with — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One personalized efficiency recommendation from <c>GET /analytics/driving-coach</c> (web
/// <c>CoachRecommendation</c> in web/src/types/driving.ts). Field names mirror the Go API's snake_case
/// JSON tags (<c>category</c>, <c>impact</c>, <c>tip</c>); parsing is null-tolerant so a partial row never
/// throws. The Helix engine emits <see cref="Impact"/> as <c>high</c>/<c>medium</c>/<c>low</c>; an absent
/// impact suppresses the tip's badge (web <c>impact: rec.impact ?? undefined</c>).
/// </summary>
public sealed record CoachRecommendation(string? Category, string? Impact, string? Tip)
{
    /// <summary>Project a single recommendation JSON object into a tolerant row.</summary>
    public static CoachRecommendation FromJson(JsonElement obj) => new(
        Category: GetString(obj, "category"),
        Impact: GetString(obj, "impact"),
        Tip: GetString(obj, "tip"));

    /// <summary>Parse the <c>recommendations</c> JSON array into tolerant rows (skipping non-objects).</summary>
    public static IReadOnlyList<CoachRecommendation> ParseArray(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<CoachRecommendation>();
        }

        var list = new List<CoachRecommendation>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The driving-coach read-model the widget consumes — the score, the current/best efficiency the
/// potential-savings ratio is derived from, and the recommendation list, read from the
/// <c>GET /analytics/driving-coach</c> object body (web <c>DrivingCoachData</c>; the sibling
/// <c>patterns</c>/<c>weekly_trend</c>/<c>per_drive_scores</c> fields are not surfaced by this widget,
/// mirroring the web component which reads only <c>overall_score</c>, the two efficiency fields and
/// <c>recommendations</c>). Efficiency is energy intensity in watt-hours per kilometre (Wh/km, SI). Parsing
/// is tolerant so a partial or non-object body yields <see cref="Empty"/> rather than throwing.
/// </summary>
public sealed record CoachData(
    double OverallScore,
    double EfficiencyWhKm,
    double BestEfficiencyWhKm,
    IReadOnlyList<CoachRecommendation> Recommendations)
{
    /// <summary>A content-free snapshot — the parse fallback for an absent/non-object body.</summary>
    public static CoachData Empty { get; } = new(0, 0, 0, Array.Empty<CoachRecommendation>());

    /// <summary>
    /// True when there is something to coach with: a positive score, at least one recommendation, or a
    /// positive efficiency improvement headroom. Gates the content layout versus the "No tips available"
    /// empty surface (the native analogue of the web's disabled-query / undefined-<c>data</c> case).
    /// </summary>
    public bool HasContent =>
        OverallScore > 0 || Recommendations.Count > 0 || DrivingCoachProjection.HasSavings(EfficiencyWhKm, BestEfficiencyWhKm);

    /// <summary>Project a <c>GET /analytics/driving-coach</c> JSON body into a tolerant read-model.</summary>
    public static CoachData FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var recommendations = element.TryGetProperty("recommendations", out var arr)
            ? CoachRecommendation.ParseArray(arr)
            : Array.Empty<CoachRecommendation>();

        return new CoachData(
            OverallScore: GetDouble(element, "overall_score") ?? 0,
            EfficiencyWhKm: GetDouble(element, "efficiency_wh_km") ?? 0,
            BestEfficiencyWhKm: GetDouble(element, "best_efficiency_wh_km") ?? 0,
            Recommendations: recommendations);
    }

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
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact</c> branch in web/src/features/dashboard/widgets/DrivingCoachWidget.tsx.
/// </summary>
public readonly record struct DrivingCoachSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static DrivingCoachSize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact = size.cols &lt;= 1</c>): show the score + savings chip.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// One projected, display-ready coaching tip consumed by the WinUI view — the native analogue of a web
/// <c>TipItem</c> (the <c>tips</c> <c>useMemo</c> in the web component). Holds the lightbulb glyph, the
/// recommendation category as the title, the tip text as the description, and — only when the Helix engine
/// supplied an impact — the localized impact label plus its impact-coloured badge status (the web
/// <c>impactBadgeMap</c>: high → success, medium → warning, low → neutral). Pure data — no WinUI types.
/// </summary>
public sealed record CoachTip(
    string Id,
    string Glyph,
    string Title,
    string Description,
    bool ShowImpact,
    string ImpactLabel,
    StatusKind ImpactStatus,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the coaching snapshot for one footprint — the native analogue
/// of everything the web component computes before returning JSX (the formatted score, the potential-savings
/// percentage and its success chip, and the recommendation tips). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record DrivingCoachDisplay(
    bool IsCompact,
    string ScoreText,
    string ScoreLabel,
    bool ShowSavings,
    int SavingsPct,
    string SavingsLabel,
    bool HasTips,
    bool ShowCompactEmpty,
    string EmptyMessage,
    string ScoreAutomationName,
    string CompactAutomationName,
    IReadOnlyList<CoachTip> Tips);

/// <summary>
/// Pure projection from a raw <see cref="CoachData"/> to the display model — the native port of the score
/// readout, the <c>savingsPct</c> derivation and the <c>tips</c> <c>useMemo</c> in
/// web/src/features/dashboard/widgets/DrivingCoachWidget.tsx. Every label resolves through the i18n facade;
/// the potential-savings ratio and the impact badge mapping match the web exactly.
/// </summary>
public static class DrivingCoachProjection
{
    /// <summary>Maximum tips the standard layout renders, mirroring the web <c>WidgetTipCards maxTips={3}</c>.</summary>
    public const int MaxStandardTips = 3;

    /// <summary>Segoe Fluent "Lightbulb" glyph for the tips, header and empty surface (web <c>Lightbulb</c>).</summary>
    public const string LightbulbGlyph = "\uEA80";

    private const string EmDash = "\u2014";

    /// <summary>
    /// The web potential-savings ratio (web
    /// <c>currentEff &gt; 0 ? Math.round(((currentEff - bestEff) / currentEff) * 100) : 0</c>): how much
    /// energy the best observed efficiency would save versus the current average. Non-positive when the
    /// current average already matches (or beats) the best, in which case the chip is hidden.
    /// </summary>
    public static int SavingsPercent(double currentEffWhKm, double bestEffWhKm)
    {
        double current = SafeNumber(currentEffWhKm);
        double best = SafeNumber(bestEffWhKm);
        if (current <= 0)
        {
            return 0;
        }

        double pct = Math.Round((current - best) / current * 100.0, MidpointRounding.AwayFromZero);
        return (int)pct;
    }

    /// <summary>True when the potential-savings ratio is positive (the web <c>savingsPct &gt; 0</c> gate).</summary>
    public static bool HasSavings(double currentEffWhKm, double bestEffWhKm) =>
        SavingsPercent(currentEffWhKm, bestEffWhKm) > 0;

    /// <summary>
    /// Map a recommendation impact to the badge status the web <c>impactBadgeMap</c> uses: high → success,
    /// medium → warning, low (and anything else) → neutral.
    /// </summary>
    public static StatusKind ImpactBadgeStatus(string? impact) => Normalize(impact) switch
    {
        "high" => StatusKind.Success,
        "medium" => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>Localized "Potential savings: {pct}%" chip label (web <c>widget.drivingCoach.potentialSavings</c>).</summary>
    public static string SavingsLabel(ILocalizer localizer, int pct)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string pctText = pct.ToString(CultureInfo.CurrentCulture);
        string template = localizer.GetString("widget.drivingCoach.potentialSavings", "Potential savings: {0}%");
        return template
            .Replace("{{pct}}", pctText, StringComparison.Ordinal)
            .Replace("{pct}", pctText, StringComparison.Ordinal)
            .Replace("{0}", pctText, StringComparison.Ordinal);
    }

    /// <summary>Localized impact label (web <c>widget.drivingCoach.impact.{impact}</c>, raw impact fallback).</summary>
    public static string ImpactLabel(ILocalizer localizer, string impact)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString($"widget.drivingCoach.impact.{Normalize(impact)}", impact);
    }

    /// <summary>Project <paramref name="data"/> for <paramref name="size"/> using the i18n facade.</summary>
    public static DrivingCoachDisplay Project(CoachData data, DrivingCoachSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        string scoreText = ScalarFormatters.FormatNumber(data.OverallScore, 0);
        string scoreLabel = localizer.GetString("widget.drivingCoach.scoreLabel", "/ 100");
        string title = localizer.GetString("widget.drivingCoach.title", "Driving Coach");
        string emptyMessage = localizer.GetString("widget.drivingCoach.noTips", "No tips available");

        int savingsPct = SavingsPercent(data.EfficiencyWhKm, data.BestEfficiencyWhKm);
        bool showSavings = savingsPct > 0;
        string savingsLabel = showSavings ? SavingsLabel(localizer, savingsPct) : string.Empty;

        var tips = BuildTips(data.Recommendations, localizer);
        bool showCompactEmpty = !showSavings && tips.Count == 0;

        string scoreAutomationName = string.Format(
            CultureInfo.CurrentCulture, "{0}: {1} {2}", title, scoreText, scoreLabel);
        string compactAutomationName = showSavings
            ? string.Format(CultureInfo.CurrentCulture, "{0}. {1}", scoreAutomationName, savingsLabel)
            : scoreAutomationName;

        return new DrivingCoachDisplay(
            IsCompact: size.IsCompact,
            ScoreText: scoreText,
            ScoreLabel: scoreLabel,
            ShowSavings: showSavings,
            SavingsPct: savingsPct,
            SavingsLabel: savingsLabel,
            HasTips: tips.Count > 0,
            ShowCompactEmpty: showCompactEmpty,
            EmptyMessage: emptyMessage,
            ScoreAutomationName: scoreAutomationName,
            CompactAutomationName: compactAutomationName,
            Tips: tips);
    }

    private static IReadOnlyList<CoachTip> BuildTips(
        IReadOnlyList<CoachRecommendation> recommendations,
        ILocalizer localizer)
    {
        if (recommendations.Count == 0)
        {
            return Array.Empty<CoachTip>();
        }

        var tips = new List<CoachTip>(recommendations.Count);
        for (int i = 0; i < recommendations.Count; i++)
        {
            tips.Add(BuildTip(i, recommendations[i], localizer));
        }

        return tips;
    }

    private static CoachTip BuildTip(int index, CoachRecommendation rec, ILocalizer localizer)
    {
        string title = string.IsNullOrEmpty(rec.Category) ? EmDash : rec.Category;
        string description = string.IsNullOrEmpty(rec.Tip) ? EmDash : rec.Tip;
        bool showImpact = !string.IsNullOrWhiteSpace(rec.Impact);
        string impactLabel = showImpact ? ImpactLabel(localizer, rec.Impact!) : string.Empty;

        string automationName = showImpact
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}. {2}", impactLabel, title, description)
            : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", title, description);

        return new CoachTip(
            Id: index.ToString(CultureInfo.InvariantCulture),
            Glyph: LightbulbGlyph,
            Title: title,
            Description: description,
            ShowImpact: showImpact,
            ImpactLabel: impactLabel,
            ImpactStatus: ImpactBadgeStatus(rec.Impact),
            AutomationName: automationName);
    }

    private static string Normalize(string? impact) =>
        string.IsNullOrWhiteSpace(impact) ? string.Empty : impact.Trim().ToLowerInvariant();

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;CoachData&gt;</c>, preserving every freshness flag (cached / refreshing / stale /
/// offline) so the view-model can render the full state matrix. A resolved snapshot with nothing to coach
/// with collapses to <see cref="RepositoryResult{T}.Empty"/> so the view shows the "No tips available"
/// surface (web parity). Kept pure so the parse-and-preserve contract is unit-tested without a network or
/// cache.
/// </summary>
public static class DrivingCoachResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<CoachData> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        CoachData Parse() => raw.HasValue ? CoachData.FromJson(raw.Value) : CoachData.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<CoachData>.Loading(),
            LoadStatus.Cached => RepositoryResult<CoachData>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<CoachData>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => ToLoadedOrEmpty(Parse(), raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<CoachData>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<CoachData>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<CoachData>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }

    private static RepositoryResult<CoachData> ToLoadedOrEmpty(CoachData data, DateTimeOffset? fetchedAt)
        => data.HasContent
            ? RepositoryResult<CoachData>.Loaded(data, fetchedAt ?? DateTimeOffset.UtcNow)
            : RepositoryResult<CoachData>.Empty(fetchedAt);
}
