using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces.TemperatureSurface;

/// <summary>
/// Canonical metadata for the <c>Temperature</c> shared surface — the native mirror of the module-level
/// constants and prop defaults in <c>web/src/components/data-display/format/Temperature.tsx</c>. The web
/// component is a pure presentational temperature readout: it takes a caller-supplied value in °C
/// (<c>c</c>) or °F (<c>f</c>), converts the SI Celsius value to the user's display unit
/// (<c>convertTempFromSI(value, unitPrefs.temperature)</c>), and renders the locale-formatted number
/// (<c>fmtNumber(display, precision)</c>) immediately followed by the unit symbol, with a hover
/// <c>title</c> echoing the raw caller value in its source unit. It reads no network data and declares no
/// i18n strings of its own (the only literals are the °C / °F symbols and the em dash), so this carries
/// only the diagnostics slug, the automation id, the formatter's default fraction-digit count and the
/// shared symbol literals.
/// </summary>
public static class TemperatureRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Temperature";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component renders an anonymous inline
    /// <c>&lt;span&gt;</c> with no <c>data-testid</c>, so this is the native-only stable hook UI-automation
    /// tests target.
    /// </summary>
    public const string RootAutomationId = "temperature";

    /// <summary>
    /// The fraction-digit count used when neither the <c>precision</c> prop nor the unit preference supplies
    /// one — the native mirror of the web <c>fmtNumber</c> module-level <c>_globalPrecision</c> default
    /// (<c>let _globalPrecision = 2</c> in <c>web/src/lib/numberFormat.ts</c>), which is what
    /// <c>fmtNumber(value, undefined)</c> falls back to.
    /// </summary>
    public const int DefaultPrecision = 2;

    /// <summary>The em dash (U+2014) shown when no finite value is supplied (web <c>—</c>).</summary>
    public const string EmptyDisplay = "\u2014";

    /// <summary>The Celsius symbol used in the source-value tooltip (web <c>°C</c>).</summary>
    public const string CelsiusSymbol = "\u00B0C";

    /// <summary>The Fahrenheit symbol used in the source-value tooltip (web <c>°F</c>).</summary>
    public const string FahrenheitSymbol = "\u00B0F";
}

/// <summary>
/// The render-time data model the <c>Temperature</c> surface binds to — the native analogue of the web
/// <c>TemperatureProps</c> (<c>{ c?, f?, precision?, className? }</c> in
/// <c>web/src/components/data-display/format/Temperature.tsx</c>). The web component is purely
/// presentational: its parent owns any data fetching and feeds an already-resolved temperature, so — exactly
/// like React re-rendering the element with already-resolved props — there is no fetch-driven loading /
/// error / stale / offline branch to reproduce here; the only branches are "has a finite value" and "no
/// value" (the web <c>sourceC == null</c> guard, surfaced as the em dash). Pure data — no WinUI types — so
/// the projection is unit-tested without a UI host. <paramref name="C"/> takes precedence over
/// <paramref name="F"/> when both are finite, matching the web <c>if (c …) else if (f …)</c> order.
/// </summary>
/// <param name="C">The canonical temperature in °C (web <c>c</c>); null / non-finite falls through to <paramref name="F"/>.</param>
/// <param name="F">The alternative temperature in °F (web <c>f</c>), converted to °C before display; used only when <paramref name="C"/> is absent.</param>
/// <param name="Precision">The fraction-digit override (web <c>precision</c>); null defers to the unit preference, then to <see cref="TemperatureRegistration.DefaultPrecision"/>.</param>
public sealed record TemperatureModel(double? C = null, double? F = null, int? Precision = null)
{
    /// <summary>The no-value model — both inputs absent, rendering the em dash.</summary>
    public static TemperatureModel Empty { get; } = new();

    /// <summary>A model for a temperature supplied in canonical °C (web <c>c</c>).</summary>
    /// <param name="celsius">The temperature in °C.</param>
    /// <param name="precision">The optional fraction-digit override (web <c>precision</c>).</param>
    public static TemperatureModel FromCelsius(double? celsius, int? precision = null) =>
        new(celsius, null, precision);

