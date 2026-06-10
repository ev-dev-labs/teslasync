using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The mutually-exclusive render branch of the <c>AchievementBadge</c> surface — the native union of the states
/// the P2 feature-view contract requires for the lifetime-stats achievement badge
/// (web/src/features/analytics/components/AchievementBadge.tsx). The web component is a pure presentational
/// child (it takes a single already-resolved <c>achievement</c> prop plus a <c>size</c> and performs no
/// fetching), so the parent Lifetime-Stats page owns the query lifecycle and supplies the active state. Every
/// member maps onto a visible surface; none is ever hidden behind a <c>{data &amp;&amp; …}</c> guard.
/// </summary>
public enum AchievementBadgeState
{
    /// <summary>The achievements query is in flight and nothing has arrived yet — skeleton chrome.</summary>
    Loading,

    /// <summary>A resolved achievement to render (the web fall-through) — the unlocked / locked badge.</summary>
    Ready,

    /// <summary>Resolved with no achievement — a friendly empty state, never a blank box.</summary>
    Empty,

    /// <summary>The query failed with no usable snapshot — a retriable error surface.</summary>
    Error,

    /// <summary>Showing a snapshot older than the freshness window — the badge plus a stale chip.</summary>
    Stale,

    /// <summary>No connectivity — the last cached badge plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The badge size — the native mirror of the web prop <c>size?: 'sm' | 'md' | 'lg'</c>
/// (web/src/features/analytics/components/AchievementBadge.tsx). Drives the resolved
/// <see cref="AchievementBadgeMetrics"/> only; the data and copy are size-independent.
/// </summary>
public enum AchievementBadgeSize
{
    /// <summary>Compact badge (web <c>'sm'</c>).</summary>
    Small,

    /// <summary>Default badge (web <c>'md'</c>).</summary>
    Medium,

