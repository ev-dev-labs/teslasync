using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>TeslaChargingSessionsPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/charging/pages/TeslaChargingSessionsPage.tsx). The web page runs
/// the <c>useTeslaChargingSessions</c> query and renders, in precedence order, the page-level loading shimmer (web
/// <c>PageContainer loading</c>), the page-level failure surface (web <c>PageContainer error</c>), the fleet-summary
/// cards + monthly-cost chart + locations + session table (web <c>response</c>), or the friendly empty states
/// when no fleet session has been imported yet. This enum is the top-level summary the ledger / Narrator key off;
/// per-region visibility is still driven by the projected flags so each branch renders exactly as the web composes it.
/// </summary>
public enum TeslaChargingSessionsState
{
    /// <summary>The sessions query is in flight with no data yet (web <c>isLoading</c>) — the page shows the shimmer.</summary>
    Loading,

    /// <summary>The query resolved with no sessions (web <c>sessions.length === 0</c>) — every region shows its empty state.</summary>
    Empty,

    /// <summary>The query failed (web <c>error</c>) — the page failure surface (InfoBar + Retry) is shown.</summary>
    Error,

    /// <summary>The query produced sessions (web <c>sessions.length &gt; 0</c>) — stats, chart, locations and table render.</summary>
    Success,
}

/// <summary>
/// One fleet charging session — the native mirror of the web <c>TeslaChargingSession</c>
/// (web/src/api/hooks/useCharging.ts), narrowed to the fields the page reads. Field names mirror the Go API's
/// snake_case JSON tags; energy is SI watt-hours and is converted to the display unit at the render boundary only.
/// Parsing is null-tolerant. Pure data — no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
public sealed record TeslaChargingSession(
    long SessionId,
    string? Vin,
    string? SiteLocationName,
    string? ChargeStartDatetime,
    double? TotalEnergyAddedWh,
    double? PeakPowerKw,
    double? ChargeDurationS,
    string? ChargerType,
    string? CurrencyCode,
    double? TotalCost,
    double? PerKwhRate,
    double? Latitude,
    double? Longitude,
    string? FetchedAt)
{
    /// <summary>Read one session from a JSON object, tolerating missing / null fields.</summary>
    public static TeslaChargingSession FromJson(JsonElement o) => new(
        SessionId: JsonReadHelpers.Long(o, "session_id") ?? JsonReadHelpers.Long(o, "id") ?? 0,
        Vin: JsonReadHelpers.Str(o, "vin"),
        SiteLocationName: JsonReadHelpers.Str(o, "site_location_name"),
        ChargeStartDatetime: JsonReadHelpers.Str(o, "charge_start_datetime"),
        TotalEnergyAddedWh: JsonReadHelpers.Double(o, "total_energy_added_wh"),
        PeakPowerKw: JsonReadHelpers.Double(o, "peak_power_kw"),
        ChargeDurationS: JsonReadHelpers.Double(o, "charge_duration_s"),
        ChargerType: JsonReadHelpers.Str(o, "charger_type"),
        CurrencyCode: JsonReadHelpers.Str(o, "currency_code"),
        TotalCost: JsonReadHelpers.Double(o, "total_cost"),
        PerKwhRate: JsonReadHelpers.Double(o, "per_kwh_rate"),
        Latitude: JsonReadHelpers.Double(o, "latitude"),
        Longitude: JsonReadHelpers.Double(o, "longitude"),
        FetchedAt: JsonReadHelpers.Str(o, "fetched_at"));
}

/// <summary>
/// The fleet-summary block — the native mirror of the web <c>TeslaChargingSessionSummary</c>: the session count, the
/// SI watt-hours energy total, the currency cost total, the average cost per kWh and the peak power (kW). Pure data;
/// parsing is null-tolerant.
/// </summary>
public sealed record TeslaChargingSessionSummary(
    long TotalSessions,
    double? TotalWh,
    double? TotalCost,
    double? AvgCostPerKwh,
    double? PeakPowerKw)
{
    /// <summary>The all-zero / all-null summary (the default before any data arrives).</summary>
    public static TeslaChargingSessionSummary Empty { get; } = new(0, null, null, null, null);

    /// <summary>Read the summary from a JSON object, tolerating missing / null fields.</summary>
    public static TeslaChargingSessionSummary FromJson(JsonElement o)
    {
        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        return new TeslaChargingSessionSummary(
            TotalSessions: JsonReadHelpers.Long(o, "total_sessions") ?? 0,
            TotalWh: JsonReadHelpers.Double(o, "total_wh"),
            TotalCost: JsonReadHelpers.Double(o, "total_cost"),
            AvgCostPerKwh: JsonReadHelpers.Double(o, "avg_cost_per_kwh"),
            PeakPowerKw: JsonReadHelpers.Double(o, "peak_power_kw"));
    }
}

