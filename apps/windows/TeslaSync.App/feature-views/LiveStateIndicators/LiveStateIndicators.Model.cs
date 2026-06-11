using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="LiveStateIndicatorsViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches required by the P2 surface contract. The web
/// child (web/src/features/vehicles/components/vehicle-detail/LiveStateIndicators.tsx) is a pure component whose
/// parent page owns the <c>useVehicleState</c> query lifecycle; the native surface owns its own
/// cache-then-network read, so it reproduces every state visibly (none is ever hidden). <see cref="Empty"/>
/// covers a response that carries no usable vehicle-state object (the native analogue of the parent's query
/// resolving without a state to pass down).
/// </summary>
public enum LiveStateIndicatorsState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chips.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a state to render the five chips for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the chips plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the chips plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The vehicle-state slice the surface reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the exact <c>VehicleState</c> fields the web <c>LiveStateIndicators</c> consumes (web/src/api/types.ts): the
/// SI <see cref="Speed"/> (metres per second) plus the lock / sentry / climate / charging flags. Every field is
/// nullable so a missing key projects exactly like the web's falsy access (an absent boolean reads as off; an
/// absent speed reads as the em dash and an inactive chip). A <see langword="null"/> parse result models the
/// parent query resolving without a state (the empty surface).
/// </summary>
/// <param name="Speed">Vehicle speed in metres per second (SI), or null when not reported.</param>
/// <param name="IsLocked">Whether the vehicle is locked, or null when not reported.</param>
/// <param name="SentryMode">Whether sentry mode is armed, or null when not reported.</param>
/// <param name="IsClimateOn">Whether climate is running, or null when not reported.</param>
/// <param name="IsCharging">Whether the vehicle is charging, or null when not reported.</param>
public sealed record LiveStateIndicatorsReading(
    double? Speed,
    bool? IsLocked,
    bool? SentryMode,
    bool? IsClimateOn,
    bool? IsCharging)
{
    private const string StateProperty = "state";
    private const string VehicleIdProperty = "vehicle_id";

    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the state slice, mirroring the web
    /// <c>useVehicleState</c> read. The Go handler wraps the state in a <c>{ "state": { … }, "live": bool }</c>
    /// envelope, so the nested <c>state</c> object is preferred; a bare state object (no envelope) is also
    /// accepted. Returns <see langword="null"/> for a non-object body or a body whose state carries no
    /// <c>vehicle_id</c> — the native analogue of the parent query resolving without a state to render.
    /// </summary>
    public static LiveStateIndicatorsReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        JsonElement state = root.TryGetProperty(StateProperty, out var nested) && nested.ValueKind == JsonValueKind.Object
            ? nested
            : root;

        // Web parity: the hook treats a state without `vehicle_id` as not-a-state — the empty surface.
        if (!state.TryGetProperty(VehicleIdProperty, out var id) || id.ValueKind is JsonValueKind.Null or JsonValueKind.Undefined)
        {
            return null;
        }

        return new LiveStateIndicatorsReading(
            Speed: LiveStateJson.ReadDouble(state, "speed"),
            IsLocked: LiveStateJson.ReadBool(state, "is_locked"),
            SentryMode: LiveStateJson.ReadBool(state, "sentry_mode"),
            IsClimateOn: LiveStateJson.ReadBool(state, "is_climate_on"),
            IsCharging: LiveStateJson.ReadBool(state, "is_charging"));
    }
}

/// <summary>
/// Tolerant JSON readers for the vehicle-state slice. Each mirrors the web's permissive access — a missing /
/// null / wrong-kind field reads as <see langword="null"/> so a partial body never throws. The backend
/// serializes raw signal values, so booleans may arrive as booleans, numbers or boolean strings and the speed
/// may arrive as a number or numeric string; these readers narrow before use.
/// </summary>
internal static class LiveStateJson
{
    /// <summary>Read a finite number (number or numeric string), or null.</summary>
    public static double? ReadDouble(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
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

    /// <summary>Read a boolean (bool, numeric, or boolean string), or null when absent / wrong-kind.</summary>
    public static bool? ReadBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number when v.TryGetDouble(out var n) => n != 0,
            JsonValueKind.String when bool.TryParse(v.GetString(), out var b) => b,
            _ => null,
        };
    }
}

