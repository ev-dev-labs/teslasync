using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The lifecycle state a <see cref="LiveVehicleStateViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches required by the P2 surface contract. The web
/// child (web/src/features/admin/components/security-access/LiveVehicleState.tsx) is a pure component whose
/// parent page owns the query lifecycle; the native surface owns its own cache-then-network read, so it
/// reproduces every state visibly (none is ever hidden). <see cref="Empty"/> mirrors the web
/// <c>liveSignals.length &gt; 0 ? grid : &lt;EmptyState/&gt;</c> gate — an absent <c>latest</c> security event
/// yields the "No live state data available" surface.
/// </summary>
public enum LiveVehicleStateState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton.</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a security event to render the signal tiles for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no security object — render the empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the tiles plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the tiles plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// A signal value the backend may serialize either as a boolean or as a string (the web
/// <c>string | boolean | null</c> union, e.g. <c>speed_limit_mode</c>). Exactly one of <see cref="Bool"/> /
/// <see cref="Text"/> is set (or neither when absent), so the projection can reproduce the web's
/// <c>typeof value === 'boolean'</c> branch faithfully. The empty value (<see cref="None"/>) models a missing
/// or wrong-kind field — the em-dash / inactive branch.
/// </summary>
/// <param name="Bool">The boolean form, when the field arrived as a JSON boolean.</param>
/// <param name="Text">The string form, when the field arrived as a JSON string.</param>
public readonly record struct UnionSignal(bool? Bool, string? Text)
{
    /// <summary>The absent value — neither a boolean nor a string was present.</summary>
    public static UnionSignal None => default;

    /// <summary>True when neither form is present (web <c>value == null</c>).</summary>
    public bool IsAbsent => Bool is null && Text is null;

    /// <summary>Read <paramref name="name"/> from <paramref name="obj"/> as a boolean-or-string union.</summary>
    public static UnionSignal From(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return None;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => new UnionSignal(true, null),
            JsonValueKind.False => new UnionSignal(false, null),
            JsonValueKind.String => new UnionSignal(null, v.GetString()),
            _ => None,
        };
    }
}

