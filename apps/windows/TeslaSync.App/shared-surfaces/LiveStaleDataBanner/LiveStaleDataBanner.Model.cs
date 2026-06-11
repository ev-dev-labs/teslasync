using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the LiveStaleDataBanner surface — the native analogue of the module-level literals in
/// web/src/components/feedback/LiveStaleDataBanner.tsx. Carries the diagnostics slug, the banner automation id, the
/// sustained-disconnection threshold (the web <c>STALE_BANNER_THRESHOLD_MS = 2 * 60_000</c>) and the wake margin the
/// web schedules its <c>setTimeout</c> with (<c>+ 50</c> ms), the Segoe Fluent "offline" glyph standing in for the
/// web Lucide <c>WifiOff</c> icon, the warning design-token keys + tint alphas (the web
/// <c>&lt;AlertBanner variant="warning"&gt;</c> tone), the ARIA role / live contract, and the two i18n keys (each
/// with the English fallback the web renders verbatim — these keys already exist in the P1/S10 catalogue under
/// <c>translation.live.staleBanner.*</c>). UI-free so it is asserted in tests.
/// </summary>
public static class LiveStaleDataBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "LiveStaleDataBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by.</summary>
    public const string RootAutomationId = "live-stale-data-banner";

    /// <summary>ARIA role the surface exposes — a read-only status region (web <c>AlertBanner</c> / companion <c>LiveIndicator</c> role="status").</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the surface declares — a warning is announced politely (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>
    /// How long the live pipe must be continuously <c>disconnected</c> before the banner is shown — the web
    /// <c>STALE_BANNER_THRESHOLD_MS = 2 * 60_000</c> (two minutes). Pages that rely on live data only warn after a
    /// sustained outage to avoid flapping during transient reconnects.
    /// </summary>
    public static readonly TimeSpan StaleThreshold = TimeSpan.FromMinutes(2);

    /// <summary>The extra slack the re-evaluation is scheduled with so the threshold has surely elapsed (web <c>+ 50</c> ms on the <c>setTimeout</c>).</summary>
    public static readonly TimeSpan WakeMargin = TimeSpan.FromMilliseconds(50);

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon (matches the LiveIndicator disconnected glyph).</summary>
    public const string WifiOffGlyph = "\uEB5E";

    /// <summary>Generated design-token brush key the banner icon / accent tints from — the shared callout warning brush.</summary>
    public static string WarningBrushKey { get; } = CalloutVariants.AccentBrushKey(CalloutVariant.Warning);

    /// <summary>Generated design-token colour key the banner tint is derived from (web amber-500).</summary>
    public const string WarningColorKey = "TsColorWarningColor";

    /// <summary>Banner background alpha over the warning colour (web <c>bg-neon-amber/5</c>, nudged for native legibility).</summary>
    public const double BannerBackgroundOpacity = 0.08;

    /// <summary>Banner border alpha over the warning colour (web <c>border-neon-amber/20</c>).</summary>
    public const double BannerBorderOpacity = 0.20;

    /// <summary>i18n key for the banner title (web <c>t('live.staleBanner.title', 'Live data unavailable')</c>).</summary>
    public const string TitleKey = "translation.live.staleBanner.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web default value, verbatim.</summary>
    public const string TitleFallback = "Live data unavailable";

    /// <summary>i18n key for the banner message (web <c>t('live.staleBanner.message', '...')</c>).</summary>
    public const string MessageKey = "translation.live.staleBanner.message";

    /// <summary>English fallback for <see cref="MessageKey"/> — the web default value, verbatim.</summary>
    public const string MessageFallback =
        "The live data connection has been offline for more than 2 minutes. Values on this page may be stale until the connection is restored.";

    /// <summary>Resolve the localized banner title through the i18n facade (web <c>t('live.staleBanner.title')</c>).</summary>
    /// <param name="localizer">The i18n facade the title resolves through.</param>
    public static string ResolveTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized banner message through the i18n facade (web <c>t('live.staleBanner.message')</c>).</summary>
    /// <param name="localizer">The i18n facade the message resolves through.</param>
    public static string ResolveMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(MessageKey, MessageFallback);
    }
}

