using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.ModalsDialogs;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="Popover"/> view — the native port of the web
/// <c>Popover</c> primitive (web/src/components/ui/Popover.tsx). It owns the open flag (web <c>open</c>), the
/// requested side / alignment / side-offset (web <c>side</c> / <c>align</c> / <c>sideOffset</c> props), the
/// optional accessible label (web <c>ariaLabel</c>) and the resolved <see cref="Placement"/> (web <c>pos</c>
/// state, <c>null</c> until the content is measured). It runs the ported positioner via
/// <see cref="PopoverProjection"/>, drives the <c>Escape</c> / pointer-outside dismissals (web's two close
/// handlers) and signals focus restoration to the anchor on every close (web focus-restore effect). The web
/// component performs no data read, so the holder never exposes a loading / empty / error / stale / offline
/// state; its states are closed, open-but-unpositioned (measuring, hidden) and open-and-positioned. Drive it
/// from one confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PopoverViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private readonly PopoverDiagnostics _diagnostics;

    private bool _isOpen;
    private PopoverSide _side = PopoverSide.Bottom;
    private PopoverAlign _align = PopoverAlign.Start;
    private double _sideOffset = PopoverRegistration.DefaultSideOffset;
    private string? _ariaLabel;
    private PopoverPlacement? _placement;

    /// <summary>Creates the holder over the i18n facade and an optional PII-safe diagnostics sink.</summary>
    /// <param name="localizer">The i18n facade the accessible region label resolves through.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public PopoverViewModel(ILocalizer localizer, PopoverDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        _localizer = localizer;
        _diagnostics = diagnostics ?? new PopoverDiagnostics();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the popover opens (web <c>open</c> → <c>true</c>).</summary>
    public event EventHandler? Opened;

    /// <summary>Raised when the popover requests to close, carrying the dismiss cause (web <c>onClose</c>).</summary>
    public event EventHandler<PopoverDismissReason>? CloseRequested;

    /// <summary>Raised after a close so the view can return focus to the anchor (web focus-restore effect).</summary>
    public event EventHandler? FocusRestoreRequested;

    // ── Configuration (web props) ────────────────────────────────────────────────────────────────────────

    /// <summary>Requested side relative to the anchor (web <c>side</c>; default <see cref="PopoverSide.Bottom"/>).</summary>
    public PopoverSide Side
    {
        get => _side;
        set => Set(ref _side, value);
    }

    /// <summary>Cross-axis alignment (web <c>align</c>; default <see cref="PopoverAlign.Start"/>).</summary>
    public PopoverAlign Align
    {
        get => _align;
        set => Set(ref _align, value);
    }

    /// <summary>Pixel gap between the anchor and the popover (web <c>sideOffset</c>; default 6).</summary>
    public double SideOffset
    {
        get => _sideOffset;
        set => Set(ref _sideOffset, value);
    }

    /// <summary>Consumer-supplied accessible label (web <c>ariaLabel</c>). Editing it re-resolves <see cref="ResolvedAriaLabel"/>.</summary>
    public string? AriaLabel
    {
        get => _ariaLabel;
        set
        {
            if (Set(ref _ariaLabel, value))
            {
                Raise(nameof(ResolvedAriaLabel));
            }
        }
    }

    // ── Derived / interaction state ──────────────────────────────────────────────────────────────────────

    /// <summary>The accessible region name: the consumer label, or the localized fallback when none is set.</summary>
    public string ResolvedAriaLabel => PopoverProjection.ResolveAriaLabel(_ariaLabel, _localizer);

    /// <summary>True while the popover is shown (web <c>open</c>). Controlled via <see cref="Open"/> / <see cref="Close"/>.</summary>
    public bool IsOpen => _isOpen;

    /// <summary>The resolved position, or <c>null</c> until the content is measured (web <c>pos</c>).</summary>
    public PopoverPlacement? Placement => _placement;

    /// <summary>True once a placement has been computed (web <c>pos != null</c> → content becomes visible).</summary>
    public bool IsPositioned => _placement is not null;

    // ── Commands ─────────────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// Open the popover (web <c>open=true</c>): clears any stale placement so the content stays hidden until it
    /// is re-measured, records the <c>view.opened</c> diagnostics event and raises <see cref="Opened"/>. A
    /// second call while already open is a no-op.
    /// </summary>
    public void Open()
    {
        if (_isOpen)
        {
            return;
        }

        _placement = null;
        _isOpen = true;
        Raise(nameof(IsOpen));
        Raise(nameof(IsPositioned));
        Raise(nameof(Placement));
        _diagnostics.RecordViewOpened();
        Opened?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>
    /// Close the popover with <paramref name="reason"/> (web <c>onClose</c>): clears the placement, records the
    /// dismissal, raises <see cref="CloseRequested"/> and then <see cref="FocusRestoreRequested"/> so focus
    /// returns to the anchor (web focus-restore effect). A call while already closed is a no-op and returns
    /// false.
    /// </summary>
    public bool Close(PopoverDismissReason reason)
    {
        if (!_isOpen)
        {
            return false;
        }

        _isOpen = false;
        _placement = null;
        Raise(nameof(IsOpen));
        Raise(nameof(IsPositioned));
        Raise(nameof(Placement));
        _diagnostics.RecordDismissed(reason);
        CloseRequested?.Invoke(this, reason);
        FocusRestoreRequested?.Invoke(this, EventArgs.Empty);
        return true;
    }

    /// <summary>
    /// Recompute the placement from the current anchor / content / viewport geometry — the native analogue of
    /// the web <c>compute()</c> call wired to mount, resize and scroll. A no-op while the popover is closed.
    /// </summary>
    public void UpdatePlacement(PopoverRect anchor, PopoverSize content, PopoverViewport viewport)
    {
        if (!_isOpen)
        {
            return;
        }

        _placement = PopoverProjection.ResolvePlacement(
            anchor, content, viewport, _side, _align, _sideOffset, PopoverRegistration.ViewportMargin);
        Raise(nameof(Placement));
        Raise(nameof(IsPositioned));
    }

    /// <summary>
    /// Handle a key press (web <c>onKeyDown</c>): <c>Escape</c> closes with
    /// <see cref="PopoverDismissReason.Escape"/> while open. Returns true only when the press closed the
    /// popover.
    /// </summary>
    public bool HandleKey(string? key) =>
        _isOpen && PopoverProjection.IsEscape(key) && Close(PopoverDismissReason.Escape);

    /// <summary>
    /// Handle a pointer-down (web <c>onPointerDown</c>): a press outside both the content and the anchor closes
    /// with <see cref="PopoverDismissReason.PointerOutside"/> while open. Returns true only when the press
    /// closed the popover.
    /// </summary>
    public bool HandlePointerDown(PopoverRect content, PopoverRect anchor, double x, double y) =>
        _isOpen && PopoverProjection.IsPointerOutside(content, anchor, x, y) &&
        Close(PopoverDismissReason.PointerOutside);

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
