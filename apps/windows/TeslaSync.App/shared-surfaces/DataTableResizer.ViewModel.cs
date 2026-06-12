using System.ComponentModel;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="DataTableResizer"/> view — the native port of the web
/// component body (web/src/components/ui/DataTableResizer.tsx). It mirrors the web source's behaviour exactly:
/// <list type="bullet">
///   <item>the controlled <c>columnKey</c> / <c>width</c> / <c>minWidth</c> / <c>maxWidth</c> / <c>label</c> "props"
///   drive the clamped <see cref="Width"/>, the bounds and the <see cref="AccessibleName"/>;</item>
///   <item><see cref="BeginResize"/> / <see cref="Resize"/> / <see cref="EndResize"/> reproduce the web
///   pointer-down / move / up drag (web L48-L77): a press marks dragging, each move reports a clamped width through
///   <see cref="IColumnResizeSink.OnResize"/>, and release commits through <see cref="IColumnResizeSink.OnResizeEnd"/>;</item>
///   <item><see cref="Nudge"/> / <see cref="ResetToHome"/> / <see cref="ResizeToMax"/> reproduce the web keyboard
///   handlers (web L106-L128: Left/Right ±8px, Home → 80px, End → maxWidth), each reporting <em>both</em>
///   <c>onResize</c> and <c>onResizeEnd</c> like the web key handler;</item>
///   <item><see cref="SetWidthFromAutomation"/> backs the native RangeValue pattern (a screen-reader / automation
///   client setting the width), committing through the same seam.</item>
/// </list>
/// Assigning the controlled props (<see cref="SetWidth"/> / <see cref="SetColumnKey"/> / <see cref="SetBounds"/> /
/// <see cref="SetLabel"/>) re-projects without re-announcing — the echo a parent performs after a resize. The view
/// binds the projected values and performs no I/O. Drive it from one confinement (the UI thread); it is not
/// internally synchronised.
/// </summary>
public sealed class DataTableResizerViewModel : INotifyPropertyChanged
{
    private readonly IColumnResizeSink _sink;
    private readonly ILocalizer _localizer;

    private string _columnKey;
    private string? _labelOverride;
    private int _minWidth;
    private int _maxWidth;
    private int _width;
    private bool _isDragging;
    private DataTableResizerProjection _projection;

