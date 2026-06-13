using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The four safety ADAS enum fields whose raw <c>signal.SignalValue</c> the backend serializes verbatim through
/// <c>/safety/latest</c> and <c>/safety</c>. Each can arrive as a native boolean, a number, the typed enum string
/// or the codec-stripped suffix — see the web choke point at web/src/lib/SafetyEnumClassifier.ts. The prefix is stripped for
/// legacy rows.
/// </summary>
public enum SafetyEnumField
{
    /// <summary><c>forward_collision_warning</c> (prefix <c>ForwardCollisionSensitivity</c>).</summary>
    ForwardCollisionWarning,

    /// <summary><c>lane_departure_avoidance</c> (prefix <c>LaneAssistLevel</c>).</summary>
    LaneDepartureAvoidance,

    /// <summary><c>speed_limit_warning</c> (prefix <c>SpeedAssistLevel</c>).</summary>
    SpeedLimitWarning,

    /// <summary><c>cruise_follow_distance</c> (prefix <c>FollowDistance</c>).</summary>
    CruiseFollowDistance,
}

/// <summary>The runtime shape a raw safety-enum value arrived in (the web typeof bool / number / string switch).</summary>
public enum SafetyValueKind
{
    /// <summary>Absent / null — the feature is unknown (web <c>fallback</c>).</summary>
    None,

    /// <summary>A native boolean toggle.</summary>
    Bool,

    /// <summary>A numeric level (legacy signal_log rows).</summary>
    Number,

    /// <summary>The typed (possibly prefixed) enum string.</summary>
    Text,
}

/// <summary>
/// A single raw safety-enum value preserved in the runtime shape it arrived in, so the projection can clean / classify
/// it exactly like the web <c>cleanSafetyEnum</c> / <c>isSafetyEnumActive</c> choke point (never coercing a boolean
/// through <c>String()</c>). Carried on the snapshot so localization (On / Off) happens only at the display boundary.
/// </summary>
public readonly record struct SafetyRawValue(SafetyValueKind Kind, bool Bool, double Number, string Text)
{
    /// <summary>The absent value (web null → fallback).</summary>
    public static SafetyRawValue None => new(SafetyValueKind.None, false, 0, string.Empty);

    /// <summary>Read a tolerant raw enum value from a JSON property (bool / number / string / absent).</summary>
    public static SafetyRawValue Read(JsonElement parent, string name)
    {
        if (parent.ValueKind != JsonValueKind.Object || !parent.TryGetProperty(name, out var v))
        {
            return None;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => new SafetyRawValue(SafetyValueKind.Bool, true, 0, string.Empty),
            JsonValueKind.False => new SafetyRawValue(SafetyValueKind.Bool, false, 0, string.Empty),
            JsonValueKind.Number when v.TryGetDouble(out var n) => new SafetyRawValue(SafetyValueKind.Number, false, n, string.Empty),
            JsonValueKind.String when v.GetString() is { Length: > 0 } str => new SafetyRawValue(SafetyValueKind.Text, false, 0, str),
            _ => None,
        };
    }
}

/// <summary>
/// The prefix-stripping + active classification choke point — the native 1:1 port of web/src/lib/SafetyEnumClassifier.ts. Every
/// renderer funnels a <see cref="SafetyRawValue"/> through here so a boolean is never coerced via <c>String()</c> and
/// the on / off / none / disabled / 0 set is classified in exactly one place.
/// </summary>
public static class SafetyEnumClassifier
{
    private static string Prefix(SafetyEnumField field) => field switch
    {
        SafetyEnumField.ForwardCollisionWarning => "ForwardCollisionSensitivity",
        SafetyEnumField.LaneDepartureAvoidance => "LaneAssistLevel",
        SafetyEnumField.SpeedLimitWarning => "SpeedAssistLevel",
        SafetyEnumField.CruiseFollowDistance => "FollowDistance",
        _ => string.Empty,
    };

    /// <summary>Human-renderable, prefix-stripped value (web <c>cleanSafetyEnum</c>); booleans render via On / Off.</summary>
    public static string Clean(SafetyRawValue value, SafetyEnumField field, string onText, string offText, string fallback)
    {
        switch (value.Kind)
        {
            case SafetyValueKind.Bool:
                return value.Bool ? onText : offText;
            case SafetyValueKind.Number:
                return value.Number.ToString("0.######", CultureInfo.InvariantCulture);
            case SafetyValueKind.Text:
                break;
            default:
                return fallback;
        }

        string raw = value.Text;
        if (raw.Length == 0)
        {
            return fallback;
        }

        string prefix = Prefix(field);
        if (prefix.Length > 0 && raw.StartsWith(prefix, StringComparison.Ordinal))
        {
            string stripped = raw[prefix.Length..];
            if (field == SafetyEnumField.SpeedLimitWarning && stripped == "None")
            {
                return offText;
            }

            return stripped.Length > 0 ? stripped : raw;
        }

        return raw;
    }

    /// <summary>Whether the value represents an ENABLED feature (web <c>isSafetyEnumActive</c>).</summary>
    public static bool IsActive(SafetyRawValue value, SafetyEnumField field)
    {
        switch (value.Kind)
        {
            case SafetyValueKind.None:
                return false;
            case SafetyValueKind.Bool:
                return value.Bool;
        }

        // Clean with neutral On/Off so the classification matches the web lowercase comparison exactly.
        string cleaned = Clean(value, field, "On", "Off", string.Empty);
        if (cleaned.Length == 0)
        {
            return false;
        }

        string lower = cleaned.ToLowerInvariant();
        return lower is not ("off" or "none" or "disabled" or "0");
    }
}