    /// <summary>Large badge (web <c>'lg'</c>).</summary>
    Large,
}

/// <summary>
/// The resolved pixel metrics for a badge size — the native, WinUI-free analogue of one row of the web
/// <c>sizeConfig</c> map (web/src/features/analytics/components/AchievementBadge.tsx). The web Tailwind classes
/// (<c>text-xl</c>/<c>text-3xl</c>/<c>text-4xl</c>, <c>text-xs</c>/<c>text-sm</c>/<c>text-base</c>,
/// <c>gap-1</c>/<c>gap-2</c>/<c>gap-3</c>) are resolved here to their effective-pixel values so layout is unit
/// tested without a XAML runtime. Pure data — no WinUI types.
/// </summary>
/// <param name="RingDiameter">Progress-ring diameter (web <c>ring</c>).</param>
/// <param name="StrokeWidth">Progress-ring stroke width (web <c>stroke</c>).</param>
/// <param name="IconFontSize">Emoji icon font size (web <c>iconSize</c>).</param>
/// <param name="NameFontSize">Achievement-name font size (web <c>textSize</c>).</param>
/// <param name="DescriptionFontSize">Description font size (web fixed <c>text-xs</c>).</param>
/// <param name="StatusFontSize">Status / percent font size (web fixed <c>text-xs</c>).</param>
/// <param name="Gap">Vertical gap between the stacked rows (web <c>gap</c>).</param>
public sealed record AchievementBadgeMetrics(
    double RingDiameter,
    double StrokeWidth,
    double IconFontSize,
    double NameFontSize,
    double DescriptionFontSize,
    double StatusFontSize,
    double Gap)
{
    /// <summary>Resolve the metrics for a badge <paramref name="size"/> (the web <c>sizeConfig[size]</c>).</summary>
    public static AchievementBadgeMetrics For(AchievementBadgeSize size) => size switch
    {
        // web sm: { ring: 56, stroke: 3, iconSize: text-xl(20), gap: gap-1(4), textSize: text-xs(12) }
        AchievementBadgeSize.Small => new(56, 3, 20, 12, 12, 12, 4),

        // web lg: { ring: 96, stroke: 5, iconSize: text-4xl(36), gap: gap-3(12), textSize: text-base(16) }
        AchievementBadgeSize.Large => new(96, 5, 36, 16, 12, 12, 12),

        // web md: { ring: 72, stroke: 4, iconSize: text-3xl(30), gap: gap-2(8), textSize: text-sm(14) }
        _ => new(72, 4, 30, 14, 12, 12, 8),
    };
}

/// <summary>
/// One achievement — the native analogue of the web <c>AchievementData</c>
/// (web/src/features/analytics/components/AchievementBadge.tsx). Mirrors the web shape verbatim:
/// <see cref="Progress"/> is the 0..1 completion fraction, <see cref="Unlocked"/> the won flag,
/// <see cref="UnlockedAt"/> the optional ISO timestamp (web <c>unlocked_at: string | null</c>), and
/// <see cref="Icon"/> the emoji glyph rendered in the badge. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable achievement id (web <c>id</c>).</param>
/// <param name="Name">Display name (web <c>name</c>).</param>
/// <param name="Description">Short description (web <c>description</c>).</param>
/// <param name="Icon">Emoji glyph (web <c>icon</c>).</param>
/// <param name="Unlocked">Whether the achievement is won (web <c>unlocked</c>).</param>
/// <param name="UnlockedAt">Optional ISO unlock timestamp, or null (web <c>unlocked_at</c>).</param>
/// <param name="Progress">Completion fraction in 0..1 (web <c>progress</c>).</param>
/// <param name="Target">Target count for completion (web <c>target</c>).</param>
/// <param name="Current">Current count toward the target (web <c>current</c>).</param>
public sealed record AchievementData(
    string Id,
    string Name,
    string Description,
    string Icon,
    bool Unlocked,
    string? UnlockedAt,
    double Progress,
    int Target,
    int Current);

/// <summary>
/// The render-time data model the <c>AchievementBadge</c> view binds to — the native analogue of the web
/// component's <c>achievement</c> + <c>size</c> props plus the parent-supplied lifecycle <see cref="Status"/>
/// and freshness flags. The view never performs HTTP; the parent Lifetime-Stats state holder fills this in (the
/// native P1/S8 seam). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The parent-supplied lifecycle state.</param>
/// <param name="Achievement">The achievement to render, or null for the loading / empty / error states.</param>
/// <param name="Size">The badge size (web <c>size</c>, default <see cref="AchievementBadgeSize.Medium"/>).</param>
/// <param name="UpdatedAt">Last successful update timestamp surfaced in the freshness chip.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="ErrorMessage">Already-localized error message for the error / offline surfaces, when set.</param>
public sealed record AchievementBadgeModel(
    AchievementBadgeState Status,
    AchievementData? Achievement,
    AchievementBadgeSize Size = AchievementBadgeSize.Medium,
    DateTimeOffset? UpdatedAt = null,
    bool IsFetching = false,
    string? ErrorMessage = null)
{
    /// <summary>The initial model: the achievements query is in flight and nothing has arrived yet.</summary>
    /// <param name="size">The badge size; defaults to <see cref="AchievementBadgeSize.Medium"/>.</param>
    public static AchievementBadgeModel Loading(AchievementBadgeSize size = AchievementBadgeSize.Medium) =>
        new(AchievementBadgeState.Loading, null, size);

    /// <summary>A resolved model with no achievement — the empty state.</summary>
    /// <param name="size">The badge size; defaults to <see cref="AchievementBadgeSize.Medium"/>.</param>
    public static AchievementBadgeModel Empty(AchievementBadgeSize size = AchievementBadgeSize.Medium) =>
        new(AchievementBadgeState.Empty, null, size);

    /// <summary>A hard-failure model (no usable snapshot) carrying an optional already-localized message.</summary>
    /// <param name="message">An already-localized error message, or null for the default copy.</param>
    /// <param name="size">The badge size; defaults to <see cref="AchievementBadgeSize.Medium"/>.</param>
    public static AchievementBadgeModel Failed(
        string? message = null,
        AchievementBadgeSize size = AchievementBadgeSize.Medium) =>
        new(AchievementBadgeState.Error, null, size, ErrorMessage: message);

    /// <summary>A fresh resolved model carrying the achievement to render.</summary>
    /// <param name="achievement">The achievement.</param>
    /// <param name="size">The badge size; defaults to <see cref="AchievementBadgeSize.Medium"/>.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="isFetching">True while a background refresh is in flight.</param>
    public static AchievementBadgeModel Ready(
        AchievementData achievement,
        AchievementBadgeSize size = AchievementBadgeSize.Medium,
        DateTimeOffset? updatedAt = null,
        bool isFetching = false)
    {
        ArgumentNullException.ThrowIfNull(achievement);
        return new(AchievementBadgeState.Ready, achievement, size, updatedAt, isFetching);
    }

    /// <summary>A stale snapshot (older than the freshness window) carrying the cached achievement.</summary>
    /// <param name="achievement">The cached achievement.</param>
    /// <param name="size">The badge size; defaults to <see cref="AchievementBadgeSize.Medium"/>.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    public static AchievementBadgeModel Stale(
        AchievementData achievement,
        AchievementBadgeSize size = AchievementBadgeSize.Medium,
        DateTimeOffset? updatedAt = null)
    {
        ArgumentNullException.ThrowIfNull(achievement);
        return new(AchievementBadgeState.Stale, achievement, size, updatedAt);
    }

