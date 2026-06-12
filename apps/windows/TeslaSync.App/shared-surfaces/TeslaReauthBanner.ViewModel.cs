using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="TeslaReauthBanner"/> view — the native port of the web
/// <c>TeslaReauthBanner</c> body (web/src/components/feedback/TeslaReauthBanner.tsx L36-100). It binds the i18n
/// facade (P1/S10), the <see cref="ITeslaAuthRecoverySource"/> (the P1/S8 recovery seam, the web document-event
/// listeners + <c>teslaAuthRecovery</c> module) and the <see cref="ITeslaReauthNavigator"/> (the P1/S8 navigation
/// seam, the web <c>useNavigate()</c> hook). It mirrors the web's single <c>visible</c> state machine: it shows the
/// banner on <see cref="ITeslaAuthRecoverySource.Expired"/> (web <c>setVisible(true)</c>), and on
/// <see cref="ITeslaAuthRecoverySource.Recovered"/> it hides the banner and replays the queued mutations (web
/// <c>setVisible(false)</c> + <c>void drainQueuedTeslaMutations()</c>). <see cref="Dismiss"/> hides the banner
/// without resolving the expiry (web <c>handleDismiss</c>) — a subsequent expiry re-shows it. <see cref="Reconnect"/>
/// deep-links to the Tesla-account page through the navigator (web <c>handleReconnect</c> →
/// <c>navigate('/tesla-account')</c>). It recomputes the pure <see cref="TeslaReauthBannerProjection"/> whenever the
/// visibility moves and raises <see cref="PropertyChanged"/> so the view shows / hides. The initial visibility is
/// snapshotted from <see cref="ITeslaAuthRecoverySource.IsExpired"/> so a banner mounted after an expiry already
/// happened still surfaces. <see cref="Dispose"/> unsubscribes from both recovery edges (the web effect cleanup).
/// The view performs no I/O and navigates nothing itself.
/// </summary>
public sealed class TeslaReauthBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly ITeslaAuthRecoverySource _source;
    private readonly ITeslaReauthNavigator _navigator;
    private TeslaReauthBannerProjection _projection;
    private bool _visible;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, recovery seam and navigation seam (P1/S8 / P1/S10).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="source">The Tesla-auth-recovery seam (web document events + <c>teslaAuthRecovery</c>).</param>
    /// <param name="navigator">The navigation seam the "Reconnect" CTA invokes (web <c>useNavigate()</c>).</param>
    public TeslaReauthBannerViewModel(
        ILocalizer localizer,
        ITeslaAuthRecoverySource source,
        ITeslaReauthNavigator navigator)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);

        _localizer = localizer;
        _source = source;
        _navigator = navigator;

        _visible = source.IsExpired;
        _projection = Compute();
        _source.Expired += OnExpired;
        _source.Recovered += OnRecovered;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>TeslaReauthBanner</c>).</summary>
    public static string Slug => TeslaReauthBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + title + body + action labels + live setting + name).</summary>
    public TeslaReauthBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>visible</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized banner title (web <c>tesla.reauth.title</c>).</summary>
    public string Title => _projection.Title;

    /// <summary>The localized banner body (web <c>tesla.reauth.body</c>).</summary>
    public string Body => _projection.Body;

    /// <summary>The localized "Reconnect" CTA label (web <c>tesla.reauth.cta</c>).</summary>
    public string ReconnectLabel => _projection.ReconnectLabel;

    /// <summary>The localized "Dismiss" control label (web <c>common.dismiss</c>).</summary>
    public string DismissLabel => _projection.DismissLabel;

    /// <summary>The accessible name the assertive alert region announces (title + body).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// The in-flight recovery drain task started by the most recent <see cref="ITeslaAuthRecoverySource.Recovered"/>
    /// signal (web <c>void drainQueuedTeslaMutations()</c>), or null if no recovery has occurred. Exposed so hosts
    /// and tests can observe the otherwise fire-and-forget replay; the banner itself never awaits it.
    /// </summary>
    internal Task? PendingDrain { get; private set; }

    /// <summary>
    /// Deep-link to the Tesla-account page so the user can re-authorize (web <c>handleReconnect</c> →
    /// <c>navigate('/tesla-account')</c>) by dispatching to the navigation seam.
    /// </summary>
    public void Reconnect()
    {
        if (_disposed)
        {
            return;
        }

        _navigator.NavigateToTeslaAccount();
    }

    /// <summary>
    /// Hide the banner without resolving the expiry (web <c>handleDismiss</c> → <c>setVisible(false)</c>). The Tesla
    /// token is still expired, so a subsequent expiry signal re-shows the banner.
    /// </summary>
    public void Dismiss()
    {
        if (_disposed)
        {
            return;
        }

        SetVisible(false);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Expired -= OnExpired;
        _source.Recovered -= OnRecovered;
        GC.SuppressFinalize(this);
    }

    private TeslaReauthBannerProjection Compute() => TeslaReauthBannerProjection.Project(_visible, _localizer);

    private void OnExpired(object? sender, EventArgs e) => SetVisible(true);

    private void OnRecovered(object? sender, EventArgs e)
    {
        if (_disposed)
        {
            return;
        }

        // web onRecovered: hide the banner, then best-effort replay the queued mutations (fire-and-forget — errors
        // surface via each mutation's own error path). The drain is always triggered, even if the banner was
        // already hidden, exactly like the web listener.
        SetVisible(false);
        PendingDrain = DrainAsync();
    }

    private async Task DrainAsync()
    {
        try
        {
            await _source.DrainQueuedMutationsAsync().ConfigureAwait(false);
        }
        catch (Exception)
        {
            // Best-effort replay; each mutation surfaces its own failure through its normal error path.
        }
    }

    private void SetVisible(bool visible)
    {
        if (_disposed || _visible == visible)
        {
            return;
        }

        _visible = visible;
        Reproject();
    }

    private void Reproject()
    {
        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