/// <summary>
/// One safety snapshot row from <c>GET /safety/latest</c> / <c>GET /safety</c> (web <c>SafetySnapshot</c>). AEB uses
/// inverted logic (<c>automatic_emergency_braking_off == false</c> means the feature IS on). The distance fields keep
/// their legacy <c>miles_since_reset</c> JSON names but already hold SI metres (Phase-42), converted at the render
/// boundary. Parsing is null-tolerant so a partial row never throws.
/// </summary>
public sealed record SafetySnapshot(
    long? Id,
    bool AutomaticEmergencyBrakingOff,
    bool BlindSpotCamera,
    bool BlindSpotCollisionWarning,
    bool EmergencyLaneDepartureAvoidance,
    bool PinToDrive,
    SafetyRawValue ForwardCollisionWarning,
    SafetyRawValue LaneDepartureAvoidance,
    SafetyRawValue SpeedLimitWarning,
    SafetyRawValue CruiseFollowDistance,
    double? MilesSinceResetMeters,
    double? SelfDrivingMilesSinceResetMeters,
    DateTimeOffset? CreatedAt)
{
    /// <summary>The web <c>TOTAL_FEATURES</c> constant — nine tracked ADAS toggles.</summary>
    public const int TotalFeatures = 9;

    /// <summary>AEB is on when its <c>off</c> flag is false (web <c>isAebEnabled</c>).</summary>
    public bool AebEnabled => !AutomaticEmergencyBrakingOff;

    /// <summary>The nine boolean feature states in web <c>boolFeatures</c> order.</summary>
    public IReadOnlyList<bool> FeatureFlags =>
    [
        AebEnabled,
        BlindSpotCamera,
        BlindSpotCollisionWarning,
        EmergencyLaneDepartureAvoidance,
        PinToDrive,
        SafetyEnumClassifier.IsActive(ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning),
        SafetyEnumClassifier.IsActive(LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance),
        SafetyEnumClassifier.IsActive(SpeedLimitWarning, SafetyEnumField.SpeedLimitWarning),
        SafetyEnumClassifier.IsActive(CruiseFollowDistance, SafetyEnumField.CruiseFollowDistance),
    ];

    /// <summary>Count of enabled features (web <c>enabledCount</c>).</summary>
    public int EnabledCount
    {
        get
        {
            int count = 0;
            foreach (bool flag in FeatureFlags)
            {
                if (flag)
                {
                    count++;
                }
            }

            return count;
        }
    }

    /// <summary>Project a single safety JSON object into a tolerant snapshot.</summary>
    public static SafetySnapshot FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return new SafetySnapshot(
                null, false, false, false, false, false,
                SafetyRawValue.None, SafetyRawValue.None, SafetyRawValue.None, SafetyRawValue.None,
                null, null, null);
        }

        return new SafetySnapshot(
            Id: SafetyJson.Long(element, "id"),
            AutomaticEmergencyBrakingOff: SafetyJson.Bool(element, "automatic_emergency_braking_off"),
            BlindSpotCamera: SafetyJson.Bool(element, "automatic_blind_spot_camera"),
            BlindSpotCollisionWarning: SafetyJson.Bool(element, "blind_spot_collision_warning"),
            EmergencyLaneDepartureAvoidance: SafetyJson.Bool(element, "emergency_lane_departure_avoidance"),
            PinToDrive: SafetyJson.Bool(element, "pin_to_drive_enabled"),
            ForwardCollisionWarning: SafetyRawValue.Read(element, "forward_collision_warning"),
            LaneDepartureAvoidance: SafetyRawValue.Read(element, "lane_departure_avoidance"),
            SpeedLimitWarning: SafetyRawValue.Read(element, "speed_limit_warning"),
            CruiseFollowDistance: SafetyRawValue.Read(element, "cruise_follow_distance"),
            MilesSinceResetMeters: SafetyJson.Double(element, "miles_since_reset"),
            SelfDrivingMilesSinceResetMeters: SafetyJson.Double(element, "self_driving_miles_since_reset"),
            CreatedAt: SafetyJson.Date(element, "created_at"));
    }
}

/// <summary>
/// The live security signals slice from <c>GET /security/latest</c> (web <c>useSecurityLatest</c>) the Live Safety
/// Signals row binds to. Each flag is nullable so the web's "—" rendering survives a missing field. A null parse models
/// the web query returning no object.
/// </summary>
public sealed record SecuritySafetySnapshot(
    bool? DriverSeatBelt,
    bool? PassengerSeatBelt,
    bool? DriverSeatOccupied,
    bool? Locked)
{
    /// <summary>Project the security JSON object into a tolerant snapshot, or null when the body is not an object.</summary>
    public static SecuritySafetySnapshot? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SecuritySafetySnapshot(
            DriverSeatBelt: SafetyJson.NullableBool(element, "driver_seat_belt"),
            PassengerSeatBelt: SafetyJson.NullableBool(element, "passenger_seat_belt"),
            DriverSeatOccupied: SafetyJson.NullableBool(element, "driver_seat_occupied"),
            Locked: SafetyJson.NullableBool(element, "locked"));
    }
}

