namespace TeslaSync.App.Core.Units;

/// <summary>
/// Pure SI -&gt; display numeric converters. Every function assumes SI input and is
/// a 1:1 port of the shared Kotlin <c>convert*FromSI</c> surface (which itself
/// mirrors the web <c>unitConversion.ts</c> SI-canonical block). There is NO
/// runtime fallback that guesses the input unit — that anti-pattern hid bugs in
/// the legacy code and is intentionally not ported (Phase-48).
/// </summary>
public static class UnitConverters
{
    /// <summary>1 mile = 1609.344 m exactly (international yard, NIST).</summary>
    private const double MetersPerMile = 1609.344;

    /// <summary>1 km = 1000 m exactly.</summary>
    private const double MetersPerKm = 1000.0;

    /// <summary>1 ft = 0.3048 m exactly (international foot, NIST).</summary>
    private const double MetersPerFoot = 0.3048;

    /// <summary>1 psi = 6.894757 kPa (NIST SP 811, display precision).</summary>
    private const double KpaPerPsi = 6.894757;

    /// <summary>1 bar = 100 kPa (BIPM definition).</summary>
    private const double KpaPerBar = 100.0;

    private const double SecondsPerMinute = 60.0;
    private const double SecondsPerHour = 3600.0;
    private const double SecondsPerDay = 86400.0;

    /// <summary>Convert distance from SI meters to the user's display unit.</summary>
    public static double DistanceFromSi(double meters, DistanceUnit to) => to switch
    {
        DistanceUnit.Km => meters / MetersPerKm,
        DistanceUnit.Mi => meters / MetersPerMile,
        DistanceUnit.Ft => meters / MetersPerFoot,
        _ => meters,
    };

    /// <summary>Convert speed from SI meters-per-second to the display unit.</summary>
    public static double SpeedFromSi(double mps, SpeedUnit to) => to switch
    {
        SpeedUnit.Kmh => mps * SecondsPerHour / MetersPerKm,
        SpeedUnit.Mph => mps * SecondsPerHour / MetersPerMile,
        _ => mps,
    };

    /// <summary>Convert temperature from SI Celsius to the display unit.</summary>
    public static double TemperatureFromSi(double celsius, TemperatureUnit to) => to switch
    {
        TemperatureUnit.Celsius => celsius,
        TemperatureUnit.Fahrenheit => (celsius * 9 / 5) + 32,
        _ => celsius,
    };

    /// <summary>Convert pressure from SI kilopascals to the display unit.</summary>
    public static double PressureFromSi(double kpa, PressureUnit to) => to switch
    {
        PressureUnit.Kpa => kpa,
        PressureUnit.Psi => kpa / KpaPerPsi,
        PressureUnit.Bar => kpa / KpaPerBar,
        _ => kpa,
    };

    /// <summary>Convert energy from SI watt-hours to the display unit.</summary>
    public static double EnergyFromSi(double wh, EnergyUnit to) => to switch
    {
        EnergyUnit.Wh => wh,
        EnergyUnit.Kwh => wh / 1000.0,
        _ => wh,
    };

    /// <summary>Convert duration from SI seconds to the display unit.</summary>
    public static double DurationFromSi(double seconds, DurationUnit to) => to switch
    {
        DurationUnit.Seconds => seconds,
        DurationUnit.Minutes => seconds / SecondsPerMinute,
        DurationUnit.Hours => seconds / SecondsPerHour,
        DurationUnit.Days => seconds / SecondsPerDay,
        _ => seconds,
    };

    /// <summary>Convert power from SI watts to the display unit.</summary>
    public static double PowerFromSi(double watts, PowerUnit to) => to switch
    {
        PowerUnit.W => watts,
        PowerUnit.Kw => watts / 1000.0,
        _ => watts,
    };
}