/// <summary>
/// The outcome of one evaluation of the stale-banner trigger — the native analogue of the web component's
/// <c>useEffect</c> body that decides whether to show the banner and (when not yet) when to re-check
/// (web/src/components/feedback/LiveStaleDataBanner.tsx L34-L53). Pure value type: <see cref="Show"/> mirrors the
/// web <c>show</c> state, <see cref="DisconnectedSince"/> mirrors the <c>disconnectedSinceRef</c> (null once the
/// pipe is healthy again), and <see cref="RetryAfter"/> mirrors the <c>setTimeout</c> delay the view schedules its
/// one-shot wake with (null when there is nothing to wait for — either already shown or not disconnected).
/// </summary>
public readonly record struct StaleBannerDecision
{
    /// <summary>Creates a decision from the evaluator.</summary>
    /// <param name="show">Whether the banner should be shown (web <c>show</c>).</param>
    /// <param name="disconnectedSince">When the current disconnection began, or null if healthy (web <c>disconnectedSinceRef</c>).</param>
    /// <param name="retryAfter">When to re-evaluate so the threshold can elapse, or null (web <c>setTimeout</c> delay).</param>
    public StaleBannerDecision(bool show, DateTimeOffset? disconnectedSince, TimeSpan? retryAfter)
    {
        Show = show;
        DisconnectedSince = disconnectedSince;
        RetryAfter = retryAfter;
    }

    /// <summary>Whether the banner should be shown (web <c>show</c>).</summary>
    public bool Show { get; }

    /// <summary>When the current sustained disconnection began, or null if the pipe is not disconnected (web <c>disconnectedSinceRef</c>).</summary>
    public DateTimeOffset? DisconnectedSince { get; }

    /// <summary>How long to wait before re-evaluating so the threshold can elapse, or null when nothing is pending (web <c>setTimeout</c> delay).</summary>
    public TimeSpan? RetryAfter { get; }

    /// <summary>The healthy / not-disconnected decision: hidden, with no tracked disconnection and nothing to wait for.</summary>
    public static StaleBannerDecision Hidden { get; } = new(false, null, null);
}

/// <summary>
/// The pure trigger logic for the stale-data banner — the native port of the web component's <c>useEffect</c>
/// (web/src/components/feedback/LiveStaleDataBanner.tsx L34-L53). Given the coarse live-pipeline
/// <see cref="LiveConnectionState"/> (the web <c>useLiveConnection().status</c>), the time the current disconnection
/// began, the current clock and the threshold, it decides whether to show the banner now, when to re-check, and the
/// updated disconnection timestamp. UI-free and clock-injected so every branch is asserted deterministically.
/// </summary>
public static class LiveStaleDataBannerEvaluator
{
    /// <summary>
    /// Decide the banner state, reproducing the web effect exactly: a non-disconnected status clears the tracked
    /// disconnection and hides the banner; the first disconnected observation seeds <c>disconnectedSince</c>; once
    /// the elapsed disconnection reaches <paramref name="threshold"/> the banner shows; otherwise it stays hidden
    /// and asks to be re-evaluated after the remaining time plus the wake margin (web
    /// <c>THRESHOLD - elapsed + 50</c>).
    /// </summary>
    /// <param name="status">The coarse live-pipeline health (web <c>useLiveConnection().status</c>).</param>
    /// <param name="disconnectedSince">When the current disconnection began, or null (web <c>disconnectedSinceRef</c>).</param>
    /// <param name="now">The clock the elapsed disconnection is measured against (web <c>Date.now()</c>).</param>
    /// <param name="threshold">The sustained-disconnection threshold (web <c>STALE_BANNER_THRESHOLD_MS</c>).</param>
    public static StaleBannerDecision Decide(
        LiveConnectionState status,
        DateTimeOffset? disconnectedSince,
        DateTimeOffset now,
        TimeSpan threshold)
    {
        // web: any non-disconnected status clears the timer and hides the banner.
        if (status != LiveConnectionState.Disconnected)
        {
            return StaleBannerDecision.Hidden;
        }

        // web: if (disconnectedSinceRef.current == null) disconnectedSinceRef.current = Date.now()
        var since = disconnectedSince ?? now;
        var elapsed = now - since;

        // web: if (elapsed >= STALE_BANNER_THRESHOLD_MS) { setShow(true); return }
        if (elapsed >= threshold)
        {
            return new StaleBannerDecision(true, since, null);
        }

        // web: setTimeout(() => setShow(true), STALE_BANNER_THRESHOLD_MS - elapsed + 50)
        var retryAfter = threshold - elapsed + LiveStaleDataBannerRegistration.WakeMargin;
        return new StaleBannerDecision(false, since, retryAfter);
    }
}

