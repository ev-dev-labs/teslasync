using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata + conversion constants for the Speed surface — the native analogue of the
/// module-level constants in <c>web/src/components/data-display/format/Speed.tsx</c>. The web component is a
/// pure presentational speed readout: it accepts a caller-supplied speed in <c>mph</c> or <c>kmh</c>, folds it
/// to SI metres-per-second, reconverts to the user's <see cref="UnitPref.Speed"/> via <c>convertSpeedFromSI</c>,
/// and renders <c>{fmtNumber(value, precision)} {speedUnit}</c> with a hover title showing the raw
/// caller-supplied value in its source unit. It reads no network data and renders no titles/labels of its own,
/// so this carries only the diagnostics slug, the automation id, the SI fold factors the source hard-codes, and
/// the formatting defaults (<c>fmtNumber</c>'s global precision and the <c>toFixed(1)</c> source-title precision).
/// </summary>
public static class SpeedRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Speed";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c>
    /// (it is an anonymous inline span), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "speed";

    /// <summary>
    /// Default fraction digits when the caller supplies no <c>precision</c>. Mirrors the web
    /// <c>fmtNumber(value, precision)</c> fallback to the module-level <c>_globalPrecision</c>, whose default is
    /// <c>2</c> and which <c>useSettings</c> seeds from <c>settings.decimal_precision ?? 2</c>
    /// (web/src/lib/numberFormat.ts, web/src/hooks/useSettings.ts).
    /// </summary>
    public const int DefaultPrecision = 2;

    /// <summary>Fraction digits used by the hover title (web <c>mph.toFixed(1)</c> / <c>kmh.toFixed(1)</c>).</summary>
    public const int SourceTitlePrecision = 1;

    /// <summary>Metres-per-second in one mile-per-hour (web <c>mph * 0.44704</c>; 1609.344 m / 3600 s, NIST).</summary>
    public const double MetersPerSecondPerMph = 0.44704;

    /// <summary>Metres in one kilometre (web folds km/h via <c>(kmh * 1000) / 3600</c>).</summary>
    public const double MetersPerKilometer = 1000.0;

    /// <summary>Seconds in one hour (web folds km/h via <c>(kmh * 1000) / 3600</c>).</summary>
    public const double SecondsPerHour = 3600.0;
}

/// <summary>
/// Identifies which caller-supplied input produced a <see cref="SpeedProjection"/> — the native analogue of the
/// web component's <c>mph</c>-first / <c>kmh</c>-fallback / neither branch
/// (web/src/components/data-display/format/Speed.tsx).
/// </summary>
public enum SpeedSource
{
    /// <summary>No finite input was supplied; the readout shows the empty fallback and has no title.</summary>
    None = 0,

    /// <summary>The <c>mph</c> input was used (web <c>mph != null &amp;&amp; Number.isFinite(mph)</c>).</summary>
    MilesPerHour,

    /// <summary>The <c>kmh</c> input was used (web <c>else if (kmh != null &amp;&amp; Number.isFinite(kmh))</c>).</summary>
    KilometersPerHour,
}

