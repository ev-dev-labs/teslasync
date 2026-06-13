using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Notifications;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QuietHoursPage"/> view — the native port of the web
/// page's thin composition (web/src/features/notifications/pages/QuietHoursPage.tsx). The web page renders no data
/// of its own: it sets the page title + subtitle and hosts the server-backed <c>QuietHoursPanel</c> (which owns the
/// <c>useQuietHours</c> read and its loading / empty / error states). So this holder is presentation-only — it
/// exposes the two localized page-tier strings the page header binds (web <c>notifications.quietHours.title</c> /
/// <c>notifications.quietHours.subtitle</c>) and records the PII-safe <c>view.opened</c> event. It performs no I/O
/// and reads no query itself; the hosted panel's own view-model drives the cache-then-network lifecycle.
/// </summary>
public sealed class QuietHoursPageViewModel
{
    private readonly ILocalizer _localizer;
    private readonly QuietHoursPageDiagnostics _diagnostics;

    /// <summary>Creates the holder over its i18n facade and an optional PII-safe diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every page-tier label resolves through (P1/S10).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public QuietHoursPageViewModel(ILocalizer localizer, QuietHoursPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new QuietHoursPageDiagnostics();
    }

    /// <summary>The localized page title (web <c>notifications.quietHours.title</c>).</summary>
    public string Title => QuietHoursPageRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>notifications.quietHours.subtitle</c>).</summary>
    public string Subtitle => QuietHoursPageRegistration.Subtitle(_localizer);

    /// <summary>The deep link the header's "Copy link" affordance writes to the clipboard (web <c>copyLink</c>).</summary>
    public static string CopyLinkRoute => QuietHoursPageRegistration.Route;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();
}
