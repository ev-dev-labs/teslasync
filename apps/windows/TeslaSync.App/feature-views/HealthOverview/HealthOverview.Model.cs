using TeslaSync.App.Core;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>HealthOverview</c> surface — the native union of the states
/// the P2 feature-view contract requires for the drivetrain-health overview
/// (web/src/features/driving/components/drivetrain-health/HealthOverview.tsx). The web component is a pure
/// presentational child (it takes already-resolved <c>overallHealth</c> / <c>healthScore</c> /
/// <c>motorStatus</c> props and performs no fetching), so the parent drivetrain-health experience owns the
/// query lifecycle and supplies the active state. Every member maps onto a visible surface; none is ever
/// hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum HealthOverviewState
{
    /// <summary>The parent query is in flight and no health snapshot has arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>A resolved health snapshot (the web render) — the banner-plus-panel composition.</summary>
    Ready,

    /// <summary>Resolved with no drivetrain telemetry to summarise — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — content plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached snapshot plus an offline chip.</summary>
    Offline,
}

// The drivetrain health level a HealthOverview renders (web HealthStatus = 'good' | 'warning' | 'critical')
// is the canonical DrivetrainHealth enum defined once in HealthRecommendations.Model.cs (same
// TeslaSync.App.FeatureViews namespace), co-located with its DrivetrainHealthSnapshot JSON parser, and shared
// by both drivetrain-health surfaces. A second, identical definition previously lived here and collided
// (CS0101); the single shared definition is reused — Good drives the green glow/success accent/check icon,
// Warning the cyan glow/warning accent, Critical the purple glow/danger accent, exactly as the web keys those
// off overallHealth.

/// <summary>
/// The panel glow a <c>HealthOverview</c> resolves to — the native, WinUI-free analogue of the web
/// <c>HEALTH_GLOW[overallHealth]</c> result
/// (web/src/features/driving/components/drivetrain-health/constants.ts: good→green, warning→cyan,
/// critical→purple). Mirrors the members of the view layer's <c>GlassGlow</c> so the health→glow mapping is
/// unit-tested headlessly and bridged to the WinUI enum only in the view.
/// </summary>
public enum HealthOverviewGlow
{
    /// <summary>No accent glow.</summary>
    None,

    /// <summary>Cyan accent glow (web <c>'cyan'</c> — warning).</summary>
    Cyan,

    /// <summary>Green accent glow (web <c>'green'</c> — good).</summary>
    Green,

    /// <summary>Purple accent glow (web <c>'purple'</c> — critical).</summary>
    Purple,
}

/// <summary>
/// The render-time data model the <c>HealthOverview</c> view binds to — the native analogue of the web
/// component's <c>HealthOverviewProps</c> (<c>overallHealth</c> / <c>healthScore</c> / <c>motorStatus</c>,
/// web/src/features/driving/components/drivetrain-health/HealthOverview.tsx) plus the parent-supplied
/// lifecycle <see cref="Status"/> and freshness flags. The view never performs HTTP; the parent
/// drivetrain-health state holder fills this in (the native P1/S8 seam). <see cref="HealthScore"/> is the
/// web's already-derived 0..100 score (a dimensionless percentage needs no display conversion);
/// <see cref="MotorStatus"/> is the web's already-resolved live motor-state label, rendered verbatim. Pure
/// data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Health">The drivetrain health level (web <c>overallHealth</c>).</param>
/// <param name="HealthScore">The 0..100 health score (web <c>healthScore</c>).</param>
/// <param name="MotorStatus">The already-resolved live motor-state label (web <c>motorStatus</c>).</param>
/// <param name="UpdatedAt">When the snapshot was produced (drives the stale / offline freshness chip), or null.</param>
/// <param name="IsFetching">Whether a background refetch is in flight over the current snapshot.</param>
/// <param name="ErrorMessage">An optional already-localized hard-failure message (the error branch).</param>
public sealed record HealthOverviewModel(
    HealthOverviewState Status,
    DrivetrainHealth Health,
    double HealthScore,
    string MotorStatus,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the parent query is in flight and no snapshot has arrived yet.</summary>
    public static HealthOverviewModel Loading { get; } =
        new(HealthOverviewState.Loading, DrivetrainHealth.Good, 0, string.Empty);

    /// <summary>A resolved model with no drivetrain telemetry — the empty state.</summary>
    public static HealthOverviewModel Empty { get; } =
        new(HealthOverviewState.Empty, DrivetrainHealth.Good, 0, string.Empty);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    public static HealthOverviewModel Failed(string? message = null) =>
        new(HealthOverviewState.Error, DrivetrainHealth.Good, 0, string.Empty, ErrorMessage: message);

    /// <summary>A fresh resolved model with the health level, score and motor state.</summary>
    public static HealthOverviewModel Ready(
        DrivetrainHealth health,
        double healthScore,
        string motorStatus,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false) =>
        new(HealthOverviewState.Ready, health, healthScore, motorStatus ?? string.Empty, updatedAt, isFetching);

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached health.</summary>
    public static HealthOverviewModel Stale(
        DrivetrainHealth health,
        double healthScore,
        string motorStatus,
        DateTimeOffset? updatedAt = null) =>
        new(HealthOverviewState.Stale, health, healthScore, motorStatus ?? string.Empty, updatedAt);

    /// <summary>An offline snapshot (no connectivity) carrying the last cached health.</summary>
    public static HealthOverviewModel Offline(
        DrivetrainHealth health,
        double healthScore,
        string motorStatus,
        DateTimeOffset? updatedAt = null) =>
        new(HealthOverviewState.Offline, health, healthScore, motorStatus ?? string.Empty, updatedAt);
}