/// <summary>
/// The security fields the surface reads from <c>GET /security/latest?vehicle_id={id}</c> — the native mirror of
/// the exact <c>SecurityEvent</c> slice the web <c>LiveVehicleState</c> consumes (web/src/types/admin.ts). Every
/// field is nullable so a missing key projects to the em dash exactly like the web <c>!= null</c> / type-guard
/// checks. A <see langword="null"/> parse result models the web <c>latest</c> being undefined (no security object
/// → the empty surface, since <c>buildLiveSignals</c> returns <c>[]</c>); an object with every field missing
/// still parses to a reading (all-null fields) so the panel renders ten tiles of em dashes, matching the web
/// <c>liveSignals.length &gt; 0</c> gate (ten entries are always produced for a non-null event).
/// </summary>
/// <param name="LightsHazardsActive">Hazard lights flashing (web <c>lights_hazards_active</c>); null when absent.</param>
/// <param name="LightsHighBeams">High beams on (web <c>lights_high_beams</c>); null when absent.</param>
/// <param name="LightsTurnSignal">Turn-signal label (web <c>lights_turn_signal</c>); null when absent.</param>
/// <param name="DriverSeatOccupied">Driver seat occupied (web <c>driver_seat_occupied</c>); null when absent.</param>
/// <param name="PairedPhoneKeyCount">Paired phone-key / fob count (web <c>paired_phone_key_count</c>); null when absent.</param>
/// <param name="ValetModeEnabled">Valet mode enabled (web <c>valet_mode_enabled</c>); null when absent.</param>
/// <param name="ServiceMode">Service mode enabled (web <c>service_mode</c>); null when absent.</param>
/// <param name="SpeedLimitMode">Speed-limit mode, a bool-or-string union (web <c>speed_limit_mode</c>).</param>
/// <param name="HomelinkDeviceCount">Paired HomeLink device count (web <c>homelink_device_count</c>); null when absent.</param>
/// <param name="CenterDisplay">Center-display state label (web <c>center_display</c>); null when absent or non-string.</param>
public sealed record VehicleSecurityReading(
    bool? LightsHazardsActive,
    bool? LightsHighBeams,
    string? LightsTurnSignal,
    bool? DriverSeatOccupied,
    double? PairedPhoneKeyCount,
    bool? ValetModeEnabled,
    bool? ServiceMode,
    UnionSignal SpeedLimitMode,
    double? HomelinkDeviceCount,
    string? CenterDisplay)
{
    /// <summary>
    /// Project a <c>GET /security/latest</c> response into the security slice, mirroring the web reads. Returns
    /// <see langword="null"/> for a non-object body — the native analogue of the web <c>latest</c> being
    /// undefined (<c>buildLiveSignals</c> returns <c>[]</c> → the empty surface). An object with missing fields
    /// still parses (all-null) so the ten tiles render em dashes exactly like the web.
    /// </summary>
    public static VehicleSecurityReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new VehicleSecurityReading(
            LightsHazardsActive: SecurityJson.ReadBool(root, "lights_hazards_active"),
            LightsHighBeams: SecurityJson.ReadBool(root, "lights_high_beams"),
            LightsTurnSignal: SecurityJson.ReadString(root, "lights_turn_signal"),
            DriverSeatOccupied: SecurityJson.ReadBool(root, "driver_seat_occupied"),
            PairedPhoneKeyCount: SecurityJson.ReadDouble(root, "paired_phone_key_count"),
            ValetModeEnabled: SecurityJson.ReadBool(root, "valet_mode_enabled"),
            ServiceMode: SecurityJson.ReadBool(root, "service_mode"),
            SpeedLimitMode: UnionSignal.From(root, "speed_limit_mode"),
            HomelinkDeviceCount: SecurityJson.ReadDouble(root, "homelink_device_count"),
            CenterDisplay: SecurityJson.ReadString(root, "center_display"));
    }
}

