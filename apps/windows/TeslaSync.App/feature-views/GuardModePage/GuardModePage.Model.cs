using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.VehicleSystems;

/// <summary>
/// The top-level data state the <c>GuardModePage</c> renders — the native union of the web page's
/// loading / empty / error / success branches (web/src/features/vehicle-systems/pages/GuardModePage.tsx,
/// route <c>/guard-mode</c>). The view is never blank: <see cref="Loading"/> shows the scaffold spinner
/// (web <c>PageContainer loading</c>), <see cref="Empty"/> shows the panels with their per-section empty
/// surfaces when no vehicle / guard configuration is in scope, <see cref="Error"/> surfaces a retry when the
/// guard read hard-fails with nothing to show, and <see cref="Success"/> renders the six panels from data.
/// </summary>
public enum GuardModeState
{
    /// <summary>Initial read in flight with nothing cached — render the scaffold spinner.</summary>
    Loading,

    /// <summary>No vehicle / no guard configuration — panels render with their empty surfaces.</summary>
    Empty,

    /// <summary>The guard read failed hard with nothing to show — render the retry affordance.</summary>
    Error,

    /// <summary>A guard configuration resolved and the six panels render from data.</summary>
    Success,
}

/// <summary>
/// The visual state of the guard status shield (web ternary over <c>isTriggered</c> / <c>isArmed</c>): a
/// red pulsing alert, a green armed shield or a muted disarmed shield. Pure presentation enum.
/// </summary>
public enum GuardShieldState
{
    /// <summary>Guard mode is off (web <c>!isArmed</c>).</summary>
    Disarmed,

    /// <summary>Guard mode is armed and no unacknowledged alert is active (web <c>isArmed &amp;&amp; !isTriggered</c>).</summary>
    Armed,

    /// <summary>An unacknowledged, non-test alert is the newest event (web <c>isTriggered</c>).</summary>
    Triggered,
}

/// <summary>
/// Page-level constants for the <c>GuardModePage</c> surface: the diagnostics slug, the navigation route
/// name and the generated operation ids each feed binds to (ADR-004). UI-free.
/// </summary>
public static class GuardModeRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "GuardModePage";

    /// <summary>The navigation route name (matches <c>RouteTable</c> <c>Page("GuardMode","guard-mode",…)</c>).</summary>
    public const string RouteName = "GuardMode";

    /// <summary>Generated operation id for the guard config read (web <c>useGuardConfig → GET /vehicles/{id}/guard</c>).</summary>
    public const string ConfigOperation = Operations.Vehicles.Guard;

    /// <summary>Generated operation id for the guard events read (web <c>useGuardEvents → GET /vehicles/{id}/guard/events</c>).</summary>
    public const string EventsOperation = "get_api_v1_vehicles_vehicleID_guard_events";

    /// <summary>Generated operation id for the vehicle state read (web <c>useVehicleState → GET /vehicles/{id}/state</c>).</summary>
    public const string StateOperation = Operations.Vehicles.State;

    /// <summary>Generated operation id for the geofence list read (web <c>useGeofences → GET /geofences</c>).</summary>
    public const string GeofencesOperation = Operations.Locations.Geofences;

    /// <summary>Generated operation id for the fleet read backing the scope picker (web <c>useVehicles → GET /vehicles</c>).</summary>
    public const string VehiclesOperation = Operations.Vehicles.List;

    /// <summary>
    /// Operation id for the guard-config write (web <c>useSetGuardConfig → POST /vehicles/{id}/guard</c>). The
    /// backend route (internal/api/router.go) and the OpenAPI contract expose only the GET today, so this id is
    /// not in the generated endpoint table; the write is wired for web parity and a missing-endpoint failure
    /// degrades to the same error toast the web shows on a non-2xx response.
    /// </summary>
    public const string SetConfigOperation = "post_api_v1_vehicles_vehicleID_guard";

    /// <summary>Generated operation id for the panic command (web <c>useGuardPanic → POST /vehicles/{id}/guard/panic</c>).</summary>
    public const string PanicOperation = "post_api_v1_vehicles_vehicleID_guard_panic";

    /// <summary>Generated operation id for the event acknowledge (web <c>useAcknowledgeGuardEvent → POST …/acknowledge</c>).</summary>
    public const string AcknowledgeOperation = "post_api_v1_vehicles_vehicleID_guard_events_eventID_acknowledge";

    /// <summary>The localized page title (web <c>t('guard.title')</c>).</summary>
    public static string Title(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString("guard.title", "Guard Mode");
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>GuardModePage</c> surface (P1/S11 diagnostics contract). Guard events
/// encode a vehicle's security history, so the collector records ONLY the operational <c>view.opened</c>
/// event with the surface slug — never an event type, acknowledgement, sensitivity or vehicle id. Thread-safe.
/// </summary>
public sealed class GuardModeDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public GuardModeDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=GuardModePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={GuardModeRegistration.Slug}");
    }
}

