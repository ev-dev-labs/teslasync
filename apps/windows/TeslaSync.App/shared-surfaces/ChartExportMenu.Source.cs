using System.Threading.Tasks;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The transient-feedback seam the export menu announces clipboard outcomes through (P1/S8 state-holder
/// layer) — the native port of the web <c>useOptionalToast()</c> / <c>ToastContextValue</c> public surface
/// (web/src/components/feedback/Toast.tsx L74-L100). <see cref="Show"/> selects the web context's
/// <c>success</c> / <c>error</c> / <c>info</c> / <c>warning</c> helper by <see cref="ChartExportToastSeverity"/>
/// (a single severity-parameterized method is the idiomatic native shape and avoids a member named after a
/// reserved keyword). The web hook returns <see langword="null"/> when no <c>ToastProvider</c> is mounted and
/// the component guards with <c>if (!toast) return;</c>; the native analogue is
/// <see cref="NoOpChartExportToast"/>, a non-null inert implementation so the view-model is never forced to
/// null-check. The view never touches this seam directly — it binds through the view-model.
/// </summary>
public interface IChartExportToast
{
    /// <summary>
    /// Raise a toast of the given <paramref name="severity"/> with a <paramref name="title"/> and optional
    /// <paramref name="message"/> — the web <c>toast.success</c> / <c>toast.error</c> / <c>toast.info</c> /
    /// <c>toast.warning</c> helper selected by severity.
    /// </summary>
    void Show(ChartExportToastSeverity severity, string title, string? message = null);
}

/// <summary>
/// The inert toast used when no toast host is mounted — the native analogue of the web
/// <c>useOptionalToast()</c> returning <see langword="null"/> outside a <c>ToastProvider</c> (e.g. isolated
/// component tests / galleries). <see cref="Show"/> is a no-op, so a copy outcome simply goes unannounced
/// exactly as it does in the web component's <c>if (!toast) return;</c> path, while keeping the view-model
/// null-safe.
/// </summary>
public sealed class NoOpChartExportToast : IChartExportToast
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpChartExportToast Instance { get; } = new();

    private NoOpChartExportToast()
    {
    }

    /// <inheritdoc />
    public void Show(ChartExportToastSeverity severity, string title, string? message = null)
    {
        // No toast host mounted — the web component drops the announcement (useOptionalToast === null).
    }
}

/// <summary>
/// The export-action seam the menu invokes — the native port of the web component's callback props
/// (web/src/components/charts/ChartExportMenu.tsx L40-L57: <c>onExportPNG</c>, <c>onExportSVG</c>,
/// <c>onCopyImage</c> and the optional <c>onExportCsv</c>). The host wires these to a real exporter (the web
/// <c>useChartExport()</c> primitives); the menu only orchestrates which action fires and announces the copy
/// result. <see cref="CanExportCsv"/> mirrors the web "render the CSV item only when <c>onExportCsv</c> is
/// supplied" rule. The image actions return <see cref="Task"/> so the menu can be driven from a UI thread
/// without blocking; <see cref="CopyImageAsync"/> resolves to a <see cref="ChartExportClipboardOutcome"/> the
/// menu maps to a toast.
/// </summary>
public interface IChartExportActions
{
    /// <summary>True when a CSV export is wired (web: <c>onExportCsv</c> prop present) — gates the CSV item.</summary>
    bool CanExportCsv { get; }

    /// <summary>Run the PNG export (web <c>onExportPNG</c>).</summary>
    Task ExportPngAsync();

    /// <summary>Run the SVG export (web <c>onExportSVG</c>).</summary>
    Task ExportSvgAsync();

    /// <summary>Copy the chart image to the clipboard (web <c>onCopyImage</c>), resolving the outcome.</summary>
    Task<ChartExportClipboardOutcome> CopyImageAsync();

    /// <summary>Run the CSV export (web <c>onExportCsv</c>); only called when <see cref="CanExportCsv"/> is true.</summary>
    Task ExportCsvAsync();
}

/// <summary>
/// A delegate-backed <see cref="IChartExportActions"/> — the canonical implementation a host builds from its
/// exporter primitives (the native analogue of passing the web <c>useChartExport()</c> functions as the
/// component's callback props). The CSV delegate is optional: when it is <see langword="null"/>,
/// <see cref="CanExportCsv"/> is false and the menu omits the CSV item, exactly as the web component omits it
/// when <c>onExportCsv</c> is undefined. Null image delegates degrade to completed no-ops / a
/// <see cref="ChartExportClipboardOutcome.Failed"/> copy so a partially-wired host never throws.
/// </summary>
public sealed class ChartExportActions : IChartExportActions
{
    private readonly Func<Task>? _exportPng;
    private readonly Func<Task>? _exportSvg;
    private readonly Func<Task<ChartExportClipboardOutcome>>? _copyImage;
    private readonly Func<Task>? _exportCsv;

    /// <summary>
    /// Creates the action set from its delegates. <paramref name="exportCsv"/> is optional; supplying it makes
    /// <see cref="CanExportCsv"/> true and adds the CSV item to the menu.
    /// </summary>
    public ChartExportActions(
        Func<Task>? exportPng,
        Func<Task>? exportSvg,
        Func<Task<ChartExportClipboardOutcome>>? copyImage,
        Func<Task>? exportCsv = null)
    {
        _exportPng = exportPng;
        _exportSvg = exportSvg;
        _copyImage = copyImage;
        _exportCsv = exportCsv;
    }

    /// <inheritdoc />
    public bool CanExportCsv => _exportCsv is not null;

    /// <inheritdoc />
    public Task ExportPngAsync() => _exportPng?.Invoke() ?? Task.CompletedTask;

    /// <inheritdoc />
    public Task ExportSvgAsync() => _exportSvg?.Invoke() ?? Task.CompletedTask;

    /// <inheritdoc />
    public Task<ChartExportClipboardOutcome> CopyImageAsync() =>
        _copyImage?.Invoke() ?? Task.FromResult(ChartExportClipboardOutcome.Failed);

    /// <inheritdoc />
    public Task ExportCsvAsync() => _exportCsv?.Invoke() ?? Task.CompletedTask;
}

/// <summary>
/// The inert action set — every export is a completed no-op and a copy resolves to
/// <see cref="ChartExportClipboardOutcome.Failed"/>. Used as the safe default when a host has not wired an
/// exporter yet (e.g. a disabled chart container), so the menu still renders its full structure without an
/// action seam to drive. CSV is unavailable, matching a web component rendered with no <c>onExportCsv</c>.
/// </summary>
public sealed class NoOpChartExportActions : IChartExportActions
{
    /// <summary>The shared inert instance.</summary>
    public static NoOpChartExportActions Instance { get; } = new();

    private NoOpChartExportActions()
    {
    }

    /// <inheritdoc />
    public bool CanExportCsv => false;

    /// <inheritdoc />
    public Task ExportPngAsync() => Task.CompletedTask;

    /// <inheritdoc />
    public Task ExportSvgAsync() => Task.CompletedTask;

    /// <inheritdoc />
    public Task<ChartExportClipboardOutcome> CopyImageAsync() =>
        Task.FromResult(ChartExportClipboardOutcome.Failed);

    /// <inheritdoc />
    public Task ExportCsvAsync() => Task.CompletedTask;
}
