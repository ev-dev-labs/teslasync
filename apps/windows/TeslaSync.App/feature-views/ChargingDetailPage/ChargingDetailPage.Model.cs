using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Charging;

/// <summary>
/// One charging session aggregate from <c>GET /charging/{id}</c> (web <c>ChargingSession</c> in
/// web/src/api/types.ts) — the primary read the page is built around. Energy is SI watt-hours, power SI watts,
/// odometers SI metres; state-of-charge is a dimensionless percentage. Parsing is null-tolerant so a partial
/// row never throws and the projection applies the same web <c>?? 0</c> / <c>?? '—'</c> defaults.
/// </summary>
public sealed record ChargingSessionData(
    long Id,
    long VehicleId,
    DateTimeOffset? StartedAt,
    DateTimeOffset? EndedAt,
    double? StartSocPct,
    double? EndSocPct,
    double? OdometerStartMeters,
    double? OdometerEndMeters,
    double TotalEnergyAddedWh,
    double? PeakPowerW,
    double? AvgPowerW,
    double? CostDecimal,
    string? CostCurrency,
    string? ChargerType,
    string? StartPlace,
    string? EndedStatus)
{
    /// <summary>Project a <c>GET /charging/{id}</c> response into the session, or null for a non-object body.</summary>
    public static ChargingSessionData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ChargingSessionData(
            Id: (long)(ChargingDetailJson.Double(root, "id") ?? 0),
            VehicleId: (long)(ChargingDetailJson.Double(root, "vehicle_id") ?? 0),
            StartedAt: ChargingDetailJson.Date(root, "started_at"),
            EndedAt: ChargingDetailJson.Date(root, "ended_at"),
            StartSocPct: ChargingDetailJson.Double(root, "start_soc_pct"),
            EndSocPct: ChargingDetailJson.Double(root, "end_soc_pct"),
            OdometerStartMeters: ChargingDetailJson.Double(root, "start_odometer_m"),
            OdometerEndMeters: ChargingDetailJson.Double(root, "end_odometer_m"),
            TotalEnergyAddedWh: ChargingDetailJson.Double(root, "total_energy_added_wh") ?? 0,
            PeakPowerW: ChargingDetailJson.Double(root, "peak_power_w"),
            AvgPowerW: ChargingDetailJson.Double(root, "avg_power_w"),
            CostDecimal: ChargingDetailJson.Double(root, "cost_decimal"),
            CostCurrency: ChargingDetailJson.String(root, "cost_currency"),
            ChargerType: ChargingDetailJson.String(root, "charger_type"),
            StartPlace: ChargingDetailJson.String(root, "start_place"),
            EndedStatus: ChargingDetailJson.String(root, "ended_status"));
    }
}

/// <summary>
/// One per-session telemetry reading from <c>GET /charging/{id}/telemetry</c> (web
/// <c>ChargeTelemetryReading</c>), narrowed to the display-shaped fields the charge-curve and time-axis charts
/// read. <see cref="RatedRangeM"/> is SI metres and the temperatures SI Celsius; power is the signed kW the web
/// charts plot via <c>Math.abs</c>. Null-tolerant so a partial reading never throws.
/// </summary>
public sealed record ChargeReadingData(
    DateTimeOffset? CreatedAt,
    double? BatteryLevel,
    double? Soc,
    double? PowerKw,
    double? EnergyAdded,
    double? RatedRangeM,
    double? BatteryTempC,
    double? InsideTempC,
    double? OutsideTempC,
    double? Voltage,
    double? CurrentAmps)
{
    /// <summary>Project a single telemetry JSON object into a tolerant reading.</summary>
    public static ChargeReadingData FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new ChargeReadingData(null, null, null, null, null, null, null, null, null, null, null);
        }

        return new ChargeReadingData(
            CreatedAt: ChargingDetailJson.Date(element, "created_at"),
            BatteryLevel: ChargingDetailJson.Double(element, "battery_level"),
            Soc: ChargingDetailJson.Double(element, "soc"),
            PowerKw: ChargingDetailJson.Double(element, "power_kw"),
            EnergyAdded: ChargingDetailJson.Double(element, "energy_added"),
            RatedRangeM: ChargingDetailJson.Double(element, "rated_range"),
            BatteryTempC: ChargingDetailJson.Double(element, "battery_temp"),
            InsideTempC: ChargingDetailJson.Double(element, "inside_temp"),
            OutsideTempC: ChargingDetailJson.Double(element, "outside_temp"),
            Voltage: ChargingDetailJson.Double(element, "voltage"),
            CurrentAmps: ChargingDetailJson.Double(element, "current_amps"));
    }
}

/// <summary>The vehicle slice from <c>GET /vehicles/{id}</c> (web <c>useVehicle</c>) — only the display name the header shows.</summary>
public sealed record ChargingVehicleData(string? DisplayName)
{
    /// <summary>Project a <c>GET /vehicles/{id}</c> response into the slice, or null for a non-object body.</summary>
    public static ChargingVehicleData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ChargingVehicleData(ChargingDetailJson.String(root, "display_name"));
    }
}

/// <summary>
/// The live charging snapshot from <c>GET /charging-telemetry/latest</c> (web <c>ChargingTelemetry</c>) that
/// powers the Advanced-Charging-Parameters panel. The suffixed fields are SI on the wire despite their names
/// (page note); the projection performs the same display formatting the web does. Null-tolerant; a JSON null
/// body resolves to "no live data".
/// </summary>
public sealed record LiveChargingData(
    string? ChargingState,
    double? ChargerVoltage,
    double? ChargerActualCurrent,
    double? ChargerPilotCurrent,
    double? ChargerPowerW,
    double? ChargerPhases,
    double? BatteryRangeM,
    double? RangeAddedMetersPerHour,
    double? ChargeEnergyAddedWh)
{
    /// <summary>Project a <c>GET /charging-telemetry/latest</c> response into the live snapshot, or null when absent.</summary>
    public static LiveChargingData? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new LiveChargingData(
            ChargingState: ChargingDetailJson.String(root, "charging_state"),
            ChargerVoltage: ChargingDetailJson.Double(root, "charger_voltage"),
            ChargerActualCurrent: ChargingDetailJson.Double(root, "charger_actual_current"),
            ChargerPilotCurrent: ChargingDetailJson.Double(root, "charger_pilot_current"),
            ChargerPowerW: ChargingDetailJson.Double(root, "charger_power_w"),
            ChargerPhases: ChargingDetailJson.Double(root, "charger_phases"),
            BatteryRangeM: ChargingDetailJson.Double(root, "battery_range_mi"),
            RangeAddedMetersPerHour: ChargingDetailJson.Double(root, "range_added_meters_per_hour"),
            ChargeEnergyAddedWh: ChargingDetailJson.Double(root, "charge_energy_added_wh"));
    }
}

