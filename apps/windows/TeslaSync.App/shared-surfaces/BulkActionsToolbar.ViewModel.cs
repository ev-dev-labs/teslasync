using System.Collections.Generic;
using System.ComponentModel;
using System.Threading.Tasks;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="BulkActionsToolbar"/> view — the native port of
/// the web component body (web/src/components/data-display/BulkActionsToolbar.tsx). It mirrors the web source
/// exactly: the toolbar is shown only while something is selected (<see cref="IsVisible"/> = web
/// <c>count === 0 ? null : ...</c>); the polite count chip (<see cref="CountLabel"/> = web
/// <c>t('bulk.selected', { count })</c>); the noun caption that renders only when an <see cref="ItemNoun"/> is
/// supplied (<see cref="HasNoun"/>) and appends <see cref="OfTotalLabel"/> only when a <see cref="Total"/> is
/// known (<see cref="HasTotal"/>); the per-action button variant (<see cref="ButtonVariantFor"/> — danger →
/// destructive, otherwise secondary); the per-action pending spinner driven by the returned task
/// (<see cref="IsActionPending"/>); and the <c>runAction</c> routing that optionally confirms first
/// (<see cref="ConfirmIntentFor"/> — danger → danger, otherwise warning), guards against double-invocation,
/// sets the per-action pending flag and clears it in a <c>finally</c> so a throwing mutation leaves the
/// selection intact. The view binds the projected labels + flags and never performs I/O. Drive it from one
/// confinement (the UI thread); it is not internally synchronised.
/// </summary>
public sealed class BulkActionsToolbarViewModel : INotifyPropertyChanged
{
    private static readonly PropertyChangedEventArgs AllProperties = new(string.Empty);

    private readonly IReadOnlyList<BulkAction> _actions;
    private readonly IBulkActionConfirmer _confirmer;
    private readonly ILocalizer _localizer;
    private readonly Dictionary<string, bool> _pending = new(StringComparer.Ordinal);

    private IReadOnlyList<BulkSelectionId> _selectedIds = Array.Empty<BulkSelectionId>();
    private int? _total;
    private BulkItemNoun? _itemNoun;

