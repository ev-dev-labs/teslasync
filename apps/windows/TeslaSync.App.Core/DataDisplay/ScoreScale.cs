using System.Collections.Generic;

namespace TeslaSync.App.Core.DataDisplay;

/// <summary>Letter grade rendered by <c>TsScoreBadge</c> (A+ … F, or — for no data).</summary>
public enum ScoreGrade
{
    APlus,
    A,
    B,
    C,
    D,
    F,
    None,
}

/// <summary>A score grade together with its palette colour and numeric weight.</summary>
/// <param name="Grade">The letter grade.</param>
/// <param name="Label">Display label ("A+", "A", …, "—").</param>
/// <param name="ColorHex">Hex colour for the badge text.</param>
/// <param name="Numeric">Numeric weight for averaging; null for the no-data sentinel.</param>
public readonly record struct ScoreGradeInfo(ScoreGrade Grade, string Label, string ColorHex, double? Numeric);

/// <summary>A score threshold: scores at or above <see cref="Min"/> map to <see cref="Grade"/>.</summary>
public readonly record struct ScoreThreshold(double Min, ScoreGrade Grade);

/// <summary>
/// Generic A–F score-scale helpers (port of web <c>scoreScale.ts</c>). Pure
/// functions with no UI knowledge. The palette and thresholds match the web
/// source so a screen showing both a Drive grade and a Charging grade uses the
/// same colours for "A", "B", etc.
/// </summary>
public static class ScoreScale
{
    private static readonly Dictionary<ScoreGrade, ScoreGradeInfo> Palette =
        new()
        {
            [ScoreGrade.APlus] = new(ScoreGrade.APlus, "A+", "#10b981", 4.5),
            [ScoreGrade.A] = new(ScoreGrade.A, "A", "#10b981", 4.0),
            [ScoreGrade.B] = new(ScoreGrade.B, "B", "#00f0ff", 3.0),
            [ScoreGrade.C] = new(ScoreGrade.C, "C", "#f59e0b", 2.0),
            [ScoreGrade.D] = new(ScoreGrade.D, "D", "#ef4444", 1.0),
            [ScoreGrade.F] = new(ScoreGrade.F, "F", "#b91c1c", 0.5),
            [ScoreGrade.None] = new(ScoreGrade.None, "\u2014", "#6b7280", null),
        };

    /// <summary>Default 0–100 thresholds (lower bound inclusive), highest first.</summary>
    public static IReadOnlyList<ScoreThreshold> DefaultThresholds { get; } = new[]
    {
        new ScoreThreshold(90, ScoreGrade.APlus),
        new ScoreThreshold(80, ScoreGrade.A),
        new ScoreThreshold(65, ScoreGrade.B),
        new ScoreThreshold(50, ScoreGrade.C),
        new ScoreThreshold(35, ScoreGrade.D),
        new ScoreThreshold(0, ScoreGrade.F),
    };

    /// <summary>Map a 0–100 numeric score to a letter grade.</summary>
    public static ScoreGradeInfo NumericToGrade(double? score, IReadOnlyList<ScoreThreshold>? thresholds = null)
    {
        if (score is not { } s || double.IsNaN(s) || double.IsInfinity(s))
        {
            return Palette[ScoreGrade.None];
        }

        var src = thresholds ?? DefaultThresholds;
        var sorted = new List<ScoreThreshold>(src);
        sorted.Sort((a, b) => b.Min.CompareTo(a.Min));
        foreach (var t in sorted)
        {
            if (s >= t.Min)
            {
                return Palette[t.Grade];
            }
        }

        return Palette[ScoreGrade.F];
    }

    /// <summary>Look up the colour + numeric weight for a known grade.</summary>
    public static ScoreGradeInfo Info(ScoreGrade grade) => Palette[grade];

    /// <summary>
    /// Average a list of grade-numerics (skipping null) and map back to a letter.
    /// Returns the no-data sentinel when no graded inputs are present.
    /// </summary>
    public static ScoreGradeInfo AverageGrade(IEnumerable<double?> values)
    {
        double sum = 0;
        int n = 0;
        foreach (var v in values)
        {
            if (v is { } d && !double.IsNaN(d) && !double.IsInfinity(d))
            {
                sum += d;
                n++;
            }
        }

        if (n == 0)
        {
            return Palette[ScoreGrade.None];
        }

        double avg = sum / n;
        if (avg >= 4.25)
        {
            return Palette[ScoreGrade.APlus];
        }

        if (avg >= 3.5)
        {
            return Palette[ScoreGrade.A];
        }

        if (avg >= 2.5)
        {
            return Palette[ScoreGrade.B];
        }

        if (avg >= 1.5)
        {
            return Palette[ScoreGrade.C];
        }

        if (avg >= 0.75)
        {
            return Palette[ScoreGrade.D];
        }

        return Palette[ScoreGrade.F];
    }
}
