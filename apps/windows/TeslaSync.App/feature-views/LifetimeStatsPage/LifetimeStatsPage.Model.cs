using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// One personal-record entry — the native mirror of the web <c>PersonalRecord</c>
/// (web/src/api/hooks/useAnalytics.ts): a numeric <see cref="Value"/> (SI on the wire — the longest-drive value
/// is kilometres and the highest-speed value is km/h, exactly as the web treats them) plus an optional ISO
/// <see cref="Date"/>. Pure data — no WinUI types.
/// </summary>
public sealed record LifetimeRecord(double Value, string? Date);

/// <summary>
/// One lifetime achievement — the native mirror of the web <c>LifetimeAchievement</c>
/// (web/src/api/hooks/useAnalytics.ts). The achievement gallery binds each of these into the shared
/// <c>AchievementBadge</c> surface, so the field set matches the web <c>AchievementData</c> prop verbatim.
/// Pure data.
/// </summary>
public sealed record LifetimeAchievementInfo(
    string Id,
    string Name,
    string Description,
    string Icon,
    bool Unlocked,
    string? UnlockedAt,
    double Progress,
    int Target,
    int Current);

/// <summary>
/// The aggregate lifetime statistics — the native mirror of the web <c>LifetimeStats</c> read
/// (<c>GET /analytics/lifetime</c>). Field names follow the snake_case wire shape (no camelCaseKeys on native):
/// the stats are stored as the backend reports them and the page applies the same display conversions the web
/// does at the render boundary (the SI distance/speed converters). Pure data.
/// </summary>
public sealed record LifetimeStats(
    double TotalDrives,
    double TotalDistanceKm,
    double TotalDrivingHours,
    double AvgEfficiencyWhKm,
    double TotalChargeSessions,
    double TotalEnergyKwh,
    double TotalChargingCost,
    double GasEquivalentCost,
    double TotalSavings,
    double Co2OffsetKg,
    double TreesEquivalent,
    double EarthCircumferences,
    double MoonTrips,
    double DaysOnRoad,
    double HomesEquivalentDays,
    string? FirstDriveDate,
    double OwnershipDays,
    string MostActiveDayOfWeek,
    double? MostActiveHour,
    LifetimeRecord? LongestDriveRecord,
    LifetimeRecord? HighestSpeedRecord,
    LifetimeRecord? MaxChargeRecord,
    IReadOnlyList<LifetimeAchievementInfo> Achievements)
{
    /// <summary>The all-zero stats used when the read resolves with no object.</summary>
    public static LifetimeStats Empty { get; } = new(
        0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
        null, 0, string.Empty, null, null, null, null,
        Array.Empty<LifetimeAchievementInfo>());

    /// <summary>Project a <c>GET /analytics/lifetime</c> JSON object into a tolerant stats snapshot, or null.</summary>
    public static LifetimeStats? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LifetimeStats(
            TotalDrives: LifetimeJson.Double(element, "total_drives") ?? 0,
            TotalDistanceKm: LifetimeJson.Double(element, "total_distance_km") ?? 0,
            TotalDrivingHours: LifetimeJson.Double(element, "total_driving_hours") ?? 0,
            AvgEfficiencyWhKm: LifetimeJson.Double(element, "avg_efficiency_wh_km") ?? 0,
            TotalChargeSessions: LifetimeJson.Double(element, "total_charge_sessions") ?? 0,
            TotalEnergyKwh: LifetimeJson.Double(element, "total_energy_kwh") ?? 0,
            TotalChargingCost: LifetimeJson.Double(element, "total_charging_cost") ?? 0,
            GasEquivalentCost: LifetimeJson.Double(element, "gas_equivalent_cost") ?? 0,
            TotalSavings: LifetimeJson.Double(element, "total_savings") ?? 0,
            Co2OffsetKg: LifetimeJson.Double(element, "co2_offset_kg") ?? 0,
            TreesEquivalent: LifetimeJson.Double(element, "trees_equivalent") ?? 0,
            EarthCircumferences: LifetimeJson.Double(element, "earth_circumferences") ?? 0,
            MoonTrips: LifetimeJson.Double(element, "moon_trips") ?? 0,
            DaysOnRoad: LifetimeJson.Double(element, "days_on_road") ?? 0,
            HomesEquivalentDays: LifetimeJson.Double(element, "homes_equivalent_days") ?? 0,
            FirstDriveDate: LifetimeJson.String(element, "first_drive_date"),
            OwnershipDays: LifetimeJson.Double(element, "ownership_days") ?? 0,
            MostActiveDayOfWeek: LifetimeJson.String(element, "most_active_day_of_week") ?? string.Empty,
            MostActiveHour: LifetimeJson.Double(element, "most_active_hour"),
            LongestDriveRecord: LifetimeJson.Record(element, "longest_drive_record"),
            HighestSpeedRecord: LifetimeJson.Record(element, "highest_speed_record"),
            MaxChargeRecord: LifetimeJson.Record(element, "max_charge_record"),
            Achievements: LifetimeJson.Achievements(element));
    }
}

