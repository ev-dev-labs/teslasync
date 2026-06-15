using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Watch;

/// <summary>
/// The mutually-exclusive lifecycle state of the <c>WatchFacePage</c> surface — the native mirror of the data
/// states the chrome-less web watch page renders (web/src/features/watch/pages/WatchFacePage.tsx). The web page
/// gates its body on <c>isLoading ? &lt;Spinner&gt; : (error || !data) ? &lt;message&gt; : &lt;watch shell&gt;</c>, so the
/// states map onto: a watch-summary read in flight (<see cref="Loading"/>), a failed read (<see cref="Error"/>,
/// the web <c>error</c> message), a resolved-but-empty body (<see cref="Empty"/>, the web <c>!data</c> "No vehicle
/// found" message) and a resolved summary (<see cref="Success"/>, the OLED watch face). None is ever a blank region.
/// </summary>
public enum WatchFaceState
{
    /// <summary>The watch-summary read is in flight with nothing yet to show (web <c>isLoading</c>).</summary>
    Loading,

    /// <summary>A watch summary resolved — the OLED watch face (gauge + status + tap icons) renders.</summary>
    Success,

    /// <summary>The read returned no usable body (web <c>!data</c>) — the "No vehicle found" message.</summary>
    Empty,

    /// <summary>The read failed (web <c>error</c>) — the error message + retry affordance.</summary>
    Error,
}

/// <summary>
/// The watch-summary slice the page reads from <c>GET /watch/summary</c> — the native mirror of the web
/// <c>WatchSummary</c> interface (web/src/api/hooks/useWatch.ts). Only the fields the web
/// <c>WatchFacePage</c> consumes are kept: the vehicle name, the coarse FSM <c>state</c>, the state-of-charge
/// percent (<c>battery_level</c>), the rated range in kilometres (<c>range_km</c> — the existing watch wire field,
/// converted to SI metres at the display boundary), the charging flag + minutes-to-full, the lock / sentry /
/// climate flags, the cabin temperature in Celsius (<c>inside_temp_c</c>) and the <c>last_updated</c> instant.
/// Field names mirror the Go API's snake_case JSON tags; parsing is null-tolerant so a partial body never throws.
/// A <see langword="null"/> parse result models the web <c>data</c> being undefined (no data → the empty surface).
/// </summary>
/// <param name="VehicleName">Vehicle display name (web <c>data.vehicle_name</c>), or null.</param>
/// <param name="State">Coarse vehicle FSM state (web <c>data.state</c>), or null.</param>
/// <param name="BatteryLevel">State-of-charge percent (web <c>data.battery_level</c>), or null.</param>
/// <param name="RangeKm">Rated range in kilometres (web <c>data.range_km</c>), or null.</param>
/// <param name="IsCharging">Charging flag (web <c>data.is_charging</c>).</param>
/// <param name="TimeToFull">Minutes until full (web <c>data.time_to_full</c>), or null.</param>
/// <param name="IsLocked">Lock flag (web <c>data.is_locked</c>).</param>
/// <param name="SentryMode">Sentry-mode flag (web <c>data.sentry_mode</c>).</param>
/// <param name="InsideTempC">Cabin temperature in Celsius (web <c>data.inside_temp_c</c>), or null.</param>
/// <param name="IsClimateOn">Climate flag (web <c>data.is_climate_on</c>).</param>
/// <param name="LastUpdated">Parsed <c>last_updated</c> instant (web <c>data.last_updated</c>), or null.</param>
public sealed record WatchFaceSummary(
    string? VehicleName,
    string? State,
    double? BatteryLevel,
    double? RangeKm,
    bool IsCharging,
    double? TimeToFull,
    bool IsLocked,
    bool SentryMode,
    double? InsideTempC,
    bool IsClimateOn,
    DateTimeOffset? LastUpdated)
{
    /// <summary>
    /// Project a <c>GET /watch/summary</c> response into the slice. Returns <see langword="null"/> when the body
    /// is not an object or carries no fields — the native analogue of the web <c>data</c> being undefined (the
    /// "No vehicle found" surface). A non-empty object always yields a record (zeros still render).
    /// </summary>
    public static WatchFaceSummary? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object || !root.EnumerateObject().MoveNext())
        {
            return null;
        }

        return new WatchFaceSummary(
            VehicleName: ReadString(root, "vehicle_name"),
            State: ReadString(root, "state"),
            BatteryLevel: ReadDouble(root, "battery_level"),
            RangeKm: ReadDouble(root, "range_km"),
            IsCharging: ReadBool(root, "is_charging"),
            TimeToFull: ReadDouble(root, "time_to_full"),
            IsLocked: ReadBool(root, "is_locked"),
            SentryMode: ReadBool(root, "sentry_mode"),
            InsideTempC: ReadDouble(root, "inside_temp_c"),
            IsClimateOn: ReadBool(root, "is_climate_on"),
            LastUpdated: ReadDateTime(root, "last_updated"));
    }

    private static double? ReadDouble(JsonElement obj, string name)
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

    private static bool ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return false;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(v.GetString(), out var b) && b,
            _ => false,
        };
    }

    private static string? ReadString(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        string? value = v.GetString();
        return string.IsNullOrWhiteSpace(value) ? null : value;
    }

    private static DateTimeOffset? ReadDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v) || v.ValueKind != JsonValueKind.String)
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            v.GetString(),
            CultureInfo.InvariantCulture,
            DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One render-ready tap icon in the watch face's quick-action row — the native analogue of the web
