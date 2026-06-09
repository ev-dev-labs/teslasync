using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The mutually-exclusive render branch of the <c>DriveHighlightSlide</c> surface — the native union of the
/// branches the web component renders
/// (web/src/features/analytics/components/review/DriveHighlightSlide.tsx). The web source is a pure
/// presentational component: it takes <c>drive</c>, <c>label</c> and <c>emoji</c> as props and performs no
/// fetching, so the branch is a direct function of the input <see cref="DriveHighlightSlideModel"/> and there
/// is no fetch-driven loading / error / stale / offline branch to reproduce (the parent year-in-review page
/// owns those, exactly as React re-renders the slide with already-resolved props). Both branches map onto a
/// visible surface — neither is ever hidden.
/// </summary>
public enum DriveHighlightSlideState
{
    /// <summary>
    /// A drive highlight is present (web <c>drive</c> truthy): the emoji, the label and the glass stats card
    /// (route, distance, duration, efficiency and date).
    /// </summary>
    Content,

    /// <summary>
    /// No drive highlight for this year (web <c>!drive</c>): the emoji over the friendly
    /// "No drive data for this year" copy, never a blank box.
    /// </summary>
    Empty,
}

/// <summary>
/// One year-in-review drive highlight — the native mirror of the web <c>YearReviewDriveHighlight</c>
/// (web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags; every numeric is SI as the
/// type doc-comments declare (<see cref="DistanceKm"/> in kilometres, <see cref="DurationMin"/> in minutes,
/// <see cref="EfficiencyWhKm"/> in watt-hours per kilometre) and is converted to the user's display unit only
/// in <see cref="DriveHighlightSlideProjection"/>. Parsing is null-tolerant so a partial row never throws.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="DriveId">The drive id (web <c>drive_id</c>).</param>
/// <param name="Date">The pre-formatted short date label (web <c>date</c>), shown verbatim.</param>
/// <param name="DistanceKm">Distance travelled in kilometres (web <c>distance_km</c>, derived SI).</param>
/// <param name="DurationMin">Drive duration in minutes (web <c>duration_min</c>).</param>
/// <param name="StartAddress">Reverse-geocoded start address, or null (web <c>start_address</c>).</param>
/// <param name="EndAddress">Reverse-geocoded end address, or null (web <c>end_address</c>).</param>
/// <param name="EfficiencyWhKm">Energy intensity in watt-hours per kilometre (web <c>efficiency_wh_km</c>, SI).</param>
public sealed record YearReviewDriveHighlight(
    long DriveId,
    string Date,
    double DistanceKm,
    double DurationMin,
    string? StartAddress,
    string? EndAddress,
    double EfficiencyWhKm)
{
    /// <summary>
    /// Project a cached highlight payload into a model, mirroring the web prop's <c>YearReviewDriveHighlight |
    /// null</c> shape: a JSON <c>null</c> (or any non-object) maps to <see langword="null"/> (the empty slide),
    /// otherwise the object is parsed tolerantly via <see cref="FromJson"/>.
    /// </summary>
    public static YearReviewDriveHighlight? ParseNullable(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? FromJson(element) : null;

    /// <summary>Project a single highlight JSON object into a tolerant model.</summary>
    public static YearReviewDriveHighlight FromJson(JsonElement obj) => new(
        GetLong(obj, "drive_id"),
        GetString(obj, "date") ?? string.Empty,
        GetDouble(obj, "distance_km") ?? 0,
        GetDouble(obj, "duration_min") ?? 0,
        GetString(obj, "start_address"),
        GetString(obj, "end_address"),
        GetDouble(obj, "efficiency_wh_km") ?? 0);

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => 0,
        };
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The render-time data model the <c>DriveHighlightSlide</c> view binds to — the native analogue of the web
/// <c>Props</c> (<c>{ drive, label, emoji }</c> in
/// web/src/features/analytics/components/review/DriveHighlightSlide.tsx). The component is presentational, so
/// this model carries the optional <see cref="Drive"/> highlight (null renders the empty branch), the
/// per-slide <see cref="Label"/> ("Longest Drive", "Most Efficient", …) and the <see cref="Emoji"/>. The unit
/// preference is supplied separately (the <c>useUnits</c> seam) so the projection stays pure. Pure data — no
/// WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Drive">The drive highlight to render, or null for the empty branch (web <c>drive</c>).</param>
/// <param name="Label">The slide's label (web <c>label</c>).</param>
/// <param name="Emoji">The slide's emoji (web <c>emoji</c>).</param>
public sealed record DriveHighlightSlideModel(
    YearReviewDriveHighlight? Drive,
    string Label,
    string Emoji)
{
    /// <summary>The initial model — an empty (no-drive) slide with no label or emoji.</summary>
    public static DriveHighlightSlideModel Empty { get; } = new(null, string.Empty, string.Empty);
}

/// <summary>
/// The fully projected, render-ready view of a drive highlight — the native analogue of everything the web
/// component computes before returning JSX. Holds the resolved <see cref="State"/>, the entrance content
/// (emoji + label), the empty copy, and (for the content branch) the route endpoints, the three already-unit-
/// converted and formatted stats, the date and the composed Narrator name. Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Emoji">The slide emoji (both branches).</param>
/// <param name="Label">The slide label (content branch).</param>
/// <param name="EmptyMessage">The localized "No drive data for this year" copy (empty branch).</param>
/// <param name="RouteStart">The start address, or an em dash (content branch).</param>
/// <param name="RouteEnd">The end address, or an em dash (content branch).</param>
/// <param name="DistanceText">The rounded distance in the user's unit (content branch).</param>
/// <param name="DistanceUnit">The distance unit label, e.g. "mi" / "km" (content branch).</param>
/// <param name="DurationText">The formatted drive duration, e.g. "1h 35m" (content branch).</param>
/// <param name="DurationLabel">The localized "duration" caption (content branch).</param>
/// <param name="EfficiencyText">The rounded efficiency, or an em dash when unknown (content branch).</param>
/// <param name="EfficiencyUnit">The efficiency unit label, "Wh/mi" / "Wh/km" (content branch).</param>
/// <param name="DateText">The pre-formatted date label (content branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record DriveHighlightSlideDisplay(
    DriveHighlightSlideState State,
    string Emoji,
    string Label,
    string EmptyMessage,
    string RouteStart,
    string RouteEnd,
    string DistanceText,
    string DistanceUnit,
    string DurationText,
    string DurationLabel,
    string EfficiencyText,
    string EfficiencyUnit,
    string DateText,
    string AutomationName);

