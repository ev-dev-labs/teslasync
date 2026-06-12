using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The current-view-link seam the copy-link surface reads from (P1/S8 state-holder layer) — the native port of
/// the web <c>window.location.href</c> the component captures at click time
/// (web/src/components/layout/CopyLinkButton.tsx L24). On the web the "link to this view" is the browser URL
/// (path + query string), already deep-linkable via <c>useUrlState</c>. WinUI has no ambient URL, so the host
/// supplies the canonical shareable deep-link for the currently shown view through this seam; the view-model
/// reads it and never resolves navigation itself. The production binding is <see cref="DelegateCurrentLinkProvider"/>
/// (the host wires its router / deep-link service); <see cref="NoOpCurrentLinkProvider"/> is the inert default for
/// galleries / isolated hosts.
/// </summary>
public interface ICurrentLinkProvider
{
    /// <summary>
    /// The shareable deep-link for the view shown right now (web <c>window.location.href</c>). Read at copy time,
    /// exactly as the web source reads <c>window.location.href</c> inside the click handler rather than caching it.
    /// </summary>
    /// <returns>The current link; an empty string when no link is resolvable (never null).</returns>
    string GetCurrentLink();
}

/// <summary>
/// A delegate-backed <see cref="ICurrentLinkProvider"/> — the canonical implementation a host builds from its
/// router / deep-link service (the native analogue of the browser exposing <c>window.location.href</c>). A null
/// delegate or a null result degrades to the empty string so a partially-wired host never throws and the surface
/// simply copies an empty link.
/// </summary>
public sealed class DelegateCurrentLinkProvider : ICurrentLinkProvider
{
    private readonly Func<string?>? _provider;

    /// <summary>Creates the provider from a link-resolving delegate (the host's current deep-link).</summary>
    /// <param name="provider">Returns the current shareable link; may be null or return null.</param>
    public DelegateCurrentLinkProvider(Func<string?>? provider) => _provider = provider;

    /// <inheritdoc />
    public string GetCurrentLink() => _provider?.Invoke() ?? string.Empty;
}

/// <summary>
/// The inert current-link provider — always returns the empty string. Used as the safe default when a host has
/// not wired a deep-link service yet (e.g. a component gallery), so the surface still renders and behaves without
/// a link source to drive.
/// </summary>
public sealed class NoOpCurrentLinkProvider : ICurrentLinkProvider
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpCurrentLinkProvider Instance { get; } = new();

    private NoOpCurrentLinkProvider()
    {
    }

    /// <inheritdoc />
    public string GetCurrentLink() => string.Empty;
}

/// <summary>
/// The clipboard-write seam the copy-link surface writes through (P1/S8 state-holder layer) — the native port of
/// the web <c>navigator.clipboard.writeText(url)</c> call (and its non-secure-context textarea fallback)
/// (web/src/components/layout/CopyLinkButton.tsx L26-38). Implementations encapsulate ALL platform clipboard I/O
/// and its failure handling: <see cref="WriteTextAsync"/> resolves to <see langword="true"/> on success and
/// <see langword="false"/> on any failure, and MUST NOT throw — the web component's <c>try</c> / <c>catch</c>
/// around the write is reproduced inside the implementation, so the view-model branches purely on the boolean
/// result (web success → confirm + success toast; web catch → error toast). The production binding is the WinUI
/// host's <c>Windows.ApplicationModel.DataTransfer.Clipboard</c> writer (it requires a Windows runtime and lives
/// with the view); <see cref="NoOpClipboardWriter"/> is the inert default that reports failure for hosts with no
/// clipboard.
/// </summary>
public interface IClipboardWriter
{
    /// <summary>
    /// Place <paramref name="text"/> on the clipboard (web <c>navigator.clipboard.writeText</c>), resolving to
    /// <see langword="true"/> on success or <see langword="false"/> on any failure. Implementations swallow their
    /// own errors and never throw, reproducing the web component's <c>try</c> / <c>catch</c>.
    /// </summary>
    /// <param name="text">The text to copy (the current view link).</param>
    /// <returns>A task resolving to whether the write succeeded.</returns>
    Task<bool> WriteTextAsync(string text);
}

/// <summary>
/// A delegate-backed <see cref="IClipboardWriter"/> — lets a host supply the clipboard write as a function (used
/// by the WinUI view to forward to the platform <c>Clipboard</c>, and by tests to simulate success / failure). A
/// null delegate degrades to a failed write (<see langword="false"/>), matching a host with no clipboard wired.
/// </summary>
public sealed class DelegateClipboardWriter : IClipboardWriter
{
    private readonly Func<string, Task<bool>>? _writer;

    /// <summary>Creates the writer from a clipboard-write delegate.</summary>
    /// <param name="writer">Writes the text and resolves success; may be null.</param>
    public DelegateClipboardWriter(Func<string, Task<bool>>? writer) => _writer = writer;

    /// <inheritdoc />
    public Task<bool> WriteTextAsync(string text) =>
        _writer?.Invoke(text) ?? Task.FromResult(false);
}

/// <summary>
/// The inert clipboard writer — every write resolves to <see langword="false"/> (no clipboard available). Used as
/// the safe default when a host has not wired a clipboard yet; the surface then reports the copy as failed and
/// raises the error toast, exactly as the web component does when <c>navigator.clipboard.writeText</c> rejects and
/// no fallback is possible.
/// </summary>
public sealed class NoOpClipboardWriter : IClipboardWriter
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpClipboardWriter Instance { get; } = new();

    private NoOpClipboardWriter()
    {
    }

    /// <inheritdoc />
    public Task<bool> WriteTextAsync(string text) => Task.FromResult(false);
}
