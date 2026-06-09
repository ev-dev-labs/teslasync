using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

// ── Input model (the web component props) ──────────────────────────────────────────────────────────────
// All numeric inputs are SI (the backend stores SI; producers deliver SI). The projection converts at the
// display boundary only, exactly mirroring the web LiveTelemetry's per-field render. Every field is nullable
// to reproduce the web's per-field em-dash fallbacks.

/// <summary>
/// Drivetrain live values — the native analogue of the web <c>MotorData</c> prop
/// (web/src/features/dashboard/types.ts). <see cref="TorqueNm"/> is drive-inverter torque (N·m);
/// <see cref="StatorTempCelsius"/> the SI Celsius stator temperature; <see cref="Gear"/> the raw gear string
/// (<c>D</c>/<c>R</c>/<c>N</c>/<c>P</c>, possibly a Go nil sentinel); and <see cref="LateralAccelG"/> /
/// <see cref="LongitudinalAccelG"/> the accelerations in g the web shows directly. Pure data.
/// </summary>
public sealed record MotorTelemetry(
    double? TorqueNm,
    double? StatorTempCelsius,
    string? Gear,
    double? LateralAccelG,
    double? LongitudinalAccelG);

/// <summary>
/// Climate live values — the native analogue of the web <c>ClimateData</c> prop.
/// <see cref="InsideTempCelsius"/> / <see cref="OutsideTempCelsius"/> are SI Celsius; <see cref="HvacPowerW"/>
/// the SI watts the web shows as kW; <see cref="FanSpeed"/> the 0..6 blower step; <see cref="DefrostMode"/>
/// the raw defrost-mode string; and <see cref="BatteryHeaterOn"/> whether the battery heater runs. Pure data.
/// </summary>
public sealed record ClimateTelemetry(
    double? InsideTempCelsius,
    double? OutsideTempCelsius,
    double? HvacPowerW,
    int? FanSpeed,
    string? DefrostMode,
    bool BatteryHeaterOn);

/// <summary>
/// Security live values — the native analogue of the web <c>SecurityData</c> prop. <see cref="Locked"/> and
/// <see cref="SentryMode"/> are the lock / Sentry flags; <see cref="DoorState"/> the comma-separated door
/// summary; and the four window fields the per-window state strings (a value other than <c>closed</c> means
/// that window is open). Pure data.
/// </summary>
public sealed record SecurityTelemetry(
    bool Locked,
    bool SentryMode,
    string? DoorState,
    string? FrontDriverWindow,
    string? FrontPassengerWindow,
    string? RearDriverWindow,
    string? RearPassengerWindow);

/// <summary>
/// Tire-pressure live values — the native analogue of the web <c>TirePressureData</c> prop. Each corner is an
/// SI kilopascal pressure (the web prop carries bar; the native model is SI and converts at the display
/// boundary). Pure data.
/// </summary>
public sealed record TirePressureTelemetry(
    double? FrontLeftKpa,
    double? FrontRightKpa,
    double? RearLeftKpa,
    double? RearRightKpa);

/// <summary>
/// Media live values — the native analogue of the web <c>MediaData</c> prop. <see cref="NowPlayingTitle"/> /
/// <see cref="NowPlayingArtist"/> are the track metadata (possibly Go nil sentinels); <see cref="PlaybackStatus"/>
/// the <c>Playing</c>/<c>Paused</c>/… state; and <see cref="AudioVolume"/> / <see cref="AudioVolumeMax"/> the
/// current and maximum volume levels. Pure data.
/// </summary>
public sealed record MediaTelemetry(
    string? NowPlayingTitle,
    string? NowPlayingArtist,
    string? PlaybackStatus,
    double? AudioVolume,
    double? AudioVolumeMax);

/// <summary>
/// Navigation live values — the native analogue of the web <c>LocationData</c> prop.
/// <see cref="DestinationName"/> is the active route destination; <see cref="DistanceToArrivalMeters"/> the SI
/// metres remaining; <see cref="MinutesToArrival"/> the ETA in minutes the web shows directly; and the three
/// saved-location flags mark whether the vehicle is at home / work / a favourite. Pure data.
/// </summary>
public sealed record NavigationTelemetry(
    string? DestinationName,
    double? DistanceToArrivalMeters,
    double? MinutesToArrival,
    bool AtHome,
    bool AtWork,
    bool AtFavorite);

