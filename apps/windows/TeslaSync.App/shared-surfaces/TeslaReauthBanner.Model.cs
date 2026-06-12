using TeslaSync.App.Core.Feedback;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the TeslaReauthBanner surface — the native analogue of the literals and <c>t()</c> keys
/// in web/src/components/feedback/TeslaReauthBanner.tsx. Carries the diagnostics slug, the banner + action
/// automation ids (the web <c>data-testid</c> value plus stable ids for the Reconnect / Dismiss controls), the ARIA
/// role + live contract (web <c>role="alert"</c> / <c>aria-live="assertive"</c> — a Tesla token expiry is a partial
/// failure the user should be told about immediately), the deep-link route the Reconnect CTA targets (web
/// <c>navigate('/tesla-account')</c>), the generated warning design-token keys + the Segoe Fluent glyphs standing in
/// for the web Lucide <c>AlertTriangle</c> / <c>X</c> marks, the amber tint alphas, and the i18n keys (each with the
/// English fallback the web renders verbatim — all four already present in the P1/S10 catalogue under
/// <c>translation.tesla.reauth.*</c> and <c>translation.common.dismiss</c>). UI-free so it is asserted in tests.
/// </summary>
public static class TeslaReauthBannerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "TeslaReauthBanner";

    /// <summary>The automation id Narrator and UI-automation resolve the banner by (web <c>data-testid</c>).</summary>
    public const string BannerAutomationId = "tesla-reauth-banner";

    /// <summary>The automation id for the "Reconnect" deep-link button.</summary>
    public const string ReconnectAutomationId = "tesla-reauth-banner-reconnect";

    /// <summary>The automation id for the "Dismiss" icon button.</summary>
    public const string DismissAutomationId = "tesla-reauth-banner-dismiss";

    /// <summary>ARIA role the surface exposes — an interruptive alert region (web <c>role="alert"</c>).</summary>
    public const string AlertRole = "alert";

    /// <summary>ARIA live urgency the surface declares (web <c>aria-live="assertive"</c>).</summary>
    public const string LiveSetting = "assertive";

    /// <summary>The route the "Reconnect" CTA deep-links to (web <c>navigate('/tesla-account')</c>).</summary>
    public const string TeslaAccountRoute = "/tesla-account";

    /// <summary>Generated design-token colour key the amber banner tint is derived from (web amber-500).</summary>
    public const string WarningColorKey = "TsColorWarningColor";

    /// <summary>Banner background alpha over the warning colour (web <c>bg-amber-500/[0.08]</c>).</summary>
    public const double BannerBackgroundOpacity = 0.08;

    /// <summary>Banner bottom-border alpha over the warning colour (web <c>border-amber-500/30</c>).</summary>
    public const double BannerBorderOpacity = 0.30;

    /// <summary>Icon-chip background alpha over the warning colour (web <c>bg-amber-500/15</c>).</summary>
    public const double IconChipOpacity = 0.15;

    /// <summary>Generated warning brush key the banner icon tints from — the shared callout warning brush (web amber-300).</summary>
    public static string WarningBrushKey { get; } = CalloutVariants.AccentBrushKey(CalloutVariant.Warning);

    /// <summary>Segoe Fluent "Warning" glyph — the native stand-in for the web Lucide <c>AlertTriangle</c> mark.</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "Cancel" glyph — the native stand-in for the web Lucide <c>X</c> (dismiss) mark.</summary>
    public const string DismissGlyph = "\uE711";

    /// <summary>i18n key for the banner title (web <c>t('tesla.reauth.title', ...)</c> at TeslaReauthBanner.tsx L79).</summary>
    public const string TitleKey = "translation.tesla.reauth.title";

    /// <summary>English fallback for <see cref="TitleKey"/> — the web default value, verbatim.</summary>
    public const string TitleFallback = "Tesla account disconnected";

    /// <summary>i18n key for the banner body (web <c>t('tesla.reauth.body', ...)</c> at TeslaReauthBanner.tsx L82).</summary>
    public const string BodyKey = "translation.tesla.reauth.body";

    /// <summary>English fallback for <see cref="BodyKey"/> — the web default value, verbatim.</summary>
    public const string BodyFallback = "Reconnect to resume live data and commands.";

    /// <summary>i18n key for the "Reconnect" CTA (web <c>t('tesla.reauth.cta', ...)</c> at TeslaReauthBanner.tsx L87).</summary>
    public const string ReconnectKey = "translation.tesla.reauth.cta";

    /// <summary>English fallback for <see cref="ReconnectKey"/> — the web default value, verbatim.</summary>
    public const string ReconnectFallback = "Reconnect";

    /// <summary>i18n key for the "Dismiss" control label (web <c>t('common.dismiss', ...)</c> at TeslaReauthBanner.tsx L92).</summary>
    public const string DismissKey = "translation.common.dismiss";

    /// <summary>English fallback for <see cref="DismissKey"/> — the web default value, verbatim.</summary>
    public const string DismissFallback = "Dismiss";

    /// <summary>Resolve the localized banner title (web <c>t('tesla.reauth.title')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveTitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized banner body (web <c>t('tesla.reauth.body')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveBody(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(BodyKey, BodyFallback);
    }

    /// <summary>Resolve the localized "Reconnect" CTA label (web <c>t('tesla.reauth.cta')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveReconnectLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ReconnectKey, ReconnectFallback);
    }

    /// <summary>Resolve the localized "Dismiss" control label (web <c>t('common.dismiss')</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    public static string ResolveDismissLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(DismissKey, DismissFallback);
    }
}