/// <summary>
/// The charging-sessions envelope — the native mirror of the web <c>TeslaChargingSessionResponse</c>: the
/// <see cref="Sessions"/> rows plus the fleet <see cref="Summary"/>, and a <see cref="HasData"/> marker recording
/// whether the server returned a response (the web <c>response</c> presence test). The tolerant parser unwraps the
/// platform <c>{data:…}</c> envelope (internal/platform/httputil.Respond) so the snake_case wire shape round-trips
/// losslessly. Pure data.
/// </summary>
public sealed record TeslaChargingSessionsSnapshot(
    bool HasData,
    IReadOnlyList<TeslaChargingSession> Sessions,
    TeslaChargingSessionSummary Summary)
{
    /// <summary>The empty snapshot (no response yet) — the default local-state feed result.</summary>
    public static TeslaChargingSessionsSnapshot Empty { get; } =
        new(false, Array.Empty<TeslaChargingSession>(), TeslaChargingSessionSummary.Empty);

    /// <summary>
    /// Read the charging-sessions response from JSON, tolerating missing / null fields and the platform
    /// <c>{data:…}</c> envelope. A non-object payload is treated as "no data" (the web empty branch).
    /// </summary>
    public static TeslaChargingSessionsSnapshot FromJson(JsonElement root)
    {
        JsonElement o = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            o = data;
        }

        if (o.ValueKind != JsonValueKind.Object)
        {
            return Empty;
        }

        var sessions = new List<TeslaChargingSession>();
        if (o.TryGetProperty("sessions", out var arr) && arr.ValueKind == JsonValueKind.Array)
        {
            foreach (var element in arr.EnumerateArray())
            {
                if (element.ValueKind == JsonValueKind.Object)
                {
                    sessions.Add(TeslaChargingSession.FromJson(element));
                }
            }
        }

        TeslaChargingSessionSummary summary = o.TryGetProperty("summary", out var s)
            ? TeslaChargingSessionSummary.FromJson(s)
            : TeslaChargingSessionSummary.Empty;

        return new TeslaChargingSessionsSnapshot(true, sessions, summary);
    }
}

/// <summary>
/// One enrolled vehicle — the native mirror of the web <c>Vehicle</c> fields the vehicle dropdown reads
/// (<c>vin</c> + <c>display_name</c>). Pure data; parsing is null-tolerant and unwraps the platform envelope.
/// </summary>
public sealed record TeslaChargingVehicle(string Vin, string DisplayName)
{
    /// <summary>Read the vehicle list from JSON, tolerating a bare array or a <c>{data:[…]}</c> envelope.</summary>
    public static IReadOnlyList<TeslaChargingVehicle> ListFromJson(JsonElement root)
    {
        JsonElement arr = root;
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data))
        {
            arr = data;
        }

        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<TeslaChargingVehicle>();
        }

        var vehicles = new List<TeslaChargingVehicle>();
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            string? vin = JsonReadHelpers.Str(element, "vin");
            if (string.IsNullOrEmpty(vin))
            {
                continue;
            }

            string name = JsonReadHelpers.Str(element, "display_name") ?? vin;
            vehicles.Add(new TeslaChargingVehicle(vin, name));
        }

        return vehicles;
    }
}

/// <summary>
/// The data port the <see cref="TeslaChargingSessionsPageViewModel"/> reads through — the native parity of the web
/// page's three hooks: <c>useTeslaChargingSessions(vin)</c> (GET /tesla/charging/sessions), <c>useVehicles()</c>
/// (GET /vehicles) and the <c>useRefreshTeslaChargingSessions()</c> mutation (POST /tesla/charging/sessions/refresh).
/// The view never performs HTTP itself; the default <see cref="EmptyTeslaChargingSessionsFeed"/> resolves to the
/// empty state, and the generated-client-backed <see cref="TeslaChargingSessionsClientFeed"/> binds to the generated
/// OpenAPI contract client (ADR-004). A refresh that returns HTTP 403 throws <c>ApiException</c> (carrying the
/// status) so the view-model can surface the distinct "business account required" branch (web <c>is403</c>).
/// </summary>
public interface ITeslaChargingSessionsFeed
{
    /// <summary>Resolve the charging-sessions snapshot for the selected <paramref name="vin"/> (null = all vehicles).</summary>
    Task<TeslaChargingSessionsSnapshot> FetchSessionsAsync(string? vin, CancellationToken cancellationToken);