/// <c>StatusIcon</c> (lock/unlock, climate, sentry). <see cref="Command"/> is the exact wire string POSTed to
/// <c>/watch/command</c> (<see langword="null"/> for the non-interactive sentry indicator);
/// <see cref="Active"/> drives the tint (web <c>active</c>), <see cref="Disabled"/> mirrors the web
/// <c>loading</c> gate (every tappable icon dims while a command is in flight) and <see cref="IsLoading"/> marks
/// the in-flight icon. <see cref="Caption"/> is the climate icon's temperature sublabel (web <c>label</c>).
/// </summary>
/// <param name="Id">Stable icon id.</param>
/// <param name="Command">The wire command POSTed when tapped, or null for a non-interactive indicator.</param>
/// <param name="Glyph">Segoe Fluent glyph (web Lucide icon).</param>
/// <param name="Label">Localized action / accessible name.</param>
/// <param name="Caption">Optional sublabel under the glyph (the climate temperature), or null.</param>
/// <param name="Accent">Semantic tint applied when <see cref="Active"/> (web color prop).</param>
/// <param name="Active">True when the icon reflects an active state (web <c>active</c>).</param>
/// <param name="Interactive">True when tapping sends <see cref="Command"/> (false for the sentry indicator).</param>
/// <param name="Disabled">True while a command is in flight (web <c>loading</c>).</param>
/// <param name="IsLoading">True while this icon's command is in flight.</param>
public sealed record WatchFaceQuickAction(
    string Id,
    string? Command,
    string Glyph,
    string Label,
    string? Caption,
    StatusKind Accent,
    bool Active,
    bool Interactive,
    bool Disabled,
    bool IsLoading);

/// <summary>
/// The immutable inputs <see cref="WatchFaceProjection"/> reads — the resolved watch summary, the load / failure
/// flags derived from the summary read, the user's unit preference, and the local command UI state (the in-flight
/// command wire string + pending flag). Pure data so the whole projection is unit-tested headless.
/// </summary>
public sealed record WatchFaceModel(
    WatchFaceSummary? Summary,
    bool Loading,
    bool LoadFailed,
    UnitPref Units,
    string? ActiveCommand,
    bool CommandPending);

