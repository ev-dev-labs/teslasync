using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;
using TeslaSync.App.FeatureViews.WeeklyDigest;

namespace TeslaSync.App.FeatureViews.Analytics;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>WeeklyDigestPage</c> surface — the native mirror of the
/// branches the web page renders (web/src/features/analytics/pages/WeeklyDigestPage.tsx). The web page runs the
/// <c>useWeeklyDigest</c> read (vehicles + drives + charging + alerts) and renders, in precedence order, the
/// <c>DigestSkeleton</c> (web <c>isLoading</c>), a page-level error surface (web <c>PageContainer error</c>), the
/// "No Data" empty state (web <c>!hasData</c>) and otherwise the populated digest (the week selector, the summary
/// hero cards and the driving / charging / battery / alerts / week-over-week sections). This enum is the top-level
/// summary the ledger keys off; per-region visibility is still driven by the projected flags.
/// </summary>
public enum WeeklyDigestState
{
    /// <summary>One of the digest queries is in flight with no data yet (web <c>isLoading</c>) — the skeleton shows.</summary>
    Loading,

    /// <summary>A query failed (web <c>error</c>) — a retriable error surface shows.</summary>
    Error,

    /// <summary>The week resolved with no drives and no charging (web <c>!hasData</c>) — the empty state shows.</summary>
    Empty,

    /// <summary>The week resolved with driving or charging activity (web fall-through) — the digest renders.</summary>
    Ready,
}

/// <summary>
/// One selectable vehicle in the header drop-down — the native mirror of a web <c>vehicleOptions</c> entry
/// (<c>{ value: String(v.id), label: v.display_name || v.vin }</c> in
/// web/src/features/analytics/components/weekly-digest/useWeeklyDigest.ts). Pure data — no WinUI types.
/// </summary>
/// <param name="Id">The vehicle id as a string (the web option <c>value</c>).</param>
/// <param name="Label">The display label (web <c>display_name || vin</c>).</param>
public sealed record WeeklyDigestVehicleOption(string Id, string Label);

/// <summary>
/// One drive row read from <c>GET /drives?vehicle_id=</c> — the SI-canonical native analogue of the web
/// <c>Drive</c> (web/src/features/analytics/components/weekly-digest/types.ts). The Phase-42/48 API serves SI on
/// the wire (<c>distance_m</c> metres, <c>duration_s</c> seconds, <c>energy_used_wh</c> watt-hours,
/// <c>start_ts</c>), so the values are stored SI here and converted to the digest's display units (kilometres,
/// minutes, kilowatt-hours, Wh/km) only in <see cref="WeeklyDigestProjection"/>, never on disk. Parsing is
/// null-tolerant so a partial row never throws. Pure data — no WinUI types.
/// </summary>
/// <param name="StartTs">The drive's start instant (web <c>start_date</c>; SI <c>start_ts</c>).</param>
/// <param name="DistanceM">Distance travelled in metres (SI <c>distance_m</c>; web <c>distance</c> km).</param>
/// <param name="DurationS">Drive duration in seconds (SI <c>duration_s</c>; web <c>duration_min</c>).</param>
/// <param name="EnergyUsedWh">Energy consumed in watt-hours (SI <c>energy_used_wh</c>; web <c>energy_used</c> kWh).</param>
public sealed record DigestDriveRow(DateTimeOffset StartTs, double DistanceM, double DurationS, double EnergyUsedWh)
{
    /// <summary>Distance in kilometres (the web digest's display unit).</summary>
    public double DistanceKm => DistanceM / 1000.0;

    /// <summary>Duration in minutes (the web digest's display unit).</summary>
    public double DurationMinutes => DurationS / 60.0;

    /// <summary>Energy used in kilowatt-hours (the web digest's display unit).</summary>
    public double EnergyUsedKwh => EnergyUsedWh / 1000.0;

    /// <summary>Energy intensity in watt-hours per kilometre (web <c>efficiency_wh_km</c>), zero when the drive logged no distance.</summary>
    public double EfficiencyWhKm => DistanceKm > 0 ? EnergyUsedWh / DistanceKm : 0;

    /// <summary>Parse one drive object tolerantly; missing / non-numeric fields coalesce to zero / epoch.</summary>
    public static DigestDriveRow FromJson(JsonElement o) => new(
        DigestJson.Date(o, "start_ts") ?? DigestJson.Date(o, "start_date") ?? default,
        DigestJson.Number(o, "distance_m") ?? 0,
        DigestJson.Number(o, "duration_s") ?? 0,
        DigestJson.Number(o, "energy_used_wh") ?? 0);
}

