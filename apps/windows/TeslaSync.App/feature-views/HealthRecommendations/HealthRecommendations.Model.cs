using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The drivetrain-health level both drivetrain-health surfaces key off — the native mirror of the web
/// <c>HealthStatus</c> (<c>'good' | 'warning' | 'critical'</c>). Defined once here for the
/// <c>TeslaSync.App.FeatureViews</c> namespace (co-located with its <see cref="DrivetrainHealthSnapshot"/> JSON
/// parser) and shared by both <c>HealthOverview</c> and <c>HealthRecommendations</c>; a second, identical
/// declaration previously collided (CS0101), so it lives in exactly one place.
/// </summary>
public enum DrivetrainHealth
{
    /// <summary>Healthy drivetrain (web <c>'good'</c>) — green glow / success accent / check icon.</summary>
    Good,

    /// <summary>Running warm (web <c>'warning'</c>) — cyan glow / warning accent.</summary>
    Warning,

    /// <summary>Degraded drivetrain (web <c>'critical'</c>) — purple glow / danger accent.</summary>
    Critical,
}

/// <summary>
/// The urgency of a single recommendation — the native mirror of the web
/// <c>Recommendation.priority</c> (<c>'high' | 'medium' | 'low'</c>). Drives the row's accent (high → danger,
/// medium → warning, low → info) and the leading glyph, exactly like the web component's per-tip colour map.
/// </summary>
public enum RecommendationPriority
{
    /// <summary>Highest urgency — danger accent + alert glyph (web <c>'high'</c>).</summary>
    High,

    /// <summary>Elevated urgency — warning accent + alert glyph (web <c>'medium'</c>).</summary>
    Medium,

    /// <summary>Evergreen best-practice tip — info accent + trend glyph (web <c>'low'</c>).</summary>
    Low,
}

/// <summary>
/// The lifecycle state a <see cref="HealthRecommendationsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. It is a strict superset
/// of the web component (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx),
/// which is a presentational list that simply renders the tips derived from its <c>overallHealth</c> prop;
/// the native feature-view owns its own drivetrain-health read and therefore renders the full state matrix
/// the prompt mandates. Every branch maps onto a visible surface — none is ever hidden. <see cref="Empty"/>
/// mirrors the web page hiding the panel when the drivetrain-health endpoint carries no health object
/// (web <c>DrivetrainHealthPage</c> renders its <c>EmptyState</c> when <c>health</c> is absent).
/// </summary>
public enum HealthRecommendationsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton rows.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) carrying a health level — render the list.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no health level — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// One projected, render-ready recommendation row consumed by the WinUI view — the native analogue of a web
/// <c>Recommendation</c> entry. Holds the stable <see cref="Key"/> (used as the list key, web parity), the
/// localized <see cref="Text"/>, the <see cref="Priority"/> (drives the accent + glyph) and a Narrator
/// <see cref="AutomationName"/> that prefixes the text with a localized priority label. Pure data — no WinUI
/// types — so the derivation is unit-tested without a UI host.
/// </summary>
public sealed record HealthRecommendation(
    string Key,
    string Text,
    RecommendationPriority Priority,
    string AutomationName);

/// <summary>
/// The drivetrain-health slice of <c>GET /drivetrain/health</c> the surface needs — just the
/// <c>overall_health</c> level the web <c>DrivetrainHealthPage</c> reads
/// (<c>health?.overallHealth ?? 'good'</c>) and feeds to <c>HealthRecommendations</c> as a prop. The level is
/// nullable: present and recognised → a <see cref="DrivetrainHealth"/>, absent / unrecognised / empty body →
/// null (the surface shows its empty state, mirroring the web page's <c>EmptyState</c> when <c>health</c> is
/// missing). Parsing is null-tolerant so a partial or schema-drifted body never throws.
/// </summary>
public sealed record DrivetrainHealthSnapshot(DrivetrainHealth? OverallHealth)
{
    /// <summary>An absent snapshot — the parse fallback for an absent/non-object body or missing field.</summary>
    public static DrivetrainHealthSnapshot Empty { get; } = new((DrivetrainHealth?)null);

