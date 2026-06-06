namespace TeslaSync.App.Core.Charts;

/// <summary>A single formatted tooltip row (one per visible series).</summary>
public readonly record struct ChartTooltipRow(string SeriesName, string ColorKey, string FormattedValue);

/// <summary>A fully resolved tooltip payload for one domain position.</summary>
public sealed class ChartTooltipModel
{
    public ChartTooltipModel(string header, IReadOnlyList<ChartTooltipRow> rows)
    {
        ArgumentNullException.ThrowIfNull(header);
        ArgumentNullException.ThrowIfNull(rows);
        Header = header;
        Rows = rows;
    }

    /// <summary>The X-axis label for the hovered position.</summary>
    public string Header { get; }

    /// <summary>One row per visible series at this position.</summary>
    public IReadOnlyList<ChartTooltipRow> Rows { get; }
}

/// <summary>
/// Builds <see cref="ChartTooltipModel"/> payloads from series at a given domain
/// index, formatting each value with the palette and series unit/precision. Pure
/// so tooltip content is unit-tested without rendering a popup.
/// </summary>
public static class ChartTooltipFormatter
{
    /// <summary>
    /// Resolves the tooltip for the data point at <paramref name="pointIndex"/>
    /// across <paramref name="series"/>. Series without that index are skipped.
    /// </summary>
    public static ChartTooltipModel ForIndex(
        IReadOnlyList<ChartSeries> series,
        int pointIndex,
        string? headerOverride = null)
    {
        ArgumentNullException.ThrowIfNull(series);

        string header = headerOverride ?? string.Empty;
        var rows = new List<ChartTooltipRow>(series.Count);
        foreach (var s in series)
        {
            if (pointIndex < 0 || pointIndex >= s.Points.Count)
            {
                continue;
            }

            var point = s.Points[pointIndex];
            if (headerOverride is null && string.IsNullOrEmpty(header))
            {
                header = point.Label ?? ChartPalette.FormatValue(point.X, 0);
            }

            rows.Add(new ChartTooltipRow(
                s.Name,
                ChartPalette.KeyForSeries(s),
                ChartPalette.FormatValue(point.Y, s.Decimals, s.Unit)));
        }

        return new ChartTooltipModel(header, rows);
    }

    /// <summary>
    /// Finds the point index whose X is nearest <paramref name="domainX"/> using the
    /// first series as the index basis (cursor sync hit-testing). Returns -1 when
    /// there is no data.
    /// </summary>
    public static int NearestIndex(IReadOnlyList<ChartSeries> series, double domainX)
    {
        ArgumentNullException.ThrowIfNull(series);
        ChartSeries? basis = null;
        foreach (var s in series)
        {
            if (s.Points.Count > 0)
            {
                basis = s;
                break;
            }
        }

        if (basis is null)
        {
            return -1;
        }

        var best = -1;
        var bestDist = double.PositiveInfinity;
        for (var i = 0; i < basis.Points.Count; i++)
        {
            var dist = Math.Abs(basis.Points[i].X - domainX);
            if (dist < bestDist)
            {
                bestDist = dist;
                best = i;
            }
        }

        return best;
    }
}