/// <summary>
/// Pure projection from the input <see cref="DriveHighlightSlideModel"/> + unit preference to the render-ready
/// <see cref="DriveHighlightSlideDisplay"/> — the native port of the branch selection, the SI-to-display unit
/// conversion, the rounding and the duration formatting in
/// web/src/features/analytics/components/review/DriveHighlightSlide.tsx. Distances convert from SI metres to
/// the user's unit exactly as the web <c>convertDistanceFromSI(distance_km * 1000, …)</c> does, efficiency is
/// scaled to watt-hours per mile by the exact <c>KM_PER_MILE</c> factor when the unit is miles, and rounding
/// matches JavaScript's <c>Math.round</c> (round-half-up). UI-free so the whole contract is unit-tested
/// without a XAML runtime.
/// </summary>
public static class DriveHighlightSlideProjection
{
    /// <summary>i18n key for the empty-state message (web <c>t('yearReview.noDriveData', …)</c>).</summary>
    public const string NoDriveDataKey = "yearReview.noDriveData";

    /// <summary>English fallback for <see cref="NoDriveDataKey"/> (matches the web default).</summary>
    public const string NoDriveDataFallback = "No drive data for this year";

    /// <summary>i18n key for the duration caption (web <c>t('yearReview.duration', …)</c>).</summary>
    public const string DurationKey = "yearReview.duration";

    /// <summary>English fallback for <see cref="DurationKey"/> (matches the web default).</summary>
    public const string DurationFallback = "duration";

    /// <summary>Efficiency unit label when the distance unit is miles (web <c>'Wh/mi'</c>).</summary>
    public const string EfficiencyUnitMiles = "Wh/mi";

    /// <summary>Efficiency unit label otherwise (web <c>'Wh/km'</c>).</summary>
    public const string EfficiencyUnitKm = "Wh/km";

    /// <summary>1 mile = 1.609344 km exactly — the web <c>KM_PER_MILE</c> efficiency-scaling factor.</summary>
    public const double KmPerMile = 1.609344;

    private const string EmDash = "\u2014";
    private const string RouteArrow = "\u2192";
    private const double MetresPerKm = 1000.0;
    private const double MinutesPerHour = 60.0;

