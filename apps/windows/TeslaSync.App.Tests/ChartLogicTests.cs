using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using Xunit;

namespace TeslaSync.App.Tests;

public sealed class ChartGeometryTests
{
    private static ChartSeries Line(string name, params (double X, double Y)[] pts)
    {
        var points = new List<ChartPoint>();
        foreach (var (x, y) in pts)
        {
            points.Add(new ChartPoint(x, y));
        }

        return new ChartSeries(name, points);
    }

    [Fact]
    public void LinearScale_MapsAndInverts()
    {
        var scale = new LinearScale(0, 10, 0, 100);
        Assert.Equal(50, scale.Map(5), 6);
        Assert.Equal(5, scale.Invert(50), 6);
    }

    [Fact]
    public void LinearScale_ClampsOutOfRange()
    {
        var scale = new LinearScale(0, 10, 0, 100);
        Assert.Equal(100, scale.Map(99));
        Assert.Equal(0, scale.Map(-5));
    }

    [Fact]
    public void LinearScale_HandlesFlatDomain()
    {
        var scale = new LinearScale(5, 5, 0, 100);
        var mid = scale.Map(5);
        Assert.InRange(mid, 0, 100);
    }

    [Fact]
    public void LinearScale_ProducesNiceTicks()
    {
        var scale = new LinearScale(0, 100, 0, 500);
        var ticks = scale.Ticks(5);
        Assert.True(ticks.Count >= 2);
        Assert.Contains(0d, ticks);
    }

    [Fact]
    public void YScale_IsInvertedSoLargerValuesSitHigher()
    {
        var series = new[] { Line("a", (0, 0), (1, 10)) };
        var plot = ChartGeometry.PlotArea(200, 100, new EdgeInsets(0, 0, 0, 0));
        var y = ChartGeometry.BuildYScale(series, plot);
        Assert.True(y.Map(10) < y.Map(0));
    }

    [Fact]
    public void YDomain_IncludesZeroByDefault()
    {
        var series = new[] { Line("a", (0, 5), (1, 9)) };
        var (min, max) = ChartGeometry.YDomain(series);
        Assert.Equal(0, min);
        Assert.Equal(9, max);
    }

    [Fact]
    public void LinePoints_ProjectsEveryPoint()
    {
        var series = Line("a", (0, 0), (1, 1), (2, 2));
        var plot = ChartGeometry.PlotArea(100, 100, new EdgeInsets(0, 0, 0, 0));
        var x = ChartGeometry.BuildXScale([series], plot);
        var y = ChartGeometry.BuildYScale([series], plot);
        var pts = ChartGeometry.LinePoints(series, x, y);
        Assert.Equal(3, pts.Count);
    }

    [Fact]
    public void AreaPolygon_ClosesBackToBaseline()
    {
        var series = Line("a", (0, 2), (1, 4));
        var plot = ChartGeometry.PlotArea(100, 100, new EdgeInsets(0, 0, 0, 0));
        var x = ChartGeometry.BuildXScale([series], plot);
        var y = ChartGeometry.BuildYScale([series], plot);
        var poly = ChartGeometry.AreaPolygon(series, x, y);
        Assert.Equal(4, poly.Count);
        var baseline = y.Map(0);
        Assert.Equal(baseline, poly[^1].Y, 6);
        Assert.Equal(baseline, poly[^2].Y, 6);
    }

    [Fact]
    public void BarRects_GroupsWithoutOverlap()
    {
        var bars = new[]
        {
            new ChartSeries("a", [new ChartPoint(0, 1), new ChartPoint(1, 2)]) { Kind = ChartSeriesKind.Bar },
            new ChartSeries("b", [new ChartPoint(0, 3), new ChartPoint(1, 1)]) { Kind = ChartSeriesKind.Bar },
        };
        var plot = ChartGeometry.PlotArea(200, 100, new EdgeInsets(0, 0, 0, 0));
        var x = ChartGeometry.BuildXScale(bars, plot);
        var y = ChartGeometry.BuildYScale(bars, plot);
        var first = ChartGeometry.BarRects(bars, 0, x, y);
        var second = ChartGeometry.BarRects(bars, 1, x, y);
        Assert.Equal(2, first.Count);
        // Grouped bars at the same X must not start at the same left edge.
        Assert.NotEqual(first[0].X, second[0].X);
    }

