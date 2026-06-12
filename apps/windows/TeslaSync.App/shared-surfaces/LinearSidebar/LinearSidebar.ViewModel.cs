using System.Collections.Generic;
using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="LinearSidebar"/> view — the native port of the web
/// <c>LinearSidebar</c> component body (web/src/components/layout/sidebar/LinearSidebar.tsx). It reproduces the
/// web source's behaviour over the injected seams — the active-location source (<see cref="INavLocationSource"/>,
/// the web <c>useLocation</c> fallback), the pinned-pages store (<see cref="IPinnedPagesStore"/>, the web
/// <c>pinnedItems</c> source + <c>onPin</c> / <c>onUnpin</c>), the label resolver (the web <c>navLabel</c> prop)
/// and the i18n facade (<see cref="ILocalizer"/>, P1/S10): the per-section collapse set seeded to "everything
/// except the active section" at construction and auto-expanded when the active section changes (web
/// <c>useState</c> initializer + <c>useEffect</c>); the tree filter (web <c>filter</c> state) whose active
/// state auto-expands every matching section; pin / unpin routed through the store; and the controlled active
/// path (the web <c>pathname</c> prop) layered over the live location. It recomputes the render-ready
/// <see cref="Display"/> on demand through the pure <see cref="LinearSidebarProjection"/>; the view binds the
/// projected state and never touches the router or the pin store directly. Drive it from one confinement (the
/// UI thread); it is not internally synchronised. Dispose it (or let the view dispose it) to detach from the
/// seams' change events.
/// </summary>
public sealed class LinearSidebarViewModel : INotifyPropertyChanged, IDisposable
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly ILocalizer _localizer;
    private readonly INavLocationSource _location;
    private readonly IPinnedPagesStore _pinned;
    private readonly Func<string, string> _navLabel;
    private readonly HashSet<string> _collapsed = new(StringComparer.Ordinal);

    private IReadOnlyList<LinearNavSection> _sections;
    private string _filter = string.Empty;
    private string? _pathnameOverride;
    private string? _activeSectionTitle;
    private int _alertCount;
    private int _vehicleCount;
    private int _staleCount;
    private bool _disposed;

    /// <summary>Creates the holder over the i18n facade, the seams, the label resolver and the initial props.</summary>
    /// <param name="localizer">The i18n facade every surface-owned label resolves through (web <c>useTranslation</c>, P1/S10).</param>
    /// <param name="sections">The initial section catalogue (web <c>sections</c> prop); defaults to empty.</param>
    /// <param name="pinnedStore">The pinned-pages seam (web <c>pinnedItems</c> + <c>onPin</c> / <c>onUnpin</c>, P1/S8); defaults to in-memory.</param>
    /// <param name="location">The active-location seam (web <c>useLocation</c>, P1/S8); defaults to an in-memory source at "/".</param>
    /// <param name="navLabel">The label resolver (web <c>navLabel</c> prop); null is treated as identity.</param>
    /// <param name="activeSectionTitle">The title of the section containing the active page (web <c>activeSectionTitle</c> prop).</param>
    /// <param name="alertCount">The unread alert count (web <c>alertCount</c> prop).</param>
    /// <param name="vehicleCount">The vehicle count (web <c>vehicleCount</c> prop).</param>
    /// <param name="staleCount">The stale-rows count (web <c>staleCount</c> prop).</param>
    public LinearSidebarViewModel(
        ILocalizer localizer,
        IReadOnlyList<LinearNavSection>? sections = null,
        IPinnedPagesStore? pinnedStore = null,
        INavLocationSource? location = null,
        Func<string, string>? navLabel = null,
        string? activeSectionTitle = null,
        int alertCount = 0,
        int vehicleCount = 0,
        int staleCount = 0)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _sections = sections ?? Array.Empty<LinearNavSection>();
        _pinned = pinnedStore ?? new InMemoryPinnedPagesStore();
        _location = location ?? new InMemoryNavLocationSource();
        _navLabel = navLabel ?? (static s => s);
        _activeSectionTitle = activeSectionTitle;
        _alertCount = alertCount;
        _vehicleCount = vehicleCount;
        _staleCount = staleCount;

        SeedCollapsed();
        _location.PathChanged += OnSeamChanged;
        _pinned.Changed += OnSeamChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when a row is activated (web <c>onItemSelect</c>) — the host navigates + closes the mobile drawer.</summary>
    public event EventHandler<string>? ItemSelected;

    /// <summary>The active path used for highlighting — the web <c>effectivePath</c> (<c>pathname ?? location.pathname</c>).</summary>
    public string EffectivePath => _pathnameOverride ?? _location.CurrentPath;

    /// <summary>The current tree filter (web <c>filter</c> state).</summary>
    public string Filter => _filter;

    /// <summary>The title of the section that currently contains the active page (web <c>activeSectionTitle</c> prop).</summary>
    public string? ActiveSectionTitle => _activeSectionTitle;

    /// <summary>
    /// The render-ready projection of the current inputs — recomputed on each read so it always reflects the
    /// latest sections, pins, active path, collapse set, filter and counts. The projection is cheap (a filter +
    /// group over a bounded tree), so the view reads it on each rebuild and tests read it directly.
    /// </summary>
    public LinearSidebarDisplay Display => LinearSidebarProjection.Project(
        _sections,
        _pinned.Pinned,
        EffectivePath,
        _navLabel,
        _collapsed,
        _filter,
        _alertCount,
        _vehicleCount,
        _staleCount,
        _localizer);

    /// <summary>The effective expanded state of a section — the web <c>isExpanded(title)</c> (filter forces open).</summary>
    public bool IsSectionExpanded(string title)
    {
        ArgumentNullException.ThrowIfNull(title);
        return LinearSidebarProjection.Tokenize(_filter).Count > 0 || !_collapsed.Contains(title);
    }

    /// <summary>
    /// Toggle a section's collapse — the web <c>toggleSection</c>. A no-op effect while a filter is active (the
    /// projection forces every matching section open), but the underlying collapse choice is still recorded so
    /// it is honoured once the filter clears.
    /// </summary>
    public void ToggleSection(string title)
    {
        ArgumentNullException.ThrowIfNull(title);
        if (!_collapsed.Remove(title))
        {
            _collapsed.Add(title);
        }

        RaiseAll();
    }

    /// <summary>Set the tree filter (web <c>setFilter</c>); a no-op when unchanged.</summary>
    public void SetFilter(string? text)
    {
        string next = text ?? string.Empty;
        if (string.Equals(_filter, next, StringComparison.Ordinal))
        {
            return;
        }

        _filter = next;
        RaiseAll();
    }

    /// <summary>Clear the tree filter — the web "Clear filter" button's <c>setFilter('')</c>.</summary>
    public void ClearFilter() => SetFilter(string.Empty);

    /// <summary>Pin a route to favorites through the store (web <c>onPin</c>).</summary>
    public void Pin(string to)
    {
        ArgumentNullException.ThrowIfNull(to);
        _pinned.Pin(to);
    }

    /// <summary>Unpin a route from favorites through the store (web <c>onUnpin</c>).</summary>
    public void Unpin(string to)
    {
        ArgumentNullException.ThrowIfNull(to);
        _pinned.Unpin(to);
    }

    /// <summary>Activate a row (web <c>onItemSelect</c>): echo the route to <see cref="ItemSelected"/> so the host navigates.</summary>
    public void SelectItem(string to)
    {
        ArgumentNullException.ThrowIfNull(to);
        ItemSelected?.Invoke(this, to);
    }

    /// <summary>
    /// Replace the section catalogue (the web <c>sections</c> prop changing). The collapse set is preserved
    /// (the web seeds it once via the <c>useState</c> initializer and never re-seeds), so existing expand /
    /// collapse choices survive a refresh and any brand-new section defaults to expanded.
    /// </summary>
    public void SetSections(IReadOnlyList<LinearNavSection> sections)
    {
        ArgumentNullException.ThrowIfNull(sections);
        _sections = sections;
        RaiseAll();
    }

    /// <summary>
    /// Set the active section (the web <c>activeSectionTitle</c> prop changing) and auto-expand it if collapsed
    /// — the web <c>useEffect([activeSectionTitle])</c>.
    /// </summary>
    public void SetActiveSectionTitle(string? title)
    {
        _activeSectionTitle = title;
        if (!string.IsNullOrEmpty(title))
        {
            _collapsed.Remove(title);
        }

        RaiseAll();
    }

    /// <summary>Set the controlled active path (the web <c>pathname</c> prop); null falls back to the live location.</summary>
    public void SetPathname(string? pathname)
    {
        _pathnameOverride = pathname;
        RaiseAll();
    }

    /// <summary>Update the trailing-badge counts (web <c>alertCount</c> / <c>vehicleCount</c> / <c>staleCount</c> props).</summary>
    public void SetCounts(int alertCount, int vehicleCount, int staleCount)
    {
        _alertCount = alertCount;
        _vehicleCount = vehicleCount;
        _staleCount = staleCount;
        RaiseAll();
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
        _location.PathChanged -= OnSeamChanged;
        _pinned.Changed -= OnSeamChanged;
    }

    private void SeedCollapsed()
    {
        _collapsed.Clear();
        foreach (LinearNavSection section in _sections)
        {
            if (!string.Equals(section.Title, _activeSectionTitle, StringComparison.Ordinal))
            {
                _collapsed.Add(section.Title);
            }
        }
    }

    private void OnSeamChanged(object? sender, EventArgs e) => RaiseAll();

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
