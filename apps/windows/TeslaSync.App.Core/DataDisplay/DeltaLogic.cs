namespace TeslaSync.App.Core.DataDisplay;

/// <summary>Whether a higher or lower value is the desirable outcome for a metric.</summary>
public enum MetricDirection
{
    /// <summary>Higher is better (e.g. efficiency score).</summary>
    HigherBetter,

    /// <summary>Lower is better (e.g. energy consumption).</summary>
    LowerBetter,

    /// <summary>Direction carries no good/bad meaning.</summary>
    Neutral,
}

/// <summary>The visual arrow a <c>TsDelta</c> renders for a signed change.</summary>
public enum DeltaArrow
{
    /// <summary>Value increased.</summary>
    Up,

    /// <summary>Value decreased.</summary>
    Down,

    /// <summary>No change.</summary>
    Flat,
}

/// <summary>How a delta should be coloured given the metric's direction.</summary>
public enum DeltaTone
{
    /// <summary>The change is a desirable outcome.</summary>
    Positive,

    /// <summary>The change is an undesirable outcome.</summary>
    Negative,

    /// <summary>Zero change — rendered muted.</summary>
    Muted,

    /// <summary>Direction is neutral — never coloured good/bad.</summary>
    Neutral,
}

/// <summary>The computed presentation of a period-over-period change.</summary>
/// <param name="HasComparison">False when current/previous are missing → render em dash.</param>
/// <param name="SignedDelta">current − previous.</param>
/// <param name="AbsoluteDelta">Absolute magnitude of the change.</param>
/// <param name="SignedPercent">Signed percent change, or null when previous is 0.</param>
/// <param name="AbsolutePercent">Absolute percent change, or null when previous is 0.</param>
/// <param name="Arrow">Directional arrow for the sign.</param>
/// <param name="Tone">Colour tone for the change.</param>
public readonly record struct DeltaResult(
    bool HasComparison,
    double SignedDelta,
    double AbsoluteDelta,
    double? SignedPercent,
    double? AbsolutePercent,
    DeltaArrow Arrow,
    DeltaTone Tone);

/// <summary>
/// Direction-aware change computation backing <c>TsDelta</c> (port of the web
/// <c>Delta</c> logic). The arrow encodes the sign; the magnitude is always
/// rendered positive ("↓ 5%" never "↑ -5%").
/// </summary>
public static class DeltaLogic
{
    /// <summary>Compute the full delta presentation for a current/previous pair.</summary>
    public static DeltaResult Compute(double? current, double? previous, MetricDirection direction)
    {
        if (!IsFinite(current) || !IsFinite(previous))
        {
            return new DeltaResult(false, 0, 0, null, null, DeltaArrow.Flat, DeltaTone.Muted);
        }

        double signed = current!.Value - previous!.Value;
        double abs = Math.Abs(signed);

        double? signedPct = previous.Value != 0 ? signed / Math.Abs(previous.Value) * 100 : null;
        double? absPct = signedPct is { } sp ? Math.Abs(sp) : null;

        DeltaArrow arrow = signed > 0 ? DeltaArrow.Up : signed < 0 ? DeltaArrow.Down : DeltaArrow.Flat;
        DeltaTone tone = ToneFor(direction, signed);

        return new DeltaResult(true, signed, abs, signedPct, absPct, arrow, tone);
    }

    /// <summary>Colour tone for a signed change under a metric direction.</summary>
    public static DeltaTone ToneFor(MetricDirection direction, double signedDelta)
    {
        if (signedDelta == 0)
        {
            return DeltaTone.Muted;
        }

        if (direction == MetricDirection.Neutral)
        {
            return DeltaTone.Neutral;
        }

        bool positiveOutcome =
            (direction == MetricDirection.HigherBetter && signedDelta > 0) ||
            (direction == MetricDirection.LowerBetter && signedDelta < 0);
        return positiveOutcome ? DeltaTone.Positive : DeltaTone.Negative;
    }

    /// <summary>Token brush key for a delta tone.</summary>
    public static string AccentBrushKey(DeltaTone tone) => tone switch
    {
        DeltaTone.Positive => "TsColorSuccessBrush",
        DeltaTone.Negative => "TsColorDangerBrush",
        DeltaTone.Neutral => "TsColorTextSecondaryBrush",
        _ => "TsColorTextMutedBrush",
    };

    private static bool IsFinite(double? v) => v is { } d && !double.IsNaN(d) && !double.IsInfinity(d);
}