/// <summary>
/// The render-time data model the <c>LiveTelemetry</c> view binds to — the native analogue of the web
/// component's six live-data props plus the user's unit preference (the web passes display-converter functions
/// and unit labels; the native surface carries one <see cref="UnitPref"/> and converts in the projection). Each
/// group is nullable: a null group renders that panel's loading skeleton, exactly as the web renders
/// <c>{data ? … : &lt;SkeletonRows /&gt;}</c> per panel. Pure data — no WinUI types — so the projection is
/// unit-tested without a UI host.
/// </summary>
public sealed record LiveTelemetryModel(
    MotorTelemetry? Motor,
    ClimateTelemetry? Climate,
    SecurityTelemetry? Security,
    TirePressureTelemetry? TirePressure,
    MediaTelemetry? Media,
    NavigationTelemetry? Navigation,
    UnitPref Units)
{
    /// <summary>The initial model: every panel is still awaiting its first live value (all skeletons).</summary>
    public static LiveTelemetryModel Pending { get; } =
        new(null, null, null, null, null, null, UnitPref.Metric);
}

// ── Projected display records (render-ready, WinUI-free) ───────────────────────────────────────────────

/// <summary>A label paired with its formatted value — the native analogue of the web <c>TelemetryRow</c>.</summary>
public sealed record TelemetryMetric(string Label, string Value);

/// <summary>A label paired with a status-tinted chip — the native analogue of a web <c>Badge</c> row.</summary>
public sealed record TelemetryStatus(string Label, string Text, StatusKind Status);

/// <summary>
/// A labelled progress readout — a value caption plus a 0..1 <see cref="Fraction"/> for the bar fill (the web
/// fan / volume meters). <see cref="Fraction"/> is always clamped to [0, 1].
/// </summary>
public sealed record TelemetryGauge(string Label, string ValueText, double Fraction);

/// <summary>The freshness band of a single tire's pressure, driving its readout colour.</summary>
public enum TirePressureLevel
{
    /// <summary>No reading for this corner.</summary>
    Unknown,

    /// <summary>Within the normal band.</summary>
    Normal,

    /// <summary>Outside the normal band but not yet critical.</summary>
    Warning,

    /// <summary>Critically under- or over-inflated.</summary>
    Critical,
}

/// <summary>One projected tire corner: its label, formatted pressure value and freshness <see cref="Level"/>.</summary>
public sealed record TireCornerDisplay(string Label, string Value, TirePressureLevel Level);

/// <summary>
/// The fully projected Drivetrain panel (web <c>DrivetrainPanel</c>). <see cref="HasData"/> is false while the
/// web renders its skeleton. <see cref="GearKnown"/> mirrors the web's <c>cleanNil(gear)</c> truthiness: when
/// true the gear renders as a <see cref="GearStatus"/>-tinted chip, otherwise as an em dash.
/// </summary>
public sealed record DrivetrainDisplay(
    string Title,
    bool HasData,
    TelemetryMetric Torque,
    TelemetryMetric MotorTemp,
    string GearLabel,
    string GearText,
    StatusKind GearStatus,
    bool GearKnown,
    TelemetryMetric GForce,
    string AutomationName);

/// <summary>
/// The fully projected Climate panel (web <c>ClimatePanel</c>). The <see cref="Fan"/> meter mirrors the web's
/// <c>fan/6</c> bar; <see cref="ShowDefrost"/> / <see cref="ShowBatteryHeater"/> gate the two active-mode chips;
/// and when neither is active <see cref="NoModesText"/> is shown, exactly as the web does.
/// </summary>
public sealed record ClimateDisplay(
    string Title,
    bool HasData,
    TelemetryMetric Cabin,
    TelemetryMetric Outside,
    TelemetryMetric HvacPower,
    TelemetryGauge Fan,
    bool ShowDefrost,
    string DefrostText,
    bool ShowBatteryHeater,
    string BatteryHeaterText,
    bool AnyModes,
    string NoModesText,
    string AutomationName);

/// <summary>
/// The fully projected Security panel (web <c>SecurityPanel</c>). <see cref="Locked"/> / <see cref="SentryActive"/>
/// drive the lock and Sentry readout colour and glyph in the view; <see cref="Doors"/> / <see cref="Windows"/>
/// are the open-count chips (success when all closed, warning otherwise).
/// </summary>
public sealed record SecurityDisplay(
    string Title,
    bool HasData,
    string LockLabel,
    string LockText,
    bool Locked,
    string SentryLabel,
    string SentryText,
    bool SentryActive,
    TelemetryStatus Doors,
    TelemetryStatus Windows,
    string AutomationName);

