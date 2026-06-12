using System.ComponentModel;
using System.Runtime.CompilerServices;
using System.Threading.Tasks;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="PinButton"/> view — the native port of the web
/// component body (web/src/components/ui/PinButton.tsx). It is bound to a single item identity
/// (<see cref="ItemType"/>, <see cref="ItemId"/>, <see cref="Context"/>) and mirrors the web source exactly:
///
/// <list type="bullet">
///   <item>the derived <see cref="IsPinned"/> flag read from the <see cref="IPinStore"/> seam (web
///   <c>const { data: pinned = [] } = usePinned(itemType, context); isPinned = pinned.some(...)</c>), which
///   re-reads whenever the seam raises <c>Changed</c> (the web query result moving);</item>
///   <item>the <see cref="IsPending"/> in-flight flag that disables the trigger and drops re-entrant clicks
///   (web <c>disabled={toggle.isPending}</c> + <c>if (toggle.isPending) return</c>);</item>
///   <item>the <c>handleClick</c> routing (<see cref="ToggleAsync"/>) that flips the pin through the seam and,
///   on success, raises the "Pinned" / "Unpinned" success toast (web <c>onSuccess</c>) or, on the thrown
///   failure, the "Failed to pin" / "Failed to unpin" error toast carrying the error's message (web
///   <c>onError</c> → <c>useMutationToast.error(e, …)</c>);</item>
///   <item>the render projections — the action tooltip / accessible name (<see cref="TooltipLabel"/> /
///   <see cref="AccessibleName"/>, web <c>isPinned ? 'Unpin' : 'Pin'</c>), the optional visible label
///   (<see cref="VisibleLabel"/>, web <c>isPinned ? 'Pinned' : 'Pin'</c> when <see cref="ShowLabel"/>), the icon
///   selection (<see cref="ShowUnpinIcon"/>, web <c>Icon = isPinned ? PinOff : Pin</c>) and the foreground brush
///   token (<see cref="ForegroundBrushKey"/>, web <c>text-amber-300</c> vs <c>text-[var(--text-muted)]</c>).</item>
/// </list>
///
/// The web component issues no loading / empty / error / stale / offline chrome — <c>usePinned</c> defaults its
/// data to <c>[]</c>, so an unresolved or failed pin query simply reads as not-pinned and the trigger shows its
/// idle state; the states it actually has (unpinned-idle, pinned, in-flight/disabled, with / without a visible
/// label, small / medium) are reproduced in full here. Every label resolves through the i18n facade
/// (<see cref="ILocalizer"/>, P1/S10). The view binds the projected state and performs no I/O. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class PinButtonViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly IPinStore _store;
    private readonly ILocalizer _localizer;
    private readonly ToastMutationReporter? _toast;

    private readonly PinItemType _itemType;
    private readonly string _itemId;
    private readonly string? _context;

    private bool _isPinned;
    private bool _isPending;
    private bool _showLabel;
    private PinButtonSize _size = PinButtonSize.Small;
    private bool _disposed;

    /// <summary>Creates the holder over the pin seam, the item identity, the i18n facade and an optional toast queue.</summary>
    /// <param name="store">The pin seam (P1/S8): the <c>usePinned</c> read + <c>useTogglePin</c> write.</param>
    /// <param name="itemType">The domain bucket (web <c>itemType</c>).</param>
    /// <param name="itemId">The stable item id; the caller stringifies numbers (web <c>String(itemId)</c>).</param>
    /// <param name="context">The optional sub-surface scope (web <c>context</c>); null for the default bucket.</param>
    /// <param name="localizer">The i18n facade every label resolves through (web <c>useTranslation()</c>).</param>
    /// <param name="toast">
    /// The shared toast queue the mutation announces through (web <c>useMutationToast()</c> → <c>useToast()</c>);
    /// may be null for isolated hosts / tests, in which case success / failure are not announced.
    /// </param>
    public PinButtonViewModel(
        IPinStore store,
        PinItemType itemType,
        string itemId,
        string? context,
        ILocalizer localizer,
        IToastController? toast = null)
    {
        ArgumentNullException.ThrowIfNull(store);
        ArgumentNullException.ThrowIfNull(itemId);
        ArgumentNullException.ThrowIfNull(localizer);

        _store = store;
        _itemType = itemType;
        _itemId = itemId;
        _context = context;
        _localizer = localizer;
        _toast = toast is null ? null : new ToastMutationReporter(toast, localizer);

        _isPinned = _store.IsPinned(itemType, itemId, context);
        _store.Changed += OnStoreChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>PinButton</c>).</summary>
    public static string Slug => PinButtonRegistration.Slug;

    /// <summary>The domain bucket this trigger pins within (web <c>itemType</c>).</summary>
    public PinItemType ItemType => _itemType;

    /// <summary>The stable id of the row being pinned (web <c>String(itemId)</c>).</summary>
    public string ItemId => _itemId;

    /// <summary>The optional sub-surface scope (web <c>context</c>); null for the default bucket.</summary>
    public string? Context => _context;

    /// <summary>
    /// Whether the item is currently pinned (web <c>isPinned</c>). Re-read from the seam whenever it raises
    /// <c>Changed</c>; drives the icon, the foreground brush, the tooltip / accessible name and the visible label.
    /// </summary>
    public bool IsPinned => _isPinned;

    /// <summary>
    /// Whether a toggle is in flight (web <c>toggle.isPending</c>). While true the trigger is disabled
    /// (<see cref="IsEnabled"/>) and re-entrant clicks are dropped.
    /// </summary>
    public bool IsPending
    {
        get => _isPending;
        private set
        {
            if (_isPending == value)
            {
                return;
            }

            _isPending = value;
            Raise(nameof(IsPending));
            Raise(nameof(IsEnabled));
        }
    }

    /// <summary>Whether the trigger is interactive — true unless a toggle is in flight (web <c>disabled={toggle.isPending}</c>).</summary>
    public bool IsEnabled => !_isPending;

    /// <summary>
    /// Whether to render the visible "Pin" / "Pinned" text beside the icon (web <c>showLabel</c>, default off).
    /// </summary>
    public bool ShowLabel
    {
        get => _showLabel;
        set
        {
            if (_showLabel == value)
            {
                return;
            }

            _showLabel = value;
            Raise(nameof(ShowLabel));
            Raise(nameof(VisibleLabel));
        }
    }

    /// <summary>The trigger size (web <c>size</c>, default <see cref="PinButtonSize.Small"/>).</summary>
    public PinButtonSize Size
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
        }
    }

    /// <summary>The resolved "Pin" label (web <c>t('pin.pin', 'Pin')</c>).</summary>
    public string PinLabel => _localizer.GetString(PinButtonRegistration.PinKey, PinButtonRegistration.PinFallback);

    /// <summary>The resolved "Unpin" label (web <c>t('pin.unpin', 'Unpin')</c>).</summary>
    public string UnpinLabel =>
        _localizer.GetString(PinButtonRegistration.UnpinKey, PinButtonRegistration.UnpinFallback);

    /// <summary>The resolved "Pinned" label (web <c>t('pin.pinned', 'Pinned')</c>).</summary>
    public string PinnedLabel =>
        _localizer.GetString(PinButtonRegistration.PinnedKey, PinButtonRegistration.PinnedFallback);

    /// <summary>
    /// The tooltip text — the action the click performs (web <c>tooltipLabel = isPinned ? 'Unpin' : 'Pin'</c>).
    /// </summary>
    public string TooltipLabel => _isPinned ? UnpinLabel : PinLabel;

    /// <summary>
    /// The trigger's accessible name (web <c>aria-label={tooltipLabel}</c>) — always the action label so the
    /// icon-only button is never unlabelled.
    /// </summary>
    public string AccessibleName => TooltipLabel;

    /// <summary>
    /// The visible label beside the icon, or null when <see cref="ShowLabel"/> is off (web
    /// <c>showLabel &amp;&amp; (isPinned ? 'Pinned' : 'Pin')</c>). Note this uses "Pinned" (the state), not "Unpin"
    /// (the action) — matching the web source's distinct label vs tooltip wording.
    /// </summary>
    public string? VisibleLabel => !_showLabel ? null : (_isPinned ? PinnedLabel : PinLabel);

    /// <summary>
    /// Whether to show the "unpin" (PinOff) glyph rather than the "pin" glyph — true exactly while pinned (web
    /// <c>Icon = isPinned ? PinOff : Pin</c>).
    /// </summary>
    public bool ShowUnpinIcon => _isPinned;

    /// <summary>
    /// The design-token brush key for the trigger foreground — the amber accent when pinned (web
    /// <c>text-amber-300</c>) or the muted colour when idle (web <c>text-[var(--text-muted)]</c>). Resolved to a
    /// brush by the view.
    /// </summary>
    public string ForegroundBrushKey =>
        _isPinned ? PinButtonRegistration.PinnedBrushKey : PinButtonRegistration.IdleBrushKey;

    /// <summary>Fire the toggle (web <c>handleClick</c>) as a detached task — the view's click handler.</summary>
    public void Toggle() => _ = ToggleAsync();

    /// <summary>
    /// Flip the pin state and apply the outcome — the awaitable core of <see cref="Toggle"/> (exposed for headless
    /// tests). Mirrors the web <c>handleClick</c> + <c>useTogglePin</c> mutation: drop the call when a toggle is
    /// already in flight (web <c>if (toggle.isPending) return</c>); otherwise mark pending, write the inverted
    /// state through the seam (web <c>toggle.mutate({ itemId, context, pin: !isPinned })</c>), and on success raise
    /// the matching success toast (web <c>onSuccess</c>: pin → "Pinned", unpin → "Unpinned") — the new pin state
    /// arrives via the seam's <c>Changed</c> — or on the thrown failure raise the matching error toast with the
    /// error's message as the detail line (web <c>onError</c>: pin → "Failed to pin", unpin → "Failed to unpin").
    /// </summary>
    /// <returns>The toggle outcome.</returns>
    public async Task<PinToggleOutcome> ToggleAsync()
    {
        // web: if (toggle.isPending) return;
        if (_isPending)
        {
            return PinToggleOutcome.Ignored;
        }

        // web: pin: !isPinned
        var target = !_isPinned;
        IsPending = true;
        try
        {
            await _store.SetPinnedAsync(_itemType, _itemId, _context, target).ConfigureAwait(false);

            // web onSuccess: success('toast.pin.(un)pinned.success', '(Un)pinned'). The new pin state is delivered
            // by the seam's Changed event (web invalidateAndBroadcast re-running the pinned query).
            ReportSuccess(target);
            return target ? PinToggleOutcome.Pinned : PinToggleOutcome.Unpinned;
        }
        catch (Exception ex)
        {
            // web onError: error(e, 'toast.pin.(un)pinned.error', 'Failed to (un)pin') — title + the error detail.
            ReportFailure(ex, target);
            return PinToggleOutcome.Failed;
        }
        finally
        {
            IsPending = false;
        }
    }

    /// <inheritdoc />
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _store.Changed -= OnStoreChanged;
        GC.SuppressFinalize(this);
    }

    private void ReportSuccess(bool pinned)
    {
        if (_toast is null)
        {
            return;
        }

        if (pinned)
        {
            _toast.Success(PinButtonRegistration.PinnedSuccessKey, PinButtonRegistration.PinnedSuccessFallback);
        }
        else
        {
            _toast.Success(PinButtonRegistration.UnpinnedSuccessKey, PinButtonRegistration.UnpinnedSuccessFallback);
        }
    }

    private void ReportFailure(Exception error, bool pinned)
    {
        if (_toast is null)
        {
            return;
        }

        if (pinned)
        {
            _toast.Error(error, PinButtonRegistration.PinFailedKey, PinButtonRegistration.PinFailedFallback);
        }
        else
        {
            _toast.Error(error, PinButtonRegistration.UnpinFailedKey, PinButtonRegistration.UnpinFailedFallback);
        }
    }

    private void OnStoreChanged(object? sender, EventArgs e)
    {
        var next = _store.IsPinned(_itemType, _itemId, _context);
        if (next == _isPinned)
        {
            return;
        }

        _isPinned = next;
        RaisePinnedDependents();
    }

    private void RaisePinnedDependents()
    {
        Raise(nameof(IsPinned));
        Raise(nameof(ShowUnpinIcon));
        Raise(nameof(TooltipLabel));
        Raise(nameof(AccessibleName));
        Raise(nameof(VisibleLabel));
        Raise(nameof(ForegroundBrushKey));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
