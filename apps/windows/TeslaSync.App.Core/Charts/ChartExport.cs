using System.Globalization;
using System.Text;

namespace TeslaSync.App.Core.Charts;

/// <summary>
/// Builds export artefacts from typed series data. CSV and SVG are produced
/// purely from the bound <see cref="ChartSeries"/> (no rendering surface needed)
/// so the export feature is real even though the native chart draws to a Canvas;
/// PNG export is handled at the WinUI layer via a render-target bitmap. Pure and
/// testable.
/// </summary>
public static class ChartExport
{
    /// <summary>
    /// Serialises the series to CSV with an <c>x</c> column followed by one column
    /// per series, joined on the X domain. Values use invariant culture so the
    /// output is locale-stable.
    /// </summary>
    public static string ToCsv(IReadOnlyList<ChartSeries> series)
    {
        ArgumentNullException.ThrowIfNull(series);

        var xs = new List<double>();
        var seen = new HashSet<double>();
        foreach (var s in series)
        {
            foreach (var p in s.Points)
            {
                if (seen.Add(p.X))
                {
                    xs.Add(p.X);
                }
            }
        }

        xs.Sort();

        var sb = new StringBuilder();
        sb.Append('x');
        foreach (var s in series)
        {
            sb.Append(',').Append(Escape(s.Name));
        }

        sb.Append('\n');

        foreach (var x in xs)
        {
            sb.Append(x.ToString(CultureInfo.InvariantCulture));
            foreach (var s in series)
            {
                sb.Append(',');
                var value = ValueAt(s, x);
                if (value.HasValue)
                {
                    sb.Append(value.Value.ToString(CultureInfo.InvariantCulture));
                }
            }

            sb.Append('\n');
        }

        return sb.ToString();
    }

    /// <summary>
    /// Renders the cartesian series to a standalone SVG document of the given size.
    /// Areas are filled, lines stroked and bars drawn from the computed geometry,
    /// each coloured by its palette key (emitted as a CSS class so a theme sheet can
    /// recolour it). This is the SVG export path for charts whose Canvas has no
    /// native vector export.
    /// </summary>
    public static string ToSvg(IReadOnlyList<ChartSeries> series, double width, double height)
    {
        ArgumentNullException.ThrowIfNull(series);

        var insets = new EdgeInsets(8, 8, 8, 8);
        var plot = ChartGeometry.PlotArea(width, height, insets);
        var x = ChartGeometry.BuildXScale(series, plot);
        var y = ChartGeometry.BuildYScale(series, plot);

        var sb = new StringBuilder();
        sb.Append(CultureInfo.InvariantCulture, $"<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{Num(width)}\" height=\"{Num(height)}\" viewBox=\"0 0 {Num(width)} {Num(height)}\">");

        var barSeries = new List<ChartSeries>();
        foreach (var s in series)
        {
            if (s.Kind == ChartSeriesKind.Bar)
            {
                barSeries.Add(s);
            }
        }

        foreach (var s in series)
        {
            var cls = ChartPalette.KeyForSeries(s);
            switch (s.Kind)
            {
                case ChartSeriesKind.Area:
                    sb.Append(CultureInfo.InvariantCulture, $"<polygon class=\"{cls}\" fill-opacity=\"0.25\" points=\"{Points(ChartGeometry.AreaPolygon(s, x, y))}\" />");
                    sb.Append(CultureInfo.InvariantCulture, $"<polyline class=\"{cls}\" fill=\"none\" stroke-width=\"2\" points=\"{Points(ChartGeometry.LinePoints(s, x, y))}\" />");
                    break;
                case ChartSeriesKind.Bar:
                    foreach (var r in ChartGeometry.BarRects(barSeries, barSeries.IndexOf(s), x, y))
                    {
                        sb.Append(CultureInfo.InvariantCulture, $"<rect class=\"{cls}\" x=\"{Num(r.X)}\" y=\"{Num(r.Y)}\" width=\"{Num(r.Width)}\" height=\"{Num(r.Height)}\" />");
                    }

                    break;
                case ChartSeriesKind.Scatter:
                    foreach (var p in ChartGeometry.ScatterPoints(s, x, y))
                    {
                        sb.Append(CultureInfo.InvariantCulture, $"<circle class=\"{cls}\" cx=\"{Num(p.X)}\" cy=\"{Num(p.Y)}\" r=\"3\" />");
                    }

                    break;
                default:
                    sb.Append(CultureInfo.InvariantCulture, $"<polyline class=\"{cls}\" fill=\"none\" stroke-width=\"2\" points=\"{Points(ChartGeometry.LinePoints(s, x, y))}\" />");
                    break;
            }
        }

        sb.Append("</svg>");
        return sb.ToString();
    }

    private static double? ValueAt(ChartSeries series, double x)
    {
        foreach (var p in series.Points)
        {
            if (Math.Abs(p.X - x) < double.Epsilon)
            {
                return p.Y;
            }
        }

        return null;
    }

    private static string Points(IReadOnlyList<PointD> points)
    {
        var sb = new StringBuilder();
        for (var i = 0; i < points.Count; i++)
        {
            if (i > 0)
            {
                sb.Append(' ');
            }

            sb.Append(Num(points[i].X)).Append(',').Append(Num(points[i].Y));
        }

        return sb.ToString();
    }

    private static string Num(double value) =>
        Math.Round(value, 2).ToString(CultureInfo.InvariantCulture);

    private static string Escape(string field)
    {
        if (field.Contains(',', StringComparison.Ordinal) ||
            field.Contains('"', StringComparison.Ordinal) ||
            field.Contains('\n', StringComparison.Ordinal))
        {
            return "\"" + field.Replace("\"", "\"\"", StringComparison.Ordinal) + "\"";
        }

        return field;
    }
}