/// <summary>
/// The fully projected, render-ready view of the surface for one input model — the native analogue of
/// everything the web <c>HealthOverview</c> computes before returning JSX. Holds the active
/// <see cref="State"/>, the resolved <see cref="Glow"/>, the headline (icon selector
/// <see cref="IsHealthy"/>, accent <see cref="HealthAccentKey"/>, localized <see cref="HealthTitle"/> and
/// <see cref="MotorStateText"/>), the badge (<see cref="BadgeStatus"/> / <see cref="BadgeLabel"/>), the score
/// (raw <see cref="HealthScore"/> for the animated number plus its accessible <see cref="HealthScoreText"/>),
/// the conditional alert (<see cref="ShowAlert"/> / <see cref="AlertVariant"/> / <see cref="AlertTitle"/> /
/// <see cref="AlertMessage"/>), the stale / offline freshness chip, the empty / loading / error copy and retry
/// label, the freshness timestamp + fetching flag, and the surface <see cref="AutomationName"/>. Pure data so
/// every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Glow">The resolved panel glow (the web <c>HEALTH_GLOW[overallHealth]</c> result).</param>
/// <param name="IsHealthy">Whether the headline shows the check icon (web <c>CheckCircle</c>) rather than the warning triangle.</param>
/// <param name="HealthAccentKey">The token brush key tinting the headline icon and the score (success / warning / danger).</param>
/// <param name="HealthTitle">The localized health headline (web <c>healthGood</c> / <c>healthWarn</c> / <c>healthCrit</c>).</param>
/// <param name="MotorStateText">The localized "<c>Motor State: {motorStatus}</c>" subtitle.</param>
/// <param name="BadgeStatus">The semantic badge tone (web <c>healthBadgeVariant</c>: success / warning / danger).</param>
/// <param name="BadgeLabel">The localized badge label (web <c>drivetrain.health.{status}</c>, fallback uppercased).</param>
/// <param name="HealthScore">The 0..100 score the animated number tweens to (web <c>healthScore</c>).</param>
/// <param name="HealthScoreText">The accessible "<c>{score}%</c>" rendering of the score.</param>
/// <param name="ShowAlert">Whether the temperature alert banner is shown (web <c>overallHealth !== 'good'</c>).</param>
/// <param name="AlertVariant">The alert tone (web <c>getAlertVariant</c>: warning → warning, else danger).</param>
/// <param name="AlertTitle">The localized alert title (web <c>alert.criticalTitle</c> / <c>alert.warningTitle</c>).</param>
/// <param name="AlertMessage">The localized alert body (web <c>alert.criticalMsg</c> / <c>alert.warningMsg</c>).</param>
/// <param name="ShowFreshnessChip">Whether a stale / offline freshness chip is shown.</param>
/// <param name="FreshnessChipText">The localized freshness-chip caption.</param>
/// <param name="FreshnessChipStatus">The freshness-chip tone (offline → danger, stale → warning).</param>
/// <param name="EmptyMessage">The localized empty-state copy.</param>
/// <param name="LoadingLabel">The localized loading copy.</param>
/// <param name="ErrorTitle">The localized error-state title.</param>
/// <param name="ErrorMessage">The localized (or model-supplied) error-state message.</param>
/// <param name="RetryLabel">The localized retry-affordance label.</param>
/// <param name="UpdatedAt">When the snapshot was produced, or null.</param>
/// <param name="IsFetching">Whether a background refetch is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record HealthOverviewDisplay(
    HealthOverviewState State,
    HealthOverviewGlow Glow,
    bool IsHealthy,
    string HealthAccentKey,
    string HealthTitle,
    string MotorStateText,
    StatusKind BadgeStatus,
    string BadgeLabel,
    double HealthScore,
    string HealthScoreText,
    bool ShowAlert,
    CalloutVariant AlertVariant,
    string AlertTitle,
    string AlertMessage,
    bool ShowFreshnessChip,
    string FreshnessChipText,
    StatusKind FreshnessChipStatus,
    string EmptyMessage,
    string LoadingLabel,
    string ErrorTitle,
    string ErrorMessage,
    string RetryLabel,
    DateTimeOffset? UpdatedAt,
    bool IsFetching,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="HealthOverviewModel"/> to its <see cref="HealthOverviewDisplay"/> — the
