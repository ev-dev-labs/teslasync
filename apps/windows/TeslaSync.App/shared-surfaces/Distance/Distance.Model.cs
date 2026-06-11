using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the Distance surface — the native analogue of the module-level identity in the web
/// <c>Distance</c> renderer (web/src/components/data-display/format/Distance.tsx). The web component is a pure
/// presentational, unit-aware readout: it takes a caller-supplied <c>miles</c> or <c>km</c> value, normalises
/// it to SI metres, converts it to the user's distance preference via <c>convertDistanceFromSI</c>, formats it
/// with <c>fmtNumber</c> and renders <c>{number} {unit}</c> while exposing the raw caller value through the
/// element's <c>title</c> tooltip. It reads no network data and declares no localized strings, so the only
/// registered identity is the diagnostics slug, the stable automation id and the two conversion factors plus
/// the default fraction-digit count the web <c>fmtNumber</c> uses.
/// </summary>
public static class DistanceRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Distance";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component is an anonymous inline
    /// <c>&lt;span&gt;</c> with no <c>data-testid</c>, so this is the native-only stable hook UI-automation
    /// tests target.
    /// </summary>
    public const string RootAutomationId = "distance";

    /// <summary>
    /// The fraction-digit count used when the caller passes no explicit precision — the native analogue of the
    /// web <c>fmtNumber</c> global default (<c>_globalPrecision = 2</c> in numberFormat.ts, which
    /// <c>useSettings</c> seeds from <c>settings.decimal_precision</c>).
    /// </summary>
    public const int DefaultPrecision = 2;

    /// <summary>1 mile = 1609.344 m exactly (international yard, NIST) — the web <c>miles * 1609.344</c> factor.</summary>
    public const double MetersPerMile = 1609.344;

    /// <summary>1 km = 1000 m exactly — the web <c>km * 1000</c> factor.</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>The em dash shown when no finite value is supplied (the web <c>&lt;span&gt;—&lt;/span&gt;</c>).</summary>
    public const string EmptyDisplay = UnitFormatters.DefaultEmptyDisplay;
}

/// <summary>
/// The mutually-exclusive render branches the surface shows — a faithful reproduction of the two branches in
/// the web <c>Distance</c>: the early return when neither input resolves to a finite number
/// (<see cref="Empty"/>, the web <c>—</c> dash) and the formatted readout otherwise (<see cref="Value"/>). The
/// web component is presentational and its only input beyond the caller props is the synchronous unit
/// preference (<c>useUnits</c>), so — like the peer presentational surfaces (AnimatedNumber, VisuallyHidden) —
/// it has no fetch lifecycle and therefore no loading / error / stale / offline branch.
/// </summary>
public enum DistanceState
{
    /// <summary>Neither <c>miles</c> nor <c>km</c> is a finite number — the em-dash readout (web dash branch).</summary>
    Empty = 0,

    /// <summary>A finite <c>miles</c> or <c>km</c> value — the converted, formatted readout with a raw-value tooltip.</summary>
    Value = 1,
}

