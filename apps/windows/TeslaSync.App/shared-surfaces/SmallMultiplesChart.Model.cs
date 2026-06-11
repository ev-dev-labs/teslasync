using System.Globalization;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// One time-ordered input row for the <c>SmallMultiplesChart</c> surface — the native mirror of a single web
/// <c>data</c> row (web/src/components/charts/SmallMultiplesChart.tsx L50-L51), which holds the x-axis
/// <c>timestamp</c> plus an arbitrary set of series keys. <see cref="Timestamp"/> is the shared x-domain instant
/// (the web default <c>xKey = 'timestamp'</c>) and <see cref="Values"/> maps each present series key to its
/// measured value at that instant; a key that is absent — or whose value is non-finite — contributes no point to
/// that series' cell, exactly like the web <c>isFinitePoint</c> filter. SI on disk; the value is whatever the
/// caller measured (the surface is signal-agnostic, just like the web component). UI-free so the projection is
/// asserted without a XAML host.
/// </summary>
public sealed record SmallMultiplesSample
{
    /// <summary>The shared x-domain instant for this row (web <c>row[xKey]</c>, default <c>timestamp</c>).</summary>
    public required DateTimeOffset Timestamp { get; init; }

    /// <summary>
    /// The measured value per series key at <see cref="Timestamp"/> (web arbitrary <c>row[sig]</c> keys). A key
    /// that is absent or maps to a non-finite value yields no point for that series (web <c>isFinitePoint</c>).
    /// </summary>
    public required IReadOnlyDictionary<string, double> Values { get; init; }
}

/// <summary>
/// A series to render as one cell — the native mirror of one entry of the web <c>series</c> array together with
/// its optional <c>seriesLabel(sig)</c> and <c>colorIndex[sig]</c> overrides
/// (web/src/components/charts/SmallMultiplesChart.tsx L52-L74). <see cref="Key"/> selects the value out of each
/// <see cref="SmallMultiplesSample"/>; <see cref="Label"/> defaults to the key (web <c>seriesLabel ? … : sig</c>)
/// and <see cref="ColorIndex"/> defaults to the series' position (web <c>colorIndex?.[sig] ?? i</c>). UI-free.
/// </summary>
public sealed record SmallMultiplesSeries
{
    /// <summary>The value key projected out of each row into this cell (web <c>sig</c>).</summary>
    public required string Key { get; init; }

    /// <summary>Optional friendly label; null/empty falls back to <see cref="Key"/> (web <c>seriesLabel(sig)</c>).</summary>
    public string? Label { get; init; }

    /// <summary>Optional categorical palette index; null falls back to the series position (web <c>colorIndex[sig] ?? i</c>).</summary>
    public int? ColorIndex { get; init; }
}

/// <summary>
/// The grid layout + downsampling configuration — the native mirror of the web component's layout / performance
/// props (web/src/components/charts/SmallMultiplesChart.tsx L57-L86): <c>columns</c>, <c>cellMinWidth</c>,
/// <c>cellHeight</c>, <c>maxPointsPerCell</c> and the per-cell <c>emptyCellLabel</c> override. The defaults match
/// the web defaults exactly (280 px min cell width, 120 px cell height, 400 points per cell). UI-free.
/// </summary>
public sealed record SmallMultiplesLayout
{
    /// <summary>Force a specific column count (web <c>columns</c>); null auto-fills by <see cref="CellMinWidth"/>.</summary>
    public int? Columns { get; init; }

    /// <summary>Minimum cell width for the auto-fill grid in pixels (web <c>cellMinWidth</c>, default 280).</summary>
    public double CellMinWidth { get; init; } = SmallMultiplesChartRegistration.DefaultCellMinWidth;

    /// <summary>Height of each cell's chart body in pixels (web <c>cellHeight</c>, default 120).</summary>
    public double CellHeight { get; init; } = SmallMultiplesChartRegistration.DefaultCellHeight;

    /// <summary>Per-cell stride-downsample cap (web <c>maxPointsPerCell</c>, default 400; clamped to ≥ 1).</summary>
    public int MaxPointsPerCell { get; init; } = SmallMultiplesChartRegistration.DefaultMaxPointsPerCell;

    /// <summary>Optional empty-cell label override (web <c>emptyCellLabel</c>); null uses the localized "No data".</summary>
    public string? EmptyCellLabel { get; init; }
}

