using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The clipboard-write seam the <c>CopyButton</c> surface writes through (P1/S8 state-holder layer) — the native
/// port of the web <c>navigator.clipboard.writeText(text)</c> call (web/src/components/ui/CopyButton.tsx L73).
/// Implementations encapsulate ALL platform clipboard I/O and its failure handling: <see cref="CopyTextAsync"/>
/// resolves to <see langword="true"/> on success and <see langword="false"/> on any failure, and MUST NOT throw —
/// the web component's <c>try</c> / <c>catch</c> around the write is reproduced inside the implementation, so the
/// view-model branches purely on the boolean result (web success → confirm + optional success toast; web catch →
/// optional error toast + failure log). The production binding is the WinUI host's
/// <c>Windows.ApplicationModel.DataTransfer.Clipboard</c> writer (it requires a Windows runtime and lives with the
/// view); <see cref="NoOpClipboardCopier"/> is the inert default that reports failure for hosts with no clipboard.
///
/// <para>
/// This seam is intentionally <c>CopyButton</c>-scoped: the sibling <c>CopyLinkButton</c> surface owns its own
/// <c>IClipboardWriter</c> for copying the current view link, and each surface keeps its own seam so it stays
/// self-contained against its declared dependencies rather than coupling to a sibling surface's contract.
/// </para>
/// </summary>
public interface IClipboardCopier
{
    /// <summary>
    /// Place <paramref name="text"/> on the clipboard (web <c>navigator.clipboard.writeText</c>), resolving to
    /// <see langword="true"/> on success or <see langword="false"/> on any failure. Implementations swallow their
    /// own errors and never throw, reproducing the web component's <c>try</c> / <c>catch</c>.
    /// </summary>
    /// <param name="text">The text to copy (the caller-supplied value).</param>
    /// <returns>A task resolving to whether the write succeeded.</returns>
    Task<bool> CopyTextAsync(string text);
}

/// <summary>
/// A delegate-backed <see cref="IClipboardCopier"/> — lets a host supply the clipboard write as a function (used
/// by the WinUI view to forward to the platform <c>Clipboard</c>, and by tests to simulate success / failure). A
/// null delegate degrades to a failed write (<see langword="false"/>), matching a host with no clipboard wired.
/// </summary>
public sealed class DelegateClipboardCopier : IClipboardCopier
{
    private readonly Func<string, Task<bool>>? _writer;

    /// <summary>Creates the copier from a clipboard-write delegate.</summary>
    /// <param name="writer">Writes the text and resolves success; may be null.</param>
    public DelegateClipboardCopier(Func<string, Task<bool>>? writer) => _writer = writer;

    /// <inheritdoc />
    public Task<bool> CopyTextAsync(string text) => _writer?.Invoke(text) ?? Task.FromResult(false);
}

/// <summary>
/// The inert clipboard copier — every write resolves to <see langword="false"/> (no clipboard available). Used as
/// the safe default when a host has not wired a clipboard yet; the surface then reports the copy as failed and
/// (when <c>withToast</c> is set) raises the error toast, exactly as the web component does when
/// <c>navigator.clipboard.writeText</c> rejects.
/// </summary>
public sealed class NoOpClipboardCopier : IClipboardCopier
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpClipboardCopier Instance { get; } = new();

    private NoOpClipboardCopier()
    {
    }

    /// <inheritdoc />
    public Task<bool> CopyTextAsync(string text) => Task.FromResult(false);
}