/// <summary>
/// The composed three-read snapshot the page binds to: the latest safety row (web <c>useQuery /safety/latest</c>, the
/// primary read whose absence is the empty surface), the safety history (web <c>/safety?limit=100</c>, the chart + table)
/// and the live security signals (web <c>useSecurityLatest</c>). Mirrors the web page's three independent queries.
/// </summary>
public sealed record SafetySettingsSnapshot(
    SafetySnapshot? Latest,
    IReadOnlyList<SafetySnapshot> History,
    SecuritySafetySnapshot? Security)
{
    /// <summary>The empty snapshot (every read disabled / unresolved).</summary>
    public static SafetySettingsSnapshot Empty { get; } =
        new(null, Array.Empty<SafetySnapshot>(), null);

    /// <summary>True once the primary safety read resolved an object (web <c>latest</c> truthy).</summary>
    public bool HasData => Latest is not null;

    /// <summary>Compose the three reads into one snapshot.</summary>
    public static SafetySettingsSnapshot Compose(
        SafetySnapshot? latest,
        IReadOnlyList<SafetySnapshot>? history,
        SecuritySafetySnapshot? security) =>
        new(latest, history ?? Array.Empty<SafetySnapshot>(), security);
}

/// <summary>The data port the page's view-model binds to (P1/S8 state-holder seam).</summary>
public interface ISafetySettingsFeed
{
    /// <summary>Fetch the latest safety row, the safety history and the live security signals for the active vehicle.</summary>
    Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken);
}

/// <summary>The default feed used by the shell registration: always resolves to the empty surface.</summary>
public sealed class EmptySafetySettingsFeed : ISafetySettingsFeed
{
    /// <summary>The shared singleton instance.</summary>
    public static EmptySafetySettingsFeed Instance { get; } = new();

    private EmptySafetySettingsFeed()
    {
    }

    /// <inheritdoc />
    public Task<SafetySettingsSnapshot> FetchAsync(CancellationToken cancellationToken) =>
        Task.FromResult(SafetySettingsSnapshot.Empty);
}

/// <summary>The mutually-exclusive top-level data state the page renders (web loading / empty / error / success).</summary>
public enum SafetySettingsState
{
    /// <summary>The primary safety query is in flight with no data yet — the loading shimmer.</summary>
    Loading,

    /// <summary>Resolved with no latest safety object — the friendly empty surface, never a blank page.</summary>
    Empty,

    /// <summary>The primary safety query failed — the retriable error surface.</summary>
    Error,

    /// <summary>The latest safety row resolved — every section renders (each with its own empty fallback).</summary>
    Success,
}

/// <summary>One colored summary metric tile (web <c>MetricCard</c>): label + value + accent.</summary>
public sealed record SafetyMetricDisplay(string Label, string Value, string AccentBrushKey, string AutomationName);

/// <summary>One Live Safety Signals tile (web <c>SignalCard</c>): glyph + value + label, tinted by polarity.</summary>
public sealed record SafetySignalDisplay(string Label, string Value, string Glyph, StatusKind? Tone, string AutomationName);

/// <summary>One Driving Statistics tile (web <c>MetricCard</c> with icon + subtitle).</summary>
public sealed record SafetyStatDisplay(string Label, string Value, string Sublabel, string Glyph, string AutomationName);

/// <summary>One ADAS feature card (web <c>SafetyCard</c>): label + description + enabled flag + value text.</summary>
public sealed record SafetyFeatureDisplay(string Key, string Label, string Description, bool Enabled, string ValueText, string AutomationName);

/// <summary>One Safety-States-Over-Time chart series (web step <c>Line</c>): name + palette index + points.</summary>
public sealed record SafetyChartSeriesDisplay(string Name, int ColorIndex, IReadOnlyList<ChartPoint> Points);

/// <summary>One history table column (web <c>Column</c>): key + header + numeric flag.</summary>
public sealed record SafetyHistoryColumnDisplay(string Key, string Header, bool IsNumeric);

/// <summary>One history table row (web <c>SafetySnapshot</c> row), every cell pre-formatted to its display string.</summary>
public sealed record SafetyHistoryRowDisplay(
    string Id,
    string Time,
    string Aeb,
    string Bsc,
    string Bscw,
    string Fcw,
    string Lda,
    string Elda,
    string Cfd,
    string Slw,
    string Pin);

/// <summary>
/// The render-ready projection the view binds to — every label resolved, every value formatted, every section assembled
/// with its own empty fallback so a region is never blank. No WinUI types: unit-tested without a UI host.
/// </summary>
public sealed record SafetySettingsDisplay(
    SafetySettingsState State,
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
    double GaugeValue,
    double GaugeMax,
    string GaugeLabel,
    string GaugeUnit,
    int GaugeColorIndex,
    string EnabledBadgeText,
    StatusKind EnabledBadgeStatus,
    IReadOnlyList<SafetyMetricDisplay> SummaryMetrics,
    string LiveSignalsTitle,
    IReadOnlyList<SafetySignalDisplay> SignalCards,
    string DrivingStatsTitle,
    IReadOnlyList<SafetyStatDisplay> DrivingStats,
    string AdasTitle,
    IReadOnlyList<SafetyFeatureDisplay> FeatureCards,
    string ChartTitle,
    ChartState ChartState,
    string ChartEmptyMessage,
    string ChartAccessibleSummary,
    IReadOnlyList<SafetyChartSeriesDisplay> ChartSeries,
    string HistoryTitle,
    string HistoryEmptyMessage,
    IReadOnlyList<SafetyHistoryColumnDisplay> HistoryColumns,
    IReadOnlyList<SafetyHistoryRowDisplay> HistoryRows,
    string AutomationName);