    /// <summary>Creates the holder over its action list, the confirm seam (P1/S8) and the i18n facade.</summary>
    /// <param name="actions">The per-page action definitions, rendered in order (web <c>actions</c>).</param>
    /// <param name="confirmer">The confirm seam (web <c>useConfirm()</c>); pass <see cref="InertBulkActionConfirmer.Instance"/> when none is mounted.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="itemNoun">Optional singular/plural noun (web <c>itemNoun</c>); when null the noun caption is not shown.</param>
    public BulkActionsToolbarViewModel(
        IReadOnlyList<BulkAction> actions,
        IBulkActionConfirmer confirmer,
        ILocalizer localizer,
        BulkItemNoun? itemNoun = null)
    {
        ArgumentNullException.ThrowIfNull(actions);
        ArgumentNullException.ThrowIfNull(confirmer);
        ArgumentNullException.ThrowIfNull(localizer);

        _actions = actions;
        _confirmer = confirmer;
        _localizer = localizer;
        _itemNoun = itemNoun;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>Raised when the selection (or noun) changes, so a host can re-evaluate its own chrome.</summary>
    public event EventHandler? SelectionChanged;

    /// <summary>Raised with an action id when that action's pending state flips (drives the per-button spinner).</summary>
    public event EventHandler<string>? ActionStateChanged;

    /// <summary>Raised when the user activates the clear button (web <c>onClear</c>); the host clears its selection.</summary>
    public event EventHandler? ClearRequested;

    /// <summary>The per-page action definitions, in render order (web <c>actions</c>).</summary>
    public IReadOnlyList<BulkAction> Actions => _actions;

    /// <summary>The current selection (web <c>selectedIds</c>).</summary>
    public IReadOnlyList<BulkSelectionId> SelectedIds => _selectedIds;

    /// <summary>The number of selected rows (web <c>count = selectedIds.length</c>).</summary>
    public int Count => _selectedIds.Count;

    /// <summary>The total visible rows, when known (web <c>total</c>).</summary>
    public int? Total => _total;

    /// <summary>Whether the toolbar is shown — true only while something is selected (web <c>count === 0 ? null</c>).</summary>
    public bool IsVisible => _selectedIds.Count > 0;

    /// <summary>The optional singular/plural noun (web <c>itemNoun</c>); setting it re-renders the caption.</summary>
    public BulkItemNoun? ItemNoun
    {
        get => _itemNoun;
        set
        {
            if (Equals(_itemNoun, value))
            {
                return;
            }

            _itemNoun = value;
            RaiseAll();
            SelectionChanged?.Invoke(this, EventArgs.Empty);
        }
    }

    /// <summary>Whether the noun caption is rendered — true only when an <see cref="ItemNoun"/> is supplied (web <c>{itemNoun &amp;&amp; ...}</c>).</summary>
    public bool HasNoun => _itemNoun is not null;

    /// <summary>Whether the "of {{total}}" caption is appended — true only when a <see cref="Total"/> is known (web <c>typeof total === 'number'</c>).</summary>
    public bool HasTotal => _total.HasValue;

    /// <summary>The polite count chip text (web <c>t('bulk.selected', { count })</c>).</summary>
    public string CountLabel => BulkActionsToolbarRegistration.FormatSelected(
        _localizer.GetString(BulkActionsToolbarRegistration.SelectedKey, BulkActionsToolbarRegistration.SelectedFallback),
        Count);

    /// <summary>
    /// The item noun (web <c>noun</c>): the singular/plural form when an <see cref="ItemNoun"/> is supplied,
    /// otherwise the localized default (web <c>t('bulk.itemDefault', { count })</c>). Computed regardless of
    /// <see cref="HasNoun"/> (mirroring the web source, which always evaluates <c>noun</c>) but rendered by the
    /// view only when <see cref="HasNoun"/> is true.
    /// </summary>
    public string NounText => _itemNoun is { } noun
        ? (Count == 1 ? noun.One : noun.Other)
        : _localizer.GetString(BulkActionsToolbarRegistration.ItemDefaultKey, BulkActionsToolbarRegistration.ItemDefaultFallback);

    /// <summary>The "of {{total}}" caption (web <c>t('bulk.ofTotal', { total })</c>); meaningful only when <see cref="HasTotal"/>.</summary>
    public string OfTotalLabel => BulkActionsToolbarRegistration.FormatOfTotal(
        _localizer.GetString(BulkActionsToolbarRegistration.OfTotalKey, BulkActionsToolbarRegistration.OfTotalFallback),
        _total ?? 0);

    /// <summary>The region accessible name (web <c>aria-label={t('bulk.toolbarLabel', ...)}</c>).</summary>
    public string ToolbarLabel =>
        _localizer.GetString(BulkActionsToolbarRegistration.ToolbarLabelKey, BulkActionsToolbarRegistration.ToolbarLabelFallback);

    /// <summary>The clear-selection button label (web <c>t('bulk.clear', ...)</c>).</summary>
    public string ClearLabel =>
        _localizer.GetString(BulkActionsToolbarRegistration.ClearKey, BulkActionsToolbarRegistration.ClearFallback);

    /// <summary>The variant of the clear button (web <c>variant="ghost"</c> → subtle).</summary>
    public static ButtonVariant ClearButtonVariant => ButtonVariant.Subtle;

    /// <summary>The button variant for an action (web <c>variant === 'danger' ? 'danger' : 'secondary'</c>).</summary>
    public static ButtonVariant ButtonVariantFor(BulkAction action)
    {
        ArgumentNullException.ThrowIfNull(action);
        return action.Variant == BulkActionVariant.Danger ? ButtonVariant.Destructive : ButtonVariant.Secondary;
    }

    /// <summary>The confirm urgency for an action (web <c>variant === 'danger' ? 'danger' : 'warning'</c>).</summary>
    public static BulkActionConfirmIntent ConfirmIntentFor(BulkAction action)
    {
        ArgumentNullException.ThrowIfNull(action);
        return action.Variant == BulkActionVariant.Danger ? BulkActionConfirmIntent.Danger : BulkActionConfirmIntent.Warning;
    }

    /// <summary>Replace the current selection (and optional total), re-rendering the toolbar (web prop change).</summary>
    public void SetSelection(IReadOnlyList<BulkSelectionId> selectedIds, int? total = null)
    {
        ArgumentNullException.ThrowIfNull(selectedIds);
        _selectedIds = selectedIds;
        _total = total;
        RaiseAll();
        SelectionChanged?.Invoke(this, EventArgs.Empty);
    }

    /// <summary>Whether the given action is mid-flight (web <c>pending[action.id]</c>).</summary>
    public bool IsActionPending(string id)
    {
        ArgumentNullException.ThrowIfNull(id);
        return _pending.TryGetValue(id, out bool pending) && pending;
    }

    /// <summary>Whether the given action is interactive (web <c>disabled={action.disabled || pending[action.id]}</c>, inverted).</summary>
    public bool IsActionEnabled(BulkAction action)
    {
        ArgumentNullException.ThrowIfNull(action);
        return !action.Disabled && !IsActionPending(action.Id);
    }

    /// <summary>Request a clear of the selection (web clear button <c>onClick={onClear}</c>).</summary>
    public void RequestClear() => ClearRequested?.Invoke(this, EventArgs.Empty);

    /// <summary>
    /// Fire an action as a detached task — the view's click handler (web <c>onClick={() =&gt; { void runAction(action); }}</c>).
    /// A rejected mutation is left unobserved exactly as the web source ignores the rejected promise; the
    /// per-action pending flag is still cleared by <see cref="RunActionAsync"/>'s <c>finally</c>, so the
    /// selection stays intact and the user can retry.
    /// </summary>
    public void Invoke(BulkAction action)
    {
        ArgumentNullException.ThrowIfNull(action);
        _ = RunActionAsync(action);
    }

    /// <summary>
    /// Run an action — the awaitable core of <see cref="Invoke"/> (exposed for headless tests). Mirrors the web
    /// <c>runAction</c>: ignore re-entrant clicks while pending; when the action declares a
    /// <see cref="BulkAction.Confirm"/> payload, confirm first at the mapped <see cref="BulkActionConfirmIntent"/>
    /// and abort when the user dismisses it; then set the pending flag, invoke the mutation with the current
    /// selection and clear the pending flag in a <c>finally</c> so a thrown error leaves the selection intact.
    /// </summary>
    public async Task RunActionAsync(BulkAction action)
    {
        ArgumentNullException.ThrowIfNull(action);

        if (IsActionPending(action.Id))
        {
            return;
        }

        if (action.Confirm is { } confirmation)
        {
            bool accepted = await _confirmer.ConfirmAsync(confirmation, ConfirmIntentFor(action)).ConfigureAwait(false);
            if (!accepted)
            {
                return;
            }
        }

        SetPending(action.Id, true);
        try
        {
            await action.OnInvokeAsync(_selectedIds).ConfigureAwait(false);
        }
        finally
        {
            SetPending(action.Id, false);
        }
    }

    private void SetPending(string id, bool value)
    {
        bool current = _pending.TryGetValue(id, out bool existing) && existing;
        if (current == value)
        {
            return;
        }

        if (value)
        {
            _pending[id] = true;
        }
        else
        {
            _pending.Remove(id);
        }

        ActionStateChanged?.Invoke(this, id);
    }

    private void RaiseAll() => PropertyChanged?.Invoke(this, AllProperties);
}
