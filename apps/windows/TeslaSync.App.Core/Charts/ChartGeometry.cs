namespace TeslaSync.App.Core.Charts;

/// <summary>A device-independent 2-D point in chart pixel space.</summary>
public readonly record struct PointD(double X, double Y);

/// <summary>A device-independent rectangle in chart pixel space.</summary>
public readonly record struct RectD(double X, double Y, double Width, double Height);

/// <summary>Plot-area insets (the gutter reserved for axes / labels).</summary>
public readonly record struct EdgeInsets(double Left, double Top, double Right, double Bottom);

/// <summary>A computed circular-arc segment (used by gauge / donut rendering).</summary>
public readonly record struct ArcGeometry(
    PointD Start,
    PointD End,
    double Radius,
    bool IsLargeArc,
    bool SweepClockwise);

/// <summary>A single pie / donut wedge with its mid-angle anchor for labelling.</summary>
public readonly record struct PieSlice(
    double StartAngleDeg,
    double SweepAngleDeg,
    double Value,
    int ColorIndex,
    string Label);

/// <summary>
/// Pure geometry for the native WinUI chart surfaces. Every method maps typed
/// <see cref="ChartSeries"/> / <see cref="ChartPoint"/> data into pixel-space
/// shapes (polylines, bars, arcs, slices, radar polygons) so the WinUI controls
/// only have to lay the shapes onto a Canvas. UI-thread-free and fully testable.
/// </summary>
public static class ChartGeometry
{
    /// <summary>The drawable plot rectangle inside <paramref name="insets"/>.</summary>
    public static RectD PlotArea(double width, double height, EdgeInsets insets)
    {
        var w = Math.Max(0, width - insets.Left - insets.Right);
        var h = Math.Max(0, height - insets.Top - insets.Bottom);
        return new RectD(insets.Left, insets.Top, w, h);
    }

    /// <summary>Domain bounds (min/max) of X across every supplied series.</summary>
    public static (double Min, double Max) XDomain(IReadOnlyList<ChartSeries> series)
    {
        ArgumentNullException.ThrowIfNull(series);
        return Domain(series, static p => p.X);
    }

    /// <summary>
    /// Domain bounds of Y across every series. Always includes zero so bars and
    /// areas have a stable baseline (mirrors recharts' default Y behaviour).
    /// </summary>
    public static (double Min, double Max) YDomain(IReadOnlyList<ChartSeries> series, bool includeZero = true)
    {
        ArgumentNullException.ThrowIfNull(series);
        var (min, max) = Domain(series, static p => p.Y);
        if (includeZero)
        {
            min = Math.Min(min, 0);
            max = Math.Max(max, 0);
        }

        return (min, max);
    }

    private static (double Min, double Max) Domain(IReadOnlyList<ChartSeries> series, Func<ChartPoint, double> selector)
    {
        var min = double.PositiveInfinity;
        var max = double.NegativeInfinity;
        foreach (var s in series)
        {
            foreach (var p in s.Points)
            {
                var v = selector(p);
                if (double.IsNaN(v))
                {
                    continue;
                }

                min = Math.Min(min, v);
                max = Math.Max(max, v);
            }
        }

        if (double.IsInfinity(min) || double.IsInfinity(max))
        {
            return (0, 1);
        }

        return (min, max);
    }

    /// <summary>Builds the X scale for a plot rectangle (left → right).</summary>
    public static LinearScale BuildXScale(IReadOnlyList<ChartSeries> series, RectD plot)
    {
        var (min, max) = XDomain(series);
        return new LinearScale(min, max, plot.X, plot.X + plot.Width);
    }

    /// <summary>Builds the Y scale for a plot rectangle (inverted: bottom → top).</summary>
    public static LinearScale BuildYScale(IReadOnlyList<ChartSeries> series, RectD plot, bool includeZero = true)
    {
        var (min, max) = YDomain(series, includeZero);
        return new LinearScale(min, max, plot.Y + plot.Height, plot.Y);
    }