/// <summary>
/// The single-source snapshot the page binds to (web <c>useLifetimeStats</c>). The lifetime stats drive every
/// section; a null <see cref="Stats"/> is the page-level empty surface.
/// </summary>
public sealed record LifetimeStatsSnapshot(LifetimeStats? Stats)
{
    /// <summary>The empty snapshot — no stats object.</summary>
    public static LifetimeStatsSnapshot Empty { get; } = new((LifetimeStats?)null);

    /// <summary>True when the stats object resolved (the page has something to render).</summary>
    public bool HasData => Stats is not null;
}

/// <summary>The single-source data port the page binds to (the native P1/S8 seam). The view never performs HTTP.</summary>
public interface ILifetimeStatsFeed
{
    /// <summary>Fetch the lifetime stats for the active vehicle.</summary>
    Task<LifetimeStatsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptyLifetimeStatsFeed : ILifetimeStatsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyLifetimeStatsFeed Instance { get; } = new();

    private EmptyLifetimeStatsFeed()
    {
    }

    /// <inheritdoc />
    public Task<LifetimeStatsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(LifetimeStatsSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum LifetimeStatsState
{
    /// <summary>The query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no stats — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The query failed — the retriable error surface.</summary>
    Error,

    /// <summary>Stats resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>
/// The render-time input the projection consumes — the parsed <see cref="Snapshot"/> plus the page lifecycle
/// (the query's <see cref="Loading"/> / <see cref="ErrorDetail"/>). The view-model fills this in; tests construct
/// it directly. Pure data — no WinUI types.
/// </summary>
public sealed record LifetimeStatsModel(LifetimeStatsSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the query is in flight with no data yet.</summary>
    public static LifetimeStatsModel Initial { get; } = new(LifetimeStatsSnapshot.Empty, true, null);
}

/// <summary>One key stat card (web GlassPanel2..5): label, pre-formatted value, optional sublabel and glyph.</summary>
public sealed record LifetimeTileDisplay(string Label, string Value, string Sublabel, string Glyph);

/// <summary>One fun-fact tile (web GlassPanel6): an icon, a pre-formatted value, an optional unit and a label.</summary>
public sealed record LifetimeFunFactDisplay(string Icon, string Value, string Unit, string Label);

/// <summary>One personal-record card (web GlassPanel9): a title, a pre-formatted value and an optional date.</summary>
public sealed record LifetimeRecordDisplay(string Title, string Value, string Date, string Glyph);

/// <summary>One activity-summary mini stat (web GlassPanel10): a label and a pre-formatted value.</summary>
public sealed record LifetimeMiniStatDisplay(string Label, string Value);

/// <summary>
/// The projected savings comparison (web GlassPanel7): the two cost bars (electric vs gasoline, sharing a max),
/// the "you saved" total and the avoided-CO2 caption. <see cref="HasData"/> mirrors the web gate
/// (<c>gas_equivalent_cost &gt; 0</c>); otherwise the panel shows <see cref="EmptyMessage"/>.
/// </summary>
public sealed record LifetimeSavingsDisplay(
    bool HasData,
    string ElectricLabel,
    double ElectricValue,
    string ElectricValueText,
    string GasLabel,
    double GasValue,
    string GasValueText,
    double MaxCost,
    string YouSavedLabel,
    string SavedValueText,
    string Co2Text,
    string EmptyMessage);

/// <summary>
/// The projected environmental impact (web GlassPanel8): the CO2 progress ring (percent of a 1-tonne goal), the
/// CO2 offset readout, and the trees-equivalent / coffees-equivalent fun comparisons — every value pre-formatted.
/// </summary>
public sealed record LifetimeEnvironmentDisplay(
    double RingPercent,
    double Co2Kg,
    string Co2Label,
    string TreesValue,
    string TreesLabel,
    string CoffeesValue,
    string CoffeesLabel);

/// <summary>
/// The render-ready projection the view binds to — every web region of LifetimeStatsPage.tsx as pre-formatted,
/// WinUI-free data: the four data-state flags, the hero distance counter, the four key-stat cards, the fun facts,
/// the savings comparison, the environmental impact, the personal records, the activity summary and the
/// achievement gallery. Each section carries its own empty message so no region ever renders blank.
/// </summary>
public sealed record LifetimeStatsDisplay(
    LifetimeStatsState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string ErrorText,
    string RetryLabel,
    string EmptyTitle,
    string EmptyMessage,
    bool HasStats,
    double HeroDistanceValue,
    string HeroDistanceUnit,
    string HeroSubtitle,
    string HeroEarthCompare,
    string HeroSince,
    IReadOnlyList<LifetimeTileDisplay> StatCards,
    string FunFactsTitle,
    IReadOnlyList<LifetimeFunFactDisplay> FunFacts,
    string FunFactsEmptyMessage,
    string SavingsTitle,
    LifetimeSavingsDisplay Savings,
    string EnvironmentTitle,
    LifetimeEnvironmentDisplay Environment,
    string EnvironmentEmptyMessage,
    string RecordsTitle,
    IReadOnlyList<LifetimeRecordDisplay> Records,
    string RecordsEmptyMessage,
    string ActivityTitle,
    IReadOnlyList<LifetimeMiniStatDisplay> Activity,
    string ActivityEmptyMessage,
    string AchievementsTitle,
    string AchievementsSummary,
    IReadOnlyList<LifetimeAchievementInfo> Achievements,
    string AchievementsEmptyMessage,
    string AutomationName);

/// <summary>
/// Pure projection from <see cref="LifetimeStatsModel"/> to <see cref="LifetimeStatsDisplay"/> — the native port
/// of the web LifetimeStatsPage's render path. It mirrors the web's exact display conversions at the boundary via
/// the shared SI converters/formatters (so the native output equals the canonical web truth, ADR-006), and
/// resolves every visible string through the injected localizer. No WinUI / HTTP / IO.
/// </summary>
public static class LifetimeStatsProjection
{
    /// <summary>Web hero/fun-fact emoji glyphs (rendered as text, decorative — hidden from Narrator).</summary>
    public const string EarthEmoji = "\uD83C\uDF0E";    // earth globe

    /// <summary>Moon comparison emoji (web <c>Moon</c>).</summary>
    public const string MoonEmoji = "\uD83C\uDF19";

    /// <summary>Tree comparison emoji (web <c>TreePine</c>).</summary>
    public const string TreeEmoji = "\uD83C\uDF32";

    /// <summary>Home comparison emoji (web <c>Home</c>).</summary>
    public const string HomeEmoji = "\uD83C\uDFE0";

    /// <summary>Trees-equivalent emoji used in the environmental impact panel.</summary>
    public const string TreesEmoji = "\uD83C\uDF33";

    /// <summary>Coffee-cups emoji used in the environmental impact panel.</summary>
    public const string CoffeeEmoji = "\u2615";

    /// <summary>The Segoe Fluent glyph for the page-level empty surface (Trophy / FavoriteStar).</summary>
    public const string EmptyGlyph = "\uE735";

    /// <summary>Segoe Fluent — Car (web <c>Car</c>).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent — Speed/Gauge (web <c>Gauge</c>).</summary>
    public const string GaugeGlyph = "\uE9D9";

    /// <summary>Segoe Fluent — LightningBolt (web <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent — Money (web <c>DollarSign</c>).</summary>
    public const string MoneyGlyph = "\uE1D6";

    private const string EmDash = "\u2014";
    private const string Co2 = "CO\u2082";
    private const double KmToMeters = 1000.0;
    private const double SecondsPerHour = 3600.0;
    private const double TonneKg = 1000.0;
    private const double CoffeeCostUsd = 5.0;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed lifetime snapshot plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static LifetimeStatsDisplay Project(LifetimeStatsModel model, UnitPref units, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);
        _ = now;

        var s = LifetimeStatsStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var stats = snapshot.Stats;
        bool hasStats = snapshot.HasData;
        var st = stats ?? LifetimeStats.Empty;

        string distanceUnit = UnitLabels.Label(units.Distance);
        string speedUnit = UnitLabels.Label(units.Speed);

        LifetimeStatsState state =
            model.Loading && !hasStats ? LifetimeStatsState.Loading
            : model.ErrorDetail is not null ? LifetimeStatsState.Error
            : !hasStats ? LifetimeStatsState.Empty
            : LifetimeStatsState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.Title
            : $"{s.Title}: {model.ErrorDetail}";

        // ── Hero (web GlassPanel1) ───────────────────────────────────────────────────────────────────────
        double heroDistance = FromKm(st.TotalDistanceKm, units);
        string heroSubtitle = string.Format(CultureInfo.CurrentCulture, s.HeroSubtitle, Int(st.TotalDrives));
        string heroEarth = hasStats && st.EarthCircumferences > 0
            ? string.Format(CultureInfo.CurrentCulture, s.EarthCompare, Num(st.EarthCircumferences, 2))
            : string.Empty;
        string heroSince = hasStats && st.OwnershipDays > 0
            ? string.Format(CultureInfo.CurrentCulture, s.Since, ShortDate(st.FirstDriveDate), Int(st.OwnershipDays))
            : string.Empty;

        // ── Key stat cards (web Total-Drives / Total-Distance / Total-Energy / Total-Savings) ─────────────
        var statCards = new[]
        {
            new LifetimeTileDisplay(
                s.TotalDrives, Int(st.TotalDrives), $"{Num(st.TotalDrivingHours, 1)} {s.Hours}", CarGlyph),
            new LifetimeTileDisplay(
                s.TotalDistance, $"{Num(heroDistance, 0)} {distanceUnit}", string.Empty, GaugeGlyph),
            new LifetimeTileDisplay(
                s.TotalEnergy, $"{Num(st.TotalEnergyKwh, 1)} kWh", $"{Int(st.TotalChargeSessions)} {s.Sessions}", ZapGlyph),
            new LifetimeTileDisplay(
                s.TotalSavings, ScalarFormatters.FormatCurrency(st.TotalSavings, "$", 0), s.VsGas, MoneyGlyph),
        };

        // ── Fun facts (web GlassPanel6) ──────────────────────────────────────────────────────────────────
        var funFacts = new[]
        {
            new LifetimeFunFactDisplay(EarthEmoji, Num(st.EarthCircumferences * 100, 1), "%", s.EarthProgress),
            new LifetimeFunFactDisplay(MoonEmoji, Num(st.MoonTrips * 100, 2), "%", s.MoonProgress),
            new LifetimeFunFactDisplay(TreeEmoji, Int(st.TreesEquivalent), string.Empty, s.TreesPlanted),
            new LifetimeFunFactDisplay(HomeEmoji, Num(st.HomesEquivalentDays, 1), s.Days, s.HomesPowered),
        };

        // ── Savings comparison (web GlassPanel7) ─────────────────────────────────────────────────────────
        double evCost = st.TotalChargingCost;
        double gasCost = st.GasEquivalentCost;
        double maxCost = Math.Max(Math.Max(evCost, gasCost), 1);
        var savings = new LifetimeSavingsDisplay(
            HasData: hasStats && gasCost > 0,
            ElectricLabel: s.ElectricCost,
            ElectricValue: evCost,
            ElectricValueText: ScalarFormatters.FormatCurrency(evCost, "$", 2),
            GasLabel: s.GasCost,
            GasValue: gasCost,
            GasValueText: ScalarFormatters.FormatCurrency(gasCost, "$", 2),
            MaxCost: maxCost,
            YouSavedLabel: s.YouSaved,
            SavedValueText: ScalarFormatters.FormatCurrency(st.TotalSavings, "$", 2),
            Co2Text: $"{Num(st.Co2OffsetKg, 0)} kg {Co2} {s.Avoided}",
            EmptyMessage: s.NoSavingsData);

        // ── Environmental impact (web GlassPanel8) ───────────────────────────────────────────────────────
        var environment = new LifetimeEnvironmentDisplay(
            RingPercent: Math.Min(st.Co2OffsetKg / TonneKg * 100, 100),
            Co2Kg: st.Co2OffsetKg,
            Co2Label: s.Co2Offset,
            TreesValue: Int(st.TreesEquivalent),
            TreesLabel: s.TreesEquiv,
            CoffeesValue: Int(Math.Round(st.TotalSavings / CoffeeCostUsd, MidpointRounding.AwayFromZero)),
            CoffeesLabel: s.CoffeesEquiv);

        // ── Personal records (web GlassPanel9) ───────────────────────────────────────────────────────────
        var records = new[]
        {
            new LifetimeRecordDisplay(
                s.LongestDrive,
                $"{Num(FromKm(st.LongestDriveRecord?.Value ?? 0, units), 1)} {distanceUnit}",
                ShortDate(st.LongestDriveRecord?.Date),
                CarGlyph),
            new LifetimeRecordDisplay(
                s.HighestSpeed,
                $"{Num(FromKmh(st.HighestSpeedRecord?.Value ?? 0, units), 0)} {speedUnit}",
                ShortDate(st.HighestSpeedRecord?.Date),
                GaugeGlyph),
            new LifetimeRecordDisplay(
                s.BiggestCharge,
                $"{Num(st.MaxChargeRecord?.Value ?? 0, 1)} kWh",
                ShortDate(st.MaxChargeRecord?.Date),
                ZapGlyph),
        };

        // ── Activity summary (web GlassPanel10) ──────────────────────────────────────────────────────────
        var activity = new[]
        {
            new LifetimeMiniStatDisplay(
                s.MostActiveDay, string.IsNullOrWhiteSpace(st.MostActiveDayOfWeek) ? EmDash : st.MostActiveDayOfWeek),
            new LifetimeMiniStatDisplay(
                s.MostActiveHour,
                st.MostActiveHour is { } hour
                    ? string.Format(CultureInfo.InvariantCulture, "{0}:00", (int)hour)
                    : EmDash),
            new LifetimeMiniStatDisplay(s.DaysOnRoad, Num(st.DaysOnRoad, 1)),
            new LifetimeMiniStatDisplay(
                s.AvgEfficiency, st.AvgEfficiencyWhKm > 0 ? $"{Num(st.AvgEfficiencyWhKm, 0)} Wh/km" : EmDash),
        };

        // ── Achievement gallery (web GlassPanel11) ───────────────────────────────────────────────────────
        var achievements = st.Achievements;
        int unlockedCount = 0;
        foreach (var achievement in achievements)
        {
            if (achievement.Unlocked)
            {
                unlockedCount++;
            }
        }

        string achievementsSummary = string.Format(
            CultureInfo.CurrentCulture, "{0}/{1} {2}", unlockedCount, achievements.Count, s.Unlocked);

        return new LifetimeStatsDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == LifetimeStatsState.Loading,
            ShowError: state == LifetimeStatsState.Error,
            ShowEmpty: state == LifetimeStatsState.Empty,
            ShowContent: state == LifetimeStatsState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyTitle: s.Title,
            EmptyMessage: s.NoData,
            HasStats: hasStats,
            HeroDistanceValue: heroDistance,
            HeroDistanceUnit: distanceUnit,
            HeroSubtitle: heroSubtitle,
            HeroEarthCompare: heroEarth,
            HeroSince: heroSince,
            StatCards: statCards,
            FunFactsTitle: s.FunFacts,
            FunFacts: funFacts,
            FunFactsEmptyMessage: s.NoData,
            SavingsTitle: s.SavingsComparison,
            Savings: savings,
            EnvironmentTitle: s.EnvironmentalImpact,
            Environment: environment,
            EnvironmentEmptyMessage: s.NoData,
            RecordsTitle: s.PersonalRecords,
            Records: records,
            RecordsEmptyMessage: s.NoData,
            ActivityTitle: s.ActivitySummary,
            Activity: activity,
            ActivityEmptyMessage: s.NoData,
            AchievementsTitle: s.Achievements,
            AchievementsSummary: achievementsSummary,
            Achievements: achievements,
            AchievementsEmptyMessage: s.NoAchievements,
            AutomationName: s.Title);
    }

    // Web display conversions (verbatim): total_distance_km and the longest-drive record are SI km; the
    // highest-speed record is SI km/h. The web floors them through the meter/second SI converters, so the
    // native render equals the canonical web output (web is the parity spec, ADR-006).
    private static double FromKm(double km, UnitPref units) =>
        UnitConverters.DistanceFromSi(km * KmToMeters, units.Distance);

    private static double FromKmh(double kmh, UnitPref units) =>
        UnitConverters.SpeedFromSi(kmh * KmToMeters / SecondsPerHour, units.Speed);

    private static string Num(double value, int decimals) => ScalarFormatters.FormatNumber(value, decimals);

    private static string Int(double value) => ScalarFormatters.FormatNumber(value, 0);

    private static string ShortDate(string? isoTs)
    {
        if (!string.IsNullOrWhiteSpace(isoTs) &&
            DateTimeOffset.TryParse(isoTs, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var dto))
        {
            return dto.ToString("MMM d, yyyy", CultureInfo.InvariantCulture);
        }

        return string.Empty;
    }
}

/// <summary>
/// Canonical metadata for the <c>LifetimeStatsPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/analytics/pages/LifetimeStatsPage.tsx</c> (route <c>/lifetime-stats</c>, nav name
/// <c>LifetimeStats</c>). Holds the route name, the generated operation id it binds to, the diagnostics slug, the
/// empty-surface glyph and the localized title.
/// </summary>
public static class LifetimeStatsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LifetimeStatsPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "LifetimeStats";