/// <summary>The page's input to the projection: the composed snapshot plus the two lifecycle flags.</summary>
public sealed record SafetySettingsModel(SafetySettingsSnapshot Snapshot, bool Loading, string? ErrorDetail)
{
    /// <summary>The initial pre-fetch model (loading, no data, no error).</summary>
    public static SafetySettingsModel Initial { get; } = new(SafetySettingsSnapshot.Empty, true, null);
}

/// <summary>
/// Every visible literal the page resolves, each through a single keyed call site (the web <c>t(...)</c> key names,
/// verbatim) so the resource keys are asserted in tests and resolved for real in the app.
/// </summary>
public sealed record SafetyStrings
{
    public required string Title { get; init; }
    public required string Subtitle { get; init; }
    public required string SafetyScore { get; init; }
    public required string TotalFeatures { get; init; }
    public required string Enabled { get; init; }
    public required string Disabled { get; init; }
    public required string EnabledLower { get; init; }
    public required string On { get; init; }
    public required string Off { get; init; }
    public required string LiveSignals { get; init; }
    public required string DriverBelt { get; init; }
    public required string PassengerBelt { get; init; }
    public required string DriverSeat { get; init; }
    public required string VehicleLock { get; init; }
    public required string Buckled { get; init; }
    public required string Unbuckled { get; init; }
    public required string Occupied { get; init; }
    public required string EmptySeat { get; init; }
    public required string Locked { get; init; }
    public required string Unlocked { get; init; }
    public required string DrivingStats { get; init; }
    public required string DistanceSinceReset { get; init; }
    public required string SelfDrivingDistance { get; init; }
    public required string DistanceAutopilot { get; init; }
    public required string AdasFeatures { get; init; }
    public required string AutoEmergencyBraking { get; init; }
    public required string AutomaticCollisionMitigation { get; init; }
    public required string BlindSpotCamera { get; init; }
    public required string CameraViewWhenSignaling { get; init; }
    public required string ForwardCollisionWarning { get; init; }
    public required string WarnsOfFrontalCollisions { get; init; }
    public required string LaneDepartureAvoidance { get; init; }
    public required string PreventsUnintentionalLaneChanges { get; init; }
    public required string CruiseFollowDistance { get; init; }
    public required string AdaptiveCruiseHeadway { get; init; }
    public required string SpeedLimitWarning { get; init; }
    public required string AlertsWhenExceedingSpeed { get; init; }
    public required string PinToDrive { get; init; }
    public required string RequiresPinBeforeDriving { get; init; }
    public required string BlindSpotCollisionWarning { get; init; }
    public required string AlertsForBlindSpot { get; init; }
    public required string EmergencyLaneDepartureAvoidance { get; init; }
    public required string SteersBackOnDeparture { get; init; }
    public required string SafetyStatesOverTime { get; init; }
    public required string Aeb { get; init; }
    public required string Bsc { get; init; }
    public required string Bscw { get; init; }
    public required string Fcw { get; init; }
    public required string Lda { get; init; }
    public required string Elda { get; init; }
    public required string Cfd { get; init; }
    public required string Slw { get; init; }
    public required string Pin { get; init; }
    public required string Time { get; init; }
    public required string History { get; init; }
    public required string NoSafetyData { get; init; }
    public required string NoChartHistory { get; init; }
    public required string NoHistoryRecords { get; init; }
    public required string ErrorTitle { get; init; }
    public required string Retry { get; init; }