/// <summary>
/// Tolerant JSON readers for the security slice. Each mirrors the web's permissive access — a missing / null /
/// wrong-kind field reads as <see langword="null"/> so a partial body never throws and each tile independently
/// shows the em dash exactly like the web per-field type guards (<c>asNonEmptyString</c> / <c>!= null</c>). The
/// backend serializes raw <c>signal.SignalValue</c>, so booleans may arrive as booleans, numbers or boolean
/// strings; these readers narrow before use (the canonical <c>web/src/lib/typeGuards.ts</c> invariant: never
/// coerce a non-string to a string).
/// </summary>
internal static class SecurityJson
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

    /// <summary>Read a string value (string kind only), or null — never coerces a boolean / number to text.</summary>
    public static string? ReadString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

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
/// One render-ready signal tile in the grid — the native analogue of a web <c>LiveSignal</c> (Hazards / High
/// Beams / Turn Signal / Driver Seat / Paired Keys / Valet Mode / Service Mode / Speed Limit / HomeLink Devices /
/// Center Display). The value is pre-formatted (On / Off / Occupied / Empty / a count / a raw label / the em
/// dash) so the view is a thin renderer; <see cref="Active"/> drives the cyan-vs-muted tint (web
/// <c>sig.active</c>) and <see cref="AutomationName"/> carries the Narrator label combining label and value.
/// </summary>
/// <param name="Key">Stable signal key (web <c>sig.key</c>, e.g. <c>hazards</c>).</param>
/// <param name="Label">The localized tile label.</param>
/// <param name="Glyph">The Segoe Fluent glyph for the tile (native analogue of the web lucide icon).</param>
/// <param name="ValueText">The pre-formatted value (e.g. "On", "Occupied", "2", or the em dash).</param>
/// <param name="Active">Whether the signal is active (drives the accent tint).</param>
/// <param name="AutomationName">The Narrator name combining label and value.</param>
public sealed record LiveVehicleSignal(
    string Key,
    string Label,
    string Glyph,
    string ValueText,
    bool Active,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the live-vehicle-state surface — the native analogue of everything
/// the web component computes before returning JSX (the ten signal tiles, each already formatted / active-flagged
/// / em-dash-guarded, plus the title and the "Live" indicator label). Pure data so the projection is unit-tested
/// without a UI host.
/// </summary>
/// <param name="Title">The localized surface title ("Live Vehicle State").</param>
/// <param name="AutomationName">The Narrator name for the surface (the title).</param>
/// <param name="LiveIndicator">The localized "Live" indicator label shown when a security event is present.</param>
/// <param name="Signals">The ten signal tiles in web order.</param>
public sealed record LiveVehicleStateDisplay(
    string Title,
    string AutomationName,
    string LiveIndicator,
    IReadOnlyList<LiveVehicleSignal> Signals);

/// <summary>
/// Canonical registry metadata for the Live Vehicle State surface — the native anchor for the diagnostics slug
/// and the localized copy. The web child has no registry entry (it is a page child); the native surface still
/// carries a stable id / slug for hosting and the P1/S11 diagnostics contract. Every key resolves through the
/// i18n facade against the web's <c>admin.security.*</c> catalog keys.
/// </summary>
public static class LiveVehicleStateRegistration
{
    /// <summary>Stable surface id.</summary>
    public const string Id = "live-vehicle-state";

    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveVehicleState";

    /// <summary>i18n key for the surface title (web <c>admin.security.liveState</c>).</summary>
    public const string TitleKey = "admin.security.liveState";

    /// <summary>English fallback for the surface title.</summary>
    public const string TitleFallback = "Live Vehicle State";

    /// <summary>i18n key for the empty-state message (web <c>admin.security.live.noData</c>).</summary>
    public const string EmptyKey = "admin.security.live.noData";

    /// <summary>English fallback for the empty-state message.</summary>
    public const string EmptyFallback = "No live state data available";

    /// <summary>i18n key for the "Live" indicator label (web <c>admin.security.live.indicator</c>).</summary>
    public const string LiveKey = "admin.security.live.indicator";

    /// <summary>English fallback for the "Live" indicator label.</summary>
    public const string LiveFallback = "Live";

    /// <summary>Localized surface title.</summary>
    public static string Name(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TitleKey, TitleFallback);
    }

    /// <summary>Localized empty-state message.</summary>
    public static string EmptyMessage(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(EmptyKey, EmptyFallback);
    }

    /// <summary>Localized "Live" indicator label.</summary>
    public static string LiveIndicator(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(LiveKey, LiveFallback);
    }
}

/// <summary>
/// PII-safe diagnostics for the Live Vehicle State surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a lock / sentry / seat / key value, VIN or
/// vehicle id — so a diagnostics line can never leak fleet or owner-presence data. Thread-safe.
/// </summary>
public sealed class LiveVehicleStateDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveVehicleStateDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveVehicleState</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveVehicleStateRegistration.Slug}");
    }
}

/// <summary>
/// Pure projection from a raw <see cref="VehicleSecurityReading"/> to the display model — the native port of the
/// web <c>buildLiveSignals</c> + the <c>LiveVehicleState</c> JSX: the ten tiles in web order, each with the same
/// value text (On / Off / Occupied / Empty / count / label / em dash) and the same <c>active</c> rule. Every
/// label resolves through the i18n facade. Kept UI-free so it is unit-tested without a XAML host.
/// </summary>
public static class LiveVehicleStateProjection
{
    /// <summary>Em dash shown when a signal has no value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Segoe Fluent glyph for the Hazards tile (web lucide <c>Flashlight</c>).</summary>
    public const string HazardsGlyph = "\uE754";

    /// <summary>Segoe Fluent glyph for the High Beams tile (web lucide <c>Lightbulb</c>).</summary>
    public const string HighBeamsGlyph = "\uEA80";

