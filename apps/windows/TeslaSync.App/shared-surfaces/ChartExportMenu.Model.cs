using System.Globalization;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + i18n keys for the chart export-menu surface — the native mirror of the web
/// <c>ChartExportMenu</c> (web/src/components/charts/ChartExportMenu.tsx). The web component is a
/// presentational overflow menu: a single Download-icon trigger that opens a menu of "Download data as CSV"
/// (optional) / "Save as PNG" / "Save as SVG" / "Copy image to clipboard" actions, announcing the clipboard
/// outcome through an optional toast. This metadata carries the diagnostics slug the surface registers under
/// and every render-contract i18n key/fallback the web source passes to <c>t()</c>, so the native surface
/// reproduces the web copy verbatim. Every key carries the <c>translation.</c> catalog prefix the WinUI
/// resource bridge expects (the convention every shipped surface uses) and resolves against the English
/// fallback headlessly. UI-free so it is asserted without a XAML host.
/// </summary>
public static class ChartExportMenuRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ChartExportMenu";

    /// <summary>i18n key for the trigger label while disabled (web <c>chart.export.disabledTooltip</c>).</summary>
    public const string DisabledTooltipKey = "translation.chart.export.disabledTooltip";

    /// <summary>English fallback for <see cref="DisabledTooltipKey"/> (web second arg, verbatim).</summary>
    public const string DisabledTooltipFallback = "Chart not ready to export";

    /// <summary>i18n key for the trigger label / menu accessible name (web <c>chart.export.menuLabel</c>).</summary>
    public const string MenuLabelKey = "translation.chart.export.menuLabel";

    /// <summary>English fallback for <see cref="MenuLabelKey"/> (web second arg, verbatim).</summary>
    public const string MenuLabelFallback = "Export chart";

    /// <summary>i18n key for the CSV item (web <c>chart.export.csv</c>).</summary>
    public const string CsvKey = "translation.chart.export.csv";

    /// <summary>English fallback for <see cref="CsvKey"/> (web second arg, verbatim).</summary>
    public const string CsvFallback = "Download data as CSV";

    /// <summary>i18n key for the PNG item (web <c>chart.export.png</c>).</summary>
    public const string PngKey = "translation.chart.export.png";

    /// <summary>English fallback for <see cref="PngKey"/> (web second arg, verbatim).</summary>
    public const string PngFallback = "Save as PNG";

    /// <summary>i18n key for the SVG item (web <c>chart.export.svg</c>).</summary>
    public const string SvgKey = "translation.chart.export.svg";

    /// <summary>English fallback for <see cref="SvgKey"/> (web second arg, verbatim).</summary>
    public const string SvgFallback = "Save as SVG";

    /// <summary>i18n key for the copy-image item (web <c>chart.export.copy</c>).</summary>
    public const string CopyKey = "translation.chart.export.copy";

    /// <summary>English fallback for <see cref="CopyKey"/> (web second arg, verbatim).</summary>
    public const string CopyFallback = "Copy image to clipboard";

    /// <summary>i18n key for the copy-success toast (web <c>chart.export.copySuccess</c>).</summary>
    public const string CopySuccessKey = "translation.chart.export.copySuccess";

    /// <summary>English fallback for <see cref="CopySuccessKey"/> (web second arg, verbatim).</summary>
    public const string CopySuccessFallback = "Chart image copied to clipboard";

    /// <summary>i18n key for the clipboard-unavailable toast (web <c>chart.export.copyFallback</c>).</summary>
    public const string CopyUnavailableKey = "translation.chart.export.copyFallback";

    /// <summary>
    /// English fallback for <see cref="CopyUnavailableKey"/> (web second arg, verbatim — the em dash is
    /// U+2014, matching the web string exactly).
    /// </summary>
    public const string CopyUnavailableFallback = "Clipboard not available \u2014 image downloaded instead";

    /// <summary>i18n key for the copy-failed toast (web <c>chart.export.copyFailed</c>).</summary>
    public const string CopyFailedKey = "translation.chart.export.copyFailed";

    /// <summary>English fallback for <see cref="CopyFailedKey"/> (web second arg, verbatim).</summary>
    public const string CopyFailedFallback = "Failed to copy chart image";
}