    /// <summary>Resolve every label through the i18n facade (web key name → English default).</summary>
    public static SafetyStrings Resolve(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return new SafetyStrings
        {
            Title = localizer.GetString("Safety Settings", "Safety Settings"),
            Subtitle = localizer.GetString(
                "ADAS features, safety score, and driving stats",
                "ADAS features, safety score, and driving stats"),
            SafetyScore = localizer.GetString("Safety Score", "Safety Score"),
            TotalFeatures = localizer.GetString("Total Features", "Total Features"),
            Enabled = localizer.GetString("Enabled", "Enabled"),
            Disabled = localizer.GetString("Disabled", "Disabled"),
            EnabledLower = localizer.GetString("enabled", "enabled"),
            On = localizer.GetString("On", "On"),
            Off = localizer.GetString("Off", "Off"),
            LiveSignals = localizer.GetString("safety.liveSignals", "Live Safety Signals"),
            DriverBelt = localizer.GetString("safety.driverBelt", "Driver Belt"),
            PassengerBelt = localizer.GetString("safety.passengerBelt", "Passenger Belt"),
            DriverSeat = localizer.GetString("safety.driverSeat", "Driver Seat"),
            VehicleLock = localizer.GetString("safety.vehicleLock", "Vehicle Lock"),
            Buckled = localizer.GetString("safety.buckled", "Buckled"),
            Unbuckled = localizer.GetString("safety.unbuckled", "Unbuckled"),
            Occupied = localizer.GetString("safety.occupied", "Occupied"),
            EmptySeat = localizer.GetString("safety.empty", "Empty"),
            Locked = localizer.GetString("safety.locked", "Locked"),
            Unlocked = localizer.GetString("safety.unlocked", "Unlocked"),
            DrivingStats = localizer.GetString("safety.drivingStats", "Driving Statistics"),
            DistanceSinceReset = localizer.GetString("safety.distanceSinceReset", "Distance Since Reset"),
            SelfDrivingDistance = localizer.GetString("safety.selfDrivingDistance", "Self-Driving Distance"),
            DistanceAutopilot = localizer.GetString("safety.distanceAutopilot", "{{unit}} (autopilot)"),
            AdasFeatures = localizer.GetString("ADAS Features", "ADAS Features"),
            AutoEmergencyBraking = localizer.GetString("Auto Emergency Braking", "Auto Emergency Braking"),
            AutomaticCollisionMitigation = localizer.GetString("Automatic collision mitigation", "Automatic collision mitigation"),
            BlindSpotCamera = localizer.GetString("Blind Spot Camera", "Blind Spot Camera"),
            CameraViewWhenSignaling = localizer.GetString("Camera view when signaling", "Camera view when signaling"),
            ForwardCollisionWarning = localizer.GetString("Forward Collision Warning", "Forward Collision Warning"),
            WarnsOfFrontalCollisions = localizer.GetString("Warns of potential frontal collisions", "Warns of potential frontal collisions"),
            LaneDepartureAvoidance = localizer.GetString("Lane Departure Avoidance", "Lane Departure Avoidance"),
            PreventsUnintentionalLaneChanges = localizer.GetString("Prevents unintentional lane changes", "Prevents unintentional lane changes"),
            CruiseFollowDistance = localizer.GetString("Cruise Follow Distance", "Cruise Follow Distance"),
            AdaptiveCruiseHeadway = localizer.GetString("Adaptive cruise headway setting", "Adaptive cruise headway setting"),
            SpeedLimitWarning = localizer.GetString("Speed Limit Warning", "Speed Limit Warning"),
            AlertsWhenExceedingSpeed = localizer.GetString("Alerts when exceeding speed limit", "Alerts when exceeding speed limit"),
            PinToDrive = localizer.GetString("Pin to Drive", "Pin to Drive"),
            RequiresPinBeforeDriving = localizer.GetString("Requires PIN before driving", "Requires PIN before driving"),
            BlindSpotCollisionWarning = localizer.GetString("Blind Spot Collision Warning", "Blind Spot Collision Warning"),
            AlertsForBlindSpot = localizer.GetString("Alerts for blind-spot hazards", "Alerts for blind-spot hazards"),
            EmergencyLaneDepartureAvoidance = localizer.GetString("Emergency Lane Departure Avoidance", "Emergency Lane Departure Avoidance"),
            SteersBackOnDeparture = localizer.GetString("Steers back on unintentional departure", "Steers back on unintentional departure"),
            SafetyStatesOverTime = localizer.GetString("Safety States Over Time", "Safety States Over Time"),
            Aeb = localizer.GetString("AEB", "AEB"),
            Bsc = localizer.GetString("BSC", "BSC"),
            Bscw = localizer.GetString("BSCW", "BSCW"),
            Fcw = localizer.GetString("FCW", "FCW"),
            Lda = localizer.GetString("LDA", "LDA"),
            Elda = localizer.GetString("ELDA", "ELDA"),
            Cfd = localizer.GetString("CFD", "CFD"),
            Slw = localizer.GetString("SLW", "SLW"),
            Pin = localizer.GetString("PIN", "PIN"),
            Time = localizer.GetString("Time", "Time"),
            History = localizer.GetString("Safety Settings History", "Safety Settings History"),
            NoSafetyData = localizer.GetString("No safety data available for this vehicle.", "No safety data available for this vehicle."),
            NoChartHistory = localizer.GetString("No safety state history to chart yet.", "No safety state history to chart yet."),
            NoHistoryRecords = localizer.GetString("No history records found.", "No history records found."),
            ErrorTitle = localizer.GetString("error.loadFailed", "Failed to load data"),
            Retry = localizer.GetString("common.retry", "Retry"),
        };
    }
}

/// <summary>
/// Pure projection from a <see cref="SafetySettingsModel"/> to its <see cref="SafetySettingsDisplay"/> — the native port
/// of web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx. It selects the top-level data state, resolves every
/// label through the i18n facade, formats every value (the score / counts via <see cref="ScalarFormatters"/>; the SI
/// driving distances via <see cref="UnitFormatters"/> at the display boundary), and assembles every section — the
/// safety-score gauge, the four summary metrics, the four live-signal cards, the two driving-stat cards, the nine ADAS
/// feature cards, the Safety-States-Over-Time step chart and the history table — each with its own empty fallback so a
/// region is never blank.
/// </summary>
public static class SafetySettingsProjection
{
    /// <summary>Segoe Fluent — Shield (web <c>AlertCircle</c> page surface / safety theme).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent — Contact (web <c>UserCheck</c> seat-belt signal).</summary>
    public const string BeltGlyph = "\uE77B";

    /// <summary>Segoe Fluent — People (web <c>Armchair</c> seat-occupied signal).</summary>
    public const string SeatGlyph = "\uE716";

    /// <summary>Segoe Fluent — Lock (web <c>Lock</c> vehicle-lock signal).</summary>
    public const string LockGlyph = "\uE72E";

    /// <summary>Segoe Fluent — MapDirections (web <c>Navigation</c> distance-since-reset stat).</summary>
    public const string NavigationGlyph = "\uE8A7";

    /// <summary>Segoe Fluent — Processor (web <c>Cpu</c> self-driving-distance stat).</summary>
    public const string CpuGlyph = "\uE950";

    /// <summary>The safety-score gauge maximum percentage (web score is 0..100).</summary>
    public const double GaugeMaxPercent = 100;

