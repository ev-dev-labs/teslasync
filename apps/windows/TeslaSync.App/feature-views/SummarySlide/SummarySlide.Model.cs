using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Review;

/// <summary>
/// The mutually-exclusive render branch of the <c>SummarySlide</c> surface — the native union of the branches
/// the web component renders (web/src/features/analytics/components/review/SummarySlide.tsx). The web source is
/// a pure presentational component: it takes a resolved <c>data: YearReview</c> prop and performs no fetching,
/// so the branch is a direct function of the input <see cref="SummarySlideModel"/> and there is no fetch-driven
/// loading / error / stale / offline branch to reproduce — the parent year-in-review page owns those, exactly as
/// React re-renders the slide with already-resolved props (the same contract the sibling DriveHighlightSlide /
/// AuditPanel ports document). Both branches map onto a visible surface — neither is ever hidden.
/// </summary>
public enum SummarySlideState
{
    /// <summary>
    /// A year-in-review summary is present (web <c>data</c> truthy): the screenshot-friendly glass card with the
    /// year + title header, the vehicle name/model, the five headline stats and (when positive) the gas-savings
    /// line, plus the share caption beneath it.
    /// </summary>
    Content,

    /// <summary>
    /// No summary is available (the native model carries no <see cref="YearReviewSummary"/>): the friendly
    /// "No drive data for this year" copy, never a blank box. The web prop is non-nullable so the parent page
    /// guards this case; the native view renders an honest empty surface for robustness.
    /// </summary>
    Empty,
}