/// <summary>
/// Pure projection of the readout's render inputs — the native port of the web component body
/// (web/src/components/data-display/format/Distance.tsx). It reproduces the source's exact pipeline: prefer a
/// finite <c>miles</c> value, otherwise a finite <c>km</c> value; normalise it to SI metres (the web
/// <c>miles * 1609.344</c> / <c>km * 1000</c> step, despite the source's <c>sourceMiles</c> identifier the
/// value is metres); convert those metres to the user's distance preference with
/// <see cref="UnitConverters.DistanceFromSi"/> (the web <c>convertDistanceFromSI</c>); format the result
/// through <see cref="ScalarFormatters.FormatNumber(double?, int, string)"/> (the verified 1:1 port of the web
/// <c>fmtNumber</c>, en-US grouping + fixed fraction digits); and render <c>{number} {unit}</c>. The raw
/// caller value is captured at two decimals in its original unit as <see cref="Title"/> — the web
/// <c>title</c> tooltip contract. Kept static and side-effect-free so the adapter is unit-testable without a
/// view-model or a UI thread; the <see cref="DistanceViewModel"/> and the WinUI view both render from it.
/// </summary>
public readonly record struct DistanceProjection
{
    private DistanceProjection(
        DistanceState state,
        string display,
        string? title,
        string unitLabel,
        double? displayValue,
        double? sourceMeters)
    {
        State = state;
        Display = display;
        Title = title;
        UnitLabel = unitLabel;
        DisplayValue = displayValue;
        SourceMeters = sourceMeters;
    }

    /// <summary>Which render branch is showing (web dash vs formatted readout).</summary>
    public DistanceState State { get; }

    /// <summary>
    /// The visible text. In the <see cref="DistanceState.Value"/> state this is <c>{number} {unit}</c>
    /// (e.g. <c>7.46 mi</c>); in the <see cref="DistanceState.Empty"/> state it is the em dash.
    /// </summary>
    public string Display { get; }

    /// <summary>
    /// The raw caller-supplied value formatted at two decimals in its original unit (e.g. <c>12.35 mi</c> or
    /// <c>5.00 km</c>) — the web <c>title</c> tooltip. Null in the empty state, where the web renders no title.
    /// </summary>
    public string? Title { get; }

    /// <summary>The resolved display-unit label (web <c>distanceUnit</c>: <c>mi</c> / <c>km</c> / <c>ft</c>).</summary>
    public string UnitLabel { get; }

    /// <summary>The converted value in the display unit, or null in the empty state (for tests / diagnostics).</summary>
    public double? DisplayValue { get; }

    /// <summary>The canonical SI value in metres the readout was computed from, or null in the empty state.</summary>
    public double? SourceMeters { get; }

    /// <summary>True while the formatted readout is showing (a finite value was supplied).</summary>
    public bool HasValue => State == DistanceState.Value;

    /// <summary>
    /// The surface's accessible name. The web renders an inline text node, so the accessible content is the
    /// visible text itself — Narrator reads the formatted readout (or the dash) rather than a synthesised label.
    /// </summary>
    public string AccessibleName => Display;

    /// <summary>
    /// Project the render inputs exactly as the web component body does. A finite <paramref name="miles"/>
    /// wins; otherwise a finite <paramref name="km"/> is used; otherwise the result is the
    /// <see cref="DistanceState.Empty"/> dash. <paramref name="precision"/> falls back to the user preference
    /// and then to <see cref="DistanceRegistration.DefaultPrecision"/> (the web <c>fmtNumber</c> global
    /// default) and is clamped to be non-negative.
    /// </summary>
    /// <param name="miles">The caller value in miles (web <c>miles</c> prop), or null.</param>
    /// <param name="km">The caller value in kilometres (web <c>km</c> prop), used only when miles is absent.</param>
    /// <param name="precision">The explicit fraction-digit override (web <c>precision</c> prop), or null.</param>
    /// <param name="pref">The user's unit preference bag (the web <c>useUnits().unitPrefs</c>).</param>
    public static DistanceProjection Project(double? miles, double? km, int? precision, UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);

        double? sourceMeters = null;
        string? title = null;

        if (miles is { } milesValue && double.IsFinite(milesValue))
        {
            sourceMeters = milesValue * DistanceRegistration.MetersPerMile;
            title = $"{milesValue.ToString("F2", CultureInfo.InvariantCulture)} mi";
        }
        else if (km is { } kmValue && double.IsFinite(kmValue))
        {
            sourceMeters = kmValue * DistanceRegistration.MetersPerKm;
            title = $"{kmValue.ToString("F2", CultureInfo.InvariantCulture)} km";
        }

        string unitLabel = UnitLabels.Label(pref.Distance);

        if (sourceMeters is null)
        {
            return new DistanceProjection(
                DistanceState.Empty,
                pref.EmptyDisplay ?? DistanceRegistration.EmptyDisplay,
                title: null,
                unitLabel,
                displayValue: null,
                sourceMeters: null);
        }

        double displayValue = UnitConverters.DistanceFromSi(sourceMeters.Value, pref.Distance);
        int digits = ResolvePrecision(precision, pref);
        string number = ScalarFormatters.FormatNumber(displayValue, digits);

        return new DistanceProjection(
            DistanceState.Value,
            $"{number} {unitLabel}",
            title,
            unitLabel,
            displayValue,
            sourceMeters);
    }

    private static int ResolvePrecision(int? precision, UnitPref pref)
    {
        int resolved = precision ?? pref.Precision ?? DistanceRegistration.DefaultPrecision;
        return resolved < 0 ? 0 : resolved;
    }
}

/// <summary>
/// PII-safe diagnostics for the Distance surface (P1/S11 diagnostics contract). The readout carries only a
/// caller-supplied distance, so the collector records nothing but the operational <c>view.opened</c> event
/// with the surface slug — never the value or the formatted readout. Thread-safe.
/// </summary>
public sealed class DistanceDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public DistanceDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Distance</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DistanceRegistration.Slug}");
    }
}