    /// <summary>A model for a temperature supplied in °F (web <c>f</c>), converted to °C before display.</summary>
    /// <param name="fahrenheit">The temperature in °F.</param>
    /// <param name="precision">The optional fraction-digit override (web <c>precision</c>).</param>
    public static TemperatureModel FromFahrenheit(double? fahrenheit, int? precision = null) =>
        new(null, fahrenheit, precision);
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="TemperatureModel"/> — the native analogue of
/// everything the web component derives before returning JSX
/// (web/src/components/data-display/format/Temperature.tsx): the <see cref="HasValue"/> guard, the
/// visible <see cref="Text"/> (the converted, locale-formatted number plus the unit symbol, or the em
/// dash), the <see cref="Tooltip"/> (the web <c>title</c> echoing the raw caller value in its source unit,
/// or null in the no-value branch) and the <see cref="AutomationName"/> Narrator reads. Pure data so every
/// value is asserted headlessly.
/// </summary>
/// <param name="HasValue">True when a finite temperature was supplied (web <c>sourceC != null</c>).</param>
/// <param name="Text">The visible readout: <c>{number}{unit}</c> with no separating space, or the em dash.</param>
/// <param name="Tooltip">The hover title echoing the raw caller value in its source unit (web <c>title</c>); null when there is no value.</param>
/// <param name="AutomationName">The accessible name Narrator announces (the visible readout).</param>
public sealed record TemperatureDisplay(
    bool HasValue,
    string Text,
    string? Tooltip,
    string AutomationName)
{
    /// <summary>The no-value display — the muted em dash with no tooltip (web <c>&lt;span&gt;—&lt;/span&gt;</c>).</summary>
    public static TemperatureDisplay Empty { get; } = new(
        HasValue: false,
        Text: TemperatureRegistration.EmptyDisplay,
        Tooltip: null,
        AutomationName: TemperatureRegistration.EmptyDisplay);
}

/// <summary>
/// Pure projection from a <see cref="TemperatureModel"/> + the active <see cref="UnitPref"/> to its
/// <see cref="TemperatureDisplay"/> — the native port of web/src/components/data-display/format/Temperature.tsx.
/// Reproduces the web derivations exactly:
/// <list type="bullet">
///   <item><description><c>c</c> takes precedence: when <c>c</c> is non-null and finite the source is <c>c</c>
///   and the tooltip is <c>{c.toFixed(1)} °C</c>; otherwise when <c>f</c> is non-null and finite the source is
///   <c>((f − 32) × 5) ÷ 9</c> and the tooltip is <c>{f.toFixed(1)} °F</c>.</description></item>
///   <item><description>with no finite source the surface is the muted em dash (U+2014) with no
///   tooltip.</description></item>
///   <item><description>the visible value is <c>fmtNumber(convertTempFromSI(sourceC, unit), precision)</c>
///   immediately followed by the unit symbol with no separating space (e.g. "21°C"), where the conversion
///   target and the suffix are both the user's <c>unitPrefs.temperature</c>.</description></item>
///   <item><description>the precision is the <c>precision</c> prop, then the unit preference's precision,
///   then the <c>fmtNumber</c> global default (<see cref="TemperatureRegistration.DefaultPrecision"/>); the
///   number is padded to exactly that many fraction digits (the web <c>min == max == digits</c>
///   contract).</description></item>
/// </list>
/// No WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public static class TemperatureProjection
{
    /// <summary>Project <paramref name="model"/> into a render-ready display in the active units.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="preferences">The user's unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <returns>The render-ready display model.</returns>
    public static TemperatureDisplay Project(TemperatureModel model, UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(preferences);

        double? sourceC = null;
        string? tooltip = null;

        if (model.C is { } c && double.IsFinite(c))
        {
            // web: c != null && Number.isFinite(c) → sourceC = c; title = `${c.toFixed(1)} °C`.
            sourceC = c;
            tooltip = FormatSource(c, TemperatureRegistration.CelsiusSymbol);
        }
        else if (model.F is { } f && double.IsFinite(f))
        {
            // web: else if f finite → sourceC = ((f - 32) * 5) / 9; title = `${f.toFixed(1)} °F`.
            sourceC = ((f - 32) * 5) / 9;
            tooltip = FormatSource(f, TemperatureRegistration.FahrenheitSymbol);
        }

        if (sourceC is null)
        {
            // web: sourceC == null → <span>—</span> (no title).
            return TemperatureDisplay.Empty;
        }

        int precision = ResolvePrecision(model, preferences);
        double displayValue = UnitConverters.TemperatureFromSi(sourceC.Value, preferences.Temperature);
        string text = ScalarFormatters.FormatNumber(displayValue, precision) + UnitLabels.Label(preferences.Temperature);

        return new TemperatureDisplay(
            HasValue: true,
            Text: text,
            Tooltip: tooltip,
            AutomationName: text);
    }

    /// <summary>
    /// Resolve the fraction-digit count exactly as the web <c>fmtNumber(value, precision)</c> does: the
    /// <c>precision</c> prop wins, then the unit preference's precision (the web <c>_globalPrecision</c>
    /// derived from the same setting), then the formatter's default
    /// (<see cref="TemperatureRegistration.DefaultPrecision"/>). Clamped to be non-negative.
    /// </summary>
    /// <param name="model">The render-time data model.</param>
    /// <param name="preferences">The user's unit preference.</param>
    public static int ResolvePrecision(TemperatureModel model, UnitPref preferences)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(preferences);

        int precision = model.Precision ?? preferences.Precision ?? TemperatureRegistration.DefaultPrecision;
        return precision < 0 ? 0 : precision;
    }

    // web title: `${value.toFixed(1)} {unit}` — the raw caller value at a fixed single decimal, a separating
    // space, then the source unit symbol. .NET "F1" rounds half away from zero, matching JS toFixed(1).
    private static string FormatSource(double value, string unit) =>
        $"{value.ToString("F1", CultureInfo.InvariantCulture)} {unit}";
}

/// <summary>
/// PII-safe diagnostics for the <c>Temperature</c> surface (P1/S11 diagnostics contract). The readout
/// carries no user content beyond a caller-supplied number, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never the value. Thread-safe.
/// </summary>
public sealed class TemperatureDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public TemperatureDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Temperature</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={TemperatureRegistration.Slug}");
    }
}
