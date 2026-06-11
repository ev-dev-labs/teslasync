using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Which of the two Tesla range estimates the surface treats as "the" range — the native analogue of the web
/// <c>RangeType = 'rated' | 'ideal'</c> union (web/src/lib/preferredRange.ts) backing the user's
/// <c>preferred_range</c> General-Settings preference.
/// </summary>
public enum RangeType
{
    /// <summary>EPA-style rated range (web <c>rated</c>) — the fallback when the preference is missing.</summary>
    Rated,

    /// <summary>Ideal range (web <c>ideal</c>).</summary>
    Ideal,
}

/// <summary>
/// The minimal vehicle/charge state snapshot the <see cref="Range"/> surface reads — the native analogue of the
/// web <c>PreferredRangeFields</c> prop (<c>{ rated_range?, ideal_range? }</c>, both SI metres) that
/// <c>&lt;Range /&gt;</c> consumes (web/src/components/data-display/format/Range.tsx). Both fields are nullable and
/// stay null when the source did not report them, so the projection renders the em-dash empty display rather than
/// a fabricated value — exactly as the web component renders <c>—</c> when <c>usePreferredRange(state).meters</c>
/// is null.
/// </summary>
/// <param name="RatedRangeMeters">Rated range in SI metres (web <c>rated_range</c>), or null when absent.</param>
/// <param name="IdealRangeMeters">Ideal range in SI metres (web <c>ideal_range</c>), or null when absent.</param>
public readonly record struct RangeState(double? RatedRangeMeters, double? IdealRangeMeters);

/// <summary>
/// Canonical metadata for the Range surface — the native analogue of the module-level contract in
/// <c>web/src/components/data-display/format/Range.tsx</c>. The web component is a pure presentational leaf (a
/// <c>&lt;span&gt;</c> that renders <c>formatDistance(meters, { precision })</c>, or <c>—</c> when the preferred
/// range is null), so this carries only the diagnostics slug, the automation id, the web <c>precision = 0</c>
/// default, and the i18n keys the companion <c>useRangeLabel</c> resolves through.
/// </summary>
public static class RangeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "Range";

    /// <summary>
    /// The root automation id the view stamps on itself. The web component declares no <c>data-testid</c> (it is
    /// an anonymous inline span), so this is the native-only stable hook UI-automation tests target.
    /// </summary>
    public const string RootAutomationId = "range";

    /// <summary>Default decimal precision for the rendered distance (web <c>precision = 0</c>).</summary>
    public const int DefaultPrecision = 0;

    /// <summary>The i18n key for the rated-range label (web <c>t('common.ratedRange')</c>).</summary>
    public const string RatedLabelKey = "common.ratedRange";

    /// <summary>The English fallback for the rated-range label (web default).</summary>
    public const string RatedLabelDefault = "Rated Range";

    /// <summary>The i18n key for the ideal-range label (web <c>t('common.idealRange')</c>).</summary>
    public const string IdealLabelKey = "common.idealRange";

    /// <summary>The English fallback for the ideal-range label (web default).</summary>
    public const string IdealLabelDefault = "Ideal Range";

    /// <summary>The i18n key for the Narrator "no value" announcement of the empty display.</summary>
    public const string NoValueKey = "common.noData";

    /// <summary>The English fallback for the Narrator "no value" announcement.</summary>
    public const string NoValueDefault = "No data available";
}