    /// <summary>An offline snapshot (no connectivity) carrying the last cached achievement.</summary>
    /// <param name="achievement">The cached achievement.</param>
    /// <param name="size">The badge size; defaults to <see cref="AchievementBadgeSize.Medium"/>.</param>
    /// <param name="updatedAt">The freshness timestamp.</param>
    /// <param name="message">An already-localized offline message, or null for the default copy.</param>
    public static AchievementBadgeModel Offline(
        AchievementData achievement,
        AchievementBadgeSize size = AchievementBadgeSize.Medium,
        DateTimeOffset? updatedAt = null,
        string? message = null)
    {
        ArgumentNullException.ThrowIfNull(achievement);
        return new(AchievementBadgeState.Offline, achievement, size, updatedAt, ErrorMessage: message);
    }
}

/// <summary>
/// The fully projected, render-ready view of one <c>AchievementBadge</c> input — the native analogue of
/// everything the web component computes before returning JSX. Holds the active <see cref="State"/>, the resolved
/// <see cref="Metrics"/>, the unlocked / near-complete flags, the icon / name / description, the progress percent
/// and its caption, the status caption ("✓ Unlocked" or the percent), the ring sweep + tint, the per-element
/// token brush keys (the web's amber / muted colours), the freshness chip copy + status, the empty / loading /
/// error copy and retry label, the freshness timestamp + fetching flag, and the surface
/// <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Metrics">The resolved pixel metrics for the badge size.</param>
/// <param name="IsUnlocked">Whether the achievement is won (web <c>achievement.unlocked</c>).</param>
/// <param name="IsNearComplete">Locked and at / past the near-complete threshold (web <c>isNearComplete</c>).</param>
/// <param name="IconText">The emoji glyph rendered in the badge (web <c>achievement.icon</c>).</param>
/// <param name="Name">The achievement name (web <c>achievement.name</c>).</param>
/// <param name="Description">The achievement description (web <c>achievement.description</c>).</param>
/// <param name="ProgressPercent">The rounded completion percent (web <c>pct</c>).</param>
/// <param name="PercentText">The formatted "<c>N%</c>" caption (web <c>{pct}%</c>).</param>
/// <param name="StatusText">The status caption — "✓ Unlocked" when won, else the percent.</param>
/// <param name="ShowRing">Whether the progress ring is drawn (web: only when locked).</param>
/// <param name="RingFraction">The clamped 0..1 ring sweep (web <c>clamp(pct,0,100)/100</c>).</param>
/// <param name="RingSeverity">The semantic tint of the ring arc (near-complete → warning, else neutral).</param>
/// <param name="RingAccentKey">Token brush key for the ring arc (web amber / grey).</param>
/// <param name="NameAccentKey">Token brush key for the name (web amber when won, else secondary).</param>
/// <param name="StatusAccentKey">Token brush key for the status caption (web amber when won, else muted).</param>
/// <param name="ContainerBorderKey">Token brush key for the tile border (web amber when won, else hairline).</param>
/// <param name="ShowFreshnessChip">Whether a stale / offline freshness chip is shown.</param>
/// <param name="FreshnessChipText">The freshness chip copy.</param>
/// <param name="FreshnessChipStatus">The freshness chip semantic status.</param>
/// <param name="EmptyMessage">The localized empty-state copy.</param>
/// <param name="LoadingLabel">The localized loading copy.</param>
/// <param name="ErrorTitle">The localized error title.</param>
/// <param name="ErrorMessage">The localized error message.</param>
/// <param name="RetryLabel">The localized retry affordance label.</param>
/// <param name="UpdatedAt">The freshness timestamp surfaced to the host.</param>
/// <param name="IsFetching">True while a background refresh is in flight.</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record AchievementBadgeDisplay(
    AchievementBadgeState State,
    AchievementBadgeMetrics Metrics,
    bool IsUnlocked,
    bool IsNearComplete,
    string IconText,
    string Name,
    string Description,
    int ProgressPercent,
    string PercentText,
    string StatusText,
    bool ShowRing,
    double RingFraction,
    StatusKind RingSeverity,
    string RingAccentKey,
    string NameAccentKey,
    string StatusAccentKey,
    string ContainerBorderKey,
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
/// Pure projection from an <see cref="AchievementBadgeModel"/> to its <see cref="AchievementBadgeDisplay"/> — the
/// native port of web/src/features/analytics/components/AchievementBadge.tsx. Branch precedence mirrors the web
/// parent's data lifecycle (loading → error → empty → freshness → ready); a fresh snapshot with no achievement
/// collapses to a friendly empty state, while a stale / offline snapshot keeps its cached badge under a freshness
/// chip. The percent is <c>round(progress * 100)</c> exactly as the web, the ring sweep is the clamped
/// <c>pct / 100</c> the web RadialGauge computes from <c>value=pct</c> / <c>max=100</c>, the near-complete flag is
/// the web <c>!unlocked &amp;&amp; progress &gt;= 0.8</c>, and the per-element colours reproduce the web's amber
/// (won) / grey (locked) classes via the semantic status tokens. The only user-facing string the badge owns is
/// the shared unlocked caption plus the lifecycle copy. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class AchievementBadgeProjection
{
    /// <summary>Progress fraction at or above which a locked badge reads "near complete" (web <c>>= 0.8</c>).</summary>
    public const double NearCompleteThreshold = 0.8;

    /// <summary>i18n key for the unlocked caption (the web <c>lifetime.unlocked</c> string).</summary>
    public const string UnlockedKey = "lifetime.unlocked";

    /// <summary>English fallback for <see cref="UnlockedKey"/> (the web default).</summary>
    public const string UnlockedFallback = "\u2713 Unlocked";

    /// <summary>i18n key for the loading copy (the shared <c>common.loading</c> string).</summary>
    public const string LoadingKey = "common.loading";

    /// <summary>English fallback for <see cref="LoadingKey"/>.</summary>
    public const string LoadingFallback = "Loading...";

    /// <summary>i18n key for the empty copy (the lifetime "no achievements" string).</summary>
    public const string EmptyKey = "lifetime.noAchievements";

    /// <summary>English fallback for <see cref="EmptyKey"/>.</summary>
    public const string EmptyFallback = "Start driving to unlock achievements";

    /// <summary>i18n key for the error title (the shared <c>error.loadFailed</c> string).</summary>
    public const string ErrorTitleKey = "error.loadFailed";

    /// <summary>English fallback for <see cref="ErrorTitleKey"/>.</summary>
    public const string ErrorTitleFallback = "Failed to load data";

    /// <summary>i18n key for the default error body (the shared network message).</summary>
    public const string ErrorMessageKey = "error.network.message";

    /// <summary>English fallback for <see cref="ErrorMessageKey"/>.</summary>
    public const string ErrorMessageFallback = "Check your internet connection and try again.";

    /// <summary>i18n key for the retry affordance (the shared <c>common.retry</c> string).</summary>
    public const string RetryKey = "common.retry";

    /// <summary>English fallback for <see cref="RetryKey"/>.</summary>
    public const string RetryFallback = "Retry";

    /// <summary>i18n key for the offline chip (the shared <c>common.offline</c> string).</summary>
    public const string OfflineKey = "common.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/>.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the stale chip (the shared <c>common.stale</c> string).</summary>
    public const string StaleKey = "common.stale";

    /// <summary>English fallback for <see cref="StaleKey"/>.</summary>
    public const string StaleFallback = "Stale";

    /// <summary>Token brush key for the muted status caption of a locked badge (web <c>text-muted</c>).</summary>
    public const string MutedBrushKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the hairline tile border of a locked badge (web <c>border-white/[0.06]</c>).</summary>
    public const string BorderBrushKey = "TsColorBorderBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web prop plus size + lifecycle).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready display model.</returns>
    public static AchievementBadgeDisplay Project(AchievementBadgeModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        AchievementBadgeState state = SelectState(model);
        AchievementBadgeMetrics metrics = AchievementBadgeMetrics.For(model.Size);

        AchievementData? a = model.Achievement;
        bool unlocked = a?.Unlocked ?? false;
        double progress = a?.Progress ?? 0;
        bool nearComplete = IsNearComplete(unlocked, progress);
        int pct = PercentOf(progress);

        string iconText = a?.Icon ?? string.Empty;
        string name = a?.Name ?? string.Empty;
        string description = a?.Description ?? string.Empty;
        string percentText = string.Concat(NumberFormatting.Format(pct, null, 0), "%");

        string unlockedCaption = localizer.GetString(UnlockedKey, UnlockedFallback);
        string statusText = unlocked ? unlockedCaption : percentText;

        // web RadialGauge clamps value=pct to [0, max=100]; fraction = clamped / max.
        double ringFraction = Math.Clamp(pct, 0, 100) / 100.0;
        StatusKind ringSeverity = nearComplete ? StatusKind.Warning : StatusKind.Neutral;

        string loadingLabel = localizer.GetString(LoadingKey, LoadingFallback);
        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);
        string errorTitle = localizer.GetString(ErrorTitleKey, ErrorTitleFallback);
        string errorMessage = string.IsNullOrWhiteSpace(model.ErrorMessage)
            ? localizer.GetString(ErrorMessageKey, ErrorMessageFallback)
            : model.ErrorMessage!;
        string retryLabel = localizer.GetString(RetryKey, RetryFallback);

        bool showChip = state is AchievementBadgeState.Stale or AchievementBadgeState.Offline;
        string chipText = state switch
        {
            AchievementBadgeState.Offline => localizer.GetString(OfflineKey, OfflineFallback),
            AchievementBadgeState.Stale => localizer.GetString(StaleKey, StaleFallback),
            _ => string.Empty,
        };
        StatusKind chipStatus = state == AchievementBadgeState.Offline ? StatusKind.Danger : StatusKind.Warning;

        string automationName = BuildAutomationName(
            state, name, description, statusText, showChip, chipText, emptyMessage, loadingLabel, errorTitle);

        return new AchievementBadgeDisplay(
            State: state,
            Metrics: metrics,
            IsUnlocked: unlocked,
            IsNearComplete: nearComplete,
            IconText: iconText,
            Name: name,
            Description: description,
            ProgressPercent: pct,
            PercentText: percentText,
            StatusText: statusText,
            ShowRing: !unlocked,
            RingFraction: ringFraction,
            RingSeverity: ringSeverity,
            RingAccentKey: StatusResources.AccentBrushKey(ringSeverity),
            NameAccentKey: unlocked
                ? StatusResources.AccentBrushKey(StatusKind.Warning)
                : StatusResources.AccentBrushKey(StatusKind.Neutral),
            StatusAccentKey: unlocked ? StatusResources.AccentBrushKey(StatusKind.Warning) : MutedBrushKey,
            ContainerBorderKey: unlocked ? StatusResources.AccentBrushKey(StatusKind.Warning) : BorderBrushKey,
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
    /// The rounded completion percent — the native port of the web <c>Math.round(progress * 100)</c>. JavaScript
    /// <c>Math.round</c> rounds halves toward positive infinity; for the 0..1 progress fraction that equals
    /// round-half-away-from-zero, so the .NET equivalent is <see cref="MidpointRounding.AwayFromZero"/>.
    /// </summary>
    /// <param name="progress">The 0..1 completion fraction (web <c>achievement.progress</c>).</param>
    /// <returns>The rounded percent (web <c>pct</c>).</returns>
    public static int PercentOf(double progress) =>
        (int)Math.Round(progress * 100.0, MidpointRounding.AwayFromZero);

    /// <summary>
    /// Whether a badge reads "near complete" — the native port of the web
    /// <c>!achievement.unlocked &amp;&amp; achievement.progress &gt;= 0.8</c>. An unlocked badge is never
    /// near-complete (it is already won).
    /// </summary>
    /// <param name="unlocked">Whether the achievement is won (web <c>achievement.unlocked</c>).</param>
    /// <param name="progress">The 0..1 completion fraction (web <c>achievement.progress</c>).</param>
    /// <returns>True when the locked badge is at / past the near-complete threshold.</returns>
    public static bool IsNearComplete(bool unlocked, double progress) =>
        !unlocked && progress >= NearCompleteThreshold;

    // Branch precedence from the web parent's data lifecycle. Loading / Error / Empty / Stale / Offline come
    // straight from the parent's classification; a fresh "Ready" snapshot (or a stale / offline one) with no
    // achievement has nothing to render and collapses to the friendly empty state.
    private static AchievementBadgeState SelectState(AchievementBadgeModel model) => model.Status switch
    {
        AchievementBadgeState.Loading => AchievementBadgeState.Loading,
        AchievementBadgeState.Error => AchievementBadgeState.Error,
        AchievementBadgeState.Empty => AchievementBadgeState.Empty,
        AchievementBadgeState.Stale => model.Achievement is null
            ? AchievementBadgeState.Empty
            : AchievementBadgeState.Stale,
        AchievementBadgeState.Offline => model.Achievement is null
            ? AchievementBadgeState.Empty
            : AchievementBadgeState.Offline,
        _ => model.Achievement is null ? AchievementBadgeState.Empty : AchievementBadgeState.Ready,
    };

    private static string BuildAutomationName(
        AchievementBadgeState state,
        string name,
        string description,
        string statusText,
        bool showChip,
        string chipText,
        string emptyMessage,
        string loadingLabel,
        string errorTitle)
    {
        switch (state)
        {
            case AchievementBadgeState.Loading:
                return loadingLabel;
            case AchievementBadgeState.Empty:
                return emptyMessage;
            case AchievementBadgeState.Error:
                return errorTitle;
            default:
                // Reading order matches the badge: name, freshness, description, status. Only present parts are
                // spoken so the Narrator name never carries a dangling separator.
                var parts = new List<string>(4);
                if (!string.IsNullOrWhiteSpace(name))
                {
                    parts.Add(name);
                }

                if (showChip && !string.IsNullOrWhiteSpace(chipText))
                {
                    parts.Add(chipText);
                }

                if (!string.IsNullOrWhiteSpace(description))
                {
                    parts.Add(description);
                }

                parts.Add(statusText);
                return string.Join(". ", parts);
        }
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>AchievementBadge</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the achievement name, description, icon or
/// progress — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class AchievementBadgeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public AchievementBadgeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=AchievementBadge</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={AchievementBadgeRegistration.Slug}"));
    }
}

/// <summary>
/// Canonical metadata for the <c>AchievementBadge</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/analytics/components/AchievementBadge.tsx</c>. UI-free so the metadata is asserted in
/// tests.
/// </summary>
public static class AchievementBadgeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "AchievementBadge";
}
