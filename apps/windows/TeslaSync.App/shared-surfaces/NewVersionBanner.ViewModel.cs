using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="NewVersionBanner"/> view — the native port of the web
/// <c>NewVersionBanner</c> body (web/src/components/feedback/NewVersionBanner.tsx L27-91). It binds the P1/S8
/// <see cref="IVersionWatcherSource"/> (the web <c>useVersionWatcher()</c> read) and the
/// <see cref="IVersionDismissalStore"/> (the web per-version <c>sessionStorage</c> flag), recomputes the pure
/// <see cref="NewVersionBannerProjection"/> whenever either moves, and raises <see cref="PropertyChanged"/> so the
/// view shows / hides the banner. <see cref="DismissForCurrentVersion"/> defers the current version (web
/// <c>handleLater</c>), which collapses the banner and keeps it hidden until a newer version arrives.
/// <see cref="RequestReload"/> raises <see cref="ReloadRequested"/> so the view can apply the update (web
/// <c>handleReload</c> → <c>window.location.reload()</c>; the platform restart is a view concern). <see cref="Dispose"/>
/// unsubscribes from both seams (the web effect cleanup).
/// </summary>
public sealed class NewVersionBannerViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ILocalizer _localizer;
    private readonly IVersionWatcherSource _source;
    private readonly IVersionDismissalStore _dismissalStore;
    private NewVersionBannerProjection _projection;
    private bool _disposed;

    /// <summary>Creates the holder over its i18n facade, version-watcher seam, and dismissal seam (P1/S8).</summary>
    /// <param name="localizer">The i18n facade the message / action strings resolve through.</param>
    /// <param name="source">The deploy-version-watcher seam (web <c>useVersionWatcher()</c>).</param>
    /// <param name="dismissalStore">The per-version dismissal seam (web <c>sessionStorage</c> flag).</param>
    public NewVersionBannerViewModel(
        ILocalizer localizer,
        IVersionWatcherSource source,
        IVersionDismissalStore dismissalStore)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(dismissalStore);

        _localizer = localizer;
        _source = source;
        _dismissalStore = dismissalStore;

        _projection = Compute();
        _source.Changed += OnSeamChanged;
        _dismissalStore.Changed += OnSeamChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the user asks to apply the update (web <c>handleReload</c>); the view performs the restart.</summary>
    public event EventHandler? ReloadRequested;

    /// <summary>The canonical surface slug (<c>NewVersionBanner</c>).</summary>
    public static string Slug => NewVersionBannerRegistration.Slug;

    /// <summary>The current render projection (visibility + message + action labels + live setting).</summary>
    public NewVersionBannerProjection Projection => _projection;

    /// <summary>Whether the banner is shown (web <c>newVersionAvailable &amp;&amp; dismissedVersion !== latestVersion</c>).</summary>
    public bool IsVisible => _projection.IsVisible;

    /// <summary>The localized banner message (web <c>app.newVersion.message</c>).</summary>
    public string Message => _projection.Message;

    /// <summary>The localized "Later" defer action label (web <c>app.newVersion.later</c>).</summary>
    public string LaterLabel => _projection.LaterLabel;

    /// <summary>The localized "Reload" apply action label (web <c>app.newVersion.reload</c>).</summary>
    public string ReloadLabel => _projection.ReloadLabel;

    /// <summary>The accessible name the polite status region announces (the message).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>The version a "Later" click defers (web <c>latestVersion</c>), or null when none is known.</summary>
    public string? LatestVersion => _projection.LatestVersion;

    /// <summary>
    /// Defer the current version (web <c>handleLater</c> → <c>sessionStorage.setItem(KEY, latestVersion)</c> +
    /// <c>setDismissedVersion(latestVersion)</c>): persists the deferral through the store, which reprojects and
    /// collapses the banner. A no-op when there is no known latest version (the web guard <c>if (latestVersion)</c>).
    /// </summary>
    public void DismissForCurrentVersion()
    {
        if (_disposed)
        {
            return;
        }

        var latest = _source.LatestVersion;
        if (string.IsNullOrEmpty(latest))
        {
            return;
        }

        _dismissalStore.Dismiss(latest);
    }

    /// <summary>
    /// Ask the host to apply the update (web <c>handleReload</c> → <c>window.location.reload()</c>) by raising
    /// <see cref="ReloadRequested"/>; the actual process restart is performed by the view layer.
    /// </summary>
    public void RequestReload()
    {
        if (_disposed)
        {
            return;
        }

        ReloadRequested?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSeamChanged;
        _dismissalStore.Changed -= OnSeamChanged;
        GC.SuppressFinalize(this);
    }

    private NewVersionBannerProjection Compute() =>
        NewVersionBannerProjection.Project(
            _source.BootVersion,
            _source.LatestVersion,
            _dismissalStore.DismissedVersion,
            _localizer);

    private void OnSeamChanged(object? sender, EventArgs e) => Reproject();

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
