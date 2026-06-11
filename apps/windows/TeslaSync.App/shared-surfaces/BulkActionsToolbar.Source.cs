using System.Collections.Generic;
using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The confirmation seam the toolbar routes destructive actions through (P1/S8 state-holder layer) — the
/// native port of the web <c>useConfirm()</c> contract (web/src/hooks/useConfirm.ts). The web hook resolves a
/// <see cref="bool"/> when the user accepts or dismisses the shared <c>&lt;ConfirmDialog&gt;</c>; the native
/// analogue resolves the same <see cref="bool"/> from a Fluent <c>ContentDialog</c>. The real WinUI
/// implementation lives in the view (it needs a XamlRoot); the view-model only depends on this seam, so its
/// confirm-routing logic is verified headlessly with the inert / auto / recording doubles.
/// </summary>
public interface IBulkActionConfirmer
{
    /// <summary>
    /// Prompt for confirmation of <paramref name="confirmation"/> at the given <paramref name="intent"/>,
    /// resolving <see langword="true"/> when the user accepts (web <c>await confirm(...)</c> resolving to
    /// <see langword="true"/>) and <see langword="false"/> when they dismiss it.
    /// </summary>
    Task<bool> ConfirmAsync(BulkActionConfirmation confirmation, BulkActionConfirmIntent intent);
}

/// <summary>
/// The inert confirmer used when no dialog host is mounted (galleries / design hosts) — every prompt resolves
/// <see langword="false"/>, so a confirm-bearing action simply does not proceed without a real dialog, the
/// safe default. The view supplies the real dialog-backed confirmer in production.
/// </summary>
public sealed class InertBulkActionConfirmer : IBulkActionConfirmer
{
    /// <summary>The shared inert instance.</summary>
    public static InertBulkActionConfirmer Instance { get; } = new();

    private InertBulkActionConfirmer()
    {
    }

    /// <inheritdoc />
    public Task<bool> ConfirmAsync(BulkActionConfirmation confirmation, BulkActionConfirmIntent intent) =>
        Task.FromResult(false);
}

/// <summary>
/// A confirmer that always accepts without prompting — used by hosts that have already gathered consent and
/// by headless tests that exercise the confirm-routing path of a confirm-bearing action. It mirrors the web
/// path where <c>await confirm(...)</c> resolves to <see langword="true"/>.
/// </summary>
public sealed class AutoBulkActionConfirmer : IBulkActionConfirmer
{
    /// <summary>The shared auto-confirm instance.</summary>
    public static AutoBulkActionConfirmer Instance { get; } = new();

    private AutoBulkActionConfirmer()
    {
    }

    /// <inheritdoc />
    public Task<bool> ConfirmAsync(BulkActionConfirmation confirmation, BulkActionConfirmIntent intent) =>
        Task.FromResult(true);
}

/// <summary>
/// A single bulk action — the native port of the web <c>BulkAction</c> interface
/// (web/src/components/data-display/BulkActionsToolbar.tsx L26-L49). Carries the stable
/// <see cref="Id"/> (web key + telemetry / <c>data-bulk-action</c>), the already-localized
/// <see cref="Label"/>, an optional leading <see cref="IconGlyph"/> (web <c>icon</c>), the
/// <see cref="Variant"/> (web <c>variant</c>), an optional <see cref="Confirm"/> payload (web <c>confirm</c>),
/// the <see cref="Disabled"/> gate (web <c>disabled</c>) and the <see cref="OnInvokeAsync"/> mutation that
/// receives the current selection and resolves when it completes (web <c>onClick(selectedIds)</c> returning a
/// <c>Promise</c>). Throwing from <see cref="OnInvokeAsync"/> leaves the selection intact so the user can
/// retry, exactly as the web source documents.
/// </summary>
public sealed class BulkAction
{
    /// <summary>Creates a bulk action.</summary>
    /// <param name="id">Stable id (web key / telemetry); must be non-empty.</param>
    /// <param name="label">Already-localized button label (web <c>label</c>).</param>
    /// <param name="onInvokeAsync">The mutation invoked with the current selection (web <c>onClick</c>).</param>
    /// <param name="variant">Visual intent (web <c>variant</c>); defaults to <see cref="BulkActionVariant.Default"/>.</param>
    /// <param name="iconGlyph">Optional Segoe Fluent leading glyph (web <c>icon</c>).</param>
    /// <param name="confirm">Optional confirm payload (web <c>confirm</c>); when set the action confirms first.</param>
    /// <param name="disabled">Disable the action regardless of selection (web <c>disabled</c>).</param>
    public BulkAction(
        string id,
        string label,
        Func<IReadOnlyList<BulkSelectionId>, Task> onInvokeAsync,
        BulkActionVariant variant = BulkActionVariant.Default,
        string? iconGlyph = null,
        BulkActionConfirmation? confirm = null,
        bool disabled = false)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        ArgumentNullException.ThrowIfNull(label);
        ArgumentNullException.ThrowIfNull(onInvokeAsync);

        Id = id;
        Label = label;
        OnInvokeAsync = onInvokeAsync;
        Variant = variant;
        IconGlyph = iconGlyph;
        Confirm = confirm;
        Disabled = disabled;
    }

    /// <summary>Stable id used as the action key and the <c>data-bulk-action</c> automation id (web <c>id</c>).</summary>
    public string Id { get; }

    /// <summary>The already-localized button label (web <c>label</c>).</summary>
    public string Label { get; }

    /// <summary>Visual intent (web <c>variant</c>).</summary>
    public BulkActionVariant Variant { get; }

    /// <summary>Optional leading Segoe Fluent glyph (web <c>icon</c>).</summary>
    public string? IconGlyph { get; }

    /// <summary>Optional confirm payload (web <c>confirm</c>); when set the action confirms before invoking.</summary>
    public BulkActionConfirmation? Confirm { get; }

    /// <summary>When true the action is disabled regardless of selection (web <c>disabled</c>).</summary>
    public bool Disabled { get; }

    /// <summary>The mutation invoked with the current selection (web <c>onClick</c>).</summary>
    public Func<IReadOnlyList<BulkSelectionId>, Task> OnInvokeAsync { get; }
}
