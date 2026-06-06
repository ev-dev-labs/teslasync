using System.Globalization;
using System.Text;

namespace TeslaSync.App.Core.Charts;

/// <summary>A screen-reader-friendly tabular projection of chart series.</summary>
public sealed class ChartDataView
{
    public ChartDataView(IReadOnlyList<string> columns, IReadOnlyList<IReadOnlyList<string>> rows)
    {
        ArgumentNullException.ThrowIfNull(columns);
        ArgumentNullException.ThrowIfNull(rows);
        Columns = columns;
        Rows = rows;
    }

    /// <summary>Header labels: the X column followed by one per series.</summary>
    public IReadOnlyList<string> Columns { get; }

    /// <summary>Body rows, one per distinct X value.</summary>
    public IReadOnlyList<IReadOnlyList<string>> Rows { get; }
}

/// <summary>
/// Builds the accessible alternatives every chart must expose: a spoken
/// <see cref="Summarize"/> sentence for <c>AutomationProperties</c> and a
/// <see cref="ToDataView"/> table the WinUI control renders as a real data grid.
/// Pure and testable.
/// </summary>
public static class ChartAccessibility
{
    /// <summary>
    /// Produces a one-line summary covering the series count and, for each series,
    /// its point count and min/max range — enough for a non-visual user to grasp
    /// the chart without seeing it.
    /// </summary>
    public static string Summarize(string title, IReadOnlyList<ChartSeries> series)
    {
        ArgumentNullException.ThrowIfNull(series);
        var heading = string.IsNullOrEmpty(title) ? "Chart" : title;

        if (series.Count == 0)
        {
            return $"{heading}: no data available.";
        }

        var sb = new StringBuilder();
        sb.Append(CultureInfo.InvariantCulture, $"{heading}: {series.Count} series.");
        foreach (var s in series)
        {
            if (s.Points.Count == 0)
            {
                sb.Append(CultureInfo.InvariantCulture, $" {s.Name}: no points.");
                continue;
            }

            var min = double.PositiveInfinity;
            var max = double.NegativeInfinity;
            foreach (var p in s.Points)
            {
                min = Math.Min(min, p.Y);
                max = Math.Max(max, p.Y);
            }

            sb.Append(CultureInfo.InvariantCulture, $" {s.Name}: {s.Points.Count} points, range {ChartPalette.FormatValue(min, s.Decimals, s.Unit)} to {ChartPalette.FormatValue(max, s.Decimals, s.Unit)}.");
        }

        return sb.ToString();
    }

    /// <summary>
    /// Projects the series into a table joined on the X domain: one column per
    /// series, one row per distinct X value, with blanks where a series has no
    /// sample at that X.
    /// </summary>
    public static ChartDataView ToDataView(IReadOnlyList<ChartSeries> series, string xColumnLabel = "x")
    {
        ArgumentNullException.ThrowIfNull(series);

        var columns = new List<string>(series.Count + 1) { xColumnLabel };
        foreach (var s in series)
        {
            columns.Add(s.Name);
        }

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

        var rows = new List<IReadOnlyList<string>>(xs.Count);
        foreach (var x in xs)
        {
            var row = new List<string>(columns.Count)
            {
                ChartPalette.FormatValue(x, 0),
            };
            foreach (var s in series)
            {
                row.Add(CellFor(s, x));
            }

            rows.Add(row);
        }

        return new ChartDataView(columns, rows);
    }

    private static string CellFor(ChartSeries series, double x)
    {
        foreach (var p in series.Points)
        {
            if (Math.Abs(p.X - x) < double.Epsilon)
            {
                return ChartPalette.FormatValue(p.Y, series.Decimals, series.Unit);
            }
        }

        return string.Empty;
    }
}