    /// <summary>Resolve the enrolled vehicles that populate the dropdown (web <c>useVehicles</c>).</summary>
    Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken);

    /// <summary>Trigger a refresh-from-Tesla for the selected <paramref name="vin"/> and return the fresh snapshot.</summary>
    Task<TeslaChargingSessionsSnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty snapshot / no vehicles (the empty data state).</summary>
public sealed class EmptyTeslaChargingSessionsFeed : ITeslaChargingSessionsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyTeslaChargingSessionsFeed Instance { get; } = new();

    private EmptyTeslaChargingSessionsFeed()
    {
    }

    /// <inheritdoc />
    public Task<TeslaChargingSessionsSnapshot> FetchSessionsAsync(string? vin, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TeslaChargingSessionsSnapshot.Empty);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<TeslaChargingVehicle>> FetchVehiclesAsync(CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<TeslaChargingVehicle>>(Array.Empty<TeslaChargingVehicle>());
    }

    /// <inheritdoc />
    public Task<TeslaChargingSessionsSnapshot> RefreshAsync(string? vin, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(TeslaChargingSessionsSnapshot.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>TeslaChargingSessionsPage</c> projects from — the native analogue of the web
/// page's resolved query state plus the vehicle dropdown, refresh-mutation flags and the user's unit / currency
/// display preference. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record TeslaChargingSessionsModel(
    bool HasData,
    IReadOnlyList<TeslaChargingSession> Sessions,
    TeslaChargingSessionSummary Summary,
    IReadOnlyList<TeslaChargingVehicle> Vehicles,
    string SelectedVin,
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool RefreshPending,
    bool RefreshForbidden,
    UnitPref Units,
    string CurrencySymbol)
{
    /// <summary>The initial model — the first load, no data yet, all vehicles selected, metric units, "$" currency.</summary>
    public static TeslaChargingSessionsModel Initial { get; } = new(
        HasData: false,
        Sessions: Array.Empty<TeslaChargingSession>(),
        Summary: TeslaChargingSessionSummary.Empty,
        Vehicles: Array.Empty<TeslaChargingVehicle>(),
        SelectedVin: string.Empty,
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        RefreshPending: false,
        RefreshForbidden: false,
        Units: UnitPref.Metric,
        CurrencySymbol: TeslaChargingSessionsProjection.DefaultCurrencySymbol);
}

/// <summary>One projected vehicle-dropdown option (web <c>vehicleOptions</c> entry): the VIN value, its localized label and whether it is selected.</summary>
public sealed record TeslaChargingVehicleOption(string Value, string Label, bool IsSelected);

/// <summary>One projected month bucket for the cost chart (web <c>buildMonthlyCost</c> output): the <c>YYYY-MM</c> bucket and its summed currency total.</summary>
public sealed record TeslaChargingMonthlyCost(string Month, double Total);

/// <summary>One projected session-location point (web <c>mapPoints</c> entry): the site name, the "lat, lng" caption and a Narrator label.</summary>
public sealed record TeslaChargingMapPoint(string SiteName, string Coordinates, string AutomationName);

/// <summary>One projected table column descriptor (web <c>Column</c>): the row-value key, the localized header and whether the values are numeric (right-aligned, numeric sort).</summary>
public sealed record TeslaChargingColumn(string Key, string Header, bool IsNumeric);

/// <summary>One projected, render-ready table row (web column <c>render</c> output): the formatted cell values keyed by column for the shared data table.</summary>
public sealed record TeslaChargingRowDisplay(
    long SessionId,
    string Date,
    string Location,
    string Vin,
    string Energy,
    string PeakPower,
    string Duration,
    string Cost,
    string Rate,
    string Type);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to, with
/// every visible literal already resolved through the i18n facade and every number formatted at the display boundary.
/// Holds the always-visible page header, the business-account info banner, the controls bar (vehicle selector +
/// refresh + 403 note + last-synced caption), the four data-state flags, the five fleet-summary stat cards, the
/// monthly-cost chart (series + accessible table headers + empty message), the session-locations panel and the
/// session table (columns + rows or empty state). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record TeslaChargingSessionsDisplay(
    TeslaChargingSessionsState State,
    string Title,
    string Subtitle,
    string AutomationName,
    string BusinessNote,
    string AllVehiclesLabel,
    IReadOnlyList<TeslaChargingVehicleOption> VehicleOptions,
    string RefreshLabel,
    string RefreshingLabel,
    string RefreshButtonLabel,
    bool RefreshPending,
    bool ShowBusinessOnly,
    string BusinessOnlyLabel,
    bool ShowLastSync,
    string LastSyncText,
    bool ShowLoading,
    string LoadingText,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowContent,
    string SessionsStatLabel,
    string SessionsStatValue,
    string EnergyStatLabel,
    string EnergyStatValue,
    string CostStatLabel,
    string CostStatValue,
    string AvgCostStatLabel,
    string AvgCostStatValue,
    string PeakPowerStatLabel,
    string PeakPowerStatValue,
    string MonthlyCostTitle,
    string MonthlyCostAria,
    string MonthColumnLabel,
    string TotalColumnLabel,
    string NoChartDataMessage,
    bool ShowChart,
    IReadOnlyList<TeslaChargingMonthlyCost> MonthlyCosts,
    IReadOnlyList<ChartSeries> ChartSeries,
    string MapTitle,
    string NoMapDataMessage,
    bool ShowMapPoints,
    IReadOnlyList<TeslaChargingMapPoint> MapPoints,
    string TableTitle,
    string ExportCsvLabel,
    IReadOnlyList<TeslaChargingColumn> Columns,
    IReadOnlyList<TeslaChargingRowDisplay> Rows,
    bool ShowTable,
    string NoDataMessage);