/// <summary>
/// The four-source data snapshot the page binds to — the native union of the web page's <c>useChargingSessionDetail</c>
/// (primary), <c>useChargeTelemetry</c>, <c>useVehicle</c> and <c>useChargingTelemetryLatest</c> reads. The
/// session is required (its absence after a load is the empty surface); telemetry / vehicle / live are
/// best-effort, exactly as the web's independent queries degrade.
/// </summary>
public sealed record ChargingDetailSnapshot(
    ChargingSessionData? Session,
    IReadOnlyList<ChargeReadingData> Telemetry,
    ChargingVehicleData? Vehicle,
    LiveChargingData? Live)
{
    /// <summary>The empty snapshot — no session resolved yet (loading / empty seed).</summary>
    public static ChargingDetailSnapshot Empty { get; } =
        new(null, Array.Empty<ChargeReadingData>(), null, null);

    /// <summary>True once the primary session read resolved an object.</summary>
    public bool HasSession => Session is not null;

    /// <summary>True when at least one telemetry reading is available (web <c>hasTelemetry</c>).</summary>
    public bool HasTelemetry => Telemetry.Count > 0;
}

/// <summary>The render-time model: the parsed snapshot plus the page lifecycle flags (web query <c>isLoading</c> / error).</summary>
public sealed record ChargingDetailModel(ChargingDetailSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial model: the primary session query is in flight with nothing resolved yet.</summary>
    public static ChargingDetailModel Initial { get; } = new(ChargingDetailSnapshot.Empty, true, null);
}

/// <summary>The four mutually-exclusive top-level data states the page renders (web isLoading / error / no-session / ready).</summary>
public enum ChargingDetailState
{
    /// <summary>The primary session read is in flight with nothing to show — the loading skeleton.</summary>
    Loading,

    /// <summary>Resolved with no session — the friendly page-level empty surface.</summary>
    Empty,

    /// <summary>The primary read failed — the retriable error surface.</summary>
    Error,

    /// <summary>A session resolved — the full detail content.</summary>
    Success,
}

/// <summary>One projected hero gauge (web <c>RadialGauge</c>): label, value, max, unit and a brand palette accent.</summary>
public sealed record ChargingGaugeDisplay(string Label, double Value, double Max, string Unit, ChartRole Role, int ColorIndex);

/// <summary>One projected stat card (web <c>StatCard</c>): label, pre-formatted value, optional sub-line, glyph.</summary>
public sealed record ChargingStatCardDisplay(string Label, string Value, string? Sublabel, string Glyph);

/// <summary>One projected inline metric (web <c>InlineMetric</c>): glyph, label, pre-formatted value.</summary>
public sealed record ChargingInlineDisplay(string Label, string Value, string Glyph, string AccentBrushKey);

/// <summary>One projected SoC progress bar (web <c>MetricBar</c>): label, value, max, right-hand readout, accent.</summary>
public sealed record ChargingBarDisplay(string Label, double Value, double Max, string ValueText, string AccentBrushKey);

/// <summary>One projected status chip (web <c>Badge</c>): text, semantic status, leading dot.</summary>
public sealed record ChargingBadgeDisplay(string Text, StatusKind Status, bool Dot);

/// <summary>One projected key/value row (web <c>KVList</c> item) — WinUI-free so the projection stays testable.</summary>
public sealed record ChargingKvRow(string Key, string Value);

/// <summary>
/// One projected chart region (web charge-curve / time-axis <c>GlassPanel</c>). Holds the ready
/// <see cref="ChartSeries"/> the native chart binds, the accessible summary, the per-region empty message, and
/// the optional "(estimated)" note the charge-curve shows when telemetry is synthesized.
/// </summary>
public sealed record ChargingChartDisplay(
    string Title,
    bool HasData,
    IReadOnlyList<ChartSeries> Series,
    string AccessibleSummary,
    string EmptyMessage,
    string? EstimatedNote,
    string? HelpText,
    string? HelpAria);

/// <summary>
/// The fully-resolved, render-ready projection of <c>ChargingDetailPage</c> — every web section as pure data so
/// the WinUI view is a thin renderer and the projection is unit-tested without a UI host. Each section carries
/// its own empty fallback (never a hidden region) and the four-state flags drive the top-level surfaces.
/// </summary>
public sealed record ChargingDetailDisplay
{
    public required ChargingDetailState State { get; init; }
    public required string AutomationName { get; init; }
    public required string Title { get; init; }

    // ── Header ──
    public required string HeaderDate { get; init; }
    public required string VehicleName { get; init; }
    public required ChargingBadgeDisplay AcDcBadge { get; init; }
    public ChargingBadgeDisplay? StateBadge { get; init; }
    public ChargingBadgeDisplay? ChargerTypeBadge { get; init; }
    public ChargingBadgeDisplay? LocationBadge { get; init; }

    // ── Hero gauges (5) ──
    public required IReadOnlyList<ChargingGaugeDisplay> Gauges { get; init; }

    // ── Battery progress ──
    public required string BatteryProgressTitle { get; init; }
    public required string BatteryProgressAria { get; init; }
    public required ChargingBarDisplay StartSocBar { get; init; }
    public required ChargingBarDisplay EndSocBar { get; init; }
    public required string SocGainedLabel { get; init; }
    public required string SocGainedValue { get; init; }
    public required string RangeGainedLabel { get; init; }
    public required string RangeGainedValue { get; init; }
    public required string EnergyAddedLabel { get; init; }
    public required string EnergyAddedValue { get; init; }

    // ── Eight stat cards ──
    public required IReadOnlyList<ChargingStatCardDisplay> StatCards { get; init; }