    /// <summary>Segoe Fluent glyph for the Turn Signal tile (web lucide <c>Signal</c>).</summary>
    public const string TurnSignalGlyph = "\uE890";

    /// <summary>Segoe Fluent glyph for the Driver Seat tile (web lucide <c>Armchair</c>).</summary>
    public const string DriverSeatGlyph = "\uE77B";

    /// <summary>Segoe Fluent glyph for the Paired Keys tile (web lucide <c>Key</c>).</summary>
    public const string PairedKeysGlyph = "\uE192";

    /// <summary>Segoe Fluent glyph for the Valet Mode tile (web lucide <c>Car</c>).</summary>
    public const string ValetModeGlyph = "\uE804";

    /// <summary>Segoe Fluent glyph for the Service Mode tile (web lucide <c>Wrench</c>).</summary>
    public const string ServiceModeGlyph = "\uE90F";

    /// <summary>Segoe Fluent glyph for the Speed Limit tile (web lucide <c>Gauge</c>).</summary>
    public const string SpeedLimitGlyph = "\uE9D9";

    /// <summary>Segoe Fluent glyph for the HomeLink Devices tile (web lucide <c>Home</c>).</summary>
    public const string HomelinkGlyph = "\uE80F";

    /// <summary>Segoe Fluent glyph for the Center Display tile (web lucide <c>Monitor</c>).</summary>
    public const string CenterDisplayGlyph = "\uE7F4";

    private const string OffToken = "off";

    /// <summary>Project <paramref name="reading"/> into the ten render-ready tiles, localizing every label.</summary>
    public static LiveVehicleStateDisplay Project(VehicleSecurityReading reading, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        var signals = new List<LiveVehicleSignal>(10)
        {
            Signal(
                "hazards",
                localizer.GetString("admin.security.live.hazards", "Hazards"),
                HazardsGlyph,
                BoolLabel(reading.LightsHazardsActive, localizer),
                reading.LightsHazardsActive == true),
            Signal(
                "highBeams",
                localizer.GetString("admin.security.live.highBeams", "High Beams"),
                HighBeamsGlyph,
                BoolLabel(reading.LightsHighBeams, localizer),
                reading.LightsHighBeams == true),
            Signal(
                "turnSignal",
                localizer.GetString("admin.security.live.turnSignal", "Turn Signal"),
                TurnSignalGlyph,
                NonEmpty(reading.LightsTurnSignal) ?? EmDash,
                IsActiveText(reading.LightsTurnSignal)),
            Signal(
                "driverSeat",
                localizer.GetString("admin.security.live.driverSeat", "Driver Seat"),
                DriverSeatGlyph,
                SeatLabel(reading.DriverSeatOccupied, localizer),
                reading.DriverSeatOccupied == true),
            Signal(
                "pairedKeys",
                localizer.GetString("admin.security.live.pairedKeys", "Paired Keys"),
                PairedKeysGlyph,
                Count(reading.PairedPhoneKeyCount),
                (reading.PairedPhoneKeyCount ?? 0) > 0),
            Signal(
                "valetMode",
                localizer.GetString("admin.security.live.valetMode", "Valet Mode"),
                ValetModeGlyph,
                BoolLabel(reading.ValetModeEnabled, localizer),
                reading.ValetModeEnabled == true),
            Signal(
                "serviceMode",
                localizer.GetString("admin.security.live.serviceMode", "Service Mode"),
                ServiceModeGlyph,
                BoolLabel(reading.ServiceMode, localizer),
                reading.ServiceMode == true),
            SpeedLimitSignal(
                localizer.GetString("admin.security.live.speedLimit", "Speed Limit"),
                reading.SpeedLimitMode,
                localizer),
            Signal(
                "homelinkDevices",
                localizer.GetString("admin.security.live.homelinkDevices", "HomeLink Devices"),
                HomelinkGlyph,
                Count(reading.HomelinkDeviceCount),
                (reading.HomelinkDeviceCount ?? 0) > 0),
            Signal(
                "centerDisplay",
                localizer.GetString("admin.security.live.centerDisplay", "Center Display"),
                CenterDisplayGlyph,
                NonEmpty(reading.CenterDisplay) ?? EmDash,
                IsActiveText(reading.CenterDisplay)),
        };

        string title = LiveVehicleStateRegistration.Name(localizer);
        string live = LiveVehicleStateRegistration.LiveIndicator(localizer);
        return new LiveVehicleStateDisplay(title, title, live, signals);
    }