/// <summary>
/// Pure projection from a <see cref="TeslaChargingSessionsModel"/> to its <see cref="TeslaChargingSessionsDisplay"/> —
/// the native port of the render logic in web/src/features/charging/pages/TeslaChargingSessionsPage.tsx. Every visible
/// literal resolves through the i18n facade using the exact web key names; the summary cards format through the shared
/// SI unit / scalar formatters (the web <c>formatEnergy</c> / <c>formatCurrency</c> / <c>fmtNumber</c>), the table
/// cells reproduce each web column's <c>render</c> (energy via <c>convertEnergyFromSI(_, 'kWh')</c>, duration via
/// <c>formatDurationSeconds</c>, cost / rate via the currency formatter), and the chart reproduces
/// <c>buildMonthlyCost</c>. Every chrome string is resolved on every projection so the i18n contract holds in every
/// data state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class TeslaChargingSessionsProjection
{
    /// <summary>Em-dash fallback shared with the web <c>'—'</c> literals.</summary>
    public const string EmDash = "\u2014";

    /// <summary>The default currency symbol (web <c>settings.currency_symbol</c> default "$").</summary>
    public const string DefaultCurrencySymbol = "$";

    /// <summary>The accessible-table / chart series key carrying each month's currency total.</summary>
    public const string TotalKey = "total";

    private const int EnergyTablePrecision = 1;   // web fmtNumber(convertEnergyFromSI(_, 'kWh'), 1)
    private const int CostPrecision = 2;          // web formatCurrency(_, 2)
    private const int RatePrecision = 3;          // web formatCurrencyValue(_, …, 3)

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the resolved web query state + dropdown / refresh flags).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant for absolute timestamp formatting.</param>
    public static TeslaChargingSessionsDisplay Project(
        TeslaChargingSessionsModel model,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Page header (web PageContainer title + subtitle) ────────────────────────────────────────────────
        string title = localizer.GetString("tesla_sessions.title", "Fleet Charging Sessions");
        string subtitle = localizer.GetString(
            "tesla_sessions.subtitle",
            "Detailed charging session data from Tesla (business accounts only)");

        // ── Info banner (web businessNote GlassPanel) ───────────────────────────────────────────────────────
        string businessNote = localizer.GetString(
            "tesla_sessions.businessNote",
            "Fleet charging session data is only available for Tesla business accounts. Personal accounts will receive a 403 error when syncing.");

        // ── Controls bar (web vehicle selector + refresh + 403 note + last-synced caption) ──────────────────
        string allVehicles = localizer.GetString("tesla_sessions.allVehicles", "All Vehicles");
        string refreshLabel = localizer.GetString("tesla_sessions.refresh", "Refresh from Tesla");
        string refreshingLabel = localizer.GetString("tesla_sessions.refreshing", "Syncing...");
        string businessOnly = localizer.GetString("tesla_sessions.businessOnly", "Business account required");
        string lastSyncLabel = localizer.GetString("tesla_sessions.lastSync", "Last synced");

        // ── Summary stat cards (web StatCard ×5) ────────────────────────────────────────────────────────────
        string sessionsStatLabel = localizer.GetString("tesla_sessions.stats.sessions", "Total Sessions");
        string energyStatLabel = localizer.GetString("tesla_sessions.stats.energy", "Total Energy");
        string costStatLabel = localizer.GetString("tesla_sessions.stats.cost_decimal", "Total Cost");
        string avgCostStatLabel = localizer.GetString("tesla_sessions.stats.avgCost", "Avg Cost/kWh");
        string peakPowerStatLabel = localizer.GetString("tesla_sessions.stats.peakPower", "Peak Power");

        // ── Monthly cost chart (web ChartContainer + BarChart) ──────────────────────────────────────────────
        string monthlyCostTitle = localizer.GetString("tesla_sessions.monthlyCost", "Monthly Charging Cost");
        string monthlyCostAria = localizer.GetString("tesla_sessions.monthlyCost.aria", "Monthly Tesla charging cost bar chart");
        string monthColumnLabel = localizer.GetString("tesla_sessions.col.month", "Month");
        string totalColumnLabel = localizer.GetString("tesla_sessions.col.total", "Total ($)");
        string noChartData = localizer.GetString("tesla_sessions.noChartData", "No cost data yet. Click \"Refresh from Tesla\" to sync.");

        // ── Session locations (web map GlassPanel) ──────────────────────────────────────────────────────────
        string mapTitle = localizer.GetString("tesla_sessions.map", "Session Locations");
        string noMapData = localizer.GetString("tesla_sessions.noMapData", "No location data available yet.");

        // ── Session table (web DataTable GlassPanel) ────────────────────────────────────────────────────────
        string tableTitle = localizer.GetString("tesla_sessions.table", "Charging Sessions");
        string noData = localizer.GetString("tesla_sessions.noData", "No fleet charging sessions yet. Click \"Refresh from Tesla\" to import data.");
        string exportCsv = localizer.GetString("table.bulkActions.exportCsv", "Export CSV");

        string colDate = localizer.GetString("tesla_sessions.col.date", "Date");
        string colLocation = localizer.GetString("tesla_sessions.col.location", "Location");
        string colVin = localizer.GetString("tesla_sessions.col.vin", "VIN");
        string colEnergy = localizer.GetString("tesla_sessions.col.energy", "Energy (kWh)");
        string colPeakPower = localizer.GetString("tesla_sessions.col.peakPower", "Peak (kW)");
        string colDuration = localizer.GetString("tesla_sessions.col.duration", "Duration");
        string colCost = localizer.GetString("tesla_sessions.col.cost_decimal", "Cost");
        string colRate = localizer.GetString("tesla_sessions.col.rate", "Rate/kWh");
        string colType = localizer.GetString("tesla_sessions.col.type", "Type");

        // ── Page-level data states (web PageContainer loading / error + render precedence) ──────────────────
        string loadingText = localizer.GetString("common.loading", "Loading...");
        string loadFailed = localizer.GetString("error.loadFailed", "Failed to load data");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string errorText = model.HasError && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        bool showLoading = model.Loading;
        bool showError = !model.Loading && model.HasError;
        bool showContent = !model.Loading && !model.HasError;
        var sessions = model.Sessions;
        bool hasSessions = sessions.Count > 0;

        TeslaChargingSessionsState state = showLoading
            ? TeslaChargingSessionsState.Loading
            : showError
                ? TeslaChargingSessionsState.Error
                : hasSessions
                    ? TeslaChargingSessionsState.Success
                    : TeslaChargingSessionsState.Empty;

        // ── Vehicle dropdown options (web vehicleOptions) ───────────────────────────────────────────────────
        var vehicleOptions = new List<TeslaChargingVehicleOption>(model.Vehicles.Count + 1)
        {
            new(string.Empty, allVehicles, string.IsNullOrEmpty(model.SelectedVin)),
        };
        foreach (var v in model.Vehicles)
        {
            string label = $"{v.DisplayName} ({Last6(v.Vin)})";
            vehicleOptions.Add(new TeslaChargingVehicleOption(v.Vin, label, v.Vin == model.SelectedVin));
        }

        // ── Refresh button (web refreshMutation.isPending toggle) ───────────────────────────────────────────
        string refreshButtonLabel = model.RefreshPending ? refreshingLabel : refreshLabel;

        // ── Last-synced caption (web sessions[0].fetched_at) ────────────────────────────────────────────────
        bool showLastSync = hasSessions && !string.IsNullOrEmpty(sessions[0].FetchedAt);
        string lastSyncText = showLastSync
            ? $"{lastSyncLabel}: {DateTimeFormatting.Format(ParseInstant(sessions[0].FetchedAt), DateTimeVariant.Full, now)}"
            : lastSyncLabel;

        // ── Summary stat values (web summary cards) ─────────────────────────────────────────────────────────
        var summary = model.Summary;
        string sessionsValue = ScalarFormatters.FormatNumber(summary.TotalSessions, 0);
        string energyValue = summary.TotalWh != null
            ? UnitFormatters.FormatEnergy(summary.TotalWh, model.Units, EnergyTablePrecision)
            : EmDash;
        string costValue = summary.TotalCost != null
            ? ScalarFormatters.FormatCurrency(summary.TotalCost, model.CurrencySymbol, CostPrecision)
            : EmDash;
        string avgCostValue = summary.AvgCostPerKwh != null
            ? ScalarFormatters.FormatCurrency(summary.AvgCostPerKwh, model.CurrencySymbol, RatePrecision)
            : EmDash;
        string peakPowerValue = summary.PeakPowerKw != null
            ? $"{ScalarFormatters.FormatNumber(summary.PeakPowerKw, 0)} {UnitLabels.Label(PowerUnit.Kw)}"
            : EmDash;

        // ── Monthly cost chart series (web buildMonthlyCost + <BarChart>) ───────────────────────────────────
        var monthly = BuildMonthlyCost(sessions);
        bool showChart = monthly.Count > 0;
        IReadOnlyList<ChartSeries> chartSeries = BuildChartSeries(monthly, totalColumnLabel, model.CurrencySymbol);

        // ── Session-locations points (web mapPoints filter) ─────────────────────────────────────────────────
        var mapPoints = BuildMapPoints(sessions);
        bool showMapPoints = mapPoints.Count > 0;

        // ── Table columns + rows (web columns + render functions) ───────────────────────────────────────────
        var columns = new List<TeslaChargingColumn>
        {
            new("date", colDate, false),
            new("location", colLocation, false),
            new("vin", colVin, false),
            new("energy", colEnergy, true),
            new("peakPower", colPeakPower, true),
            new("duration", colDuration, false),
            new("cost", colCost, true),
            new("rate", colRate, true),
            new("type", colType, false),
        };

        var rows = new List<TeslaChargingRowDisplay>(sessions.Count);
        foreach (var s in sessions)
        {
            rows.Add(new TeslaChargingRowDisplay(
                SessionId: s.SessionId,
                Date: DateTimeFormatting.Format(ParseInstant(s.ChargeStartDatetime), DateTimeVariant.Full, now),
                Location: NullableText(s.SiteLocationName),
                Vin: string.IsNullOrEmpty(s.Vin) ? EmDash : $"\u2026{Last6(s.Vin)}",
                Energy: s.TotalEnergyAddedWh != null
                    ? NumberFormatting.Format(UnitConverters.EnergyFromSi(s.TotalEnergyAddedWh.Value, EnergyUnit.Kwh), model.Units.Locale, EnergyTablePrecision)
                    : EmDash,
                PeakPower: s.PeakPowerKw != null ? ScalarFormatters.FormatNumber(s.PeakPowerKw, 0) : EmDash,
                Duration: FormatDurationSeconds(s.ChargeDurationS),
                Cost: s.TotalCost != null
                    ? ScalarFormatters.FormatCurrency(s.TotalCost, model.CurrencySymbol, CostPrecision)
                    : EmDash,
                Rate: s.PerKwhRate != null
                    ? ScalarFormatters.FormatCurrency(s.PerKwhRate, model.CurrencySymbol, RatePrecision)
                    : EmDash,
                Type: string.IsNullOrEmpty(s.ChargerType) ? EmDash : s.ChargerType!.ToUpperInvariant()));
        }

        return new TeslaChargingSessionsDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            AutomationName: title,
            BusinessNote: businessNote,
            AllVehiclesLabel: allVehicles,
            VehicleOptions: vehicleOptions,
            RefreshLabel: refreshLabel,
            RefreshingLabel: refreshingLabel,
            RefreshButtonLabel: refreshButtonLabel,
            RefreshPending: model.RefreshPending,
            ShowBusinessOnly: model.RefreshForbidden,
            BusinessOnlyLabel: businessOnly,
            ShowLastSync: showLastSync,
            LastSyncText: lastSyncText,
            ShowLoading: showLoading,
            LoadingText: loadingText,
            ShowError: showError,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowContent: showContent,
            SessionsStatLabel: sessionsStatLabel,
            SessionsStatValue: sessionsValue,
            EnergyStatLabel: energyStatLabel,
            EnergyStatValue: energyValue,
            CostStatLabel: costStatLabel,
            CostStatValue: costValue,
            AvgCostStatLabel: avgCostStatLabel,
            AvgCostStatValue: avgCostValue,
            PeakPowerStatLabel: peakPowerStatLabel,
            PeakPowerStatValue: peakPowerValue,
            MonthlyCostTitle: monthlyCostTitle,
            MonthlyCostAria: monthlyCostAria,
            MonthColumnLabel: monthColumnLabel,
            TotalColumnLabel: totalColumnLabel,
            NoChartDataMessage: noChartData,
            ShowChart: showChart,
            MonthlyCosts: monthly,
            ChartSeries: chartSeries,
            MapTitle: mapTitle,
            NoMapDataMessage: noMapData,
            ShowMapPoints: showMapPoints,
            MapPoints: mapPoints,
            TableTitle: tableTitle,
            ExportCsvLabel: exportCsv,
            Columns: columns,
            Rows: rows,
            ShowTable: hasSessions,
            NoDataMessage: noData);
    }

    /// <summary>Aggregate sessions by <c>YYYY-MM</c> bucket, summing the currency total (web <c>buildMonthlyCost</c>).</summary>
    public static IReadOnlyList<TeslaChargingMonthlyCost> BuildMonthlyCost(IReadOnlyList<TeslaChargingSession> sessions)
    {
        ArgumentNullException.ThrowIfNull(sessions);

        var map = new Dictionary<string, double>(StringComparer.Ordinal);
        foreach (var s in sessions)
        {
            DateTimeOffset? start = ParseInstant(s.ChargeStartDatetime);
            if (start is not { } d)
            {
                continue;
            }

            string key = $"{d.Year.ToString("D4", CultureInfo.InvariantCulture)}-{d.Month.ToString("D2", CultureInfo.InvariantCulture)}";
            map[key] = (map.TryGetValue(key, out var current) ? current : 0) + (s.TotalCost ?? 0);
        }

        var keys = new List<string>(map.Keys);
        keys.Sort(StringComparer.Ordinal);
        var result = new List<TeslaChargingMonthlyCost>(keys.Count);
        foreach (var key in keys)
        {
            result.Add(new TeslaChargingMonthlyCost(key, map[key]));
        }

        return result;
    }

    /// <summary>Format a seconds duration as "Xh Ym" / "Ym" (web <c>formatDurationSeconds</c>); em-dash for null.</summary>
    public static string FormatDurationSeconds(double? seconds)
    {
        if (seconds is not { } s)
        {
            return EmDash;
        }

        long total = (long)s;
        long h = total / 3600;
        long m = total % 3600 / 60;
        return h > 0
            ? $"{h}h {m}m"
            : $"{m}m";
    }

    /// <summary>The last six characters of a VIN (web <c>vin.slice(-6)</c>); the whole string when shorter.</summary>
    public static string Last6(string? vin)
    {
        if (string.IsNullOrEmpty(vin))
        {
            return string.Empty;
        }

        return vin.Length <= 6 ? vin : vin[^6..];
    }

    private static ChartSeries[] BuildChartSeries(
        IReadOnlyList<TeslaChargingMonthlyCost> monthly,
        string seriesName,
        string currencySymbol)
    {
        if (monthly.Count == 0)
        {
            return Array.Empty<ChartSeries>();
        }

        var points = new List<ChartPoint>(monthly.Count);
        for (var i = 0; i < monthly.Count; i++)
        {
            points.Add(new ChartPoint(i, monthly[i].Total, monthly[i].Month));
        }

        return new[]
        {
            new ChartSeries(seriesName, points)
            {
                Kind = ChartSeriesKind.Bar,
                ColorIndex = 0,
                Unit = currencySymbol,
                Decimals = 0,
            },
        };
    }

    private static List<TeslaChargingMapPoint> BuildMapPoints(IReadOnlyList<TeslaChargingSession> sessions)
    {
        var points = new List<TeslaChargingMapPoint>();
        foreach (var s in sessions)
        {
            if (s.Latitude is not { } lat || s.Longitude is not { } lng)
            {
                continue;
            }

            string site = NullableText(s.SiteLocationName);
            string coords = $"{lat.ToString("0.0000", CultureInfo.InvariantCulture)}, {lng.ToString("0.0000", CultureInfo.InvariantCulture)}";
            points.Add(new TeslaChargingMapPoint(site, coords, $"{site} ({coords})"));
        }

        return points;
    }

    private static string NullableText(string? value) => string.IsNullOrEmpty(value) ? EmDash : value!;

    private static DateTimeOffset? ParseInstant(string? raw)
    {
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var value)
            ? value
            : null;
    }
}

