using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Settings;

/// <summary>
/// UI-thread-free state holder backing the WinUI <c>PrivacyPage</c> view — the native port of the web page's
/// thin composition (web/src/features/settings/pages/PrivacyPage.tsx). The web page renders no data of its own:
/// it sets the page title + subtitle and hosts the <c>PrivacySection</c> (which owns the recent-pages clearer,
/// the cookie-consent grant / withdraw / reset controls and the deployment-wide consent-requirement read). So
/// this holder is presentation-only — it exposes the two localized page-tier strings the page header binds (web
/// <c>account.privacy.title</c> / <c>account.privacy.subtitle</c>) and records the PII-safe <c>view.opened</c>
/// event. It performs no I/O and reads no query itself; the hosted section's own view-model drives the
/// requirement lifecycle.
/// </summary>
public sealed class PrivacyPageViewModel
{
    private readonly ILocalizer _localizer;
    private readonly PrivacyPageDiagnostics _diagnostics;

    /// <summary>Creates the holder over its i18n facade and an optional PII-safe diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every page-tier label resolves through (P1/S10).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink for the <c>view.opened</c> event.</param>
    public PrivacyPageViewModel(ILocalizer localizer, PrivacyPageDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new PrivacyPageDiagnostics();
    }

    /// <summary>The localized page title (web <c>account.privacy.title</c>).</summary>
    public string Title => PrivacyPageRegistration.Title(_localizer);

    /// <summary>The localized page subtitle (web <c>account.privacy.subtitle</c>).</summary>
    public string Subtitle => PrivacyPageRegistration.Subtitle(_localizer);

    /// <summary>The deep link the header's "Copy link" affordance writes to the clipboard (web <c>copyLink</c>).</summary>
    public static string CopyLinkRoute => PrivacyPageRegistration.Route;

    /// <summary>Record that the surface was opened (PII-safe diagnostics).</summary>
    public void NotifyOpened() => _diagnostics.RecordViewOpened();
}