/// <summary>
/// One charging session read from <c>GET /charging-sessions?vehicle_id=</c> — the SI-canonical native analogue of
/// the web <c>ChargingSession</c> (web/src/features/analytics/components/weekly-digest/types.ts). The API serves
/// SI (<c>total_energy_added_wh</c> watt-hours, <c>started_at</c> / <c>ended_at</c>, <c>start_soc_pct</c> /
/// <c>end_soc_pct</c>, <c>cost_decimal</c>); the projection converts to the digest's display units (kilowatt-hours,
/// minutes, kilowatts) at the boundary. Parsing is null-tolerant. Pure data — no WinUI types.
/// </summary>
/// <param name="StartedAt">The session start instant (web <c>start_ts</c>; SI <c>started_at</c>).</param>
/// <param name="EndedAt">The session end instant, or null while charging (SI <c>ended_at</c>).</param>
/// <param name="TotalEnergyAddedWh">Energy added in watt-hours (SI <c>total_energy_added_wh</c>).</param>
/// <param name="CostDecimal">Session cost in the account currency (SI <c>cost_decimal</c>; web <c>cost</c>).</param>
/// <param name="StartSocPct">Battery state of charge at start, 0..100 (SI <c>start_soc_pct</c>; web <c>start_battery_pct</c>).</param>
/// <param name="EndSocPct">Battery state of charge at end, 0..100 (SI <c>end_soc_pct</c>; web <c>end_battery_pct</c>).</param>
public sealed record DigestChargeRow(
    DateTimeOffset StartedAt,
    DateTimeOffset? EndedAt,
    double TotalEnergyAddedWh,
    double CostDecimal,
    double StartSocPct,
    double EndSocPct)
{
    /// <summary>Energy added in kilowatt-hours (the web digest's display unit).</summary>
    public double EnergyAddedKwh => TotalEnergyAddedWh / 1000.0;

    /// <summary>Session duration in minutes derived from start/end (web <c>duration_min</c>), zero when still charging.</summary>
    public double DurationMinutes => EndedAt is { } end && end > StartedAt ? (end - StartedAt).TotalMinutes : 0;

    /// <summary>Parse one charging-session object tolerantly; missing / non-numeric fields coalesce to zero / epoch.</summary>
    public static DigestChargeRow FromJson(JsonElement o) => new(
        DigestJson.Date(o, "started_at") ?? DigestJson.Date(o, "start_ts") ?? default,
        DigestJson.Date(o, "ended_at"),
        DigestJson.Number(o, "total_energy_added_wh") ?? 0,
        DigestJson.Number(o, "cost_decimal") ?? DigestJson.Number(o, "cost") ?? 0,
        DigestJson.Number(o, "start_soc_pct") ?? DigestJson.Number(o, "start_battery_pct") ?? 0,
        DigestJson.Number(o, "end_soc_pct") ?? DigestJson.Number(o, "end_battery_pct") ?? 0);
}

/// <summary>
/// One alert row read from <c>GET /alerts</c> — the native analogue of the web <c>Alert</c>
/// (web/src/features/analytics/components/weekly-digest/types.ts), narrowed to the two fields the digest reads
/// (<c>severity</c> and <c>created_at</c>). Parsing is null-tolerant. Pure data — no WinUI types.
/// </summary>
/// <param name="Severity">The raw severity key (e.g. <c>"warning"</c>).</param>
/// <param name="CreatedAt">When the alert was raised (web <c>created_at</c>).</param>
public sealed record DigestAlertRow(string Severity, DateTimeOffset CreatedAt)
{
    /// <summary>Parse one alert object tolerantly; a missing severity becomes the empty string.</summary>
    public static DigestAlertRow FromJson(JsonElement o) => new(
        DigestJson.Str(o, "severity") ?? string.Empty,
        DigestJson.Date(o, "created_at") ?? default);
}

/// <summary>
/// The resolved cache of one weekly-digest read — the vehicle option list, the resolved selected vehicle id (web
/// <c>vehicleId || String(vehicles?.[0]?.id)</c>), and the selected vehicle's drives / charging / alerts. Week
/// filtering and aggregation happen later in the projection, so a single fetch backs every week the user pages
/// through (the web hook refetches per vehicle and bins client-side). Pure data — no WinUI types.
/// </summary>
public sealed record WeeklyDigestSnapshot(
    IReadOnlyList<WeeklyDigestVehicleOption> Vehicles,
    string SelectedVehicleId,
    IReadOnlyList<DigestDriveRow> Drives,
    IReadOnlyList<DigestChargeRow> Charging,
    IReadOnlyList<DigestAlertRow> Alerts)
{
    /// <summary>The empty snapshot — no vehicles, no data (the default local-state feed result).</summary>
    public static WeeklyDigestSnapshot Empty { get; } = new(
        Array.Empty<WeeklyDigestVehicleOption>(),
        string.Empty,
        Array.Empty<DigestDriveRow>(),
        Array.Empty<DigestChargeRow>(),
        Array.Empty<DigestAlertRow>());
}