    /// <summary>Projects a series' points into pixel-space polyline vertices.</summary>
    public static IReadOnlyList<PointD> LinePoints(ChartSeries series, LinearScale x, LinearScale y)
    {
        ArgumentNullException.ThrowIfNull(series);
        ArgumentNullException.ThrowIfNull(x);
        ArgumentNullException.ThrowIfNull(y);

        var pts = new List<PointD>(series.Points.Count);
        foreach (var p in series.Points)
        {
            pts.Add(new PointD(x.Map(p.X), y.Map(p.Y)));
        }

        return pts;
    }

    /// <summary>
    /// Builds a closed area polygon for a series: the line vertices followed by the
    /// baseline back-edge so a filled shape sits between the curve and zero.
    /// </summary>
    public static IReadOnlyList<PointD> AreaPolygon(ChartSeries series, LinearScale x, LinearScale y)
    {
        var line = LinePoints(series, x, y);
        if (line.Count == 0)
        {
            return [];
        }

        var baseline = y.Map(0);
        var poly = new List<PointD>(line.Count + 2);
        poly.AddRange(line);
        poly.Add(new PointD(line[^1].X, baseline));
        poly.Add(new PointD(line[0].X, baseline));
        return poly;
    }

    /// <summary>
    /// Lays out grouped bars for the supplied bar series. Each X position gets one
    /// slot split evenly between the series so grouped bars never overlap.
    /// </summary>
    public static IReadOnlyList<RectD> BarRects(
        IReadOnlyList<ChartSeries> barSeries,
        int seriesIndex,
        LinearScale x,
        LinearScale y,
        double slotRatio = 0.7)
    {
        ArgumentNullException.ThrowIfNull(barSeries);
        ArgumentNullException.ThrowIfNull(x);
        ArgumentNullException.ThrowIfNull(y);
        if (seriesIndex < 0 || seriesIndex >= barSeries.Count)
        {
            return [];
        }

        var series = barSeries[seriesIndex];
        var groups = Math.Max(1, barSeries.Count);
        var distinctX = CountDistinctX(series);
        var slotWidth = distinctX > 1
            ? Math.Abs(x.Map(SecondX(series)) - x.Map(FirstX(series)))
            : Math.Abs(x.RangeEnd - x.RangeStart);
        var bandWidth = Math.Max(1, slotWidth * slotRatio);
        var barWidth = bandWidth / groups;

        // Cap the per-bar width so a single or sparse category does not render as a giant block spanning the
        // whole plot (web recharts maxBarSize parity); recompute the band from the capped bar so grouped
        // series stay centred on their category.
        const double maxBarWidth = 64;
        if (barWidth > maxBarWidth)
        {
            barWidth = maxBarWidth;
            bandWidth = barWidth * groups;
        }

        var baseline = y.Map(0);

        var rects = new List<RectD>(series.Points.Count);
        foreach (var p in series.Points)
        {
            var center = x.Map(p.X);
            var left = center - (bandWidth / 2) + (seriesIndex * barWidth);
            var top = y.Map(p.Y);
            var height = Math.Abs(baseline - top);
            var rectTop = Math.Min(baseline, top);
            rects.Add(new RectD(left, rectTop, barWidth, height));
        }

        return rects;
    }

    /// <summary>Scatter marker centres for a series.</summary>
    public static IReadOnlyList<PointD> ScatterPoints(ChartSeries series, LinearScale x, LinearScale y) =>
        LinePoints(series, x, y);

    /// <summary>
    /// Resolves the sweep fraction [0,1] of a gauge given a value and maximum.
    /// </summary>
    public static double GaugeFraction(double value, double max)
    {
        if (max <= 0)
        {
            return 0;
        }

        return Math.Clamp(value, 0, max) / max;
    }