/// <summary>
/// The canonical registration metadata for the <c>TeslaChargingSessionsPage</c> surface — the diagnostics slug, the
/// shell route name + web route, and the generated-client operation ids the <see cref="TeslaChargingSessionsClientFeed"/>
/// binds to. UI-free so it is asserted in unit tests and shared by the view, the feed and the shell registration.
/// </summary>
public static class TeslaChargingSessionsRegistration
{
    /// <summary>The diagnostics surface slug (the type name).</summary>
    public const string Slug = "TeslaChargingSessionsPage";

    /// <summary>The shell route name this page registers under.</summary>
    public const string RouteName = "TeslaChargingSessions";

    /// <summary>The web route this page is the parity port of.</summary>
    public const string WebRoute = "/tesla-charging-sessions";

    /// <summary>The generated operation id for the sessions query (GET /tesla/charging/sessions/).</summary>
    public const string SessionsOperation = "get_api_v1_tesla_charging_sessions";

    /// <summary>The generated operation id for the refresh mutation (POST /tesla/charging/sessions/refresh).</summary>
    public const string RefreshOperation = "post_api_v1_tesla_charging_sessions_refresh";

    /// <summary>The generated operation id for the vehicles query (GET /vehicles/).</summary>
    public const string VehiclesOperation = "get_api_v1_vehicles";

