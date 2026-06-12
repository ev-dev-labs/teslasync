using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="ContextMenuRoot"/> view — the native port of the
/// web <c>ContextMenuRoot</c> + <c>ContextMenuView</c> body (web/src/components/ui/ContextMenu.tsx L227-L477).
/// The web root binds the module store with <c>useSyncExternalStore(subscribe, getSnapshot)</c> and renders
/// the menu when the snapshot is non-null; this holder reproduces that over an injected
/// <see cref="IContextMenuController"/> (the P1/S8 seam): it subscribes on construction, projects the current
/// snapshot as <see cref="Current"/> / <see cref="IsOpen"/>, raises <see cref="INotifyPropertyChanged"/> plus a
/// <see cref="SnapshotChanged"/> pulse on every store emit (so a re-open with identical data still re-shows —
/// the web <c>nonce</c>), resolves the menu's single accessible name through the i18n facade
/// (<see cref="MenuLabel"/> = web <c>t('contextMenu.menuLabel', 'Context menu')</c>), and on
/// <see cref="Invoke"/> reproduces the web <c>invoke</c>: a disabled item is ignored, otherwise the menu is
/// closed first and the item's action runs afterwards, guarded so a throwing handler never breaks the menu
/// lifecycle. It unsubscribes on <see cref="Dispose"/> (the web effect cleanup). It raises its notifications on
/// whichever thread the store fans out on; marshalling onto the UI thread is the mounted view's responsibility,
/// mirroring how the web component's re-render is reconciled by React rather than by the store.
/// </summary>
public sealed class ContextMenuRootViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IContextMenuController _controller;
    private readonly ILocalizer _localizer;
    private readonly IDisposable _subscription;
    private ContextMenuSnapshot? _current;
    private bool _disposed;

    /// <summary>
    /// Creates the holder over its store seam and the i18n facade, seeding from the store's current snapshot
    /// and subscribing to it (the web root's <c>useSyncExternalStore(subscribe, getSnapshot, getSnapshot)</c>).
    /// </summary>
    /// <param name="controller">The context-menu store (web module store); the holder never opens it, only closes.</param>
    /// <param name="localizer">The i18n facade the menu's accessible name resolves through.</param>
    public ContextMenuRootViewModel(IContextMenuController controller, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(controller);
        ArgumentNullException.ThrowIfNull(localizer);

        _controller = controller;
        _localizer = localizer;
        _current = controller.Current;
        _subscription = controller.Subscribe(OnStoreChanged);
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>
    /// Raised once per store emit (open, re-open or close) with the new snapshot, so the mounted view can
    /// imperatively (re)show or hide the flyout even when a re-open carries identical items / coordinates
    /// (the web <c>nonce</c>-driven re-render). The argument is the snapshot, or <see langword="null"/> on close.
    /// </summary>
    public event EventHandler<ContextMenuSnapshot?>? SnapshotChanged;

    /// <summary>The open menu, or <see langword="null"/> when closed (web snapshot from <c>useSyncExternalStore</c>).</summary>
    public ContextMenuSnapshot? Current => _current;

    /// <summary>Whether the menu is open (web <c>if (!snapshot) return null;</c> — render only when open).</summary>
    public bool IsOpen => _current is not null;

    /// <summary>
    /// The menu's accessible name (web <c>role="menu" aria-label={t('contextMenu.menuLabel', 'Context menu')}</c>).
    /// Constant for the surface's lifetime, so it is resolved on demand rather than raised as a change.
    /// </summary>
    public string MenuLabel =>
        _localizer.GetString(ContextMenuRegistration.MenuLabelKey, ContextMenuRegistration.MenuLabelFallback);

    /// <summary>
    /// Activate an item — the native port of the web <c>invoke</c> (web L389-L402). A disabled item is ignored
    /// (web <c>if (item.disabled) return;</c>); otherwise the menu is closed first (web <c>closeContextMenu()</c>)
    /// and the item's action runs afterwards, guarded so a throwing handler never breaks the menu lifecycle
    /// (web wraps <c>item.onClick()</c> in try/catch). Closing before running mirrors the web ordering so a
    /// navigation or re-render the action triggers sees the menu already torn down.
    /// </summary>
    /// <param name="item">The item the user activated.</param>
    public void Invoke(ContextMenuItem item)
    {
        ArgumentNullException.ThrowIfNull(item);

        if (item.IsDisabled)
        {
            return;
        }

        _controller.Close();

        try
        {
            item.OnSelected?.Invoke();
        }
        catch (Exception)
        {
            // web: the handler is wrapped in try/catch so an unexpected throw is surfaced but never breaks the
            // menu lifecycle. The menu is already closed, so the failed action is simply contained here.
        }
    }

    /// <summary>Close the menu (web <c>close()</c> from <c>useContextMenu()</c>).</summary>
    public void Close() => _controller.Close();

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;

        // web effect cleanup: the returned unsubscribe runs on unmount.
        _subscription.Dispose();
        GC.SuppressFinalize(this);
    }

    private void OnStoreChanged(ContextMenuSnapshot? snapshot)
    {
        bool wasOpen = _current is not null;
        _current = snapshot;

        Raise(nameof(Current));
        if (wasOpen != (snapshot is not null))
        {
            Raise(nameof(IsOpen));
        }

        SnapshotChanged?.Invoke(this, snapshot);
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
