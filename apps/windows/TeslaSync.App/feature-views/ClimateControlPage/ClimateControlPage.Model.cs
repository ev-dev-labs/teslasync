using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The latest climate / HVAC snapshot the page reads from <c>GET /climate/latest?vehicle_id={id}</c> — the native
/// mirror of the web <c>ClimateState</c> the page's <c>useClimate</c> query returns
/// (web/src/features/vehicle-systems/pages/ClimateControlPage.tsx). Field names are the snake_case wire names the
/// Go climate handler projects (internal/api/climate/handler.go); temperatures are SI Celsius exactly as stored,
/// converted at the render boundary only. Parsing is null-tolerant so a partial / schema-drifted body never throws
/// (web parity: every field is read with a <c>?? 0</c> / <c>!= null</c> guard). Pure data — no WinUI types — so the
/// projection is unit-tested headlessly.
/// </summary>
public sealed record ClimateReading(
    double? InsideTempC,
    double? OutsideTempC,
    double? DriverTempSettingC,
    double? PassengerTempSettingC,
    string? HvacPower,
    bool? IsAcOn,
    string? HvacAutoMode,
    double? FanSpeed,
    double? HvacFanStatus,
    string? ClimateKeeperMode,
    string? DefrostMode,
    bool? DefrostForPreconditioning,
    bool? RearDefrostEnabled,
    bool? WiperHeatEnabled,
    bool? RearDisplayHvacEnabled,
    bool? BatteryHeater,
    string? OverheatProtection,
    string? CabinOverheatProtectionTempLimit,
    bool? HvacSteeringWheelHeatAuto,
    int? HvacSteeringWheelHeatLevel,
    int? SeatHeaterLeft,
    int? SeatHeaterRight,
    int? SeatHeaterRearLeft,
    int? SeatHeaterRearCenter,
    int? SeatHeaterRearRight,
    bool? AutoSeatClimateLeft,
    bool? AutoSeatClimateRight,
    int? ClimateSeatCoolingFrontLeft,
    int? ClimateSeatCoolingFrontRight,
    bool? SeatVentEnabled)
{
    /// <summary>Project a <c>GET /climate/latest</c> body into the reading, or null when it is not a JSON object.</summary>
    public static ClimateReading? FromJson(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ClimateReading(
            InsideTempC: ClimateJson.Double(root, "inside_temp"),
            OutsideTempC: ClimateJson.Double(root, "outside_temp"),
            DriverTempSettingC: ClimateJson.Double(root, "driver_temp_setting"),
            PassengerTempSettingC: ClimateJson.Double(root, "passenger_temp_setting"),
            HvacPower: ClimateJson.String(root, "hvac_power"),
            IsAcOn: ClimateJson.Bool(root, "is_ac_on"),
            HvacAutoMode: ClimateJson.String(root, "hvac_auto_mode"),
            FanSpeed: ClimateJson.Double(root, "fan_speed"),
            HvacFanStatus: ClimateJson.Double(root, "hvac_fan_status"),
            ClimateKeeperMode: ClimateJson.String(root, "climate_keeper_mode"),
            DefrostMode: ClimateJson.String(root, "defrost_mode"),
            DefrostForPreconditioning: ClimateJson.Bool(root, "defrost_for_preconditioning"),
            RearDefrostEnabled: ClimateJson.Bool(root, "rear_defrost_enabled"),
            WiperHeatEnabled: ClimateJson.Bool(root, "wiper_heat_enabled"),
            RearDisplayHvacEnabled: ClimateJson.Bool(root, "rear_display_hvac_enabled"),
            BatteryHeater: ClimateJson.Bool(root, "battery_heater"),
            OverheatProtection: ClimateJson.String(root, "overheat_protection"),
            CabinOverheatProtectionTempLimit: ClimateJson.String(root, "cabin_overheat_protection_temp_limit"),
            HvacSteeringWheelHeatAuto: ClimateJson.Bool(root, "hvac_steering_wheel_heat_auto"),
            HvacSteeringWheelHeatLevel: ClimateJson.Int(root, "hvac_steering_wheel_heat_level"),
            SeatHeaterLeft: ClimateJson.Int(root, "seat_heater_left"),
            SeatHeaterRight: ClimateJson.Int(root, "seat_heater_right"),
            SeatHeaterRearLeft: ClimateJson.Int(root, "seat_heater_rear_left"),
            SeatHeaterRearCenter: ClimateJson.Int(root, "seat_heater_rear_center"),
            SeatHeaterRearRight: ClimateJson.Int(root, "seat_heater_rear_right"),
            AutoSeatClimateLeft: ClimateJson.Bool(root, "auto_seat_climate_left"),
            AutoSeatClimateRight: ClimateJson.Bool(root, "auto_seat_climate_right"),
            ClimateSeatCoolingFrontLeft: ClimateJson.Int(root, "climate_seat_cooling_front_left"),
            ClimateSeatCoolingFrontRight: ClimateJson.Int(root, "climate_seat_cooling_front_right"),
            SeatVentEnabled: ClimateJson.Bool(root, "seat_vent_enabled"));
    }
}