    /// <summary>
    /// True when a health level is present — i.e. there is something to base recommendations on. Gates the
    /// empty state (the web page renders the recommendations only when <c>health</c> is present).
    /// </summary>
    public bool HasData => OverallHealth is not null;

    /// <summary>Project a <c>GET /drivetrain/health</c> JSON object into a tolerant health snapshot.</summary>
    public static DrivetrainHealthSnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object
            || !element.TryGetProperty("overall_health", out var level)
            || level.ValueKind != JsonValueKind.String)
        {
            return Empty;
        }

        return new DrivetrainHealthSnapshot(Parse(level.GetString()));
    }

    // web: HealthStatus is the literal union 'good' | 'warning' | 'critical'. Anything else (the backend only
    // ever emits those three) is treated as unknown → null, so the surface degrades to its empty state rather
    // than guessing a level.
    private static DrivetrainHealth? Parse(string? value) => value switch
    {
        "good" => DrivetrainHealth.Good,
        "warning" => DrivetrainHealth.Warning,
        "critical" => DrivetrainHealth.Critical,
        _ => null,
    };
}

/// <summary>
/// The fully projected, render-ready view of the recommendations surface — the resolved health level plus the
/// ordered recommendation rows and the <see cref="HasData"/> gate. Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
public sealed record HealthRecommendationsDisplay(
    bool HasData,
    DrivetrainHealth OverallHealth,
    IReadOnlyList<HealthRecommendation> Recommendations)
{
    /// <summary>An empty projection (no rows) — the projection fallback for a snapshot with no health level.</summary>
    public static HealthRecommendationsDisplay Empty { get; } =
        new(false, DrivetrainHealth.Good, Array.Empty<HealthRecommendation>());
}

/// <summary>
/// Pure projection from a parsed <see cref="DrivetrainHealthSnapshot"/> to the ordered recommendation rows —
/// the native port of the <c>useMemo</c> tip-derivation in
/// web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx. The branch order and tip
/// set are reproduced verbatim (critical adds two high tips; warning-or-critical adds three medium tips; four
/// low tips always trail), and every string resolves through the i18n facade with the web's English fallback.
/// No WinUI types — unit-tested without a UI host.
/// </summary>
public static class HealthRecommendationsProjection
{
    /// <summary>The i18n key for the surface header / accessible name (web <c>drivetrain.recommendations</c>).</summary>
    public const string TitleKey = "drivetrain.recommendations";

    /// <summary>The English fallback for the surface header (web parity).</summary>
    public const string TitleFallback = "Health Recommendations";

    /// <summary>
    /// Project <paramref name="snapshot"/> into the ordered recommendation rows for its health level. A
    /// snapshot with no level yields <see cref="HealthRecommendationsDisplay.Empty"/> (the surface then renders
    /// its empty state).
    /// </summary>
    public static HealthRecommendationsDisplay Project(DrivetrainHealthSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        if (snapshot.OverallHealth is not { } health)
        {
            return HealthRecommendationsDisplay.Empty;
        }

        var tips = new List<HealthRecommendation>(9);

        // web: if (overallHealth === 'critical') { ...two high tips... }
        if (health == DrivetrainHealth.Critical)
        {
            tips.Add(Tip(
                localizer,
                "critical-stop",
                "drivetrain.tips.criticalStop",
                "Temperatures are critically high. Consider pulling over safely and letting the vehicle cool down.",
                RecommendationPriority.High));
            tips.Add(Tip(
                localizer,
                "service-urgent",
                "drivetrain.tips.serviceUrgent",
                "Schedule an urgent service appointment. Critical temperatures may indicate a coolant system issue.",
                RecommendationPriority.High));
        }

        // web: if (overallHealth === 'warning' || overallHealth === 'critical') { ...three medium tips... }
        if (health is DrivetrainHealth.Warning or DrivetrainHealth.Critical)
        {
            tips.Add(Tip(
                localizer,
                "reduce-load",
                "drivetrain.tips.reduceLoad",
                "Reduce driving intensity and avoid hard acceleration to allow components to cool.",
                RecommendationPriority.Medium));
            tips.Add(Tip(
                localizer,
                "check-coolant",
                "drivetrain.tips.checkCoolant",
                "Schedule a service appointment to inspect the coolant system and fluid levels.",
                RecommendationPriority.Medium));
            tips.Add(Tip(
                localizer,
                "avoid-supercharging",
                "drivetrain.tips.avoidSupercharging",
                "Avoid Supercharging while temperatures are elevated. Use Level 2 charging instead.",
                RecommendationPriority.Medium));
        }

        // web: the four low-priority tips are always appended.
        tips.Add(Tip(
            localizer,
            "regular-service",
            "drivetrain.tips.regularService",
            "Keep up with regular service intervals for optimal drivetrain health and longevity.",
            RecommendationPriority.Low));
        tips.Add(Tip(
            localizer,
            "gentle-accel",
            "drivetrain.tips.gentleAccel",
            "Gentle acceleration helps maintain lower motor temperatures and extends component life.",
            RecommendationPriority.Low));
        tips.Add(Tip(
            localizer,
            "precondition",
            "drivetrain.tips.precondition",
            "Precondition the battery in cold weather for better thermal performance and driving efficiency.",
            RecommendationPriority.Low));
        tips.Add(Tip(
            localizer,
            "monitor-temps",
            "drivetrain.tips.monitorTemps",
            "Monitor drivetrain temperatures after spirited driving sessions or long highway stretches.",
            RecommendationPriority.Low));

        return new HealthRecommendationsDisplay(true, health, tips);
    }

