using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the OfflineBanner surface — the native analogue of the literals in
/// web/src/components/feedback/OfflineBanner.tsx. Carries the diagnostics slug, the banner automation id, the ARIA
/// role + live contract (web <c>role="status"</c> / <c>aria-live="polite"</c>), the i18n keys (each with the
/// English fallback the web renders verbatim — these keys already exist in the P1/S10 catalogue under
/// <c>translation.pwa.offline.*</c>), the generated warning design-token keys + the Segoe Fluent glyph standing in
/// for the web Lucide <c>WifiOff</c> icon, and the banner tint alphas. UI-free so it is asserted in tests.
/// </summary>
public static class OfflineBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "OfflineBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by.</summary>
    public const string BannerAutomationId = "offline-banner";

    /// <summary>ARIA role the surface exposes — a read-only status region (web <c>role="status"</c>).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency the surface declares (web <c>aria-live="polite"</c>).</summary>
    public const string LiveSetting = "polite";

    /// <summary>Generated design-token colour key the banner tint is derived from (web amber-500).</summary>
    public const string WarningColorKey = "TsColorWarningColor";

    /// <summary>Banner background alpha over the warning colour (web <c>bg-neon-amber/5</c>, nudged for native legibility).</summary>
    public const double BannerBackgroundOpacity = 0.08;

    /// <summary>Banner border alpha over the warning colour (web <c>border-neon-amber/20</c>).</summary>
    public const double BannerBorderOpacity = 0.20;

    /// <summary>Banner body-text alpha over the warning colour (web <c>text-neon-amber/80</c>).</summary>
    public const double BodyForegroundOpacity = 0.80;

    /// <summary>Generated warning brush key the banner icon / title tint from — the shared callout warning brush.</summary>
    public static string WarningBrushKey { get; } = CalloutVariants.AccentBrushKey(CalloutVariant.Warning);

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon.</summary>
    public const string WifiOffGlyph = "\uEB5E";

    /// <summary>i18n key for the banner title (web <c>t('pwa.offline.title', ...)</c> at OfflineBanner.tsx L35).</summary>
    public const string TitleKey = "translation.pwa.offline.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web default value, verbatim.</summary>
    public const string TitleFallback = "You're offline";

    /// <summary>i18n key for the banner body (web <c>t('pwa.offline.banner', ...)</c> at OfflineBanner.tsx L40).</summary>
    public const string BodyKey = "translation.pwa.offline.banner";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web default value, verbatim.</summary>
    public const string BodyFallback = "Showing cached data. New requests will retry when you reconnect.";

    /// <summary>Resolve the localized banner title (web <c>t('pwa.offline.title')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized banner body (web <c>t('pwa.offline.banner')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveBody(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(BodyKey, BodyFallback);
    }
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="OnlineStatusSnapshot"/> — everything the web
/// <c>OfflineBanner</c> derives before returning JSX (web/src/components/feedback/OfflineBanner.tsx L22-43):
/// whether the banner is shown (<see cref="IsVisible"/> — the web <c>if (online) return null</c> gate inverted),
/// the localized <see cref="Title"/> and <see cref="Body"/>, the <see cref="AccessibleName"/> a screen reader
/// announces (title + body — the web wrapper is a polite status region), and the ARIA <see cref="LiveSetting"/>.
/// Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct OfflineBannerProjection
{
    private OfflineBannerProjection(bool isVisible, string title, string body, string accessibleName, string liveSetting)
    {
        IsVisible = isVisible;
        Title = title;
        Body = body;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>if (online) return null</c> render gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner title (web <c>t('pwa.offline.title')</c>).</summary>
    public string Title { get; }

    /// <summary>The localized banner body (web <c>t('pwa.offline.banner')</c>).</summary>
    public string Body { get; }

    /// <summary>The accessible name a screen reader announces — the title and body together.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project an online-status snapshot into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/OfflineBanner.tsx L22-43): the banner is visible only while offline, and the
    /// title / body are always resolved so they are ready to announce the moment the device drops offline.
    /// </summary>
    /// <param name="snapshot">The online/offline inputs (web <c>useOnlineStatus()</c>).</param>
    /// <param name="localizer">The i18n facade the strings resolve through.</param>
    public static OfflineBannerProjection Project(OnlineStatusSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var title = OfflineBannerRegistration.ResolveTitle(localizer);
        var body = OfflineBannerRegistration.ResolveBody(localizer);
        var accessibleName = $"{title}. {body}";

        return new OfflineBannerProjection(
            isVisible: snapshot.IsOffline,
            title: title,
            body: body,
            accessibleName: accessibleName,
            liveSetting: OfflineBannerRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the OfflineBanner surface (P1/S11 diagnostics contract). The banner carries no user
/// content — only the localized offline message — so the collector records ONLY the operational
/// <c>view.opened</c> event with the surface slug. Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class OfflineBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public OfflineBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=OfflineBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={OfflineBannerRegistration.Slug}");
    }
}