/// <summary>
/// One climate-history row from <c>GET /climate?vehicle_id={id}</c> — the native mirror of a row in the web
/// <c>useClimateHistory</c> result. Narrowed to the fields the charts and the history table read. Temperatures are
/// SI Celsius. Null-tolerant parsing so a partial row never throws.
/// </summary>
public sealed record ClimateHistoryRow(
    long Id,
    DateTimeOffset? Timestamp,
    double? InsideTempC,
    double? OutsideTempC,
    double? DriverTempSettingC,
    double? FanSpeed,
    bool? IsAcOn,
    string? ClimateKeeperMode)
{
    /// <summary>Project a single history JSON object into a row, or null when it is not an object.</summary>
    public static ClimateHistoryRow? FromJson(JsonElement element, int fallbackId)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new ClimateHistoryRow(
            Id: ClimateJson.Long(element, "id") ?? fallbackId,
            Timestamp: ClimateJson.Instant(element, "timestamp") ?? ClimateJson.Instant(element, "created_at"),
            InsideTempC: ClimateJson.Double(element, "inside_temp"),
            OutsideTempC: ClimateJson.Double(element, "outside_temp"),
            DriverTempSettingC: ClimateJson.Double(element, "driver_temp_setting"),
            FanSpeed: ClimateJson.Double(element, "fan_speed"),
            IsAcOn: ClimateJson.Bool(element, "is_ac_on"),
            ClimateKeeperMode: ClimateJson.String(element, "climate_keeper_mode"));
    }
}

/// <summary>
/// Null-tolerant <see cref="JsonElement"/> readers for the Climate page — every getter returns a nullable rather
/// than throwing so a partial / schema-drifted body never aborts the parse. WinUI-free so the parse is unit-tested
/// without a UI host.
/// </summary>
internal static class ClimateJson
{
    /// <summary>The string value of <paramref name="name"/>, or null when absent / not a JSON string.</summary>
    public static string? String(JsonElement obj, string name) =>
        obj.ValueKind == JsonValueKind.Object
        && obj.TryGetProperty(name, out var prop)
        && prop.ValueKind == JsonValueKind.String
            ? prop.GetString()
            : null;

