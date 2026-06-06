using System.Globalization;

namespace TeslaSync.App.Core.Charts;

/// <summary>
/// Resolves a series / role into a W1 brand chart brush *resource key*. The WinUI
/// layer looks the key up in <c>Application.Resources</c> so the palette stays
/// theme-aware and token-driven (never hard-coded hex). Pure and testable.
/// </summary>
public static class ChartPalette
{
    /// <summary>The eight categorical brand brush keys, in cycle order.</summary>
    public static IReadOnlyList<string> CategoricalKeys { get; } =
    [
        "TsChart01Brush",
        "TsChart02Brush",
        "TsChart03Brush",
        "TsChart04Brush",
        "TsChart05Brush",
        "TsChart06Brush",
        "TsChart07Brush",
        "TsChart08Brush",
    ];

    /// <summary>Resolves the brush key for a categorical palette index (cycled).</summary>
    public static string KeyForIndex(int index)
    {
        var count = CategoricalKeys.Count;
        var i = ((index % count) + count) % count;
        return CategoricalKeys[i];
    }

    /// <summary>Resolves the semantic brush key for a chart role.</summary>
    public static string KeyForRole(ChartRole role) => role switch
    {
        ChartRole.Battery => "TsChartBatteryBrush",
        ChartRole.Energy => "TsChartEnergyBrush",
        ChartRole.Speed => "TsChartSpeedBrush",
        ChartRole.Regen => "TsChartRegenBrush",
        ChartRole.Temperature => "TsChartTemperatureBrush",
        ChartRole.Power => "TsChartPowerBrush",
        _ => KeyForIndex(0),
    };

    /// <summary>
    /// Resolves the brush key for a series: an explicit <see cref="ChartRole"/>
    /// wins, otherwise the categorical index is used.
    /// </summary>
    public static string KeyForSeries(ChartSeries series)
    {
        ArgumentNullException.ThrowIfNull(series);
        return series.Role != ChartRole.None
            ? KeyForRole(series.Role)
            : KeyForIndex(series.ColorIndex);
    }

    /// <summary>Maps a status severity to its themed status brush key.</summary>
    public static string StatusKey(StatusKind status) => StatusResources.AccentBrushKey(status);

    /// <summary>
    /// Formats a measured value for tooltips / data view using invariant culture,
    /// honouring an explicit decimal count or an auto precision derived from value.
    /// </summary>
    public static string FormatValue(double value, int? decimals, string? unit = null)
    {
        if (double.IsNaN(value))
        {
            return "\u2014";
        }

        var d = decimals ?? AutoDecimals(value);
        var text = value.ToString("N" + d.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
        return string.IsNullOrEmpty(unit) ? text : $"{text} {unit}";
    }

    private static int AutoDecimals(double value)
    {
        var abs = Math.Abs(value);
        if (abs >= 100 || abs == Math.Floor(abs))
        {
            return 0;
        }

        return abs >= 1 ? 1 : 2;
    }
}