/// <summary>
/// The fully projected, render-ready view of the stale-data banner — everything the web component derives before
/// returning JSX (web/src/components/feedback/LiveStaleDataBanner.tsx L55-L69): whether the banner is shown
/// (<see cref="IsVisible"/> — the web <c>if (!show) return null</c> inverted), the localized <see cref="Title"/> and
/// <see cref="Message"/> (the web <c>t(...)</c> calls), the Segoe Fluent <see cref="IconGlyph"/> (web Lucide
/// <c>WifiOff</c>), the accessible <see cref="AccessibleName"/> a screen reader announces (title + message) and the
/// ARIA <see cref="LiveSetting"/>. The strings are always resolved so they are ready the instant the banner shows.
/// Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct LiveStaleDataBannerProjection
{
    private LiveStaleDataBannerProjection(
        bool isVisible,
        string title,
        string message,
        string iconGlyph,
        string accessibleName,
        string liveSetting)
    {
        IsVisible = isVisible;
        Title = title;
        Message = message;
        IconGlyph = iconGlyph;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>if (!show) return null</c> render gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner title (web <c>t('live.staleBanner.title')</c>).</summary>
    public string Title { get; }

    /// <summary>The localized banner message (web <c>t('live.staleBanner.message')</c>).</summary>
    public string Message { get; }

    /// <summary>The Segoe Fluent glyph the banner shows (web Lucide <c>WifiOff</c>).</summary>
    public string IconGlyph { get; }

    /// <summary>The accessible name a screen reader announces — the title and message together.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project the show flag into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/LiveStaleDataBanner.tsx L55-L69): the title / message are always resolved (so
    /// they are ready the moment the banner shows), and <see cref="IsVisible"/> is the web <c>show</c> state.
    /// </summary>
    /// <param name="show">Whether the banner is shown (web <c>show</c>).</param>
    /// <param name="localizer">The i18n facade the title / message resolve through.</param>
    public static LiveStaleDataBannerProjection Project(bool show, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var title = LiveStaleDataBannerRegistration.ResolveTitle(localizer);
        var message = LiveStaleDataBannerRegistration.ResolveMessage(localizer);

        return new LiveStaleDataBannerProjection(
            isVisible: show,
            title: title,
            message: message,
            iconGlyph: LiveStaleDataBannerRegistration.WifiOffGlyph,
            accessibleName: $"{title}. {message}",
            liveSetting: LiveStaleDataBannerRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the LiveStaleDataBanner surface (P1/S11 diagnostics contract). The banner carries no
/// user content (only a coarse connection status), so the collector records ONLY the operational <c>view.opened</c>
/// event with the surface slug. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class LiveStaleDataBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public LiveStaleDataBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveStaleDataBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveStaleDataBannerRegistration.Slug}");
    }
}