    /// <summary>The numeric value of <paramref name="name"/>, tolerating a numeric or numeric-string field.</summary>
    public static double? Double(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => n,
            JsonValueKind.String when double.TryParse(prop.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The integer value of <paramref name="name"/> (rounded), tolerating numeric / numeric-string fields.</summary>
    public static int? Int(JsonElement obj, string name) =>
        Double(obj, name) is { } d ? (int)Math.Round(d, MidpointRounding.AwayFromZero) : null;

    /// <summary>The 64-bit integer value of <paramref name="name"/>, tolerating numeric / numeric-string fields.</summary>
    public static long? Long(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.Number when prop.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(prop.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    /// <summary>The boolean value of <paramref name="name"/>, or null when absent; tolerates numeric / string forms.</summary>
    public static bool? Bool(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var prop))
        {
            return null;
        }

        return prop.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when prop.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(prop.GetString(), out var b) => b,
            _ => null,
        };
    }

    /// <summary>The timestamp value of <paramref name="name"/>, or null when absent / unparseable.</summary>
    public static DateTimeOffset? Instant(JsonElement obj, string name)
    {
        string? raw = String(obj, name);
        if (string.IsNullOrEmpty(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var instant)
            ? instant
            : null;
    }
}

/// <summary>
/// The composed climate snapshot the view-model reduces to a <see cref="ClimateControlDisplay"/> — the native mirror
/// of the three web queries the page fans out from (<c>useClimate</c> latest, <c>useClimateHistory</c>, and
/// <c>useChargingTelemetryLatest</c> for the not-enough-power-to-heat alert). <see cref="HasData"/> mirrors the web
/// page's "there is something to render" gate. Pure data.
/// </summary>
public sealed record ClimateSnapshot(
    ClimateReading? Latest,
    IReadOnlyList<ClimateHistoryRow> History,
    bool NotEnoughPowerToHeat)
{
    /// <summary>The shared empty snapshot (no latest object, no history, no power alert).</summary>
    public static ClimateSnapshot Empty { get; } = new(null, Array.Empty<ClimateHistoryRow>(), false);

    /// <summary>True when the latest read returned a climate object (even an all-null one).</summary>
    public bool HasLatest => Latest is not null;

    /// <summary>True when at least one history row is present.</summary>
    public bool HasHistory => History.Count > 0;

    /// <summary>True when there is anything to render (a latest object or any history).</summary>
    public bool HasData => HasLatest || HasHistory;
}

/// <summary>The render-time input to <see cref="ClimateControlProjection"/>: the snapshot plus load flags.</summary>
/// <param name="Snapshot">The composed climate snapshot.</param>
/// <param name="Loading">True while the first load (with no data yet) is in flight.</param>
/// <param name="ErrorDetail">The failure detail when the latest read failed, else null.</param>
public sealed record ClimateControlModel(ClimateSnapshot Snapshot, bool Loading, string? ErrorDetail);

/// <summary>
/// The mutually-exclusive lifecycle state the page renders — the native superset of the branches the web
/// <c>ClimateControlPage</c> renders through its <c>PageContainer</c> (loading spinner / error surface / content)
/// plus the page-level empty surface for the degenerate "no climate object and no history" case. None is ever hidden.
/// </summary>
public enum ClimateControlState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton.</summary>
    Loading,

    /// <summary>No climate object and no history — render the page-level empty surface.</summary>
    Empty,

    /// <summary>The latest read failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A snapshot carrying a latest object or history — render every section.</summary>
    Success,
}

/// <summary>A render-ready status chip (text + semantic colour + optional leading dot).</summary>
public sealed record ClimateChip(string Text, StatusKind Variant, bool Dot = false);

/// <summary>A render-ready temperature gauge tile (or its empty fallback when the value is absent).</summary>
public sealed record ClimateGaugeDisplay(string Label, bool HasValue, double Value, double Max, string Unit, string ValueText);

/// <summary>A render-ready metric card (label / pre-formatted value / optional sub-line / accent rail key).</summary>
public sealed record ClimateCard(string Label, string Value, string? Subtitle, string AccentBrushKey);

/// <summary>A render-ready thermal-comfort tile (caption label, big value, status caption + glyph + colour).</summary>
public sealed record ClimateComfortTile(string Label, string Value, string Caption, StatusKind Variant, string Glyph);

/// <summary>A render-ready seat heater / cooling tile (label, badge + colour + glyph).</summary>
public sealed record ClimateSeatTile(string Label, string BadgeText, StatusKind Variant, string Glyph, bool HasBadge);

/// <summary>A render-ready legend entry beneath the seat grid (e.g. "1 — Low").</summary>
public sealed record ClimateLegendItem(string Text, string Glyph);

/// <summary>A render-ready climate-history table row (every cell pre-formatted to a string).</summary>
public sealed record ClimateTableRowDisplay(
    long Id,
    string Time,
    string Inside,
    string Outside,
    string SetTemp,
    string Fan,
    string Hvac,
    string Keeper);

/// <summary>
/// The fully-projected, render-ready content the <see cref="ClimateControlPage"/> view binds to. Holds the active
/// <see cref="State"/> + its show-flags, every header / banner / gauge / card / comfort / seat / chart / table region,
/// and the spoken automation summary. Pure data so every branch is asserted headlessly.
/// </summary>
public sealed record ClimateControlDisplay(
    ClimateControlState State,
    bool ShowLoading,
    bool ShowEmpty,
    bool ShowError,
    bool ShowContent,
    string Title,
    string Subtitle,
    string RefreshLabel,
    string RetryLabel,
    string ErrorText,
    string EmptyMessage,
    // HVAC status banner (GlassPanel1)
    bool HvacActive,
    string HvacSystemLabel,
    ClimateChip HvacStatusChip,
    ClimateChip ComfortChip,
    IReadOnlyList<ClimateChip> BannerChips,
    // Temperature gauges (GlassPanel2/3/4)
    IReadOnlyList<ClimateGaugeDisplay> Gauges,
    // Status cards (GlassPanel5 grid: HVAC-Power … Rear-Display-HVAC)
    IReadOnlyList<ClimateCard> StatusCards,
    // Protection & safety row (GlassPanel6 grid: Overheat-Protection … Passenger-Setting)
    IReadOnlyList<ClimateCard> ProtectionCards,
    // Thermal comfort (GlassPanel24..26)
    string ThermalComfortTitle,
    IReadOnlyList<ClimateComfortTile> ComfortTiles,
    // Climate efficiency (GlassPanel27 grid: Avg-Fan-Speed … Comfort-Score)
    string EfficiencyTitle,
    IReadOnlyList<ClimateCard> EfficiencyCards,
    // Seat heaters (GlassPanel28)
    string SeatHeadersTitle,
    IReadOnlyList<ClimateSeatTile> FrontSeats,
    IReadOnlyList<ClimateSeatTile> RearSeats,
    ClimateChip AutoSeatLeftChip,
    string AutoSeatLeftLabel,
    ClimateChip AutoSeatRightChip,
    string AutoSeatRightLabel,
    string SeatCoolingTitle,
    ClimateChip SeatVentChip,
    IReadOnlyList<ClimateSeatTile> CoolingSeats,
    IReadOnlyList<ClimateLegendItem> SeatLegend,
    // Temperature history line chart (GlassPanel33)
    string TempHistoryTitle,
    bool HasTempHistory,
    string TempHistoryEmptyMessage,
    IReadOnlyList<ChartSeries> TempHistorySeries,
    // AC state & fan speed area chart (GlassPanel34)
    string AcFanTitle,
    bool HasAcFanHistory,
    string AcFanEmptyMessage,
    IReadOnlyList<ChartSeries> AcFanSeries,
    string AcFanAxisCaption,
    // Climate history table (GlassPanel35)
    string HistoryTitle,
    string HistoryEmptyMessage,
    IReadOnlyList<string> HistoryColumns,
    IReadOnlyList<ClimateTableRowDisplay> HistoryRows,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="ClimateControlModel"/> to its <see cref="ClimateControlDisplay"/> — the native
/// port of the render logic in web/src/features/vehicle-systems/pages/ClimateControlPage.tsx and its helpers
/// (<c>comfortBadge</c>, <c>keeperLabel</c>/<c>keeperVariant</c>, <c>heatStyle</c>/<c>heatBadgeVariant</c>,
/// <c>coolStyle</c>, the comfort-score / temp-delta / efficiency-stats memos). Branch precedence mirrors the web data
/// lifecycle (error ▸ loading ▸ empty ▸ success). Every label resolves through the i18n facade using the same key
/// names the web source feeds <c>t(...)</c>. Temperatures convert from SI Celsius to the active unit only here, at
/// the display boundary. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class ClimateControlProjection
{
    // Fluent (Segoe Fluent Icons) glyphs used by the comfort tiles + seat legend.
    private const string SunGlyph = "\uE706";
    private const string SnowGlyph = "\uE9CA";
    private const string WindGlyph = "\uE9CA";
    private const string FlameGlyph = "\uE7A6";

    private const string AccentCyan = "TsChartSpeedBrush";
    private const string AccentGreen = "TsChartBatteryBrush";
    private const string AccentPurple = "TsChartPowerBrush";
    private const string AccentWarning = "TsColorWarningBrush";
    private const string AccentInfo = "TsColorInfoBrush";
    private const string AccentDefault = "TsColorAccentBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display in the active <paramref name="pref"/>.</summary>
    /// <param name="model">The render-time input (snapshot + load flags).</param>
    /// <param name="pref">The user's unit-display preference (temperature unit + locale).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ClimateControlDisplay Project(ClimateControlModel model, UnitPref pref, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(pref);
        ArgumentNullException.ThrowIfNull(localizer);

        string T(string phrase) => localizer.GetString("translation." + phrase, phrase);

        var state = SelectState(model);
        var latest = model.Snapshot.Latest;
        var history = model.Snapshot.History;

        string title = T("Climate Control");
        string subtitle = T("HVAC status, temperatures, and seat heaters");
        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail) ? T("Unknown") : model.ErrorDetail!;

        return new ClimateControlDisplay(
            State: state,
            ShowLoading: state == ClimateControlState.Loading,
            ShowEmpty: state == ClimateControlState.Empty,
            ShowError: state == ClimateControlState.Error,
            ShowContent: state == ClimateControlState.Success,
            Title: title,
            Subtitle: subtitle,
            RefreshLabel: T("Refresh"),
            RetryLabel: T("Refresh"),
            ErrorText: errorText,
            EmptyMessage: T("No history records found."),
            HvacActive: latest?.IsAcOn == true,
            HvacSystemLabel: T("HVAC System"),
            HvacStatusChip: BuildHvacStatusChip(latest, T),
            ComfortChip: BuildComfortChip(latest, T),
            BannerChips: BuildBannerChips(model.Snapshot, T),
            Gauges: BuildGauges(latest, pref, T),
            StatusCards: BuildStatusCards(latest, T),
            ProtectionCards: BuildProtectionCards(latest, pref, T),
            ThermalComfortTitle: T("Thermal Comfort"),
            ComfortTiles: BuildComfortTiles(latest, T),
            EfficiencyTitle: T("Climate Efficiency"),
            EfficiencyCards: BuildEfficiencyCards(latest, history, T),
            SeatHeadersTitle: T("Seat Heaters"),
            FrontSeats: BuildFrontSeats(latest, T),
            RearSeats: BuildRearSeats(latest, T),
            AutoSeatLeftChip: BuildAutoSeatChip(latest?.AutoSeatClimateLeft, T),
            AutoSeatLeftLabel: T("Auto Climate (Left)"),
            AutoSeatRightChip: BuildAutoSeatChip(latest?.AutoSeatClimateRight, T),
            AutoSeatRightLabel: T("Auto Climate (Right)"),
            SeatCoolingTitle: T("Seat Cooling"),
            SeatVentChip: BuildSeatVentChip(latest?.SeatVentEnabled, T),
            CoolingSeats: BuildCoolingSeats(latest, T),
            SeatLegend: BuildSeatLegend(T),
            TempHistoryTitle: T("Temperature History"),
            HasTempHistory: history.Count > 0,
            TempHistoryEmptyMessage: T("No temperature history available."),
            TempHistorySeries: BuildTempHistorySeries(history, pref, T),
            AcFanTitle: T("AC State & Fan Speed"),
            HasAcFanHistory: history.Count > 0,
            AcFanEmptyMessage: T("No HVAC history available."),
            AcFanSeries: BuildAcFanSeries(history, T),
            AcFanAxisCaption: $"{T("AC")} · {T("Fan Level")}",
            HistoryTitle: T("Climate History"),
            HistoryEmptyMessage: T("No history records found."),
            HistoryColumns: BuildHistoryColumns(pref, T),
            HistoryRows: BuildHistoryRows(history, pref, T),
            AutomationName: $"{title}. {subtitle}");
    }