    [Fact]
    public void BarRects_SinglePoint_CapsBarWidth()
    {
        // A single data point must not render as a giant block spanning the plot (recharts maxBarSize parity).
        var bars = new[]
        {
            new ChartSeries("a", [new ChartPoint(0, 1)]) { Kind = ChartSeriesKind.Bar },
        };
        var plot = ChartGeometry.PlotArea(800, 100, new EdgeInsets(0, 0, 0, 0));
        var x = ChartGeometry.BuildXScale(bars, plot);
        var y = ChartGeometry.BuildYScale(bars, plot);
        var rects = ChartGeometry.BarRects(bars, 0, x, y);
        Assert.Single(rects);
        // Without the cap this single bar would be ~0.7 * 800 = 560px wide; the cap holds it to 64px.
        Assert.True(rects[0].Width <= 64, $"bar width {rects[0].Width} should be capped at 64");
    }

    [Fact]
    public void GaugeFraction_ClampsToUnit()
    {
        Assert.Equal(0.5, ChartGeometry.GaugeFraction(50, 100), 6);
        Assert.Equal(1, ChartGeometry.GaugeFraction(150, 100), 6);
        Assert.Equal(0, ChartGeometry.GaugeFraction(10, 0), 6);
    }

    [Fact]
    public void RingArc_FullCircleIsLargeArc()
    {
        var arc = ChartGeometry.RingArc(new PointD(50, 50), 40, 0.9);
        Assert.True(arc.IsLargeArc);
        Assert.Equal(40, arc.Radius);
    }

    [Fact]
    public void PieSlices_SumTo360()
    {
        var values = new[]
        {
            new ChartPoint(0, 1, "a"),
            new ChartPoint(1, 2, "b"),
            new ChartPoint(2, 1, "c"),
        };
        var slices = ChartGeometry.PieSlices(values);
        var total = 0.0;
        foreach (var s in slices)
        {
            total += s.SweepAngleDeg;
        }

        Assert.Equal(360, total, 4);
        Assert.Equal(3, slices.Count);
    }

    [Fact]
    public void PieSlices_EmptyWhenAllZero()
    {
        var slices = ChartGeometry.PieSlices([new ChartPoint(0, 0, "a")]);
        Assert.Empty(slices);
    }

    [Fact]
    public void RadarPolygon_HasOneVertexPerAxis()
    {
        var series = new ChartSeries("a", [new ChartPoint(0, 1), new ChartPoint(1, 2), new ChartPoint(2, 3)]);
        var pts = ChartGeometry.RadarPolygon(series, new PointD(50, 50), 40, 4);
        Assert.Equal(3, pts.Count);
    }

    [Fact]
    public void SparklinePoints_FitWithinBox()
    {
        var pts = ChartGeometry.SparklinePoints([1, 5, 2, 8, 3], 100, 30);
        Assert.Equal(5, pts.Count);
        foreach (var p in pts)
        {
            Assert.InRange(p.X, 0, 100);
            Assert.InRange(p.Y, 0, 30);
        }
    }

    [Fact]
    public void SparklinePoints_EmptyForNoData()
    {
        Assert.Empty(ChartGeometry.SparklinePoints([], 100, 30));
    }
}

public sealed class ChartPaletteTests
{
    [Fact]
    public void KeyForIndex_CyclesThroughEight()
    {
        Assert.Equal("TsChart01Brush", ChartPalette.KeyForIndex(0));
        Assert.Equal("TsChart08Brush", ChartPalette.KeyForIndex(7));
        Assert.Equal("TsChart01Brush", ChartPalette.KeyForIndex(8));
        Assert.Equal("TsChart02Brush", ChartPalette.KeyForIndex(-7));
    }

    [Fact]
    public void KeyForRole_MapsSemanticBrushes()
    {
        Assert.Equal("TsChartBatteryBrush", ChartPalette.KeyForRole(ChartRole.Battery));
        Assert.Equal("TsChartPowerBrush", ChartPalette.KeyForRole(ChartRole.Power));
    }

    [Fact]
    public void KeyForSeries_RoleOverridesIndex()
    {
        var series = new ChartSeries("s", [new ChartPoint(0, 1)]) { ColorIndex = 3, Role = ChartRole.Speed };
        Assert.Equal("TsChartSpeedBrush", ChartPalette.KeyForSeries(series));
    }

    [Fact]
    public void StatusKey_UsesSharedStatusMapping()
    {
        Assert.Equal(StatusResources.AccentBrushKey(StatusKind.Danger), ChartPalette.StatusKey(StatusKind.Danger));
    }

    [Theory]
    [InlineData(1234.0, null, "1,234")]
    [InlineData(12.5, null, "12.5")]
    [InlineData(0.42, null, "0.42")]
    [InlineData(3.14159, 2, "3.14")]
    public void FormatValue_FormatsInvariant(double value, int? decimals, string expected)
    {
        Assert.Equal(expected, ChartPalette.FormatValue(value, decimals));
    }

