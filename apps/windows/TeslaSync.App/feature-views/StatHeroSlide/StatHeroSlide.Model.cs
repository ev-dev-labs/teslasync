using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The headline statistic a <see cref="StatHeroSlide"/> renders — the native union of the web
/// <c>field</c> prop the parent year-in-review slideshow passes
/// (web/src/features/analytics/components/review/slides.ts mounts <c>StatHeroSlide</c> twice, once with
/// <c>field='distance'</c> and once with <c>field='energy'</c>). <see cref="Unknown"/> reproduces the web
/// <c>getStatConfig</c> <c>default</c> branch (a 📊 fallback with no value) so an unexpected field id
/// still renders rather than throwing.
/// </summary>
public enum StatHeroField
{
    /// <summary>Total distance driven (web <c>field='distance'</c>).</summary>
    Distance,

    /// <summary>Total energy charged (web <c>field='energy'</c>).</summary>
    Energy,

    /// <summary>An unrecognised field id — the web <c>default</c> fallback branch.</summary>
    Unknown,
}

/// <summary>
/// Maps the web string <c>field</c> prop onto the strongly-typed <see cref="StatHeroField"/>. Mirrors the
/// web <c>getStatConfig</c> <c>switch (field)</c> — only <c>distance</c> and <c>energy</c> are recognised;
/// anything else (including the web <c>slide.field ?? 'distance'</c> fallback's miss) resolves to
/// <see cref="StatHeroField.Unknown"/>. Case-insensitive so the mapping is robust to host casing.
/// </summary>
public static class StatHeroFields
{
    /// <summary>The web field id for the distance slide.</summary>
    public const string DistanceKey = "distance";

    /// <summary>The web field id for the energy slide.</summary>
    public const string EnergyKey = "energy";

    /// <summary>Resolve a web <c>field</c> string (or null) to a <see cref="StatHeroField"/>.</summary>
    public static StatHeroField FromKey(string? key) => (key?.Trim().ToLowerInvariant()) switch
    {
        DistanceKey => StatHeroField.Distance,
        EnergyKey => StatHeroField.Energy,
        _ => StatHeroField.Unknown,
    };

    /// <summary>The canonical web key for a <see cref="StatHeroField"/> (used for diagnostics / cache keys).</summary>
    public static string ToKey(StatHeroField field) => field switch
    {
        StatHeroField.Distance => DistanceKey,
        StatHeroField.Energy => EnergyKey,
        _ => "unknown",
    };
}

/// <summary>
/// The lifecycle state a <see cref="StatHeroSlideViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the surface renders. The web source
/// (web/src/features/analytics/components/review/StatHeroSlide.tsx) is purely presentational (it receives a
/// resolved <c>YearReview</c> as a prop and always renders), while the parent year-in-review page owns the
/// fetch / skeleton / failure branches. The native feature view binds the same
/// <c>GET /analytics/year-review</c> data through a shared state holder, so it reproduces every one of those
/// branches as a visible surface — none is ever hidden. <see cref="Empty"/> mirrors a year with no distance
/// (or no energy) for the selected field rather than an empty HTTP body.
/// </summary>
public enum StatHeroState
{
    /// <summary>Initial fetch with no cached snapshot — render the hero skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a value to show — render the hero.</summary>
    Loaded,

    /// <summary>The snapshot resolved but the selected field has no value — render the empty state.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the hero plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the hero plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The two year-in-review totals the hero slide consumes from <c>GET /analytics/year-review</c> (web
/// <c>YearReview</c> in web/src/api/types.ts). Field names mirror the Go API's snake_case JSON tags
/// (<c>total_distance_km</c>, <c>total_energy_kwh</c>); parsing is null-tolerant so a partial or
/// schema-drifted body never throws. Distance is kilometres (derived SI) and is converted to the user's
/// display unit only at projection time; energy is already kilowatt-hours and needs no conversion.
/// </summary>
/// <param name="TotalDistanceKm">Total distance driven in SI-derived kilometres (web <c>total_distance_km</c>).</param>
/// <param name="TotalEnergyKwh">Total energy charged in kilowatt-hours (web <c>total_energy_kwh</c>).</param>
public sealed record YearReviewTotals(double TotalDistanceKm, double TotalEnergyKwh)
{
    /// <summary>An all-zero snapshot — the parse fallback for an absent / non-object body.</summary>
    public static YearReviewTotals Empty { get; } = new(0, 0);

    /// <summary>True when the year carries any distance or energy worth showing.</summary>
    public bool HasAny => TotalDistanceKm > 0 || TotalEnergyKwh > 0;

    /// <summary>True when the <paramref name="field"/>'s headline value is non-zero (gates the empty state).</summary>
    public bool HasValueFor(StatHeroField field) => field switch
    {
        StatHeroField.Distance => TotalDistanceKm > 0,
        StatHeroField.Energy => TotalEnergyKwh > 0,
        _ => false,
    };