    /// <summary>The web <c>comfortBadge</c> helper over raw Celsius (delta ≤ 1 comfortable, ≤ 3 adjusting, else far).</summary>
    public static ClimateChip ComfortBadge(double? insideC, double? targetC, Func<string, string> t)
    {
        double delta = Math.Abs((insideC ?? 0) - (targetC ?? 0));
        if (delta <= 1)
        {
            return new ClimateChip(t("Comfortable"), StatusKind.Success);
        }

        return delta <= 3
            ? new ClimateChip(t("Adjusting"), StatusKind.Warning)
            : new ClimateChip(t("Far from target"), StatusKind.Danger);
    }

    /// <summary>The web <c>keeperLabel</c> helper.</summary>
    public static string KeeperLabel(string? mode) => mode switch
    {
        "On" => "On",
        "Dog Mode" => "Dog Mode",
        "Camp Mode" => "Camp Mode",
        _ => "Off",
    };

    /// <summary>The web <c>keeperVariant</c> helper.</summary>
    public static StatusKind KeeperVariant(string? mode) => mode switch
    {
        "On" => StatusKind.Info,
        "Dog Mode" => StatusKind.Warning,
        "Camp Mode" => StatusKind.Info,
        _ => StatusKind.Neutral,
    };

    /// <summary>The web <c>HEAT_LEVELS[level].label</c> helper (clamped 0–3 → Off / Low / Medium / High).</summary>
    public static string HeatLabel(int level) => Math.Clamp(level, 0, 3) switch
    {
        1 => "Low",
        2 => "Medium",
        3 => "High",
        _ => "Off",
    };

    /// <summary>The web <c>heatBadgeVariant</c> helper.</summary>
    public static StatusKind HeatVariant(int level) => level switch
    {
        <= 0 => StatusKind.Neutral,
        1 => StatusKind.Info,
        2 => StatusKind.Warning,
        _ => StatusKind.Danger,
    };

    /// <summary>The web <c>comfortScore</c> memo: max(0, 100 - |inside - target| * 10), or null when unavailable.</summary>
    public static double? ComfortScore(double? insideC, double? targetC)
    {
        if (insideC is not { } inside || targetC is not { } target)
        {
            return null;
        }

        return Math.Max(0, 100 - (Math.Abs(inside - target) * 10));
    }

    private static ClimateControlState SelectState(ClimateControlModel model)
    {
        if (!string.IsNullOrEmpty(model.ErrorDetail))
        {
            return ClimateControlState.Error;
        }

        if (model.Loading)
        {
            return ClimateControlState.Loading;
        }

        return model.Snapshot.HasData ? ClimateControlState.Success : ClimateControlState.Empty;
    }