    [Fact]
    public void FormatValue_AppendsUnit()
    {
        Assert.Equal("50 kW", ChartPalette.FormatValue(50, 0, "kW"));
    }

    [Fact]
    public void FormatValue_NaNIsDash()
    {
        Assert.Equal("\u2014", ChartPalette.FormatValue(double.NaN, 0));
    }
}

public sealed class ChartLegendStateTests
{
    [Fact]
    public void Toggle_HidesAndShows()
    {
        var state = new ChartLegendState();
        Assert.True(state.IsVisible("a"));
        Assert.False(state.Toggle("a"));
        Assert.False(state.IsVisible("a"));
        Assert.True(state.Toggle("a"));
        Assert.True(state.IsVisible("a"));
    }

    [Fact]
    public void VisibleSeries_FiltersHidden()
    {
        var series = new[]
        {
            new ChartSeries("a", [new ChartPoint(0, 1)]),
            new ChartSeries("b", [new ChartPoint(0, 2)]),
        };
        var state = new ChartLegendState();
        state.SetVisible("a", false);
        var visible = state.VisibleSeries(series);
        Assert.Single(visible);
        Assert.Equal("b", visible[0].Name);
    }

    [Fact]
    public void Reset_RestoresAll()
    {
        var state = new ChartLegendState();
        state.SetVisible("a", false);
        state.SetVisible("b", false);
        state.Reset();
        Assert.True(state.IsVisible("a"));
        Assert.True(state.IsVisible("b"));
    }

    [Fact]
    public void Toggle_RaisesPropertyChanged()
    {
        var state = new ChartLegendState();
        var raised = false;
        state.PropertyChanged += (_, _) => raised = true;
        state.Toggle("a");
        Assert.True(raised);
    }
}

public sealed class ChartTooltipFormatterTests
{
    private static IReadOnlyList<ChartSeries> Sample() =>
    [
        new ChartSeries("Speed", [new ChartPoint(0, 10, "00:00"), new ChartPoint(1, 20, "00:01")]) { Unit = "km/h", Decimals = 0 },
        new ChartSeries("Power", [new ChartPoint(0, 5, "00:00"), new ChartPoint(1, 8, "00:01")]) { Unit = "kW", Decimals = 1 },
    ];

    [Fact]
    public void ForIndex_BuildsRowPerSeries()
    {
        var model = ChartTooltipFormatter.ForIndex(Sample(), 1);
        Assert.Equal("00:01", model.Header);
        Assert.Equal(2, model.Rows.Count);
        Assert.Equal("20 km/h", model.Rows[0].FormattedValue);
        Assert.Equal("8.0 kW", model.Rows[1].FormattedValue);
        Assert.Equal("TsChart01Brush", model.Rows[0].ColorKey);
    }

    [Fact]
    public void ForIndex_SkipsSeriesWithoutThatIndex()
    {
        IReadOnlyList<ChartSeries> series =
        [
            new ChartSeries("a", [new ChartPoint(0, 1)]),
            new ChartSeries("b", [new ChartPoint(0, 1), new ChartPoint(1, 2)]),
        ];
        var model = ChartTooltipFormatter.ForIndex(series, 1);
        Assert.Single(model.Rows);
        Assert.Equal("b", model.Rows[0].SeriesName);
    }

    [Fact]
    public void NearestIndex_FindsClosestX()
    {
        var series = Sample();
        Assert.Equal(0, ChartTooltipFormatter.NearestIndex(series, 0.2));
        Assert.Equal(1, ChartTooltipFormatter.NearestIndex(series, 0.9));
    }

    [Fact]
    public void NearestIndex_MinusOneWhenEmpty()
    {
        Assert.Equal(-1, ChartTooltipFormatter.NearestIndex([], 1));
    }
}

public sealed class ChartCursorSyncGroupTests
{
    [Fact]
    public void SetCursor_BroadcastsActivePosition()
    {
        var group = new ChartCursorSyncGroup();
        ChartCursorChange? last = null;
        group.CursorChanged += (_, e) => last = e;
        group.SetCursor(42);
        Assert.True(group.IsActive);
        Assert.Equal(42, group.DomainX);
        Assert.True(last!.Value.IsActive);
        Assert.Equal(42, last.Value.DomainX);
    }

    [Fact]
    public void Clear_DeactivatesOnce()
    {
        var group = new ChartCursorSyncGroup();
        group.SetCursor(10);
        var count = 0;
        group.CursorChanged += (_, _) => count++;
        group.Clear();
        group.Clear();
        Assert.False(group.IsActive);
        Assert.Equal(1, count);
    }
}

