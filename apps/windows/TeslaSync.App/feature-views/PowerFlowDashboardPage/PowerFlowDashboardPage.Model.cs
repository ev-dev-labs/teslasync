using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Battery;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>PowerFlowDashboardPage</c> surface — the native mirror of the
/// data states the web page renders (web/src/features/battery/pages/PowerFlowDashboardPage.tsx). The web page drives
/// its top-level presentation off the Tesla energy-site live-status query (web <c>liveLoading</c> /
/// <c>hasLiveData = liveStatus &amp;&amp; 'id' in liveStatus</c>) and overlays the historical samples inside the two
/// charts. In precedence order: the loading shimmer (web <c>isLoading = liveLoading</c>), the retryable failure
/// surface, then the always-visible scaffold whose battery / flow regions resolve their own empty states from the
/// live reading (the web "no data" message response, which is not a snapshot). This enum is the top-level summary
/// the ledger / Narrator key off; per-region visibility is still driven by the projected flags.
/// </summary>
public enum PowerFlowState
{
    /// <summary>The live-status query is in flight with no prior snapshot (web <c>liveLoading</c>) — the page shimmers.</summary>
    Loading,

    /// <summary>The query resolved with no snapshot (web <c>!hasLiveData</c>) — the scaffold shows with per-region empty states.</summary>
    Empty,

    /// <summary>The live-status query failed with no snapshot — a retryable error surface shows.</summary>
    Error,

    /// <summary>The query produced a live snapshot (web <c>hasLiveData</c>) — the scaffold shows live values.</summary>
    Success,
}

/// <summary>
/// The latest Tesla energy-site live-status snapshot — the native mirror of the web <c>TeslaEnergyLiveStatus</c>
/// (web/src/types/energy.ts), read from <c>GET /tesla/energy-sites/{siteId}/live-status</c> (web
/// <c>useTeslaEnergyLiveStatus</c>). The endpoint returns either this snapshot (with an <c>id</c>) or a
/// <c>{message:…}</c> notice when nothing has been fetched yet; <see cref="HasData"/> records the web
/// <c>'id' in liveStatus</c> test. Every power/energy field is SI (watts, watt-hours) and nullable on the wire;
/// parsing is null-tolerant and unwraps the platform <c>{data:…}</c> envelope. Pure data — no WinUI types.
/// </summary>
public sealed record PowerFlowLiveReading(
    bool HasData,
    long Id,
    double? SolarPower,
    double? BatteryPower,
    double? LoadPower,
    double? GridPower,
    double? GridServicesPower,
    double? EnergyLeft,
    double? TotalPackEnergy,
    double? PercentageCharged,
    string? GridStatus,
    bool BackupCapable,
    bool StormModeActive,
    string? Timestamp)
{
    /// <summary>The "no snapshot" reading (the web message response / first load) — drives the empty state.</summary>
    public static PowerFlowLiveReading Empty { get; } = new(
        false, 0, null, null, null, null, null, null, null, null, null, false, false, null);

    /// <summary>Read the snapshot from JSON, tolerating the <c>{data:…}</c> envelope and the no-data message response.</summary>
    public static PowerFlowLiveReading FromJson(JsonElement root)
    {
        JsonElement o = PowerFlowJson.Unwrap(root);

        // The web treats a response without an `id` (the {message:…} notice) as "no live data".
        if (o.ValueKind != JsonValueKind.Object || !o.TryGetProperty("id", out _))
        {
            return Empty;
        }

        return new PowerFlowLiveReading(
            HasData: true,
            Id: PowerFlowJson.Long(o, "id") ?? 0,
            SolarPower: PowerFlowJson.Double(o, "solar_power"),
            BatteryPower: PowerFlowJson.Double(o, "battery_power"),
            LoadPower: PowerFlowJson.Double(o, "load_power"),
            GridPower: PowerFlowJson.Double(o, "grid_power"),
            GridServicesPower: PowerFlowJson.Double(o, "grid_services_power"),
            EnergyLeft: PowerFlowJson.Double(o, "energy_left"),
            TotalPackEnergy: PowerFlowJson.Double(o, "total_pack_energy"),
            PercentageCharged: PowerFlowJson.Double(o, "percentage_charged"),
            GridStatus: PowerFlowJson.Str(o, "grid_status"),
            BackupCapable: PowerFlowJson.Bool(o, "backup_capable"),
            StormModeActive: PowerFlowJson.Bool(o, "storm_mode_active"),
            Timestamp: PowerFlowJson.Str(o, "timestamp"));
    }
}

