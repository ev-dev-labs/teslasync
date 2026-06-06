using System.Collections.Generic;
using System.IO;
using System.Text.Json;
using System.Text.Json.Serialization;
using TeslaSync.App.Core.Units;
using Xunit;

namespace TeslaSync.App.Tests;

/// <summary>
/// Verifies the C# SI converters/formatters against the language-neutral golden
/// vectors derived from the web source of truth (web/src/lib/unitConversion.ts).
/// This is the ADR-004 behavior-port contract: the C# port must reproduce the web
/// truth row-for-row, identically to the shared Kotlin port.
/// </summary>
public sealed class UnitsGoldenTests
{
    private sealed record GoldenPref(
        [property: JsonPropertyName("distance")] string Distance,
        [property: JsonPropertyName("speed")] string Speed,
        [property: JsonPropertyName("temperature")] string Temperature,
        [property: JsonPropertyName("pressure")] string Pressure,
        [property: JsonPropertyName("energy")] string Energy,
        [property: JsonPropertyName("duration")] string Duration,
        [property: JsonPropertyName("power")] string Power,
        [property: JsonPropertyName("locale")] string? Locale = null,
        [property: JsonPropertyName("precision")] int? Precision = null,
        [property: JsonPropertyName("emptyDisplay")] string? EmptyDisplay = null);

    private sealed record GoldenOptions(
        [property: JsonPropertyName("precision")] int? Precision = null);

    private sealed record GoldenRow(
        [property: JsonPropertyName("fn")] string Fn,
        [property: JsonPropertyName("formatter")] string Formatter,
        [property: JsonPropertyName("quantity")] string Quantity,
        [property: JsonPropertyName("system")] string System,
        [property: JsonPropertyName("preference")] GoldenPref Preference,
        [property: JsonPropertyName("expected_formatted")] string ExpectedFormatted,
        [property: JsonPropertyName("input_si")] double? InputSi = null,
        [property: JsonPropertyName("options")] GoldenOptions? Options = null,
        [property: JsonPropertyName("expected_value")] double? ExpectedValue = null);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNameCaseInsensitive = true,
        NumberHandling = JsonNumberHandling.AllowNamedFloatingPointLiterals,
    };

    private static List<GoldenRow> Rows()
    {
        string path = Path.Combine(AppContext.BaseDirectory, "units-golden.json");
        string json = File.ReadAllText(path);
        return JsonSerializer.Deserialize<List<GoldenRow>>(json, JsonOptions)
            ?? new List<GoldenRow>();
    }

    private static UnitPref ToPref(GoldenPref p) => new(
        UnitLabels.DistanceFromLabel(p.Distance),
        UnitLabels.SpeedFromLabel(p.Speed),
        UnitLabels.TemperatureFromLabel(p.Temperature),
        UnitLabels.PressureFromLabel(p.Pressure),
        UnitLabels.EnergyFromLabel(p.Energy),
        UnitLabels.DurationFromLabel(p.Duration),
        UnitLabels.PowerFromLabel(p.Power),
        p.Locale,
        p.Precision,
        p.EmptyDisplay);

    private static double Convert(GoldenRow row, double input)
    {
        var p = row.Preference;
        return row.Formatter switch
        {
            "formatDistance" => UnitConverters.DistanceFromSi(input, UnitLabels.DistanceFromLabel(p.Distance)),
            "formatSpeed" => UnitConverters.SpeedFromSi(input, UnitLabels.SpeedFromLabel(p.Speed)),
            "formatTemperature" => UnitConverters.TemperatureFromSi(input, UnitLabels.TemperatureFromLabel(p.Temperature)),
            "formatPressure" => UnitConverters.PressureFromSi(input, UnitLabels.PressureFromLabel(p.Pressure)),
            "formatEnergy" => UnitConverters.EnergyFromSi(input, UnitLabels.EnergyFromLabel(p.Energy)),
            "formatDuration" => UnitConverters.DurationFromSi(input, UnitLabels.DurationFromLabel(p.Duration)),
            "formatPower" => UnitConverters.PowerFromSi(input, UnitLabels.PowerFromLabel(p.Power)),
            _ => throw new InvalidOperationException($"unknown formatter {row.Formatter}"),
        };
    }

    private static string Format(GoldenRow row)
    {
        var pref = ToPref(row.Preference);
        int? precision = row.Options?.Precision;
        return row.Formatter switch
        {
            "formatDistance" => UnitFormatters.FormatDistance(row.InputSi, pref, precision),
            "formatSpeed" => UnitFormatters.FormatSpeed(row.InputSi, pref, precision),
            "formatTemperature" => UnitFormatters.FormatTemperature(row.InputSi, pref, precision),
            "formatPressure" => UnitFormatters.FormatPressure(row.InputSi, pref, precision),
            "formatEnergy" => UnitFormatters.FormatEnergy(row.InputSi, pref, precision),
            "formatDuration" => UnitFormatters.FormatDuration(row.InputSi, pref, precision),
            "formatPower" => UnitFormatters.FormatPower(row.InputSi, pref, precision),
            _ => throw new InvalidOperationException($"unknown formatter {row.Formatter}"),
        };
    }

    [Fact]
    public void GoldenFileParsesAndIsComprehensive()
    {
        var all = Rows();
        Assert.True(all.Count >= 40, $"golden fixture should be comprehensive, got {all.Count}");
    }

    [Fact]
    public void EveryGoldenRowMatchesConverterAndFormatter()
    {
        foreach (var row in Rows())
        {
            if (row.InputSi is { } input && !double.IsNaN(input) && !double.IsInfinity(input) &&
                row.ExpectedValue is { } expected)
            {
                double actual = Convert(row, input);
                double tol = 1e-9 * Math.Max(1.0, Math.Abs(expected));
                Assert.True(
                    Math.Abs(actual - expected) <= tol,
                    $"{row.Fn}({input}) expected {expected} but got {actual}");
            }

            Assert.Equal(row.ExpectedFormatted, Format(row));
        }
    }

    [Fact]
    public void EveryConverterFnHasMetricAndImperialCoverage()
    {
        var expectedFns = new HashSet<string>
        {
            "convertDistanceFromSI",
            "convertSpeedFromSI",
            "convertTempFromSI",
            "convertPressureFromSI",
            "convertEnergyFromSI",
            "convertDurationFromSI",
            "convertPowerFromSI",
        };

        var bySystem = new Dictionary<string, HashSet<string>>();
        foreach (var row in Rows())
        {
            if (!bySystem.TryGetValue(row.Fn, out var systems))
            {
                systems = new HashSet<string>();
                bySystem[row.Fn] = systems;
            }

            systems.Add(row.System);
        }

        Assert.Equal(expectedFns, new HashSet<string>(bySystem.Keys));
        foreach (var (fn, systems) in bySystem)
        {
            Assert.True(systems.Contains("metric"), $"{fn} missing a metric golden row");
            Assert.True(systems.Contains("imperial"), $"{fn} missing an imperial golden row");
        }
    }
}