    private static ClimateChip BuildHvacStatusChip(ClimateReading? latest, Func<string, string> t) =>
        latest?.IsAcOn == true
            ? new ClimateChip(t("Active"), StatusKind.Success)
            : new ClimateChip(t("Off"), StatusKind.Neutral);

    private static ClimateChip BuildComfortChip(ClimateReading? latest, Func<string, string> t) =>
        ComfortBadge(latest?.InsideTempC, latest?.DriverTempSettingC, t);

    private static List<ClimateChip> BuildBannerChips(ClimateSnapshot snapshot, Func<string, string> t)
    {
        var latest = snapshot.Latest;
        var chips = new List<ClimateChip>(4);

        if (!string.IsNullOrEmpty(latest?.ClimateKeeperMode) && latest!.ClimateKeeperMode != "Off")
        {
            chips.Add(new ClimateChip(t(KeeperLabel(latest.ClimateKeeperMode)), KeeperVariant(latest.ClimateKeeperMode), Dot: true));
        }

        if (!string.IsNullOrEmpty(latest?.DefrostMode) && latest!.DefrostMode != "Off")
        {
            string suffix = latest.DefrostMode != "Normal" ? $" ({latest.DefrostMode})" : string.Empty;
            chips.Add(new ClimateChip($"{t("Defrost")}{suffix}", StatusKind.Info, Dot: true));
        }

        if (latest?.BatteryHeater == true)
        {
            chips.Add(new ClimateChip(t("Battery Heater"), StatusKind.Warning, Dot: true));
        }

        if (snapshot.NotEnoughPowerToHeat)
        {
            chips.Add(new ClimateChip(t("Insufficient Power to Heat"), StatusKind.Danger, Dot: true));
        }

        return chips;
    }

    private static IReadOnlyList<ClimateGaugeDisplay> BuildGauges(ClimateReading? latest, UnitPref pref, Func<string, string> t)
    {
        double max = pref.Temperature == TemperatureUnit.Fahrenheit ? 131 : 55;
        string unit = UnitLabels.Label(pref.Temperature);

        return
        [
            Gauge(t("Inside Temp"), latest?.InsideTempC, max, unit, pref),
            Gauge(t("Outside Temp"), latest?.OutsideTempC, max, unit, pref),
            Gauge(t("Driver Set Temp"), latest?.DriverTempSettingC, max, unit, pref),
        ];
    }

    private static ClimateGaugeDisplay Gauge(string label, double? celsius, double max, string unit, UnitPref pref)
    {
        if (celsius is not { } c)
        {
            return new ClimateGaugeDisplay(label, HasValue: false, 0, max, unit, UnitFormatters.DefaultEmptyDisplay);
        }

        double display = UnitConverters.TemperatureFromSi(c, pref.Temperature);
        return new ClimateGaugeDisplay(label, HasValue: true, display, max, unit, UnitFormatters.FormatTemperature(c, pref));
    }

    private static List<ClimateCard> BuildStatusCards(ClimateReading? latest, Func<string, string> t)
    {
        string on = t("On");
        string off = t("Off");
        var cards = new List<ClimateCard>(13)
        {
            // HVAC-Power
            new(
                t("HVAC Power"),
                latest?.IsAcOn == true ? on : off,
                string.IsNullOrEmpty(latest?.HvacPower) ? null : $"{t("State")}: {latest!.HvacPower}",
                AccentCyan),
            // Auto-Conditioning
            new(
                t("Auto Conditioning"),
                !string.IsNullOrEmpty(latest?.HvacAutoMode) && latest!.HvacAutoMode != "Off" ? on : off,
                null,
                AccentInfo),
            // Climate-Keeper
            new(
                t("Climate Keeper"),
                t(KeeperLabel(latest?.ClimateKeeperMode)),
                !string.IsNullOrEmpty(latest?.ClimateKeeperMode) && latest!.ClimateKeeperMode != "Off" ? t("Active") : null,
                AccentWarning),
            // Fan-Speed
            new(
                t("Fan Speed"),
                FormatLevel(latest?.FanSpeed),
                $"{t("Level")} 0–10",
                AccentCyan),
            // Fan-Status
            new(
                t("Fan Status"),
                latest?.HvacFanStatus is { } fs ? (fs > 0 ? t("Running") : t("Idle")) : UnitFormatters.DefaultEmptyDisplay,
                latest?.HvacFanStatus is { } code ? $"{t("Code")} {FormatLevel(code)}" : null,
                AccentCyan),
            // Steering-Wheel-Heater
            new(
                t("Steering Wheel Heater"),
                latest?.HvacSteeringWheelHeatLevel is { } sl && sl > 0 ? on : off,
                null,
                AccentWarning),
            // Steering-Wheel-Heat-Level
            new(
                t("Steering Wheel Heat Level"),
                latest?.HvacSteeringWheelHeatLevel is { } lvl ? t(HeatLabel(lvl)) : UnitFormatters.DefaultEmptyDisplay,
                latest?.HvacSteeringWheelHeatLevel is { } n ? $"{t("Level")} {n.ToString(CultureInfo.InvariantCulture)}" : null,
                AccentWarning),
            // Steering-Wheel-Heat-Auto
            new(
                t("Steering Wheel Heat Auto"),
                latest?.HvacSteeringWheelHeatAuto is { } auto ? (auto ? t("Auto") : t("Manual")) : UnitFormatters.DefaultEmptyDisplay,
                null,
                AccentWarning),
            // Defrost-Mode
            new(
                t("Defrost Mode"),
                !string.IsNullOrEmpty(latest?.DefrostMode) && latest!.DefrostMode != "Off" ? latest.DefrostMode! : off,
                null,
                AccentInfo),
            // Defrost-for-Preconditioning
            new(
                t("Defrost for Preconditioning"),
                latest?.DefrostForPreconditioning is { } pre ? (pre ? t("Active") : t("Inactive")) : UnitFormatters.DefaultEmptyDisplay,
                latest?.DefrostForPreconditioning == true ? t("Clearing windshield before drive") : null,
                AccentCyan),
            // Rear-Defrost
            new(
                t("Rear Defrost"),
                latest?.RearDefrostEnabled is { } rd ? (rd ? on : off) : UnitFormatters.DefaultEmptyDisplay,
                latest?.RearDefrostEnabled == true ? t("Clearing rear window") : null,
                AccentInfo),
            // Wiper-Heater
            new(
                t("Wiper Heater"),
                latest?.WiperHeatEnabled is { } wh ? (wh ? on : off) : UnitFormatters.DefaultEmptyDisplay,
                latest?.WiperHeatEnabled == true ? t("Heating windshield wipers") : null,
                AccentWarning),
            // Rear-Display-HVAC
            new(
                t("Rear Display HVAC"),
                latest?.RearDisplayHvacEnabled is { } rh ? (rh ? t("Enabled") : t("Disabled")) : UnitFormatters.DefaultEmptyDisplay,
                latest?.RearDisplayHvacEnabled == true ? t("Rear passengers can control HVAC") : null,
                AccentCyan),
        };

        return cards;
    }

