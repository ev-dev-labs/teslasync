using TeslaSync.App.Core.Charts;

namespace TeslaSync.App.Components.Charts;

/// <summary>Line chart (mirrors the web recharts <c>LineChart</c>). All series render as lines.</summary>
public partial class TsLineChart : TsCartesianChart
{
    public TsLineChart() => DefaultKind = ChartSeriesKind.Line;
}

/// <summary>Area chart (mirrors the web recharts <c>AreaChart</c>). All series render as soft areas.</summary>
public partial class TsAreaChart : TsCartesianChart
{
    public TsAreaChart() => DefaultKind = ChartSeriesKind.Area;
}

/// <summary>Bar chart (mirrors the web recharts <c>BarChart</c>). All series render as grouped bars.</summary>
public partial class TsBarChart : TsCartesianChart
{
    public TsBarChart() => DefaultKind = ChartSeriesKind.Bar;
}

/// <summary>Scatter chart (mirrors the web recharts <c>ScatterChart</c>). All series render as points.</summary>
public partial class TsScatterChart : TsCartesianChart
{
    public TsScatterChart() => DefaultKind = ChartSeriesKind.Scatter;
}

/// <summary>
/// Composed chart (mirrors the web recharts <c>ComposedChart</c>). Each series keeps
/// its own <see cref="ChartSeriesKind"/> so lines, areas and bars share one surface.
/// </summary>
public partial class TsComposedChart : TsCartesianChart
{
    public TsComposedChart() => DefaultKind = null;
}
