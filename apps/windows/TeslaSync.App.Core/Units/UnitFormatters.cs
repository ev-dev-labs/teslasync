namespace TeslaSync.App.Core.Units;

/// <summary>
/// Locale-aware SI -&gt; display string formatters. Each returns the empty fallback
/// (or <see cref="UnitPref.EmptyDisplay"/>) for null / NaN / non-finite inputs and
/// never throws. 1:1 port of the shared Kotlin <c>formatX</c> surface so the WinUI
/// formatted-value controls share the exact web display contract. UI controls MUST
/// route through this port — never duplicate conversion math in the control layer.
/// </summary>
public static class UnitFormatters
{
    /// <summary>Default fallback string for nullish / NaN inputs (em dash).</summary>
    public const string DefaultEmptyDisplay = "\u2014";

    private const int PrecisionDistance = 1;
    private const int PrecisionSpeed = 0;
    private const int PrecisionTemperature = 1;
    private const int PrecisionPressure = 1;
    private const int PrecisionEnergy = 2;
    private const int PrecisionDuration = 0;
    private const int PrecisionPower = 2;

    /// <summary>Format an SI-meters distance for display.</summary>
    public static string FormatDistance(double? meters, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(meters))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionDistance);
        double value = UnitConverters.DistanceFromSi(meters!.Value, pref.Distance);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)} {UnitLabels.Label(pref.Distance)}";
    }

    /// <summary>Format an SI m/s speed for display.</summary>
    public static string FormatSpeed(double? mps, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(mps))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionSpeed);
        double value = UnitConverters.SpeedFromSi(mps!.Value, pref.Speed);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)} {UnitLabels.Label(pref.Speed)}";
    }

    /// <summary>Format an SI Celsius temperature for display (no space before unit).</summary>
    public static string FormatTemperature(double? celsius, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(celsius))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionTemperature);
        double value = UnitConverters.TemperatureFromSi(celsius!.Value, pref.Temperature);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)}{UnitLabels.Label(pref.Temperature)}";
    }

    /// <summary>Format an SI kilopascal pressure for display.</summary>
    public static string FormatPressure(double? kpa, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(kpa))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionPressure);
        double value = UnitConverters.PressureFromSi(kpa!.Value, pref.Pressure);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)} {UnitLabels.Label(pref.Pressure)}";
    }

    /// <summary>Format an SI watt-hours energy for display.</summary>
    public static string FormatEnergy(double? wh, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(wh))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionEnergy);
        double value = UnitConverters.EnergyFromSi(wh!.Value, pref.Energy);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)} {UnitLabels.Label(pref.Energy)}";
    }

    /// <summary>Format an SI seconds duration for display.</summary>
    public static string FormatDuration(double? seconds, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(seconds))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionDuration);
        double value = UnitConverters.DurationFromSi(seconds!.Value, pref.Duration);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)} {UnitLabels.Label(pref.Duration)}";
    }

    /// <summary>Format SI watts for display.</summary>
    public static string FormatPower(double? watts, UnitPref pref, int? precision = null)
    {
        if (!IsFinite(watts))
        {
            return ResolveEmpty(pref);
        }

        int digits = ResolvePrecision(pref, precision, PrecisionPower);
        double value = UnitConverters.PowerFromSi(watts!.Value, pref.Power);
        return $"{NumberFormatting.Format(value, pref.Locale, digits)} {UnitLabels.Label(pref.Power)}";
    }

    private static bool IsFinite(double? v) => v is { } d && !double.IsNaN(d) && !double.IsInfinity(d);

    private static string ResolveEmpty(UnitPref pref) => pref.EmptyDisplay ?? DefaultEmptyDisplay;

    private static int ResolvePrecision(UnitPref pref, int? over, int fallback)
    {
        if (over is { } o and >= 0)
        {
            return o;
        }

        if (pref.Precision is { } p and >= 0)
        {
            return p;
        }

        return fallback;
    }
}