/// <summary>
/// One projected cell ready for display — the native analogue of one rendered <c>SmallMultiplesCell</c>
/// (web/src/components/charts/SmallMultiplesChart.tsx L212-L319). It carries the resolved <see cref="Label"/> and
/// <see cref="ColorIndex"/>, the brand-palette <see cref="ColorBrushKey"/> the view tints the line + dot with
/// (the native, theme-aware analogue of the web inline <c>CHART_COLORS[idx]</c>), the <see cref="HasData"/> flag
/// (web <c>projection.hasData</c>) that selects the chart vs the "No data" body, the projected + downsampled
/// <see cref="Points"/>, and the localized x-domain <see cref="RangeStartLabel"/> / <see cref="RangeEndLabel"/>
/// captions (the native binding of the web <c>useDateFormat().formatTime</c> x-axis tick formatter). UI-free.
/// </summary>
public sealed record SmallMultiplesCell
{
    /// <summary>The series key this cell renders (web <c>sig</c>); the value passed to the cell-click handler.</summary>
    public required string Key { get; init; }

    /// <summary>The resolved display label (web <c>label</c>).</summary>
    public required string Label { get; init; }

    /// <summary>The resolved categorical palette index (web <c>idx</c>, clamped to ≥ 0).</summary>
    public required int ColorIndex { get; init; }

    /// <summary>The brand-palette brush resource key (native <c>ChartPalette.KeyForIndex</c>; web <c>CHART_COLORS[idx]</c>).</summary>
    public required string ColorBrushKey { get; init; }

    /// <summary>True when the series has at least one finite point (web <c>hasData</c>); false renders "No data".</summary>
    public required bool HasData { get; init; }

    /// <summary>The projected, stride-downsampled points in x-order (web per-cell <c>rows</c>); empty when no data.</summary>
    public required IReadOnlyList<ChartPoint> Points { get; init; }

    /// <summary>Localized time of the first point (web first x tick); null when <see cref="HasData"/> is false.</summary>
    public string? RangeStartLabel { get; init; }

    /// <summary>Localized time of the last point (web last x tick); null when <see cref="HasData"/> is false.</summary>
    public string? RangeEndLabel { get; init; }
}

/// <summary>
/// Pure projection of the time-aligned input matrix into per-cell display data — the native port of the web
/// component's <c>cellProjections</c> memo and its three performance layers
/// (web/src/components/charts/SmallMultiplesChart.tsx L14-L23, L98-L149). For each series it walks the rows once,
/// keeping only those where that series has a finite numeric value (the web <c>isFinitePoint</c> per-cell
/// projection, NOT the full time-aligned matrix), then stride-downsamples to <c>maxPointsPerCell</c> preserving
/// the first and last point (the web <c>strideSample</c>). The label and colour index are resolved with the same
/// fallbacks the web uses (<c>seriesLabel ?? key</c>, <c>colorIndex ?? position</c>, <c>Math.max(0, idx)</c>). No
/// WinUI types — exercised headlessly.
/// </summary>
public static class SmallMultiplesProjection
{
    /// <summary>True for a real, plottable number — the native <c>Number.isFinite</c> (rejects NaN / ±∞).</summary>
    public static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    /// <summary>
    /// Stride-downsample <paramref name="rows"/> to at most <paramref name="cap"/> entries, always preserving the
    /// first and last (the native port of the web <c>strideSample</c>). <paramref name="cap"/> is clamped to ≥ 1
    /// so a zero/negative cap can never divide by zero (the web default is 400).
    /// </summary>
    public static IReadOnlyList<T> StrideSample<T>(IReadOnlyList<T> rows, int cap)
    {
        ArgumentNullException.ThrowIfNull(rows);
        int limit = Math.Max(1, cap);
        if (rows.Count <= limit)
        {
            return rows;
        }

        int stride = (int)Math.Ceiling(rows.Count / (double)limit);
        var sampled = new List<T>();
        int lastIndex = -1;
        for (int i = 0; i < rows.Count; i += stride)
        {
            sampled.Add(rows[i]);
            lastIndex = i;
        }

        if (lastIndex != rows.Count - 1)
        {
            sampled.Add(rows[rows.Count - 1]);
        }

        return sampled;
    }

    /// <summary>
    /// Project one series out of the row matrix into its finite, downsampled points — the per-cell body of the
    /// web <c>cellProjections</c> loop. Each kept row becomes a <see cref="ChartPoint"/> whose x is the row's
    /// <see cref="SmallMultiplesSample.Timestamp"/> as Unix milliseconds and whose y is the series value.
    /// </summary>
    public static IReadOnlyList<ChartPoint> ProjectSeries(
        IReadOnlyList<SmallMultiplesSample> samples,
        string key,
        int maxPointsPerCell)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentException.ThrowIfNullOrEmpty(key);

        var points = new List<ChartPoint>();
        foreach (var sample in samples)
        {
            if (sample.Values.TryGetValue(key, out double value) && IsFinite(value))
            {
                points.Add(new ChartPoint(sample.Timestamp.ToUnixTimeMilliseconds(), value));
            }
        }