/// <summary>
/// One historical live-status sample — the native mirror of one element of the web
/// <c>useTeslaEnergyLiveStatusHistory</c> array (<c>GET /tesla/energy-sites/{siteId}/live-status/history</c>).
/// The timestamp plus the four SI power readings and the SOC the two charts plot. Parsing is null-tolerant; power
/// fields default to zero when absent (web <c>?? 0</c> in the chart mapping). Pure data.
/// </summary>
public sealed record PowerFlowHistoryEntry(
    string? Timestamp,
    double SolarPower,
    double BatteryPower,
    double GridPower,
    double LoadPower,
    double PercentageCharged)
{
    /// <summary>Read one sample from a JSON object, defaulting missing power readings to zero (web parity).</summary>
    public static PowerFlowHistoryEntry FromJson(JsonElement o) => new(
        Timestamp: PowerFlowJson.Str(o, "timestamp"),
        SolarPower: PowerFlowJson.Double(o, "solar_power") ?? 0,
        BatteryPower: PowerFlowJson.Double(o, "battery_power") ?? 0,
        GridPower: PowerFlowJson.Double(o, "grid_power") ?? 0,
        LoadPower: PowerFlowJson.Double(o, "load_power") ?? 0,
        PercentageCharged: PowerFlowJson.Double(o, "percentage_charged") ?? 0);

    /// <summary>Read the history array, tolerating the <c>{data:[…]}</c> envelope and non-array roots.</summary>
    public static IReadOnlyList<PowerFlowHistoryEntry> ListFromJson(JsonElement root)
    {
        JsonElement arr = PowerFlowJson.UnwrapArray(root);
        if (arr.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<PowerFlowHistoryEntry>();
        }

        var list = new List<PowerFlowHistoryEntry>(arr.GetArrayLength());
        foreach (var element in arr.EnumerateArray())
        {
            if (element.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(element));
            }
        }

        return list;
    }
}

/// <summary>
/// The data port the <see cref="PowerFlowDashboardPageViewModel"/> reads through — the native parity of the web
/// page's three hooks: <c>useTeslaEnergyLiveStatus</c> (the current snapshot that drives the page state),
/// <c>useTeslaEnergyLiveStatusHistory</c> (the samples the two charts plot, with the trailing
/// <c>since</c>/<c>until</c>/<c>limit</c> query) and <c>useRefreshTeslaEnergyLiveStatus</c> (the POST that fetches a
/// fresh snapshot from Tesla and then re-reads the two queries). The view never performs HTTP itself; the default
/// <see cref="EmptyPowerFlowFeed"/> resolves to the empty state, and the generated-client-backed
/// <see cref="PowerFlowClientFeed"/> binds to the generated OpenAPI contract client (ADR-004). A failing live-status
/// fetch throws so the view-model surfaces the retryable error branch; a failing history fetch is best-effort.
/// </summary>
public interface IPowerFlowFeed
{
    /// <summary>Resolve the current live-status snapshot (web <c>useTeslaEnergyLiveStatus</c>).</summary>
    Task<PowerFlowLiveReading> FetchLiveStatusAsync(long siteId, CancellationToken cancellationToken);

    /// <summary>Resolve the historical samples for the window (web <c>useTeslaEnergyLiveStatusHistory</c>).</summary>
    Task<IReadOnlyList<PowerFlowHistoryEntry>> FetchLiveStatusHistoryAsync(
        long siteId, string? since, string? until, int limit, CancellationToken cancellationToken);

    /// <summary>Fetch a fresh snapshot from Tesla and store it (web <c>useRefreshTeslaEnergyLiveStatus</c> POST).</summary>
    Task<PowerFlowLiveReading> RefreshLiveStatusAsync(long siteId, CancellationToken cancellationToken);
}

/// <summary>The default feed — resolves every fetch to the empty reading (the empty data state).</summary>
public sealed class EmptyPowerFlowFeed : IPowerFlowFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptyPowerFlowFeed Instance { get; } = new();

    private EmptyPowerFlowFeed()
    {
    }

    /// <inheritdoc />
    public Task<PowerFlowLiveReading> FetchLiveStatusAsync(long siteId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(PowerFlowLiveReading.Empty);
    }

    /// <inheritdoc />
    public Task<IReadOnlyList<PowerFlowHistoryEntry>> FetchLiveStatusHistoryAsync(
        long siteId, string? since, string? until, int limit, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult<IReadOnlyList<PowerFlowHistoryEntry>>(Array.Empty<PowerFlowHistoryEntry>());
    }

    /// <inheritdoc />
    public Task<PowerFlowLiveReading> RefreshLiveStatusAsync(long siteId, CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        return Task.FromResult(PowerFlowLiveReading.Empty);
    }
}

