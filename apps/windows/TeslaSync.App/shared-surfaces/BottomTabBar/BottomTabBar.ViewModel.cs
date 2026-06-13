using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BottomTabBar"/> view — the native port of
/// the web <c>BottomTabBar</c> component body (web/src/components/layout/BottomTabBar.tsx). It reproduces
/// the web source's behaviour over its two injected dependencies: the active-location seam
/// (<see cref="INavLocationSource"/>, the web <c>useLocation</c>) and the i18n facade
/// (<see cref="ILocalizer"/>, the web <c>useTranslation</c>, P1/S10), projecting both — together with the
/// fixed tab catalogue (the web <c>TABS</c> constant) — into the render-ready
/// <see cref="BottomTabBarDisplay"/> through the pure <see cref="BottomTabBarProjection"/>. The view binds
/// the projection and never touches the router; a tab activation is echoed to <see cref="TabActivated"/>
/// so the host navigates (the web <c>PrefetchLink</c> click), exactly as the web source delegates routing
/// to the router. It re-projects whenever the location seam reports a path change (the web router emitting
/// a new <c>location</c>) and on <see cref="Reload"/> (a language change re-running every <c>t()</c>).
/// Drive it from one confinement (the UI thread); it is not internally synchronised. Dispose it (or let
/// the view dispose it) to detach from the seam's change event.
/// </summary>
public sealed class BottomTabBarViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly ILocalizer _localizer;
    private readonly INavLocationSource _location;
    private readonly IReadOnlyList<BottomTab> _tabs;
    private bool _disposed;

    /// <summary>Creates the holder over the i18n facade, the tab catalogue and the active-location seam.</summary>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation</c>, P1/S10).</param>
    /// <param name="tabs">The tab catalogue (web <c>TABS</c>); defaults to <see cref="BottomTabBarCatalog.Default"/>.</param>
    /// <param name="location">The active-location seam (web <c>useLocation</c>, P1/S8); defaults to an in-memory source at "/".</param>
    public BottomTabBarViewModel(
        ILocalizer localizer,
        IReadOnlyList<BottomTab>? tabs = null,
        INavLocationSource? location = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _tabs = tabs ?? BottomTabBarCatalog.Default;
        _location = location ?? new InMemoryNavLocationSource();
        _location.PathChanged += OnLocationChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a tab is activated (web <c>PrefetchLink</c> click) — the host navigates to the route.</summary>
    public event EventHandler<string>? TabActivated;

    /// <summary>The live route path used for highlighting — the web <c>location.pathname</c>.</summary>
    public string EffectivePath => BottomTabBarProjection.Normalize(_location.CurrentPath);

    /// <summary>
    /// The render-ready projection of the catalogue against the current path and language — recomputed on
    /// each read so it always reflects the latest location and i18n state. The projection is cheap (five
    /// tabs), so the view reads it on each rebuild and tests read it directly.
    /// </summary>
    public BottomTabBarDisplay Display =>
        BottomTabBarProjection.Project(_tabs, _location.CurrentPath, _localizer);

    /// <summary>
    /// Activate a tab (web <c>PrefetchLink</c> navigation): echo the route to <see cref="TabActivated"/> so
    /// the host navigates. The active highlight follows once the location seam reports the new path, exactly
    /// as the web bar re-highlights after the router updates <c>location</c>.
    /// </summary>
    public void SelectTab(string path)
    {
        ArgumentNullException.ThrowIfNull(path);
        TabActivated?.Invoke(this, path);
    }

    /// <summary>Re-resolve every label and re-project — the native analogue of react-i18next re-rendering after a language change.</summary>
    public void Reload() => RaiseAll();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _location.PathChanged -= OnLocationChanged;
    }

    private void OnLocationChanged(object? sender, EventArgs e) => RaiseAll();

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