/// <summary>
/// One render-ready status chip in the row — the native analogue of a web <c>Badge</c> (Speed / Lock / Sentry /
/// Climate / Charging). The <see cref="Text"/> is pre-formatted (e.g. "Speed: 45 mph", "Locked", "Sentry:
/// Active") so the view is a thin renderer; <see cref="Status"/> drives the semantic tint (web <c>variant</c>)
/// and <see cref="AutomationName"/> carries the Narrator label.
/// </summary>
/// <param name="Key">Stable chip key (e.g. <c>speed</c>, <c>lock</c>).</param>
/// <param name="Text">The pre-formatted, localized chip text.</param>
/// <param name="Status">The semantic status driving the chip tint (web <c>variant</c>).</param>
/// <param name="AutomationName">The Narrator name for the chip.</param>
public sealed record LiveStateIndicator(
    string Key,
    string Text,
    StatusKind Status,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the live-state-indicators surface — the native analogue of the
/// five badges the web component emits, each already formatted and status-tinted, plus the localized surface
/// title used as the accessible group name. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Title">The localized accessible group name for the chip row.</param>
/// <param name="AutomationName">The Narrator name for the surface (the title).</param>
/// <param name="Indicators">The five status chips in web order.</param>
public sealed record LiveStateIndicatorsDisplay(
    string Title,
    string AutomationName,
    IReadOnlyList<LiveStateIndicator> Indicators);

/// <summary>
/// Canonical registry metadata for the Live State Indicators surface — the native anchor for the diagnostics
/// slug and the localized chrome copy. The web child has no registry entry (it is a page child); the native
/// surface still carries a stable id / slug for hosting and the P1/S11 diagnostics contract. The five chip
/// labels resolve through the shared <c>common.*</c> i18n keys the web component uses; the chrome copy reuses
/// the web vehicle-detail section keys where they exist.
/// </summary>
public static class LiveStateIndicatorsRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "live-state-indicators";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveStateIndicators";

    /// <summary>i18n key for the accessible group name.</summary>
    public const string TitleKey = "vehicles.detail.liveState";

    /// <summary>English fallback for the accessible group name.</summary>
    public const string TitleFallback = "Live State";

    /// <summary>i18n key for the loading affordance label.</summary>
    public const string LoadingKey = "vehicles.detail.liveState.loading";

    /// <summary>English fallback for the loading affordance label.</summary>
    public const string LoadingFallback = "Loading live state";

    /// <summary>i18n key for the empty-state message.</summary>
    public const string EmptyKey = "vehicles.detail.liveState.empty";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyFallback = "No live state data available";

    /// <summary>i18n key for the error message (web vehicle-detail section error boundary).</summary>
    public const string ErrorKey = "vehicles.detail.section.liveStateFailed";

    /// <summary>English fallback for the error message.</summary>
    public const string ErrorFallback = "Live state indicators failed to load";

    /// <summary>Localized accessible group name.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Localized loading affordance label.</summary>
    public static string LoadingMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LoadingKey, LoadingFallback);
    }

    /// <summary>Localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }

    /// <summary>Localized error message.</summary>
    public static string ErrorMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ErrorKey, ErrorFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the Live State Indicators surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a speed, lock, sentry, climate or charging
/// value, VIN or vehicle id — so a diagnostics line can never leak fleet or owner-presence data. Thread-safe.
/// </summary>
public sealed class LiveStateIndicatorsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveStateIndicatorsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveStateIndicators</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveStateIndicatorsRegistration.Slug}");
    }
}