    /// <summary>Project <paramref name="model"/> for the active <paramref name="units"/> and <paramref name="localizer"/>.</summary>
    public static DriveHighlightSlideDisplay Project(
        DriveHighlightSlideModel model,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string emoji = model.Emoji ?? string.Empty;
        string label = model.Label ?? string.Empty;

        if (model.Drive is not { } drive)
        {
            string emptyMessage = localizer.GetString(NoDriveDataKey, NoDriveDataFallback);
            return new DriveHighlightSlideDisplay(
                DriveHighlightSlideState.Empty,
                emoji,
                label,
                emptyMessage,
                RouteStart: string.Empty,
                RouteEnd: string.Empty,
                DistanceText: string.Empty,
                DistanceUnit: string.Empty,
                DurationText: string.Empty,
                DurationLabel: string.Empty,
                EfficiencyText: string.Empty,
                EfficiencyUnit: string.Empty,
                DateText: string.Empty,
                AutomationName: emptyMessage);
        }

        bool isMiles = units.Distance == DistanceUnit.Mi;
        string distanceUnit = UnitLabels.Label(units.Distance);
        string efficiencyUnit = isMiles ? EfficiencyUnitMiles : EfficiencyUnitKm;

        // Web parity: convertDistanceFromSI(distance_km * 1000, distanceUnit), then Math.round.
        double distDisplay = UnitConverters.DistanceFromSi(drive.DistanceKm * MetresPerKm, units.Distance);
        string distanceText = FormatRounded(distDisplay);

        string durationText = FormatDuration(drive.DurationMin);
        string durationLabel = localizer.GetString(DurationKey, DurationFallback);

        // Web parity: effDisplay = distanceUnit === 'mi' ? eff * KM_PER_MILE : eff; shown only when eff > 0.
        double effDisplay = isMiles ? drive.EfficiencyWhKm * KmPerMile : drive.EfficiencyWhKm;
        string efficiencyText = drive.EfficiencyWhKm > 0 ? FormatRounded(effDisplay) : EmDash;

        string routeStart = string.IsNullOrEmpty(drive.StartAddress) ? EmDash : drive.StartAddress;
        string routeEnd = string.IsNullOrEmpty(drive.EndAddress) ? EmDash : drive.EndAddress;
        string dateText = drive.Date ?? string.Empty;

        string automationName = BuildAutomationName(
            label, routeStart, routeEnd, distanceText, distanceUnit,
            durationText, durationLabel, efficiencyText, efficiencyUnit, dateText);

        return new DriveHighlightSlideDisplay(
            DriveHighlightSlideState.Content,
            emoji,
            label,
            EmptyMessage: string.Empty,
            routeStart,
            routeEnd,
            distanceText,
            distanceUnit,
            durationText,
            durationLabel,
            efficiencyText,
            efficiencyUnit,
            dateText,
            automationName);
    }

    /// <summary>
    /// Format an SI-minutes drive duration exactly as the web does (web
    /// <c>hours = floor(min / 60); mins = min % 60; hours &gt; 0 ? `${hours}h ${mins}m` : `${mins}m`</c>):
    /// an em dash for non-finite input, otherwise "{h}h {m}m" when there is an hour component, else "{m}m".
    /// </summary>
    public static string FormatDuration(double minutes)
    {
        if (double.IsNaN(minutes) || double.IsInfinity(minutes))
        {
            return EmDash;
        }

        long hours = (long)Math.Floor(minutes / MinutesPerHour);
        double mins = minutes - (hours * MinutesPerHour);
        string minsText = JsNumber(mins);
        return hours > 0
            ? string.Create(CultureInfo.InvariantCulture, $"{hours}h {minsText}m")
            : minsText + "m";
    }

    /// <summary>
    /// Round to the nearest integer with JavaScript <c>Math.round</c> semantics (round-half-up) and render it
    /// without grouping separators, matching the web's raw <c>{Math.round(value)}</c> interpolation. A non-finite
    /// input yields an em dash.
    /// </summary>
    public static string FormatRounded(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return EmDash;
        }

        long rounded = (long)Math.Floor(value + 0.5);
        return rounded.ToString(CultureInfo.InvariantCulture);
    }

    private static string JsNumber(double value)
    {
        if (!double.IsInfinity(value) && value == Math.Floor(value))
        {
            return ((long)value).ToString(CultureInfo.InvariantCulture);
        }

        return value.ToString("0.######", CultureInfo.InvariantCulture);
    }

    private static string BuildAutomationName(
        string label,
        string routeStart,
        string routeEnd,
        string distanceText,
        string distanceUnit,
        string durationText,
        string durationLabel,
        string efficiencyText,
        string efficiencyUnit,
        string dateText)
    {
        var parts = new List<string>(6);
        if (!string.IsNullOrEmpty(label))
        {
            parts.Add(label);
        }

        parts.Add(string.Concat(routeStart, " ", RouteArrow, " ", routeEnd));
        parts.Add(string.Concat(distanceText, " ", distanceUnit));
        parts.Add(string.Concat(durationText, " ", durationLabel));
        parts.Add(string.Concat(efficiencyText, " ", efficiencyUnit));
        if (!string.IsNullOrEmpty(dateText))
        {
            parts.Add(dateText);
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Canonical diagnostics metadata for the Drive Highlight Slide surface — the stable slug emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract) and the Segoe Fluent Icons glyphs that stand in for
/// the web Lucide icons (MapPin, ArrowRight, Clock, Zap). UI-free so the metadata is asserted in tests.
/// </summary>
public static class DriveHighlightSlideRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "DriveHighlightSlide";

    /// <summary>Segoe Fluent "MapPin" glyph for the route (web <c>MapPin</c>).</summary>
    public const string MapPinGlyph = "\uE81D";

    /// <summary>Segoe Fluent "Forward" glyph between the start and end addresses (web <c>ArrowRight</c>).</summary>
    public const string ArrowRightGlyph = "\uE72A";

    /// <summary>Segoe Fluent "Recent" glyph for the duration stat (web <c>Clock</c>).</summary>
    public const string ClockGlyph = "\uE823";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the efficiency stat (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";
}

/// <summary>
/// PII-safe diagnostics for the Drive Highlight Slide surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, address, date or drive id —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class DriveHighlightSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public DriveHighlightSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=DriveHighlightSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={DriveHighlightSlideRegistration.Slug}");
    }
}