    // Web boolLabel: null → '—', true → On, false → Off.
    private static string BoolLabel(bool? value, ILocalizer localizer)
    {
        if (value is not { } b)
        {
            return EmDash;
        }

        return b
            ? localizer.GetString("admin.security.on", "On")
            : localizer.GetString("admin.security.off", "Off");
    }

    // Web driver-seat label: null → '—', occupied → Occupied, otherwise → Empty.
    private static string SeatLabel(bool? occupied, ILocalizer localizer)
    {
        if (occupied is not { } o)
        {
            return EmDash;
        }

        return o
            ? localizer.GetString("admin.security.live.occupied", "Occupied")
            : localizer.GetString("admin.security.live.empty", "Empty");
    }

    // Web speed-limit signal: boolean → On / Off (active = the boolean); else asNonEmptyString ?? '—'
    // (active = present and not "off").
    private static LiveVehicleSignal SpeedLimitSignal(string label, UnionSignal mode, ILocalizer localizer)
    {
        if (mode.Bool is { } b)
        {
            string value = b
                ? localizer.GetString("admin.security.on", "On")
                : localizer.GetString("admin.security.off", "Off");
            return Signal("speedLimit", label, SpeedLimitGlyph, value, b);
        }

        string? text = NonEmpty(mode.Text);
        return Signal("speedLimit", label, SpeedLimitGlyph, text ?? EmDash, IsActiveText(mode.Text));
    }

    // Web String(count): the integer count, or '—' when null. Integral values render without decimals.
    private static string Count(double? value)
    {
        if (value is not { } v)
        {
            return EmDash;
        }

        if (!double.IsNaN(v) && !double.IsInfinity(v) && v == Math.Floor(v))
        {
            return ((long)v).ToString(CultureInfo.InvariantCulture);
        }

        return v.ToString(CultureInfo.InvariantCulture);
    }

    // Web asNonEmptyString: the string only when it is non-empty; null otherwise.
    private static string? NonEmpty(string? value) => string.IsNullOrEmpty(value) ? null : value;

    // Web active rule for string signals: a non-empty string that does not contain "off" (case-insensitive).
    private static bool IsActiveText(string? value)
    {
        string? s = NonEmpty(value);
        return s is not null && !s.Contains(OffToken, StringComparison.OrdinalIgnoreCase);
    }

    private static LiveVehicleSignal Signal(string key, string label, string glyph, string valueText, bool active) =>
        new(key, label, glyph, valueText, active, $"{label} {valueText}");
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;VehicleSecurityReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no security object collapses to
/// <see cref="RepositoryResult{T}.Empty(System.DateTimeOffset?)"/> — the native analogue of the web
/// <c>liveSignals.length &gt; 0 ? grid : empty</c> gate (an absent <c>latest</c> yields no signals). Kept pure so
/// the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class LiveVehicleStateResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<VehicleSecurityReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        VehicleSecurityReading? Parse() => raw.HasValue ? VehicleSecurityReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<VehicleSecurityReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<VehicleSecurityReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VehicleSecurityReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<VehicleSecurityReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<VehicleSecurityReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<VehicleSecurityReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<VehicleSecurityReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<VehicleSecurityReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<VehicleSecurityReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<VehicleSecurityReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<VehicleSecurityReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
