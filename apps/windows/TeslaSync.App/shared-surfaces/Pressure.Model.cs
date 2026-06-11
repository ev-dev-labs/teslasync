using System.Globalization;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Canonical metadata for the Pressure surface — the native analogue of the module-level constants in
/// <c>web/src/components/data-display/format/Pressure.tsx</c>. The web component is a pure presentational
/// pressure readout: an anonymous <c>&lt;span&gt;</c> that takes a caller-supplied value in <c>bar</c> (its
/// canonical input) or <c>psi</c>, converts it to the SI floor (kilopascals), then renders it in the user's
/// pressure preference (<c>useUnits().unitPrefs.pressure</c>) via <c>fmtNumber(convertPressureFromSI(kPa,
/// pref), precision)</c> with a hover <c>title</c> echoing the raw caller value in its source unit. It reads no
/// network data and declares no <c>t()</c> keys, so this carries only the diagnostics slug, the automation id,
/// the web <c>fmtNumber</c> default precision, and the exact NIST/BIPM source→SI factors the source applies
/// inline (no public <c>*ToSi</c> converter exists in <see cref="UnitConverters"/>, which is SI→display only).
/// </summary>
public static class PressureRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Pressure";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c>
    /// (it is an anonymous inline span), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "pressure";

    /// <summary>
    /// Default fraction digits when the <c>precision</c> prop is absent. Mirrors the web <c>fmtNumber</c>
    /// fallback (<c>numberFormat.ts</c> <c>let _globalPrecision = 2</c>): the readout shows two decimals unless
    /// the host overrides it or the active <see cref="UnitPref.Precision"/> sets a different display precision.
    /// </summary>
    public const int DefaultPrecision = 2;

    /// <summary>1 bar = 100 kPa (BIPM). The web source's <c>sourceBar = bar * 100</c> bar→kPa factor.</summary>
    public const double KpaPerBar = 100.0;

    /// <summary>1 psi = 6.894757 kPa (NIST SP 811). The web source's <c>psi * 6.894757</c> psi→kPa factor.</summary>
    public const double KpaPerPsi = 6.894757;

    /// <summary>Fixed fraction digits for the raw source value echoed in the hover tooltip (web <c>toFixed(2)</c>).</summary>
    public const int TooltipPrecision = 2;
}