    private const string EmDash = "\u2014";
    private const string SuccessBrush = "TsColorSuccessBrush";
    private const string WarningBrush = "TsColorWarningBrush";
    private const string DangerBrush = "TsColorDangerBrush";
    private const string AccentBrush = "TsColorAccentBrush";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the active units + localizer.</summary>
    /// <param name="model">The parsed three-source data plus the page lifecycle flags.</param>
    /// <param name="units">The user's unit-display preference (applied only at this boundary).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">Injectable clock for deterministic date formatting in tests.</param>
    public static SafetySettingsDisplay Project(
        SafetySettingsModel model,
        UnitPref units,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = SafetyStrings.Resolve(localizer);
        var snapshot = model.Snapshot;
        var latest = snapshot.Latest;

        SafetySettingsState state =
            model.Loading && !snapshot.HasData ? SafetySettingsState.Loading
            : model.ErrorDetail is not null ? SafetySettingsState.Error
            : !snapshot.HasData ? SafetySettingsState.Empty
            : SafetySettingsState.Success;

        string errorText = string.IsNullOrWhiteSpace(model.ErrorDetail)
            ? s.ErrorTitle
            : $"{s.ErrorTitle}: {model.ErrorDetail}";

        int enabled = latest?.EnabledCount ?? 0;
        int disabled = SafetySnapshot.TotalFeatures - enabled;
        double scorePct = latest is null ? 0 : enabled / (double)SafetySnapshot.TotalFeatures * 100;

        var summary = BuildSummary(enabled, disabled, scorePct, s);
        var signals = BuildSignals(snapshot.Security, s);
        var stats = BuildStats(latest, units, s);
        var features = latest is null ? Array.Empty<SafetyFeatureDisplay>() : BuildFeatureCards(latest, s);
        var chartSeries = BuildChartSeries(snapshot.History);
        var (historyColumns, historyRows) = BuildHistory(snapshot.History, s, now);

        return new SafetySettingsDisplay(
            State: state,
            Title: s.Title,
            Subtitle: s.Subtitle,
            ShowLoading: state == SafetySettingsState.Loading,
            ShowError: state == SafetySettingsState.Error,
            ShowEmpty: state == SafetySettingsState.Empty,
            ShowContent: state == SafetySettingsState.Success,
            ErrorText: errorText,
            RetryLabel: s.Retry,
            EmptyTitle: s.Title,
            EmptyMessage: s.NoSafetyData,
            GaugeValue: Math.Clamp(scorePct, 0, GaugeMaxPercent),
            GaugeMax: GaugeMaxPercent,
            GaugeLabel: s.SafetyScore,
            GaugeUnit: "%",
            GaugeColorIndex: GaugeColorIndex(scorePct),
            EnabledBadgeText: $"{enabled}/{SafetySnapshot.TotalFeatures} {s.EnabledLower}",
            EnabledBadgeStatus: ScoreStatus(scorePct),
            SummaryMetrics: summary,
            LiveSignalsTitle: s.LiveSignals,
            SignalCards: signals,
            DrivingStatsTitle: s.DrivingStats,
            DrivingStats: stats,
            AdasTitle: s.AdasFeatures,
            FeatureCards: features,
            ChartTitle: s.SafetyStatesOverTime,
            ChartState: chartSeries.Length > 0 ? ChartState.Ready : ChartState.Empty,
            ChartEmptyMessage: s.NoChartHistory,
            ChartAccessibleSummary: s.SafetyStatesOverTime,
            ChartSeries: chartSeries,
            HistoryTitle: s.History,
            HistoryEmptyMessage: s.NoHistoryRecords,
            HistoryColumns: historyColumns,
            HistoryRows: historyRows,
            AutomationName: $"{s.Title}. {s.Subtitle}");
    }

    private static IReadOnlyList<SafetyMetricDisplay> BuildSummary(int enabled, int disabled, double scorePct, SafetyStrings s)
    {
        string score = ScalarFormatters.FormatPercentage(scorePct, 0);
        return
        [
            new SafetyMetricDisplay(s.SafetyScore, score, ScoreBrush(scorePct), $"{s.SafetyScore}, {score}"),
            new SafetyMetricDisplay(
                s.TotalFeatures,
                SafetySnapshot.TotalFeatures.ToString(CultureInfo.InvariantCulture),
                AccentBrush,
                $"{s.TotalFeatures}, {SafetySnapshot.TotalFeatures}"),
            new SafetyMetricDisplay(s.Enabled, enabled.ToString(CultureInfo.InvariantCulture), SuccessBrush, $"{s.Enabled}, {enabled}"),
            new SafetyMetricDisplay(
                s.Disabled,
                disabled.ToString(CultureInfo.InvariantCulture),
                disabled > 0 ? DangerBrush : SuccessBrush,
                $"{s.Disabled}, {disabled}"),
        ];
    }

    private static IReadOnlyList<SafetySignalDisplay> BuildSignals(SecuritySafetySnapshot? security, SafetyStrings s)
    {
        return
        [
            Signal(s.DriverBelt, security?.DriverSeatBelt, s.Buckled, s.Unbuckled, BeltGlyph),
            Signal(s.PassengerBelt, security?.PassengerSeatBelt, s.Buckled, s.Unbuckled, BeltGlyph),
            Signal(s.DriverSeat, security?.DriverSeatOccupied, s.Occupied, s.EmptySeat, SeatGlyph),
            Signal(s.VehicleLock, security?.Locked, s.Locked, s.Unlocked, LockGlyph),
        ];
    }

    private static SafetySignalDisplay Signal(string label, bool? value, string onText, string offText, string glyph)
    {
        string text = value is null ? EmDash : value.Value ? onText : offText;
        StatusKind? tone = value is null ? null : value.Value ? StatusKind.Success : StatusKind.Danger;
        return new SafetySignalDisplay(label, text, glyph, tone, $"{label}, {text}");
    }