    /// <summary>The Segoe Fluent glyph for the business-account info banner.</summary>
    public const string BusinessGlyph = "\uE825";

    /// <summary>The Segoe Fluent glyph for the refresh button.</summary>
    public const string RefreshGlyph = "\uE72C";

    /// <summary>The Segoe Fluent glyph for the empty session-locations state.</summary>
    public const string MapGlyph = "\uE707";

    /// <summary>The Segoe Fluent glyph for the empty session-table state.</summary>
    public const string TableGlyph = "\uE946";

    /// <summary>The Segoe Fluent glyph for the empty monthly-cost chart state.</summary>
    public const string ChartGlyph = "\uE825";
}

/// <summary>
/// The PII-safe diagnostics sink for the <c>TeslaChargingSessionsPage</c> surface. Records only the
/// <c>view.opened</c> event keyed by the surface slug — never a VIN, location, cost or any session field — so the
/// open rate is observable without leaking fleet data.
/// </summary>
public sealed class TeslaChargingSessionsDiagnostics
{
    private int _openedCount;

    /// <summary>The number of times the surface has been opened in this process (test / diagnostics hook).</summary>
    public int OpenedCount => _openedCount;

    /// <summary>Record that the surface was opened.</summary>
    public void RecordViewOpened() => Interlocked.Increment(ref _openedCount);
}

/// <summary>Null-tolerant JSON readers shared by this surface's parsers (snake_case wire shape, never throwing).</summary>
internal static class JsonReadHelpers
{
    public static string? Str(JsonElement o, string name) =>
        o.ValueKind == JsonValueKind.Object && o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String
            ? v.GetString()
            : null;

    public static long? Long(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var l) ? l : null;
    }

    public static double? Double(JsonElement o, string name)
    {
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind == JsonValueKind.Number && v.TryGetDouble(out var d) ? d : null;
    }
}