/// <summary>
/// The fully projected, render-ready view of the Tesla-auth-recovery state — everything the web
/// <c>TeslaReauthBanner</c> derives before returning JSX (web/src/components/feedback/TeslaReauthBanner.tsx
/// L57-98): whether the banner is shown (<see cref="IsVisible"/> — the web <c>if (!visible) return null</c> gate),
/// the localized <see cref="Title"/> and <see cref="Body"/>, the localized <see cref="ReconnectLabel"/> /
/// <see cref="DismissLabel"/>, the ARIA <see cref="LiveSetting"/>, and the <see cref="AccessibleName"/> the
/// assertive alert region announces (title + body together). The labels are always resolved so they are ready the
/// instant the banner shows. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct TeslaReauthBannerProjection
{
    private TeslaReauthBannerProjection(
        bool isVisible,
        string title,
        string body,
        string reconnectLabel,
        string dismissLabel,
        string accessibleName,
        string liveSetting)
    {
        IsVisible = isVisible;
        Title = title;
        Body = body;
        ReconnectLabel = reconnectLabel;
        DismissLabel = dismissLabel;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>if (!visible) return null</c> render gate, inverted.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized banner title (web <c>tesla.reauth.title</c>).</summary>
    public string Title { get; }

    /// <summary>The localized banner body (web <c>tesla.reauth.body</c>).</summary>
    public string Body { get; }

    /// <summary>The localized "Reconnect" CTA label (web <c>tesla.reauth.cta</c>).</summary>
    public string ReconnectLabel { get; }

    /// <summary>The localized "Dismiss" control label (web <c>common.dismiss</c>).</summary>
    public string DismissLabel { get; }

    /// <summary>The accessible name the assertive alert region announces — the title and body together.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (assertive).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project the current visibility flag into a render-ready banner value, reproducing the web component
    /// (web/src/components/feedback/TeslaReauthBanner.tsx L57-98): the banner is shown only while the Tesla token
    /// has expired and the user has not dismissed / reconnected, and the title / body / action labels are always
    /// resolved so they are ready to announce the moment the banner shows.
    /// </summary>
    /// <param name="visible">Whether the banner is currently shown (web <c>visible</c> state).</param>
    /// <param name="localizer">The i18n facade the strings resolve through.</param>
    public static TeslaReauthBannerProjection Project(bool visible, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var title = TeslaReauthBannerRegistration.ResolveTitle(localizer);
        var body = TeslaReauthBannerRegistration.ResolveBody(localizer);

        return new TeslaReauthBannerProjection(
            isVisible: visible,
            title: title,
            body: body,
            reconnectLabel: TeslaReauthBannerRegistration.ResolveReconnectLabel(localizer),
            dismissLabel: TeslaReauthBannerRegistration.ResolveDismissLabel(localizer),
            accessibleName: $"{title}. {body}",
            liveSetting: TeslaReauthBannerRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the TeslaReauthBanner surface (P1/S11 diagnostics contract). The banner carries no user
/// content — only the localized re-auth prompt — so the collector records ONLY the operational <c>view.opened</c>
/// event with the surface slug, never anything about the user's Tesla account or token. Thread-safe; mirrors the
/// peer surfaces' diagnostics collectors.
/// </summary>
public sealed class TeslaReauthBannerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TeslaReauthBannerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=TeslaReauthBanner</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TeslaReauthBannerRegistration.Slug}");
    }
}
