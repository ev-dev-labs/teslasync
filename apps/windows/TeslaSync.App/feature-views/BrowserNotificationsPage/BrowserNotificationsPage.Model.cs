using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// Static registration facts for the native <c>BrowserNotificationsPage</c> — the parity port of the web page
/// web/src/features/notifications/pages/BrowserNotificationsPage.tsx (route <c>/notifications/browser</c>, nav
/// name <c>NotificationsBrowser</c>). The web page is a thin <c>PageContainer</c> wrapper (title + subtitle +
/// copy-link affordance) around the already-ported <see cref="NotificationSettings"/> surface, so this type owns
/// only the page-tier strings, the route/slug constants and the shareable deep-link the copy-link affordance
/// writes to the clipboard. The shell page factory binds the surface under <see cref="RouteName"/>.
/// </summary>
public static class BrowserNotificationsRegistration
{
    /// <summary>The shell route name (matches <c>RouteTable</c> <c>Page("NotificationsBrowser", …)</c>).</summary>
    public const string RouteName = "NotificationsBrowser";

    /// <summary>The web route path the page mirrors (no leading slash).</summary>
    public const string Route = "notifications/browser";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "BrowserNotificationsPage";

    /// <summary>The i18n key for the page title (web <c>notifications.browser.title</c>).</summary>
    public const string TitleKey = "notifications.browser.title";

    /// <summary>The English default for <see cref="TitleKey"/> (web fallback, verbatim).</summary>
    public const string TitleFallback = "Browser notifications";

    /// <summary>The i18n key for the page subtitle (web <c>notifications.browser.subtitle</c>).</summary>
    public const string SubtitleKey = "notifications.browser.subtitle";

    /// <summary>The English default for <see cref="SubtitleKey"/> (web fallback, verbatim).</summary>
    public const string SubtitleFallback = "Native browser push notifications when alerts fire.";

    /// <summary>Resolve the localized page title (web <c>t('notifications.browser.title', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized title.</returns>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Resolve the localized page subtitle (web <c>t('notifications.browser.subtitle', …)</c>).</summary>
    /// <param name="localizer">The i18n facade.</param>
    /// <returns>The localized subtitle.</returns>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(SubtitleKey, SubtitleFallback);
    }

    /// <summary>
    /// The shareable deep link the copy-link affordance writes to the clipboard — the native analogue of the web
    /// page's <c>window.location.href</c> (a <c>teslasync://app/notifications/browser</c> activation URI).
    /// </summary>
    /// <returns>The canonical deep-link string for this route.</returns>
    public static string CopyLinkUri() => DeepLink.BuildUri(Route).ToString();
}

/// <summary>
/// The default <see cref="INotificationTabSignalsSource"/> for the shell-hosted page — resolves the
/// browser-tab-signals read to the empty data state, so the embedded <see cref="NotificationSettings"/> renders
/// with the web on-by-default toggles, and accepts a save as a no-op. The shell uses this until a host wires the
/// generated-client-backed <see cref="NotificationTabSignalsSource"/>; it mirrors the <c>EmptyXSource</c>
/// convention the sibling pages use for their default ports.
/// </summary>
public sealed class EmptyNotificationTabSignalsSource : INotificationTabSignalsSource
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyNotificationTabSignalsSource Instance { get; } = new();

    private EmptyNotificationTabSignalsSource()
    {
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<NotificationTabSignals>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        yield return RepositoryResult<NotificationTabSignals>.Empty();
        await Task.CompletedTask.ConfigureAwait(false);
    }

    /// <inheritdoc />
    public Task SaveAsync(NotificationTabSignals signals, CancellationToken cancellationToken = default) =>
        Task.CompletedTask;
}