/// <summary>
/// The render-time data model the <c>PowerFlowDashboardPage</c> projects from — the native analogue of the web
/// page's resolved query state. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Loading">Whether the live-status query is in flight with no snapshot yet (web <c>liveLoading</c>).</param>
/// <param name="HasError">Whether the live-status query failed.</param>
/// <param name="ErrorDetail">Optional failure detail appended to the error surface.</param>
/// <param name="HasLive">Whether the live-status query produced a snapshot (web <c>hasLiveData</c>).</param>
/// <param name="Live">The current live-status snapshot (web <c>live</c>).</param>
/// <param name="HistoryLoading">Whether the history query is in flight (web <c>historyLoading</c>).</param>
/// <param name="History">The historical samples the charts plot (web <c>history</c>).</param>
public sealed record PowerFlowModel(
    bool Loading,
    bool HasError,
    string? ErrorDetail,
    bool HasLive,
    PowerFlowLiveReading Live,
    bool HistoryLoading,
    IReadOnlyList<PowerFlowHistoryEntry> History)
{
    /// <summary>The initial model — first load, no snapshot, history still loading.</summary>
    public static PowerFlowModel Initial { get; } = new(
        Loading: true,
        HasError: false,
        ErrorDetail: null,
        HasLive: false,
        Live: PowerFlowLiveReading.Empty,
        HistoryLoading: true,
        History: Array.Empty<PowerFlowHistoryEntry>());
}

/// <summary>One status chip in the header (web <c>Badge</c>): localized text, a semantic status, a glyph and visibility.</summary>
public sealed record PowerFlowBadge(string Text, StatusKind Status, bool Visible, string Glyph);

/// <summary>One current-power summary tile (web <c>StatCard</c>): label, formatted value, an optional state sub-line and accent glyph.</summary>
public sealed record PowerFlowStatTile(string Label, string Value, string Sublabel, string Glyph);

/// <summary>One power-flow arrow (web <c>FlowArrow</c>): the from/to endpoints, the formatted power, the active flag and the export direction (web <c>power &lt; 0</c> → up).</summary>
public sealed record PowerFlowArrow(string From, string To, string PowerText, bool Active, bool IsExport);

/// <summary>
/// The fully projected, render-ready view of the page for one input model — everything the WinUI view binds to,
/// with every visible literal already resolved through the i18n facade and every SI quantity formatted at the
/// display boundary. Holds the page header, the four data-state flags, the refresh affordance, the four header
/// badges, the four current-power tiles, the battery-state panel, the power-flow diagram, and the two historical
/// chart blocks (series + per-chart state). Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record PowerFlowDisplay(
    PowerFlowState State,
    string Title,
    string Subtitle,
    bool ShowLoading,
    bool ShowError,
    string ErrorText,
    string RetryLabel,
    bool ShowContent,
    string RefreshLabel,
    bool HasLive,

    // Header badges (web Grid / Storm Mode / Backup Capable / Updated)
    PowerFlowBadge GridBadge,
    PowerFlowBadge StormBadge,
    PowerFlowBadge BackupBadge,
    PowerFlowBadge LastUpdateBadge,

    // Panels 1-4 — current power tiles (Solar-Production / Battery / Home-Consumption / Grid)
    PowerFlowStatTile SolarCard,
    PowerFlowStatTile BatteryCard,
    PowerFlowStatTile HomeCard,
    PowerFlowStatTile GridCard,

    // Panel 5 (GlassPanel5) — battery state
    string BatteryStateTitle,
    bool HasBatteryData,
    string StateOfChargeLabel,
    string SocValueText,
    double SocPercent,
    bool SocBarVisible,
    string EnergyLeftLabel,
    string EnergyLeftValue,
    string TotalCapacityLabel,
    string TotalCapacityValue,
    string NoBatteryDataMessage,

    // Panel 6 (GlassPanel6) — power-flow diagram
    string FlowDiagramTitle,
    bool HasFlowData,
    IReadOnlyList<PowerFlowArrow> FlowArrows,
    string NoFlowDataMessage,

    // History section header
    string HistoryTitle,

    // Panel 7 (Power-Over-Time) — stacked power area chart
    string PowerOverTimeTitle,
    string PowerOverTimeDesc,
    string PowerOverTimeAria,
    IReadOnlyList<ChartSeries> PowerSeries,
    ChartState PowerChartState,

    // Panel 8 (Battery-State-of-Charge) — SOC line chart
    string SocOverTimeTitle,
    string SocOverTimeDesc,
    string SocOverTimeAria,
    IReadOnlyList<ChartSeries> SocSeries,
    ChartState SocChartState,

    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="PowerFlowModel"/> to its <see cref="PowerFlowDisplay"/> — the native port of