/// <summary>
/// The render-ready projection the <c>WatchFacePage</c> view binds to. Every visible literal is resolved here
/// through the <see cref="ILocalizer"/> so the view stays a thin renderer with zero hardcoded text, and every SI
/// value is converted to the display unit through <see cref="UnitFormatters"/> / <see cref="UnitConverters"/>. The
/// flags drive the battery gauge tint, the charging line, the state badge, the three tap icons and the freshness
/// caption.
/// </summary>
public sealed record WatchFaceDisplay(
    WatchFaceState State,
    string Title,
    string Message,
    string VehicleName,
    double BatteryValue,
    double BatteryMax,
    string BatteryValueText,
    string BatteryUnit,
    StatusKind BatteryStatus,
    bool HasBatteryReading,
    string RangeText,
    bool IsCharging,
    string ChargingText,
    string StateText,
    StatusKind StateStatus,
    IReadOnlyList<WatchFaceQuickAction> QuickActions,
    string LastUpdatedText,
    string RetryLabel,
    string GaugeAutomationName);

/// <summary>
/// Projects a <see cref="WatchFaceModel"/> into the render-ready <see cref="WatchFaceDisplay"/>. This is the single
/// place the web page's branch selection, unit conversion and i18n live: it derives the state matrix
/// (loading / empty / error / success), resolves every literal through the localizer, formats the range and cabin
/// temperature at the SI display boundary, derives the battery threshold colour (web <c>getBatteryColor</c>) and
/// the state-badge variant (web <c>watchStateVariant</c>), and builds the three tap icons. UI-free so it is
/// unit-tested without a XAML runtime.
/// </summary>
public static class WatchFaceProjection
{
    // Segoe Fluent Icons code points (web Lucide icon -> nearest platform glyph; same mapping the sibling pages use).
    private const string LockGlyph = "\uE72E";        // Lock (web Lock)
    private const string UnlockGlyph = "\uE785";      // Unlock (web Unlock)
    private const string ThermometerGlyph = "\uE9CA"; // Temperature (web Thermometer)
    private const string SentryGlyph = "\uE890";      // Sentry / surveillance (web Shield) — the app's sentry mark

    /// <summary>The gauge maximum (web SVG arc total, level * 2.64 of 264).</summary>
    public const double BatteryMax = 100;

    /// <summary>Above this state-of-charge the battery ring is healthy/green (web <c>getBatteryColor</c> &gt; 40).</summary>
    public const double HealthyThresholdPercent = 40;

    /// <summary>Above this state-of-charge the battery ring is a warning/amber (web <c>getBatteryColor</c> &gt; 20).</summary>
    public const double WarningThresholdPercent = 20;

    /// <summary>Map a state-of-charge to the semantic battery colour (web <c>getBatteryColor</c>).</summary>
    public static StatusKind BatteryStatusFor(double batteryLevel)
    {
        if (batteryLevel > HealthyThresholdPercent)
        {
            return StatusKind.Success;
        }

        return batteryLevel > WarningThresholdPercent ? StatusKind.Warning : StatusKind.Danger;
    }

    /// <summary>Map the coarse FSM state to the badge variant (web <c>watchStateVariant</c>).</summary>
    public static StatusKind StateStatusFor(string? state)
    {
        if (string.Equals(state, "driving", StringComparison.OrdinalIgnoreCase))
        {
            return StatusKind.Info;
        }

        return string.Equals(state, "charging", StringComparison.OrdinalIgnoreCase)
            ? StatusKind.Success
            : StatusKind.Neutral;
    }

    /// <summary>Resolve the top-level state and every localized literal for <paramref name="model"/>.</summary>
    /// <param name="model">The immutable projection inputs.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The clock used for the "last updated" freshness caption; defaults to UTC now.</param>
    public static WatchFaceDisplay Project(WatchFaceModel model, ILocalizer localizer, DateTimeOffset? now = null)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // Resolve every literal unconditionally (both branches of each web ternary) so a single projection run
        // references every string key, then select which copy the current branch renders.
        var title = localizer.GetString("watch.title", "Watch Face");
        var noVehicle = localizer.GetString("watch.noVehicle", "No vehicle found");
        var errorText = localizer.GetString("watch.error", "Couldn't load watch data");
        var retry = localizer.GetString("watch.retry", "Retry");
        var lockAction = localizer.GetString("watch.action.lock", "Lock");
        var unlockAction = localizer.GetString("watch.action.unlock", "Unlock");
        var climateOnAction = localizer.GetString("watch.action.climateOn", "Climate On");
        var climateOffAction = localizer.GetString("watch.action.climateOff", "Climate Off");
        var sentryOn = localizer.GetString("watch.sentry.on", "Sentry on");
        var sentryOff = localizer.GetString("watch.sentry.off", "Sentry off");
        var batteryLabel = localizer.GetString("watch.battery", "Battery");

