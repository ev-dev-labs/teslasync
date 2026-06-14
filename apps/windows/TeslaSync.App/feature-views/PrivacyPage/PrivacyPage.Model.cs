using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// Canonical metadata for the native WinUI 3 <c>PrivacyPage</c> surface — the anchor for the web page at
/// web/src/features/settings/pages/PrivacyPage.tsx (route <c>/account/privacy</c>, nav name <c>Privacy</c>).
/// The web page is a thin <c>PageContainer</c> (title + subtitle + "Copy link" affordance) hosting the
/// <c>PrivacySection</c>; this type owns only the page-tier facts the header binds — the shell route name,
/// the web route path, the diagnostics <see cref="Slug"/> and the two page-tier i18n keys
/// (web <c>account.privacy.title</c> / <c>account.privacy.subtitle</c>) — so the view-model, the view and the
/// tests resolve one source of truth.
/// </summary>
public static class PrivacyPageRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> <c>Page("Privacy", …)</c>).</summary>
    public const string RouteName = "Privacy";

    /// <summary>The web route path the page mirrors (no leading slash).</summary>
    public const string Route = "account/privacy";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "PrivacyPage";

    /// <summary>The i18n key for the page title (web <c>account.privacy.title</c>).</summary>
    public const string TitleKey = "account.privacy.title";

    /// <summary>The English default for <see cref="TitleKey"/> (web fallback, verbatim).</summary>
    public const string TitleFallback = "Privacy";

    /// <summary>The i18n key for the page subtitle (web <c>account.privacy.subtitle</c>).</summary>
    public const string SubtitleKey = "account.privacy.subtitle";

    /// <summary>The English default for <see cref="SubtitleKey"/> (web fallback, verbatim).</summary>
    public const string SubtitleFallback =
        "Manage browser-local data: recently viewed pages and cookies / analytics consent.";

    /// <summary>Resolve the localized page title (web <c>t('account.privacy.title', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized page subtitle (web <c>t('account.privacy.subtitle', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, SubtitleFallback);
    }

    /// <summary>
    /// The shareable deep link the copy-link affordance writes to the clipboard — the native analogue of the web
    /// page's <c>window.location.href</c> (a <c>teslasync://app/account/privacy</c> activation URI).
    /// </summary>
    /// <returns>The canonical deep-link string for this route.</returns>
    public static string CopyLinkUri() => DeepLink.BuildUri(Route).ToString();
}

/// <summary>
/// PII-safe diagnostics for the Privacy page surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a consent decision, a recently-viewed
/// route or a user id — so a diagnostics line can never leak browsing or privacy data. Thread-safe.
/// </summary>
public sealed class PrivacyPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to (null discards).</param>
    public PrivacyPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PrivacyPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PrivacyPageRegistration.Slug}");
    }
}