    // ── More details ──
    public required string MoreDetailsTitle { get; init; }
    public required IReadOnlyList<ChargingInlineDisplay> MoreDetailsInline { get; init; }
    public required IReadOnlyList<ChargingKvRow> MoreDetailsRows { get; init; }

    // ── Location ──
    public required bool HasLocation { get; init; }
    public required string LocationTitle { get; init; }
    public required string LocationText { get; init; }

    // ── Charts ──
    public required ChargingChartDisplay ChargeCurve { get; init; }
    public required ChargingChartDisplay SocOverTime { get; init; }
    public required ChargingChartDisplay Temperature { get; init; }
    public required ChargingChartDisplay VoltageCurrent { get; init; }

    // ── Advanced live ──
    public required string AdvancedTitle { get; init; }
    public required string AdvancedHint { get; init; }
    public required bool HasLive { get; init; }
    public required IReadOnlyList<ChargingKvRow> AdvancedRows { get; init; }
    public required string NoLiveDataText { get; init; }

    // ── Timestamps footer ──
    public required string StartedLabel { get; init; }
    public required string StartedValue { get; init; }
    public required string EndedLabel { get; init; }
    public required string EndedValue { get; init; }

    // ── State surfaces ──
    public required string ErrorText { get; init; }
    public required string RetryLabel { get; init; }
    public required string EmptyMessage { get; init; }

    public bool ShowLoading => State == ChargingDetailState.Loading;
    public bool ShowError => State == ChargingDetailState.Error;
    public bool ShowEmpty => State == ChargingDetailState.Empty;
    public bool ShowContent => State == ChargingDetailState.Success;
}

/// <summary>
/// The fully-resolved set of localized strings the page renders — every i18n key the web
/// <c>ChargingDetailPage</c> feeds into <c>t(...)</c>, resolved once through the i18n facade so the projection
/// stays readable and the string-coverage test can assert all 56 manifest keys in one pass.
/// </summary>
public sealed record ChargingDetailStrings
{
    public required string Title { get; init; }
    public required string Advanced { get; init; }
    public required string AdvancedHint { get; init; }
    public required string AtRate { get; init; }
    public required string AvgPower { get; init; }
    public required string AvgRate { get; init; }
    public required string BatteryProgress { get; init; }
    public required string BatteryRange { get; init; }
    public required string BatteryTemp { get; init; }
    public required string ChargeCurve { get; init; }
    public required string ChargeEnergyAdded { get; init; }
    public required string ChargeMilesAdded { get; init; }
    public required string ChargeRate { get; init; }
    public required string ChargerActualCurrent { get; init; }
    public required string ChargerPhases { get; init; }
    public required string ChargerPilotCurrent { get; init; }
    public required string ChargerPowerKw { get; init; }
    public required string ChargerType { get; init; }
    public required string ChargerVoltage { get; init; }
    public required string ChargingState { get; init; }
    public required string Currency { get; init; }
    public required string Current { get; init; }
    public required string Duration { get; init; }
    public required string EndSoc { get; init; }
    public required string Ended { get; init; }
    public required string Energy { get; init; }
    public required string EnergyAdded { get; init; }
    public required string EstCost { get; init; }
    public required string Estimated { get; init; }
    public required string FromSettings { get; init; }
    public required string InsideTemp { get; init; }
    public required string Location { get; init; }
    public required string MilesAdded { get; init; }
    public required string MoreDetails { get; init; }
    public required string NoLiveData { get; init; }
    public required string OutsideTemp { get; init; }
    public required string PeakPower { get; init; }
    public required string PerKwh { get; init; }
    public required string Power { get; init; }
    public required string Range { get; init; }
    public required string RangeGained { get; init; }
    public required string Soc { get; init; }
    public required string SocGained { get; init; }
    public required string SocOverTime { get; init; }
    public required string SocRange { get; init; }
    public required string StartSoc { get; init; }
    public required string Started { get; init; }
    public required string Status { get; init; }
    public required string Temperature { get; init; }
    public required string TotalCost { get; init; }
    public required string Vehicle { get; init; }
    public required string Voltage { get; init; }
    public required string VoltageCurrent { get; init; }
    public required string NoData { get; init; }
    public required string ChargeCurveAria { get; init; }
    public required string SocRangeAria { get; init; }

