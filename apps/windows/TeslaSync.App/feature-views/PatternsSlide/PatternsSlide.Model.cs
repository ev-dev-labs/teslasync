using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="PatternsSlideViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. It is a strict superset
/// of the web component (web/src/features/analytics/components/review/PatternsSlide.tsx), which is a
/// presentational "Year in Review" slide that simply receives the resolved <c>YearReview</c> object as a prop
/// and always renders. The native feature-view owns its own year-review read (the parity analogue of the web
/// review deck's <c>useYearReview</c> query) and therefore renders the full state matrix the prompt mandates.
/// Every branch maps onto a visible surface — none is ever hidden.
/// </summary>
public enum PatternsSlideState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh snapshot (network or non-stale cache) carrying the year's driving patterns.</summary>
    Loaded,

    /// <summary>The snapshot resolved but carries no year-review patterns — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The driving-patterns slice of <c>GET /analytics/year-review</c> the surface consumes — the five fields the
/// web <c>PatternsSlide</c> reads off its <c>data: YearReview</c> prop (<c>most_active_day_of_week</c>,
/// <c>most_active_hour</c>, <c>avg_drives_per_week</c>, <c>avg_distance_per_drive_km</c>,
/// <c>avg_efficiency_wh_km</c>). Distances/efficiencies are derived SI (kilometres, watt-hours per kilometre)
/// converted to the user's display unit only at projection time. Parsing is null-tolerant so a partial or
/// schema-drifted body never throws. <see cref="HasData"/> mirrors a year-review that actually carries the
/// patterns block (vs an empty <c>{}</c> body, which the cache engine surfaces as an Empty status).
/// </summary>
public sealed record YearReviewPatterns(
    string? MostActiveDayOfWeek,
    int MostActiveHour,
    double AvgDrivesPerWeek,
    double AvgDistancePerDriveKm,
    double AvgEfficiencyWhKm,
    bool HasData)
{
    /// <summary>An all-absent snapshot — the parse fallback for an absent / non-object body.</summary>
    public static YearReviewPatterns Empty { get; } = new(null, 0, 0, 0, 0, false);

    /// <summary>The five wire keys whose presence marks a populated year-review patterns block.</summary>
    private static readonly string[] PatternKeys =
    [
        "most_active_day_of_week",
        "most_active_hour",
        "avg_drives_per_week",
        "avg_distance_per_drive_km",
        "avg_efficiency_wh_km",
    ];

    /// <summary>Project a <c>GET /analytics/year-review</c> JSON object into a tolerant patterns snapshot.</summary>
    public static YearReviewPatterns FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        bool present = false;
        foreach (var key in PatternKeys)
        {
            if (element.TryGetProperty(key, out _))
            {
                present = true;
                break;
            }
        }

        if (!present)
        {
            return Empty;
        }

        return new YearReviewPatterns(
            MostActiveDayOfWeek: GetString(element, "most_active_day_of_week"),
            MostActiveHour: GetInt(element, "most_active_hour"),
            AvgDrivesPerWeek: Safe(GetDouble(element, "avg_drives_per_week")),
            AvgDistancePerDriveKm: Safe(GetDouble(element, "avg_distance_per_drive_km")),
            AvgEfficiencyWhKm: Safe(GetDouble(element, "avg_efficiency_wh_km")),
            HasData: true);
    }

    // web `safe`-style coercion: a finite number passes through; null / NaN / ∞ / non-number becomes 0.
    private static double Safe(double? value) =>
        value is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? v : 0;

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static int GetInt(JsonElement obj, string name)
    {
        double? d = GetDouble(obj, name);
        return d is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? (int)v : 0;
    }

    private static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }
}

/// <summary>
/// One projected, display-ready hero row consumed by the WinUI view — the native analogue of a web
/// icon + label + value card (the "Favorite driving day" and "Peak driving hour" rows). Holds the localized
/// label, the resolved value (or em-dash), the Fluent glyph standing in for the web lucide icon, the
/// categorical palette index (so each row gets the web's accent colour), and a Narrator name. Pure data — no
/// WinUI types.
/// </summary>
public sealed record PatternsRow(
    string Label,
    string Value,
    string Glyph,
    int ColorIndex,
    string AutomationName);