    /// <summary>The localized priority label that prefixes a row's Narrator name.</summary>
    public static string PriorityLabel(RecommendationPriority priority, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return priority switch
        {
            RecommendationPriority.High => localizer.GetString("drivetrain.tips.priority.high", "High priority"),
            RecommendationPriority.Medium => localizer.GetString("drivetrain.tips.priority.medium", "Medium priority"),
            _ => localizer.GetString("drivetrain.tips.priority.low", "Recommendation"),
        };
    }

    private static HealthRecommendation Tip(
        ILocalizer localizer,
        string key,
        string textKey,
        string textFallback,
        RecommendationPriority priority)
    {
        string text = localizer.GetString(textKey, textFallback);
        string automationName = string.Format(
            CultureInfo.CurrentCulture,
            "{0}: {1}",
            PriorityLabel(priority, localizer),
            text);
        return new HealthRecommendation(key, text, priority, automationName);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DrivetrainHealthSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class HealthRecommendationsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<DrivetrainHealthSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DrivetrainHealthSnapshot Parse() =>
            raw.HasValue ? DrivetrainHealthSnapshot.FromJson(raw.Value) : DrivetrainHealthSnapshot.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DrivetrainHealthSnapshot>.Loading(),
            LoadStatus.Cached => RepositoryResult<DrivetrainHealthSnapshot>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<DrivetrainHealthSnapshot>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<DrivetrainHealthSnapshot>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<DrivetrainHealthSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<DrivetrainHealthSnapshot>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<DrivetrainHealthSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Health Recommendations surface — the native mirror of the web
/// component (web/src/features/driving/components/drivetrain-health/HealthRecommendations.tsx, rendered by the
/// Drivetrain Health page). Centralises the stable id, category, diagnostics slug and the generated
/// drivetrain-health operation id so the view, view-model and source stay free of literal identifiers.
/// </summary>
public static class HealthRecommendationsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "health-recommendations";

    /// <summary>Surface category (matches the web driving feature).</summary>
    public const string Category = "driving";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "HealthRecommendations";

    /// <summary>
    /// The generated OpenAPI operation id for <c>GET /drivetrain/health</c> (web hook
    /// <c>useDrivetrainHealth</c>). Kept local to the surface — a dedicated resolve test asserts it stays in
    /// the generated endpoint table, the same contract-drift guard the shared <c>Operations</c> table relies on.
    /// </summary>
    public const string DrivetrainHealthOperation = "get_api_v1_drivetrain_health";
}

/// <summary>
/// PII-safe diagnostics for the Health Recommendations surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a health level, VIN or location — so a
/// diagnostics line can never leak vehicle data. Thread-safe.
/// </summary>
public sealed class HealthRecommendationsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public HealthRecommendationsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HealthRecommendations</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HealthRecommendationsRegistration.Slug}");
    }
}