    private static IReadOnlyList<SafetyStatDisplay> BuildStats(SafetySnapshot? latest, UnitPref units, SafetyStrings s)
    {
        string unitLabel = UnitLabels.Label(units.Distance);
        string distance = FormatDistanceValue(latest?.MilesSinceResetMeters, units);
        string selfDriving = FormatDistanceValue(latest?.SelfDrivingMilesSinceResetMeters, units);
        string autopilotSub = s.DistanceAutopilot.Replace("{{unit}}", unitLabel, StringComparison.Ordinal);

        return
        [
            new SafetyStatDisplay(s.DistanceSinceReset, distance, unitLabel, NavigationGlyph, $"{s.DistanceSinceReset}, {distance} {unitLabel}"),
            new SafetyStatDisplay(s.SelfDrivingDistance, selfDriving, autopilotSub, CpuGlyph, $"{s.SelfDrivingDistance}, {selfDriving} {autopilotSub}"),
        ];
    }

    private static IReadOnlyList<SafetyFeatureDisplay> BuildFeatureCards(SafetySnapshot snap, SafetyStrings s)
    {
        bool aeb = snap.AebEnabled;
        bool bsc = snap.BlindSpotCamera;
        bool ptd = snap.PinToDrive;
        bool bscw = snap.BlindSpotCollisionWarning;
        bool elda = snap.EmergencyLaneDepartureAvoidance;

        string fcwVal = SafetyEnumClassifier.Clean(snap.ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning, s.On, s.Off, EmDash);
        string ldaVal = SafetyEnumClassifier.Clean(snap.LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance, s.On, s.Off, EmDash);
        string slwVal = SafetyEnumClassifier.Clean(snap.SpeedLimitWarning, SafetyEnumField.SpeedLimitWarning, s.On, s.Off, EmDash);
        string cfdVal = SafetyEnumClassifier.Clean(snap.CruiseFollowDistance, SafetyEnumField.CruiseFollowDistance, s.On, s.Off, EmDash);
        bool fcwOn = SafetyEnumClassifier.IsActive(snap.ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning);
        bool ldaOn = SafetyEnumClassifier.IsActive(snap.LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance);
        bool slwOn = SafetyEnumClassifier.IsActive(snap.SpeedLimitWarning, SafetyEnumField.SpeedLimitWarning);
        bool cfdOn = SafetyEnumClassifier.IsActive(snap.CruiseFollowDistance, SafetyEnumField.CruiseFollowDistance);

        string EnabledText(bool on) => on ? s.Enabled : s.Disabled;

        return
        [
            Feature("aeb", s.AutoEmergencyBraking, s.AutomaticCollisionMitigation, aeb, EnabledText(aeb)),
            Feature("bsc", s.BlindSpotCamera, s.CameraViewWhenSignaling, bsc, EnabledText(bsc)),
            Feature("fcw", s.ForwardCollisionWarning, s.WarnsOfFrontalCollisions, fcwOn, fcwVal),
            Feature("lda", s.LaneDepartureAvoidance, s.PreventsUnintentionalLaneChanges, ldaOn, ldaVal),
            Feature("cfd", s.CruiseFollowDistance, s.AdaptiveCruiseHeadway, cfdOn, cfdVal),
            Feature("slw", s.SpeedLimitWarning, s.AlertsWhenExceedingSpeed, slwOn, slwVal),
            Feature("ptd", s.PinToDrive, s.RequiresPinBeforeDriving, ptd, EnabledText(ptd)),
            Feature("bscw", s.BlindSpotCollisionWarning, s.AlertsForBlindSpot, bscw, EnabledText(bscw)),
            Feature("elda", s.EmergencyLaneDepartureAvoidance, s.SteersBackOnDeparture, elda, EnabledText(elda)),
        ];
    }

    private static SafetyFeatureDisplay Feature(string key, string label, string description, bool enabled, string valueText) =>
        new(key, label, description, enabled, valueText, $"{label}, {valueText}");

    private static SafetyChartSeriesDisplay[] BuildChartSeries(IReadOnlyList<SafetySnapshot> history)
    {
        if (history.Count == 0)
        {
            return Array.Empty<SafetyChartSeriesDisplay>();
        }

        var sorted = new List<SafetySnapshot>(history);
        sorted.Sort((a, b) => Nullable.Compare(a.CreatedAt, b.CreatedAt));

        var aeb = new List<ChartPoint>(sorted.Count);
        var bscw = new List<ChartPoint>(sorted.Count);
        var elda = new List<ChartPoint>(sorted.Count);
        for (int i = 0; i < sorted.Count; i++)
        {
            var row = sorted[i];
            aeb.Add(new ChartPoint(i, row.AebEnabled ? 1 : 0));
            bscw.Add(new ChartPoint(i, row.BlindSpotCollisionWarning ? 1 : 0));
            elda.Add(new ChartPoint(i, row.EmergencyLaneDepartureAvoidance ? 1 : 0));
        }

        return
        [
            new SafetyChartSeriesDisplay("AEB", 0, aeb),
            new SafetyChartSeriesDisplay("BSCW", 1, bscw),
            new SafetyChartSeriesDisplay("ELDA", 2, elda),
        ];
    }