/// the render logic in web/src/features/battery/pages/PowerFlowDashboardPage.tsx. Every visible literal resolves
/// through the i18n facade using the exact web key names (<c>powerFlow.*</c>); SI watts / watt-hours format at the
/// display boundary through the web page's own magnitude-adaptive <c>fmtWatts</c> / <c>fmtWh</c> helpers (W below
/// 1&#160;kW, kW above; Wh below 1&#160;kWh, kWh above) reproduced via <see cref="NumberFormatting"/> (web
/// <c>fmtNumber</c>). Every chrome string is resolved on every projection so the i18n contract holds in every data
/// state. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class PowerFlowProjection
{
    /// <summary>The trailing history window the web range picker defaults to (web preset <c>7d</c>).</summary>
    public const int DefaultWindowDays = 7;

    /// <summary>The history row cap the web hook requests.</summary>
    public const int HistoryLimit = 1000;

    /// <summary>The freshness threshold (web/ADR-013) past which the live snapshot is flagged stale.</summary>
    public static readonly TimeSpan StaleAfter = TimeSpan.FromMinutes(2);

    private const string SolarGlyph = "\uE706";   // Brightness / sun
    private const string BatteryGlyph = "\uE83E"; // Battery
    private const string HomeGlyph = "\uE80F";    // Home
    private const string GridGlyph = "\uE945";    // Power / energy
    private const string StormGlyph = "\uE730";   // Shield (storm mode)
    private const string UpdatedGlyph = "\uE823"; // Recent / activity

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and unit preference.</summary>
    /// <param name="model">The render-time data model (the resolved web query state).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="units">The user's unit-display preference, applied at the render boundary (web <c>fmtNumber</c>).</param>
    /// <param name="now">The reference instant for date formatting and the staleness flag.</param>
    public static PowerFlowDisplay Project(PowerFlowModel model, ILocalizer localizer, UnitPref units, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);
        ArgumentNullException.ThrowIfNull(units);

        // ── All 33 manifest strings resolved UNCONDITIONALLY so every key is recorded in every data state ──
        string title = localizer.GetString("powerFlow.title", "Power Flow");
        string subtitle = localizer.GetString("powerFlow.subtitle", "Real-time power flow from your Tesla Energy system");
        string refreshLabel = localizer.GetString("powerFlow.refresh", "Refresh from Tesla");
        string gridLabel = localizer.GetString("powerFlow.grid", "Grid");
        string stormModeLabel = localizer.GetString("powerFlow.stormMode", "Storm Mode Active");
        string backupCapableLabel = localizer.GetString("powerFlow.backupCapable", "Backup Capable");
        string lastUpdateLabel = localizer.GetString("powerFlow.lastUpdate", "Updated");
        string solarPowerLabel = localizer.GetString("powerFlow.solarPower", "Solar Production");
        string batteryPowerLabel = localizer.GetString("powerFlow.batteryPower", "Battery");
        string chargingLabel = localizer.GetString("powerFlow.charging", "Charging");
        string dischargingLabel = localizer.GetString("powerFlow.discharging", "Discharging");
        string homeConsumptionLabel = localizer.GetString("powerFlow.homeConsumption", "Home Consumption");
        string gridPowerLabel = localizer.GetString("powerFlow.gridPower", "Grid");
        string importingLabel = localizer.GetString("powerFlow.importing", "Importing");
        string exportingLabel = localizer.GetString("powerFlow.exporting", "Exporting");
        string batteryStateLabel = localizer.GetString("powerFlow.batteryState", "Battery State");
        string stateOfChargeLabel = localizer.GetString("powerFlow.stateOfCharge", "State of Charge");
        string energyLeftLabel = localizer.GetString("powerFlow.energyLeft", "Energy Remaining");
        string totalCapacityLabel = localizer.GetString("powerFlow.totalCapacity", "Total Capacity");
        string noBatteryDataMessage = localizer.GetString("powerFlow.noBatteryData", "No battery data \u2014 refresh to fetch");
        string flowDiagramLabel = localizer.GetString("powerFlow.flowDiagram", "Power Flow");
        string solarLabel = localizer.GetString("powerFlow.solar", "Solar");
        string homeLabel = localizer.GetString("powerFlow.home", "Home");
        string batteryArrowLabel = localizer.GetString("powerFlow.batteryLabel", "Battery");
        string gridServicesLabel = localizer.GetString("powerFlow.gridServices", "Grid Services");
        string noFlowDataMessage = localizer.GetString("powerFlow.noFlowData", "No power flow data yet");
        string historyLabel = localizer.GetString("powerFlow.history", "Power History");
        string powerOverTimeTitle = localizer.GetString("powerFlow.powerOverTime", "Power Over Time");
        string powerOverTimeDesc = localizer.GetString("powerFlow.powerOverTimeDesc", "Solar, battery, and grid power flow");
        string powerOverTimeAria = localizer.GetString(
            "powerFlow.powerOverTime.aria", "Solar, battery, grid, and home power flow stacked area chart over time");
        string socOverTimeTitle = localizer.GetString("powerFlow.socOverTime", "Battery State of Charge");
        string socOverTimeDesc = localizer.GetString("powerFlow.socOverTimeDesc", "Battery percentage over time");
        string socOverTimeAria = localizer.GetString(
            "powerFlow.socOverTime.aria", "Battery state of charge percentage over time line chart");

        // Error-surface chrome (web has no bespoke error UI; ADR-006 requires a never-blank retryable surface).
        string retryLabel = localizer.GetString("Retry", "Retry");
        string loadFailed = localizer.GetString("Failed to load data", "Failed to load data");

        // ── State machine (web liveLoading → live error/empty → success) ─────────────────────────────────────
        PowerFlowState state;
        if (model.Loading)
        {
            state = PowerFlowState.Loading;
        }
        else if (model.HasError && !model.HasLive)
        {
            state = PowerFlowState.Error;
        }
        else if (!model.HasLive)
        {
            state = PowerFlowState.Empty;
        }
        else
        {
            state = PowerFlowState.Success;
        }

        string errorText = state == PowerFlowState.Error && !string.IsNullOrEmpty(model.ErrorDetail)
            ? $"{loadFailed}: {model.ErrorDetail}"
            : loadFailed;

        // ── Current power readings (web null-safe scalars) ───────────────────────────────────────────────────
        PowerFlowLiveReading live = model.Live;
        double? solarW = live.SolarPower;
        double? batteryW = live.BatteryPower;
        double? loadW = live.LoadPower;
        double? gridW = live.GridPower;
        string? gridStatus = live.GridStatus;

        // ── Header badges ────────────────────────────────────────────────────────────────────────────────────
        var gridBadge = new PowerFlowBadge(
            $"{gridLabel}: {(string.IsNullOrEmpty(gridStatus) ? Em(units) : gridStatus)}",
            string.Equals(gridStatus, "Active", StringComparison.Ordinal) ? StatusKind.Success : StatusKind.Danger,
            Visible: true,
            GridGlyph);

        var stormBadge = new PowerFlowBadge(stormModeLabel, StatusKind.Warning, live.StormModeActive, StormGlyph);
        var backupBadge = new PowerFlowBadge(backupCapableLabel, StatusKind.Info, live.BackupCapable, BatteryGlyph);

        bool stale = IsStale(live.Timestamp, now);
        var lastUpdateBadge = new PowerFlowBadge(
            $"{lastUpdateLabel}: {FormatDateTimeLabel(live.Timestamp, now)}",
            stale ? StatusKind.Warning : StatusKind.Neutral,
            Visible: model.HasLive,
            UpdatedGlyph);

        // ── Current-power tiles (web StatCard ×4) ────────────────────────────────────────────────────────────
        var solarCard = new PowerFlowStatTile(solarPowerLabel, FormatWatts(solarW, units), string.Empty, SolarGlyph);
        var batteryCard = new PowerFlowStatTile(
            batteryPowerLabel, FormatWatts(batteryW, units), BatteryStateWord(batteryW, chargingLabel, dischargingLabel), BatteryGlyph);
        var homeCard = new PowerFlowStatTile(homeConsumptionLabel, FormatWatts(loadW, units), string.Empty, HomeGlyph);
        var gridCard = new PowerFlowStatTile(
            gridPowerLabel, FormatWatts(gridW, units), GridFlowWord(gridW, importingLabel, exportingLabel), GridGlyph);

        // ── Panel 5 — battery state ──────────────────────────────────────────────────────────────────────────
        double? soc = live.PercentageCharged;
        string socValueText = soc is { } s ? $"{NumberFormatting.Format(s, units.Locale, 1)}%" : Em(units);

        // ── Panel 6 — power-flow diagram (web FlowArrow list, the grid-services arrow only when non-zero) ───────
        var arrows = new List<PowerFlowArrow>(4)
        {
            Arrow(solarLabel, homeLabel, solarW, (solarW ?? 0) > 0, units),
            Arrow(batteryArrowLabel, homeLabel, batteryW, (batteryW ?? 0) != 0, units),
            Arrow(gridLabel, homeLabel, gridW, (gridW ?? 0) != 0, units),
        };
        if ((live.GridServicesPower ?? 0) != 0)
        {
            arrows.Add(Arrow(gridServicesLabel, gridLabel, live.GridServicesPower, active: true, units));
        }

        // ── Panels 7/8 — chart series from the history samples (web chartData) ───────────────────────────────
        IReadOnlyList<PowerFlowHistoryEntry> history = model.History;
        var solarPoints = new List<ChartPoint>(history.Count);
        var batteryPoints = new List<ChartPoint>(history.Count);
        var gridPoints = new List<ChartPoint>(history.Count);
        var homePoints = new List<ChartPoint>(history.Count);
        var socPoints = new List<ChartPoint>(history.Count);
        for (int i = 0; i < history.Count; i++)
        {
            PowerFlowHistoryEntry sample = history[i];
            string label = FormatDateShort(sample.Timestamp, now);
            solarPoints.Add(new ChartPoint(i, sample.SolarPower, label));
            batteryPoints.Add(new ChartPoint(i, sample.BatteryPower, label));
            gridPoints.Add(new ChartPoint(i, sample.GridPower, label));
            homePoints.Add(new ChartPoint(i, sample.LoadPower, label));
            socPoints.Add(new ChartPoint(i, sample.PercentageCharged, label));
        }

        bool hasHistory = history.Count > 0;
        IReadOnlyList<ChartSeries> powerSeries = hasHistory
            ? new[]
            {
                new ChartSeries(solarLabel, solarPoints) { Kind = ChartSeriesKind.Area, Role = ChartRole.Energy, Unit = "W" },
                new ChartSeries(batteryArrowLabel, batteryPoints) { Kind = ChartSeriesKind.Area, Role = ChartRole.Battery, Unit = "W" },
                new ChartSeries(gridLabel, gridPoints) { Kind = ChartSeriesKind.Area, Role = ChartRole.Power, Unit = "W" },
                new ChartSeries(homeLabel, homePoints) { Kind = ChartSeriesKind.Area, Role = ChartRole.Speed, Unit = "W" },
            }
            : Array.Empty<ChartSeries>();
        IReadOnlyList<ChartSeries> socSeries = hasHistory
            ? new[]
            {
                new ChartSeries(stateOfChargeLabel, socPoints) { Kind = ChartSeriesKind.Line, Role = ChartRole.Battery, Unit = "%", Decimals = 0 },
            }
            : Array.Empty<ChartSeries>();

        ChartState chartState = model.HistoryLoading ? ChartState.Loading : hasHistory ? ChartState.Ready : ChartState.Empty;

        return new PowerFlowDisplay(
            State: state,
            Title: title,
            Subtitle: subtitle,
            ShowLoading: state == PowerFlowState.Loading,
            ShowError: state == PowerFlowState.Error,
            ErrorText: errorText,
            RetryLabel: retryLabel,
            ShowContent: state is PowerFlowState.Empty or PowerFlowState.Success,
            RefreshLabel: refreshLabel,
            HasLive: model.HasLive,
            GridBadge: gridBadge,
            StormBadge: stormBadge,
            BackupBadge: backupBadge,
            LastUpdateBadge: lastUpdateBadge,
            SolarCard: solarCard,
            BatteryCard: batteryCard,
            HomeCard: homeCard,
            GridCard: gridCard,
            BatteryStateTitle: batteryStateLabel,
            HasBatteryData: model.HasLive,
            StateOfChargeLabel: stateOfChargeLabel,
            SocValueText: socValueText,
            SocPercent: soc is { } pct ? Math.Min(pct, 100) : 0,
            SocBarVisible: soc is not null,
            EnergyLeftLabel: energyLeftLabel,
            EnergyLeftValue: FormatWattHours(live.EnergyLeft, units),
            TotalCapacityLabel: totalCapacityLabel,
            TotalCapacityValue: FormatWattHours(live.TotalPackEnergy, units),
            NoBatteryDataMessage: noBatteryDataMessage,
            FlowDiagramTitle: flowDiagramLabel,
            HasFlowData: model.HasLive,
            FlowArrows: arrows,
            NoFlowDataMessage: noFlowDataMessage,
            HistoryTitle: historyLabel,
            PowerOverTimeTitle: powerOverTimeTitle,
            PowerOverTimeDesc: powerOverTimeDesc,
            PowerOverTimeAria: powerOverTimeAria,
            PowerSeries: powerSeries,
            PowerChartState: chartState,
            SocOverTimeTitle: socOverTimeTitle,
            SocOverTimeDesc: socOverTimeDesc,
            SocOverTimeAria: socOverTimeAria,
            SocSeries: socSeries,
            SocChartState: chartState,
            AutomationName: title);
    }

    /// <summary>Web <c>fmtWatts</c>: SI watts → magnitude-adaptive "X.X kW" (≥ 1&#160;kW) or "X W" (em dash for null).</summary>
    public static string FormatWatts(double? watts, UnitPref units)
    {
        if (watts is not { } w)
        {
            return Em(units);
        }

        double abs = Math.Abs(w);
        return abs >= 1000.0
            ? $"{NumberFormatting.Format(w / 1000.0, units.Locale, 1)} kW"
            : $"{NumberFormatting.Format(w, units.Locale, 0)} W";
    }

    /// <summary>Web <c>fmtWh</c>: SI watt-hours → magnitude-adaptive "X.X kWh" (≥ 1&#160;kWh) or "X Wh" (em dash for null).</summary>
    public static string FormatWattHours(double? wh, UnitPref units)
    {
        if (wh is not { } v)
        {
            return Em(units);
        }

        return Math.Abs(v) >= 1000.0
            ? $"{NumberFormatting.Format(v / 1000.0, units.Locale, 1)} kWh"
            : $"{NumberFormatting.Format(v, units.Locale, 0)} Wh";
    }

    /// <summary>Web battery sub-line: charging when drawing in (&lt; 0), discharging when feeding out (&gt; 0), else none.</summary>
    public static string BatteryStateWord(double? watts, string charging, string discharging)
    {
        double w = watts ?? 0;
        return w < 0 ? charging : w > 0 ? discharging : string.Empty;
    }

    /// <summary>Web grid sub-line: importing when drawing from the grid (&gt; 0), exporting when feeding out (&lt; 0), else none.</summary>
    public static string GridFlowWord(double? watts, string importing, string exporting)
    {
        double w = watts ?? 0;
        return w > 0 ? importing : w < 0 ? exporting : string.Empty;
    }

    /// <summary>Whether a snapshot timestamp is older than the staleness threshold (ADR-013).</summary>
    public static bool IsStale(string? raw, DateTimeOffset now)
    {
        if (TryParseInstant(raw, out var parsed))
        {
            return now - parsed > StaleAfter;
        }

        return false;
    }

    /// <summary>Web <c>formatDateTime</c>: full localized date + time (or em dash for null / unparseable).</summary>
    public static string FormatDateTimeLabel(string? raw, DateTimeOffset now)
    {
        if (TryParseInstant(raw, out var parsed))
        {
            return DateTimeFormatting.Format(parsed, DateTimeVariant.Full, now);
        }

        return DateTimeFormatting.DefaultEmptyDisplay;
    }

    /// <summary>Web <c>formatDateShort</c>: "MMM d" (or em dash for null / unparseable) — the chart X tick label.</summary>
    public static string FormatDateShort(string? raw, DateTimeOffset now)
    {
        if (TryParseInstant(raw, out var parsed))
        {
            return DateTimeFormatting.Format(parsed, DateTimeVariant.Short, now);
        }

        return DateTimeFormatting.DefaultEmptyDisplay;
    }

    /// <summary>The trailing date-only window boundary (web range-picker <c>since</c>, in <c>yyyy-MM-dd</c>).</summary>
    public static string WindowSince(DateTimeOffset now) =>
        now.AddDays(-DefaultWindowDays).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>The trailing date-only window boundary (web range-picker <c>until</c>, in <c>yyyy-MM-dd</c>).</summary>
    public static string WindowUntil(DateTimeOffset now) =>
        now.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    private static PowerFlowArrow Arrow(string from, string to, double? power, bool active, UnitPref units) =>
        new(from, to, FormatWatts(power, units), active, (power ?? 0) < 0);

    private static string Em(UnitPref units) => units.EmptyDisplay ?? "\u2014";

    private static bool TryParseInstant(string? raw, out DateTimeOffset value)
    {
        if (!string.IsNullOrWhiteSpace(raw) &&
            DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal, out value))
        {
            return true;
        }

        value = default;
        return false;
    }
}

