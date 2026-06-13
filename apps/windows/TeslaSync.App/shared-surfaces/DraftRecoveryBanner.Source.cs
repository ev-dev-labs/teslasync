namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The draft-recovery seam the <c>DraftRecoveryBanner</c> binds through (P1/S8) — the native analogue of the web
/// component's props + callbacks (web/src/components/feedback/DraftRecoveryBanner.tsx L8-23). It exposes the
/// current <see cref="DraftRecoverySnapshot"/> (the web <c>hasDraft</c> / <c>draftSavedAt</c> / <c>itemNoun</c>
/// data props), raises <see cref="Changed"/> whenever a draft is hydrated (or cleared), and offers the two
/// side-effecting affordances the banner forwards to: <see cref="Restore"/> (the optional web <c>onRestore</c>,
/// a UX-only acknowledgement — the draft is already applied on hydration) and <see cref="Discard"/> (the
/// required web <c>onDiscard</c>, which resets the editor to a clean baseline and clears the stored draft). The
/// view never owns the draft lifecycle itself — it binds to this seam. The canonical
/// <see cref="DelegateDraftRecoverySource"/> bridges the host's form-draft hook; a static snapshot stands in for
/// headless hosts and unit tests.
/// </summary>
public interface IDraftRecoverySource
{
    /// <summary>The current draft-recovery snapshot (web <c>{ hasDraft, draftSavedAt, itemNoun }</c>).</summary>
    DraftRecoverySnapshot Current { get; }

    /// <summary>Raised whenever <see cref="Current"/> changes; may be raised from a background thread.</summary>
    event EventHandler? Changed;

    /// <summary>
    /// Accept the restored draft (web <c>onRestore</c> behind "Use draft"): the draft was already applied on
    /// hydration, so this is a UX-only acknowledgement the host may observe (or ignore).
    /// </summary>
    void Restore();

    /// <summary>
    /// Discard the restored draft (web <c>onDiscard</c> behind "Discard draft"): the host resets the editor to a
    /// clean baseline and clears the stored draft.
    /// </summary>
    void Discard();
}

/// <summary>
/// An <see cref="IDraftRecoverySource"/> backed by an explicit, caller-set snapshot and two optional callbacks —
/// the canonical production binding (the host wires <paramref name="onRestore"/> / <paramref name="onDiscard"/>
/// to its form-draft hook) and the headless / unit-test default. <see cref="Set"/> moves the snapshot and raises
/// <see cref="Changed"/> so the banner projection and view-model can be exercised across the collapsed and
/// visible states without a real editor; <see cref="Restore"/> and <see cref="Discard"/> forward to the
/// callbacks and are counted for assertions. Drive it from one confinement (the UI thread); it is not internally
/// synchronised.
/// </summary>
public sealed class DelegateDraftRecoverySource : IDraftRecoverySource
{
    private readonly Action? _onRestore;
    private readonly Action? _onDiscard;
    private DraftRecoverySnapshot _current;

    /// <summary>Creates the source over an initial snapshot and the host's optional restore / discard callbacks.</summary>
    /// <param name="current">The initial draft-recovery snapshot (defaults to <see cref="DraftRecoverySnapshot.None"/>).</param>
    /// <param name="onRestore">Optional handler for "Use draft" (web <c>onRestore</c>); the web prop is optional.</param>
    /// <param name="onDiscard">Optional handler for "Discard draft" (web <c>onDiscard</c>); supplied by every real host.</param>
    public DelegateDraftRecoverySource(
        DraftRecoverySnapshot? current = null,
        Action? onRestore = null,
        Action? onDiscard = null)
    {
        _current = current ?? DraftRecoverySnapshot.None;
        _onRestore = onRestore;
        _onDiscard = onDiscard;
    }

    /// <inheritdoc />
    public event EventHandler? Changed;

    /// <inheritdoc />
    public DraftRecoverySnapshot Current => _current;

    /// <summary>The number of times <see cref="Restore"/> has been invoked (for "Use draft" forwarding assertions).</summary>
    public int RestoreCount { get; private set; }

    /// <summary>The number of times <see cref="Discard"/> has been invoked (for "Discard draft" forwarding assertions).</summary>
    public int DiscardCount { get; private set; }

    /// <summary>Move the snapshot and raise <see cref="Changed"/> (a draft being hydrated into — or cleared from — the editor).</summary>
    /// <param name="snapshot">The new draft-recovery snapshot.</param>
    public void Set(DraftRecoverySnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        _current = snapshot;
        Changed?.Invoke(this, EventArgs.Empty);
    }

    /// <inheritdoc />
    public void Restore()
    {
        RestoreCount++;
        _onRestore?.Invoke();
    }

    /// <inheritdoc />
    public void Discard()
    {
        DiscardCount++;
        _onDiscard?.Invoke();
    }
}
