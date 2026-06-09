using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="QuickNavWidget"/> view — the native port of
/// the web <c>QuickNav</c> component (web/src/features/dashboard/components/QuickNav.tsx, wrapped by
/// web/src/features/dashboard/widgets/QuickNavWidget.tsx). It projects the canonical
/// <see cref="IQuickNavItemSource"/> through <see cref="QuickNavProjection"/> at the active footprint and
/// exposes the resulting <see cref="Display"/> plus the mutually-exclusive <see cref="State"/> so the view
/// is a thin renderer. The surface is presentational — there is no asynchronous load — so projection is
/// synchronous; reassigning <see cref="Size"/> re-projects for the new layout. <see cref="Navigate(string)"/>
/// forwards to the injected <see cref="IQuickNavNavigator"/> (the web <c>Link</c> click). Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class QuickNavViewModel : INotifyPropertyChanged
{
    private readonly IQuickNavItemSource _source;
    private readonly IQuickNavNavigator _navigator;
    private readonly ILocalizer _localizer;

    private QuickNavSize _size;
    private QuickNavDisplay _display;
    private QuickNavState _state;

    /// <summary>Creates the holder over its item source, navigator, localizer and footprint.</summary>
    /// <param name="source">The navigation entry source (the canonical catalog).</param>
    /// <param name="navigator">The outbound navigation seam a tile activation drives.</param>
    /// <param name="localizer">The i18n facade resolving every label.</param>
    /// <param name="size">The widget footprint (drives the responsive column count).</param>
    public QuickNavViewModel(
        IQuickNavItemSource source,
        IQuickNavNavigator navigator,
        ILocalizer localizer,
        QuickNavSize size)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(navigator);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _navigator = navigator;
        _localizer = localizer;
        _size = size;
        _display = QuickNavProjection.Project(source.GetItems(), size, localizer);
        _state = _display.Tiles.Count > 0 ? QuickNavState.Ready : QuickNavState.Empty;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The current mutually-exclusive surface state.</summary>
    public QuickNavState State
    {
        get => _state;
        private set => Set(ref _state, value);
    }

    /// <summary>The projected, render-ready tiles + column count.</summary>
    public QuickNavDisplay Display
    {
        get => _display;
        private set
        {
            _display = value;
            Raise(nameof(Display));
            Raise(nameof(HasTiles));
        }
    }

    /// <summary>True when at least one tile resolved (web grid renders) — false drives the empty surface.</summary>
    public bool HasTiles => _display.Tiles.Count > 0;

    /// <summary>Localized widget title (web registry "Quick Navigation").</summary>
    public string Title => QuickNavRegistration.Name(_localizer);

    /// <summary>Localized empty-state message shown when no tiles resolved.</summary>
    public string EmptyMessage =>
        _localizer.GetString("widget.quickNav.noData", "No navigation links available");

    /// <summary>The widget footprint; reassigning re-projects the tiles for the new column count.</summary>
    public QuickNavSize Size
    {
        get => _size;
        set
        {
            if (_size == value)
            {
                return;
            }

            _size = value;
            Raise(nameof(Size));
            Reproject();
        }
    }

    /// <summary>
    /// Navigate to <paramref name="routeName"/> through the injected navigator (the web <c>Link</c> click).
    /// </summary>
    public void Navigate(string routeName)
    {
        ArgumentException.ThrowIfNullOrEmpty(routeName);
        _navigator.Navigate(routeName);
    }

    private void Reproject()
    {
        Display = QuickNavProjection.Project(_source.GetItems(), _size, _localizer);
        State = _display.Tiles.Count > 0 ? QuickNavState.Ready : QuickNavState.Empty;
    }

    private void Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return;
        }

        field = value;
        Raise(name);
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