/// <summary>
/// Canonical metadata for the <c>PowerFlowDashboardPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/battery/pages/PowerFlowDashboardPage.tsx</c> (route <c>/power-flow</c>, nav name
/// <c>PowerFlowDashboard</c>). Exposes the route name plus the three generated OpenAPI operation ids the page binds
/// to (the native ports of the web hooks <c>useTeslaEnergyLiveStatus</c>, <c>useTeslaEnergyLiveStatusHistory</c> and
/// <c>useRefreshTeslaEnergyLiveStatus</c>).
/// </summary>
public static class PowerFlowDashboardRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "PowerFlowDashboardPage";

    /// <summary>The navigation route name this page registers under (see RouteTable <c>PowerFlowDashboard</c> → /power-flow).</summary>
    public const string RouteName = "PowerFlowDashboard";

    /// <summary>The default Tesla energy-site id the page reads (web <c>DEFAULT_SITE_ID = 1</c>).</summary>
    public const long DefaultSiteId = 1;

    /// <summary>Generated op for the current snapshot — the native port of web <c>useTeslaEnergyLiveStatus</c>.</summary>
    public const string OperationLiveStatus = "get_api_v1_tesla_energy_sites_siteID_live_status";

    /// <summary>Generated op for the historical samples — the native port of web <c>useTeslaEnergyLiveStatusHistory</c>.</summary>
    public const string OperationHistory = "get_api_v1_tesla_energy_sites_siteID_live_status_history";

    /// <summary>Generated op for the refresh POST — the native port of web <c>useRefreshTeslaEnergyLiveStatus</c>.</summary>
    public const string OperationRefresh = "post_api_v1_tesla_energy_sites_siteID_live_status_refresh";

    /// <summary>The Segoe Fluent Icons glyph for the empty/flow states (web <c>Activity</c> / <c>Zap</c> icons).</summary>
    public const string EmptyGlyph = "\uE945";

    /// <summary>The Segoe Fluent Icons glyph for the no-battery-data empty state (web <c>Battery</c> icon).</summary>
    public const string BatteryGlyph = "\uE83E";

    /// <summary>The localized page title (web <c>t('powerFlow.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("powerFlow.title", "Power Flow");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>PowerFlowDashboardPage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a site id, SOC, grid status or power value — so
/// a diagnostics line can never leak fleet content. Thread-safe.
/// </summary>
public sealed class PowerFlowDashboardDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public PowerFlowDashboardDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=PowerFlowDashboardPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={PowerFlowDashboardRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers shared by the PowerFlow parsers — mirrors the sibling
/// feature-view helpers. Unwraps the platform <c>{data:…}</c> envelope (object and array forms) and coerces
/// numbers / strings / booleans without throwing on missing or mistyped fields.
/// </summary>
internal static class PowerFlowJson
{
    public static JsonElement Unwrap(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Object)
        {
            return data;
        }

        return root;
    }

    public static JsonElement UnwrapArray(JsonElement root)
    {
        if (root.ValueKind == JsonValueKind.Object &&
            root.TryGetProperty("data", out var data) &&
            data.ValueKind == JsonValueKind.Array)
        {
            return data;
        }

        return root;
    }

    public static string? Str(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    public static bool Bool(JsonElement o, string name) =>
        o.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;

    public static double? Double(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetDouble(out var d) => d,
            JsonValueKind.String when double.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static long? Long(JsonElement o, string name)
    {
        if (!o.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var l) => l,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Any, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }
}