/// <summary>
/// Pure projection of the readout's render inputs — the native port of the web component body
/// (web/src/components/data-display/format/Speed.tsx). It picks the source input (mph first, then km/h), folds it
/// to SI metres-per-second using the exact factors the web hard-codes, reconverts to the user's display unit via
/// <see cref="UnitConverters.SpeedFromSi"/> (the <c>convertSpeedFromSI</c> port), and formats the number through
/// <see cref="ScalarFormatters.FormatNumber(double?, int, string)"/> — the verified 1:1 port of the web
/// <c>fmtNumber(value, precision)</c> (en-US grouping, fixed fraction digits). The hover <see cref="Title"/> mirrors
/// the web <c>title</c> attribute: the raw caller-supplied value rendered with <c>toFixed(1)</c> plus its source
/// unit. When neither input is finite the projection is the empty fallback (web bare <c>—</c> span, no title).
/// Kept a side-effect-free value type so the adapter is unit-testable without a view-model or a UI thread; the
/// <see cref="SpeedViewModel"/> and the WinUI view both render from it.
/// </summary>
public readonly record struct SpeedProjection
{
    private SpeedProjection(
        SpeedSource source,
        bool hasValue,
        string displayText,
        string? title,
        SpeedUnit unit,
        int precision)
    {
        Source = source;
        HasValue = hasValue;
        DisplayText = displayText;
        Title = title;
        Unit = unit;
        Precision = precision;
    }

    /// <summary>Which caller input produced this projection (mph, km/h, or none).</summary>
    public SpeedSource Source { get; }

    /// <summary>
    /// Whether a finite speed was supplied. False renders the empty fallback (web <c>—</c> branch); true
    /// renders the converted value with its unit.
    /// </summary>
    public bool HasValue { get; }

    /// <summary>
    /// The full visible readout. <c>"{number} {unit}"</c> (e.g. <c>"60.00 mph"</c>) when <see cref="HasValue"/>,
    /// otherwise the empty fallback (em dash). This is the surface's accessible name.
    /// </summary>
    public string DisplayText { get; }

    /// <summary>
    /// The hover title — the raw caller-supplied value in its source unit (web <c>title</c>:
    /// <c>"{mph.toFixed(1)} mph"</c> / <c>"{kmh.toFixed(1)} km/h"</c>). <see langword="null"/> in the empty state,
    /// matching the web span that renders no title when there is no value.
    /// </summary>
    public string? Title { get; }

    /// <summary>The display unit the value was converted to (web <c>unitPrefs.speed</c>).</summary>
    public SpeedUnit Unit { get; }

    /// <summary>The fraction-digit count the number was rendered with (resolved precision; never negative).</summary>
    public int Precision { get; }

    /// <summary>
    /// The accessible name the view exposes to Narrator — the visible readout, so the screen reader announces the
    /// meaningful converted value (web inline span text). Equal to <see cref="DisplayText"/>.
    /// </summary>
    public string AccessibleName => DisplayText;

    /// <summary>
    /// Project the render inputs exactly as the web component body does. <paramref name="mph"/> is preferred when
    /// finite; otherwise <paramref name="kmh"/> when finite; otherwise the empty fallback. The supplied value is
    /// folded to SI metres-per-second, reconverted to <paramref name="pref"/>'s speed unit, and formatted with the
    /// resolved precision (<paramref name="precision"/> when supplied, else <see cref="UnitPref.Precision"/>, else
    /// <see cref="SpeedRegistration.DefaultPrecision"/> — the web <c>precision ?? _globalPrecision</c> chain).
    /// </summary>
    /// <param name="mph">The speed in miles-per-hour (web <c>mph</c>), or null.</param>
    /// <param name="kmh">The speed in kilometres-per-hour (web <c>kmh</c>), or null.</param>
    /// <param name="precision">The per-call fraction-digit override (web <c>precision</c>), or null.</param>
    /// <param name="pref">The user's unit preference bag (web <c>useUnits().unitPrefs</c>).</param>
    public static SpeedProjection Project(double? mph, double? kmh, int? precision, UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);

        SpeedUnit unit = pref.Speed;

        double sourceValue;
        double metersPerSecond;
        SpeedSource source;
        if (IsFinite(mph))
        {
            sourceValue = mph!.Value;
            metersPerSecond = sourceValue * SpeedRegistration.MetersPerSecondPerMph;
            source = SpeedSource.MilesPerHour;
        }
        else if (IsFinite(kmh))
        {
            sourceValue = kmh!.Value;
            metersPerSecond = sourceValue * SpeedRegistration.MetersPerKilometer / SpeedRegistration.SecondsPerHour;
            source = SpeedSource.KilometersPerHour;
        }
        else
        {
            // web: `if (sourceMph == null) return <span className={className}>—</span>;` — em-dash fallback, no title.
            string empty = pref.EmptyDisplay ?? UnitFormatters.DefaultEmptyDisplay;
            return new SpeedProjection(SpeedSource.None, hasValue: false, empty, title: null, unit, precision: 0);
        }

        int resolved = ResolvePrecision(precision, pref);
        double display = UnitConverters.SpeedFromSi(metersPerSecond, unit);
        string number = ScalarFormatters.FormatNumber(display, resolved);
        string displayText = $"{number} {UnitLabels.Label(unit)}";
        string title = $"{FormatFixed(sourceValue, SpeedRegistration.SourceTitlePrecision)} {SourceLabel(source)}";
        return new SpeedProjection(source, hasValue: true, displayText, title, unit, resolved);
    }

    private static string SourceLabel(SpeedSource source) => source switch
    {
        // The title shows the caller's source unit verbatim (web template literals), not the display unit.
        SpeedSource.MilesPerHour => "mph",
        SpeedSource.KilometersPerHour => "km/h",
        _ => string.Empty,
    };

    private static int ResolvePrecision(int? over, UnitPref pref)
    {
        // web fmtNumber(value, precision): `const d = precision ?? _globalPrecision`. A supplied precision wins
        // (even 0); otherwise the user's configured precision (UnitPref.Precision — the _globalPrecision analog);
        // otherwise the documented default of 2. Negatives are clamped to 0 (ScalarFormatters does the same).
        if (over is { } o)
        {
            return o < 0 ? 0 : o;
        }

        if (pref.Precision is { } p)
        {
            return p < 0 ? 0 : p;
        }

        return SpeedRegistration.DefaultPrecision;
    }

    private static bool IsFinite(double? v) => v is { } d && !double.IsNaN(d) && !double.IsInfinity(d);

    private static string FormatFixed(double value, int digits)
    {
        // JS Number.prototype.toFixed(digits): fixed-point, '.' separator, NO thousands grouping, round half away
        // from zero. Reproduced with AwayFromZero rounding + invariant fixed-point formatting.
        double rounded = Math.Round(value, digits, MidpointRounding.AwayFromZero);
        return rounded.ToString("F" + digits.ToString(CultureInfo.InvariantCulture), CultureInfo.InvariantCulture);
    }
}

/// <summary>
/// PII-safe diagnostics for the Speed surface (P1/S11 diagnostics contract). The readout carries no user content
/// beyond a caller-supplied number, so the collector records only the operational <c>view.opened</c> event with
/// the surface slug — never the value or its unit. Thread-safe.
/// </summary>
public sealed class SpeedDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public SpeedDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Speed</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SpeedRegistration.Slug}");
    }
}