/// <summary>
/// Pure projection from a raw <see cref="LiveStateIndicatorsReading"/> to the display model — the native port of
/// the web <c>LiveStateIndicators</c> JSX: the five chips in web order (Speed / Lock / Sentry / Climate /
/// Charging), each with the same text and the same <c>variant</c> rule. The speed is converted at the display
/// boundary through the shared <see cref="UnitFormatters"/> (web <c>useUnits().formatSpeed</c>); every label
/// resolves through the i18n facade. Kept UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class LiveStateIndicatorsProjection
{
    private const int SpeedPrecision = 0;

    /// <summary>Project <paramref name="reading"/> into the five render-ready chips for <paramref name="units"/>.</summary>
    public static LiveStateIndicatorsDisplay Project(
        LiveStateIndicatorsReading reading,
        UnitPref units,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(units);
        ArgumentNullException.ThrowIfNull(localizer);

        var indicators = new List<LiveStateIndicator>(5)
        {
            SpeedChip(reading.Speed, units, localizer),
            LockChip(reading.IsLocked, localizer),
            SentryChip(reading.SentryMode, localizer),
            ClimateChip(reading.IsClimateOn, localizer),
            ChargingChip(reading.IsCharging, localizer),
        };

        string title = LiveStateIndicatorsRegistration.Name(localizer);
        return new LiveStateIndicatorsDisplay(title, title, indicators);
    }

    // Web: variant={state.speed > 0 ? 'success' : 'neutral'} — "Speed: {formatSpeed(speed, { precision: 0 })}".
    private static LiveStateIndicator SpeedChip(double? speed, UnitPref units, ILocalizer localizer)
    {
        string label = localizer.GetString("common.speed", "Speed");
        string value = UnitFormatters.FormatSpeed(speed, units, SpeedPrecision);
        string text = $"{label}: {value}";
        var status = (speed ?? 0) > 0 ? StatusKind.Success : StatusKind.Neutral;
        return new LiveStateIndicator("speed", text, status, text);
    }

    // Web: variant={is_locked ? 'success' : 'danger'} — is_locked ? "Locked" : "Unlocked".
    private static LiveStateIndicator LockChip(bool? isLocked, ILocalizer localizer)
    {
        bool locked = isLocked == true;
        string text = locked
            ? localizer.GetString("common.locked", "Locked")
            : localizer.GetString("common.unlocked", "Unlocked");
        return new LiveStateIndicator("lock", text, locked ? StatusKind.Success : StatusKind.Danger, text);
    }

    // Web: variant={sentry_mode ? 'warning' : 'neutral'} — "Sentry: {sentry_mode ? 'Active' : 'Off'}".
    private static LiveStateIndicator SentryChip(bool? sentry, ILocalizer localizer)
    {
        bool active = sentry == true;
        string label = localizer.GetString("common.sentry", "Sentry");
        string value = active
            ? localizer.GetString("common.active", "Active")
            : localizer.GetString("common.off", "Off");
        string text = $"{label}: {value}";
        return new LiveStateIndicator("sentry", text, active ? StatusKind.Warning : StatusKind.Neutral, text);
    }

    // Web: variant={is_climate_on ? 'info' : 'neutral'} — "Climate: {is_climate_on ? 'On' : 'Off'}".
    private static LiveStateIndicator ClimateChip(bool? climate, ILocalizer localizer)
    {
        bool on = climate == true;
        string label = localizer.GetString("common.climate", "Climate");
        string value = on
            ? localizer.GetString("common.on", "On")
            : localizer.GetString("common.off", "Off");
        string text = $"{label}: {value}";
        return new LiveStateIndicator("climate", text, on ? StatusKind.Info : StatusKind.Neutral, text);
    }

    // Web: variant={is_charging ? 'warning' : 'neutral'} — is_charging ? "Charging" : "Not Charging".
    private static LiveStateIndicator ChargingChip(bool? charging, ILocalizer localizer)
    {
        bool on = charging == true;
        string text = on
            ? localizer.GetString("common.charging", "Charging")
            : localizer.GetString("common.notCharging", "Not Charging");
        return new LiveStateIndicator("charging", text, on ? StatusKind.Warning : StatusKind.Neutral, text);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;LiveStateIndicatorsReading&gt;</c>, preserving every freshness flag (cached /
/// refreshing / stale / offline). A successful emission whose body carries no usable state collapses to
/// <see cref="RepositoryResult{T}.Empty(System.DateTimeOffset?)"/> — the native analogue of the parent query
/// resolving without a state to render. Kept pure so the parse-and-preserve contract is unit-tested without a
/// network or cache.
/// </summary>
public static class LiveStateIndicatorsResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<LiveStateIndicatorsReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        LiveStateIndicatorsReading? Parse() => raw.HasValue ? LiveStateIndicatorsReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<LiveStateIndicatorsReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<LiveStateIndicatorsReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<LiveStateIndicatorsReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<LiveStateIndicatorsReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<LiveStateIndicatorsReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<LiveStateIndicatorsReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<LiveStateIndicatorsReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<LiveStateIndicatorsReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<LiveStateIndicatorsReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<LiveStateIndicatorsReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<LiveStateIndicatorsReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