    private static (IReadOnlyList<SafetyHistoryColumnDisplay> Columns, IReadOnlyList<SafetyHistoryRowDisplay> Rows) BuildHistory(
        IReadOnlyList<SafetySnapshot> history, SafetyStrings s, DateTimeOffset now)
    {
        var columns = new SafetyHistoryColumnDisplay[]
        {
            new("time", s.Time, false),
            new("aeb", s.Aeb, false),
            new("bsc", s.Bsc, false),
            new("bscw", s.Bscw, false),
            new("fcw", s.Fcw, false),
            new("lda", s.Lda, false),
            new("elda", s.Elda, false),
            new("cfd", s.Cfd, false),
            new("slw", s.Slw, false),
            new("pin", s.Pin, false),
        };

        if (history.Count == 0)
        {
            return (columns, Array.Empty<SafetyHistoryRowDisplay>());
        }

        var sorted = new List<SafetySnapshot>(history);
        sorted.Sort((a, b) => Nullable.Compare(b.CreatedAt, a.CreatedAt));

        string Bool(bool v) => v ? s.On : s.Off;

        var rows = new List<SafetyHistoryRowDisplay>(sorted.Count);
        for (int i = 0; i < sorted.Count; i++)
        {
            var row = sorted[i];
            rows.Add(new SafetyHistoryRowDisplay(
                Id: (row.Id ?? i).ToString(CultureInfo.InvariantCulture),
                Time: DateTimeFormatting.Format(row.CreatedAt, DateTimeVariant.Full, now),
                Aeb: Bool(row.AebEnabled),
                Bsc: Bool(row.BlindSpotCamera),
                Bscw: Bool(row.BlindSpotCollisionWarning),
                Fcw: SafetyEnumClassifier.Clean(row.ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning, s.On, s.Off, EmDash),
                Lda: SafetyEnumClassifier.Clean(row.LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance, s.On, s.Off, EmDash),
                Elda: Bool(row.EmergencyLaneDepartureAvoidance),
                Cfd: SafetyEnumClassifier.Clean(row.CruiseFollowDistance, SafetyEnumField.CruiseFollowDistance, s.On, s.Off, EmDash),
                Slw: SafetyEnumClassifier.Clean(row.SpeedLimitWarning, SafetyEnumField.SpeedLimitWarning, s.On, s.Off, EmDash),
                Pin: Bool(row.PinToDrive)));
        }

        return (columns, rows);
    }

    private static string FormatDistanceValue(double? meters, UnitPref units)
    {
        if (meters is null || double.IsNaN(meters.Value) || double.IsInfinity(meters.Value))
        {
            return EmDash;
        }

        double converted = UnitConverters.DistanceFromSi(meters.Value, units.Distance);
        return ScalarFormatters.FormatNumber(converted, 0);
    }

    private static int GaugeColorIndex(double scorePct) => scorePct >= 80 ? 1 : scorePct >= 50 ? 3 : 5;

    private static StatusKind ScoreStatus(double scorePct) =>
        scorePct >= 80 ? StatusKind.Success : scorePct >= 50 ? StatusKind.Warning : StatusKind.Danger;

    private static string ScoreBrush(double scorePct) =>
        scorePct >= 80 ? SuccessBrush : scorePct >= 50 ? WarningBrush : DangerBrush;
}

/// <summary>PII-safe diagnostics collector for the Safety Settings surface (emits the <c>view.opened</c> event).</summary>
public sealed class SafetySettingsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SafetySettingsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SafetySettingsPage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SafetySettingsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>SafetySettingsPage</c> surface — the native mirror of the web page at
/// web/src/features/vehicle-systems/pages/SafetySettingsPage.tsx (route <c>/safety-settings</c>, nav name
/// <c>SafetySettings</c>). Holds the route name, the three generated operation ids it binds to, the diagnostics slug,
/// the empty-surface glyph and the localized title.
/// </summary>
public static class SafetySettingsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SafetySettingsPage";

    /// <summary>The navigation route name (matches <c>RouteTable</c>).</summary>
    public const string RouteName = "SafetySettings";

    // The web reads /safety/latest, /safety and /security/latest. Operations.cs carries no Safety/Security group, so the
    // generated operation ids are referenced verbatim here (scoped to this surface), exactly as the sibling
    // SecuritySectionSource does. They resolve against TeslaSync.Windows.Generated.Api.ApiEndpoints.

    /// <summary>Generated operation id for the latest safety read (web <c>/safety/latest</c>).</summary>
    public const string LatestOperation = "get_api_v1_safety_latest";

    /// <summary>Generated operation id for the safety history read (web <c>/safety</c>).</summary>
    public const string HistoryOperation = "get_api_v1_safety";

    /// <summary>Generated operation id for the live security signals read (web <c>useSecurityLatest</c>).</summary>
    public const string SecurityOperation = "get_api_v1_security_latest";

    /// <summary>The Segoe Fluent glyph for the page-level empty surface.</summary>
    public const string EmptyGlyph = SafetySettingsProjection.ShieldGlyph;

    /// <summary>The localized page title (web <c>t('Safety Settings')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("Safety Settings", "Safety Settings");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case safety JSON wire shape (no camelCaseKeys transform on native): longs, doubles
/// (or numeric strings), booleans (bool / 0-1 number / boolean string) and ISO timestamps. Kept internal to this surface
/// so the page's parsers stay self-contained and never throw on a partial body.
/// </summary>
internal static class SafetyJson
{
    public static long? Long(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.Number when v.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(v.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var n) => n,
            _ => null,
        };
    }

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

    public static bool Bool(JsonElement obj, string name) => NullableBool(obj, name) ?? false;

    public static bool? NullableBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => v.TryGetDouble(out var n) ? n != 0 : null,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) ? b : null,
            _ => null,
        };
    }

    public static DateTimeOffset? Date(JsonElement obj, string name)
    {
        if (obj.TryGetProperty(name, out var v) &&
            v.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParse(
                v.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var parsed))
        {
            return parsed;
        }

        return null;
    }
}
