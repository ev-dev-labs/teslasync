using System.ComponentModel;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Accordion"/> view — the native port of the web
/// component's open-state logic (<c>web/src/components/ui/Accordion.tsx</c> L43-49). It reproduces the web
/// controlled-or-uncontrolled contract exactly: when both a controlled value and an <c>onOpenChange</c> callback
/// are supplied the parent owns the truth (web <c>isControlled = open !== undefined &amp;&amp; onOpenChange !==
/// undefined</c>) and <see cref="RequestOpen"/> simply notifies it; otherwise the holder owns an internal flag
/// seeded from <c>defaultOpen</c> (web <c>useState(defaultOpen)</c>) and <see cref="RequestOpen"/> mutates it.
/// <see cref="IsOpen"/> resolves the effective state (web <c>open = isControlled ? openProp : internalOpen</c>);
/// <see cref="Toggle"/> flips it (web header <c>onClick={() =&gt; setOpen(!open)}</c>). It is
/// <see cref="INotifyPropertyChanged"/> so the view can re-bind the disclosure when the state changes, and raises
/// <see cref="OpenChanged"/> whenever the effective state settles. The view performs no I/O of its own; it binds
/// to this holder. There is no external data source to dispose — the only inputs are the props.
/// </summary>
public sealed class AccordionViewModel : INotifyPropertyChanged
{
    private readonly Action<bool>? _onOpenChange;
    private bool _internalOpen;
    private bool? _controlledOpen;

    /// <summary>
    /// Creates the holder over the web props. When both <paramref name="controlledOpen"/> and
    /// <paramref name="onOpenChange"/> are supplied the holder is controlled (the parent owns the open state);
    /// otherwise it is uncontrolled and seeds its internal state from <paramref name="defaultOpen"/>.
    /// </summary>
    /// <param name="defaultOpen">The initial open state for the uncontrolled mode (web <c>defaultOpen</c>).</param>
    /// <param name="controlledOpen">The parent-owned open value (web <c>open</c>); null leaves the holder uncontrolled.</param>
    /// <param name="onOpenChange">The parent notification callback (web <c>onOpenChange</c>); null leaves the holder uncontrolled.</param>
    public AccordionViewModel(bool defaultOpen, bool? controlledOpen = null, Action<bool>? onOpenChange = null)
    {
        _internalOpen = defaultOpen;
        _controlledOpen = controlledOpen;
        _onOpenChange = onOpenChange;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised with the new effective open state whenever it settles (both modes).</summary>
    public event EventHandler<bool>? OpenChanged;

    /// <summary>The canonical surface slug (<c>Accordion</c>).</summary>
    public static string Slug => AccordionRegistration.Slug;

    /// <summary>
    /// Whether the holder is controlled (web <c>isControlled</c>): true only when both a controlled value and an
    /// <c>onOpenChange</c> callback were supplied, so the parent owns the open state.
    /// </summary>
    public bool IsControlled => _controlledOpen.HasValue && _onOpenChange is not null;

    /// <summary>The resolved open state (web <c>open = isControlled ? openProp : internalOpen</c>).</summary>
    public bool IsOpen => IsControlled ? _controlledOpen!.Value : _internalOpen;

    /// <summary>
    /// Request the open state to become <paramref name="next"/> (web <c>setOpen</c>). In controlled mode this only
    /// notifies the parent through <c>onOpenChange</c> (the parent then confirms via
    /// <see cref="SyncControlledOpen"/>); in uncontrolled mode it mutates the internal flag and announces the change.
    /// </summary>
    /// <param name="next">The requested open state.</param>
    public void RequestOpen(bool next)
    {
        if (IsControlled)
        {
            // web: `if (isControlled) onOpenChange?.(next)` — the parent owns the source of truth.
            _onOpenChange!(next);
            return;
        }

        // web: `else setInternalOpen(next)`.
        if (_internalOpen == next)
        {
            return;
        }

        _internalOpen = next;
        OnIsOpenChanged();
    }

    /// <summary>Flip the open state (web header <c>onClick={() =&gt; setOpen(!open)}</c>).</summary>
    public void Toggle() => RequestOpen(!IsOpen);

    /// <summary>
    /// Reflect a new parent-owned open value (the controlled-mode follow-up to <see cref="RequestOpen"/>, i.e. the
    /// web parent re-rendering with a new <c>open</c> prop). A no-op in uncontrolled mode, and when the value is
    /// unchanged.
    /// </summary>
    /// <param name="open">The new parent-owned open value (web <c>open</c> prop).</param>
    public void SyncControlledOpen(bool open)
    {
        if (!IsControlled || _controlledOpen == open)
        {
            return;
        }

        _controlledOpen = open;
        OnIsOpenChanged();
    }

    private void OnIsOpenChanged()
    {
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsOpen)));
        OpenChanged?.Invoke(this, IsOpen);
    }
}