/// <summary>
/// The outcome of a copy-image action — the native port of the web <c>ClipboardOutcome</c> union
/// (web/src/hooks/useChartExport.ts L45: <c>'copied' | 'fallback' | 'failed'</c>). The view-model maps each
/// value to the matching toast severity + message, exactly as the web <c>handleCopy</c> does.
/// </summary>
public enum ChartExportClipboardOutcome
{
    /// <summary>web <c>'copied'</c> — the image reached the clipboard; announce success.</summary>
    Copied,

    /// <summary>
    /// web <c>'fallback'</c> — the clipboard API was unavailable or refused, so the image was downloaded
    /// instead; announce the informational "downloaded instead" message.
    /// </summary>
    Fallback,

    /// <summary>web <c>'failed'</c> — the snapshot itself failed; announce the error.</summary>
    Failed,
}

/// <summary>
/// The menu items the surface can present, in the web render order. <see cref="Csv"/> is conditional (web
/// renders it only when an <c>onExportCsv</c> callback is supplied); the image items are always present. Used
/// by the view to build the flyout and by tests to assert composition without a XAML host.
/// </summary>
public enum ChartExportMenuItemKind
{
    /// <summary>"Download data as CSV" — first item, present only when CSV export is wired (web <c>onExportCsv</c>).</summary>
    Csv,

    /// <summary>"Save as PNG" — web <c>onExportPNG</c>.</summary>
    Png,

    /// <summary>"Save as SVG" — web <c>onExportSVG</c>.</summary>
    Svg,

    /// <summary>"Copy image to clipboard" — web <c>onCopyImage</c>.</summary>
    Copy,
}

/// <summary>
/// Toast urgency — the native port of the web <c>ToastType</c> union
/// (web/src/components/feedback/Toast.tsx L33: <c>'success' | 'error' | 'info' | 'warning'</c>). The export
/// menu uses <see cref="Success"/>, <see cref="Info"/> and <see cref="Error"/>; <see cref="Warning"/> is
/// carried so the seam mirrors the full <c>ToastContextValue</c> shape.
/// </summary>
public enum ChartExportToastSeverity
{
    /// <summary>web <c>'success'</c> — polite status announcement (clipboard copy succeeded).</summary>
    Success,

    /// <summary>web <c>'error'</c> — assertive alert announcement (copy failed).</summary>
    Error,

    /// <summary>web <c>'info'</c> — polite status announcement (clipboard unavailable, downloaded instead).</summary>
    Info,

    /// <summary>web <c>'warning'</c> — polite status announcement (unused by this surface; carried for parity).</summary>
    Warning,
}

/// <summary>
/// A toast the surface wants to raise — the native projection of the web <c>handleCopy</c> branch
/// (web/src/components/charts/ChartExportMenu.tsx L108-L126) that picks <c>toast.success</c> /
/// <c>toast.info</c> / <c>toast.error</c> and its localized message from a <see cref="ChartExportClipboardOutcome"/>.
/// Pure data, so the outcome → toast mapping is unit-tested without a toast host.
/// </summary>
public readonly record struct ChartExportToastIntent(ChartExportToastSeverity Severity, string Message);

/// <summary>
/// PII-safe diagnostics for the chart export-menu surface (P1/S11 diagnostics contract). Export actions can
/// touch user files and chart imagery, so the collector records ONLY the operational
/// <see cref="RecordViewOpened"/> signal with the surface slug — never a file path, image bytes, or the
/// chart data. Thread-safe; mirrors the shipped surfaces' collectors.
/// </summary>
public sealed class ChartExportMenuDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChartExportMenuDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChartExportMenu</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(
            string.Create(
                CultureInfo.InvariantCulture,
                $"view.opened slug={ChartExportMenuRegistration.Slug}"));
    }
}
