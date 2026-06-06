using System.Globalization;

namespace TeslaSync.App.Core.Maps;

/// <summary>
/// One time-stamped GPS sample for trip replay (port of the web
/// <c>PlaybackPoint</c>). Optional metrics ride along for the inline chip.
/// </summary>
/// <param name="Lat">Latitude.</param>
/// <param name="Lng">Longitude.</param>
/// <param name="TimestampMs">Absolute time in epoch milliseconds.</param>
/// <param name="Speed">Optional speed value (display units, already converted).</param>
/// <param name="Soc">Optional state-of-charge percent.</param>
/// <param name="Power">Optional power value.</param>
public readonly record struct PlaybackPoint(
    double Lat,
    double Lng,
    double TimestampMs,
    double? Speed = null,
    double? Soc = null,
    double? Power = null);

/// <summary>
/// Headless trip-replay engine backing <c>TsRoutePlayback</c> (port of the web
/// <c>RoutePlayback</c> playback maths): builds the relative time axis, maps an
/// elapsed offset to the nearest sample, computes the marker heading and formats
/// the transport clock. The WinUI control owns only the timer + rendering.
/// </summary>
public sealed class RoutePlaybackEngine
{
    /// <summary>Replay timer granularity in milliseconds (matches the web 50ms tick).</summary>
    public const double TickMs = 50;

    /// <summary>Available replay speed multipliers, slowest → fastest.</summary>
    public static IReadOnlyList<int> Speeds { get; } = [1, 10, 25, 50, 100];

    private readonly List<PlaybackPoint> _points;
    private readonly double[] _offsets;

    /// <summary>Build an engine over a time-ordered set of points.</summary>
    public RoutePlaybackEngine(IEnumerable<PlaybackPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        _points = [.. points];
        _offsets = BuildOffsets(_points);
        ElapsedMs = 0;
        CurrentIndex = 0;
    }

    /// <summary>The points the engine is replaying.</summary>
    public IReadOnlyList<PlaybackPoint> Points => _points;

    /// <summary>Total replay duration in milliseconds (0 when fewer than 2 points).</summary>
    public double TotalMs => _offsets.Length > 0 ? _offsets[^1] : 0;

    /// <summary>Current elapsed offset in milliseconds.</summary>
    public double ElapsedMs { get; private set; }

    /// <summary>Index of the sample at the current elapsed offset.</summary>
    public int CurrentIndex { get; private set; }

    /// <summary>True when there is nothing to replay (no finite GPS samples).</summary>
    public bool IsEmpty => _points.Count == 0 || !HasAnyFinite();

    /// <summary>The sample at the current cursor, or null when empty.</summary>
    public PlaybackPoint? Current =>
        CurrentIndex >= 0 && CurrentIndex < _points.Count ? _points[CurrentIndex] : null;

    /// <summary>Replay progress in the range [0, 1].</summary>
    public double Progress => TotalMs > 0 ? Math.Clamp(ElapsedMs / TotalMs, 0, 1) : 0;

    /// <summary>
    /// Advance the cursor by one tick at <paramref name="speed"/>× and report whether
    /// the end was reached (so the caller can stop the timer). At the end the cursor
    /// snaps to the final sample.
    /// </summary>
    public bool Advance(int speed)
    {
        if (_offsets.Length == 0 || TotalMs <= 0)
        {
            return true;
        }

        ElapsedMs += TickMs * Math.Max(1, speed);
        if (ElapsedMs >= TotalMs)
        {
            ElapsedMs = TotalMs;
            CurrentIndex = _offsets.Length - 1;
            return true;
        }

        CurrentIndex = IndexAtTime(_offsets, ElapsedMs);
        return false;
    }

    /// <summary>Seek to a normalized progress value in [0, 1].</summary>
    public void SeekToProgress(double progress)
    {
        double target = Math.Clamp(progress, 0, 1) * TotalMs;
        ElapsedMs = target;
        CurrentIndex = IndexAtTime(_offsets, target);
    }

    /// <summary>Reset the cursor to the start.</summary>
    public void Reset()
    {
        ElapsedMs = 0;
        CurrentIndex = 0;
    }

