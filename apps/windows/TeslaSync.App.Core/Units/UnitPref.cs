namespace TeslaSync.App.Core.Units;

/// <summary>
/// Canonical SI input units this module accepts (mirrors the web <c>SI</c> map
/// and the shared Kotlin <c>SI</c> object). The backend stores SI; producers
/// deliver SI; renderers convert at the display boundary only.
/// </summary>
public static class Si
{
    public const string Distance = "m";
    public const string Speed = "m/s";
    public const string Temperature = "\u00B0C";
    public const string Pressure = "kPa";
    public const string Energy = "Wh";
    public const string Duration = "s";
    public const string Power = "W";
}

/// <summary>Distance display unit (target of <c>FormatDistance</c>).</summary>
public enum DistanceUnit
{
    Km,
    Mi,
    Ft,
}

/// <summary>Speed display unit (target of <c>FormatSpeed</c>).</summary>
public enum SpeedUnit
{
    Kmh,
    Mph,
}

/// <summary>Temperature display unit (target of <c>FormatTemperature</c>).</summary>
public enum TemperatureUnit
{
    Celsius,
    Fahrenheit,
}

/// <summary>Pressure display unit (target of <c>FormatPressure</c>).</summary>
public enum PressureUnit
{
    Kpa,
    Psi,
    Bar,
}

/// <summary>Energy display unit (target of <c>FormatEnergy</c>).</summary>
public enum EnergyUnit
{
    Wh,
    Kwh,
}

/// <summary>Duration display unit (target of <c>FormatDuration</c>).</summary>
public enum DurationUnit
{
    Seconds,
    Minutes,
    Hours,
    Days,
}

/// <summary>Power display unit (target of <c>FormatPower</c>).</summary>
public enum PowerUnit
{
    W,
    Kw,
}

/// <summary>
/// Maps each unit enum to / from the display label used by the web string-literal
/// unions and the golden fixture. Kept UI-free so the mapping is unit-testable.
/// </summary>
public static class UnitLabels
{
    public static string Label(DistanceUnit u) => u switch
    {
        DistanceUnit.Km => "km",
        DistanceUnit.Mi => "mi",
        DistanceUnit.Ft => "ft",
        _ => "km",
    };

    public static string Label(SpeedUnit u) => u switch
    {
        SpeedUnit.Kmh => "km/h",
        SpeedUnit.Mph => "mph",
        _ => "km/h",
    };

    public static string Label(TemperatureUnit u) => u switch
    {
        TemperatureUnit.Celsius => "\u00B0C",
        TemperatureUnit.Fahrenheit => "\u00B0F",
        _ => "\u00B0C",
    };

    public static string Label(PressureUnit u) => u switch
    {
        PressureUnit.Kpa => "kPa",
        PressureUnit.Psi => "psi",
        PressureUnit.Bar => "bar",
        _ => "kPa",
    };

    public static string Label(EnergyUnit u) => u switch
    {
        EnergyUnit.Wh => "Wh",
        EnergyUnit.Kwh => "kWh",
        _ => "Wh",
    };

    public static string Label(DurationUnit u) => u switch
    {
        DurationUnit.Seconds => "s",
        DurationUnit.Minutes => "min",
        DurationUnit.Hours => "h",
        DurationUnit.Days => "d",
        _ => "s",
    };

    public static string Label(PowerUnit u) => u switch
    {
        PowerUnit.W => "W",
        PowerUnit.Kw => "kW",
        _ => "W",
    };

    public static DistanceUnit DistanceFromLabel(string label) => label switch
    {
        "km" => DistanceUnit.Km,
        "mi" => DistanceUnit.Mi,
        "ft" => DistanceUnit.Ft,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown distance unit"),
    };

    public static SpeedUnit SpeedFromLabel(string label) => label switch
    {
        "km/h" => SpeedUnit.Kmh,
        "mph" => SpeedUnit.Mph,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown speed unit"),
    };

    public static TemperatureUnit TemperatureFromLabel(string label) => label switch
    {
        "\u00B0C" => TemperatureUnit.Celsius,
        "\u00B0F" => TemperatureUnit.Fahrenheit,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown temperature unit"),
    };

    public static PressureUnit PressureFromLabel(string label) => label switch
    {
        "kPa" => PressureUnit.Kpa,
        "psi" => PressureUnit.Psi,
        "bar" => PressureUnit.Bar,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown pressure unit"),
    };

    public static EnergyUnit EnergyFromLabel(string label) => label switch
    {
        "Wh" => EnergyUnit.Wh,
        "kWh" => EnergyUnit.Kwh,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown energy unit"),
    };

    public static DurationUnit DurationFromLabel(string label) => label switch
    {
        "s" => DurationUnit.Seconds,
        "min" => DurationUnit.Minutes,
        "h" => DurationUnit.Hours,
        "d" => DurationUnit.Days,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown duration unit"),
    };

    public static PowerUnit PowerFromLabel(string label) => label switch
    {
        "W" => PowerUnit.W,
        "kW" => PowerUnit.Kw,
        _ => throw new ArgumentOutOfRangeException(nameof(label), label, "unknown power unit"),
    };
}

/// <summary>
/// Aggregates the user's per-quantity display preference plus locale + precision
/// hints. Callers compute one <see cref="UnitPref"/> per render and pass it to
/// each <c>FormatX</c> call. Mirrors the shared Kotlin <c>UnitPref</c> record.
/// </summary>
/// <param name="Locale">BCP-47 locale tag. Only en-US grouping/separators are
/// reproduced by the shared formatter (the web display contract); null = en-US.</param>
/// <param name="Precision">Default <c>maximumFractionDigits</c> when a
/// <c>FormatX</c> call has no per-call override.</param>
/// <param name="EmptyDisplay">Display fallback when a <c>FormatX</c> receives
/// null/NaN/non-finite input. Default em dash.</param>
public sealed record UnitPref(
    DistanceUnit Distance,
    SpeedUnit Speed,
    TemperatureUnit Temperature,
    PressureUnit Pressure,
    EnergyUnit Energy,
    DurationUnit Duration,
    PowerUnit Power,
    string? Locale = null,
    int? Precision = null,
    string? EmptyDisplay = null)
{
    /// <summary>Metric defaults (km, km/h, °C, kPa, Wh, s, W).</summary>
    public static UnitPref Metric { get; } = new(
        DistanceUnit.Km,
        SpeedUnit.Kmh,
        TemperatureUnit.Celsius,
        PressureUnit.Kpa,
        EnergyUnit.Wh,
        DurationUnit.Seconds,
        PowerUnit.W);

    /// <summary>Imperial defaults (mi, mph, °F, psi, kWh, min, kW).</summary>
    public static UnitPref Imperial { get; } = new(
        DistanceUnit.Mi,
        SpeedUnit.Mph,
        TemperatureUnit.Fahrenheit,
        PressureUnit.Psi,
        EnergyUnit.Kwh,
        DurationUnit.Minutes,
        PowerUnit.Kw);
}