/// <summary>
/// Null-tolerant readers for the snake_case guard JSON wire shape (no camelCaseKeys transform on native):
/// numbers (or numeric strings), 64-bit ids, booleans, strings and ISO timestamps. Kept internal so the
/// page's parsers stay self-contained and never throw on a partial body.
/// </summary>
internal static class GuardModeJson
{
    public static long? GetLong(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetInt64(out var n) => n,
            JsonValueKind.String when long.TryParse(value.GetString(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static double? GetDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.Number when value.TryGetDouble(out var n) => n,
            JsonValueKind.String when double.TryParse(value.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out var s) => s,
            _ => null,
        };
    }

    public static bool? GetBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var value))
        {
            return null;
        }

        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when value.TryGetInt64(out var n) => n != 0,
            JsonValueKind.String => bool.TryParse(value.GetString(), out var b) ? b : null,
            _ => null,
        };
    }

    public static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var value) && value.ValueKind == JsonValueKind.String
            ? value.GetString()
            : null;

    public static DateTimeOffset? TryParseTimestamp(string? raw) =>
        !string.IsNullOrWhiteSpace(raw) &&
        DateTimeOffset.TryParse(raw, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out var ts)
            ? ts
            : null;

    /// <summary>Pull the first array under any of <paramref name="keys"/>, or the root array, else empty.</summary>
    public static IReadOnlyList<JsonElement> Array(JsonElement element, params string[] keys)
    {
        if (element.ValueKind == JsonValueKind.Array)
        {
            return Materialize(element);
        }

        if (element.ValueKind == JsonValueKind.Object)
        {
            foreach (var key in keys)
            {
                if (element.TryGetProperty(key, out var inner) && inner.ValueKind == JsonValueKind.Array)
                {
                    return Materialize(inner);
                }
            }
        }

        return System.Array.Empty<JsonElement>();
    }

    private static List<JsonElement> Materialize(JsonElement array)
    {
        var list = new List<JsonElement>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            list.Add(item);
        }

        return list;
    }
}

/// <summary>
/// The guard configuration from <c>GET /vehicles/{vehicleID}/guard</c> (web <c>GuardConfig</c> in
/// web/src/api/hooks/useGuard.ts). Field names mirror the Go API's snake_case JSON tags; parsing is
/// null-tolerant. A non-object body resolves to <see langword="null"/> — the same truthiness gate the web
/// applies to <c>config</c>.
/// </summary>
public sealed record GuardConfig(
    long VehicleId,
    bool Enabled,
    long? HomeGeofenceId,
    string? Sensitivity,
    bool AutoPanic,
    string? UpdatedAt)
{
    /// <summary>Project a guard-config body into a <see cref="GuardConfig"/>, or null when not an object.</summary>
    public static GuardConfig? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new GuardConfig(
            VehicleId: GuardModeJson.GetLong(element, "vehicle_id") ?? 0,
            Enabled: GuardModeJson.GetBool(element, "enabled") ?? false,
            HomeGeofenceId: GuardModeJson.GetLong(element, "home_geofence_id"),
            Sensitivity: GuardModeJson.GetString(element, "sensitivity"),
            AutoPanic: GuardModeJson.GetBool(element, "auto_panic") ?? false,
            UpdatedAt: GuardModeJson.GetString(element, "updated_at"));
    }
}