    /// <summary>
    /// Computes a ring arc for a gauge / donut from a normalised
    /// <paramref name="fraction"/> [0,1] starting at 12 o'clock and sweeping
    /// clockwise. Returns endpoints plus the large-arc flag for an SVG/WinUI arc.
    /// </summary>
    public static ArcGeometry RingArc(PointD center, double radius, double fraction, double startAngleDeg = -90)
    {
        var clamped = Math.Clamp(fraction, 0, 1);
        var sweep = clamped * 360.0;
        var start = PointOnCircle(center, radius, startAngleDeg);
        var end = PointOnCircle(center, radius, startAngleDeg + sweep);
        var isLarge = sweep > 180.0;
        return new ArcGeometry(start, end, radius, isLarge, true);
    }

    /// <summary>Builds proportional pie / donut slices from labelled values.</summary>
    public static IReadOnlyList<PieSlice> PieSlices(IReadOnlyList<ChartPoint> values, double startAngleDeg = -90)
    {
        ArgumentNullException.ThrowIfNull(values);
        var total = 0.0;
        foreach (var v in values)
        {
            total += Math.Max(0, v.Y);
        }

        var slices = new List<PieSlice>(values.Count);
        if (total <= 0)
        {
            return slices;
        }

        var angle = startAngleDeg;
        for (var i = 0; i < values.Count; i++)
        {
            var value = Math.Max(0, values[i].Y);
            var sweep = value / total * 360.0;
            slices.Add(new PieSlice(angle, sweep, value, i, values[i].Label ?? string.Empty));
            angle += sweep;
        }

        return slices;
    }

    /// <summary>
    /// Radar vertices for one series: each axis is an equal angular slice and the
    /// value is mapped [0,max] to [0,radius] from the centre.
    /// </summary>
    public static IReadOnlyList<PointD> RadarPolygon(ChartSeries series, PointD center, double radius, double max)
    {
        ArgumentNullException.ThrowIfNull(series);
        var n = series.Points.Count;
        if (n == 0 || max <= 0)
        {
            return [];
        }

        var pts = new List<PointD>(n);
        for (var i = 0; i < n; i++)
        {
            var angle = -90 + (i * 360.0 / n);
            var r = Math.Clamp(series.Points[i].Y, 0, max) / max * radius;
            pts.Add(PointOnCircle(center, r, angle));
        }

        return pts;
    }

    /// <summary>
    /// Compact sparkline vertices fitted to a width × height box with the series
    /// auto-scaled to its own min/max (mirrors the web Sparkline).
    /// </summary>
    public static IReadOnlyList<PointD> SparklinePoints(IReadOnlyList<double> data, double width, double height)
    {
        ArgumentNullException.ThrowIfNull(data);
        if (data.Count == 0)
        {
            return [];
        }

        var min = double.PositiveInfinity;
        var max = double.NegativeInfinity;
        foreach (var v in data)
        {
            min = Math.Min(min, v);
            max = Math.Max(max, v);
        }

        var range = max - min;
        if (range <= 0)
        {
            range = 1;
        }

        var pts = new List<PointD>(data.Count);
        for (var i = 0; i < data.Count; i++)
        {
            var x = data.Count == 1 ? 0 : i / (double)(data.Count - 1) * width;
            var yy = height - ((data[i] - min) / range * height);
            pts.Add(new PointD(x, yy));
        }

        return pts;
    }

    /// <summary>Point on a circle at <paramref name="angleDeg"/> (0° = 3 o'clock).</summary>
    public static PointD PointOnCircle(PointD center, double radius, double angleDeg)
    {
        var rad = angleDeg * Math.PI / 180.0;
        return new PointD(
            center.X + (radius * Math.Cos(rad)),
            center.Y + (radius * Math.Sin(rad)));
    }

    private static int CountDistinctX(ChartSeries series)
    {
        var seen = new HashSet<double>();
        foreach (var p in series.Points)
        {
            seen.Add(p.X);
        }

        return seen.Count;
    }

    private static double FirstX(ChartSeries series) => series.Points.Count > 0 ? series.Points[0].X : 0;

    private static double SecondX(ChartSeries series) => series.Points.Count > 1 ? series.Points[1].X : FirstX(series) + 1;
}
