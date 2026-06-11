using System.ComponentModel;
using System.Runtime.CompilerServices;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// UI-thread-free state holder backing the WinUI <see cref="SmallMultiplesChart"/> view — the native port of the
/// web component body (web/src/components/charts/SmallMultiplesChart.tsx). The web component is a controlled,
/// presentational grid: it takes <c>data</c> + <c>series</c> (plus layout / colour / label / click props),
/// projects one cell per series and renders either a mini line chart or a "No data" body per cell. This holder
/// reproduces that exactly over an injected <see cref="ISmallMultiplesChartSource"/> (the P1/S8 seam): it exposes
/// the projected <see cref="Cells"/> (web <c>cellProjections</c> → <c>series.map</c>), the <see cref="IsEmpty"/>
/// flag (no series → a single friendly empty state rather than a blank box), the localized
/// <see cref="NoDataLabel"/>, the layout knobs the view lays the grid out with, and the <see cref="SelectCell"/>
/// command (web <c>onCellClick</c>), re-raising the derived state whenever the source changes.
/// </summary>
/// <remarks>
/// Because the web source is a controlled component with no data fetch of its own, there is no loading / error /
/// stale / offline branch to model (the web source has none); its only states are the empty grid (rendered as a
/// friendly "No data", <see cref="IsEmpty"/>) and the populated grid (<see cref="Cells"/>, each cell itself either
/// a chart or the per-cell "No data" body) — the same rationale as the sibling presentational chart surfaces. The
/// view never performs HTTP; it observes this holder and renders. Drive it from one confinement (the UI thread);
/// it is not internally synchronised.
/// </remarks>
public sealed class SmallMultiplesChartViewModel : INotifyPropertyChanged, IDisposable
{
    private readonly ISmallMultiplesChartSource _source;
    private readonly ILocalizer _localizer;
    private readonly ISmallMultiplesTimeFormatter _timeFormatter;
    private readonly SmallMultiplesChartDiagnostics _diagnostics;

    private bool _opened;
    private bool _disposed;

    /// <summary>Creates the holder over the chart seam, the i18n facade, the time formatter and an optional diagnostics sink.</summary>
    /// <param name="source">The chart data/config seam (P1/S8) the surface binds to.</param>
    /// <param name="localizer">The i18n facade the empty-cell label resolves through.</param>
    /// <param name="timeFormatter">The x-axis time formatter (web <c>useDateFormat</c>); null uses the shared default.</param>
    /// <param name="diagnostics">The PII-safe diagnostics sink (defaults to a no-op collector).</param>
    public SmallMultiplesChartViewModel(
        ISmallMultiplesChartSource source,
        ILocalizer localizer,
        ISmallMultiplesTimeFormatter? timeFormatter = null,
        SmallMultiplesChartDiagnostics? diagnostics = null)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _localizer = localizer;
        _timeFormatter = timeFormatter ?? SmallMultiplesTimeFormatter.Instance;
        _diagnostics = diagnostics ?? new SmallMultiplesChartDiagnostics();
        _source.Changed += OnSourceChanged;
    }

    /// <inheritdoc />
    public event PropertyChangedEventHandler? PropertyChanged;

    /// <summary>The canonical diagnostics slug this surface registers under (<c>SmallMultiplesChart</c>).</summary>
    public static string Slug => SmallMultiplesChartRegistration.Slug;

    /// <summary>The projected cells in render order (web <c>series.map</c>); empty when <see cref="IsEmpty"/>.</summary>
    public IReadOnlyList<SmallMultiplesCell> Cells =>
        SmallMultiplesProjection.ProjectCells(_source.Samples, _source.Series, _source.Layout, _timeFormatter);

    /// <summary>
    /// True when there are no series — the grid would render no cells, so the view shows a single friendly
    /// "No data" surface instead of a blank box. (The web grid renders an empty container; the native surface
    /// keeps the region meaningful with the same localized label.)
    /// </summary>
    public bool IsEmpty => _source.Series.Count == 0;

    /// <summary>True when there is at least one cell to render (the inverse of <see cref="IsEmpty"/>).</summary>
    public bool HasCells => !IsEmpty;

    /// <summary>
    /// The empty-cell / empty-grid label — the source's <see cref="SmallMultiplesLayout.EmptyCellLabel"/> override
    /// when set, else the localized "No data" (web <c>emptyCellLabel ?? t('smallMultiples.noData', 'No data')</c>).
    /// </summary>
    public string NoDataLabel =>
        string.IsNullOrEmpty(_source.Layout.EmptyCellLabel)
            ? SmallMultiplesChartRegistration.NoData(_localizer)
            : _source.Layout.EmptyCellLabel;

    /// <summary>The forced column count, or null to auto-fill by <see cref="CellMinWidth"/> (web <c>columns</c>).</summary>
    public int? Columns => _source.Layout.Columns;

    /// <summary>The minimum cell width in pixels for the auto-fill grid (web <c>cellMinWidth</c>).</summary>
    public double CellMinWidth => _source.Layout.CellMinWidth;

    /// <summary>The chart-body height in pixels for each cell (web <c>cellHeight</c>).</summary>
    public double CellHeight => _source.Layout.CellHeight;

    /// <summary>True when cells are drillable (web <c>Boolean(onCellClick)</c>); drives the cell's button role.</summary>
    public bool IsInteractive => _source.IsInteractive;

    /// <summary>
    /// Drill into a series' cell (web <c>onCellClick(sig)</c>) by forwarding to the source. A call after disposal,
    /// or on a non-interactive surface, is a no-op.
    /// </summary>
    /// <param name="seriesKey">The key of the activated cell's series.</param>
    public void SelectCell(string seriesKey)
    {
        if (_disposed)
        {
            return;
        }

        _source.SelectCell(seriesKey);
    }

    /// <summary>
    /// Record that the surface was opened (web mount) — emits the <c>view.opened</c> diagnostics event exactly
    /// once. Idempotent so a re-entrant load does not double-count.
    /// </summary>
    public void NotifyOpened()
    {
        if (_opened || _disposed)
        {
            return;
        }

        _opened = true;
        _diagnostics.RecordViewOpened();
    }

    /// <summary>Detach from the source seam and stop projecting (idempotent).</summary>
    public void Dispose()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        _source.Changed -= OnSourceChanged;
        GC.SuppressFinalize(this);
    }

    private void OnSourceChanged(object? sender, EventArgs e)
    {
        // The web parent re-renders the controlled grid with new props; re-project the derived state.
        Raise(nameof(IsEmpty));
        Raise(nameof(HasCells));
        Raise(nameof(NoDataLabel));
        Raise(nameof(Columns));
        Raise(nameof(CellMinWidth));
        Raise(nameof(CellHeight));
        Raise(nameof(IsInteractive));
        Raise(nameof(Cells));
    }

    private void Raise([CallerMemberName] string? name = null) =>
        PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(name));
}