/// <summary>
/// One guard event row sourced from <c>security_events</c> via <c>GET /vehicles/{vehicleID}/guard/events</c>
/// (web <c>GuardEvent</c>). The endpoint returns an envelope <c>{ vehicle_id, events: [...] }</c>; rows are
/// extracted from <c>events</c> exactly like the web hook's <c>safeArray(data?.events)</c>. <c>event_type</c>
/// is free-form, so the UI uses lookup-with-fallback. Acknowledgement is DERIVED from
/// <see cref="AcknowledgedAt"/> being set (the backend emits no separate boolean).
/// </summary>
public sealed record GuardEvent(
    long Id,
    string? Ts,
    string EventType,
    string? FromState,
    string? ToState,
    string? AcknowledgedAt,
    string? AcknowledgedBy)
{
    /// <summary>True iff <see cref="AcknowledgedAt"/> is set (web <c>isGuardEventAcknowledged</c>).</summary>
    public bool IsAcknowledged => !string.IsNullOrEmpty(AcknowledgedAt);

    /// <summary>The parsed event instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? Timestamp => GuardModeJson.TryParseTimestamp(Ts);

    /// <summary>Extract the guard events from the <c>{ vehicle_id, events: [...] }</c> envelope (web <c>safeArray</c>).</summary>
    public static IReadOnlyList<GuardEvent> ParseEnvelope(JsonElement element)
    {
        var rows = GuardModeJson.Array(element, "events");
        var list = new List<GuardEvent>(rows.Count);
        foreach (var item in rows)
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single guard-event JSON object into a <see cref="GuardEvent"/>.</summary>
    public static GuardEvent FromJson(JsonElement obj) => new(
        Id: GuardModeJson.GetLong(obj, "id") ?? 0,
        Ts: GuardModeJson.GetString(obj, "ts"),
        EventType: GuardModeJson.GetString(obj, "event_type") ?? string.Empty,
        FromState: GuardModeJson.GetString(obj, "from_state"),
        ToState: GuardModeJson.GetString(obj, "to_state"),
        AcknowledgedAt: GuardModeJson.GetString(obj, "acknowledged_at"),
        AcknowledgedBy: GuardModeJson.GetString(obj, "acknowledged_by"));
}

/// <summary>
/// A geofence from <c>GET /geofences</c> (web <c>useGeofences</c>), reduced to the fields the page uses: the
/// id + name for the home-geofence picker and the centre + radius for the map circle. Coordinates / radius
/// are SI numbers (metres). Tolerant of either a bare array or a <c>{ geofences | data: [...] }</c> envelope.
/// </summary>
public sealed record GuardGeofence(long Id, string Name, double Latitude, double Longitude, double Radius)
{
    /// <summary>Parse the geofence list from the response body (bare array or envelope).</summary>
    public static IReadOnlyList<GuardGeofence> ParseList(JsonElement element)
    {
        var rows = GuardModeJson.Array(element, "geofences", "data", "items");
        var list = new List<GuardGeofence>(rows.Count);
        foreach (var item in rows)
        {
            if (item.ValueKind != JsonValueKind.Object)
            {
                continue;
            }

            long id = GuardModeJson.GetLong(item, "id") ?? 0;
            if (id <= 0)
            {
                continue;
            }

            list.Add(new GuardGeofence(
                Id: id,
                Name: GuardModeJson.GetString(item, "name") ?? string.Empty,
                Latitude: GuardModeJson.GetDouble(item, "latitude") ?? 0,
                Longitude: GuardModeJson.GetDouble(item, "longitude") ?? 0,
                Radius: GuardModeJson.GetDouble(item, "radius") ?? 0));
        }

        return list;
    }
}

/// <summary>
/// The live vehicle state from <c>GET /vehicles/{vehicleID}/state</c> (web <c>useVehicleState</c>), reduced
/// to the fields the page reads: position (for the live map) plus the lock + sentry flags (for the status
/// card). The web unwraps <c>vehicleState?.state ?? vehicleState</c>, so parsing accepts either a nested
/// <c>{ state: {...} }</c> envelope or the flat object.
/// </summary>
public sealed record GuardVehicleState(double? Latitude, double? Longitude, bool IsLocked, bool SentryMode)
{
    /// <summary>True when the vehicle has a non-zero, finite position (web <c>hasLocation</c>).</summary>
    public bool HasLocation =>
        Latitude is { } lat && Longitude is { } lng &&
        lat != 0 && lng != 0 &&
        !double.IsNaN(lat) && !double.IsNaN(lng);

    /// <summary>Project a vehicle-state body into a <see cref="GuardVehicleState"/>, or null when not an object.</summary>
    public static GuardVehicleState? FromJson(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var state = element.TryGetProperty("state", out var nested) && nested.ValueKind == JsonValueKind.Object
            ? nested
            : element;

        return new GuardVehicleState(
            Latitude: GuardModeJson.GetDouble(state, "latitude"),
            Longitude: GuardModeJson.GetDouble(state, "longitude"),
            IsLocked: GuardModeJson.GetBool(state, "is_locked") ?? false,
            SentryMode: GuardModeJson.GetBool(state, "sentry_mode") ?? false);
    }
}

/// <summary>
/// The raw aggregate the <see cref="GuardModePageViewModel"/> folds the reads + the editable settings form
/// into before projecting. <see cref="FormSensitivity"/> / <see cref="FormHomeGeofenceId"/> /
/// <see cref="FormAutoPanic"/> are the page's local edits (web <c>useState</c>), empty/false until the user
/// changes them, at which point they override the persisted config (web <c>sensitivity || config?.sensitivity</c>).
/// </summary>
public sealed record GuardModeModel(
    long VehicleId,
    GuardConfig? Config,
    IReadOnlyList<GuardEvent> Events,
    GuardVehicleState? VehicleState,
    IReadOnlyList<GuardGeofence> Geofences,
    string? VehicleName,
    string FormSensitivity,
    string FormHomeGeofenceId,
    bool FormAutoPanic,
    bool Loading,
    bool HasError,
    bool IsSavePending,
    bool IsPanicPending,
    long? AckPendingId)
{
    /// <summary>The initial, pre-load model (loading, no vehicle scoped).</summary>
    public static GuardModeModel Initial => new(
        VehicleId: 0,
        Config: null,
        Events: System.Array.Empty<GuardEvent>(),
        VehicleState: null,
        Geofences: System.Array.Empty<GuardGeofence>(),
        VehicleName: null,
        FormSensitivity: string.Empty,
        FormHomeGeofenceId: string.Empty,
        FormAutoPanic: false,
        Loading: true,
        HasError: false,
        IsSavePending: false,
        IsPanicPending: false,
        AckPendingId: null);
}

/// <summary>A sensitivity dropdown option (web <c>SENSITIVITY_OPTIONS</c>).</summary>
public sealed record GuardSensitivityOption(string Value, string Label);

/// <summary>A home-geofence dropdown option (web <c>geofenceOptions</c>); an empty <see cref="Value"/> is "none".</summary>
public sealed record GuardGeofenceOption(string Value, string Label);

/// <summary>
/// One projected, render-ready guard event row (web <c>EventRow</c>). Holds the resolved severity glyph +
/// token brush key, the localized badge label + semantic status, the relative time, the optional state
/// transition + acknowledged-by lines and a Narrator name. Pure data — no WinUI types.
/// </summary>
public sealed record GuardEventRow(
    long Id,
    string Glyph,
    string AccentBrushKey,
    StatusKind BadgeStatus,
    string BadgeLabel,
    string TimeLabel,
    string? TransitionText,
    string? AcknowledgedByText,
    bool Acknowledged,
    bool ShowAckButton,
    string AckLabel,
    string AutomationName);

/// <summary>
/// The projected, render-ready model the WinUI view binds to — the native mirror of the web page's derived
/// values (<c>isArmed</c> / <c>isTriggered</c> / <c>unacknowledgedCount</c> / <c>hasLocation</c> /
/// <c>effectiveSensitivity</c> / …) plus every localized string and the capped event feed. Every label is
/// resolved in <see cref="GuardModeProjection"/> so the view is a thin renderer.
/// </summary>
public sealed record GuardModeDisplay(
    GuardModeState State,
    bool IsLoading,
    bool ShowError,
    string ErrorMessage,
    string Title,
    string Subtitle,
    GuardShieldState Shield,
    string StatusHeadline,
    string EnableGuardLabel,
    bool IsArmed,
    bool ShowUpdating,
    string UpdatingLabel,
    string StatusTitle,
    string ArmedSinceText,
    string LockText,
    string SentryText,
    string UnackSummaryText,
    string EmergencyTitle,
    string PanicButtonLabel,
    bool PanicPending,
    string PanicDescription,
    string SettingsTitle,
    string HomeGeofenceLabel,
    string HomeGeofenceHelp,
    string SensitivityLabel,
    string AutoPanicLabel,
    string AutoPanicHelp,
    string SaveSettingsLabel,
    bool SavePending,
    IReadOnlyList<GuardSensitivityOption> SensitivityOptions,
    IReadOnlyList<GuardGeofenceOption> GeofenceOptions,
    string SelectedSensitivity,
    string SelectedGeofenceId,
    bool AutoPanicChecked,
    string LiveMapTitle,
    bool HasLocation,
    double VehicleLat,
    double VehicleLng,
    string MarkerLabel,
    string MarkerPopupCoords,
    bool HasHomeGeofence,
    double HomeGeofenceLat,
    double HomeGeofenceLng,
    double HomeGeofenceRadius,
    string NoLocationMessage,
    string EventTimelineTitle,
    int UnacknowledgedCount,
    bool ShowUnackBadge,
    string UnackBadgeText,
    IReadOnlyList<GuardEventRow> Events,
    bool HasEvents,
    string NoEventsMessage,
    bool ShowTriggeredAlert,
    string AlertTriggeredTitle,
    string AlertEventLabel,
    string AlertTimeLabel,
    string PanicConfirmTitle,
    string PanicConfirmMessage,
    string PanicConfirmLabel);

/// <summary>
/// Pure projection from a <see cref="GuardModeModel"/> to the <see cref="GuardModeDisplay"/> — the native
/// port of the web component's derived values, the <c>EVENT_LABELS</c>/<c>EVENT_BADGE_VARIANT</c> lookups and
/// the status/settings/map/timeline copy. Every chrome string is resolved on every projection (regardless of
/// data state) so the view never holds an unlocalized literal; <c>now</c> is injected so relative times are
/// unit-tested deterministically.
/// </summary>
public static class GuardModeProjection
{
    /// <summary>Segoe Fluent shield glyph for the status icon (armed/disarmed) + empty surfaces.</summary>
    public const string ShieldGlyph = "\uEA18";
    private const string ShieldAlertGlyph = "\uE730";
    private const string AckGlyph = "\uE73E";
    private const string MapPinGlyph = "\uE707";
    private const string EmDash = "\u2014";
    private const string TestAlertType = "test_alert";

    // event_type → (severity, i18n key, fallback label) — a port of EVENT_LABELS + EVENT_BADGE_VARIANT in
    // web/src/features/vehicle-systems/pages/GuardModePage.tsx. Unknown types fall back to Info + the raw token.
    private static readonly Dictionary<string, GuardEventVisual> EventVisuals = new(StringComparer.Ordinal)
    {
        ["vehicle_moved"] = new(SeverityLevel.Critical, "guard.event.vehicleMoved", "Vehicle Moved"),
        ["unauthorized_unlock"] = new(SeverityLevel.Critical, "guard.event.unauthorizedUnlock", "Unauthorized Unlock"),
        ["unauthorized_drive"] = new(SeverityLevel.Critical, "guard.event.unauthorizedDrive", "Unauthorized Drive"),
        ["sentry_triggered"] = new(SeverityLevel.Warn, "guard.event.sentryTriggered", "Sentry Triggered"),
        ["manual_panic"] = new(SeverityLevel.Critical, "guard.event.manualPanic", "Manual Panic"),
        ["test_alert"] = new(SeverityLevel.Info, "guard.event.testAlert", "Test Alert"),
        ["locked"] = new(SeverityLevel.Info, "guard.event.locked", "Lock State Changed"),
        ["sentry_mode"] = new(SeverityLevel.Warn, "guard.event.sentryMode", "Sentry Mode"),
        ["valet_mode_enabled"] = new(SeverityLevel.Info, "guard.event.valetMode", "Valet Mode"),
    };

    /// <summary>Project the aggregate model into the localized display model.</summary>
    public static GuardModeDisplay Project(GuardModeModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        // ── Chrome strings (resolved on every projection regardless of state) ───────────────────────────
        string title = localizer.GetString("guard.title", "Guard Mode");
        string subtitle = localizer.GetString("guard.subtitle", "Anti-theft monitoring and emergency response");
        string armedLabel = localizer.GetString("guard.armed", "Armed");
        string disarmedLabel = localizer.GetString("guard.disarmed", "Disarmed");
        string triggeredLabel = localizer.GetString("guard.triggered", "TRIGGERED");
        string enableGuardLabel = localizer.GetString("guard.enableGuard", "Guard Mode");
        string updatingLabel = localizer.GetString("guard.updating", "Updating...");
        string statusTitle = localizer.GetString("guard.status", "Status");
        string armedSinceTemplate = localizer.GetString("guard.armedSince", "Armed since {{time}}");
        string notArmedLabel = localizer.GetString("guard.notArmed", "Not armed");
        string lockedLabel = localizer.GetString("guard.locked", "Vehicle locked");
        string unlockedLabel = localizer.GetString("guard.unlocked", "Vehicle unlocked");
        string sentryOnLabel = localizer.GetString("guard.sentryOn", "Sentry mode active");
        string sentryOffLabel = localizer.GetString("guard.sentryOff", "Sentry mode off");
        string unackEventsTemplate = localizer.GetString("guard.unackEvents", "{{count}} unacknowledged event(s)");
        string noEventsLabel = localizer.GetString("guard.noEvents", "No guard events yet");
        string emergencyTitle = localizer.GetString("guard.emergency", "Emergency");
        string panicButtonLabel = localizer.GetString("guard.panicButton", "PANIC");
        string panickingLabel = localizer.GetString("guard.panicking", "Sending...");
        string panicDescription = localizer.GetString("guard.panicDesc", "Flash lights, honk horn, lock doors, enable sentry, and notify all channels");
        string settingsTitle = localizer.GetString("guard.settings", "Guard Settings");
        string homeGeofenceLabel = localizer.GetString("guard.homeGeofence", "Home Geofence");
        string homeGeofenceHelp = localizer.GetString("guard.homeGeofenceHelp", "Vehicle will trigger alert if it leaves this area");
        string sensitivityLabel = localizer.GetString("guard.sensitivity", "Sensitivity");
        string autoPanicLabel = localizer.GetString("guard.autoPanic", "Auto-Panic on Trigger");
        string autoPanicHelp = localizer.GetString("guard.autoPanicHelp", "Automatically execute panic actions when guard is triggered");
        string saveSettingsLabel = localizer.GetString("guard.saveSettings", "Save Settings");
        string noGeofenceLabel = localizer.GetString("guard.noGeofence", "— No home geofence —");
        string liveMapTitle = localizer.GetString("guard.liveMap", "Live Vehicle Location");
        string noLocationMessage = localizer.GetString("guard.noLocation", "No vehicle location available");
        string eventTimelineTitle = localizer.GetString("guard.eventTimeline", "Event Timeline");
        string unackLabel = localizer.GetString("guard.unack", "unacknowledged");
        string acknowledgeLabel = localizer.GetString("guard.acknowledge", "Ack");
        string acknowledgedByLabel = localizer.GetString("guard.acknowledgedBy", "Acknowledged by");
        string alertTriggeredTitle = localizer.GetString("guard.alertTriggered", "Guard Alert Triggered!");
        string panicConfirmTitle = localizer.GetString("guard.panicConfirmTitle", "Activate Panic Mode?");
        string panicConfirmMessage = localizer.GetString("guard.panicConfirmMessage", "This will immediately flash lights, honk horn, lock doors, enable sentry mode, and send alerts to all notification channels.");
        string panicConfirmLabel = localizer.GetString("guard.panicConfirmLabel", "ACTIVATE PANIC");

        var sensitivityOptions = BuildSensitivityOptions(localizer);

        // ── Derived values (web parity) ────────────────────────────────────────────────────────────────
        var config = model.Config;
        bool isArmed = config?.Enabled ?? false;
        var events = model.Events ?? System.Array.Empty<GuardEvent>();
        int unackCount = events.Count(e => !e.IsAcknowledged);
        var latest = events.Count > 0 ? events[0] : null;
        bool isTriggered = latest is not null && !latest.IsAcknowledged && !string.Equals(latest.EventType, TestAlertType, StringComparison.Ordinal);

        GuardShieldState shield = isTriggered ? GuardShieldState.Triggered : isArmed ? GuardShieldState.Armed : GuardShieldState.Disarmed;
        string statusHeadline = isTriggered ? triggeredLabel : isArmed ? armedLabel : disarmedLabel;

        string effectiveSensitivity = !string.IsNullOrEmpty(model.FormSensitivity)
            ? model.FormSensitivity
            : !string.IsNullOrEmpty(config?.Sensitivity) ? config!.Sensitivity! : "medium";
        string effectiveGeofenceId = !string.IsNullOrEmpty(model.FormHomeGeofenceId)
            ? model.FormHomeGeofenceId
            : config?.HomeGeofenceId is { } gid ? gid.ToString(CultureInfo.InvariantCulture) : string.Empty;
        bool autoPanicChecked = model.FormAutoPanic || (config?.AutoPanic ?? false);

        // ── Status card lines ──────────────────────────────────────────────────────────────────────────
        string armedSinceText = isArmed && !string.IsNullOrEmpty(config?.UpdatedAt)
            ? Interpolate(armedSinceTemplate, "time", DateTimeFormatting.Format(GuardModeJson.TryParseTimestamp(config!.UpdatedAt), DateTimeVariant.Full, now))
            : notArmedLabel;
        string lockText = (model.VehicleState?.IsLocked ?? false) ? lockedLabel : unlockedLabel;
        string sentryText = (model.VehicleState?.SentryMode ?? false) ? sentryOnLabel : sentryOffLabel;
        string unackSummary = unackCount > 0
            ? Interpolate(unackEventsTemplate, "count", unackCount.ToString(CultureInfo.CurrentCulture))
            : noEventsLabel;

        // ── Settings — geofence options + home geofence lookup ──────────────────────────────────────────
        var geofences = model.Geofences ?? System.Array.Empty<GuardGeofence>();
        var geofenceOptions = new List<GuardGeofenceOption>(geofences.Count + 1)
        {
            new(string.Empty, noGeofenceLabel),
        };
        geofenceOptions.AddRange(geofences.Select(g => new GuardGeofenceOption(
            g.Id.ToString(CultureInfo.InvariantCulture),
            string.IsNullOrEmpty(g.Name) ? EmDash : g.Name)));

        var homeGeofence = geofences.FirstOrDefault(g => string.Equals(
            g.Id.ToString(CultureInfo.InvariantCulture), effectiveGeofenceId, StringComparison.Ordinal));

        // ── Live map ───────────────────────────────────────────────────────────────────────────────────
        var vehicleState = model.VehicleState;
        bool hasLocation = vehicleState?.HasLocation ?? false;
        double lat = vehicleState?.Latitude ?? 0;
        double lng = vehicleState?.Longitude ?? 0;
        string markerLabel = string.IsNullOrEmpty(model.VehicleName)
            ? localizer.GetString("guard.vehicle", "Vehicle")
            : model.VehicleName!;
        string markerPopupCoords = hasLocation
            ? string.Format(CultureInfo.InvariantCulture, "{0:F6}, {1:F6}", lat, lng)
            : string.Empty;

        // ── Event feed rows ────────────────────────────────────────────────────────────────────────────
        var rows = events
            .Select(e => MapEventRow(e, localizer, acknowledgeLabel, acknowledgedByLabel, now))
            .ToList();

        // ── Triggered banner ───────────────────────────────────────────────────────────────────────────
        string alertEventLabel = latest is not null ? EventLabel(latest, localizer) : string.Empty;
        string alertTime = latest is not null ? DateTimeFormatting.Format(latest.Timestamp, DateTimeVariant.Relative, now) : string.Empty;

        // ── State machine ──────────────────────────────────────────────────────────────────────────────
        bool hasData = config is not null || events.Count > 0 || hasLocation;
        GuardModeState state;
        bool showError;
        string errorMessage;
        if (model.Loading && !hasData)
        {
            state = GuardModeState.Loading;
            showError = false;
            errorMessage = string.Empty;
        }
        else if (model.HasError && !hasData)
        {
            state = GuardModeState.Error;
            showError = true;
            errorMessage = localizer.GetString("guard.loadError", "Couldn't load guard mode");
        }
        else if (model.VehicleId <= 0 || !hasData)
        {
            state = GuardModeState.Empty;
            showError = false;
            errorMessage = string.Empty;
        }
        else
        {
            state = GuardModeState.Success;
            showError = false;
            errorMessage = string.Empty;
        }

        return new GuardModeDisplay(
            State: state,
            IsLoading: state == GuardModeState.Loading,
            ShowError: showError,
            ErrorMessage: errorMessage,
            Title: title,
            Subtitle: subtitle,
            Shield: shield,
            StatusHeadline: statusHeadline,
            EnableGuardLabel: enableGuardLabel,
            IsArmed: isArmed,
            ShowUpdating: model.IsSavePending,
            UpdatingLabel: updatingLabel,
            StatusTitle: statusTitle,
            ArmedSinceText: armedSinceText,
            LockText: lockText,
            SentryText: sentryText,
            UnackSummaryText: unackSummary,
            EmergencyTitle: emergencyTitle,
            PanicButtonLabel: model.IsPanicPending ? panickingLabel : panicButtonLabel,
            PanicPending: model.IsPanicPending,
            PanicDescription: panicDescription,
            SettingsTitle: settingsTitle,
            HomeGeofenceLabel: homeGeofenceLabel,
            HomeGeofenceHelp: homeGeofenceHelp,
            SensitivityLabel: sensitivityLabel,
            AutoPanicLabel: autoPanicLabel,
            AutoPanicHelp: autoPanicHelp,
            SaveSettingsLabel: saveSettingsLabel,
            SavePending: model.IsSavePending,
            SensitivityOptions: sensitivityOptions,
            GeofenceOptions: geofenceOptions,
            SelectedSensitivity: effectiveSensitivity,
            SelectedGeofenceId: effectiveGeofenceId,
            AutoPanicChecked: autoPanicChecked,
            LiveMapTitle: liveMapTitle,
            HasLocation: hasLocation,
            VehicleLat: lat,
            VehicleLng: lng,
            MarkerLabel: markerLabel,
            MarkerPopupCoords: markerPopupCoords,
            HasHomeGeofence: homeGeofence is not null,
            HomeGeofenceLat: homeGeofence?.Latitude ?? 0,
            HomeGeofenceLng: homeGeofence?.Longitude ?? 0,
            HomeGeofenceRadius: homeGeofence?.Radius ?? 0,
            NoLocationMessage: noLocationMessage,
            EventTimelineTitle: eventTimelineTitle,
            UnacknowledgedCount: unackCount,
            ShowUnackBadge: unackCount > 0,
            UnackBadgeText: string.Format(CultureInfo.CurrentCulture, "{0} {1}", unackCount.ToString(CultureInfo.CurrentCulture), unackLabel),
            Events: rows,
            HasEvents: rows.Count > 0,
            NoEventsMessage: noEventsLabel,
            ShowTriggeredAlert: isTriggered && latest is not null,
            AlertTriggeredTitle: alertTriggeredTitle,
            AlertEventLabel: alertEventLabel,
            AlertTimeLabel: alertTime,
            PanicConfirmTitle: panicConfirmTitle,
            PanicConfirmMessage: panicConfirmMessage,
            PanicConfirmLabel: panicConfirmLabel);
    }

    /// <summary>Map a single guard event into its localized, severity-resolved display row (web <c>EventRow</c>).</summary>
    public static GuardEventRow MapEventRow(
        GuardEvent ev,
        ILocalizer localizer,
        string acknowledgeLabel,
        string acknowledgedByLabel,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(ev);
        ArgumentNullException.ThrowIfNull(localizer);

        bool acknowledged = ev.IsAcknowledged;
        var visual = EventVisuals.TryGetValue(ev.EventType, out var mapped)
            ? mapped
            : new GuardEventVisual(SeverityLevel.Info, $"guard.event.{ev.EventType}", string.IsNullOrEmpty(ev.EventType) ? EmDash : ev.EventType);

        var tokens = SeverityLevels.Tokens(visual.Severity);
        string label = localizer.GetString(visual.Key, visual.Label);
        string glyph = acknowledged ? AckGlyph : tokens.IconGlyph;
        string accent = acknowledged ? "TsColorTextMutedBrush" : tokens.AccentBrushKey;
        string timeLabel = DateTimeFormatting.Format(ev.Timestamp, DateTimeVariant.Relative, now);

        string? transition = ev.FromState is not null || ev.ToState is not null
            ? string.Format(CultureInfo.CurrentCulture, "{0} \u2192 {1}", ev.FromState ?? EmDash, ev.ToState ?? EmDash)
            : null;
        string? acknowledgedBy = !string.IsNullOrEmpty(ev.AcknowledgedBy)
            ? string.Format(CultureInfo.CurrentCulture, "{0}: {1}", acknowledgedByLabel, ev.AcknowledgedBy)
            : null;

        string automation = string.Format(CultureInfo.CurrentCulture, "{0}, {1}", label, timeLabel);

        return new GuardEventRow(
            Id: ev.Id,
            Glyph: glyph,
            AccentBrushKey: accent,
            BadgeStatus: ToStatus(visual.Severity),
            BadgeLabel: label,
            TimeLabel: timeLabel,
            TransitionText: transition,
            AcknowledgedByText: acknowledgedBy,
            Acknowledged: acknowledged,
            ShowAckButton: !acknowledged,
            AckLabel: acknowledgeLabel,
            AutomationName: automation);
    }

    /// <summary>The Segoe Fluent glyph for the status shield given its state.</summary>
    public static string ShieldGlyphFor(GuardShieldState shield) =>
        shield == GuardShieldState.Triggered ? ShieldAlertGlyph : ShieldGlyph;

    /// <summary>The map-pin glyph for the live-map empty surface.</summary>
    public static string MapEmptyGlyph => MapPinGlyph;

    private static string EventLabel(GuardEvent ev, ILocalizer localizer)
    {
        var visual = EventVisuals.TryGetValue(ev.EventType, out var mapped)
            ? mapped
            : new GuardEventVisual(SeverityLevel.Info, $"guard.event.{ev.EventType}", string.IsNullOrEmpty(ev.EventType) ? EmDash : ev.EventType);
        return localizer.GetString(visual.Key, visual.Label);
    }

    private static List<GuardSensitivityOption> BuildSensitivityOptions(ILocalizer localizer) => new()
    {
        new("low", localizer.GetString("guard.sensitivityLow", "Low — Movement > 1km")),
        new("medium", localizer.GetString("guard.sensitivityMedium", "Medium — Movement > 200m")),
        new("high", localizer.GetString("guard.sensitivityHigh", "High — Any movement")),
    };

    private static StatusKind ToStatus(SeverityLevel severity) => severity switch
    {
        SeverityLevel.Critical => StatusKind.Danger,
        SeverityLevel.Warn => StatusKind.Warning,
        SeverityLevel.Success => StatusKind.Success,
        _ => StatusKind.Info,
    };

    /// <summary>Replace a web i18next <c>{{token}}</c> marker with a literal value (never throws).</summary>
    public static string Interpolate(string template, string token, string value)
    {
        ArgumentNullException.ThrowIfNull(template);
        return template.Replace("{{" + token + "}}", value ?? string.Empty, StringComparison.Ordinal);
    }

    private readonly record struct GuardEventVisual(SeverityLevel Severity, string Key, string Label);
}
