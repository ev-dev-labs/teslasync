// Notifications / Webhooks page — native model layer.
//
// The WinUI-free registration, render-model and diagnostics behind the
// WebhooksPage surface (the native parity port of the web page
// web/src/features/notifications/pages/WebhooksPage.tsx). The web page is a thin
// PageContainer (localized title + subtitle + a "copy link" action) wrapping the
// shared WebhookChannelsSection; this page mirrors that exactly — the page chrome
// lives here, the list/CRUD lives in the already-ported WebhookChannelsSection.
//
// Everything here is UI-thread-free so the registration metadata, the localized
// title/subtitle projection and the PII-safe diagnostics are asserted headlessly
// without a WinUI host.
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// Canonical metadata for the Webhooks page — the native mirror of the web route <c>/notifications/webhooks</c>
/// (nav name <c>Webhooks</c>). The shell page factory registers the surface under <see cref="RouteName"/>; the
/// title and subtitle resolve through the i18n facade with the web key names (the inline <c>t()</c> defaults from
/// <c>WebhooksPage.tsx</c>).
/// </summary>
public static class WebhooksPageRegistration
{
    /// <summary>The navigation route name the shell page factory registers this surface under.</summary>
    public const string RouteName = "NotificationsWebhooks";

    /// <summary>The normalized route path (web route <c>/notifications/webhooks</c>) used to build the share link.</summary>
    public const string RoutePath = "notifications/webhooks";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WebhooksPage";

    /// <summary>The web page this surface mirrors.</summary>
    public const string WebSource = "features/notifications/pages/WebhooksPage.tsx";

    /// <summary>The localized page title (web <c>notifications.webhooks.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("notifications.webhooks.title", "Webhooks");
    }

    /// <summary>The localized page subtitle (web <c>notifications.webhooks.subtitle</c>).</summary>
    public static string Subtitle(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(
            "notifications.webhooks.subtitle",
            "Custom HTTPS endpoints that receive HMAC-signed event payloads.");
    }
}

/// <summary>
/// The render-ready projection the <see cref="WebhooksPageViewModel"/> exposes for the page chrome — the localized
/// <see cref="Title"/> and <see cref="Subtitle"/> (web <c>PageContainer</c> header) plus the page's accessible
/// <see cref="AutomationName"/>. The webhook list and its loading / empty / error states are owned by the embedded
/// <see cref="WebhookChannelsSection"/>, so the page itself carries no data state of its own.
/// </summary>
/// <param name="Title">The localized page title (web <c>PageContainer title</c>).</param>
/// <param name="Subtitle">The localized page subtitle (web <c>PageContainer subtitle</c>).</param>
/// <param name="AutomationName">The Narrator name announced for the page region.</param>
public sealed record WebhooksDisplay(string Title, string Subtitle, string AutomationName);

/// <summary>
/// PII-safe diagnostics for the Webhooks page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a channel name, URL or secret — so a diagnostics line can
/// never leak user configuration. Thread-safe.
/// </summary>
public sealed class WebhooksPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WebhooksPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>The number of <c>view.opened</c> events recorded.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WebhooksPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WebhooksPageRegistration.Slug}");
    }
}