/// native port of web/src/features/driving/components/drivetrain-health/HealthOverview.tsx (plus its
/// <c>constants.ts</c> / <c>helpers.ts</c>). Branch precedence mirrors the web parent's data lifecycle
/// (loading → error → empty → stale / offline → ready); a resolved snapshot always has a health story to
/// tell, so <see cref="HealthOverviewState.Ready"/> never collapses to empty (only an explicit parent
/// <see cref="HealthOverviewState.Empty"/> does). The glow reproduces the web <c>HEALTH_GLOW</c>; the accent,
/// alert variant and badge tone reproduce <c>healthTextClass</c>, <c>getAlertVariant</c> and
/// <c>healthBadgeVariant</c>; the score is rendered verbatim (the web <c>AnimatedNumber</c> interpolates it
/// unchanged). Every user-facing string resolves through the i18n facade using the same keys the web feeds
/// into <c>t(...)</c>. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class HealthOverviewProjection
{
    /// <summary>The em dash shown when the live motor state is unknown (the project-wide null-safety marker).</summary>
    public const string EmDash = "\u2014";

    /// <summary>i18n key for the health headline when healthy (web <c>drivetrain.healthGood</c>).</summary>
    public const string HealthGoodKey = "drivetrain.healthGood";

    /// <summary>i18n key for the health headline when warm (web <c>drivetrain.healthWarn</c>).</summary>
    public const string HealthWarnKey = "drivetrain.healthWarn";

    /// <summary>i18n key for the health headline when overheating (web <c>drivetrain.healthCrit</c>).</summary>
    public const string HealthCritKey = "drivetrain.healthCrit";

    /// <summary>i18n key for the "Motor State" label (web <c>drivetrain.motorState</c>).</summary>
    public const string MotorStateKey = "drivetrain.motorState";

    /// <summary>i18n key for the critical alert title (web <c>drivetrain.alert.criticalTitle</c>).</summary>
    public const string AlertCriticalTitleKey = "drivetrain.alert.criticalTitle";

    /// <summary>i18n key for the warning alert title (web <c>drivetrain.alert.warningTitle</c>).</summary>
    public const string AlertWarningTitleKey = "drivetrain.alert.warningTitle";

    /// <summary>i18n key for the critical alert body (web <c>drivetrain.alert.criticalMsg</c>).</summary>
    public const string AlertCriticalMessageKey = "drivetrain.alert.criticalMsg";

    /// <summary>i18n key for the warning alert body (web <c>drivetrain.alert.warningMsg</c>).</summary>
    public const string AlertWarningMessageKey = "drivetrain.alert.warningMsg";

    /// <summary>i18n key prefix for the badge label (web <c>drivetrain.health.{status}</c>).</summary>
    public const string BadgeKeyPrefix = "drivetrain.health.";

    /// <summary>i18n key for the empty-state copy.</summary>
    public const string EmptyMessageKey = "drivetrain.noData";

    /// <summary>English fallback for <see cref="EmptyMessageKey"/>.</summary>
    public const string EmptyMessageFallback = "No drivetrain data available";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading";

    /// <summary>i18n key for the error-state title.</summary>
    public const string ErrorTitleKey = "drivetrain.healthError";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Couldn't load drivetrain health";

    /// <summary>i18n key for the error-state message.</summary>
    public const string ErrorMessageKey = "drivetrain.healthErrorMessage";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "We couldn't load drivetrain health right now. Please try again.";

    /// <summary>i18n key for the retry affordance (the shared <c>common.retry</c> string).</summary>
    public const string RetryKey = "common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the stale freshness chip (the shared <c>common.stale</c> string).</summary>
    public const string StaleChipKey = "common.stale";

    /// <summary>English fallback for <see cref="StaleChipKey"/>.</summary>
    public const string StaleChipFallback = "Stale";

    /// <summary>i18n key for the offline freshness chip (the shared <c>common.offline</c> string).</summary>
    public const string OfflineChipKey = "common.offline";

    /// <summary>English fallback for <see cref="OfflineChipKey"/>.</summary>
    public const string OfflineChipFallback = "Offline";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props plus the parent lifecycle state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static HealthOverviewDisplay Project(HealthOverviewModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        HealthOverviewState state = SelectState(model);
        bool isContent = state is HealthOverviewState.Ready or HealthOverviewState.Stale or HealthOverviewState.Offline;

        bool isHealthy = model.Health == DrivetrainHealth.Good;
        string healthTitle = HealthTitle(model.Health, localizer);
        string motorStateText = MotorStateLine(model.MotorStatus, localizer);
        string badgeLabel = BadgeLabel(model.Health, localizer);
        string scoreText = NumberFormatting.Format(model.HealthScore, null, 0) + "%";

        bool showAlert = isContent && model.Health != DrivetrainHealth.Good;
        CalloutVariant alertVariant = AlertVariantFor(model.Health);
        string alertTitle = AlertTitle(model.Health, localizer);
        string alertMessage = AlertMessage(model.Health, localizer);

        bool showChip = state is HealthOverviewState.Stale or HealthOverviewState.Offline;
        string chipText = state switch
        {
            HealthOverviewState.Offline => localizer.GetString(OfflineChipKey, OfflineChipFallback),
            HealthOverviewState.Stale => localizer.GetString(StaleChipKey, StaleChipFallback),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == HealthOverviewState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string emptyMessage = localizer.GetString(EmptyMessageKey, EmptyMessageFallback);
        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(ErrorMessageKey, ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString(RetryKey, RetryFallback);

        string automationName = BuildAutomationName(
            state,
            showChip,
            chipText,
            showAlert,
            alertTitle,
            healthTitle,
            motorStateText,
            badgeLabel,
            scoreText,
            emptyMessage,
            loadingLabel,
            errorTitle);

        return new HealthOverviewDisplay(
            State: state,
            Glow: GlowFor(model.Health),
            IsHealthy: isHealthy,
            HealthAccentKey: StatusResources.AccentBrushKey(BadgeStatusFor(model.Health)),
            HealthTitle: healthTitle,
            MotorStateText: motorStateText,
            BadgeStatus: BadgeStatusFor(model.Health),
            BadgeLabel: badgeLabel,
            HealthScore: model.HealthScore,
            HealthScoreText: scoreText,
            ShowAlert: showAlert,
            AlertVariant: alertVariant,
            AlertTitle: alertTitle,
            AlertMessage: alertMessage,
            ShowFreshnessChip: showChip,
            FreshnessChipText: chipText,
            FreshnessChipStatus: chipStatus,
            EmptyMessage: emptyMessage,
            LoadingLabel: loadingLabel,
            ErrorTitle: errorTitle,
            ErrorMessage: errorMessage,
            RetryLabel: retryLabel,
            UpdatedAt: model.UpdatedAt,
            IsFetching: model.IsFetching,
            AutomationName: automationName);
    }

    /// <summary>
    /// Map a <see cref="DrivetrainHealth"/> to its panel glow — the web <c>HEALTH_GLOW</c>: good→green,
    /// warning→cyan, critical→purple.
    /// </summary>
    public static HealthOverviewGlow GlowFor(DrivetrainHealth health) => health switch
    {
        DrivetrainHealth.Good => HealthOverviewGlow.Green,
        DrivetrainHealth.Warning => HealthOverviewGlow.Cyan,
        _ => HealthOverviewGlow.Purple,
    };

    /// <summary>
    /// Map a <see cref="DrivetrainHealth"/> to its badge / accent tone — the web <c>healthBadgeVariant</c>:
    /// good→success, warning→warning, critical→danger.
    /// </summary>
    public static StatusKind BadgeStatusFor(DrivetrainHealth health) => health switch
    {
        DrivetrainHealth.Good => StatusKind.Success,
        DrivetrainHealth.Warning => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>
    /// Map a <see cref="DrivetrainHealth"/> to its alert tone — the web <c>getAlertVariant</c>: warning→warning,
    /// everything else (critical)→danger.
    /// </summary>
    public static CalloutVariant AlertVariantFor(DrivetrainHealth health) =>
        health == DrivetrainHealth.Warning ? CalloutVariant.Warning : CalloutVariant.Danger;

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a resolved "Ready" snapshot always has a health story to
    // tell (good / warning / critical) so it never collapses to empty — only an explicit parent Empty does.
    private static HealthOverviewState SelectState(HealthOverviewModel model) => model.Status switch
    {
        HealthOverviewState.Loading => HealthOverviewState.Loading,
        HealthOverviewState.Error => HealthOverviewState.Error,
        HealthOverviewState.Empty => HealthOverviewState.Empty,
        HealthOverviewState.Stale => HealthOverviewState.Stale,
        HealthOverviewState.Offline => HealthOverviewState.Offline,
        _ => HealthOverviewState.Ready,
    };

    private static string HealthTitle(DrivetrainHealth health, ILocalizer localizer) => health switch
    {
        DrivetrainHealth.Good => localizer.GetString(HealthGoodKey, "Drivetrain Healthy"),
        DrivetrainHealth.Warning => localizer.GetString(HealthWarnKey, "Drivetrain Running Warm"),
        _ => localizer.GetString(HealthCritKey, "Drivetrain Overheating"),
    };

    private static string AlertTitle(DrivetrainHealth health, ILocalizer localizer) =>
        health == DrivetrainHealth.Critical
            ? localizer.GetString(AlertCriticalTitleKey, "Critical Temperature Warning")
            : localizer.GetString(AlertWarningTitleKey, "Elevated Temperatures Detected");

    private static string AlertMessage(DrivetrainHealth health, ILocalizer localizer) =>
        health == DrivetrainHealth.Critical
            ? localizer.GetString(
                AlertCriticalMessageKey,
                "One or more drivetrain components are operating at critically high temperatures. Immediate attention is recommended.")
            : localizer.GetString(
                AlertWarningMessageKey,
                "Drivetrain temperatures are above normal operating range. Monitor closely and consider reducing load.");

    private static string BadgeLabel(DrivetrainHealth health, ILocalizer localizer)
    {
        // Web: t(`drivetrain.health.${overallHealth}`, overallHealth.toUpperCase()).
        (string key, string fallback) = health switch
        {
            DrivetrainHealth.Good => (BadgeKeyPrefix + "good", "GOOD"),
            DrivetrainHealth.Warning => (BadgeKeyPrefix + "warning", "WARNING"),
            _ => (BadgeKeyPrefix + "critical", "CRITICAL"),
        };

        return localizer.GetString(key, fallback);
    }

    private static string MotorStateLine(string? motorStatus, ILocalizer localizer)
    {
        string label = localizer.GetString(MotorStateKey, "Motor State");
        string value = string.IsNullOrWhiteSpace(motorStatus) ? EmDash : motorStatus!.Trim();
        return $"{label}: {value}";
    }

    private static string BuildAutomationName(
        HealthOverviewState state,
        bool showChip,
        string chipText,
        bool showAlert,
        string alertTitle,
        string healthTitle,
        string motorStateText,
        string badgeLabel,
        string scoreText,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case HealthOverviewState.Loading:
                return loadingLabel;
            case HealthOverviewState.Empty:
                return emptyMessage;
            case HealthOverviewState.Error:
                return errorTitle;
            default:
                // Reading order matches the web composition: freshness chip, alert, headline, subtitle,
                // badge, score. Only present parts are spoken so the name never carries a dangling separator.
                var parts = new List<string>(6);
                if (showChip)
                {
                    parts.Add(chipText);
                }

                if (showAlert)
                {
                    parts.Add(alertTitle);
                }

                parts.Add(healthTitle);
                parts.Add(motorStateText);
                parts.Add(badgeLabel);
                parts.Add(scoreText);
                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>HealthOverview</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the health level, score or motor state —
/// so a diagnostics line can never leak a user's drivetrain telemetry. Thread-safe.
/// </summary>
public sealed class HealthOverviewDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public HealthOverviewDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HealthOverview</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={HealthOverviewRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>HealthOverview</c> feature surface — the native mirror of the web component
/// at <c>web/src/features/driving/components/drivetrain-health/HealthOverview.tsx</c>. Holds the diagnostics
/// slug and the Segoe Fluent glyphs that stand in for the web Lucide icons (<c>CheckCircle</c> /
/// <c>AlertTriangle</c>). UI-free so the metadata is asserted in tests.
/// </summary>
public static class HealthOverviewRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "HealthOverview";

    /// <summary>Segoe Fluent "Completed" glyph for a healthy drivetrain (web <c>CheckCircle</c>).</summary>
    public const string HealthyGlyph = "\uE73E";

    /// <summary>Segoe Fluent "Warning" glyph for a warm / overheating drivetrain (web <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";
}