    /// <summary>Project a <c>GET /analytics/year-review</c> JSON object into a tolerant totals snapshot.</summary>
    /// <param name="element">The parsed JSON body.</param>
    /// <returns>A snapshot with every absent or non-numeric field defaulted to zero.</returns>
    public static YearReviewTotals FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new YearReviewTotals(
            TotalDistanceKm: GetDouble(element, "total_distance_km") ?? 0,
            TotalEnergyKwh: GetDouble(element, "total_energy_kwh") ?? 0);
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
/// The fully projected, render-ready hero slide — the native analogue of everything the web
/// <c>getStatConfig</c> computes before <c>StatHeroSlide</c> returns its emoji / <c>AnimatedNumber</c> /
/// unit / comparison column. Pure data (no WinUI types) so the projection is unit-tested without a UI host.
/// <see cref="Value"/> + <see cref="Decimals"/> drive the count-up control; <see cref="FormattedValue"/> is
/// the same number pre-formatted for the accessible name and the test assertions.
/// </summary>
/// <param name="Emoji">The headline emoji (web <c>config.emoji</c>).</param>
/// <param name="Value">The raw numeric value the count-up animates to (web <c>config.value</c>).</param>
/// <param name="Decimals">Fraction digits for the value (web <c>config.decimals</c>).</param>
/// <param name="FormattedValue">The value pre-formatted with grouping (web <c>AnimatedNumber</c> output).</param>
/// <param name="Unit">The unit sub-line (web <c>config.unit</c>).</param>
/// <param name="Comparison">The fun comparison line (web <c>config.comparison</c>).</param>
/// <param name="HasData">True when the selected field has a value to show (gates the empty state).</param>
/// <param name="AutomationName">The composed Narrator name for the whole slide.</param>
public sealed record StatHeroDisplay(
    string Emoji,
    double Value,
    int Decimals,
    string FormattedValue,
    string Unit,
    string Comparison,
    bool HasData,
    string AutomationName);

/// <summary>
/// Pure projection from a parsed <see cref="YearReviewTotals"/> snapshot to the hero slide display model —
/// the native port of <c>getStatConfig</c> in
/// web/src/features/analytics/components/review/StatHeroSlide.tsx. SI is converted to the user's display
/// unit here (and only here); every label and comparison resolves through the i18n facade, with the web
/// <c>{{percent}}</c> / <c>{{days}}</c> interpolation tokens substituted in. The Earth-circumference and
/// home-power heuristics are tied to kilometres / kilowatt-hours regardless of the display unit, exactly as
/// the web source intends. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class StatHeroProjection
{
    /// <summary>1 km = 1000 m (the SI floor the meter-based converter expects).</summary>
    public const double MetersPerKm = 1000.0;

    /// <summary>Earth's equatorial circumference in kilometres (web <c>40075</c>).</summary>
    public const double EarthCircumferenceKm = 40075.0;

    /// <summary>Minimum fraction of an Earth lap before the percentage comparison is shown (web <c>0.01</c>).</summary>
    public const double EarthLapThreshold = 0.01;

    /// <summary>kWh consumed per day of home power for the energy comparison (web <c>30</c>).</summary>
    public const double EnergyKwhPerHomeDay = 30.0;

    /// <summary>Road emoji for the distance slide (web <c>'🛣️'</c>).</summary>
    public const string DistanceEmoji = "\U0001F6E3\uFE0F";

    /// <summary>High-voltage emoji for the energy slide (web <c>'⚡'</c>).</summary>
    public const string EnergyEmoji = "\u26A1";

    /// <summary>Bar-chart emoji for the unknown / fallback slide (web <c>'📊'</c>).</summary>
    public const string FallbackEmoji = "\U0001F4CA";

    /// <summary>Project <paramref name="data"/> for the selected <paramref name="field"/> and the user's units.</summary>
    /// <param name="data">The year-in-review totals snapshot.</param>
    /// <param name="field">The headline statistic to render.</param>
    /// <param name="units">The user's unit preference (the distance unit drives the conversion).</param>
    /// <param name="localizer">The i18n facade every label and comparison resolves through.</param>
    /// <returns>The render-ready hero display model.</returns>
    public static StatHeroDisplay Project(
        YearReviewTotals data,
        StatHeroField field,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        return field switch
        {
            StatHeroField.Distance => ProjectDistance(data, units, localizer),
            StatHeroField.Energy => ProjectEnergy(data, localizer),
            _ => Build(FallbackEmoji, 0, 0, string.Empty, string.Empty, hasData: false),
        };
    }

    private static StatHeroDisplay ProjectDistance(YearReviewTotals data, UnitPref units, ILocalizer localizer)
    {
        // backend total_distance_km is SI km — route through the meter-based converter so the factor lives
        // in Core.Units, mirroring the web meter-floored convertDistanceFromSI(total_distance_km * 1000, unit).
        double value = UnitConverters.DistanceFromSi(data.TotalDistanceKm * MetersPerKm, units.Distance);
        string unit = UnitLabels.Label(units.Distance);

        // web: earthLaps = total_distance_km / 40075 (always km, regardless of the display unit).
        double earthLaps = data.TotalDistanceKm / EarthCircumferenceKm;
        string comparison = earthLaps >= EarthLapThreshold
            ? localizer
                .GetString("yearReview.distanceComparison", "That's {{percent}}% around the Earth!")
                .Replace("{{percent}}", ScalarFormatters.FormatNumber(earthLaps * 100, 1), StringComparison.Ordinal)
            : localizer.GetString("yearReview.distanceSmall", "Every kilometer counts!");

        return Build(DistanceEmoji, value, 0, unit, comparison, data.TotalDistanceKm > 0);
    }

    private static StatHeroDisplay ProjectEnergy(YearReviewTotals data, ILocalizer localizer)
    {
        string unit = localizer.GetString("yearReview.energyUnit", "kWh charged");

        // web: days = Math.round(total_energy_kwh / 30). JS Math.round is half-up; energy is non-negative so
        // AwayFromZero matches. The token is interpolated as a plain integer (i18next does not group numbers).
        int days = (int)Math.Round(data.TotalEnergyKwh / EnergyKwhPerHomeDay, MidpointRounding.AwayFromZero);
        string comparison = localizer
            .GetString("yearReview.energyComparison", "Enough to power a home for {{days}} days")
            .Replace("{{days}}", days.ToString(CultureInfo.InvariantCulture), StringComparison.Ordinal);

        return Build(EnergyEmoji, data.TotalEnergyKwh, 0, unit, comparison, data.TotalEnergyKwh > 0);
    }

    private static StatHeroDisplay Build(string emoji, double value, int decimals, string unit, string comparison, bool hasData)
    {
        string formatted = ScalarFormatters.FormatNumber(value, decimals);
        return new StatHeroDisplay(emoji, value, decimals, formatted, unit, comparison, hasData, AutomationName(formatted, unit, comparison));
    }

    private static string AutomationName(string formattedValue, string unit, string comparison)
    {
        string valueLine = string.IsNullOrEmpty(unit)
            ? formattedValue
            : string.Format(CultureInfo.CurrentCulture, "{0} {1}", formattedValue, unit);

        return string.IsNullOrEmpty(comparison)
            ? valueLine
            : string.Format(CultureInfo.CurrentCulture, "{0}. {1}", valueLine, comparison);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;YearReviewTotals&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class StatHeroResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    /// <param name="raw">The raw cache-then-network emission.</param>
    /// <returns>The same emission with its JSON payload parsed into a <see cref="YearReviewTotals"/>.</returns>
    public static RepositoryResult<YearReviewTotals> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        YearReviewTotals Parse() => raw.HasValue ? YearReviewTotals.FromJson(raw.Value) : YearReviewTotals.Empty;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<YearReviewTotals>.Loading(),
            LoadStatus.Cached => RepositoryResult<YearReviewTotals>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<YearReviewTotals>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<YearReviewTotals>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<YearReviewTotals>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<YearReviewTotals>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<YearReviewTotals>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}

/// <summary>
/// Canonical metadata for the StatHeroSlide surface — the native mirror of the web hero-stat slide
/// (web/src/features/analytics/components/review/StatHeroSlide.tsx, rendered by the year-in-review
/// <c>SlideRenderer</c>). Centralises the stable id, diagnostics slug and the generated year-review
/// operation id so the view and view-model stay free of literal identifiers.
/// </summary>
public static class StatHeroSlideRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "stat-hero-slide";

    /// <summary>Surface category (matches the web analytics feature).</summary>
    public const string Category = "analytics";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11).</summary>
    public const string Slug = "StatHeroSlide";

    /// <summary>
    /// The generated OpenAPI operation id the source reads (<c>GET /analytics/year-review</c>). It exists in
    /// the generated endpoint registry; an audit-pin test asserts it resolves so a contract drift fails the
    /// build rather than surfacing at runtime.
    /// </summary>
    public const string YearReviewOperation = "get_api_v1_analytics_year_review";

    /// <summary>The current calendar year — the web <c>useYearReview(year, …)</c> default window.</summary>
    /// <param name="clock">An optional clock (defaults to the local wall clock) for deterministic tests.</param>
    public static int CurrentYear(Func<DateTimeOffset>? clock = null) => (clock?.Invoke() ?? DateTimeOffset.Now).Year;
}

/// <summary>
/// PII-safe diagnostics for the StatHeroSlide surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a year-review metric, VIN or location —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class StatHeroSlideDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink each diagnostics line is written to, or <see langword="null"/>.</param>
    public StatHeroSlideDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StatHeroSlide</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StatHeroSlideRegistration.Slug}");
    }
}