/// <summary>
/// The fully projected Tire-Pressure panel (web <c>TirePressurePanel</c>). <see cref="Corners"/> are the four
/// per-corner readouts (each with its own freshness band), <see cref="UnitLabel"/> the shared pressure unit
/// shown under each value, and <see cref="Summary"/> the "All Normal" / "Warning" chip.
/// </summary>
public sealed record TirePressureDisplay(
    string Title,
    bool HasData,
    IReadOnlyList<TireCornerDisplay> Corners,
    string UnitLabel,
    TelemetryStatus Summary,
    string AutomationName);

/// <summary>
/// The fully projected Media panel (web <c>MediaPanel</c>). <see cref="TrackTitle"/> / <see cref="Artist"/>
/// already apply the web's <c>cleanNil</c> + fallback chain; <see cref="Status"/> is the playback-state chip;
/// and <see cref="Volume"/> the current/maximum meter.
/// </summary>
public sealed record MediaDisplay(
    string Title,
    bool HasData,
    string TrackTitle,
    string Artist,
    TelemetryStatus Status,
    TelemetryGauge Volume,
    string AutomationName);

/// <summary>
/// The fully projected Navigation panel (web <c>NavigationPanel</c>). <see cref="Destination"/>,
/// <see cref="Distance"/> and <see cref="Eta"/> are the three rows; the three saved-location flags gate the
/// Home / Work / Favorite chips, and when none is active <see cref="NoLocationText"/> is shown.
/// </summary>
public sealed record NavigationDisplay(
    string Title,
    bool HasData,
    TelemetryMetric Destination,
    TelemetryMetric Distance,
    TelemetryMetric Eta,
    bool AtHome,
    string HomeText,
    bool AtWork,
    string WorkText,
    bool AtFavorite,
    string FavoriteText,
    bool AnyLocation,
    string NoLocationText,
    string AutomationName);