    private static IReadOnlyList<ClimateCard> BuildProtectionCards(ClimateReading? latest, UnitPref pref, Func<string, string> t) =>
    [
        new(t("Overheat Protection"), string.IsNullOrEmpty(latest?.OverheatProtection) ? t("Unknown") : latest!.OverheatProtection!, null, AccentGreen),
        new(t("Overheat Temp Limit"), string.IsNullOrEmpty(latest?.CabinOverheatProtectionTempLimit) ? UnitFormatters.DefaultEmptyDisplay : latest!.CabinOverheatProtectionTempLimit!, null, AccentWarning),
        new(t("Battery Heater"), latest?.BatteryHeater == true ? t("On") : t("Off"), null, AccentWarning),
        new(t("Passenger Setting"), latest?.PassengerTempSettingC is { } p ? UnitFormatters.FormatTemperature(p, pref) : UnitFormatters.DefaultEmptyDisplay, null, AccentPurple),
    ];

    private static IReadOnlyList<ClimateComfortTile> BuildComfortTiles(ClimateReading? latest, Func<string, string> t)
    {
        double? score = ComfortScore(latest?.InsideTempC, latest?.DriverTempSettingC);
        double? delta = latest?.InsideTempC is { } inside && latest.DriverTempSettingC is { } target
            ? Math.Round(inside - target, 1)
            : null;
        var comfort = ComfortBadge(latest?.InsideTempC, latest?.DriverTempSettingC, t);

        var scoreTile = new ClimateComfortTile(
            t("Comfort Score"),
            score is { } s ? ((int)Math.Round(s, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture) : UnitFormatters.DefaultEmptyDisplay,
            score switch
            {
                >= 80 => t("Excellent"),
                >= 50 => t("Moderate"),
                null => t("Poor"),
                _ => t("Poor"),
            },
            score switch
            {
                >= 80 => StatusKind.Success,
                >= 50 => StatusKind.Warning,
                _ => StatusKind.Danger,
            },
            FlameGlyph);

        var deltaTile = new ClimateComfortTile(
            t("Temp Delta"),
            delta is { } d ? $"{(d > 0 ? "+" : string.Empty)}{d.ToString("0.#", CultureInfo.InvariantCulture)}" : UnitFormatters.DefaultEmptyDisplay,
            delta switch
            {
                null => t("N/A"),
                { } v when Math.Abs(v) <= 1 => t("Near Target"),
                { } v when v > 0 => t("Above Target"),
                _ => t("Below Target"),
            },
            delta switch
            {
                null => StatusKind.Neutral,
                { } v when Math.Abs(v) <= 1 => StatusKind.Success,
                { } v when Math.Abs(v) <= 3 => StatusKind.Warning,
                _ => StatusKind.Danger,
            },
            FlameGlyph);

        var statusTile = new ClimateComfortTile(
            t("Status"),
            string.Empty,
            delta switch
            {
                { } v when v > 2 => t("Too Warm"),
                { } v when v < -2 => t("Too Cold"),
                _ => t("Comfortable"),
            },
            comfort.Variant,
            delta switch
            {
                { } v when v > 2 => SunGlyph,
                { } v when v < -2 => SnowGlyph,
                _ => WindGlyph,
            });

        return [scoreTile, deltaTile, statusTile];
    }

    private static IReadOnlyList<ClimateCard> BuildEfficiencyCards(
        ClimateReading? latest,
        IReadOnlyList<ClimateHistoryRow> history,
        Func<string, string> t)
    {
        double? avgFan = null;
        double? peakFan = null;
        double? acOnPct = null;

        if (history.Count > 0)
        {
            var speeds = new List<double>(history.Count);
            int acOn = 0;
            foreach (var row in history)
            {
                if (row.FanSpeed is { } f && f > 0)
                {
                    speeds.Add(f);
                }

                if (row.IsAcOn == true)
                {
                    acOn++;
                }
            }

            if (speeds.Count > 0)
            {
                double sum = 0;
                peakFan = double.MinValue;
                foreach (var speed in speeds)
                {
                    sum += speed;
                    peakFan = Math.Max(peakFan.Value, speed);
                }

                avgFan = sum / speeds.Count;
                acOnPct = acOn / (double)history.Count * 100;
            }
        }

        double? score = ComfortScore(latest?.InsideTempC, latest?.DriverTempSettingC);
        string levelRange = t("Level 0-10");

        return
        [
            new(t("Avg Fan Speed"), avgFan is { } a ? a.ToString("0.0", CultureInfo.InvariantCulture) : UnitFormatters.DefaultEmptyDisplay, levelRange, AccentCyan),
            new(t("Peak Fan Speed"), peakFan is { } p ? p.ToString("0.0", CultureInfo.InvariantCulture) : UnitFormatters.DefaultEmptyDisplay, levelRange, AccentPurple),
            new(t("AC On Time"), acOnPct is { } pct ? $"{(int)Math.Round(pct, MidpointRounding.AwayFromZero)}%" : UnitFormatters.DefaultEmptyDisplay, t("of samples"), AccentWarning),
            new(t("Comfort Score"), score is { } s ? $"{(int)Math.Round(s, MidpointRounding.AwayFromZero)}%" : UnitFormatters.DefaultEmptyDisplay, null, AccentGreen),
        ];
    }

    private static IReadOnlyList<ClimateSeatTile> BuildFrontSeats(ClimateReading? latest, Func<string, string> t) =>
    [
        SeatTile("Front Left", latest?.SeatHeaterLeft ?? 0, t),
        SeatTile("Front Right", latest?.SeatHeaterRight ?? 0, t),
    ];

    private static IReadOnlyList<ClimateSeatTile> BuildRearSeats(ClimateReading? latest, Func<string, string> t) =>
    [
        SeatTile("Rear Left", latest?.SeatHeaterRearLeft ?? 0, t),
        SeatTile("Rear Center", latest?.SeatHeaterRearCenter ?? 0, t),
        SeatTile("Rear Right", latest?.SeatHeaterRearRight ?? 0, t),
    ];

    private static ClimateSeatTile SeatTile(string label, int level, Func<string, string> t)
    {
        int clamped = Math.Clamp(level, 0, 3);
        string badge = $"{t(HeatLabel(clamped))} ({clamped}/3)";
        return new ClimateSeatTile(t(label), badge, HeatVariant(clamped), FlameGlyph, HasBadge: true);
    }

    private static IReadOnlyList<ClimateSeatTile> BuildCoolingSeats(ClimateReading? latest, Func<string, string> t) =>
    [
        CoolingTile("Front Left", latest?.ClimateSeatCoolingFrontLeft, t),
        CoolingTile("Front Right", latest?.ClimateSeatCoolingFrontRight, t),
    ];

    private static ClimateSeatTile CoolingTile(string label, int? level, Func<string, string> t)
    {
        if (level is not { } lvl)
        {
            return new ClimateSeatTile(t(label), UnitFormatters.DefaultEmptyDisplay, StatusKind.Neutral, SnowGlyph, HasBadge: false);
        }

        int clamped = Math.Clamp(lvl, 0, 3);
        string badge = $"{t(HeatLabel(clamped))} ({clamped}/3)";
        return new ClimateSeatTile(t(label), badge, clamped <= 0 ? StatusKind.Neutral : StatusKind.Info, SnowGlyph, HasBadge: true);
    }

    private static ClimateChip BuildAutoSeatChip(bool? value, Func<string, string> t) =>
        value is { } v
            ? new ClimateChip(v ? t("Auto") : t("Manual"), v ? StatusKind.Success : StatusKind.Neutral)
            : new ClimateChip(UnitFormatters.DefaultEmptyDisplay, StatusKind.Neutral);

    private static ClimateChip BuildSeatVentChip(bool? value, Func<string, string> t)
    {
        string vent = t("Ventilation");
        return value is { } v
            ? new ClimateChip($"{vent}: {(v ? t("On") : t("Off"))}", v ? StatusKind.Success : StatusKind.Neutral)
            : new ClimateChip($"{vent}: {UnitFormatters.DefaultEmptyDisplay}", StatusKind.Neutral);
    }

    private static IReadOnlyList<ClimateLegendItem> BuildSeatLegend(Func<string, string> t) =>
    [
        new($"0 — {t("Off")}", FlameGlyph),
        new($"1 — {t("Low")}", FlameGlyph),
        new($"2 — {t("Medium")}", FlameGlyph),
        new($"3 — {t("High")}", FlameGlyph),
    ];

    private static List<ClimateHistoryRow> Chronological(IReadOnlyList<ClimateHistoryRow> history)
    {
        var ordered = new List<ClimateHistoryRow>(history);
        ordered.Sort((a, b) => Nullable.Compare(a.Timestamp, b.Timestamp));
        return ordered;
    }

    private static List<ChartSeries> BuildTempHistorySeries(IReadOnlyList<ClimateHistoryRow> history, UnitPref pref, Func<string, string> t)
    {
        if (history.Count == 0)
        {
            return [];
        }

        var rows = Chronological(history);
        var inside = new List<ChartPoint>(rows.Count);
        var outside = new List<ChartPoint>(rows.Count);
        var driver = new List<ChartPoint>(rows.Count);

        for (int i = 0; i < rows.Count; i++)
        {
            string label = TimeLabel(rows[i].Timestamp);
            if (rows[i].InsideTempC is { } a)
            {
                inside.Add(new ChartPoint(i, UnitConverters.TemperatureFromSi(a, pref.Temperature), label));
            }

            if (rows[i].OutsideTempC is { } b)
            {
                outside.Add(new ChartPoint(i, UnitConverters.TemperatureFromSi(b, pref.Temperature), label));
            }

            if (rows[i].DriverTempSettingC is { } c)
            {
                driver.Add(new ChartPoint(i, UnitConverters.TemperatureFromSi(c, pref.Temperature), label));
            }
        }

        string unit = UnitLabels.Label(pref.Temperature);
        var series = new List<ChartSeries>(3);
        if (inside.Count > 0)
        {
            series.Add(new ChartSeries(t("Inside Temp"), inside) { Kind = ChartSeriesKind.Line, Role = ChartRole.Temperature, Unit = unit });
        }

        if (outside.Count > 0)
        {
            series.Add(new ChartSeries(t("Outside Temp"), outside) { Kind = ChartSeriesKind.Line, ColorIndex = 1, Unit = unit });
        }

        if (driver.Count > 0)
        {
            series.Add(new ChartSeries(t("Driver Set Temp"), driver) { Kind = ChartSeriesKind.Line, ColorIndex = 2, Unit = unit });
        }

        return series;
    }

    private static List<ChartSeries> BuildAcFanSeries(IReadOnlyList<ClimateHistoryRow> history, Func<string, string> t)
    {
        if (history.Count == 0)
        {
            return [];
        }

        var rows = Chronological(history);
        var ac = new List<ChartPoint>(rows.Count);
        var fan = new List<ChartPoint>(rows.Count);

        for (int i = 0; i < rows.Count; i++)
        {
            string label = TimeLabel(rows[i].Timestamp);
            ac.Add(new ChartPoint(i, rows[i].IsAcOn == true ? 1 : 0, label));
            if (rows[i].FanSpeed is { } f)
            {
                fan.Add(new ChartPoint(i, f, label));
            }
        }

        var series = new List<ChartSeries>(2)
        {
            new(t("AC On/Off"), ac) { Kind = ChartSeriesKind.Area, Role = ChartRole.Temperature },
        };

        if (fan.Count > 0)
        {
            series.Add(new ChartSeries(t("Fan Speed"), fan) { Kind = ChartSeriesKind.Line, ColorIndex = 3 });
        }

        return series;
    }

    private static IReadOnlyList<string> BuildHistoryColumns(UnitPref pref, Func<string, string> t)
    {
        string unit = UnitLabels.Label(pref.Temperature);
        return
        [
            t("Time"),
            $"{t("Inside")} {unit}",
            $"{t("Outside")} {unit}",
            $"{t("Set Temp")} {unit}",
            t("Fan"),
            t("HVAC"),
            t("Climate Keeper"),
        ];
    }

    private static List<ClimateTableRowDisplay> BuildHistoryRows(IReadOnlyList<ClimateHistoryRow> history, UnitPref pref, Func<string, string> t)
    {
        if (history.Count == 0)
        {
            return [];
        }

        // Web default sort: newest-first.
        var rows = new List<ClimateHistoryRow>(history);
        rows.Sort((a, b) => Nullable.Compare(b.Timestamp, a.Timestamp));

        string dash = UnitFormatters.DefaultEmptyDisplay;
        var display = new List<ClimateTableRowDisplay>(rows.Count);
        foreach (var row in rows)
        {
            display.Add(new ClimateTableRowDisplay(
                row.Id,
                row.Timestamp is { } ts ? ts.ToString("yyyy-MM-dd HH:mm", CultureInfo.InvariantCulture) : dash,
                row.InsideTempC is { } i ? UnitFormatters.FormatTemperature(i, pref) : dash,
                row.OutsideTempC is { } o ? UnitFormatters.FormatTemperature(o, pref) : dash,
                row.DriverTempSettingC is { } s ? UnitFormatters.FormatTemperature(s, pref) : dash,
                row.FanSpeed is { } f ? FormatLevel(f) : dash,
                row.IsAcOn == true ? t("On") : t("Off"),
                t(KeeperLabel(row.ClimateKeeperMode))));
        }

        return display;
    }

    private static string TimeLabel(DateTimeOffset? ts) =>
        ts is { } v ? v.ToString("HH:mm", CultureInfo.InvariantCulture) : string.Empty;

    private static string FormatLevel(double? value) =>
        value is { } v ? ((int)Math.Round(v, MidpointRounding.AwayFromZero)).ToString(CultureInfo.InvariantCulture) : "0";
}

/// <summary>
/// Canonical navigation + diagnostics metadata for the Climate-Control page — the native mirror of the web page at
/// web/src/features/vehicle-systems/pages/ClimateControlPage.tsx (route <c>/climate</c>, nav name
/// <c>ClimateControl</c>). The page reads the same three sources the web hooks read: <c>useClimate</c>
/// (<see cref="LatestOperation"/>), <c>useClimateHistory</c> (<see cref="HistoryOperation"/>) and
/// <c>useChargingTelemetryLatest</c> (<see cref="ChargingTelemetryOperation"/>).
/// </summary>
public static class ClimateControlRegistration
{
    /// <summary>The navigation route name the shell registers this page under (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "ClimateControl";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "ClimateControlPage";

    /// <summary>The generated climate-latest operation the page's client feed reads (web <c>useClimate</c>).</summary>
    public const string LatestOperation = Operations.Climate.Latest;

    /// <summary>The generated climate-history operation the page's client feed reads (web <c>useClimateHistory</c>).</summary>
    public const string HistoryOperation = Operations.Climate.History;

    /// <summary>The generated charging-telemetry-latest operation (web <c>useChargingTelemetryLatest</c>).</summary>
    public const string ChargingTelemetryOperation = Operations.Charging.TelemetryLatest;

    /// <summary>The empty-surface glyph (Segoe Fluent — thermometer).</summary>
    public const string EmptyGlyph = "\uE9CA";

    /// <summary>The localized page title (web <c>t('Climate Control')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("translation.Climate Control", "Climate Control");
    }
}

/// <summary>
/// PII-safe diagnostics for the Climate-Control page (P1/S11 diagnostics contract). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a temperature, set-point or vehicle id — so a diagnostics
/// line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class ClimateControlDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public ClimateControlDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ClimateControlPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ClimateControlRegistration.Slug}");
    }
}
