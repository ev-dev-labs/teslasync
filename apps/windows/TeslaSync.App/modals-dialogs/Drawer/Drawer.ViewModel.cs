using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Drawer"/> view — the native port of the web
/// <c>Drawer</c> component (web/src/components/ui/Drawer.tsx). The web component is a presentational container
/// with a single piece of state (<c>open</c>) plus presentational props (<c>title</c>, <c>side</c>, and the
/// <c>children</c> / <c>footer</c> slots). This holder owns the open/closed state (web <c>open</c> +
/// <c>onClose</c>), the edge (web <c>side</c>), the title, and the slot-occupancy flags the view reports
/// (<see cref="HasContent"/> / <see cref="HasFooter"/>), and resolves the close label, the dialog accessible
/// name and the empty-body message through the i18n facade. There is deliberately no loading / empty / error /
/// stale / offline data state because the web source performs no read — its branches are open/closed,
/// with/without title, with/without footer and the left/right edge, all reproduced here. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class DrawerViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly DrawerDiagnostics _diagnostics;

    private bool _isOpen;
    private DrawerSide _side;
    private string _title = string.Empty;
    private bool _hasContent;
    private bool _hasFooter;

    /// <summary>Creates the holder over the i18n facade, the initial edge and an optional diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade every string resolves through.</param>
    /// <param name="side">The edge the drawer slides in from (web <c>side</c>; defaults to right).</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public DrawerViewModel(ILocalizer localizer, DrawerSide side = DrawerSide.Right, DrawerDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _side = side;
        _diagnostics = diagnostics ?? new DrawerDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the drawer opens (web <c>open</c> becomes true).</summary>
    public event EventHandler? Opened;

    /// <summary>Raised when the drawer closes / is dismissed (web <c>onClose</c>).</summary>
    public event EventHandler? Closed;

    /// <summary>True while the drawer is open (web <c>open</c>).</summary>
    public bool IsOpen
    {
        get => _isOpen;
        private set => Set(ref _isOpen, value);
    }

    /// <summary>The edge the drawer slides in from (web <c>side</c>).</summary>
    public DrawerSide Side
    {
        get => _side;
        set => Set(ref _side, value);
    }

    /// <summary>The optional drawer title (web <c>title</c>). Editing it re-evaluates the header + accessible name.</summary>
    public string Title
    {
        get => _title;
        set
        {
            if (Set(ref _title, value ?? string.Empty))
            {
                Raise(nameof(HasTitle));
                Raise(nameof(AccessibleName));
            }
        }
    }

    /// <summary>True when a content slot was supplied (web non-empty <c>children</c>); else the empty body renders.</summary>
    public bool HasContent
    {
        get => _hasContent;
        set => Set(ref _hasContent, value);
    }

    /// <summary>True when a footer slot was supplied (web <c>footer</c>): the footer region renders.</summary>
    public bool HasFooter
    {
        get => _hasFooter;
        set => Set(ref _hasFooter, value);
    }

    /// <summary>True when a non-empty title is set (web <c>{title &amp;&amp; ...}</c>): the header renders.</summary>
    public bool HasTitle => DrawerProjection.HasTitle(_title);

    /// <summary>The dialog accessible name (web <c>aria-label={title || 'Panel'}</c>).</summary>
    public string AccessibleName =>
        DrawerProjection.ResolveAccessibleName(_title, DrawerRegistration.PanelLabel(_localizer));

    /// <summary>Close affordance label (web close button <c>aria-label="Close"</c>).</summary>
    public string CloseLabel => DrawerRegistration.CloseLabel(_localizer);

    /// <summary>Friendly empty-body message shown when no content is supplied.</summary>
    public string EmptyMessage => DrawerRegistration.EmptyMessage(_localizer);

    /// <summary>
    /// Open the drawer (web <c>open = true</c>). Idempotent: a second call while open is a no-op. Records the
    /// <c>view.opened</c> diagnostics event and raises <see cref="Opened"/> on the leading edge.
    /// </summary>
    public void Open()
    {
        if (_isOpen)
        {
            return;
        }

        IsOpen = true;
        _diagnostics.RecordViewOpened();
        Opened?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Close the drawer (web <c>onClose</c>). Idempotent: a second call while closed is a no-op. Records the
    /// <c>drawer.closed</c> diagnostics event and raises <see cref="Closed"/> on the leading edge.
    /// </summary>
    public void Close()
    {
        if (!_isOpen)
        {
            return;
        }

        IsOpen = false;
        _diagnostics.RecordClosed();
        Closed?.Invoke(this, EventArgs.Empty);
    }

    private bool Set<T>(ref T field, T value, [CallerMemberName] string? name = null)
    {
        if (EqualityComparer<T>.Default.Equals(field, value))
        {
            return false;
        }

        field = value;
        Raise(name);
        return true;
    }

    private void Raise(string? name) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
