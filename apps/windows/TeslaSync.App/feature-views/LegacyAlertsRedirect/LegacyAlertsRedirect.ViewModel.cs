using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LegacyAlertsRedirect"/> view — the native port
/// of the web <c>LegacyAlertsRedirect</c>'s <c>useLocation</c> + <c>&lt;Navigate&gt;</c> composition
/// (web/src/features/notifications/components/LegacyAlertsRedirect.tsx). It reads the bound
/// <see cref="ILegacyAlertsLocationSource"/>'s current location, resolves the redirect
/// <see cref="Target"/> through <see cref="LegacyAlertsRedirectResolver"/>, and re-resolves whenever the
/// source raises <see cref="ILegacyAlertsLocationSource.Changed"/> (the web hook's re-render). The resolve is
/// synchronous (no network read), so there is a single <see cref="LegacyAlertsRedirectState.Redirecting"/>
/// state — see <see cref="LegacyAlertsRedirectState"/>. Drive it from one confinement (the UI thread); it is
/// not internally synchronised.
/// </summary>
public sealed class LegacyAlertsRedirectViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILegacyAlertsLocationSource _source;
    private readonly ILocalizer _localizer;

    private LegacyAlertsRedirectTarget _target;
    private bool _disposed;

    /// <summary>Creates the holder over its location source and localizer.</summary>
    /// <param name="source">The location state-holder seam (the canonical source or a test fake).</param>
    /// <param name="localizer">The i18n facade the redirecting status label resolves through.</param>
    public LegacyAlertsRedirectViewModel(ILegacyAlertsLocationSource source, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _target = Resolve();

        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The single surface state. The web source performs a synchronous client-side redirect, so the only branch is <see cref="LegacyAlertsRedirectState.Redirecting"/>.</summary>
    public LegacyAlertsRedirectState State { get; } = LegacyAlertsRedirectState.Redirecting;

    /// <summary>The resolved redirect destination (web computed <c>to</c>), re-projected on every location change.</summary>
    public LegacyAlertsRedirectTarget Target
    {
        get => _target;
        private set
        {
            if (_target == value)
            {
                return;
            }

            _target = value;
            Raise(nameof(Target));
            Raise(nameof(DestinationLocation));
        }
    }

    /// <summary>The destination location string the host navigates to (web <c>to</c>, used with <c>replace</c>).</summary>
    public string DestinationLocation => _target.Location;

    /// <summary>
    /// The localized "redirecting" status shown while the host performs the navigation. The web component
    /// renders no visible text (it returns <c>&lt;Navigate&gt;</c>); the native surface must render something,
    /// so this single string flows through the i18n facade and doubles as the Narrator announcement.
    /// </summary>
    public string StatusMessage =>
        _localizer.GetString("notifications.legacyRedirect.status", "Redirecting…");

    /// <summary>The Narrator name for the surface — the same localized status string.</summary>
    public string AutomationName => StatusMessage;

    /// <summary>Re-read the source and re-resolve the destination against the current location.</summary>
    public void Refresh() => Target = Resolve();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private LegacyAlertsRedirectTarget Resolve() =>
        LegacyAlertsRedirectResolver.Resolve(_source.Current.Search);

    private void OnSourceChanged(object? sender, EventArgs e) => Target = Resolve();

    private void Raise(string name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