/// <summary>
/// The fully projected view of the surface for one input model — the native analogue of what the web
/// <c>LiveTelemetry</c> renders. Holds the section <see cref="Title"/>, the six panel projections and the
/// surface <see cref="AutomationName"/>. Pure data so every panel and state is asserted headlessly.
/// </summary>
public sealed record LiveTelemetryDisplay(
    string Title,
    DrivetrainDisplay Drivetrain,
    ClimateDisplay Climate,
    SecurityDisplay Security,
    TirePressureDisplay TirePressure,
    MediaDisplay Media,
    NavigationDisplay Navigation,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="LiveTelemetryModel"/> to its <see cref="LiveTelemetryDisplay"/> — the
/// native port of <c>web/src/features/dashboard/components/LiveTelemetry.tsx</c>. Each panel reproduces the web
/// component's exact per-field render: the <c>data ? … : skeleton</c> gate (<c>HasData</c>), the per-field
/// em-dash fallbacks, the SI→display unit conversion the web does with its injected converters, the
/// <c>cleanNil</c> Go-sentinel filtering, the door / window open-count logic and the tire freshness bands. Every
/// label resolves through the i18n facade using the keys the web feeds into <c>t(...)</c> (the <c>dashboard</c>
/// namespace's <c>telemetry.*</c> keys, flattened to <c>dashboard.telemetry.*</c>). No WinUI types — unit-tested
/// without a UI host.
/// </summary>
public static class LiveTelemetryProjection
{
    private const string EmDash = "\u2014";

    private const string TorqueUnit = "Nm";
    private const string PowerUnit = "kW";
    private const string GForceUnit = "g";
    private const string EtaUnit = "min";
    private const double FanSteps = 6.0;        // web {fan}/6
    private const double WattsPerKilowatt = 1000.0;

    // Tire freshness bands, SI kilopascals (the web bands are bar: 2.068 / 2.275 / 2.896 / 3.103 ×100 kPa).
    private const double TireCriticalLowKpa = 206.8;
    private const double TireWarningLowKpa = 227.5;
    private const double TireWarningHighKpa = 289.6;
    private const double TireCriticalHighKpa = 310.3;

    private const string ClosedWindow = "closed"; // web: a window value other than "closed" is open
    private const string OpenDoorMarker = "open"; // web: a door token containing "open" is an open door
    private const string GearDrive = "D";
    private const string GearReverse = "R";
    private const string PlaybackPlaying = "Playing";
    private const string PlaybackPaused = "Paused";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web props, plus the user's unit preference).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static LiveTelemetryDisplay Project(LiveTelemetryModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        UnitPref units = model.Units;

        string title = localizer.GetString("dashboard.telemetry.title", "Live Telemetry");
        DrivetrainDisplay drivetrain = ProjectDrivetrain(model.Motor, units, localizer);
        ClimateDisplay climate = ProjectClimate(model.Climate, units, localizer);
        SecurityDisplay security = ProjectSecurity(model.Security, localizer);
        TirePressureDisplay tire = ProjectTirePressure(model.TirePressure, units, localizer);
        MediaDisplay media = ProjectMedia(model.Media, localizer);
        NavigationDisplay navigation = ProjectNavigation(model.Navigation, units, localizer);

        string automationName = string.Create(
            CultureInfo.CurrentCulture,
            $"{title}. {drivetrain.Title}. {climate.Title}. {security.Title}. {tire.Title}. {media.Title}. {navigation.Title}");

        return new LiveTelemetryDisplay(
            Title: title,
            Drivetrain: drivetrain,
            Climate: climate,
            Security: security,
            TirePressure: tire,
            Media: media,
            Navigation: navigation,
            AutomationName: automationName);
    }

    // ── Drivetrain ─────────────────────────────────────────────────────────────────────────────────────

    private static DrivetrainDisplay ProjectDrivetrain(MotorTelemetry? data, UnitPref units, ILocalizer localizer)
    {
        string title = localizer.GetString("dashboard.telemetry.drivetrain", "Drivetrain");
        string torqueLabel = localizer.GetString("dashboard.telemetry.torque", "Torque");
        string motorTempLabel = localizer.GetString("dashboard.telemetry.motorTemp", "Motor Temp");
        string gearLabel = localizer.GetString("dashboard.telemetry.gear", "Gear");
        string gforceLabel = localizer.GetString("dashboard.telemetry.gforce", "G-Force");

        var torque = new TelemetryMetric(
            torqueLabel,
            data?.TorqueNm is { } nm ? $"{RawNumber(nm)} {TorqueUnit}" : EmDash);
        var motorTemp = new TelemetryMetric(
            motorTempLabel,
            FormatTemperature(data?.StatorTempCelsius, units));

        string? gear = CleanNil(data?.Gear);
        bool gearKnown = gear is not null;
        var gforce = new TelemetryMetric(gforceLabel, FormatGForce(data?.LateralAccelG, data?.LongitudinalAccelG));

        string automationName = data is null
            ? LoadingName(title, localizer)
            : string.Create(
                CultureInfo.CurrentCulture,
                $"{title}. {torque.Label} {torque.Value}. {motorTemp.Label} {motorTemp.Value}. {gearLabel} {(gearKnown ? gear : EmDash)}. {gforce.Label} {gforce.Value}");

        return new DrivetrainDisplay(
            Title: title,
            HasData: data is not null,
            Torque: torque,
            MotorTemp: motorTemp,
            GearLabel: gearLabel,
            GearText: gearKnown ? gear! : EmDash,
            GearStatus: GearStatusFor(gear),
            GearKnown: gearKnown,
            GForce: gforce,
            AutomationName: automationName);
    }

    private static StatusKind GearStatusFor(string? gear) => gear switch
    {
        GearDrive => StatusKind.Success,
        GearReverse => StatusKind.Danger,
        _ => StatusKind.Neutral,
    };

    private static string FormatGForce(double? lateral, double? longitudinal)
    {
        if (lateral is null && longitudinal is null)
        {
            return EmDash;
        }

        double peak = Math.Max(Math.Abs(lateral ?? 0), Math.Abs(longitudinal ?? 0));
        return $"{ScalarFormatters.FormatNumber(peak, 2)}{GForceUnit}";
    }

    // ── Climate ────────────────────────────────────────────────────────────────────────────────────────

    private static ClimateDisplay ProjectClimate(ClimateTelemetry? data, UnitPref units, ILocalizer localizer)
    {
        string title = localizer.GetString("dashboard.telemetry.climate", "Climate");
        string cabinLabel = localizer.GetString("dashboard.telemetry.cabin", "Cabin");
        string outsideLabel = localizer.GetString("dashboard.telemetry.outside", "Outside");
        string hvacLabel = localizer.GetString("dashboard.telemetry.hvac", "HVAC Power");
        string fanLabel = localizer.GetString("dashboard.telemetry.fan", "Fan");
        string defrostText = localizer.GetString("dashboard.telemetry.defrost", "Defrost");
        string batteryHeaterText = localizer.GetString("dashboard.telemetry.batHeater", "Bat Heater");
        string noModesText = localizer.GetString("dashboard.telemetry.noModes", "No active modes");

        var cabin = new TelemetryMetric(cabinLabel, FormatTemperature(data?.InsideTempCelsius, units));
        var outside = new TelemetryMetric(outsideLabel, FormatTemperature(data?.OutsideTempCelsius, units));
        var hvac = new TelemetryMetric(hvacLabel, FormatHvacPower(data?.HvacPowerW));

        int fanSpeed = data?.FanSpeed ?? 0;
        var fan = new TelemetryGauge(
            fanLabel,
            string.Create(CultureInfo.InvariantCulture, $"{fanSpeed}/{(int)FanSteps}"),
            Clamp01(fanSpeed / FanSteps));

        bool showDefrost = !string.IsNullOrEmpty(data?.DefrostMode) && data!.DefrostMode != "Off";
        bool showBatteryHeater = data?.BatteryHeaterOn ?? false;
        bool anyModes = showDefrost || showBatteryHeater;

        string automationName = data is null
            ? LoadingName(title, localizer)
            : string.Create(
                CultureInfo.CurrentCulture,
                $"{title}. {cabin.Label} {cabin.Value}. {outside.Label} {outside.Value}. {hvac.Label} {hvac.Value}. {fan.Label} {fan.ValueText}. {ModesSummary(anyModes, showDefrost, defrostText, showBatteryHeater, batteryHeaterText, noModesText)}");

        return new ClimateDisplay(
            Title: title,
            HasData: data is not null,
            Cabin: cabin,
            Outside: outside,
            HvacPower: hvac,
            Fan: fan,
            ShowDefrost: showDefrost,
            DefrostText: defrostText,
            ShowBatteryHeater: showBatteryHeater,
            BatteryHeaterText: batteryHeaterText,
            AnyModes: anyModes,
            NoModesText: noModesText,
            AutomationName: automationName);
    }

    private static string FormatHvacPower(double? watts)
    {
        if (watts is not { } w || double.IsNaN(w) || double.IsInfinity(w))
        {
            return EmDash;
        }

        // The web shows hvac_power directly as kW; the SI model carries watts, so convert at the boundary.
        return $"{ScalarFormatters.FormatNumber(w / WattsPerKilowatt, 1)} {PowerUnit}";
    }

    private static string ModesSummary(
        bool anyModes,
        bool showDefrost,
        string defrostText,
        bool showBatteryHeater,
        string batteryHeaterText,
        string noModesText)
    {
        if (!anyModes)
        {
            return noModesText;
        }

        if (showDefrost && showBatteryHeater)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{defrostText}, {batteryHeaterText}");
        }

        return showDefrost ? defrostText : batteryHeaterText;
    }

    // ── Security ───────────────────────────────────────────────────────────────────────────────────────

    private static SecurityDisplay ProjectSecurity(SecurityTelemetry? data, ILocalizer localizer)
    {
        string title = localizer.GetString("dashboard.telemetry.security", "Security");
        string lockLabel = localizer.GetString("dashboard.telemetry.lock", "Lock");
        string sentryLabel = localizer.GetString("dashboard.telemetry.sentry", "Sentry");
        string doorsLabel = localizer.GetString("dashboard.telemetry.doors", "Doors");
        string windowsLabel = localizer.GetString("dashboard.telemetry.windows", "Windows");
        string allClosed = localizer.GetString("dashboard.telemetry.allClosed", "All Closed");
        string openWord = localizer.GetString("dashboard.telemetry.open", "Open");

        bool locked = data?.Locked ?? false;
        bool sentry = data?.SentryMode ?? false;
        string lockText = locked
            ? localizer.GetString("dashboard.telemetry.locked", "Locked")
            : localizer.GetString("dashboard.telemetry.unlocked", "Unlocked");
        string sentryText = sentry
            ? localizer.GetString("dashboard.telemetry.active", "Active")
            : localizer.GetString("dashboard.telemetry.off", "Off");

        int openDoors = CountOpenDoors(data?.DoorState);
        int openWindows = data is null ? 0 : CountOpenWindows(data);
        TelemetryStatus doors = OpenCountChip(doorsLabel, openDoors, allClosed, openWord);
        TelemetryStatus windows = OpenCountChip(windowsLabel, openWindows, allClosed, openWord);

        string automationName = data is null
            ? LoadingName(title, localizer)
            : string.Create(
                CultureInfo.CurrentCulture,
                $"{title}. {lockLabel} {lockText}. {sentryLabel} {sentryText}. {doors.Label} {doors.Text}. {windows.Label} {windows.Text}");

        return new SecurityDisplay(
            Title: title,
            HasData: data is not null,
            LockLabel: lockLabel,
            LockText: lockText,
            Locked: locked,
            SentryLabel: sentryLabel,
            SentryText: sentryText,
            SentryActive: sentry,
            Doors: doors,
            Windows: windows,
            AutomationName: automationName);
    }

    private static int CountOpenDoors(string? doorState)
    {
        if (string.IsNullOrEmpty(doorState))
        {
            return 0;
        }

        int open = 0;
        foreach (string token in doorState.Split(','))
        {
            string trimmed = token.Trim();
            if (trimmed.Length > 0 &&
                trimmed.Contains(OpenDoorMarker, StringComparison.OrdinalIgnoreCase))
            {
                open++;
            }
        }

        return open;
    }

    private static int CountOpenWindows(SecurityTelemetry data)
    {
        int open = 0;
        foreach (string? window in new[]
                 {
                     data.FrontDriverWindow,
                     data.FrontPassengerWindow,
                     data.RearDriverWindow,
                     data.RearPassengerWindow,
                 })
        {
            if (!string.IsNullOrEmpty(window) &&
                !window.Equals(ClosedWindow, StringComparison.OrdinalIgnoreCase))
            {
                open++;
            }
        }

        return open;
    }

    private static TelemetryStatus OpenCountChip(string label, int open, string allClosed, string openWord)
    {
        string text = open == 0
            ? allClosed
            : string.Create(CultureInfo.CurrentCulture, $"{open} {openWord}");
        return new TelemetryStatus(label, text, open == 0 ? StatusKind.Success : StatusKind.Warning);
    }

    // ── Tire pressure ──────────────────────────────────────────────────────────────────────────────────

    private static TirePressureDisplay ProjectTirePressure(TirePressureTelemetry? data, UnitPref units, ILocalizer localizer)
    {
        string title = localizer.GetString("dashboard.telemetry.tirePressure", "Tire Pressure");
        string unitLabel = UnitLabels.Label(units.Pressure);

        var corners = new List<TireCornerDisplay>(4)
        {
            ProjectCorner("FL", data?.FrontLeftKpa, units),
            ProjectCorner("FR", data?.FrontRightKpa, units),
            ProjectCorner("RL", data?.RearLeftKpa, units),
            ProjectCorner("RR", data?.RearRightKpa, units),
        };

        bool allNormal = data is null
            || (IsCornerNormal(data.FrontLeftKpa)
                && IsCornerNormal(data.FrontRightKpa)
                && IsCornerNormal(data.RearLeftKpa)
                && IsCornerNormal(data.RearRightKpa));

        var summary = new TelemetryStatus(
            title,
            allNormal
                ? localizer.GetString("dashboard.telemetry.allNormal", "All Normal")
                : localizer.GetString("dashboard.telemetry.warning", "Warning"),
            allNormal ? StatusKind.Success : StatusKind.Warning);

        string automationName = data is null
            ? LoadingName(title, localizer)
            : string.Create(
                CultureInfo.CurrentCulture,
                $"{title}. {corners[0].Label} {corners[0].Value} {unitLabel}, {corners[1].Label} {corners[1].Value} {unitLabel}, {corners[2].Label} {corners[2].Value} {unitLabel}, {corners[3].Label} {corners[3].Value} {unitLabel}. {summary.Text}");

        return new TirePressureDisplay(
            Title: title,
            HasData: data is not null,
            Corners: corners,
            UnitLabel: unitLabel,
            Summary: summary,
            AutomationName: automationName);
    }

    private static TireCornerDisplay ProjectCorner(string label, double? kpa, UnitPref units)
    {
        string value = kpa is { } k && !double.IsNaN(k) && !double.IsInfinity(k)
            ? NumberFormatting.Format(UnitConverters.PressureFromSi(k, units.Pressure), units.Locale, 1)
            : EmDash;
        return new TireCornerDisplay(label, value, TireLevelFor(kpa));
    }

    private static TirePressureLevel TireLevelFor(double? kpa)
    {
        if (kpa is not { } k || double.IsNaN(k) || double.IsInfinity(k))
        {
            return TirePressureLevel.Unknown;
        }

        if (k < TireCriticalLowKpa || k > TireCriticalHighKpa)
        {
            return TirePressureLevel.Critical;
        }

        if (k < TireWarningLowKpa || k > TireWarningHighKpa)
        {
            return TirePressureLevel.Warning;
        }

        return TirePressureLevel.Normal;
    }

    private static bool IsCornerNormal(double? kpa) =>
        kpa is not { } k || (k >= TireWarningLowKpa && k <= TireWarningHighKpa);

    // ── Media ──────────────────────────────────────────────────────────────────────────────────────────

    private static MediaDisplay ProjectMedia(MediaTelemetry? data, ILocalizer localizer)
    {
        string title = localizer.GetString("dashboard.telemetry.media", "Media");
        string statusLabel = localizer.GetString("dashboard.telemetry.status", "Status");
        string volumeLabel = localizer.GetString("dashboard.telemetry.volume", "Volume");
        string unknownArtist = localizer.GetString("dashboard.telemetry.unknownArtist", "Unknown artist");

        string trackTitle = CleanNil(data?.NowPlayingTitle) ?? EmDash;
        string artist = CleanNil(data?.NowPlayingArtist) ?? unknownArtist;

        string? playback = CleanNil(data?.PlaybackStatus);
        var status = new TelemetryStatus(statusLabel, playback ?? EmDash, PlaybackStatusFor(playback));

        var volume = new TelemetryGauge(
            volumeLabel,
            FormatVolume(data?.AudioVolume, data?.AudioVolumeMax),
            VolumeFraction(data?.AudioVolume, data?.AudioVolumeMax));

        string automationName = data is null
            ? LoadingName(title, localizer)
            : string.Create(
                CultureInfo.CurrentCulture,
                $"{title}. {trackTitle}. {artist}. {status.Label} {status.Text}. {volume.Label} {volume.ValueText}");

        return new MediaDisplay(
            Title: title,
            HasData: data is not null,
            TrackTitle: trackTitle,
            Artist: artist,
            Status: status,
            Volume: volume,
            AutomationName: automationName);
    }

    private static StatusKind PlaybackStatusFor(string? playback) => playback switch
    {
        PlaybackPlaying => StatusKind.Success,
        PlaybackPaused => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    private static string FormatVolume(double? volume, double? max)
    {
        string head = volume is { } v && !double.IsNaN(v) && !double.IsInfinity(v) ? RawNumber(v) : EmDash;
        string tail = max is { } m && !double.IsNaN(m) && !double.IsInfinity(m)
            ? string.Create(CultureInfo.InvariantCulture, $"/{RawNumber(m)}")
            : string.Empty;
        return head + tail;
    }

    private static double VolumeFraction(double? volume, double? max)
    {
        if (volume is { } v && max is { } m && m != 0 && !double.IsNaN(v) && !double.IsNaN(m))
        {
            return Clamp01(v / m);
        }

        return 0;
    }

    // ── Navigation ─────────────────────────────────────────────────────────────────────────────────────

    private static NavigationDisplay ProjectNavigation(NavigationTelemetry? data, UnitPref units, ILocalizer localizer)
    {
        string title = localizer.GetString("dashboard.telemetry.navigation", "Navigation");
        string destinationLabel = localizer.GetString("dashboard.telemetry.destination", "Destination");
        string distanceLabel = localizer.GetString("dashboard.telemetry.distance", "Distance");
        string etaLabel = localizer.GetString("dashboard.telemetry.eta", "ETA");
        string homeText = localizer.GetString("dashboard.telemetry.home", "Home");
        string workText = localizer.GetString("dashboard.telemetry.work", "Work");
        string favoriteText = localizer.GetString("dashboard.telemetry.favorite", "Favorite");
        string noLocationText = localizer.GetString("dashboard.telemetry.noSavedLocation", "No saved location");

        var destination = new TelemetryMetric(
            destinationLabel,
            string.IsNullOrEmpty(data?.DestinationName) ? EmDash : data!.DestinationName!);
        var distance = new TelemetryMetric(distanceLabel, FormatDistance(data?.DistanceToArrivalMeters, units));
        var eta = new TelemetryMetric(etaLabel, FormatEta(data?.MinutesToArrival));

        bool atHome = data?.AtHome ?? false;
        bool atWork = data?.AtWork ?? false;
        bool atFavorite = data?.AtFavorite ?? false;
        bool anyLocation = atHome || atWork || atFavorite;

        string automationName = data is null
            ? LoadingName(title, localizer)
            : string.Create(
                CultureInfo.CurrentCulture,
                $"{title}. {destination.Label} {destination.Value}. {distance.Label} {distance.Value}. {eta.Label} {eta.Value}. {LocationSummary(anyLocation, atHome, homeText, atWork, workText, atFavorite, favoriteText, noLocationText)}");

        return new NavigationDisplay(
            Title: title,
            HasData: data is not null,
            Destination: destination,
            Distance: distance,
            Eta: eta,
            AtHome: atHome,
            HomeText: homeText,
            AtWork: atWork,
            WorkText: workText,
            AtFavorite: atFavorite,
            FavoriteText: favoriteText,
            AnyLocation: anyLocation,
            NoLocationText: noLocationText,
            AutomationName: automationName);
    }

    private static string FormatEta(double? minutes)
    {
        if (minutes is not { } m || double.IsNaN(m) || double.IsInfinity(m))
        {
            return EmDash;
        }

        return $"{ScalarFormatters.FormatNumber(m, 0)} {EtaUnit}";
    }

    private static string LocationSummary(
        bool anyLocation,
        bool atHome,
        string homeText,
        bool atWork,
        string workText,
        bool atFavorite,
        string favoriteText,
        string noLocationText)
    {
        if (!anyLocation)
        {
            return noLocationText;
        }

        var parts = new List<string>(3);
        if (atHome)
        {
            parts.Add(homeText);
        }

        if (atWork)
        {
            parts.Add(workText);
        }

        if (atFavorite)
        {
            parts.Add(favoriteText);
        }

        return string.Join(", ", parts);
    }

    // ── Shared helpers ─────────────────────────────────────────────────────────────────────────────────

    /// <summary>
    /// The web <c>cleanNil</c>: strips Go nil sentinels (<c>&lt;nil&gt;</c>, <c>nil</c>, <c>null</c>) and
    /// nullish/empty values, returning the original string otherwise.
    /// </summary>
    private static string? CleanNil(string? value) =>
        string.IsNullOrEmpty(value) || value is "<nil>" or "nil" or "null" ? null : value;

    private static string FormatTemperature(double? celsius, UnitPref units) =>
        // web: fmtInt(toTemperatureDisplay(c)) + unit — integer precision, no space before the unit.
        UnitFormatters.FormatTemperature(celsius, units, 0);

    private static string FormatDistance(double? meters, UnitPref units) =>
        // web: fmtNumber(toDistanceDisplay(km), 1) + " " + unit — one decimal, space before the unit.
        UnitFormatters.FormatDistance(meters, units, 1);

    private static string RawNumber(double value) =>
        // Mirrors the web's bare template literal (`${value}`): shortest round-trip, no grouping or rounding.
        value.ToString(CultureInfo.InvariantCulture);

    private static double Clamp01(double value) => value < 0 ? 0 : value > 1 ? 1 : value;

    private static string LoadingName(string title, ILocalizer localizer) =>
        string.Create(
            CultureInfo.CurrentCulture,
            $"{title}. {localizer.GetString("common.loading", "Loading...")}");
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveTelemetry</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a torque, temperature, location or any
/// other live value — so a diagnostics line can never leak vehicle telemetry. Thread-safe.
/// </summary>
public sealed class LiveTelemetryDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveTelemetryDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveTelemetry</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveTelemetryRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>LiveTelemetry</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/dashboard/components/LiveTelemetry.tsx</c>.
/// </summary>
public static class LiveTelemetryRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveTelemetry";
}
