namespace TeslaSync.App.Core.Charts;

/// <summary>
/// A linear domain → pixel-range mapping with "nice" tick generation. Pure and
/// UI-thread-free so axis math is unit-tested without a WinUI host. The range
/// may be inverted (<see cref="RangeStart"/> &gt; <see cref="RangeEnd"/>) which is
/// how the Y axis flips so larger values sit higher on screen.
/// </summary>
public sealed class LinearScale
{
    public LinearScale(double domainMin, double domainMax, double rangeStart, double rangeEnd)
    {
        // Guard a zero-width domain so a flat series still maps to a usable band.
        if (Math.Abs(domainMax - domainMin) < double.Epsilon)
        {
            domainMin -= 0.5;
            domainMax += 0.5;
        }

        DomainMin = domainMin;
        DomainMax = domainMax;
        RangeStart = rangeStart;
        RangeEnd = rangeEnd;
    }

    public double DomainMin { get; }

    public double DomainMax { get; }

    public double RangeStart { get; }

    public double RangeEnd { get; }

    /// <summary>Maps a domain value to its pixel position, clamping to the range.</summary>
    public double Map(double value)
    {
        var t = (value - DomainMin) / (DomainMax - DomainMin);
        var raw = RangeStart + (t * (RangeEnd - RangeStart));
        var lo = Math.Min(RangeStart, RangeEnd);
        var hi = Math.Max(RangeStart, RangeEnd);
        return Math.Clamp(raw, lo, hi);
    }

    /// <summary>Inverse of <see cref="Map"/>: a pixel position back to a domain value.</summary>
    public double Invert(double pixel)
    {
        var t = (pixel - RangeStart) / (RangeEnd - RangeStart);
        return DomainMin + (t * (DomainMax - DomainMin));
    }

    /// <summary>
    /// Generates up to <paramref name="targetCount"/> evenly spaced "nice" tick
    /// values (1/2/5 × 10ⁿ steps) spanning the domain. Always returns at least two.
    /// </summary>
    public IReadOnlyList<double> Ticks(int targetCount = 5)
    {
        var count = Math.Max(2, targetCount);
        var span = DomainMax - DomainMin;
        var rawStep = span / (count - 1);
        var step = NiceStep(rawStep);
        var start = Math.Ceiling(DomainMin / step) * step;

        var ticks = new List<double>();
        for (var v = start; v <= DomainMax + (step * 0.5); v += step)
        {
            // Snap away tiny floating drift so labels read cleanly.
            ticks.Add(Math.Round(v, 10));
        }

        if (ticks.Count == 0)
        {
            ticks.Add(DomainMin);
            ticks.Add(DomainMax);
        }

        return ticks;
    }

    private static double NiceStep(double rawStep)
    {
        if (rawStep <= 0)
        {
            return 1;
        }

        var magnitude = Math.Pow(10, Math.Floor(Math.Log10(rawStep)));
        var normalized = rawStep / magnitude;
        var nice = normalized switch
        {
            <= 1 => 1,
            <= 2 => 2,
            <= 5 => 5,
            _ => 10,
        };
        return nice * magnitude;
    }
}
