using System.Globalization;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + the pure clamp/label adapter for the column-resize handle — the native mirror of the web
/// <c>DataTableResizer</c> (web/src/components/ui/DataTableResizer.tsx). The web component is a fully presentational
/// drag handle on the right edge of a resizable <c>&lt;th&gt;</c>: it follows the WAI-ARIA Authoring Practices
/// "Window Splitter" pattern (<c>role="separator"</c> + <c>aria-orientation="vertical"</c> +
/// <c>aria-valuenow/min/max</c> + <c>tabIndex=0</c>), reports a continuous width while the pointer drags
/// (<c>onResize</c>) and a final width on release (<c>onResizeEnd</c>), and is keyboard-operable
/// (Left/Right nudge ±8px, Home resets to 80px, End maxes out). It reads no network data and renders no titles of
/// its own, so this carries the diagnostics slug, the automation id, the ARIA role/orientation contract, the
/// default bound + keyboard constants (web prop defaults), the single i18n key behind the accessible label (web
/// <c>label ?? `Resize column ${columnKey}`</c>) and the clamp maths the drag / keyboard / automation paths share.
/// UI-free so every value is asserted headlessly.
/// </summary>
public static class DataTableResizerRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "DataTableResizer";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c> (it is an
    /// anonymous splitter handle), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "data-table-resizer";

    /// <summary>
    /// ARIA role the surface reproduces — the WAI-ARIA Window Splitter (web <c>role="separator"</c>). The native peer
    /// reports <c>AutomationControlType.Separator</c> and a RangeValue pattern to mirror the value semantics.
    /// </summary>
    public const string SeparatorRole = "separator";

    /// <summary>ARIA orientation the splitter declares — vertical (web <c>aria-orientation="vertical"</c>).</summary>
    public const string Orientation = "vertical";

    /// <summary>Default minimum column width in pixels when resizing (web <c>minWidth = 60</c>).</summary>
    public const int DefaultMinWidth = 60;

    /// <summary>Default maximum column width in pixels when resizing (web <c>maxWidth = 800</c>).</summary>
    public const int DefaultMaxWidth = 800;

    /// <summary>Keyboard nudge increment in pixels (web Left/Right shrink/grow by 8px).</summary>
    public const int KeyboardStep = 8;

    /// <summary>The width Home resets the column to, in pixels (web <c>Home</c> → 80px).</summary>
    public const int HomeWidth = 80;

    /// <summary>
    /// i18n key behind the accessible label (web <c>label ?? `Resize column ${columnKey}`</c>). The catalog stores the
    /// value with the i18next token <c>{{col}}</c>; the .NET fallback below uses the positional token <c>{0}</c>, so the
    /// resolved string is composed with <see cref="string.Format(IFormatProvider, string, object?)"/>.
    /// </summary>
    public const string ResizeLabelKey = "translation.table.columns.resizeLabel";

    /// <summary>
    /// English fallback for <see cref="ResizeLabelKey"/> in .NET positional form — the transform of the web
    /// <c>`Resize column ${columnKey}`</c> template into <c>"Resize column {0}"</c>, matching the P1/S10 catalog entry
    /// <c>table.columns.resizeLabel</c> ("Resize column {{col}}").
    /// </summary>
    public const string ResizeLabelFallback = "Resize column {0}";

    /// <summary>
    /// The accessible name for the handle — the native port of the web
    /// <c>aria-label={label ?? `Resize column ${columnKey}`}</c>. A non-blank <paramref name="labelOverride"/> is used
    /// verbatim (trimmed); otherwise the column key is composed into the localized "Resize column {col}" template.
    /// </summary>
    /// <param name="columnKey">The column key the handle resizes (web <c>columnKey</c>).</param>
    /// <param name="labelOverride">An explicit accessible label, or null/blank to compose from the column key (web <c>label</c>).</param>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    public static string ResolveAccessibleName(string? columnKey, string? labelOverride, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (!string.IsNullOrWhiteSpace(labelOverride))
        {
            return labelOverride.Trim();
        }

        string template = localizer.GetString(ResizeLabelKey, ResizeLabelFallback);
        string key = (columnKey ?? string.Empty).Trim();
        return string.Format(CultureInfo.CurrentCulture, template, key).Trim();
    }
}

/// <summary>
/// The pure clamp helpers behind the resize handle — the native port of the web component's inline
/// <c>clamp</c> (web/src/components/ui/DataTableResizer.tsx L43-L46:
/// <c>Math.max(minWidth, Math.min(maxWidth, Math.round(n)))</c>). Every method is static, culture-independent and
/// side-effect-free so the handle's behaviour is unit-tested without a view or a UI thread. Rounding mirrors
/// JavaScript's <c>Math.round</c> for the non-negative pixel widths the surface produces.
/// </summary>
public static class DataTableResizerMath
{
    /// <summary>
    /// Clamp a raw width to the integer range [<paramref name="minWidth"/>, <paramref name="maxWidth"/>], rounding to
    /// the nearest pixel first (web <c>Math.max(minWidth, Math.min(maxWidth, Math.round(n)))</c>). When the bounds are
    /// inverted the minimum wins, exactly like the chained JS min/max.
    /// </summary>
    /// <param name="value">The raw width in pixels (typically <c>startWidth + dragDelta</c>).</param>
    /// <param name="minWidth">The minimum allowed width.</param>
    /// <param name="maxWidth">The maximum allowed width.</param>
    public static int Clamp(double value, int minWidth, int maxWidth)
    {
        long rounded = (long)Math.Round(value, MidpointRounding.AwayFromZero);
        long bounded = Math.Min(maxWidth, rounded);
        return (int)Math.Max(minWidth, bounded);
    }
}