public sealed class ChartAnnotationStateTests
{
    [Fact]
    public void Add_AppendsAndReplacesById()
    {
        var state = new ChartAnnotationState();
        state.Add(new ChartAnnotation("x1", ChartAnnotationKind.VerticalLine, 5));
        state.Add(new ChartAnnotation("x1", ChartAnnotationKind.VerticalLine, 9));
        Assert.Single(state.Items);
        Assert.Equal(9, state.Items[0].Value);
    }

    [Fact]
    public void Remove_DropsById()
    {
        var state = new ChartAnnotationState();
        state.Add(new ChartAnnotation("a", ChartAnnotationKind.HorizontalLine, 1));
        Assert.True(state.Remove("a"));
        Assert.False(state.Remove("a"));
        Assert.Empty(state.Items);
    }
}

public sealed class ChartExportTests
{
    private static IReadOnlyList<ChartSeries> Sample() =>
    [
        new ChartSeries("a", [new ChartPoint(0, 1), new ChartPoint(1, 2)]),
        new ChartSeries("b", [new ChartPoint(0, 3), new ChartPoint(1, 4)]) { Kind = ChartSeriesKind.Area },
    ];

    [Fact]
    public void ToCsv_HasHeaderAndRows()
    {
        var csv = ChartExport.ToCsv(Sample());
        var lines = csv.Split('\n', StringSplitOptions.RemoveEmptyEntries);
        Assert.Equal("x,a,b", lines[0]);
        Assert.Equal(3, lines.Length);
        Assert.Equal("0,1,3", lines[1]);
    }

    [Fact]
    public void ToCsv_QuotesSeriesWithComma()
    {
        IReadOnlyList<ChartSeries> series = [new ChartSeries("a,b", [new ChartPoint(0, 1)])];
        var csv = ChartExport.ToCsv(series);
        Assert.Contains("\"a,b\"", csv, StringComparison.Ordinal);
    }

    [Fact]
    public void ToSvg_IsWellFormedAndSized()
    {
        var svg = ChartExport.ToSvg(Sample(), 200, 100);
        Assert.StartsWith("<svg", svg, StringComparison.Ordinal);
        Assert.EndsWith("</svg>", svg, StringComparison.Ordinal);
        Assert.Contains("width=\"200\"", svg, StringComparison.Ordinal);
        Assert.Contains("polygon", svg, StringComparison.Ordinal);
        Assert.Contains("TsChart01Brush", svg, StringComparison.Ordinal);
    }

    [Fact]
    public void ToSvg_UsesInvariantNumbers()
    {
        var prior = CultureInfo.CurrentCulture;
        try
        {
            CultureInfo.CurrentCulture = new CultureInfo("de-DE");
            var svg = ChartExport.ToSvg(Sample(), 200, 100);
            Assert.DoesNotContain(",0\"", svg, StringComparison.Ordinal);
        }
        finally
        {
            CultureInfo.CurrentCulture = prior;
        }
    }
}

public sealed class ChartAccessibilityTests
{
    private static IReadOnlyList<ChartSeries> Sample() =>
    [
        new ChartSeries("Speed", [new ChartPoint(0, 10, "t0"), new ChartPoint(1, 30, "t1")]) { Unit = "km/h", Decimals = 0 },
        new ChartSeries("Power", [new ChartPoint(0, 5, "t0"), new ChartPoint(2, 9, "t2")]) { Unit = "kW", Decimals = 0 },
    ];

    [Fact]
    public void Summarize_DescribesSeriesAndRange()
    {
        var summary = ChartAccessibility.Summarize("Trip", Sample());
        Assert.Contains("Trip: 2 series.", summary, StringComparison.Ordinal);
        Assert.Contains("Speed: 2 points, range 10 km/h to 30 km/h.", summary, StringComparison.Ordinal);
    }

    [Fact]
    public void Summarize_NoDataMessage()
    {
        Assert.Contains("no data available", ChartAccessibility.Summarize("Trip", []), StringComparison.Ordinal);
    }

    [Fact]
    public void ToDataView_JoinsOnXDomain()
    {
        var view = ChartAccessibility.ToDataView(Sample());
        Assert.Equal(["x", "Speed", "Power"], view.Columns);
        // Distinct X values are 0, 1, 2.
        Assert.Equal(3, view.Rows.Count);
        // Speed has no sample at x=2 -> blank cell.
        var lastRow = view.Rows[^1];
        Assert.Equal(string.Empty, lastRow[1]);
        Assert.Equal("9 kW", lastRow[2]);
    }
}