        var state = model.LoadFailed
            ? WatchFaceState.Error
            : model.Loading
                ? WatchFaceState.Loading
                : model.Summary is null
                    ? WatchFaceState.Empty
                    : WatchFaceState.Success;

        var message = state switch
        {
            WatchFaceState.Error => errorText,
            WatchFaceState.Empty => noVehicle,
            _ => string.Empty,
        };

        var summary = model.Summary;
        var units = model.Units;

        double? level = summary?.BatteryLevel;
        double clamped = level is { } l ? Math.Clamp(SafeNumber(l), 0, BatteryMax) : 0;
        var batteryStatus = level is { } lv ? BatteryStatusFor(Math.Clamp(SafeNumber(lv), 0, BatteryMax)) : StatusKind.Neutral;
        var batteryText = FormatBatteryValue(clamped);

        // SI boundary: the watch wire field range_km is kilometres; multiply by 1000 to SI metres before the
        // shared display-boundary converter (web: convertDistanceFromSI(data.range_km * 1000, …)).
        var rangeText = summary?.RangeKm is { } km
            ? UnitFormatters.FormatDistance(km * 1000.0, units, precision: 0)
            : UnitFormatters.DefaultEmptyDisplay;

        bool isCharging = summary?.IsCharging ?? false;
        var chargingText = isCharging
            ? string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("watch.charging.toFull", "{0}m to full"),
                RoundToInt(summary?.TimeToFull ?? 0))
            : string.Empty;

        var stateText = summary?.State ?? string.Empty;
        var stateStatus = StateStatusFor(summary?.State);

        // SI boundary: inside_temp_c is already Celsius; convert to the display unit and show "21°" (web `${round}°`).
        var tempCaption = summary?.InsideTempC is { } celsius
            ? FormatTempDegrees(celsius, units)
            : UnitFormatters.DefaultEmptyDisplay;

        bool isLocked = summary?.IsLocked ?? false;
        bool isClimateOn = summary?.IsClimateOn ?? false;
        bool sentryMode = summary?.SentryMode ?? false;
        bool pending = model.CommandPending;

        var quickActions = new[]
        {
            new WatchFaceQuickAction(
                Id: "lock",
                Command: isLocked ? "unlock" : "lock",
                Glyph: isLocked ? LockGlyph : UnlockGlyph,
                Label: isLocked ? unlockAction : lockAction,
                Caption: null,
                Accent: isLocked ? StatusKind.Success : StatusKind.Danger,
                Active: isLocked,
                Interactive: true,
                Disabled: pending,
                IsLoading: pending && IsLockCommand(model.ActiveCommand)),
            new WatchFaceQuickAction(
                Id: "climate",
                Command: isClimateOn ? "climate_off" : "climate_on",
                Glyph: ThermometerGlyph,
                Label: isClimateOn ? climateOffAction : climateOnAction,
                Caption: tempCaption,
                Accent: StatusKind.Info,
                Active: isClimateOn,
                Interactive: true,
                Disabled: pending,
                IsLoading: pending && IsClimateCommand(model.ActiveCommand)),
            new WatchFaceQuickAction(
                Id: "sentry",
                Command: null,
                Glyph: SentryGlyph,
                Label: sentryMode ? sentryOn : sentryOff,
                Caption: null,
                Accent: StatusKind.Warning,
                Active: sentryMode,
                Interactive: false,
                Disabled: false,
                IsLoading: false),
        };

        var lastUpdated = FormatRelativeTime(summary?.LastUpdated, now ?? DateTimeOffset.UtcNow, localizer);

        return new WatchFaceDisplay(
            State: state,
            Title: title,
            Message: message,
            VehicleName: summary?.VehicleName ?? string.Empty,
            BatteryValue: clamped,
            BatteryMax: BatteryMax,
            BatteryValueText: batteryText,
            BatteryUnit: "%",
            BatteryStatus: batteryStatus,
            HasBatteryReading: level is not null,
            RangeText: rangeText,
            IsCharging: isCharging,
            ChargingText: chargingText,
            StateText: stateText,
            StateStatus: stateStatus,
            QuickActions: quickActions,
            LastUpdatedText: lastUpdated,
            RetryLabel: retry,
            GaugeAutomationName: $"{batteryLabel} {batteryText}%");
    }

    /// <summary>
    /// Format a "time since last update" caption exactly as the web <c>formatRelativeTime</c> (just now /
    /// <c>{n}m ago</c> / <c>{n}h ago</c> / <c>{n}d ago</c>); an absent instant yields the empty string.
    /// </summary>
    public static string FormatRelativeTime(DateTimeOffset? lastUpdated, DateTimeOffset now, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        var justNow = localizer.GetString("watch.time.justNow", "just now");
        var minutesAgo = localizer.GetString("watch.time.minutesAgo", "{0}m ago");
        var hoursAgo = localizer.GetString("watch.time.hoursAgo", "{0}h ago");
        var daysAgo = localizer.GetString("watch.time.daysAgo", "{0}d ago");

        if (lastUpdated is not { } then)
        {
            return string.Empty;
        }

        double diffSec = (now - then).TotalSeconds;
        if (diffSec < 0)
        {
            diffSec = 0;
        }

        if (diffSec < 60)
        {
            return justNow;
        }

        if (diffSec < 3600)
        {
            return string.Format(CultureInfo.CurrentCulture, minutesAgo, (int)Math.Floor(diffSec / 60));
        }

        if (diffSec < 86400)
        {
            return string.Format(CultureInfo.CurrentCulture, hoursAgo, (int)Math.Floor(diffSec / 3600));
        }

        return string.Format(CultureInfo.CurrentCulture, daysAgo, (int)Math.Floor(diffSec / 86400));
    }

    /// <summary>Format the gauge state-of-charge exactly as the web (a rounded integer percent).</summary>
    public static string FormatBatteryValue(double value) =>
        RoundToInt(value).ToString(CultureInfo.CurrentCulture);

    private static string FormatTempDegrees(double celsius, UnitPref units)
    {
        double value = UnitConverters.TemperatureFromSi(celsius, units.Temperature);
        return string.Concat(RoundToInt(value).ToString(CultureInfo.CurrentCulture), "\u00B0");
    }

    private static int RoundToInt(double value) =>
        (int)Math.Round(SafeNumber(value), MidpointRounding.AwayFromZero);

    private static bool IsLockCommand(string? command) =>
        string.Equals(command, "lock", StringComparison.Ordinal) || string.Equals(command, "unlock", StringComparison.Ordinal);

    private static bool IsClimateCommand(string? command) =>
        string.Equals(command, "climate_on", StringComparison.Ordinal) || string.Equals(command, "climate_off", StringComparison.Ordinal);

    private static double SafeNumber(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Canonical metadata for the <c>WatchFacePage</c> feature surface — the native mirror of the web page at
/// web/src/features/watch/pages/WatchFacePage.tsx (route <c>/watch</c>, nav name <c>WatchFace</c>). The page title
/// resolves here so the registration and the projection share one key.
/// </summary>
public static class WatchFaceRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "WatchFacePage";

    /// <summary>The navigation route name this page registers under (RouteTable <c>WatchFace</c>, path <c>watch</c>).</summary>
    public const string RouteName = "WatchFace";

    /// <summary>The localized page title (web route title "Watch Face").</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("watch.title", "Watch Face");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>WatchFacePage</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, VIN, battery level, location or
/// command — so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class WatchFaceDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public WatchFaceDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=WatchFacePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={WatchFaceRegistration.Slug}");
    }
}