    /// <summary>Resolve every label through <paramref name="localizer"/> (web key names, defaults verbatim).</summary>
    public static ChargingDetailStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new ChargingDetailStrings
        {
            Title = localizer.GetString("charging.detail.title", "Charge Session"),
            Advanced = localizer.GetString("charging.detail.advanced", "Advanced Charging Parameters"),
            AdvancedHint = localizer.GetString("charging.detail.advancedHint", "Latest reported values from the vehicle."),
            AtRate = localizer.GetString("charging.detail.atRate", "at {{currencySymbol}}{{costPerKwh}}/kWh"),
            AvgPower = localizer.GetString("charging.detail.avgPower", "Avg Power"),
            AvgRate = localizer.GetString("charging.detail.avgRate", "kWh/h Avg"),
            BatteryProgress = localizer.GetString("charging.detail.batteryProgress", "Battery Progress"),
            BatteryRange = localizer.GetString("charging.detail.batteryRange", "Battery Range"),
            BatteryTemp = localizer.GetString("charging.detail.batteryTemp", "Battery"),
            ChargeCurve = localizer.GetString("charging.detail.chargeCurve", "Charge Curve"),
            ChargeEnergyAdded = localizer.GetString("charging.detail.chargeEnergyAdded", "Energy Added"),
            ChargeMilesAdded = localizer.GetString("charging.detail.chargeMilesAdded", "Range Added"),
            ChargeRate = localizer.GetString("charging.detail.chargeRate", "Charge Rate"),
            ChargerActualCurrent = localizer.GetString("charging.detail.chargerActualCurrent", "Active Charge Current"),
            ChargerPhases = localizer.GetString("charging.detail.chargerPhases", "Phases"),
            ChargerPilotCurrent = localizer.GetString("charging.detail.chargerPilotCurrent", "Pilot Current"),
            ChargerPowerKw = localizer.GetString("charging.detail.chargerPowerKw", "Charger Power"),
            ChargerType = localizer.GetString("charging.detail.chargerType", "Charger Type"),
            ChargerVoltage = localizer.GetString("charging.detail.chargerVoltage", "Charger Voltage"),
            ChargingState = localizer.GetString("charging.detail.chargingState", "Charging State"),
            Currency = localizer.GetString("charging.detail.currency", "Currency"),
            Current = localizer.GetString("charging.detail.current", "Current"),
            Duration = localizer.GetString("charging.detail.duration", "Duration"),
            EndSoc = localizer.GetString("charging.detail.endSoc", "End SoC"),
            Ended = localizer.GetString("charging.detail.ended", "Ended"),
            Energy = localizer.GetString("charging.detail.energy", "Energy"),
            EnergyAdded = localizer.GetString("charging.detail.energyAdded", "Energy Added"),
            EstCost = localizer.GetString("charging.detail.estCost", "Est. Cost"),
            Estimated = localizer.GetString("charging.detail.estimated", "estimated"),
            FromSettings = localizer.GetString("charging.detail.fromSettings", "from settings"),
            InsideTemp = localizer.GetString("charging.detail.insideTemp", "Inside"),
            Location = localizer.GetString("charging.detail.location", "Location"),
            MilesAdded = localizer.GetString("charging.detail.milesAdded", "Miles Added"),
            MoreDetails = localizer.GetString("charging.detail.moreDetails", "More Details"),
            NoLiveData = localizer.GetString("charging.detail.noLiveData", "No live charging telemetry available."),
            OutsideTemp = localizer.GetString("charging.detail.outsideTemp", "Outside"),
            PeakPower = localizer.GetString("charging.detail.peakPower", "Peak Power"),
            PerKwh = localizer.GetString("charging.detail.perKwh", "Per kWh"),
            Power = localizer.GetString("charging.detail.power", "Power"),
            Range = localizer.GetString("charging.detail.range", "Range"),
            RangeGained = localizer.GetString("charging.detail.rangeGained", "Range Gained"),
            Soc = localizer.GetString("charging.detail.soc", "SoC"),
            SocGained = localizer.GetString("charging.detail.socGained", "SoC Gained"),
            SocOverTime = localizer.GetString("charging.detail.socOverTime", "SoC, Energy & Range over Time"),
            SocRange = localizer.GetString("charging.detail.socRange", "SoC Range"),
            StartSoc = localizer.GetString("charging.detail.startSoc", "Start SoC"),
            Started = localizer.GetString("charging.detail.started", "Started"),
            Status = localizer.GetString("charging.detail.status", "Status"),
            Temperature = localizer.GetString("charging.detail.temperature", "Temperature"),
            TotalCost = localizer.GetString("charging.detail.totalCost", "Total Cost"),
            Vehicle = localizer.GetString("charging.detail.vehicle", "Vehicle"),
            Voltage = localizer.GetString("charging.detail.voltage", "Voltage"),
            VoltageCurrent = localizer.GetString("charging.detail.voltageCurrent", "Voltage & Current"),
            NoData = localizer.GetString("common.noData", "No data available"),
            ChargeCurveAria = localizer.GetString("help.charging.chargeCurve.aria", "More info about taper and derating"),
            SocRangeAria = localizer.GetString("help.charging.socRange.aria", "More info about state-of-charge range"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="ChargingDetailModel"/> to its <see cref="ChargingDetailDisplay"/> — the
/// native port of web/src/features/charging/pages/ChargingDetailPage.tsx. It selects the four-state matrix,
/// resolves every label through the i18n facade, formats every value at the display boundary (SI energy / power
/// / distance / temperature via <see cref="UnitFormatters"/> + <see cref="UnitConverters"/>; dimensionless via
/// <see cref="ScalarFormatters"/>), and assembles every web section — the header chips, the five hero gauges,
/// the battery-progress meter, the eight stat cards, the more-details panel, the location panel, the charge
/// curve + three time-axis charts, the advanced live panel and the timestamps footer — each with its own empty
/// fallback. No WinUI types so it is unit-tested without a UI host.
/// </summary>
public static class ChargingDetailProjection
{
    private const string ZapGlyph = "\uE945";
    private const string BatteryGlyph = "\uE83F";
    private const string ClockGlyph = "\uE823";
    private const string GaugeGlyph = "\uE9D9";
    private const string DollarGlyph = "\uE1D6";
    private const string MapPinGlyph = "\uE707";
    private const string ActivityGlyph = "\uE9D2";

    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string InfoBrush = "TsColorInfoBrush";
    private const string AccentBrush = "TsColorAccentBrush";
    private const string Dash = "\u2014";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed four-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    /// <param name="costPerKwh">The settings cost-per-kWh rate (web <c>useFormatting().costPerKwh</c>).</param>
    /// <param name="currencySymbol">The settings currency symbol (web <c>useFormatting().currencySymbol</c>).</param>
    public static ChargingDetailDisplay Project(
        ChargingDetailModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now,
        double costPerKwh,
        string currencySymbol)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = ChargingDetailStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var session = snapshot.Session;

        ChargingDetailState state =
            model.Loading && session is null ? ChargingDetailState.Loading
            : model.ErrorDetail is not null ? ChargingDetailState.Error
            : session is null ? ChargingDetailState.Empty
            : ChargingDetailState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? localizer.GetString("error.loadFailed", "Failed to load data")
            : $"{localizer.GetString("error.loadFailed", "Failed to load data")}: {model.ErrorDetail}";

        bool dc = session is { } sess && IsDc(sess.ChargerType);
        double startSoc = session?.StartSocPct ?? 0;
        double endSoc = session?.EndSocPct ?? 0;
        double totalEnergyWh = session?.TotalEnergyAddedWh ?? 0;
        double durationMin = session is { } d ? DurationMinutes(d.StartedAt, d.EndedAt) : 0;
        double? addedDistanceM = session is { } a ? DistanceAddedM(a) : null;
        double? avgRate = session is { } r ? KwhPerHour(r) : null;
        double? costPerKwhDerived = session?.CostDecimal is { } cd && totalEnergyWh > 0
            ? cd / (totalEnergyWh / 1000.0)
            : null;

        string distanceUnit = UnitLabels.Label(units.Distance);
        string energyUnit = UnitLabels.Label(units.Energy);

        double EnergyDisplay() => UnitConverters.EnergyFromSi(totalEnergyWh, units.Energy);
        double PeakKw() => UnitConverters.PowerFromSi(session?.PeakPowerW ?? 0, PowerUnit.Kw);
        double AvgKw() => UnitConverters.PowerFromSi(session?.AvgPowerW ?? 0, PowerUnit.Kw);
        double ToDistance(double meters) => UnitConverters.DistanceFromSi(meters, units.Distance);

        // ── Header chips ──
        var acDc = new ChargingBadgeDisplay(dc ? "DC" : "AC", dc ? StatusKind.Warning : StatusKind.Info, true);
        string? liveState = snapshot.Live?.ChargingState;
        ChargingBadgeDisplay? stateBadge = string.IsNullOrEmpty(liveState)
            ? null
            : new ChargingBadgeDisplay(
                localizer.GetString($"charging.detail.chargingState.{liveState}", liveState!),
                ChargingStateStatus(liveState),
                true);
        ChargingBadgeDisplay? chargerTypeBadge = string.IsNullOrEmpty(session?.ChargerType)
            ? null
            : new ChargingBadgeDisplay(session!.ChargerType!, StatusKind.Neutral, false);
        ChargingBadgeDisplay? locationBadge = string.IsNullOrEmpty(session?.StartPlace)
            ? null
            : new ChargingBadgeDisplay(session!.StartPlace!, StatusKind.Neutral, false);

        // ── Hero gauges (5) ──
        var gauges = new List<ChargingGaugeDisplay>
        {
            new(s.EnergyAdded, EnergyDisplay(), Math.Max(EnergyDisplay(), 80), energyUnit, ChartRole.Energy, 0),
            new(s.EndSoc, endSoc, 100, "%", ChartRole.Battery, 0),
            new(s.PeakPower, PeakKw(), dc ? 250 : 22, "kW", ChartRole.Power, 0),
            new(s.Duration, durationMin, Math.Max(durationMin <= 0 ? 1 : durationMin, 120), "min", ChartRole.None, 3),
            new(s.AvgPower, AvgKw(), dc ? 250 : 22, "kW", ChartRole.Speed, 0),
        };

        // ── Battery progress ──
        var startBar = new ChargingBarDisplay(s.StartSoc, startSoc, 100, ScalarFormatters.FormatPercentage(session?.StartSocPct, 0), WarningBrush);
        var endBar = new ChargingBarDisplay(s.EndSoc, endSoc, 100, ScalarFormatters.FormatPercentage(session?.EndSocPct, 0), SuccessBrush);
        string socGainedValue = $"{ScalarFormatters.FormatNumber(endSoc - startSoc, 0)}%";
        string rangeGainedValue = addedDistanceM is { } rg
            ? WithUnit(ToDistance(rg / 1000.0), distanceUnit, 0)
            : Dash;
        string energyAddedValue = UnitFormatters.FormatEnergy(totalEnergyWh, units, 1);

        // ── Eight stat cards ──
        var statCards = new List<ChargingStatCardDisplay>
        {
            new(s.Energy, Stat(ScalarFormatters.FormatNumber(EnergyDisplay(), 1), energyUnit), null, ZapGlyph),
            new(s.Duration, Stat(ScalarFormatters.FormatNumber(durationMin, 0), "min"), null, ClockGlyph),
            new(s.PeakPower, Stat(ScalarFormatters.FormatNumber(PeakKw(), 1), "kW"), null, GaugeGlyph),
            new(s.SocRange, Stat($"{ScalarFormatters.FormatNumber(startSoc, 0)}\u2013{ScalarFormatters.FormatNumber(endSoc, 0)}", "%"), null, BatteryGlyph),
            BuildCostCard(s, session, totalEnergyWh, costPerKwh, currencySymbol),
            new(
                s.PerKwh,
                Stat(ScalarFormatters.FormatNumber(costPerKwhDerived ?? costPerKwh, 2), "$/kWh"),
                costPerKwhDerived is null ? s.FromSettings : null,
                DollarGlyph),
            new(
                s.MilesAdded,
                addedDistanceM is { } ma ? Stat(ScalarFormatters.FormatNumber(ToDistance(ma / 1000.0), 0), distanceUnit) : Dash,
                null,
                MapPinGlyph),
            new(
                s.AvgRate,
                avgRate is { } ar ? Stat(ScalarFormatters.FormatNumber(ar, 1), "kWh/h") : Dash,
                null,
                ZapGlyph),
        };

        // ── More details ──
        var inlineMetrics = new List<ChargingInlineDisplay>
        {
            new(s.AvgPower, session?.AvgPowerW is { } ap ? WithUnit(UnitConverters.PowerFromSi(ap, PowerUnit.Kw), "kW", 1) : Dash, GaugeGlyph, AccentBrush),
            new(s.MilesAdded, addedDistanceM is { } md ? WithUnit(ToDistance(md / 1000.0), distanceUnit, 0) : Dash, MapPinGlyph, SuccessBrush),
            new(s.Status, session?.EndedStatus ?? Dash, ZapGlyph, InfoBrush),
            new(s.Currency, session?.CostCurrency ?? Dash, DollarGlyph, WarningBrush),
        };
        var moreRows = new List<ChargingKvRow>
        {
            new(s.ChargerType, session?.ChargerType ?? (dc ? "DC" : "AC")),
            new(s.Location, session?.StartPlace ?? Dash),
            new(s.Vehicle, snapshot.Vehicle?.DisplayName ?? $"ID {session?.VehicleId ?? 0}"),
        };

        // ── Charts ──
        var chargeCurve = BuildChargeCurve(s, snapshot, session, dc);
        var socOverTime = BuildSocOverTime(s, snapshot, units, now);
        var temperature = BuildTemperature(s, snapshot, units, now);
        var voltageCurrent = BuildVoltageCurrent(s, snapshot, now);

        // ── Advanced live ──
        var live = snapshot.Live;
        var advancedRows = live is null
            ? new List<ChargingKvRow>()
            : new List<ChargingKvRow>
            {
                new(s.ChargingState, string.IsNullOrEmpty(live.ChargingState) ? Dash : live.ChargingState!),
                new(s.ChargerVoltage, live.ChargerVoltage is { } v ? WithUnit(v, "V", 0) : Dash),
                new(s.ChargerActualCurrent, live.ChargerActualCurrent is { } ca ? WithUnit(ca, "A", 1) : Dash),
                new(s.ChargerPilotCurrent, live.ChargerPilotCurrent is { } cp ? WithUnit(cp, "A", 1) : Dash),
                new(s.ChargerPowerKw, live.ChargerPowerW is { } cw ? WithUnit(cw, "kW", 1) : Dash),
                new(s.ChargerPhases, live.ChargerPhases is { } ph ? ScalarFormatters.FormatNumber(ph, 0) : Dash),
                new(s.BatteryRange, live.BatteryRangeM is { } br ? WithUnit(ToDistance(br), distanceUnit, 0) : Dash),
                new(s.ChargeRate, live.RangeAddedMetersPerHour is { } cr ? WithUnit(ToDistance(cr), $"{distanceUnit}/h", 1) : Dash),
                new(s.ChargeEnergyAdded, live.ChargeEnergyAddedWh is { } ce ? WithUnit(ce, "kWh", 2) : Dash),
                new(s.ChargeMilesAdded, live.RangeAddedMetersPerHour is { } rm ? WithUnit(ToDistance(rm / 1000.0), distanceUnit, 1) : Dash),
            };

        // ── Timestamps footer ──
        string startedValue = DateTimeFormatting.Format(session?.StartedAt, DateTimeVariant.Full, now);
        string endedValue = session?.EndedAt is { }
            ? DateTimeFormatting.Format(session.EndedAt, DateTimeVariant.Full, now)
            : Dash;

        return new ChargingDetailDisplay
        {
            State = state,
            AutomationName = s.Title,
            Title = s.Title,
            HeaderDate = DateTimeFormatting.Format(session?.StartedAt, DateTimeVariant.Date, now),
            VehicleName = snapshot.Vehicle?.DisplayName ?? string.Empty,
            AcDcBadge = acDc,
            StateBadge = stateBadge,
            ChargerTypeBadge = chargerTypeBadge,
            LocationBadge = locationBadge,
            Gauges = gauges,
            BatteryProgressTitle = s.BatteryProgress,
            BatteryProgressAria = s.SocRangeAria,
            StartSocBar = startBar,
            EndSocBar = endBar,
            SocGainedLabel = s.SocGained,
            SocGainedValue = socGainedValue,
            RangeGainedLabel = s.RangeGained,
            RangeGainedValue = rangeGainedValue,
            EnergyAddedLabel = s.EnergyAdded,
            EnergyAddedValue = energyAddedValue,
            StatCards = statCards,
            MoreDetailsTitle = s.MoreDetails,
            MoreDetailsInline = inlineMetrics,
            MoreDetailsRows = moreRows,
            HasLocation = !string.IsNullOrEmpty(session?.StartPlace),
            LocationTitle = s.Location,
            LocationText = session?.StartPlace ?? string.Empty,
            ChargeCurve = chargeCurve,
            SocOverTime = socOverTime,
            Temperature = temperature,
            VoltageCurrent = voltageCurrent,
            AdvancedTitle = s.Advanced,
            AdvancedHint = s.AdvancedHint,
            HasLive = live is not null,
            AdvancedRows = advancedRows,
            NoLiveDataText = s.NoLiveData,
            StartedLabel = s.Started,
            StartedValue = startedValue,
            EndedLabel = s.Ended,
            EndedValue = endedValue,
            ErrorText = errorText,
            RetryLabel = localizer.GetString("common.retry", "Retry"),
            EmptyMessage = s.NoData,
        };
    }

    /// <summary>Web page <c>isDC</c>: a charger type that is present and not a sentinel value.</summary>
    public static bool IsDc(string? chargerType)
    {
        string ft = chargerType?.ToLowerInvariant() ?? string.Empty;
        return ft.Length > 0 && ft != "<invalid>" && ft != "unknown";
    }

    /// <summary>Web helper <c>durationMinutes</c>: rounded minutes between start and end, or 0 when unbounded.</summary>
    public static double DurationMinutes(DateTimeOffset? startedAt, DateTimeOffset? endedAt)
    {
        if (startedAt is not { } start || endedAt is not { } end || end <= start)
        {
            return 0;
        }

        return Math.Round((end - start).TotalMinutes);
    }

    /// <summary>Web helper <c>distanceAddedM</c>: the positive odometer delta in metres, or null.</summary>
    public static double? DistanceAddedM(ChargingSessionData session)
    {
        if (session.OdometerStartMeters is not { } start || session.OdometerEndMeters is not { } end)
        {
            return null;
        }

        double delta = end - start;
        return delta > 0 ? delta : null;
    }

    /// <summary>Web helper <c>kwhPerHour</c>: the session-average charge rate in kWh/h, or null for a zero duration.</summary>
    public static double? KwhPerHour(ChargingSessionData session)
    {
        double durationMin = DurationMinutes(session.StartedAt, session.EndedAt);
        if (durationMin <= 0)
        {
            return null;
        }

        return session.TotalEnergyAddedWh / 1000.0 / durationMin * 60.0;
    }

    private static StatusKind ChargingStateStatus(string? state) => state switch
    {
        "Charging" or "Starting" => StatusKind.Success,
        "Complete" => StatusKind.Info,
        "Stopped" or "NoPower" => StatusKind.Warning,
        "Error" => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static ChargingStatCardDisplay BuildCostCard(
        ChargingDetailStrings s, ChargingSessionData? session, double totalEnergyWh, double costPerKwh, string currencySymbol)
    {
        if (session?.CostDecimal is { } cost)
        {
            return new ChargingStatCardDisplay(s.TotalCost, Stat(ScalarFormatters.FormatNumber(cost, 2), "$"), null, DollarGlyph);
        }

        string value = totalEnergyWh > 0
            ? $"{currencySymbol}{ScalarFormatters.FormatNumber(totalEnergyWh / 1000.0 * costPerKwh, 2)}"
            : Dash;
        string sublabel = totalEnergyWh > 0
            ? s.AtRate
                .Replace("{{currencySymbol}}", currencySymbol, StringComparison.Ordinal)
                .Replace("{{costPerKwh}}", ScalarFormatters.FormatNumber(costPerKwh, 2), StringComparison.Ordinal)
            : string.Empty;
        return new ChargingStatCardDisplay(s.EstCost, value, string.IsNullOrEmpty(sublabel) ? null : sublabel, DollarGlyph);
    }

    private static ChargingChartDisplay BuildChargeCurve(
        ChargingDetailStrings s, ChargingDetailSnapshot snapshot, ChargingSessionData? session, bool dc)
    {
        var points = new List<ChartPoint>();
        if (snapshot.HasTelemetry)
        {
            foreach (var r in snapshot.Telemetry)
            {
                if (r.BatteryLevel is { } soc && r.PowerKw is { } power)
                {
                    points.Add(new ChartPoint(soc, Math.Abs(power), ScalarFormatters.FormatNumber(soc, 0)));
                }
            }
        }
        else if (session is { })
        {
            points.AddRange(SynthesizeCurve(session, dc));
        }

        string? estimatedNote = snapshot.HasTelemetry ? null : s.Estimated;
        var series = points.Count > 0
            ? new[] { new ChartSeries(s.Power, points) { Kind = ChartSeriesKind.Area, Role = ChartRole.Power, Unit = "kW" } }
            : Array.Empty<ChartSeries>();

        return new ChargingChartDisplay(
            s.ChargeCurve, points.Count > 0, series, $"{s.ChargeCurve}. {s.Power}", s.NoData, estimatedNote, null, s.ChargeCurveAria);
    }

    private static List<ChartPoint> SynthesizeCurve(ChargingSessionData session, bool dc)
    {
        double startSoc = session.StartSocPct ?? 0;
        double endSoc = session.EndSocPct ?? 100;
        double peakPower = (session.PeakPowerW ?? 50_000) / 1000.0;
        var points = new List<ChartPoint>();
        const int steps = 20;
        for (int i = 0; i <= steps; i++)
        {
            double pct = (double)i / steps;
            double soc = startSoc + ((endSoc - startSoc) * pct);
            double taper = dc && soc > 80 ? 1 - ((soc - 80) / 40) : 1;
            double power = Math.Round(peakPower * Math.Max(taper, 0.15) * 10) / 10;
            double socRounded = Math.Round(soc);
            points.Add(new ChartPoint(socRounded, power, ScalarFormatters.FormatNumber(socRounded, 0)));
        }

        return points;
    }

    private static ChargingChartDisplay BuildSocOverTime(
        ChargingDetailStrings s, ChargingDetailSnapshot snapshot, UnitPref units, DateTimeOffset now)
    {
        var soc = new List<ChartPoint>();
        var energy = new List<ChartPoint>();
        var range = new List<ChartPoint>();
        if (snapshot.HasTelemetry)
        {
            for (int i = 0; i < snapshot.Telemetry.Count; i++)
            {
                var r = snapshot.Telemetry[i];
                string time = DateTimeFormatting.Format(r.CreatedAt, DateTimeVariant.Time, now);
                double? socValue = r.BatteryLevel ?? r.Soc;
                if (socValue is { } sv)
                {
                    soc.Add(new ChartPoint(i, sv, time));
                }

                if (r.EnergyAdded is { } ev)
                {
                    energy.Add(new ChartPoint(i, ev, time));
                }

                if (r.RatedRangeM is { } rm)
                {
                    range.Add(new ChartPoint(i, UnitConverters.DistanceFromSi(rm, units.Distance), time));
                }
            }
        }

        bool hasData = soc.Count > 0 || energy.Count > 0 || range.Count > 0;
        var series = new List<ChartSeries>();
        if (soc.Count > 0)
        {
            series.Add(new ChartSeries(s.Soc, soc) { Kind = ChartSeriesKind.Area, Role = ChartRole.Battery, Unit = "%" });
        }

        if (energy.Count > 0)
        {
            series.Add(new ChartSeries(s.Energy, energy) { Kind = ChartSeriesKind.Line, Role = ChartRole.Energy, Unit = UnitLabels.Label(units.Energy) });
        }

        if (range.Count > 0)
        {
            series.Add(new ChartSeries(s.Range, range) { Kind = ChartSeriesKind.Line, ColorIndex = 3, Unit = UnitLabels.Label(units.Distance) });
        }

        return new ChargingChartDisplay(
            s.SocOverTime, hasData, series, $"{s.SocOverTime}. {s.Soc}, {s.Energy}, {s.Range}", s.NoData, null, null, null);
    }

    private static ChargingChartDisplay BuildTemperature(
        ChargingDetailStrings s, ChargingDetailSnapshot snapshot, UnitPref units, DateTimeOffset now)
    {
        var battery = new List<ChartPoint>();
        var inside = new List<ChartPoint>();
        var outside = new List<ChartPoint>();
        if (snapshot.HasTelemetry)
        {
            for (int i = 0; i < snapshot.Telemetry.Count; i++)
            {
                var r = snapshot.Telemetry[i];
                string time = DateTimeFormatting.Format(r.CreatedAt, DateTimeVariant.Time, now);
                if (r.BatteryTempC is { } bt)
                {
                    battery.Add(new ChartPoint(i, UnitConverters.TemperatureFromSi(bt, units.Temperature), time));
                }

                if (r.InsideTempC is { } it)
                {
                    inside.Add(new ChartPoint(i, UnitConverters.TemperatureFromSi(it, units.Temperature), time));
                }

                if (r.OutsideTempC is { } ot)
                {
                    outside.Add(new ChartPoint(i, UnitConverters.TemperatureFromSi(ot, units.Temperature), time));
                }
            }
        }

        bool hasData = battery.Count > 0 || inside.Count > 0 || outside.Count > 0;
        string tempUnit = UnitLabels.Label(units.Temperature);
        var series = new List<ChartSeries>();
        if (battery.Count > 0)
        {
            series.Add(new ChartSeries(s.BatteryTemp, battery) { Kind = ChartSeriesKind.Line, Role = ChartRole.Temperature, Unit = tempUnit });
        }

        if (inside.Count > 0)
        {
            series.Add(new ChartSeries(s.InsideTemp, inside) { Kind = ChartSeriesKind.Line, ColorIndex = 3, Unit = tempUnit });
        }

        if (outside.Count > 0)
        {
            series.Add(new ChartSeries(s.OutsideTemp, outside) { Kind = ChartSeriesKind.Line, ColorIndex = 5, Unit = tempUnit });
        }

        return new ChargingChartDisplay(
            s.Temperature, hasData, series, $"{s.Temperature}. {s.BatteryTemp}, {s.InsideTemp}, {s.OutsideTemp}", s.NoData, null, null, null);
    }

    private static ChargingChartDisplay BuildVoltageCurrent(
        ChargingDetailStrings s, ChargingDetailSnapshot snapshot, DateTimeOffset now)
    {
        var voltage = new List<ChartPoint>();
        var current = new List<ChartPoint>();
        if (snapshot.HasTelemetry)
        {
            for (int i = 0; i < snapshot.Telemetry.Count; i++)
            {
                var r = snapshot.Telemetry[i];
                if (r.Voltage is null && r.CurrentAmps is null)
                {
                    continue;
                }

                string time = DateTimeFormatting.Format(r.CreatedAt, DateTimeVariant.Time, now);
                if (r.Voltage is { } v)
                {
                    voltage.Add(new ChartPoint(i, v, time));
                }

                if (r.CurrentAmps is { } c)
                {
                    current.Add(new ChartPoint(i, Math.Abs(c), time));
                }
            }
        }

        bool hasData = voltage.Count > 0 || current.Count > 0;
        var series = new List<ChartSeries>();
        if (voltage.Count > 0)
        {
            series.Add(new ChartSeries(s.Voltage, voltage) { Kind = ChartSeriesKind.Line, ColorIndex = 3, Unit = "V" });
        }

        if (current.Count > 0)
        {
            series.Add(new ChartSeries(s.Current, current) { Kind = ChartSeriesKind.Line, Role = ChartRole.Speed, Unit = "A" });
        }

        return new ChargingChartDisplay(
            s.VoltageCurrent, hasData, series, $"{s.VoltageCurrent}. {s.Voltage}, {s.Current}", s.NoData, null, null, null);
    }

    private static string Stat(string value, string unit) =>
        string.IsNullOrEmpty(unit) ? value : $"{value} {unit}";

    private static string WithUnit(double? value, string unit, int decimals)
    {
        if (value is not { } v || double.IsNaN(v) || double.IsInfinity(v))
        {
            return Dash;
        }

        return $"{ScalarFormatters.FormatNumber(v, decimals)} {unit}";
    }
}

/// <summary>
/// Canonical metadata for the <c>ChargingDetailPage</c> feature surface — the native mirror of the web page at
/// <c>web/src/features/charging/pages/ChargingDetailPage.tsx</c> (route <c>/charging/:id</c>, nav name
/// <c>ChargeDetail</c>). It pins the four generated operation ids the page reads. The web
/// <c>useChargingSessionDetail</c> calls <c>GET /charging/{id}</c> — generated <see cref="SessionOperation"/>
/// (returns <c>ChargingSession</c>) — which is distinct from the <c>/charging-sessions/{id}</c> admin endpoint
/// that <c>Operations.Charging.SessionDetail</c> names, so the correct id is pinned here.
/// </summary>
public static class ChargingDetailPageRegistration
{
    /// <summary>The route / page-factory name the shell registers this page under.</summary>
    public const string RouteName = "ChargeDetail";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ChargingDetailPage";

    /// <summary>The session-detail read — web <c>GET /charging/{id}</c> (returns ChargingSession).</summary>
    public const string SessionOperation = "get_api_v1_charging_sessionID";

    /// <summary>The per-session telemetry read — web <c>GET /charging/{id}/telemetry</c>.</summary>
    public const string TelemetryOperation = "get_api_v1_charging_sessionID_telemetry";

    /// <summary>The vehicle read — web <c>GET /vehicles/{id}</c>.</summary>
    public const string VehicleOperation = "get_api_v1_vehicles_vehicleID";

    /// <summary>The live charging read — web <c>GET /charging-telemetry/latest?vehicle_id=</c>.</summary>
    public const string LatestOperation = "get_api_v1_charging_telemetry_latest";

    /// <summary>Segoe Fluent glyph for the page-level empty surface (lightning bolt).</summary>
    public const string EmptyGlyph = "\uE945";

    /// <summary>The localized page title (web <c>t('charging.detail.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("charging.detail.title", "Charge Session");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>ChargingDetailPage</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a session id, location, cost or VIN —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ChargingDetailPageDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ChargingDetailPageDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ChargingDetailPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ChargingDetailPageRegistration.Slug}");
    }
}

/// <summary>
/// Tolerant <see cref="JsonElement"/> readers for the charging-detail parsers (mirrors the sibling feature
/// json helpers). Every read is null-safe so a partial wire object never throws; numeric-strings are tolerated
/// to match the Go API's mixed scalar encoding.
/// </summary>
internal static class ChargingDetailJson
{
    /// <summary>Reads a numeric (or numeric-string) property, or null when absent / non-numeric / non-finite.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
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

    /// <summary>Reads a non-empty string property, or null when absent / non-string / blank.</summary>
    public static string? String(JsonElement obj, string name)
    {
        if (obj.ValueKind == JsonValueKind.Object && obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String)
        {
            string? s = v.GetString();
            return string.IsNullOrEmpty(s) ? null : s;
        }

        return null;
    }

    /// <summary>Reads an ISO-8601 timestamp property as a UTC <see cref="DateTimeOffset"/>, or null when unparseable.</summary>
    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var dt)
            ? dt
            : null;
    }

    /// <summary>Projects each element of an array property through <paramref name="map"/> (empty when absent).</summary>
    public static IReadOnlyList<T> Array<T>(JsonElement obj, string name, Func<JsonElement, T> map)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var arr) || arr.ValueKind != JsonValueKind.Array)
        {
            return System.Array.Empty<T>();
        }

        var list = new List<T>(arr.GetArrayLength());
        foreach (var item in arr.EnumerateArray())
        {
            list.Add(map(item));
        }

        return list;
    }
}
