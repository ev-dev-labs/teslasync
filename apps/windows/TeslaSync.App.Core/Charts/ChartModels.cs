namespace TeslaSync.App.Core.Charts;

/// <summary>
/// How a <see cref="ChartSeries"/> is drawn on a cartesian surface. Mirrors the
/// web charts module's recharts kinds (line / area / bar / scatter / composed).
/// </summary>
public enum ChartSeriesKind
{
    Line,
    Area,
    Bar,
    Scatter,
}

/// <summary>
/// The lifecycle state a chart surface renders. The container shows a distinct
/// body for each (mirrors the web ChartContainer loading / empty / error / ready
/// branches) so a chart never collapses to a blank panel.
/// </summary>
public enum ChartState
{
    Loading,
    Empty,
    Error,
    Ready,
}

/// <summary>Semantic role used to pick a brand chart brush by meaning.</summary>
public enum ChartRole
{
    None,
    Battery,
    Energy,
    Speed,
    Regen,
    Temperature,
    Power,
}

/// <summary>
/// A single cartesian datum. <see cref="X"/> is the domain position (time ticks,
/// distance, ordinal index, …) and <see cref="Y"/> is the measured value. SI on
/// disk — callers convert to display units at the render boundary.
/// </summary>
public readonly record struct ChartPoint(double X, double Y, string? Label = null);

/// <summary>
/// A named, typed data series. A chart binds one or more of these; the palette
/// resolves a brush from <see cref="ColorIndex"/> / <see cref="Role"/> and the
/// legend toggles visibility by <see cref="Name"/>.
/// </summary>
public sealed class ChartSeries
{
    public ChartSeries(string name, IReadOnlyList<ChartPoint> points)
    {
        ArgumentException.ThrowIfNullOrEmpty(name);
        ArgumentNullException.ThrowIfNull(points);
        Name = name;
        Points = points;
    }

    /// <summary>Stable, user-facing series identity used by the legend.</summary>
    public string Name { get; }

    /// <summary>Ordered data points. Empty is valid and renders an empty body.</summary>
    public IReadOnlyList<ChartPoint> Points { get; }

    /// <summary>Draw kind on a cartesian surface.</summary>
    public ChartSeriesKind Kind { get; init; } = ChartSeriesKind.Line;

    /// <summary>Zero-based brand palette index (cycled across TsChart01..08).</summary>
    public int ColorIndex { get; init; }

    /// <summary>Optional semantic role; when set it overrides <see cref="ColorIndex"/>.</summary>
    public ChartRole Role { get; init; } = ChartRole.None;

    /// <summary>Unit suffix appended in tooltips / data view (e.g. "km", "kW").</summary>
    public string? Unit { get; init; }

    /// <summary>Fixed decimal places for value formatting; null = auto.</summary>
    public int? Decimals { get; init; }
}

/// <summary>A reference annotation drawn over a cartesian surface.</summary>
public enum ChartAnnotationKind
{
    VerticalLine,
    HorizontalLine,
    Band,
}

/// <summary>
/// A declarative annotation (reference line / horizontal threshold / shaded band).
/// Geometry is resolved against the active scales by <see cref="ChartGeometry"/>.
/// </summary>
public sealed class ChartAnnotation
{
    public ChartAnnotation(string id, ChartAnnotationKind kind, double value)
    {
        ArgumentException.ThrowIfNullOrEmpty(id);
        Id = id;
        Kind = kind;
        Value = value;
    }

    public string Id { get; }

    public ChartAnnotationKind Kind { get; }

    /// <summary>Primary position (X for vertical, Y for horizontal/band start).</summary>
    public double Value { get; }

    /// <summary>Band end position; only used by <see cref="ChartAnnotationKind.Band"/>.</summary>
    public double Value2 { get; init; }

    public string? Label { get; init; }

    public ChartRole Role { get; init; } = ChartRole.None;
}