        return StrideSample(points, maxPointsPerCell);
    }

    /// <summary>
    /// Project the whole grid: one <see cref="SmallMultiplesCell"/> per series, preserving series order (web
    /// <c>series.map</c>). Labels, colour indices and the x-domain range captions are resolved here so the view
    /// only renders. The <paramref name="timeFormatter"/> binds the web <c>useDateFormat().formatTime</c>.
    /// </summary>
    public static IReadOnlyList<SmallMultiplesCell> ProjectCells(
        IReadOnlyList<SmallMultiplesSample> samples,
        IReadOnlyList<SmallMultiplesSeries> series,
        SmallMultiplesLayout layout,
        ISmallMultiplesTimeFormatter timeFormatter)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(series);
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(timeFormatter);

        var cells = new List<SmallMultiplesCell>(series.Count);
        for (int i = 0; i < series.Count; i++)
        {
            cells.Add(ToCell(samples, series[i], i, layout, timeFormatter));
        }

        return cells;
    }

    /// <summary>Project a single series descriptor at position <paramref name="position"/> into its display cell.</summary>
    public static SmallMultiplesCell ToCell(
        IReadOnlyList<SmallMultiplesSample> samples,
        SmallMultiplesSeries descriptor,
        int position,
        SmallMultiplesLayout layout,
        ISmallMultiplesTimeFormatter timeFormatter)
    {
        ArgumentNullException.ThrowIfNull(samples);
        ArgumentNullException.ThrowIfNull(descriptor);
        ArgumentNullException.ThrowIfNull(layout);
        ArgumentNullException.ThrowIfNull(timeFormatter);

        // web: const idx = colorIndex?.[sig] ?? i; const color = CHART_COLORS[Math.max(0, idx) % …].
        int colorIndex = Math.Max(0, descriptor.ColorIndex ?? position);
        var points = ProjectSeries(samples, descriptor.Key, layout.MaxPointsPerCell);
        bool hasData = points.Count > 0;
        string label = string.IsNullOrEmpty(descriptor.Label) ? descriptor.Key : descriptor.Label;

        return new SmallMultiplesCell
        {
            Key = descriptor.Key,
            Label = label,
            ColorIndex = colorIndex,
            ColorBrushKey = ChartPalette.KeyForIndex(colorIndex),
            HasData = hasData,
            Points = points,
            RangeStartLabel = hasData ? timeFormatter.FormatTime(points[0].X) : null,
            RangeEndLabel = hasData ? timeFormatter.FormatTime(points[points.Count - 1].X) : null,
        };
    }
}

/// <summary>
/// Canonical metadata + i18n key for the <c>SmallMultiplesChart</c> shared surface — the native mirror of the web
/// component at <c>web/src/components/charts/SmallMultiplesChart.tsx</c>. The web surface ships exactly one literal
/// string, the empty-cell label (<c>t('smallMultiples.noData', 'No data')</c>), keyed here with that literal as
/// the English fallback so the native view-model resolves it through the i18n facade and carries no inline copy.
/// The default cell sizing constants mirror the web prop defaults verbatim. UI-free so every value is asserted
/// without a resource host.
/// </summary>
public static class SmallMultiplesChartRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "SmallMultiplesChart";

    /// <summary>
    /// Root automation id set on the surface while it has cells — the stable handle a UI-automation test uses to
    /// find the grid (the native analogue of the web <c>data-testid="small-multiples-grid"</c>).
    /// </summary>
    public const string RootAutomationId = "small-multiples-chart-root";

    /// <summary>i18n key for the empty-cell label (web <c>smallMultiples.noData</c>).</summary>
    public const string NoDataKey = "smallMultiples.noData";

    /// <summary>English fallback for <see cref="NoDataKey"/> (web second arg).</summary>
    public const string NoDataFallback = "No data";

    /// <summary>Default minimum cell width in pixels (web <c>cellMinWidth = 280</c>).</summary>
    public const double DefaultCellMinWidth = 280;

    /// <summary>Default cell chart-body height in pixels (web <c>cellHeight = 120</c>).</summary>
    public const double DefaultCellHeight = 120;

    /// <summary>Default per-cell stride-downsample cap (web <c>maxPointsPerCell = 400</c>).</summary>
    public const int DefaultMaxPointsPerCell = 400;

    /// <summary>The localized empty-cell label (web <c>t('smallMultiples.noData', 'No data')</c>).</summary>
    public static string NoData(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(NoDataKey, NoDataFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>SmallMultiplesChart</c> surface (P1/S11 diagnostics contract). Series keys,
/// labels and measured values are arbitrary, potentially fleet-identifying content, so the collector records ONLY
/// the operational <see cref="RecordViewOpened"/> signal with the surface slug — never a key, label, value or
/// timestamp. Thread-safe; mirrors the sibling presentational surfaces' collectors.
/// </summary>
public sealed class SmallMultiplesChartDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SmallMultiplesChartDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SmallMultiplesChart</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke(string.Create(
            CultureInfo.InvariantCulture, $"view.opened slug={SmallMultiplesChartRegistration.Slug}"));
    }
}