    /// <summary>The generated operation id for the lifetime read (web <c>useLifetimeStats</c>).</summary>
    public const string LifetimeOperation = Operations.Analytics.Lifetime;

    /// <summary>The Segoe Fluent glyph for the page-level empty surface.</summary>
    public const string EmptyGlyph = LifetimeStatsProjection.EmptyGlyph;

    /// <summary>The localized page title (web <c>t('lifetime.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("lifetime.title", "Lifetime Stats");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>LifetimeStatsPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a distance, savings, achievement or any
/// other lifetime value — so a diagnostics line can never leak a user's driving data. Thread-safe.
/// </summary>
public sealed class LifetimeStatsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LifetimeStatsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LifetimeStatsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LifetimeStatsRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case lifetime JSON wire shape (no camelCaseKeys transform on native):
/// numbers, strings, the nested personal-record objects and the achievement array. Kept internal so the page's
/// parsers stay self-contained and never throw on a partial body.
/// </summary>
internal static class LifetimeJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric.</summary>
    public static double? Double(JsonElement obj, string name)
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

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? value = v.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    /// <summary>Reads a boolean property (or "true"/"false" string), defaulting to false.</summary>
    public static bool Bool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.String => string.Equals(v.GetString(), "true", StringComparison.OrdinalIgnoreCase),
            _ => false,
        };
    }

    /// <summary>Reads a nested personal-record object (<c>{ value, date }</c>), or null when absent / non-object.</summary>
    public static LifetimeRecord? Record(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LifetimeRecord(Double(v, "value") ?? 0, String(v, "date"));
    }

    /// <summary>Reads the <c>achievements</c> array into the reduced achievement rows (tolerant of partial bodies).</summary>
    public static IReadOnlyList<LifetimeAchievementInfo> Achievements(JsonElement obj)
    {
        if (!obj.TryGetProperty("achievements", out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<LifetimeAchievementInfo>();
        }

        var result = new List<LifetimeAchievementInfo>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            result.Add(new LifetimeAchievementInfo(
                Id: String(item, "id") ?? string.Empty,
                Name: String(item, "name") ?? string.Empty,
                Description: String(item, "description") ?? string.Empty,
                Icon: String(item, "icon") ?? string.Empty,
                Unlocked: Bool(item, "unlocked"),
                UnlockedAt: String(item, "unlocked_at"),
                Progress: Double(item, "progress") ?? 0,
                Target: (int)(Double(item, "target") ?? 0),
                Current: (int)(Double(item, "current") ?? 0)));
        }

        return result;
    }
}