/// <summary>
/// One projected, display-ready stat in the triple readout (drives/week, distance/drive, efficiency) — the
/// native analogue of a web stat column. Holds the already-formatted value, the localized unit label, and a
/// Narrator name. Pure data — no WinUI types.
/// </summary>
public sealed record PatternsMetric(string Value, string Label, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the patterns slide — the heading, the two hero rows and the
/// three stat columns plus the <see cref="HasData"/> gate. Pure data so the projection is unit-tested without
/// a UI host.
/// </summary>
public sealed record PatternsDisplay(
    bool HasData,
    string Heading,
    PatternsRow FavoriteDay,
    PatternsRow PeakHour,
    IReadOnlyList<PatternsMetric> Metrics);

/// <summary>
/// Pure projection from a parsed <see cref="YearReviewPatterns"/> to the slide's heading, hero rows and stat
/// columns — the native port of the unit conversion + JSX composition in
/// web/src/features/analytics/components/review/PatternsSlide.tsx. SI is converted to the user's display unit
/// here (and only here); every label resolves through the i18n facade. No WinUI types — unit-tested without a
/// UI host.
/// </summary>
public static class PatternsSlideProjection
{
    /// <summary>1 km = 1000 m (web converts <c>avg_distance_per_drive_km * 1000</c> to SI metres).</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>1 mile = 1.609344 km (web <c>KM_PER_MILE</c>) — the Wh/km → Wh/mi factor.</summary>
    public const double KmPerMile = 1.609344;

    /// <summary>Em-dash shown for an absent favorite-day string (web <c>value || '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The Wh/km efficiency unit label (web <c>efficiencyUnit</c> for km/ft display).</summary>
    public const string EfficiencyUnitMetric = "Wh/km";

    /// <summary>The Wh/mi efficiency unit label (web <c>efficiencyUnit</c> for mi display).</summary>
    public const string EfficiencyUnitImperial = "Wh/mi";

    // Segoe Fluent Icons standing in for the web lucide icons (Calendar, Clock).
    private const string CalendarGlyph = "\uE787"; // Calendar
    private const string ClockGlyph = "\uE823";    // Clock

    // Accent palette indices: blue (#0072B2) for the day row ≈ web indigo-400; sky (#56B4E9) for the hour
    // row ≈ web sky-400.
    private const int CalendarColorIndex = 0;
    private const int ClockColorIndex = 4;

    /// <summary>Project <paramref name="data"/> into the slide display using the user's units.</summary>
    public static PatternsDisplay Project(
        YearReviewPatterns data,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        string heading = localizer.GetString(HeadingKey, "Your driving patterns");
        string favoriteDayLabel = localizer.GetString(FavoriteDayKey, "Favorite driving day");
        string peakHourLabel = localizer.GetString(PeakHourKey, "Peak driving hour");
        string drivesWeekLabel = localizer.GetString(DrivesWeekKey, "drives/week");
        string distanceTemplate = localizer.GetString(DistancePerDriveKey, "{0}/drive avg");
        string avgWord = localizer.GetString(AvgKey, "avg");

        bool imperial = units.Distance == DistanceUnit.Mi;
        string distanceUnitLabel = UnitLabels.Label(units.Distance);
        string efficiencyUnit = imperial ? EfficiencyUnitImperial : EfficiencyUnitMetric;

        // web: convertDistanceFromSI(avg_distance_per_drive_km * 1000, distanceUnit), then Math.round.
        double avgDistDisplay = UnitConverters.DistanceFromSi(data.AvgDistancePerDriveKm * MetersPerKm, units.Distance);
        // web: distanceUnit === 'mi' ? avg_efficiency_wh_km * KM_PER_MILE : avg_efficiency_wh_km, then Math.round.
        double avgEffDisplay = imperial ? data.AvgEfficiencyWhKm * KmPerMile : data.AvgEfficiencyWhKm;

        string dayValue = string.IsNullOrEmpty(data.MostActiveDayOfWeek) ? EmDash : data.MostActiveDayOfWeek!;
        string hourValue = FormatHour(data.MostActiveHour);

        var favoriteDay = new PatternsRow(
            favoriteDayLabel,
            dayValue,
            CalendarGlyph,
            CalendarColorIndex,
            RowAutomationName(favoriteDayLabel, dayValue));

        var peakHour = new PatternsRow(
            peakHourLabel,
            hourValue,
            ClockGlyph,
            ClockColorIndex,
            RowAutomationName(peakHourLabel, hourValue));

        // web: fmtNumber(avg_drives_per_week, 1) — locale grouping + 1 decimal.
        string drivesValue = ScalarFormatters.FormatNumber(data.AvgDrivesPerWeek, 1);
        // web: Math.round(...) rendered as a bare integer (positive values → round half away from zero).
        string distanceValue = ScalarFormatters.FormatNumber(Round(avgDistDisplay), 0);
        string efficiencyValue = ScalarFormatters.FormatNumber(Round(avgEffDisplay), 0);

        string distanceLabel = string.Format(CultureInfo.CurrentCulture, distanceTemplate, distanceUnitLabel);
        string efficiencyLabel = $"{efficiencyUnit} {avgWord}";

        var metrics = new List<PatternsMetric>(3)
        {
            new(drivesValue, drivesWeekLabel, MetricAutomationName(drivesValue, drivesWeekLabel)),
            new(distanceValue, distanceLabel, MetricAutomationName(distanceValue, distanceLabel)),
            new(efficiencyValue, efficiencyLabel, MetricAutomationName(efficiencyValue, efficiencyLabel)),
        };

        return new PatternsDisplay(data.HasData, heading, favoriteDay, peakHour, metrics);
    }

    /// <summary>
    /// Format an hour-of-day (0–23) as the web's 12-hour clock label — a verbatim port of the web
    /// <c>hourLabel</c> expression. 0 → "12 AM", 1–11 → "{h} AM", 12 → "12 PM", 13–23 → "{h-12} PM". The
    /// AM/PM designators are the web source's literal day-period markers (the web does not localize them, and
    /// they are not among the slide's extracted i18n labels).
    /// </summary>
    public static string FormatHour(int hour) => hour >= 12
        ? string.Format(CultureInfo.CurrentCulture, "{0} PM", hour == 12 ? 12 : hour - 12)
        : string.Format(CultureInfo.CurrentCulture, "{0} AM", hour == 0 ? 12 : hour);

    // web Math.round: positive values round half up (== half away from zero). Patterns values are non-negative.
    private static double Round(double value) => Math.Round(value, MidpointRounding.AwayFromZero);

    private static string RowAutomationName(string label, string value) =>
        string.Format(CultureInfo.CurrentCulture, "{0}: {1}", label, value);

    private static string MetricAutomationName(string value, string label) =>
        string.Format(CultureInfo.CurrentCulture, "{0} {1}", value, label);

    /// <summary>i18n key for the slide heading (web <c>yearReview.drivingPatterns</c>).</summary>
    public const string HeadingKey = "translation.yearReview.drivingPatterns";

    /// <summary>i18n key for the favorite-day row label (web <c>yearReview.favoriteDay</c>).</summary>
    public const string FavoriteDayKey = "translation.yearReview.favoriteDay";

    /// <summary>i18n key for the peak-hour row label (web <c>yearReview.peakHour</c>).</summary>
    public const string PeakHourKey = "translation.yearReview.peakHour";

    /// <summary>i18n key for the drives/week stat label (web <c>yearReview.drivesWeek</c>).</summary>
    public const string DrivesWeekKey = "translation.yearReview.drivesWeek";

    /// <summary>i18n key for the distance/drive stat label (web <c>yearReview.distancePerDrive</c>, "{0}/drive avg").</summary>
    public const string DistancePerDriveKey = "translation.yearReview.distancePerDrive";

    /// <summary>i18n key for the "avg" efficiency suffix word (web <c>yearReview.avg</c>).</summary>
    public const string AvgKey = "translation.yearReview.avg";
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;YearReviewPatterns&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class PatternsSlideResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<YearReviewPatterns> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        YearReviewPatterns Parse() =>
            raw.HasValue ? YearReviewPatterns.FromJson(raw.Value) : YearReviewPatterns.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<YearReviewPatterns>.Loading(),
            LoadStatus.Cached => RepositoryResult<YearReviewPatterns>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<YearReviewPatterns>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<YearReviewPatterns>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<YearReviewPatterns>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<YearReviewPatterns>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<YearReviewPatterns>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical registry metadata for the Patterns Slide surface — the native mirror of the web component
/// (web/src/features/analytics/components/review/PatternsSlide.tsx, one slide of the Year-in-Review deck).
/// Centralises the stable id, category, diagnostics slug and the default review year so the view and
/// view-model stay free of literal identifiers.
/// </summary>
public static class PatternsSlideRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "patterns-slide";

    /// <summary>Surface category (matches the web analytics feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "PatternsSlide";

    /// <summary>The review year the surface requests when the host does not pin one (the current UTC year).</summary>
    public static int DefaultYear => DateTimeOffset.UtcNow.Year;
}

/// <summary>
/// PII-safe diagnostics for the Patterns Slide surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a fleet metric, VIN, year or location —
/// so a diagnostics line can never leak the year-in-review data. Thread-safe.
/// </summary>
public sealed class PatternsSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PatternsSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PatternsSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PatternsSlideRegistration.Slug}");
    }
}