/// <summary>
/// Pure projection of the Range readout's render inputs — the native port of the web component body
/// (web/src/components/data-display/format/Range.tsx) plus its <c>useRangeLabel</c> companion. It selects the
/// preferred range value (the port of <c>selectPreferredRange</c> in web/src/lib/preferredRange.ts — defaulting to
/// rated when the preference is missing), formats it through the shared, unit-tested
/// <see cref="UnitFormatters.FormatDistance(double?, UnitPref, int?)"/> (the verified 1:1 of the web
/// <c>formatDistance(meters, { precision })</c>, which itself renders the em dash for null/NaN), and resolves the
/// rated/ideal <see cref="Label"/> through the i18n facade. Kept static and side-effect-free so the adapter is
/// unit-testable without a view-model or a UI thread; the <see cref="RangeViewModel"/> and the WinUI view both
/// render from it.
/// </summary>
public readonly record struct RangeProjection
{
    private RangeProjection(double? meters, RangeType source, bool hasValue, string value, string label, string accessibleName)
    {
        Meters = meters;
        Source = source;
        HasValue = hasValue;
        Value = value;
        Label = label;
        AccessibleName = accessibleName;
    }

    /// <summary>The selected range value in SI metres (web <c>usePreferredRange(state).meters</c>), or null.</summary>
    public double? Meters { get; }

    /// <summary>Which range field was selected (web <c>source</c>), honoring the preferred-range preference.</summary>
    public RangeType Source { get; }

    /// <summary>
    /// True when a finite range value is present. Gates the friendly empty display: false renders the em dash, the
    /// native analogue of the web component returning <c>&lt;span&gt;—&lt;/span&gt;</c> for a null range.
    /// </summary>
    public bool HasValue { get; }

    /// <summary>
    /// The visible readout: the formatted distance honoring the unit + precision preference, or the em-dash empty
    /// display (<see cref="UnitFormatters.DefaultEmptyDisplay"/>) when no value is present.
    /// </summary>
    public string Value { get; }

    /// <summary>
    /// The localized rated/ideal range label (web <c>useRangeLabel</c>). Exposed so a host can render the label
    /// separately from the value and so the surface can build a meaningful Narrator name.
    /// </summary>
    public string Label { get; }

    /// <summary>
    /// The surface's accessible name (Narrator). Combines <see cref="Label"/> with the value — or with the
    /// localized "no value" announcement when empty — so the screen reader hears "Rated Range: 410 km" rather than
    /// a bare em dash.
    /// </summary>
    public string AccessibleName { get; }

    /// <summary>
    /// Project the render inputs. Selects rated vs ideal from <paramref name="preferredRange"/> (defaulting to
    /// rated, matching the web <c>selectPreferredRange</c> fallback), formats the selected metres through
    /// <see cref="UnitFormatters.FormatDistance(double?, UnitPref, int?)"/> with a non-negative precision, and
    /// resolves the rated/ideal label through <paramref name="localizer"/>.
    /// </summary>
    /// <param name="state">The vehicle/charge snapshot (web <c>state</c> prop); null while loading/absent.</param>
    /// <param name="preferredRange">The user's preferred-range preference (web <c>useSettings().rangeType</c>).</param>
    /// <param name="units">The user's display-unit preference (web <c>useUnits().unitPrefs</c>).</param>
    /// <param name="precision">The decimal precision (web <c>precision</c>); negative is treated as the default.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <returns>The render-ready projection.</returns>
    public static RangeProjection Project(
        RangeState? state,
        RangeType preferredRange,
        UnitPref units,
        int precision,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        bool ideal = preferredRange == RangeType.Ideal;
        double? meters = ideal ? state?.IdealRangeMeters : state?.RatedRangeMeters;
        RangeType source = ideal ? RangeType.Ideal : RangeType.Rated;

        int safePrecision = precision < 0 ? RangeRegistration.DefaultPrecision : precision;

        // Web: meters == null ? '—' : formatDistance(meters, { precision }). FormatDistance itself returns the em
        // dash for null/NaN, so a single call reproduces both branches.
        string value = UnitFormatters.FormatDistance(meters, units, safePrecision);
        bool hasValue = meters is { } m && !double.IsNaN(m) && !double.IsInfinity(m);

        // Web useRangeLabel: t(`common.${labelKey}`, defaultLabel).
        string label = ideal
            ? localizer.GetString(RangeRegistration.IdealLabelKey, RangeRegistration.IdealLabelDefault)
            : localizer.GetString(RangeRegistration.RatedLabelKey, RangeRegistration.RatedLabelDefault);

        string announced = hasValue
            ? value
            : localizer.GetString(RangeRegistration.NoValueKey, RangeRegistration.NoValueDefault);
        string accessibleName = $"{label}: {announced}";

        return new RangeProjection(meters, source, hasValue, value, label, accessibleName);
    }
}

/// <summary>
/// PII-safe diagnostics for the Range surface (P1/S11 diagnostics contract). The readout carries only a
/// caller-supplied range value, so the collector records only the operational <c>view.opened</c> event with the
/// surface slug — never the range, VIN or location. Thread-safe.
/// </summary>
public sealed class RangeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public RangeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=Range</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={RangeRegistration.Slug}");
    }
}
