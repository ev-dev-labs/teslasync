using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SectionErrorBoundary"/> view — the native port of the
/// web <c>SectionErrorBoundary</c> body and the stateful <c>ErrorBoundary</c> it delegates to
/// (web/src/components/feedback/SectionErrorBoundary.tsx + ErrorBoundary.tsx). It binds the i18n facade (P1/S10) and
/// holds the boundary's configuration (<see cref="Configure"/> — the web <c>fallback</c> / <c>fallbackTitle</c>
/// props) and caught-error state (<see cref="Capture"/> / <see cref="Reset"/> — the web
/// <c>getDerivedStateFromError</c> / <c>handleRetry</c>). It recomputes the pure
/// <see cref="SectionErrorBoundaryProjection"/> whenever the configuration or the error state moves and raises
/// <see cref="PropertyChanged"/> so the view re-renders. The boundary performs no I/O, reads no connectivity and
/// navigates nothing; the actual reload after a retry is the host's concern (surfaced through the view's
/// <c>Retry</c> event), exactly as the web <c>handleRetry</c> only resets the boundary so the parent re-renders.
/// </summary>
public sealed class SectionErrorBoundaryViewModel : INotifyPropertyChanged
{
    private readonly ILocalizer _localizer;
    private SectionErrorBoundaryMode _mode;
    private string? _fallbackTitle;
    private string? _detailText;
    private bool _hasError;
    private SectionErrorBoundaryProjection _projection;

    /// <summary>Creates the holder over its i18n facade and an initial configuration (P1/S10).</summary>
    /// <param name="localizer">The i18n facade the copy resolves through.</param>
    /// <param name="mode">The initial fallback mode (web prop shape); defaults to <see cref="SectionErrorBoundaryMode.Default"/>.</param>
    /// <param name="fallbackTitle">The initial title for the title-fallback mode (web <c>fallbackTitle</c>).</param>
    public SectionErrorBoundaryViewModel(
        ILocalizer localizer,
        SectionErrorBoundaryMode mode = SectionErrorBoundaryMode.Default,
        string? fallbackTitle = null)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        _localizer = localizer;
        _mode = mode;
        _fallbackTitle = fallbackTitle;
        _projection = Compute();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>SectionErrorBoundary</c>).</summary>
    public static string Slug => SectionErrorBoundaryRegistration.Slug;

    /// <summary>The current render projection (children-vs-fallback, copy, retry, role/live, accessible name).</summary>
    public SectionErrorBoundaryProjection Projection => _projection;

    /// <summary>The configured fallback mode (web prop shape).</summary>
    public SectionErrorBoundaryMode Mode => _mode;

    /// <summary>Whether a render failure is currently captured (web <c>this.state.hasError</c>).</summary>
    public bool HasError => _hasError;

    /// <summary>
    /// Reconfigure the boundary's fallback mode and optional title, reproducing the web component re-rendering with
    /// new <c>fallback</c> / <c>fallbackTitle</c> props (web/src/components/feedback/SectionErrorBoundary.tsx
    /// L31-33). The caught-error state is preserved, so reconfiguring while a fallback is shown swaps it in place.
    /// </summary>
    /// <param name="mode">The fallback mode (web prop shape).</param>
    /// <param name="fallbackTitle">The title for the title-fallback mode (web <c>fallbackTitle</c>).</param>
    public void Configure(SectionErrorBoundaryMode mode, string? fallbackTitle = null)
    {
        _mode = mode;
        _fallbackTitle = fallbackTitle;
        Reproject();
    }

    /// <summary>
    /// Record a captured render failure and switch to the fallback — the native analogue of the web
    /// <c>getDerivedStateFromError</c> (ErrorBoundary.tsx L40-42). <paramref name="detailText"/> is an optional,
    /// already-localized, PII-safe detail (e.g. a failure category or the exception type name) the default mode may
    /// show; the raw exception message is deliberately never surfaced (it can carry PII / secrets), mirroring the
    /// native <c>TsErrorBoundary</c> contract.
    /// </summary>
    /// <param name="detailText">An optional PII-safe detail shown by the default mode; null shows the reassuring subtitle.</param>
    public void Capture(string? detailText = null)
    {
        _hasError = true;
        _detailText = detailText;
        Reproject();
    }

    /// <summary>
    /// Clear the captured error and restore the protected content — the native analogue of the web
    /// <c>handleRetry</c> reset (ErrorBoundary.tsx L126-137). The host reloads its content in response to the view's
    /// <c>Retry</c> event; this holder only flips the boundary back to its healthy state.
    /// </summary>
    public void Reset()
    {
        if (!_hasError)
        {
            return;
        }

        _hasError = false;
        _detailText = null;
        Reproject();
    }

    private SectionErrorBoundaryProjection Compute() =>
        SectionErrorBoundaryProjection.Project(
            new SectionErrorBoundaryRequest(_mode, _hasError, _fallbackTitle, _detailText),
            _localizer);

    private void Reproject()
    {
        var next = Compute();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
