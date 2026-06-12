using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The print-trigger seam the <c>PrintButton</c> surface drives (P1/S8 state-holder layer) — the native port of
/// the web component's <c>window.print()</c> call (web/src/components/ui/PrintButton.tsx L70). On the web the
/// button opens the browser print dialog for the current page (the page's <c>@media print</c> stylesheet decides
/// what reaches paper); WinUI has no live-DOM snapshot, so the host binds the print experience for its window
/// through this seam. Implementations encapsulate ALL platform print I/O and its failure handling:
/// <see cref="PrintAsync"/> resolves to <see langword="true"/> when the print experience was opened and
/// <see langword="false"/> on any failure, and MUST NOT throw — the view-model branches purely on the boolean
/// result (the native analogue of the web <c>try { window.print() } finally { setPrinting(false) }</c>, which
/// resets the busy flag whether or not the dialog opened). The production binding is the WinUI host's
/// <c>PrintManager</c> writer (it needs a Windows runtime and a window handle, so it lives with the view as
/// <c>SystemPrintInvoker</c>); <see cref="NoOpPrintInvoker"/> is the inert default for hosts that have not wired a
/// print document yet.
///
/// <para>
/// This seam is intentionally <c>PrintButton</c>-scoped: it owns only the "open the print experience" verb, so the
/// surface stays self-contained against its declared dependencies rather than coupling to a host-wide print
/// service contract.
/// </para>
/// </summary>
public interface IPrintInvoker
{
    /// <summary>
    /// Open the platform print experience for the host (web <c>window.print()</c>), resolving to
    /// <see langword="true"/> when it was shown or <see langword="false"/> on any failure. Implementations
    /// swallow their own errors and never throw, so the view-model can branch on the boolean alone.
    /// </summary>
    /// <returns>A task resolving to whether the print experience was opened.</returns>
    Task<bool> PrintAsync();
}

/// <summary>
/// A delegate-backed <see cref="IPrintInvoker"/> — lets a host supply the print trigger as a function (used by the
/// WinUI view to forward to the platform <c>PrintManager</c>, and by tests to simulate success / failure). A null
/// delegate degrades to a failed invocation (<see langword="false"/>), matching a host with no print path wired.
/// </summary>
public sealed class DelegatePrintInvoker : IPrintInvoker
{
    private readonly Func<Task<bool>>? _invoke;

    /// <summary>Creates the invoker from a print-trigger delegate.</summary>
    /// <param name="invoke">Opens the print experience and resolves success; may be null.</param>
    public DelegatePrintInvoker(Func<Task<bool>>? invoke) => _invoke = invoke;

    /// <inheritdoc />
    public Task<bool> PrintAsync() => _invoke?.Invoke() ?? Task.FromResult(false);
}

/// <summary>
/// The inert print invoker — every invocation resolves to <see langword="false"/> (no print path available). Used
/// as the safe default when a host has not wired a print document yet; the surface then records the print as
/// failed, exactly as the web component's busy flag falls back to idle when <c>window.print()</c> cannot run.
/// </summary>
public sealed class NoOpPrintInvoker : IPrintInvoker
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpPrintInvoker Instance { get; } = new();

    private NoOpPrintInvoker()
    {
    }

    /// <inheritdoc />
    public Task<bool> PrintAsync() => Task.FromResult(false);
}