/// <summary>
/// Pure projection of the pressure readout's render inputs — the native port of the web component body
/// (<c>web/src/components/data-display/format/Pressure.tsx</c>). It reproduces the two render branches the
/// source has: when <paramref name="bar"/> or <paramref name="psi"/> resolves to a finite value it converts
/// that source unit to the SI floor (kilopascals) with the same factors the source uses inline
/// (<see cref="PressureRegistration.KpaPerBar"/> / <see cref="PressureRegistration.KpaPerPsi"/>), converts the
/// kilopascals to the active display unit through the mandated <see cref="UnitConverters.PressureFromSi"/>
/// port, formats the number with the shared <see cref="ScalarFormatters.FormatNumber(double?, int, string)"/>
/// helper (the verified 1:1 port of the web <c>fmtNumber</c>, en-US grouping + fixed digits), appends the
/// <see cref="UnitLabels"/> label, and echoes the raw caller value in its source unit as the hover tooltip;
/// otherwise it falls back to the em dash (web <c>—</c>) with no tooltip. <c>bar</c> takes precedence over
/// <c>psi</c>, exactly as the source's <c>if (bar) … else if (psi)</c>.
///
/// <para>Because the native units state holder models pressure as the SI floor for metric users
/// (<see cref="UnitPref.Metric"/> → <see cref="PressureUnit.Kpa"/>) and psi for imperial users
/// (<see cref="UnitPref.Imperial"/> → <see cref="PressureUnit.Psi"/>), the rendered unit follows the user's
/// preference just as the web's <c>unitPrefs.pressure</c> does — the behaviour (source→SI→preferred unit, with
/// a source-unit tooltip) is identical; only the concrete preferred unit comes from the native seam. Kept a
/// side-effect-free value type so the adapter is unit-testable without a view-model or a UI thread.</para>
/// </summary>
public readonly record struct PressureProjection
{
    private PressureProjection(
        bool hasValue,
        string text,
        string? tooltip,
        PressureUnit displayUnit,
        double? sourceKpa,
        double? displayValue)
    {
        HasValue = hasValue;
        Text = text;
        Tooltip = tooltip;
        DisplayUnit = displayUnit;
        SourceKpa = sourceKpa;
        DisplayValue = displayValue;
    }

    /// <summary>Whether a finite <c>bar</c>/<c>psi</c> input resolved (false renders the em-dash fallback).</summary>
    public bool HasValue { get; }

    /// <summary>
    /// The readout's text content: <c>{formattedNumber} {unitLabel}</c> when a value is present, or the em dash
    /// (web <c>—</c>) when neither input is finite. This is also the surface's accessible name.
    /// </summary>
    public string Text { get; }

    /// <summary>
    /// The hover tooltip echoing the raw caller value in its source unit (web <c>title</c>, e.g. <c>2.50 bar</c>
    /// / <c>36.00 psi</c>), or null in the empty state where the web span carries no <c>title</c>.
    /// </summary>
    public string? Tooltip { get; }

    /// <summary>The display unit the value was rendered in (the active <see cref="UnitPref.Pressure"/>).</summary>
    public PressureUnit DisplayUnit { get; }

    /// <summary>The SI-floor value (kilopascals) the source unit was converted to, or null in the empty state.</summary>
    public double? SourceKpa { get; }

    /// <summary>The converted display-unit value before formatting, or null in the empty state.</summary>
    public double? DisplayValue { get; }

    /// <summary>The accessible name Narrator announces — the readout's text content (value or em dash).</summary>
    public string AccessibleName => Text;

    /// <summary>
    /// Project the render inputs exactly as the web component body does. <paramref name="bar"/> wins over
    /// <paramref name="psi"/>; a non-finite (null/NaN/Infinity) input is ignored. When neither resolves the
    /// projection is the empty state (em dash, no tooltip). The effective precision is the
    /// <paramref name="precision"/> override, else <see cref="UnitPref.Precision"/>, else
    /// <see cref="PressureRegistration.DefaultPrecision"/>; a negative precision is clamped to zero (the shared
    /// formatter contract) rather than throwing.
    /// </summary>
    /// <param name="bar">The canonical input in bar (web <c>bar</c>), or null.</param>
    /// <param name="psi">The alternative input in psi (web <c>psi</c>), used only when <paramref name="bar"/> is not finite.</param>
    /// <param name="precision">The per-call fraction-digit override (web <c>precision</c>), or null for the default.</param>
    /// <param name="pref">The active unit preference bag (the resolved display unit + locale + precision).</param>
    public static PressureProjection Project(double? bar, double? psi, int? precision, UnitPref pref)
    {
        ArgumentNullException.ThrowIfNull(pref);

        double raw;
        double kpa;
        string sourceUnit;
        if (IsFinite(bar))
        {
            raw = bar!.Value;
            kpa = raw * PressureRegistration.KpaPerBar;
            sourceUnit = UnitLabels.Label(PressureUnit.Bar);
        }
        else if (IsFinite(psi))
        {
            raw = psi!.Value;
            kpa = raw * PressureRegistration.KpaPerPsi;
            sourceUnit = UnitLabels.Label(PressureUnit.Psi);
        }
        else
        {
            // web: `if (sourceBar == null) return <span>—</span>;` — em dash, no title.
            return new PressureProjection(
                hasValue: false,
                text: UnitFormatters.DefaultEmptyDisplay,
                tooltip: null,
                displayUnit: pref.Pressure,
                sourceKpa: null,
                displayValue: null);
        }

        double displayValue = UnitConverters.PressureFromSi(kpa, pref.Pressure);
        string number = ScalarFormatters.FormatNumber(displayValue, ResolvePrecision(precision, pref));
        string text = $"{number} {UnitLabels.Label(pref.Pressure)}";

        // web title: `${raw.toFixed(2)} {sourceUnit}` — fixed two decimals, no grouping, source unit.
        string tooltip = $"{raw.ToString($"F{PressureRegistration.TooltipPrecision}", CultureInfo.InvariantCulture)} {sourceUnit}";

        return new PressureProjection(
            hasValue: true,
            text: text,
            tooltip: tooltip,
            displayUnit: pref.Pressure,
            sourceKpa: kpa,
            displayValue: displayValue);
    }

    private static int ResolvePrecision(int? over, UnitPref pref)
    {
        if (over is { } o)
        {
            return o < 0 ? 0 : o;
        }

        if (pref.Precision is { } p and >= 0)
        {
            return p;
        }

        return PressureRegistration.DefaultPrecision;
    }

    private static bool IsFinite(double? v) => v is { } d && !double.IsNaN(d) && !double.IsInfinity(d);
}

/// <summary>
/// PII-safe diagnostics for the Pressure surface (P1/S11 diagnostics contract). The readout carries no user
/// content beyond a caller-supplied pressure value, so the collector records only the operational
/// <c>view.opened</c> event with the surface slug — never the value. Thread-safe.
/// </summary>
public sealed class PressureDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public PressureDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Pressure</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PressureRegistration.Slug}");
    }
}