/// <summary>
/// The subset of the year-in-review payload the <c>SummarySlide</c> renders — the native mirror of the fields
/// the web <c>YearReview</c> prop exposes to this slide (web/src/api/types.ts). Field names mirror the Go API's
/// snake_case JSON tags; numerics are SI as the type doc-comments declare (<see cref="TotalDistanceKm"/> in
/// kilometres) and are converted to the user's display unit only in <see cref="SummarySlideProjection"/>.
/// <see cref="TotalEnergyKwh"/>, <see cref="Co2OffsetKg"/> and <see cref="GasSavings"/> are shown verbatim in
/// their canonical unit exactly as the web slide displays them (kWh / kg / currency, no conversion). Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types — so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Year">The review year (web <c>year</c>), shown as the card headline.</param>
/// <param name="VehicleName">The vehicle's display name (web <c>vehicle.display_name</c>).</param>
/// <param name="VehicleModel">The vehicle's model label (web <c>vehicle.model</c>).</param>
/// <param name="TotalDrives">Total number of drives in the year (web <c>total_drives</c>).</param>
/// <param name="TotalDistanceKm">Total distance travelled in kilometres (web <c>total_distance_km</c>, derived SI).</param>
/// <param name="TotalEnergyKwh">Total energy in kilowatt-hours (web <c>total_energy_kwh</c>, shown as kWh).</param>
/// <param name="TotalChargeSessions">Total number of charge sessions (web <c>total_charge_sessions</c>).</param>
/// <param name="Co2OffsetKg">CO₂ offset in kilograms (web <c>co2_offset_kg</c>, SI).</param>
/// <param name="GasSavings">Estimated savings versus a gas car (web <c>gas_savings</c>, currency).</param>
public sealed record YearReviewSummary(
    int Year,
    string VehicleName,
    string VehicleModel,
    long TotalDrives,
    double TotalDistanceKm,
    double TotalEnergyKwh,
    long TotalChargeSessions,
    double Co2OffsetKg,
    double GasSavings)
{
    /// <summary>
    /// Project a cached year-in-review payload into a model, mirroring the web prop's <c>YearReview | null</c>
    /// shape: a JSON <c>null</c> (or any non-object) maps to <see langword="null"/> (the empty slide), otherwise
    /// the object is parsed tolerantly via <see cref="FromJson"/>.
    /// </summary>
    public static YearReviewSummary? ParseNullable(JsonElement element) =>
        element.ValueKind == JsonValueKind.Object ? FromJson(element) : null;

    /// <summary>Project a single year-in-review JSON object into a tolerant model.</summary>
    public static YearReviewSummary FromJson(JsonElement obj)
    {
        string name = string.Empty;
        string model = string.Empty;
        if (obj.TryGetProperty("vehicle", out var vehicle) && vehicle.ValueKind == JsonValueKind.Object)
        {
            name = GetString(vehicle, "display_name") ?? string.Empty;
            model = GetString(vehicle, "model") ?? string.Empty;
        }

        return new YearReviewSummary(
            (int)GetLong(obj, "year"),
            name,
            model,
            GetLong(obj, "total_drives"),
            GetDouble(obj, "total_distance_km") ?? 0,
            GetDouble(obj, "total_energy_kwh") ?? 0,
            GetLong(obj, "total_charge_sessions"),
            GetDouble(obj, "co2_offset_kg") ?? 0,
            GetDouble(obj, "gas_savings") ?? 0);
    }

    private static long GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return 0;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.Number when v.TryGetDouble(out var d) && !double.IsNaN(d) && !double.IsInfinity(d) => (long)d,
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
/// The render-time data model the <c>SummarySlide</c> view binds to — the native analogue of the web
/// <c>Props</c> (<c>{ data }</c> in web/src/features/analytics/components/review/SummarySlide.tsx). The component
/// is presentational, so this model carries the optional <see cref="Review"/> summary (null renders the empty
/// branch). The unit preference is supplied separately (the <c>useUnits</c> seam) so the projection stays pure.
/// Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Review">The year-in-review summary to render, or null for the empty branch (web <c>data</c>).</param>
public sealed record SummarySlideModel(YearReviewSummary? Review)
{
    /// <summary>The initial model — an empty (no-summary) slide.</summary>
    public static SummarySlideModel Empty { get; } = new((YearReviewSummary?)null);
}

/// <summary>
/// One headline stat row — the native analogue of an entry in the web <c>stats</c> array (icon + animated value
/// + label). Holds the decorative <see cref="Glyph"/>, the already-unit-converted numeric <see cref="Value"/>
/// the animated number tweens to, its <see cref="Decimals"/>, the localized <see cref="Label"/> (or unit), and
/// the grouped <see cref="ValueText"/> the number settles on — pre-formatted with the same en-US formatter the
/// <c>TsAnimatedNumber</c> control uses so the composed Narrator name matches the visible digits. Pure data.
/// </summary>
/// <param name="Glyph">The Segoe Fluent glyph that stands in for the web Lucide icon (decorative).</param>
/// <param name="Value">The numeric value, already converted to the user's unit where applicable.</param>
/// <param name="Decimals">Fraction digits the value is rendered with (web <c>decimals</c>).</param>
/// <param name="Label">The localized label, or the distance unit (web <c>label</c>).</param>
/// <param name="ValueText">The grouped, settled value text (for Narrator and assertions).</param>
public sealed record SummaryStat(
    string Glyph,
    double Value,
    int Decimals,
    string Label,
    string ValueText);

/// <summary>
/// The fully projected, render-ready view of the summary slide — the native analogue of everything the web
/// component computes before returning JSX. Holds the resolved <see cref="State"/>, the header (year + title +
/// vehicle), the five <see cref="Stats"/>, the conditional gas-savings line, the brand + share captions, the
/// empty copy and the composed Narrator name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="YearText">The review year as the headline (content branch).</param>
/// <param name="Title">The localized "Year in Review" subtitle (content branch).</param>
/// <param name="VehicleName">The vehicle display name, or an em dash (content branch).</param>
/// <param name="VehicleModel">The vehicle model label, or an em dash (content branch).</param>
/// <param name="Stats">The five headline stats (content branch).</param>
/// <param name="ShowSavings">Whether the gas-savings line renders (web <c>gas_savings &gt; 0</c>).</param>
/// <param name="SavingsText">The composed gas-savings line, with the money emoji (content branch).</param>
/// <param name="SavingsAnnouncement">The gas-savings line without the emoji, for Narrator (content branch).</param>
/// <param name="BrandText">The brand + title footer line (content branch).</param>
/// <param name="ScreenshotText">The localized share caption beneath the card (content branch).</param>
/// <param name="EmptyMessage">The localized "No drive data for this year" copy (empty branch).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record SummarySlideDisplay(
    SummarySlideState State,
    string YearText,
    string Title,
    string VehicleName,
    string VehicleModel,
    IReadOnlyList<SummaryStat> Stats,
    bool ShowSavings,
    string SavingsText,
    string SavingsAnnouncement,
    string BrandText,
    string ScreenshotText,
    string EmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from the input <see cref="SummarySlideModel"/> + unit preference to the render-ready
/// <see cref="SummarySlideDisplay"/> — the native port of the <c>stats</c> assembly, the SI-to-display distance
/// conversion, the JavaScript-faithful <c>Math.round</c> on the gas savings and the conditional savings branch
/// in web/src/features/analytics/components/review/SummarySlide.tsx. Distance converts from SI metres to the
/// user's unit exactly as the web <c>convertDistanceFromSI(total_distance_km * 1000, …)</c> does; every other
/// stat is shown in its canonical unit (drives, kWh, charges, kg CO₂) with no conversion, matching the web.
/// Values are grouped with the same en-US formatter the <c>TsAnimatedNumber</c> control renders. UI-free so the
/// whole contract is unit-tested without a XAML runtime.
/// </summary>
public static class SummarySlideProjection
{
    /// <summary>i18n key for the "Drives" stat label (web <c>t('yearReview.totalDrives', …)</c>).</summary>
    public const string TotalDrivesKey = "yearReview.totalDrives";

    /// <summary>English fallback for <see cref="TotalDrivesKey"/> (matches the web default).</summary>
    public const string TotalDrivesFallback = "Drives";

    /// <summary>i18n key for the "kWh" stat label (web <c>t('yearReview.energyKwh', …)</c>).</summary>
    public const string EnergyKwhKey = "yearReview.energyKwh";

    /// <summary>English fallback for <see cref="EnergyKwhKey"/> (matches the web default).</summary>
    public const string EnergyKwhFallback = "kWh";

    /// <summary>i18n key for the "Charges" stat label (web <c>t('yearReview.charges', …)</c>).</summary>
    public const string ChargesKey = "yearReview.charges";

    /// <summary>English fallback for <see cref="ChargesKey"/> (matches the web default).</summary>
    public const string ChargesFallback = "Charges";

    /// <summary>i18n key for the "kg CO₂ saved" stat label (web <c>t('yearReview.co2KgSaved', …)</c>).</summary>
    public const string Co2KgSavedKey = "yearReview.co2KgSaved";

    /// <summary>English fallback for <see cref="Co2KgSavedKey"/> (matches the web default).</summary>
    public const string Co2KgSavedFallback = "kg CO\u2082 saved";

    /// <summary>i18n key for the card subtitle (web <c>t('yearReview.title', …)</c>).</summary>
    public const string TitleKey = "yearReview.title";

    /// <summary>English fallback for <see cref="TitleKey"/> (matches the web default).</summary>
    public const string TitleFallback = "Year in Review";

    /// <summary>i18n key for the gas-savings line (web <c>t('yearReview.savedSummary', …)</c>).</summary>
    public const string SavedSummaryKey = "yearReview.savedSummary";

    /// <summary>English fallback for <see cref="SavedSummaryKey"/> ("{0}" mirrors the i18next "{{amount}}" slot).</summary>
    public const string SavedSummaryFallback = "Saved ${0} vs. gas";

    /// <summary>i18n key for the share caption (web <c>t('yearReview.screenshot', …)</c>).</summary>
    public const string ScreenshotKey = "yearReview.screenshot";

    /// <summary>English fallback for <see cref="ScreenshotKey"/> (matches the web default).</summary>
    public const string ScreenshotFallback = "\U0001F4F8 Screenshot to share your year!";

    /// <summary>i18n key for the empty-state copy (reused from the sibling drive-highlight slide).</summary>
    public const string NoDataKey = "yearReview.noDriveData";

    /// <summary>English fallback for <see cref="NoDataKey"/> (matches the web default).</summary>
    public const string NoDataFallback = "No drive data for this year";

    private const string BrandName = "TeslaSync";
    private const string MoneyEmoji = "\U0001F4B0";
    private const string Bullet = " \u2022 ";
    private const string EmDash = "\u2014";
    private const double MetresPerKm = 1000.0;

    /// <summary>Project <paramref name="model"/> for the active <paramref name="units"/> and <paramref name="localizer"/>.</summary>
    public static SummarySlideDisplay Project(
        SummarySlideModel model,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        if (model.Review is not { } review)
        {
            string emptyMessage = localizer.GetString(NoDataKey, NoDataFallback);
            return new SummarySlideDisplay(
                SummarySlideState.Empty,
                YearText: string.Empty,
                Title: string.Empty,
                VehicleName: string.Empty,
                VehicleModel: string.Empty,
                Stats: Array.Empty<SummaryStat>(),
                ShowSavings: false,
                SavingsText: string.Empty,
                SavingsAnnouncement: string.Empty,
                BrandText: string.Empty,
                ScreenshotText: string.Empty,
                EmptyMessage: emptyMessage,
                AutomationName: emptyMessage);
        }

        string title = localizer.GetString(TitleKey, TitleFallback);
        string distanceUnit = UnitLabels.Label(units.Distance);

        // Web parity: convertDistanceFromSI(total_distance_km * 1000, distanceUnit).
        double distanceDisplay = UnitConverters.DistanceFromSi(review.TotalDistanceKm * MetresPerKm, units.Distance);

        var stats = new List<SummaryStat>(5)
        {
            Stat(SummarySlideRegistration.CarGlyph, review.TotalDrives, localizer.GetString(TotalDrivesKey, TotalDrivesFallback)),
            Stat(SummarySlideRegistration.CarGlyph, distanceDisplay, distanceUnit),
            Stat(SummarySlideRegistration.ZapGlyph, review.TotalEnergyKwh, localizer.GetString(EnergyKwhKey, EnergyKwhFallback)),
            Stat(SummarySlideRegistration.PlugGlyph, review.TotalChargeSessions, localizer.GetString(ChargesKey, ChargesFallback)),
            Stat(SummarySlideRegistration.LeafGlyph, review.Co2OffsetKg, localizer.GetString(Co2KgSavedKey, Co2KgSavedFallback)),
        };

        bool showSavings = review.GasSavings > 0;
        string savingsAnnouncement = string.Empty;
        string savingsText = string.Empty;
        if (showSavings)
        {
            savingsAnnouncement = string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString(SavedSummaryKey, SavedSummaryFallback),
                JsRound(review.GasSavings));
            savingsText = string.Concat(MoneyEmoji, " ", savingsAnnouncement);
        }

        string vehicleName = string.IsNullOrEmpty(review.VehicleName) ? EmDash : review.VehicleName;
        string vehicleModel = string.IsNullOrEmpty(review.VehicleModel) ? EmDash : review.VehicleModel;
        string yearText = review.Year.ToString(CultureInfo.InvariantCulture);
        string brandText = string.Concat(BrandName, Bullet, title);
        string screenshotText = localizer.GetString(ScreenshotKey, ScreenshotFallback);
        string automationName = BuildAutomationName(yearText, title, vehicleName, vehicleModel, stats, savingsAnnouncement);

        return new SummarySlideDisplay(
            SummarySlideState.Content,
            yearText,
            title,
            vehicleName,
            vehicleModel,
            stats,
            showSavings,
            savingsText,
            savingsAnnouncement,
            brandText,
            screenshotText,
            EmptyMessage: string.Empty,
            automationName);
    }

    /// <summary>
    /// Round to the nearest integer with JavaScript <c>Math.round</c> semantics (round-half-up), matching the
    /// web's <c>Math.round(data.gas_savings)</c> before it is interpolated into the savings line.
    /// </summary>
    public static long JsRound(double value)
    {
        if (double.IsNaN(value) || double.IsInfinity(value))
        {
            return 0;
        }

        return (long)Math.Floor(value + 0.5);
    }

    private static SummaryStat Stat(string glyph, double value, string label) => new(
        glyph,
        value,
        Decimals: 0,
        label,
        ScalarFormatters.FormatNumber(value));

    private static string BuildAutomationName(
        string yearText,
        string title,
        string vehicleName,
        string vehicleModel,
        IReadOnlyList<SummaryStat> stats,
        string savingsAnnouncement)
    {
        var parts = new List<string>(8)
        {
            string.Concat(yearText, " ", title),
            string.Concat(vehicleName, " ", vehicleModel),
        };

        foreach (var stat in stats)
        {
            parts.Add(string.Concat(stat.ValueText, " ", stat.Label));
        }

        if (!string.IsNullOrEmpty(savingsAnnouncement))
        {
            parts.Add(savingsAnnouncement);
        }

        return string.Join(", ", parts);
    }
}

/// <summary>
/// Canonical diagnostics metadata for the Summary Slide surface — the stable slug emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract) and the Segoe Fluent Icons glyphs that stand in for
/// the web Lucide icons (Car, Zap, Plug, Leaf). UI-free so the metadata is asserted in tests.
/// </summary>
public static class SummarySlideRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SummarySlide";

    /// <summary>Segoe Fluent "Car" glyph for the drives + distance stats (web <c>Car</c>).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the energy stat (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "PlugConnected" glyph for the charges stat (web <c>Plug</c>).</summary>
    public const string PlugGlyph = "\uE7E8";

    /// <summary>Segoe Fluent "World" glyph for the CO₂ stat (web <c>Leaf</c>; no native leaf glyph).</summary>
    public const string LeafGlyph = "\uE909";
}

/// <summary>
/// PII-safe diagnostics for the Summary Slide surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle name, distance, energy figure or
/// savings amount — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class SummarySlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SummarySlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SummarySlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SummarySlideRegistration.Slug}");
    }
}