    /// <summary>True when the cursor sits at (or past) the end of the timeline.</summary>
    public bool AtEnd => TotalMs > 0 && ElapsedMs >= TotalMs;

    /// <summary>The car heading (degrees, 0–360) at the current cursor.</summary>
    public double Heading => HeadingAt(CurrentIndex);

    /// <summary>The car heading (degrees, 0–360) at an arbitrary index.</summary>
    public double HeadingAt(int index)
    {
        if (_points.Count < 2)
        {
            return 0;
        }

        int next = index < _points.Count - 1 ? index + 1 : index;
        int prev = next > 0 ? next - 1 : 0;
        return ComputeHeading(_points[prev], _points[next]);
    }

    /// <summary>Build the relative-time axis (offset from the first sample, ms).</summary>
    public static double[] BuildOffsets(IReadOnlyList<PlaybackPoint> points)
    {
        ArgumentNullException.ThrowIfNull(points);
        if (points.Count == 0)
        {
            return [];
        }

        double t0 = points[0].TimestampMs;
        var offsets = new double[points.Count];
        for (int i = 0; i < points.Count; i++)
        {
            double t = points[i].TimestampMs;
            offsets[i] = double.IsNaN(t) ? 0 : t - t0;
        }

        return offsets;
    }

    /// <summary>Binary-search the offset nearest to <paramref name="targetMs"/>.</summary>
    public static int IndexAtTime(double[] offsets, double targetMs)
    {
        ArgumentNullException.ThrowIfNull(offsets);
        if (offsets.Length == 0)
        {
            return 0;
        }

        int lo = 0;
        int hi = offsets.Length - 1;
        while (lo < hi)
        {
            int mid = (lo + hi) >> 1;
            if (offsets[mid] < targetMs)
            {
                lo = mid + 1;
            }
            else
            {
                hi = mid;
            }
        }

        if (lo > 0 && targetMs - offsets[lo - 1] < offsets[lo] - targetMs)
        {
            return lo - 1;
        }

        return lo;
    }

    /// <summary>Great-circle initial bearing from <paramref name="a"/> to <paramref name="b"/>.</summary>
    public static double ComputeHeading(PlaybackPoint a, PlaybackPoint b)
    {
        static double ToRad(double d) => d * Math.PI / 180.0;
        static double ToDeg(double r) => r * 180.0 / Math.PI;

        double dLon = ToRad(b.Lng - a.Lng);
        double y = Math.Sin(dLon) * Math.Cos(ToRad(b.Lat));
        double x = (Math.Cos(ToRad(a.Lat)) * Math.Sin(ToRad(b.Lat))) -
                   (Math.Sin(ToRad(a.Lat)) * Math.Cos(ToRad(b.Lat)) * Math.Cos(dLon));
        return ((ToDeg(Math.Atan2(y, x)) + 360) % 360);
    }

    /// <summary>Format a millisecond duration as <c>m:ss</c> or <c>h:mm:ss</c>.</summary>
    public static string FormatDuration(double ms)
    {
        int totalSec = (int)Math.Floor(Math.Max(0, ms) / 1000.0);
        int h = totalSec / 3600;
        int m = (totalSec % 3600) / 60;
        int s = totalSec % 60;
        var c = CultureInfo.InvariantCulture;
        return h > 0
            ? string.Create(c, $"{h}:{m:D2}:{s:D2}")
            : string.Create(c, $"{m:D2}:{s:D2}");
    }

    /// <summary>The finite-coordinate trail, in order, for the polyline overlay.</summary>
    public IReadOnlyList<GeoPoint> Trail()
    {
        var trail = new List<GeoPoint>(_points.Count);
        foreach (var p in _points)
        {
            if (double.IsFinite(p.Lat) && double.IsFinite(p.Lng))
            {
                trail.Add(new GeoPoint(p.Lat, p.Lng));
            }
        }

        return trail;
    }

    private bool HasAnyFinite()
    {
        foreach (var p in _points)
        {
            if (double.IsFinite(p.Lat) && double.IsFinite(p.Lng))
            {
                return true;
            }
        }

        return false;
    }
}