/// <summary>
/// The resolved i18n strings for the Lifetime-Stats page — the 41 manifest keys (web key names verbatim) plus the
/// generic retry label. Resolving every key eagerly in <see cref="Resolve"/> means the full key set is exercised
/// in every data state (loading included), matching the web which mounts all translated literals.
/// </summary>
public readonly record struct LifetimeStatsStrings(
    string Achievements,
    string ActivitySummary,
    string AvgEfficiency,
    string Avoided,
    string BiggestCharge,
    string Co2Offset,
    string CoffeesEquiv,
    string Days,
    string DaysOnRoad,
    string EarthCompare,
    string EarthProgress,
    string ElectricCost,
    string EnvironmentalImpact,
    string FunFacts,
    string GasCost,
    string HeroSubtitle,
    string HighestSpeed,
    string HomesPowered,
    string Hours,
    string LongestDrive,
    string MoonProgress,
    string MostActiveDay,
    string MostActiveHour,
    string NoAchievements,
    string NoData,
    string NoSavingsData,
    string PersonalRecords,
    string SavingsComparison,
    string Sessions,
    string Since,
    string Subtitle,
    string Title,
    string TotalDistance,
    string TotalDrives,
    string TotalEnergy,
    string TotalSavings,
    string TreesEquiv,
    string TreesPlanted,
    string Unlocked,
    string VsGas,
    string YouSaved,
    string Retry)
{
    /// <summary>Resolve every Lifetime-Stats label through the localizer (web key names + English defaults).</summary>
    public static LifetimeStatsStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new LifetimeStatsStrings(
            Achievements: localizer.GetString("lifetime.achievements", "Achievements"),
            ActivitySummary: localizer.GetString("lifetime.activitySummary", "Activity Summary"),
            AvgEfficiency: localizer.GetString("lifetime.avgEfficiency", "Avg Efficiency"),
            Avoided: localizer.GetString("lifetime.avoided", "avoided"),
            BiggestCharge: localizer.GetString("lifetime.biggestCharge", "Biggest Charge"),
            Co2Offset: localizer.GetString("lifetime.co2Offset", "CO\u2082 offset"),
            CoffeesEquiv: localizer.GetString("lifetime.coffeesEquiv", "cups of coffee saved"),
            Days: localizer.GetString("lifetime.days", "days"),
            DaysOnRoad: localizer.GetString("lifetime.daysOnRoad", "Days on Road"),
            EarthCompare: localizer.GetString("lifetime.earthCompare", "That's {0}x around the Earth!"),
            EarthProgress: localizer.GetString("lifetime.earthProgress", "around the Earth"),
            ElectricCost: localizer.GetString("lifetime.electricCost", "Electric Cost"),
            EnvironmentalImpact: localizer.GetString("lifetime.environmentalImpact", "Environmental Impact"),
            FunFacts: localizer.GetString("lifetime.funFacts", "Fun Facts"),
            GasCost: localizer.GetString("lifetime.gasCost", "Gasoline Equivalent"),
            HeroSubtitle: localizer.GetString("lifetime.heroSubtitle", "driven across {0} drives"),
            HighestSpeed: localizer.GetString("lifetime.highestSpeed", "Highest Speed"),
            HomesPowered: localizer.GetString("lifetime.homesPowered", "of home energy used"),
            Hours: localizer.GetString("lifetime.hours", "hrs"),
            LongestDrive: localizer.GetString("lifetime.longestDrive", "Longest Drive"),
            MoonProgress: localizer.GetString("lifetime.moonProgress", "to the Moon"),
            MostActiveDay: localizer.GetString("lifetime.mostActiveDay", "Most Active Day"),
            MostActiveHour: localizer.GetString("lifetime.mostActiveHour", "Peak Hour"),
            NoAchievements: localizer.GetString("lifetime.noAchievements", "Start driving to unlock achievements"),
            NoData: localizer.GetString("lifetime.noData", "No driving data yet"),
            NoSavingsData: localizer.GetString("lifetime.noSavingsData", "Complete some drives to see savings"),
            PersonalRecords: localizer.GetString("lifetime.personalRecords", "Personal Records"),
            SavingsComparison: localizer.GetString("lifetime.savingsComparison", "Savings vs Gasoline"),
            Sessions: localizer.GetString("lifetime.sessions", "sessions"),
            Since: localizer.GetString("lifetime.since", "Tracking since {0} ({1} days)"),
            Subtitle: localizer.GetString("lifetime.subtitle", "Your all-time driving achievements and milestones"),
            Title: localizer.GetString("lifetime.title", "Lifetime Stats"),
            TotalDistance: localizer.GetString("lifetime.totalDistance", "Total Distance"),
            TotalDrives: localizer.GetString("lifetime.totalDrives", "Total Drives"),
            TotalEnergy: localizer.GetString("lifetime.totalEnergy", "Total Energy"),
            TotalSavings: localizer.GetString("lifetime.totalSavings", "Total Savings"),
            TreesEquiv: localizer.GetString("lifetime.treesEquiv", "trees equivalent"),
            TreesPlanted: localizer.GetString("lifetime.treesPlanted", "trees equivalent planted"),
            Unlocked: localizer.GetString("lifetime.unlocked", "\u2713 Unlocked"),
            VsGas: localizer.GetString("lifetime.vsGas", "vs gasoline"),
            YouSaved: localizer.GetString("lifetime.youSaved", "You saved"),
            Retry: localizer.GetString("common.retry", "Retry"));
    }
}
