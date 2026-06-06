namespace TeslaSync.App.Core.DataDisplay;

/// <summary>
/// Pure animation model backing <c>TsAnimatedNumber</c> (port of the web
/// <c>AnimatedNumber</c> tween). Animates from a start value to a target with an
/// ease-out-quad curve. When reduced-motion is requested the model snaps straight
/// to the target so the WinUI control honours the system "animations off" setting
/// and Narrator/high-contrast accessibility expectations.
/// </summary>
public sealed class AnimatedNumberModel
{
    private readonly double _from;
    private readonly double _to;
    private readonly double _durationSeconds;
    private readonly bool _reduceMotion;

    /// <summary>Create a tween from <paramref name="from"/> to <paramref name="to"/>.</summary>
    /// <param name="from">Start value (web default is 0).</param>
    /// <param name="to">Target value.</param>
    /// <param name="durationSeconds">Tween duration in seconds (web default 1).</param>
    /// <param name="reduceMotion">When true, the value snaps to the target immediately.</param>
    public AnimatedNumberModel(double from, double to, double durationSeconds = 1.0, bool reduceMotion = false)
    {
        _from = from;
        _to = to;
        _durationSeconds = Math.Max(0, durationSeconds);
        _reduceMotion = reduceMotion;
    }

    /// <summary>The animation's final/target value.</summary>
    public double Target => _to;

    /// <summary>True when motion is suppressed (value is constant at the target).</summary>
    public bool MotionReduced => _reduceMotion;

    /// <summary>
    /// Ease-out-quad easing: <c>1 - (1 - t)²</c> for t in [0,1] (matches the web).
    /// </summary>
    public static double EaseOutQuad(double t)
    {
        double clamped = Math.Clamp(t, 0.0, 1.0);
        double inv = 1 - clamped;
        return 1 - (inv * inv);
    }

    /// <summary>
    /// Value at elapsed <paramref name="elapsedSeconds"/>. With reduced motion or a
    /// zero-length duration the target is returned immediately; otherwise the eased
    /// interpolation between start and target.
    /// </summary>
    public double ValueAt(double elapsedSeconds)
    {
        if (_reduceMotion || _durationSeconds <= 0)
        {
            return _to;
        }

        double progress = Math.Min(elapsedSeconds / _durationSeconds, 1.0);
        double eased = EaseOutQuad(progress);
        return _from + ((_to - _from) * eased);
    }

    /// <summary>True once the tween has reached its target at the given elapsed time.</summary>
    public bool IsComplete(double elapsedSeconds) =>
        _reduceMotion || _durationSeconds <= 0 || elapsedSeconds >= _durationSeconds;
}