/// <summary>
/// Pure projection of the resize handle's render inputs — the native port of the web component body
/// (web/src/components/ui/DataTableResizer.tsx). It clamps the current <see cref="Width"/> into
/// [<see cref="MinWidth"/>, <see cref="MaxWidth"/>] (so <c>aria-valuenow</c> is always in range), carries the
/// <see cref="IsDragging"/> flag that drives the handle's highlight (web <c>dragging &amp;&amp; 'opacity-100 …'</c>)
/// and resolves the <see cref="AccessibleName"/> (web <c>aria-label</c>). Kept a value type so the adapter is
/// unit-testable and snapshot-comparable without a view-model or a UI thread.
/// </summary>
public readonly record struct DataTableResizerProjection
{
    private DataTableResizerProjection(
        string columnKey,
        int width,
        int minWidth,
        int maxWidth,
        bool isDragging,
        string accessibleName)
    {
        ColumnKey = columnKey;
        Width = width;
        MinWidth = minWidth;
        MaxWidth = maxWidth;
        IsDragging = isDragging;
        AccessibleName = accessibleName;
    }

    /// <summary>The column key the handle resizes (web <c>columnKey</c>).</summary>
    public string ColumnKey { get; }

    /// <summary>The current column width in pixels, clamped to the bounds (web <c>aria-valuenow</c>).</summary>
    public int Width { get; }

    /// <summary>The minimum allowed width in pixels (web <c>aria-valuemin</c> / <c>minWidth</c>).</summary>
    public int MinWidth { get; }

    /// <summary>The maximum allowed width in pixels (web <c>aria-valuemax</c> / <c>maxWidth</c>).</summary>
    public int MaxWidth { get; }

    /// <summary>Whether a drag is in progress, driving the handle's highlight (web <c>dragging</c>).</summary>
    public bool IsDragging { get; }

    /// <summary>The accessible name the splitter announces (web <c>aria-label</c>).</summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Project the render inputs, reproducing the web component body: the width is rounded + clamped into the bounds,
    /// and the accessible name resolves the label override or the localized "Resize column {col}" default.
    /// </summary>
    /// <param name="columnKey">The column key the handle resizes (web <c>columnKey</c>).</param>
    /// <param name="width">The current (raw) column width in pixels (web <c>width</c>).</param>
    /// <param name="minWidth">The minimum allowed width (web <c>minWidth</c>).</param>
    /// <param name="maxWidth">The maximum allowed width (web <c>maxWidth</c>).</param>
    /// <param name="labelOverride">An explicit accessible label, or null/blank to compose from the column key (web <c>label</c>).</param>
    /// <param name="isDragging">Whether a drag is in progress (web <c>dragging</c>).</param>
    /// <param name="localizer">The i18n facade the default label resolves through.</param>
    public static DataTableResizerProjection Project(
        string? columnKey,
        double width,
        int minWidth,
        int maxWidth,
        string? labelOverride,
        bool isDragging,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        string key = (columnKey ?? string.Empty).Trim();
        return new DataTableResizerProjection(
            key,
            DataTableResizerMath.Clamp(width, minWidth, maxWidth),
            minWidth,
            maxWidth,
            isDragging,
            DataTableResizerRegistration.ResolveAccessibleName(key, labelOverride, localizer));
    }
}

/// <summary>
/// The sink the handle announces width changes through — the native seam for the web <c>onResize</c> (continuous,
/// every pointer move / keyboard step) and <c>onResizeEnd</c> (committed, on pointer release / per keyboard step).
/// Hosts wire it to their column-width state + persistence; tests record the calls. Pass
/// <see cref="NoOpColumnResizeSink.Instance"/> when nothing is wired (the web no-op callback equivalent).
/// </summary>
public interface IColumnResizeSink
{
    /// <summary>A continuous width update while resizing (web <c>onResize(next)</c>).</summary>
    /// <param name="columnKey">The column key being resized.</param>
    /// <param name="width">The new clamped width in pixels.</param>
    void OnResize(string columnKey, int width);

    /// <summary>The committed final width (web <c>onResizeEnd(final)</c>); use for persistence.</summary>
    /// <param name="columnKey">The column key that was resized.</param>
    /// <param name="width">The committed clamped width in pixels.</param>
    void OnResizeEnd(string columnKey, int width);
}

/// <summary>
/// An <see cref="IColumnResizeSink"/> that ignores every change — the native analogue of mounting the web component
/// with a no-op <c>onResize</c> and no <c>onResizeEnd</c>. Lets a handle be hosted in a gallery / design host without
/// wiring persistence.
/// </summary>
public sealed class NoOpColumnResizeSink : IColumnResizeSink
{
    /// <summary>The shared singleton instance.</summary>
    public static NoOpColumnResizeSink Instance { get; } = new();

    private NoOpColumnResizeSink()
    {
    }

    /// <inheritdoc />
    public void OnResize(string columnKey, int width)
    {
        // Intentionally ignored: no host is wired to the continuous width.
    }

    /// <inheritdoc />
    public void OnResizeEnd(string columnKey, int width)
    {
        // Intentionally ignored: no host is wired to the committed width.
    }
}

/// <summary>
/// PII-safe diagnostics for the resize handle (P1/S11 diagnostics contract). The surface carries only a transient
/// column width and a column key, so the collector records nothing but the operational <c>view.opened</c> event with
/// the surface slug — never a width or column key. Thread-safe; mirrors the peer surfaces' collectors.
/// </summary>
public sealed class DataTableResizerDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public DataTableResizerDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DataTableResizer</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DataTableResizerRegistration.Slug}");
    }
}