    /// <summary>Creates the holder over the web props, the resize seam and the i18n facade.</summary>
    /// <param name="columnKey">The column key the handle resizes (web <c>columnKey</c>).</param>
    /// <param name="width">The initial column width in pixels (web <c>width</c>); clamped into the bounds.</param>
    /// <param name="sink">The resize seam (web <c>onResize</c> / <c>onResizeEnd</c>); pass <see cref="NoOpColumnResizeSink.Instance"/> when none is wired.</param>
    /// <param name="localizer">The i18n facade the accessible name resolves through.</param>
    /// <param name="minWidth">The minimum allowed width (web <c>minWidth</c>; defaults to 60).</param>
    /// <param name="maxWidth">The maximum allowed width (web <c>maxWidth</c>; defaults to 800).</param>
    /// <param name="label">An explicit accessible label, or null to compose from the column key (web <c>label</c>).</param>
    public DataTableResizerViewModel(
        string columnKey,
        double width,
        IColumnResizeSink sink,
        ILocalizer localizer,
        int minWidth = DataTableResizerRegistration.DefaultMinWidth,
        int maxWidth = DataTableResizerRegistration.DefaultMaxWidth,
        string? label = null)
    {
        ArgumentNullException.ThrowIfNull(columnKey);
        ArgumentNullException.ThrowIfNull(sink);
        ArgumentNullException.ThrowIfNull(localizer);

        _sink = sink;
        _localizer = localizer;
        _columnKey = columnKey;
        _labelOverride = label;
        _minWidth = minWidth;
        _maxWidth = maxWidth;
        _width = DataTableResizerMath.Clamp(width, minWidth, maxWidth);
        _projection = BuildProjection();
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical surface slug (<c>DataTableResizer</c>).</summary>
    public static string Slug => DataTableResizerRegistration.Slug;

    /// <summary>The current render projection (clamped width + bounds + drag flag + accessible name).</summary>
    public DataTableResizerProjection Projection => _projection;

    /// <summary>The column key the handle resizes (web <c>columnKey</c>).</summary>
    public string ColumnKey => _projection.ColumnKey;

    /// <summary>The current column width in pixels, clamped to the bounds (web <c>aria-valuenow</c>).</summary>
    public int Width => _projection.Width;

    /// <summary>The minimum allowed width in pixels (web <c>aria-valuemin</c> / <c>minWidth</c>).</summary>
    public int MinWidth => _projection.MinWidth;

    /// <summary>The maximum allowed width in pixels (web <c>aria-valuemax</c> / <c>maxWidth</c>).</summary>
    public int MaxWidth => _projection.MaxWidth;

    /// <summary>Whether a drag is in progress, driving the handle's highlight (web <c>dragging</c>).</summary>
    public bool IsDragging => _projection.IsDragging;

    /// <summary>The accessible name the splitter announces (web <c>aria-label</c>).</summary>
    public string AccessibleName => _projection.AccessibleName;

    /// <summary>
    /// Begin a drag (web <c>onPointerDown</c>): mark dragging so the handle highlights. The view records the pointer
    /// origin + start width and feeds raw widths to <see cref="Resize"/> as the pointer moves.
    /// </summary>
    public void BeginResize()
    {
        if (_isDragging)
        {
            return;
        }

        _isDragging = true;
        Reproject();
    }

    /// <summary>
    /// Report a continuous width while dragging (web <c>onPointerMove</c> → <c>onResize(clamp(startWidth + delta))</c>):
    /// clamp the raw width, update the projection and announce it through <see cref="IColumnResizeSink.OnResize"/>.
    /// </summary>
    /// <param name="rawWidth">The raw width in pixels (typically <c>startWidth + dragDelta</c>).</param>
    public void Resize(double rawWidth)
    {
        int next = DataTableResizerMath.Clamp(rawWidth, _minWidth, _maxWidth);
        _width = next;
        Reproject();
        _sink.OnResize(_columnKey, next);
    }

    /// <summary>
    /// End a drag (web <c>onPointerUp</c> / <c>onPointerCancel</c> → <c>finishDrag</c>): clear dragging and commit the
    /// current width through <see cref="IColumnResizeSink.OnResizeEnd"/>. A no-op when not dragging, like the web
    /// <c>finishDrag</c> early return.
    /// </summary>
    public void EndResize()
    {
        if (!_isDragging)
        {
            return;
        }

        _isDragging = false;
        Reproject();
        _sink.OnResizeEnd(_columnKey, _width);
    }

    /// <summary>
    /// Nudge the width by <paramref name="delta"/> pixels (web keyboard Left/Right: ±8px), clamped, reporting both
    /// <c>onResize</c> and <c>onResizeEnd</c> exactly like the web key handler.
    /// </summary>
    /// <param name="delta">The signed pixel delta (e.g. <c>-8</c> for Left, <c>+8</c> for Right).</param>
    public void Nudge(int delta) => Commit(DataTableResizerMath.Clamp(_width + delta, _minWidth, _maxWidth));

    /// <summary>Reset the width to the Home value (web <c>Home</c> → 80px), clamped and committed.</summary>
    public void ResetToHome() =>
        Commit(DataTableResizerMath.Clamp(DataTableResizerRegistration.HomeWidth, _minWidth, _maxWidth));

    /// <summary>Grow the width to the maximum (web <c>End</c> → maxWidth), clamped and committed.</summary>
    public void ResizeToMax() => Commit(DataTableResizerMath.Clamp(_maxWidth, _minWidth, _maxWidth));

    /// <summary>
    /// Set the width from an automation / RangeValue client, clamped and committed through the resize seam (the native
    /// keyboard-equivalent path a screen reader drives).
    /// </summary>
    /// <param name="value">The requested width in pixels.</param>
    public void SetWidthFromAutomation(double value) =>
        Commit(DataTableResizerMath.Clamp(value, _minWidth, _maxWidth));

    /// <summary>
    /// Echo a controlled width (web <c>width</c> prop change after a resize): clamp + re-project without announcing
    /// through the seam. A no-op when the clamped width is unchanged.
    /// </summary>
    /// <param name="width">The new width in pixels.</param>
    public void SetWidth(double width)
    {
        _width = DataTableResizerMath.Clamp(width, _minWidth, _maxWidth);
        Reproject();
    }

    /// <summary>Push a new column key (web <c>columnKey</c> prop change); re-projects the accessible name.</summary>
    /// <param name="columnKey">The new column key.</param>
    public void SetColumnKey(string columnKey)
    {
        ArgumentNullException.ThrowIfNull(columnKey);
        _columnKey = columnKey;
        Reproject();
    }

    /// <summary>
    /// Push new bounds (web <c>minWidth</c> / <c>maxWidth</c> prop change); re-clamps the current width into the new
    /// range and re-projects.
    /// </summary>
    /// <param name="minWidth">The new minimum allowed width.</param>
    /// <param name="maxWidth">The new maximum allowed width.</param>
    public void SetBounds(int minWidth, int maxWidth)
    {
        _minWidth = minWidth;
        _maxWidth = maxWidth;
        _width = DataTableResizerMath.Clamp(_width, minWidth, maxWidth);
        Reproject();
    }

    /// <summary>Push a new accessible label override (web <c>label</c> prop change); re-projects the accessible name.</summary>
    /// <param name="label">The new explicit label, or null/blank to compose from the column key.</param>
    public void SetLabel(string? label)
    {
        _labelOverride = label;
        Reproject();
    }

    private void Commit(int next)
    {
        _width = next;
        Reproject();
        _sink.OnResize(_columnKey, next);
        _sink.OnResizeEnd(_columnKey, next);
    }

    private DataTableResizerProjection BuildProjection() => DataTableResizerProjection.Project(
        _columnKey,
        _width,
        _minWidth,
        _maxWidth,
        _labelOverride,
        _isDragging,
        _localizer);

    private void Reproject()
    {
        DataTableResizerProjection next = BuildProjection();
        if (next == _projection)
        {
            return;
        }

        _projection = next;
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Projection)));
    }
}
