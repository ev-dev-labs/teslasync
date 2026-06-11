using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="CookieConsentBanner"/> view — the native port of the
/// web <c>CookieConsentBanner</c> body (web/src/components/feedback/CookieConsentBanner.tsx L62-218). It binds the
/// P1/S8 <see cref="ICookieConsentRequirementSource"/> (the web <c>useVersionInfo()</c> flag) and
/// <see cref="ICookieConsentStore"/> (the web <c>getConsent</c> / <c>subscribeConsent</c> storage helper), holds
/// the <c>showDetails</c> toggle state, recomputes the pure <see cref="CookieConsentBannerProjection"/> whenever a
/// source moves or the toggle flips, and raises <see cref="PropertyChanged"/> so the view re-renders.
/// <see cref="Accept"/> / <see cref="Decline"/> persist the decision through the store (the web
/// <c>handleAccept</c> / <c>handleDecline</c>), which re-renders the banner away. <see cref="IsReportingAllowed"/>
/// exposes the consent gate the host wires its optional reporters through (the web
/// <c>setVitalsConsentRequirement</c> / <c>setErrorReporterConsentRequirement</c> effect).
/// <see cref="Dispose"/> unsubscribes from both sources (the web effect cleanup). The view performs no I/O of its
/// own; the show/hide animation and its reduce-motion handling are a view concern.
/// </summary>
public sealed class CookieConsentBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ICookieConsentRequirementSource _requirement;
    private readonly ICookieConsentStore _store;
    private CookieConsentState _consent;
    private bool _showDetails;
    private CookieConsentBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade and the two P1/S8 seams.</summary>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="requirement">The deployment consent-requirement seam (web <c>useVersionInfo()</c>).</param>
    /// <param name="store">The consent-decision storage seam (web <c>cookieConsent</c> helper).</param>
    public CookieConsentBannerViewModel(
        ILocalizer localizer,
        ICookieConsentRequirementSource requirement,
        ICookieConsentStore store)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(requirement);
        ArgumentNullException.ThrowIfNull(store);

        _localizer = localizer;
        _requirement = requirement;
        _store = store;

        _consent = store.GetConsent();
        _projection = Compute();

        _requirement.Changed += OnRequirementChanged;
        _store.Changed += OnStoreChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>CookieConsentBanner</c>).</summary>
    public static string Slug => CookieConsentBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + localized strings + details state).</summary>
    public CookieConsentBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>requireConsent &amp;&amp; consent === 'unknown'</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>Whether consent collection is required for this deployment (web <c>requireConsent</c>).</summary>
    public bool RequireConsent => _requirement.RequireConsent;

    /// <summary>The user's current stored decision (web <c>consent</c>).</summary>
    public CookieConsentState Consent => _consent;

    /// <summary>Whether the inline category details block is expanded (web <c>showDetails</c>).</summary>
    public bool ShowDetails => _showDetails;

    /// <summary>
    /// Whether optional client-side reporting is allowed under the current consent state — the web
    /// <c>isReportingAllowed</c> gate the host wires its vitals / error reporters through.
    /// </summary>
    public bool IsReportingAllowed =>
        CookieConsentBannerRegistration.IsReportingAllowed(_requirement.RequireConsent, _consent);

    /// <summary>Toggle the inline category details block (web <c>setShowDetails((v) =&gt; !v)</c>).</summary>
    public void ToggleDetails()
    {
        if (_disposed)
        {
            return;
        }

        _showDetails = !_showDetails;
        Reproject();
    }

    /// <summary>Persist an "accepted" decision (web <c>handleAccept</c>); the banner re-renders away.</summary>
    public void Accept()
    {
        if (_disposed)
        {
            return;
        }

        _store.SetConsent(CookieConsentState.Accepted);
    }

    /// <summary>Persist a "declined" decision (web <c>handleDecline</c>); the banner re-renders away.</summary>
    public void Decline()
    {
        if (_disposed)
        {
            return;
        }

        _store.SetConsent(CookieConsentState.Declined);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _requirement.Changed -= OnRequirementChanged;
        _store.Changed -= OnStoreChanged;
        GC.SuppressFinalize(this);
    }

    private CookieConsentBannerProjection Compute() =>
        CookieConsentBannerProjection.Project(_requirement.RequireConsent, _consent, _showDetails, _localizer);

    private void OnRequirementChanged(object? sender, EventArgs e) => Reproject();

    private void OnStoreChanged(object? sender, EventArgs e)
    {
        // Re-read the authoritative decision (the web subscribeConsent callback re-reads getConsent()).
        _consent = _store.GetConsent();
        Reproject();
    }

    private void Reproject()
    {
        if (_disposed)
        {
            return;
        }

        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