/// <summary>
/// The data port the <see cref="WeeklyDigestPageViewModel"/> reads the digest through — the native parity of the
/// web <c>useWeeklyDigest</c> hook (<c>useVehicles</c> + the per-vehicle <c>/drives</c>, <c>/charging</c> and
/// <c>/alerts</c> queries). The view never performs HTTP; the default <see cref="EmptyWeeklyDigestFeed"/> resolves
/// to the empty state, and the generated-client-backed <see cref="WeeklyDigestClientFeed"/> binds to the generated
/// OpenAPI contract client (ADR-004). A failing fetch throws so the view-model can surface the retriable error
/// branch, exactly as the web query's <c>error</c> drives <c>PageContainer</c>.
/// </summary>
public interface IWeeklyDigestFeed
{
    /// <summary>
    /// Resolve the digest snapshot. <paramref name="requestedVehicleId"/> is the user's selection (empty on the
    /// first load, when the feed defaults to the first vehicle — the web <c>vehicles?.[0]?.id</c> fallback).
    /// </summary>
    Task<WeeklyDigestSnapshot> FetchAsync(string? requestedVehicleId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot (the empty data state).</summary>
public sealed class EmptyWeeklyDigestFeed : IWeeklyDigestFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyWeeklyDigestFeed Instance { get; } = new();

    private EmptyWeeklyDigestFeed()
    {
    }

    /// <inheritdoc />
    public Task<WeeklyDigestSnapshot> FetchAsync(string? requestedVehicleId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(WeeklyDigestSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>WeeklyDigestPage</c> projects from — the native analogue of the resolved web
/// hook state (web/src/features/analytics/components/weekly-digest/useWeeklyDigest.ts): the vehicle options + the
/// resolved selection, the active <see cref="WeekOffset"/> (0 = current week), the in-flight / error flags, and
/// the selected vehicle's drives / charging / alerts (filtered to the active week inside the projection). Pure
/// data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">Whether a query is in flight with no data yet (web <c>isLoading</c>).</param>
/// <param name="HasError">Whether a query failed (web <c>error</c>).</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="Vehicles">The vehicle drop-down options (web <c>vehicleOptions</c>).</param>
/// <param name="SelectedVehicleId">The resolved selected vehicle id (web <c>selectedVehicleId</c>).</param>
/// <param name="WeekOffset">The week being viewed relative to the current week (0 = current; web <c>weekOffset</c>).</param>
/// <param name="Drives">The selected vehicle's drives (web <c>drives</c>).</param>
/// <param name="Charging">The selected vehicle's charging sessions (web <c>chargingSessions</c>).</param>
/// <param name="Alerts">The alerts (web <c>alerts</c>).</param>
public sealed record WeeklyDigestModel(
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    IReadOnlyList<WeeklyDigestVehicleOption> Vehicles,
    string SelectedVehicleId,
    int WeekOffset,
    IReadOnlyList<DigestDriveRow> Drives,
    IReadOnlyList<DigestChargeRow> Charging,
    IReadOnlyList<DigestAlertRow> Alerts)
{
    /// <summary>The initial model — the first load, no data yet.</summary>
    public static WeeklyDigestModel Initial { get; } = new(
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        Vehicles: Array.Empty<WeeklyDigestVehicleOption>(),
        SelectedVehicleId: string.Empty,
        WeekOffset: 0,
        Drives: Array.Empty<DigestDriveRow>(),
        Charging: Array.Empty<DigestChargeRow>(),
        Alerts: Array.Empty<DigestAlertRow>());
}

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every metric converted to its display
/// unit at this boundary. Holds the always-visible page header (title + subtitle) and vehicle picker, the four
/// data-state flags, the week selector, the summary hero cards, and the render-ready models for the embedded
/// driving / charging / battery / alerts sections plus the week-over-week comparison. Pure data so every branch is
/// asserted headlessly.
/// </summary>
public sealed record WeeklyDigestDisplay(
    WeeklyDigestState State,
    string Title,
    string Subtitle,
    string SelectVehicleHint,
    IReadOnlyList<WeeklyDigestVehicleOption> VehicleOptions,
    string SelectedVehicleId,
    bool HasVehicles,
    bool ShowLoading,
    bool ShowError,
    bool ShowEmpty,
    bool ShowContent,
    string LoadingText,
    string EmptyTitle,
    string EmptyMessage,
    string EmptyGlyph,
    string ErrorText,
    string RetryLabel,
    string WeekLabel,
    bool IsCurrentWeek,
    string PrevWeekLabel,
    string NextWeekLabel,
    string CurrentBadgeLabel,
    string WeekSummaryTitle,
    IReadOnlyList<HighlightCardModel> HeroCards,
    DrivingSectionModel DrivingModel,
    ChargingSectionModel ChargingModel,
    BatteryHealthSectionModel BatteryModel,
    AlertsSectionModel AlertsModel,
    WeekOverWeekMetrics WeekOverWeek,
    string AutomationName);

/// <summary>
/// A fixed <see cref="IWeekOverWeekSummarySource"/> over a single, already-computed
/// <see cref="WeekOverWeekMetrics"/> snapshot — lets the page feed the self-driving <c>WeekOverWeekSummary</c>
/// component the same week's rollup the rest of the page already aggregated, instead of issuing a second network
/// read. Each <see cref="StreamAsync"/> yields one <see cref="LoadStatus.Loaded"/> result (or
/// <see cref="RepositoryResult{T}.Empty"/> when there is nothing to compare), so reassigning
/// <see cref="Metrics"/> and re-running the component's load re-projects the cards. Pure — no WinUI types.
/// </summary>
public sealed class StaticWeekOverWeekSource : IWeekOverWeekSummarySource
{
    private readonly Func<DateTimeOffset> _clock;

    /// <summary>Creates the source over an optional injectable clock (for deterministic fetch stamps in tests).</summary>
    public StaticWeekOverWeekSource(Func<DateTimeOffset>? clock = null) => _clock = clock ?? (() => DateTimeOffset.Now);

    /// <summary>The metrics streamed on the next read; null streams the empty surface.</summary>
    public WeekOverWeekMetrics? Metrics { get; set; }

    /// <inheritdoc />
    public async IAsyncEnumerable<RepositoryResult<WeekOverWeekMetrics>> StreamAsync(
        [System.Runtime.CompilerServices.EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        cancellationToken.ThrowIfCancellationRequested();
        await Task.CompletedTask.ConfigureAwait(false);
        yield return Metrics is { } metrics
            ? RepositoryResult<WeekOverWeekMetrics>.Loaded(metrics, _clock())
            : RepositoryResult<WeekOverWeekMetrics>.Empty(_clock());
    }
}

/// <summary>
/// Pure projection from a <see cref="WeeklyDigestModel"/> to its <see cref="WeeklyDigestDisplay"/> — the native
/// port of the render + aggregation logic in web/src/features/analytics/components/weekly-digest/useWeeklyDigest.ts
/// and WeeklyDigestPage.tsx. It resolves the active week (Monday–Sunday, like the web <c>getWeekRange</c>), filters
/// the drives / charging / alerts to it, aggregates the digest metrics (converting SI inputs to the display units
/// the presentational sections render verbatim), and builds the render-ready hero cards plus the driving / charging
/// / battery / alerts / week-over-week models. Every chrome string resolves through the i18n facade using the exact
/// web key names, on every projection (visibility is gated by the returned flags) so the i18n contract holds in
/// every data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class WeeklyDigestProjection
{
    /// <summary>The Monday-first weekday tick labels (web <c>DAY_LABELS</c>).</summary>
    public static readonly IReadOnlyList<string> DayLabels = new[] { "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun" };

    /// <summary>Kilograms of CO₂ saved per kilowatt-hour versus gasoline (web <c>CO2_PER_KWH_GASOLINE_KG</c>).</summary>
    public const double Co2PerKwhKg = 0.21;

    /// <summary>Estimated kilometres of range per kilowatt-hour added (web BatteryHealthSection heuristic).</summary>
    private const double FunFactMinimumKm = 10;

    private const string CarGlyph = "\uE804";       // web Car
    private const string ActivityGlyph = "\uE9D2";  // web Activity
    private const string ZapGlyph = "\uE945";       // web Zap
    private const string FuelGlyph = "\uE1D3";      // web Fuel (cost)
    private const string LeafGlyph = "\uE8B7";      // web Leaf (CO₂)
    private const string MapPinGlyph = "\uE707";    // web MapPin (fun fact)
    private const string CalendarGlyph = "\uE787";  // web Calendar (empty state)

    private static readonly (string From, string To, double Km)[] CityPairs =
    {
        ("New York", "Boston", 350),
        ("LA", "San Francisco", 615),
        ("London", "Paris", 460),
        ("Berlin", "Munich", 585),
        ("Sydney", "Melbourne", 880),
        ("Tokyo", "Osaka", 515),
    };

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web hook state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant the active week is computed against (injectable for tests).</param>
    /// <param name="currencySymbol">The active currency symbol for the cost card (defaults to <c>$</c>).</param>
    public static WeeklyDigestDisplay Project(
        WeeklyDigestModel model,
        ILocalizer localizer,
        DateTimeOffset now,
        string? currencySymbol = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string currency = string.IsNullOrWhiteSpace(currencySymbol) ? "$" : currencySymbol;

        // ── Page header (web PageContainer title + subtitle) + vehicle picker ───────────────────────────────
        string title = localizer.GetString("analytics.weeklyDigest.title", "Weekly Digest");
        string subtitle = localizer.GetString(
            "analytics.weeklyDigest.subtitle", "Your driving and charging summary for the week");
        string selectVehicle = localizer.GetString("analytics.weeklyDigest.selectVehicle", "Select vehicle");

        // ── Data-state copy (loading / empty / error) ───────────────────────────────────────────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string emptyTitle = localizer.GetString("analytics.weeklyDigest.noData", "No Data");
        string emptyMessage = localizer.GetString(
            "analytics.weeklyDigest.noDataMessage", "No driving or charging data found for this week.");
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;
        string retryLabel = localizer.GetString("common.retry", "Retry");

        // ── Week selector copy ──────────────────────────────────────────────────────────────────────────────
        string prevWeek = localizer.GetString("analytics.weeklyDigest.prevWeek", "Previous");
        string nextWeek = localizer.GetString("analytics.weeklyDigest.nextWeek", "Next");
        string currentBadge = localizer.GetString("analytics.weeklyDigest.current", "Current");
        string weekSummaryTitle = localizer.GetString("analytics.weeklyDigest.weekSummary", "Week Summary");

        var (weekStart, weekEnd) = WeekRange(now, model.WeekOffset);
        var (prevStart, prevEnd) = WeekRange(now, model.WeekOffset - 1);
        bool isCurrentWeek = model.WeekOffset == 0;
        string weekLabel = $"{FormatDay(weekStart)} \u2013 {FormatDay(weekEnd)}";

        // ── Week filtering (web isInRange) ──────────────────────────────────────────────────────────────────
        var weekDrives = model.Drives.Where(d => InRange(d.StartTs, weekStart, weekEnd)).ToList();
        var prevDrives = model.Drives.Where(d => InRange(d.StartTs, prevStart, prevEnd)).ToList();
        var weekCharging = model.Charging.Where(c => InRange(c.StartedAt, weekStart, weekEnd)).ToList();
        var prevCharging = model.Charging.Where(c => InRange(c.StartedAt, prevStart, prevEnd)).ToList();
        var weekAlerts = model.Alerts.Where(a => InRange(a.CreatedAt, weekStart, weekEnd)).ToList();

        var metrics = Aggregate(weekDrives, prevDrives, weekCharging, prevCharging, weekAlerts);

        bool hasData = weekDrives.Count > 0 || weekCharging.Count > 0;
        bool hasVehicles = model.Vehicles.Count > 0;

        WeeklyDigestState state = model.Loading
            ? WeeklyDigestState.Loading
            : model.HasError
                ? WeeklyDigestState.Error
                : hasData
                    ? WeeklyDigestState.Ready
                    : WeeklyDigestState.Empty;

        bool loading = state == WeeklyDigestState.Loading;

        IReadOnlyList<HighlightCardModel> heroCards = Array.Empty<HighlightCardModel>();
        if (state == WeeklyDigestState.Ready)
        {
            heroCards = BuildHeroCards(metrics, localizer, currency);
        }

        var drivingModel = BuildDrivingModel(metrics, loading);
        var chargingModel = BuildChargingModel(metrics, loading);
        var batteryModel = BuildBatteryModel(metrics, loading);
        var alertsModel = BuildAlertsModel(metrics, loading);
        var weekOverWeek = BuildWeekOverWeek(metrics);

        string automationName = state switch
        {
            WeeklyDigestState.Loading => $"{title}. {loadingText}",
            WeeklyDigestState.Error => $"{title}. {errorText}",
            WeeklyDigestState.Empty => $"{title}. {emptyTitle}. {emptyMessage}",
            _ => $"{title}. {weekLabel}",
        };

        return new WeeklyDigestDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            SelectVehicleHint: selectVehicle,
            VehicleOptions: model.Vehicles,
            SelectedVehicleId: model.SelectedVehicleId,
            HasVehicles: hasVehicles,
            ShowLoading: state == WeeklyDigestState.Loading,
            ShowError: state == WeeklyDigestState.Error,
            ShowEmpty: state == WeeklyDigestState.Empty,
            ShowContent: state == WeeklyDigestState.Ready,
            LoadingText: loadingText,
            EmptyTitle: emptyTitle,
            EmptyMessage: emptyMessage,
            EmptyGlyph: CalendarGlyph,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            WeekLabel: weekLabel,
            IsCurrentWeek: isCurrentWeek,
            PrevWeekLabel: prevWeek,
            NextWeekLabel: nextWeek,
            CurrentBadgeLabel: currentBadge,
            WeekSummaryTitle: weekSummaryTitle,
            HeroCards: heroCards,
            DrivingModel: drivingModel,
            ChargingModel: chargingModel,
            BatteryModel: batteryModel,
            AlertsModel: alertsModel,
            WeekOverWeek: weekOverWeek,
            AutomationName: automationName);
    }

    /// <summary>Compute the Monday–Sunday range for <paramref name="offset"/> weeks from <paramref name="now"/> (web <c>getWeekRange</c>).</summary>
    public static (DateTimeOffset Start, DateTimeOffset End) WeekRange(DateTimeOffset now, int offset)
    {
        int dow = (int)now.DayOfWeek; // Sunday = 0 … Saturday = 6 (matches JS getDay()).
        DateTimeOffset startOfDay = new(now.Date, now.Offset);
        DateTimeOffset start = startOfDay.AddDays(-dow + 1 + (offset * 7));
        DateTimeOffset end = start.AddDays(6).AddHours(23).AddMinutes(59).AddSeconds(59).AddMilliseconds(999);
        return (start, end);
    }

    /// <summary>True when <paramref name="instant"/> falls within the inclusive range (web <c>isInRange</c>).</summary>
    public static bool InRange(DateTimeOffset instant, DateTimeOffset start, DateTimeOffset end) =>
        instant >= start && instant <= end;

    /// <summary>The Monday-first weekday index 0..6 (web <c>dayOfWeekIndex</c>: <c>day === 0 ? 6 : day - 1</c>).</summary>
    public static int DayOfWeekIndex(DateTimeOffset instant)
    {
        int dow = (int)instant.DayOfWeek;
        return dow == 0 ? 6 : dow - 1;
    }

    /// <summary>The signed percentage change (web <c>pctChange</c>): a zero baseline yields 100 when current is positive, else 0.</summary>
    public static double PctChange(double current, double previous)
    {
        if (previous == 0)
        {
            return current > 0 ? 100 : 0;
        }

        return (current - previous) / Math.Abs(previous) * 100;
    }

    private static DigestMetrics Aggregate(
        List<DigestDriveRow> weekDrives,
        List<DigestDriveRow> prevDrives,
        List<DigestChargeRow> weekCharging,
        List<DigestChargeRow> prevCharging,
        List<DigestAlertRow> weekAlerts)
    {
        double totalDistance = weekDrives.Sum(d => d.DistanceKm);
        double prevDistance = prevDrives.Sum(d => d.DistanceKm);
        double energyUsed = weekDrives.Sum(d => d.EnergyUsedKwh);
        double prevEnergy = prevDrives.Sum(d => d.EnergyUsedKwh);
        double chargingCost = weekCharging.Sum(c => c.CostDecimal);
        double prevChargingCost = prevCharging.Sum(c => c.CostDecimal);
        double avgEfficiency = weekDrives.Count > 0 ? weekDrives.Average(d => d.EfficiencyWhKm) : 0;
        double prevAvgEfficiency = prevDrives.Count > 0 ? prevDrives.Average(d => d.EfficiencyWhKm) : 0;
        double totalDuration = weekDrives.Sum(d => d.DurationMinutes);

        DigestDriveRow? topDrive = null;
        foreach (var drive in weekDrives)
        {
            if (topDrive is null || drive.DistanceM > topDrive.DistanceM)
            {
                topDrive = drive;
            }
        }

        double chargeEnergyAdded = weekCharging.Sum(c => c.EnergyAddedKwh);
        double prevChargeEnergy = prevCharging.Sum(c => c.EnergyAddedKwh);
        double avgChargeRate = weekCharging.Count > 0
            ? weekCharging.Sum(c => c.DurationMinutes > 0 ? c.EnergyAddedKwh / (c.DurationMinutes / 60.0) : 0) / weekCharging.Count
            : 0;
        double batteryStart = weekCharging.Count > 0 ? weekCharging.Average(c => c.StartSocPct) : 0;
        double batteryEnd = weekCharging.Count > 0 ? weekCharging.Average(c => c.EndSocPct) : 0;

        var alertsByType = new List<(string Severity, long Count)>();
        foreach (var alert in weekAlerts)
        {
            int index = alertsByType.FindIndex(e => string.Equals(e.Severity, alert.Severity, StringComparison.Ordinal));
            if (index >= 0)
            {
                alertsByType[index] = (alert.Severity, alertsByType[index].Count + 1);
            }
            else
            {
                alertsByType.Add((alert.Severity, 1));
            }
        }

        var dailyDistance = new double[7];
        foreach (var drive in weekDrives)
        {
            dailyDistance[DayOfWeekIndex(drive.StartTs)] += drive.DistanceKm;
        }

        var dailyEnergy = new double[7];
        foreach (var charge in weekCharging)
        {
            dailyEnergy[DayOfWeekIndex(charge.StartedAt)] += charge.EnergyAddedKwh;
        }

        return new DigestMetrics(
            totalDistance, prevDistance, weekDrives.Count, prevDrives.Count,
            energyUsed, prevEnergy, chargingCost, prevChargingCost,
            energyUsed * Co2PerKwhKg, prevEnergy * Co2PerKwhKg,
            avgEfficiency, prevAvgEfficiency, totalDuration, topDrive,
            chargeEnergyAdded, prevChargeEnergy, avgChargeRate, weekCharging.Count,
            batteryStart, batteryEnd, alertsByType, weekAlerts.Count,
            dailyDistance, dailyEnergy);
    }

    private static List<HighlightCardModel> BuildHeroCards(
        DigestMetrics m, ILocalizer localizer, string currency)
    {
        var cards = new List<HighlightCardModel>
        {
            Hero(CarGlyph, localizer.GetString("analytics.weeklyDigest.totalDistance", "Total Distance"),
                Num(m.TotalDistance, 1) + " km", Trend(m.TotalDistance, m.PrevDistance, false), HighlightColor.Cyan),
            Hero(ActivityGlyph, localizer.GetString("analytics.weeklyDigest.totalDrives", "Total Drives"),
                Num(m.TotalDrives, 0), Trend(m.TotalDrives, m.PrevDriveCount, false), HighlightColor.Green),
            Hero(ZapGlyph, localizer.GetString("analytics.weeklyDigest.energyUsed", "Energy Used"),
                Num(m.EnergyUsed, 1) + " kWh", Trend(m.EnergyUsed, m.PrevEnergy, true), HighlightColor.Purple),
            Hero(FuelGlyph, localizer.GetString("analytics.weeklyDigest.chargingCost", "Charging Cost"),
                currency + Num(m.ChargingCost, 2), Trend(m.ChargingCost, m.PrevChargingCost, true), HighlightColor.Amber),
            Hero(LeafGlyph, localizer.GetString("analytics.weeklyDigest.co2Saved", "CO\u2082 Saved"),
                Num(m.Co2Saved, 1) + " kg", Trend(m.Co2Saved, m.PrevCo2, false), HighlightColor.Green),
        };

        if (m.TotalDistance >= FunFactMinimumKm)
        {
            var pair = NearestCityPair(m.TotalDistance);
            string times = Num(m.TotalDistance / pair.Km, 1);
            string descTemplate = localizer.GetString("analytics.weeklyDigest.funFactDesc", "\u2248 {0}\u00d7 {1} \u2192 {2}");
            cards.Add(new HighlightCardModel(
                Loading: false,
                IconGlyph: MapPinGlyph,
                Label: localizer.GetString("analytics.weeklyDigest.funFact", "Fun Fact"),
                Value: times + "\u00d7",
                ChangeValue: null,
                ChangePositive: true,
                Subtitle: string.Format(CultureInfo.CurrentCulture, descTemplate, times, pair.From, pair.To),
                Color: HighlightColor.Cyan));
        }

        return cards;
    }

    private static HighlightCardModel Hero(
        string glyph, string label, string value, (string Value, bool Positive) trend, HighlightColor color) =>
        new(false, glyph, label, value, trend.Value, trend.Positive, null, color);

    private static DrivingSectionModel BuildDrivingModel(DigestMetrics m, bool loading)
    {
        DigestTopDrive? topDrive = m.TopDrive is { } top
            ? new DigestTopDrive(
                top.StartTs.ToString("o", CultureInfo.InvariantCulture),
                top.DistanceKm,
                top.DurationMinutes,
                top.EfficiencyWhKm)
            : null;

        var daily = new List<DailyDistanceEntry>(7);
        for (int i = 0; i < 7; i++)
        {
            daily.Add(new DailyDistanceEntry(DayLabels[i], m.DailyDistance[i]));
        }

        return new DrivingSectionModel(
            loading, m.AvgEfficiency, m.PrevAvgEfficiency, m.TotalDuration, m.TotalDrives, topDrive, daily);
    }

    private static ChargingSectionModel BuildChargingModel(DigestMetrics m, bool loading)
    {
        var daily = new List<ChargingSectionDailyEnergy>(7);
        for (int i = 0; i < 7; i++)
        {
            daily.Add(new ChargingSectionDailyEnergy(DayLabels[i], m.DailyEnergy[i]));
        }

        return new ChargingSectionModel(
            loading, m.ChargingSessionCount, m.ChargeEnergyAdded, m.AvgChargeRate, m.ChargingCost, m.PrevChargeEnergy, daily);
    }

    private static BatteryHealthSectionModel BuildBatteryModel(DigestMetrics m, bool loading)
    {
        if (loading)
        {
            return BatteryHealthSectionModel.Loading;
        }

        return m.ChargingSessionCount > 0
            ? BatteryHealthSectionModel.Ready(m.BatteryStart, m.BatteryEnd, m.ChargeEnergyAdded, m.ChargingSessionCount)
            : BatteryHealthSectionModel.Empty;
    }

    private static AlertsSectionModel BuildAlertsModel(DigestMetrics m, bool loading)
    {
        var counts = new List<AlertSeverityCount>(m.AlertsByType.Count);
        foreach (var (severity, count) in m.AlertsByType)
        {
            counts.Add(new AlertSeverityCount(severity, count));
        }

        return new AlertsSectionModel(loading, m.AlertTotal, counts);
    }

    private static WeekOverWeekMetrics BuildWeekOverWeek(DigestMetrics m) => new(
        Drives: m.TotalDrives,
        DistanceKm: m.TotalDistance,
        EnergyKwh: m.EnergyUsed,
        Cost: m.ChargingCost,
        EfficiencyWhKm: m.AvgEfficiency,
        PrevDrives: m.PrevDriveCount,
        PrevDistanceKm: m.PrevDistance,
        PrevEnergyKwh: m.PrevEnergy,
        PrevCost: m.PrevChargingCost,
        PrevEfficiencyWhKm: m.PrevAvgEfficiency);

    // Web trendFor(): a near-zero change is "0%"/positive; otherwise a signed percentage whose desirability flips
    // for "lower is better" metrics (energy, cost) via invertPositive. HighlightCard reads only value + positive.
    private static (string Value, bool Positive) Trend(double current, double previous, bool invertPositive)
    {
        double diff = current - previous;
        if (Math.Abs(diff) < 0.01)
        {
            return ("0%", true);
        }

        bool isUp = diff > 0;
        string value = (isUp ? "+" : string.Empty) + Num(PctChange(current, previous), 1) + "%";
        return (value, invertPositive ? !isUp : isUp);
    }

    private static (string From, string To, double Km) NearestCityPair(double distanceKm)
    {
        var best = CityPairs[0];
        double bestDiff = double.PositiveInfinity;
        foreach (var pair in CityPairs)
        {
            double diff = Math.Abs(pair.Km - distanceKm);
            if (diff < bestDiff)
            {
                bestDiff = diff;
                best = pair;
            }
        }

        return best;
    }

    private static string Num(double value, int decimals) => NumberFormatting.Format(value, null, decimals);

    private static string FormatDay(DateTimeOffset value) => value.ToString("MMM d", CultureInfo.CurrentCulture);
}

/// <summary>
/// The aggregated weekly-digest metrics — the native analogue of the web <c>DigestMetrics</c> object the
/// <c>useWeeklyDigest</c> hook computes (web/src/features/analytics/components/weekly-digest/types.ts), already in
/// the display units (kilometres, minutes, kilowatt-hours, Wh/km, account currency) the presentational sections
/// render verbatim. Internal to the projection. Pure data.
/// </summary>
internal sealed record DigestMetrics(
    double TotalDistance,
    double PrevDistance,
    long TotalDrives,
    long PrevDriveCount,
    double EnergyUsed,
    double PrevEnergy,
    double ChargingCost,
    double PrevChargingCost,
    double Co2Saved,
    double PrevCo2,
    double AvgEfficiency,
    double PrevAvgEfficiency,
    double TotalDuration,
    DigestDriveRow? TopDrive,
    double ChargeEnergyAdded,
    double PrevChargeEnergy,
    double AvgChargeRate,
    long ChargingSessionCount,
    double BatteryStart,
    double BatteryEnd,
    IReadOnlyList<(string Severity, long Count)> AlertsByType,
    long AlertTotal,
    IReadOnlyList<double> DailyDistance,
    IReadOnlyList<double> DailyEnergy);

/// <summary>
/// Canonical metadata for the <c>WeeklyDigestPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/analytics/pages/WeeklyDigestPage.tsx</c> (route <c>/weekly-digest</c>, nav name
/// <c>WeeklyDigest</c>). Holds the diagnostics slug, the route title resolver and the generated client operation
/// ids the feed binds to.
/// </summary>
public static class WeeklyDigestRegistration
{
    /// <summary>The route name the shell registers the page factory under.</summary>
    public const string RouteName = "WeeklyDigest";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WeeklyDigestPage";

    /// <summary>Generated operation id for the vehicle list (web <c>useVehicles</c>).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>Generated operation id for the per-vehicle drives query (web <c>/drives?vehicle_id=</c>).</summary>
    public const string DrivesOperation = "get_api_v1_drives";

    /// <summary>Generated operation id for the per-vehicle charging query (web <c>/charging?vehicle_id=</c>).</summary>
    public const string ChargingOperation = "get_api_v1_charging_sessions";

    /// <summary>Generated operation id for the alerts query (web <c>/alerts</c>).</summary>
    public const string AlertsOperation = "get_api_v1_alerts";

    /// <summary>The localized page title (web <c>analytics.weeklyDigest.title</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("analytics.weeklyDigest.title", "Weekly Digest");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>WeeklyDigestPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, distance, cost or any fleet
/// figure — so a diagnostics line can never leak a user's driving behaviour. Thread-safe.
/// </summary>
public sealed class WeeklyDigestDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WeeklyDigestDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WeeklyDigestPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WeeklyDigestRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant JSON readers shared by the weekly-digest row parsers — small helpers that coalesce missing / null /
/// wrong-typed fields to a sentinel rather than throwing, so a partial API row never breaks the digest. Mirrors the
/// null-tolerant reads the sibling feature-view models use. Pure — no WinUI types.
/// </summary>
internal static class DigestJson
{
    public static double? Number(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(
                v.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

    public static string? Str(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        if (v.ValueKind == JsonValueKind.String && v.TryGetDateTimeOffset(out var dto))
        {
            return dto;
        }

        return v.ValueKind == JsonValueKind.String
            && DateTimeOffset.TryParse(v.GetString(), CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out var parsed)
                ? parsed
                : null;
    }
}
