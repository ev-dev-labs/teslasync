using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="SafetyHistoryViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SafetyHistoryWidget</c>
/// renders through <c>WidgetShell</c> + <c>WidgetEventFeed</c>
/// (web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>list.length === 0</c> gate —
/// no ADAS snapshot at all — and is distinct from a transport failure (<see cref="Error"/>).
/// </summary>
public enum SafetyHistoryState
{
    /// <summary>Initial fetch with no cached history — render the skeleton chrome.</summary>
    Loading,

    /// <summary>A fresh list (or non-stale cache) carrying at least one ADAS snapshot.</summary>
    Loaded,

    /// <summary>No vehicle resolved, or no snapshot at all — render the friendly empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached list exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached list older than the freshness window — render content plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached list remains — render content plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The runtime shape a raw safety-enum field can arrive in. The Go API serializes raw
/// <c>signal.SignalValue</c> (<c>interface{}</c>) directly via <c>/safety</c>, so one "string"-typed
/// ADAS field can land as a native bool, a native number, the typed enum string, or be absent. This
/// discriminator lets <see cref="SafetyEnums"/> branch on the real runtime kind exactly as the web
/// <c>lib/safetyEnum.ts</c> does, instead of coercing a non-string to a string.
/// </summary>
public enum SafetyValueKind
{
    /// <summary>The field was absent or JSON null/undefined (web <c>value == null</c>).</summary>
    None,

    /// <summary>A native boolean (web <c>typeof value === 'boolean'</c>).</summary>
    Bool,

    /// <summary>A native finite number (web <c>asFiniteNumber(value) !== null</c>).</summary>
    Number,

    /// <summary>A non-null string (web <c>asNonEmptyString</c> / <c>asString</c> path).</summary>
    Str,
}

/// <summary>
/// A single polymorphic safety-enum value read from a <c>/safety</c> snapshot — the native analogue of
/// the <c>string | boolean | number | null</c> union the web <c>SafetySnapshot</c> declares for ADAS
/// fields. Carries the runtime <see cref="Kind"/> plus the kind-specific payload so callers can
/// reproduce the web's type-aware classification without ever calling a string method on a value whose
/// shape they don't control.
/// </summary>
/// <param name="Kind">The runtime discriminator.</param>
/// <param name="BoolValue">The boolean payload (valid only when <see cref="Kind"/> is <see cref="SafetyValueKind.Bool"/>).</param>
/// <param name="NumberValue">The numeric payload (valid only when <see cref="Kind"/> is <see cref="SafetyValueKind.Number"/>).</param>
/// <param name="StringValue">The string payload (valid only when <see cref="Kind"/> is <see cref="SafetyValueKind.Str"/>).</param>
public readonly record struct SafetyValue(SafetyValueKind Kind, bool BoolValue, double NumberValue, string? StringValue)
{
    /// <summary>The absent value (web null/undefined).</summary>
    public static SafetyValue None => new(SafetyValueKind.None, false, 0, null);

    /// <summary>A boolean value.</summary>
    public static SafetyValue OfBool(bool value) => new(SafetyValueKind.Bool, value, 0, null);

    /// <summary>A finite numeric value.</summary>
    public static SafetyValue OfNumber(double value) => new(SafetyValueKind.Number, false, value, null);

    /// <summary>A string value.</summary>
    public static SafetyValue OfString(string value) => new(SafetyValueKind.Str, false, 0, value);

    /// <summary>True when the field carried a value (web <c>value != null</c>).</summary>
    public bool IsPresent => Kind != SafetyValueKind.None;

    /// <summary>Read property <paramref name="name"/> from <paramref name="obj"/> as a tolerant polymorphic value.</summary>
    public static SafetyValue FromJson(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return None;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => OfBool(true),
            JsonValueKind.False => OfBool(false),
            JsonValueKind.Number when v.TryGetDouble(out var n) && !double.IsNaN(n) && !double.IsInfinity(n) => OfNumber(n),
            JsonValueKind.String => OfString(v.GetString() ?? string.Empty),
            _ => None,
        };
    }

    /// <summary>
    /// Render the raw value the way the web <c>String(value)</c> coercion does (booleans as
    /// <c>"true"</c>/<c>"false"</c>, numbers in their shortest decimal form, strings verbatim). Used by
    /// the subtitle builder, which stringifies <c>speed_limit_warning</c> / <c>cruise_follow_distance</c>
    /// without cleaning them.
    /// </summary>
    public string AsRawString() => Kind switch
    {
        SafetyValueKind.Bool => BoolValue ? "true" : "false",
        SafetyValueKind.Number => NumberValue.ToString(CultureInfo.InvariantCulture),
        SafetyValueKind.Str => StringValue ?? string.Empty,
        _ => string.Empty,
    };
}

/// <summary>
/// The ADAS field whose enum prefix needs stripping — the native port of the keys of
/// <c>SAFETY_ENUM_PREFIXES</c> in web/src/lib/safetyEnum.ts.
/// </summary>
public enum SafetyEnumField
{
    /// <summary>Forward collision warning (prefix <c>ForwardCollisionSensitivity</c>).</summary>
    ForwardCollisionWarning,

    /// <summary>Lane departure avoidance (prefix <c>LaneAssistLevel</c>).</summary>
    LaneDepartureAvoidance,

    /// <summary>Speed limit warning (prefix <c>SpeedAssistLevel</c>).</summary>
    SpeedLimitWarning,

    /// <summary>Cruise follow distance (prefix <c>FollowDistance</c>).</summary>
    CruiseFollowDistance,
}

/// <summary>
/// Safety-enum normalization — a faithful native port of web/src/lib/safetyEnum.ts. It is the single
/// choke point through which every raw ADAS value is funnelled, so a boolean <c>false</c> can never be
/// stringified into <c>"false"</c> and mis-classified as an active feature. <see cref="Clean"/> renders a
/// human value (with caller-supplied localized on/off so no English literal lives here);
/// <see cref="IsActive"/> answers the enabled/disabled question against the canonical English tokens the
/// web compares to.
/// </summary>
public static class SafetyEnums
{
    /// <summary>The Tesla raw-enum prefix to strip for a field, or null when none applies.</summary>
    public static string? Prefix(SafetyEnumField field) => field switch
    {
        SafetyEnumField.ForwardCollisionWarning => "ForwardCollisionSensitivity",
        SafetyEnumField.LaneDepartureAvoidance => "LaneAssistLevel",
        SafetyEnumField.SpeedLimitWarning => "SpeedAssistLevel",
        SafetyEnumField.CruiseFollowDistance => "FollowDistance",
        _ => null,
    };

    /// <summary>
    /// Convert a raw safety-enum value into a human-renderable, prefix-stripped string (web
    /// <c>cleanSafetyEnum</c>). Booleans render as <paramref name="on"/> / <paramref name="off"/>; finite
    /// numbers render in decimal; numeric strings and enum suffixes pass through after prefix stripping;
    /// an absent/empty value returns <paramref name="fallback"/>.
    /// </summary>
    public static string Clean(SafetyValue value, SafetyEnumField field, string on, string off, string fallback)
    {
        if (value.Kind == SafetyValueKind.Bool)
        {
            return value.BoolValue ? on : off;
        }

        if (value.Kind == SafetyValueKind.Number)
        {
            return value.NumberValue.ToString(CultureInfo.InvariantCulture);
        }

        if (value.Kind != SafetyValueKind.Str || string.IsNullOrEmpty(value.StringValue))
        {
            return fallback;
        }

        string raw = value.StringValue!;
        string? prefix = Prefix(field);
        if (prefix is not null && raw.StartsWith(prefix, StringComparison.Ordinal))
        {
            string stripped = raw[prefix.Length..];
            if (field == SafetyEnumField.SpeedLimitWarning && string.Equals(stripped, "None", StringComparison.Ordinal))
            {
                return off;
            }

            return stripped.Length > 0 ? stripped : raw;
        }

        return raw;
    }

    /// <summary>
    /// Whether a safety-enum value represents an ENABLED feature (web <c>isSafetyEnumActive</c>). Centralizes
    /// the off / none / disabled / 0 classification against the canonical English tokens so the result is
    /// independent of the display language.
    /// </summary>
    public static bool IsActive(SafetyValue value, SafetyEnumField field)
    {
        if (value.Kind == SafetyValueKind.None)
        {
            return false;
        }

        if (value.Kind == SafetyValueKind.Bool)
        {
            return value.BoolValue;
        }

        string cleaned = Clean(value, field, "On", "Off", string.Empty);
        if (cleaned.Length == 0)
        {
            return false;
        }

        return !IsInactiveToken(cleaned);
    }

    private static bool IsInactiveToken(string cleaned) =>
        string.Equals(cleaned, "off", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(cleaned, "none", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(cleaned, "disabled", StringComparison.OrdinalIgnoreCase) ||
        string.Equals(cleaned, "0", StringComparison.Ordinal);
}

/// <summary>
/// The classified ADAS event a snapshot resolves to — the native union of the web
/// <c>classifySnapshot</c> branches (web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx). The
/// order of the branches is significant: the first matching condition wins.
/// </summary>
public enum SafetyEventKind
{
    /// <summary>Automatic emergency braking activation (web <c>aeb</c>, critical).</summary>
    Aeb,

    /// <summary>Forward collision warning (web <c>fcw</c>, warning).</summary>
    Fcw,

    /// <summary>Lane departure avoidance (web <c>lane</c>, warning).</summary>
    Lane,

    /// <summary>Blind-spot collision warning (web <c>bsw</c>, warning).</summary>
    Bsw,

    /// <summary>Emergency lane departure avoidance (web <c>elda</c>, critical).</summary>
    Elda,

    /// <summary>A generic safety-state update (web <c>general</c>, info).</summary>
    General,
}

/// <summary>
/// The resolved presentation for a <see cref="SafetyEventKind"/> — a Segoe Fluent glyph, a token brush
/// key, and the severity. The glyph/brush reproduce the web Lucide icon + hex colour pairing
/// (AEB/ELDA danger-red, FCW/blind-spot warning-amber, lane info-blue, general muted-grey). Pure data.
/// </summary>
/// <param name="Glyph">Segoe Fluent Icons glyph approximating the web Lucide icon.</param>
/// <param name="AccentBrushKey">Design-token brush key for the icon tint.</param>
/// <param name="Severity">The canonical severity (web <c>SafetyEvent.severity</c>).</param>
public readonly record struct SafetyEventPresentation(string Glyph, string AccentBrushKey, SeverityLevel Severity);

/// <summary>
/// One ADAS snapshot row from the <c>GET /safety</c> change feed (web <c>SafetySnapshot</c> in
/// web/src/types/vehicle-systems.ts). Strict boolean fields are read as nullable bools (the web
/// <c>=== true</c> checks only fire for a real JSON <c>true</c>); the enum-typed fields are read as
/// polymorphic <see cref="SafetyValue"/>s. Parsing is null-tolerant so a partial row never throws, and
/// the raw <see cref="CreatedAt"/> wire string is parsed on demand via <see cref="CreatedAtTime"/>.
/// </summary>
/// <param name="Id">The snapshot id (web <c>snap.id</c>), or null.</param>
/// <param name="AutomaticEmergencyBrakingOff">AEB toggle (web strict <c>=== true</c> branch).</param>
/// <param name="BlindSpotCollisionWarning">Blind-spot toggle (web strict <c>=== true</c> branch).</param>
/// <param name="EmergencyLaneDepartureAvoidance">Emergency-lane toggle (web strict <c>=== true</c> branch).</param>
/// <param name="PinToDriveEnabled">PIN-to-drive toggle (web subtitle branch).</param>
/// <param name="ForwardCollisionWarning">Forward-collision enum (polymorphic).</param>
/// <param name="LaneDepartureAvoidance">Lane-departure enum (polymorphic).</param>
/// <param name="SpeedLimitWarning">Speed-limit enum (polymorphic, subtitle only).</param>
/// <param name="CruiseFollowDistance">Cruise follow-distance enum (polymorphic, subtitle only).</param>
/// <param name="CreatedAt">The raw creation timestamp string (web <c>snap.created_at</c>), or null.</param>
public sealed record SafetySnapshot(
    long? Id,
    bool? AutomaticEmergencyBrakingOff,
    bool? BlindSpotCollisionWarning,
    bool? EmergencyLaneDepartureAvoidance,
    bool? PinToDriveEnabled,
    SafetyValue ForwardCollisionWarning,
    SafetyValue LaneDepartureAvoidance,
    SafetyValue SpeedLimitWarning,
    SafetyValue CruiseFollowDistance,
    string? CreatedAt)
{
    /// <summary>The parsed creation instant, or <see langword="null"/> when absent/unparseable.</summary>
    public DateTimeOffset? CreatedAtTime => TryParseTimestamp(CreatedAt);

    /// <summary>Parse a <c>GET /safety</c> JSON array into a tolerant list of snapshots, preserving order.</summary>
    public static IReadOnlyList<SafetySnapshot> ParseList(JsonElement element)
    {
        if (element.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<SafetySnapshot>();
        }

        var list = new List<SafetySnapshot>(element.GetArrayLength());
        foreach (var item in element.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    /// <summary>Project a single safety JSON object into a tolerant snapshot.</summary>
    public static SafetySnapshot FromJson(JsonElement obj) => new(
        Id: GetLong(obj, "id"),
        AutomaticEmergencyBrakingOff: GetStrictBool(obj, "automatic_emergency_braking_off"),
        BlindSpotCollisionWarning: GetStrictBool(obj, "blind_spot_collision_warning"),
        EmergencyLaneDepartureAvoidance: GetStrictBool(obj, "emergency_lane_departure_avoidance"),
        PinToDriveEnabled: GetStrictBool(obj, "pin_to_drive_enabled"),
        ForwardCollisionWarning: SafetyValue.FromJson(obj, "forward_collision_warning"),
        LaneDepartureAvoidance: SafetyValue.FromJson(obj, "lane_departure_avoidance"),
        SpeedLimitWarning: SafetyValue.FromJson(obj, "speed_limit_warning"),
        CruiseFollowDistance: SafetyValue.FromJson(obj, "cruise_follow_distance"),
        CreatedAt: GetString(obj, "created_at"));

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;

    private static long? GetLong(JsonElement obj, string name)
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

    // Web parity: the classifier uses strict `=== true` — only a real JSON boolean true counts.
    private static bool? GetStrictBool(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            _ => null,
        };
    }

    private static DateTimeOffset? TryParseTimestamp(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return null;
        }

        return DateTimeOffset.TryParse(
            raw,
            CultureInfo.InvariantCulture,
            DateTimeStyles.RoundtripKind | DateTimeStyles.AssumeUniversal,
            out var parsed)
            ? parsed
            : null;
    }
}

/// <summary>
/// One projected, display-ready event-feed row — the native analogue of an
/// <c>EventFeedItem</c> (web <c>WidgetEventFeed</c>). Holds the resolved glyph + token brush key, the
/// localized title/subtitle, the timestamp (used for the newest-first sort and the relative label), the
/// relative-time string and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable row id (the snapshot id, or its ordinal fallback).</param>
/// <param name="Kind">The classified event kind.</param>
/// <param name="Glyph">Segoe Fluent glyph for the row icon.</param>
/// <param name="AccentBrushKey">Token brush key tinting the icon.</param>
/// <param name="Severity">The canonical severity.</param>
/// <param name="Title">Localized row title.</param>
/// <param name="Subtitle">Localized row subtitle.</param>
/// <param name="Timestamp">The row instant used for sorting and the relative label.</param>
/// <param name="RelativeTime">The pre-formatted relative-time string.</param>
/// <param name="AutomationName">The Narrator name for the row.</param>
public sealed record SafetyHistoryRow(
    long Id,
    SafetyEventKind Kind,
    string Glyph,
    string AccentBrushKey,
    SeverityLevel Severity,
    string Title,
    string Subtitle,
    DateTimeOffset Timestamp,
    string RelativeTime,
    string AutomationName);

/// <summary>
/// One projected summary stat for the standard layout — the native analogue of a web <c>StatCard</c>.
/// Holds the localized label, the formatted value, an optional sub-line (the Trend card's
/// Increasing/Decreasing/Stable), and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Label">Localized stat label.</param>
/// <param name="Value">Formatted stat value.</param>
/// <param name="Sublabel">Optional localized sub-line, or null.</param>
/// <param name="AutomationName">The Narrator name for the stat.</param>
public sealed record SafetyHistoryStat(string Label, string Value, string? Sublabel, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the safety history for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX: the 30-day total,
/// the most-common type label, the trend marker, the compact one-liner, the three summary stats and the
/// capped, newest-first event feed. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True at a single column (web <c>isCompact</c>): the one-line summary, not the feed.</param>
/// <param name="HasSnapshots">Whether the source list carried any snapshot (web <c>list.length &gt; 0</c>).</param>
/// <param name="TotalEvents">The 30-day event count (web <c>stats.totalEvents</c>).</param>
/// <param name="MostCommon">The most-common type label, or the em dash (web <c>stats.mostCommon</c>).</param>
/// <param name="Trend">The trend marker ↑ / ↓ / → / — (web <c>stats.trend</c>).</param>
/// <param name="CompactPrimary">The compact primary line (count summary, or "no events in 30d").</param>
/// <param name="CompactSecondary">The compact secondary line (most-common + trend), or null when no recent events.</param>
/// <param name="Stats">The three standard-layout summary stats.</param>
/// <param name="Rows">The capped, newest-first event-feed rows.</param>
/// <param name="CompactAutomationName">The Narrator name summarising the compact one-liner.</param>
public sealed record SafetyHistoryDisplay(
    bool IsCompact,
    bool HasSnapshots,
    int TotalEvents,
    string MostCommon,
    string Trend,
    string CompactPrimary,
    string? CompactSecondary,
    IReadOnlyList<SafetyHistoryStat> Stats,
    IReadOnlyList<SafetyHistoryRow> Rows,
    string CompactAutomationName);

/// <summary>
/// The 30-day total / most-common label / trend marker triple computed by
/// <see cref="SafetyHistoryProjection.ComputeStats"/> (web <c>stats</c>). Pure data.
/// </summary>
/// <param name="TotalEvents">The 30-day event count.</param>
/// <param name="MostCommon">The most-common type label, or the em dash.</param>
/// <param name="Trend">The trend marker.</param>
public readonly record struct SafetyHistoryStats(int TotalEvents, string MostCommon, string Trend);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> and the
/// <c>isCompact = size.cols &lt;= 1</c> branch in
/// web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx (the compact test keys off columns only).
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct SafetyHistorySize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SafetyHistorySize Default => new(2, 4);

    /// <summary>True at a single column (web <c>isCompact</c>): show the one-line summary, not the feed.</summary>
    public bool IsCompact => Cols <= 1;
}

/// <summary>
/// Pure projection from the raw safety-snapshot list to the display model — the native port of the
/// <c>classifySnapshot</c> / <c>buildSubtitle</c> / <c>stats</c> / <c>feedItems</c> <c>useMemo</c> work and
/// the <c>isCompact</c> gating in web/src/features/dashboard/widgets/SafetyHistoryWidget.tsx. The 30-day
/// window, the 30-vs-60-day trend, the stable most-common tie-break (first appearance wins) and the
/// newest-first feed cap are all reproduced. Every label resolves through the i18n facade and <c>now</c>
/// is injected so the windows and relative times are unit-tested deterministically.
/// </summary>
public static class SafetyHistoryProjection
{
    /// <summary>Segoe Fluent "ErrorBadge" glyph — the surface header / AEB / general icon (web <c>AlertOctagon</c>).</summary>
    public const string HeaderGlyph = "\uEA39";

    /// <summary>Segoe Fluent "Shield" glyph for the forward-collision row (web <c>ShieldAlert</c>).</summary>
    public const string ShieldGlyph = "\uEA18";

    /// <summary>Segoe Fluent "Location" glyph for the lane-departure row (web <c>Navigation</c>).</summary>
    public const string NavigationGlyph = "\uE707";

    /// <summary>Segoe Fluent "Car" glyph for the blind-spot row (web <c>CarFront</c>).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent "Warning" glyph for the emergency-lane row (web <c>AlertTriangle</c>).</summary>
    public const string WarningGlyph = "\uE7BA";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Trend marker — recent &gt; prior (web <c>'↑'</c>).</summary>
    public const string TrendUp = "\u2191";

    /// <summary>Trend marker — recent &lt; prior (web <c>'↓'</c>).</summary>
    public const string TrendDown = "\u2193";

    /// <summary>Trend marker — recent == prior (web <c>'→'</c>).</summary>
    public const string TrendFlat = "\u2192";

    /// <summary>Trend marker — no prior-window data (web default <c>'—'</c>).</summary>
    public const string TrendNone = EmDash;

    /// <summary>Maximum event-feed rows rendered (web <c>maxItems={10}</c>).</summary>
    public const int FeedMaxItems = 10;

    private const int WindowDays = 30;
    private const int TotalsPrecision = 0;

    private static readonly DateTimeOffset Epoch = DateTimeOffset.UnixEpoch;

    /// <summary>Classify a snapshot into its ADAS event kind (web <c>classifySnapshot</c>, first match wins).</summary>
    public static SafetyEventKind Classify(SafetySnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        if (snapshot.AutomaticEmergencyBrakingOff == true)
        {
            return SafetyEventKind.Aeb;
        }

        if (SafetyEnums.IsActive(snapshot.ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning))
        {
            return SafetyEventKind.Fcw;
        }

        if (SafetyEnums.IsActive(snapshot.LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance))
        {
            return SafetyEventKind.Lane;
        }

        if (snapshot.BlindSpotCollisionWarning == true)
        {
            return SafetyEventKind.Bsw;
        }

        if (snapshot.EmergencyLaneDepartureAvoidance == true)
        {
            return SafetyEventKind.Elda;
        }

        return SafetyEventKind.General;
    }

    /// <summary>The glyph / brush / severity presentation for an event kind (web icon + colour pairing).</summary>
    public static SafetyEventPresentation Presentation(SafetyEventKind kind) => kind switch
    {
        SafetyEventKind.Aeb => new(HeaderGlyph, "TsColorDangerBrush", SeverityLevel.Critical),
        SafetyEventKind.Fcw => new(ShieldGlyph, "TsColorWarningBrush", SeverityLevel.Warn),
        SafetyEventKind.Lane => new(NavigationGlyph, "TsColorInfoBrush", SeverityLevel.Warn),
        SafetyEventKind.Bsw => new(CarGlyph, "TsColorWarningBrush", SeverityLevel.Warn),
        SafetyEventKind.Elda => new(WarningGlyph, "TsColorDangerBrush", SeverityLevel.Critical),
        _ => new(HeaderGlyph, "TsColorTextSecondaryBrush", SeverityLevel.Info),
    };

    /// <summary>The localized short type label used by the "Most Common" stat (web <c>typeLabels</c>).</summary>
    public static string TypeLabel(SafetyEventKind kind, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return kind switch
        {
            SafetyEventKind.Aeb => localizer.GetString("widget.safetyType.aeb", "AEB"),
            SafetyEventKind.Fcw => localizer.GetString("widget.safetyType.fcw", "FCW"),
            SafetyEventKind.Lane => localizer.GetString("widget.safetyType.lane", "Lane Departure"),
            SafetyEventKind.Bsw => localizer.GetString("widget.safetyType.bsw", "Blind Spot"),
            SafetyEventKind.Elda => localizer.GetString("widget.safetyType.elda", "Emergency Lane"),
            _ => localizer.GetString("widget.safetyType.general", "General"),
        };
    }

    /// <summary>The localized event title for a snapshot (web <c>classifySnapshot().title</c>).</summary>
    public static string Title(SafetyEventKind kind, SafetySnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        string on = localizer.GetString("common.on", "On");
        string off = localizer.GetString("common.off", "Off");

        return kind switch
        {
            SafetyEventKind.Aeb => localizer.GetString("widget.safetyEvent.aeb", "AEB Activation"),
            SafetyEventKind.Fcw => string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("widget.safetyEvent.fcw", "FCW: {0}"),
                SafetyEnums.Clean(snapshot.ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning, on, off, EmDash)),
            SafetyEventKind.Lane => string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("widget.safetyEvent.lane", "Lane Departure: {0}"),
                SafetyEnums.Clean(snapshot.LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance, on, off, EmDash)),
            SafetyEventKind.Bsw => localizer.GetString("widget.safetyEvent.bsw", "Blind Spot Warning"),
            SafetyEventKind.Elda => localizer.GetString("widget.safetyEvent.elda", "Emergency Lane Departure Avoidance"),
            _ => localizer.GetString("widget.safetyEvent.general", "Safety State Update"),
        };
    }

    /// <summary>The localized subtitle for a snapshot (web <c>buildSubtitle</c>).</summary>
    public static string Subtitle(SafetySnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var parts = new List<string>(3);
        if (snapshot.SpeedLimitWarning.IsPresent)
        {
            parts.Add(string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("widget.safety.speedLimit", "Speed Limit: {0}"),
                snapshot.SpeedLimitWarning.AsRawString()));
        }

        if (snapshot.CruiseFollowDistance.IsPresent)
        {
            parts.Add(string.Format(
                CultureInfo.CurrentCulture,
                localizer.GetString("widget.safety.followDistance", "Follow: {0}"),
                snapshot.CruiseFollowDistance.AsRawString()));
        }

        if (snapshot.PinToDriveEnabled == true)
        {
            parts.Add(localizer.GetString("widget.safety.pinToDrive", "PIN to Drive"));
        }

        return parts.Count > 0 ? string.Join(" \u00B7 ", parts) : EmDash;
    }

    /// <summary>Project <paramref name="snapshots"/> for <paramref name="size"/> using the localizer + injected <paramref name="now"/>.</summary>
    public static SafetyHistoryDisplay Project(
        IReadOnlyList<SafetySnapshot> snapshots,
        SafetyHistorySize size,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshots);
        ArgumentNullException.ThrowIfNull(localizer);

        SafetyHistoryStats stats = ComputeStats(snapshots, localizer, now);
        bool hasSnapshots = snapshots.Count > 0;

        string events = localizer.GetString("widget.safetyEvents", "events");
        string totalText = ScalarFormatters.FormatNumber(stats.TotalEvents, TotalsPrecision);
        bool hasRecentEvents = stats.TotalEvents > 0;

        // Web parity: `${fmtInt(total)} ${events} (30d)` while there are recent events, otherwise the
        // "No safety events" (without "recorded") one-liner.
        string compactPrimary = hasRecentEvents
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1} (30d)", totalText, events)
            : localizer.GetString("widget.noSafetyEvents", "No safety events");

        // Web parity: the secondary line ("{mostCommon} {trend}") shows only while there are recent events.
        string? compactSecondary = hasRecentEvents
            ? string.Format(CultureInfo.CurrentCulture, "{0} {1}", stats.MostCommon, stats.Trend)
            : null;

        string compactAutomation = compactSecondary is null
            ? compactPrimary
            : string.Format(CultureInfo.CurrentCulture, "{0}, {1}", compactPrimary, compactSecondary);

        var statCards = BuildStatCards(stats, totalText, localizer);
        var rows = BuildRows(snapshots, localizer, now);

        return new SafetyHistoryDisplay(
            IsCompact: size.IsCompact,
            HasSnapshots: hasSnapshots,
            TotalEvents: stats.TotalEvents,
            MostCommon: stats.MostCommon,
            Trend: stats.Trend,
            CompactPrimary: compactPrimary,
            CompactSecondary: compactSecondary,
            Stats: statCards,
            Rows: rows,
            CompactAutomationName: compactAutomation);
    }

    /// <summary>
    /// Compute the 30-day total, the most-common type label and the 30-vs-60-day trend marker (web
    /// <c>stats</c> memo). Snapshots with no parseable timestamp are excluded from both windows, exactly as
    /// the web <c>new Date(...).getTime()</c> NaN comparison drops them.
    /// </summary>
    public static SafetyHistoryStats ComputeStats(
        IReadOnlyList<SafetySnapshot> snapshots,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(snapshots);
        ArgumentNullException.ThrowIfNull(localizer);

        DateTimeOffset thirtyDaysAgo = now.AddDays(-WindowDays);
        DateTimeOffset sixtyDaysAgo = now.AddDays(-2 * WindowDays);

        int recentCount = 0;
        int priorCount = 0;
        var typeCounts = new Dictionary<SafetyEventKind, int>();
        var firstSeen = new List<SafetyEventKind>();

        foreach (var snapshot in snapshots)
        {
            if (snapshot.CreatedAtTime is not { } ts)
            {
                continue;
            }

            if (ts >= thirtyDaysAgo)
            {
                recentCount++;
                var kind = Classify(snapshot);
                if (typeCounts.TryGetValue(kind, out int count))
                {
                    typeCounts[kind] = count + 1;
                }
                else
                {
                    typeCounts[kind] = 1;
                    firstSeen.Add(kind);
                }
            }
            else if (ts >= sixtyDaysAgo)
            {
                priorCount++;
            }
        }

        // Web parity: descending sort by count, stable, so a tie keeps the first-appearance order.
        SafetyEventKind? mostCommon = null;
        int best = -1;
        foreach (var kind in firstSeen)
        {
            if (typeCounts[kind] > best)
            {
                best = typeCounts[kind];
                mostCommon = kind;
            }
        }

        string trend = TrendNone;
        if (priorCount > 0)
        {
            trend = recentCount > priorCount ? TrendUp
                : recentCount < priorCount ? TrendDown
                : TrendFlat;
        }

        string mostCommonLabel = mostCommon is { } resolved ? TypeLabel(resolved, localizer) : EmDash;
        return new SafetyHistoryStats(recentCount, mostCommonLabel, trend);
    }

    /// <summary>The localized Increasing / Decreasing / Stable sub-line for a trend marker (web Trend sublabel).</summary>
    public static string TrendSublabel(string trend, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return trend switch
        {
            TrendUp => localizer.GetString("widget.trendUp", "Increasing"),
            TrendDown => localizer.GetString("widget.trendDown", "Decreasing"),
            _ => localizer.GetString("widget.trendFlat", "Stable"),
        };
    }

    private static List<SafetyHistoryStat> BuildStatCards(
        SafetyHistoryStats stats,
        string totalText,
        ILocalizer localizer)
    {
        string totalLabel = localizer.GetString("widget.safetyTotal", "Events (30d)");
        string commonLabel = localizer.GetString("widget.safetyMostCommon", "Most Common");
        string trendLabel = localizer.GetString("widget.safetyTrend", "Trend");
        string trendSub = TrendSublabel(stats.Trend, localizer);

        return new List<SafetyHistoryStat>(3)
        {
            new(totalLabel, totalText, null, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", totalLabel, totalText)),
            new(commonLabel, stats.MostCommon, null, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", commonLabel, stats.MostCommon)),
            new(trendLabel, stats.Trend, trendSub, string.Format(CultureInfo.CurrentCulture, "{0}: {1}", trendLabel, trendSub)),
        };
    }

    private static List<SafetyHistoryRow> BuildRows(
        IReadOnlyList<SafetySnapshot> snapshots,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var rows = new List<SafetyHistoryRow>(snapshots.Count);
        for (int i = 0; i < snapshots.Count; i++)
        {
            rows.Add(BuildRow(snapshots[i], localizer, now, i));
        }

        // Web parity: WidgetEventFeed sorts newest-first then slices to maxItems.
        rows.Sort(static (a, b) => b.Timestamp.CompareTo(a.Timestamp));
        if (rows.Count > FeedMaxItems)
        {
            rows.RemoveRange(FeedMaxItems, rows.Count - FeedMaxItems);
        }

        return rows;
    }

    private static SafetyHistoryRow BuildRow(SafetySnapshot snapshot, ILocalizer localizer, DateTimeOffset now, int ordinal)
    {
        var kind = Classify(snapshot);
        var presentation = Presentation(kind);
        string title = Title(kind, snapshot, localizer);
        string subtitle = Subtitle(snapshot, localizer);

        // Web parity: timestamp = created_at ?? new Date(0).toISOString() — a missing stamp sorts to the epoch.
        DateTimeOffset timestamp = snapshot.CreatedAtTime ?? Epoch;
        string relative = DateTimeFormatting.Format(timestamp, DateTimeVariant.Relative, now);
        string automation = string.Format(CultureInfo.CurrentCulture, "{0}, {1}, {2}", title, subtitle, relative);

        return new SafetyHistoryRow(
            Id: snapshot.Id ?? ordinal,
            Kind: kind,
            Glyph: presentation.Glyph,
            AccentBrushKey: presentation.AccentBrushKey,
            Severity: presentation.Severity,
            Title: title,
            Subtitle: subtitle,
            Timestamp: timestamp,
            RelativeTime: relative,
            AutomationName: automation);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;IReadOnlyList&lt;SafetySnapshot&gt;&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline) so the view-model can render the full state matrix. Kept pure
/// so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SafetyHistoryResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s payload (when present) while preserving its status.</summary>
    public static RepositoryResult<IReadOnlyList<SafetySnapshot>> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        IReadOnlyList<SafetySnapshot> Parse() =>
            raw.HasValue ? SafetySnapshot.ParseList(raw.Value) : Array.Empty<SafetySnapshot>();

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<IReadOnlyList<SafetySnapshot>>.Loading(),
            LoadStatus.Cached => RepositoryResult<IReadOnlyList<SafetySnapshot>>.Cached(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Refreshing => RepositoryResult<IReadOnlyList<SafetySnapshot>>.Refreshing(Parse(), raw.FetchedAt!.Value, raw.IsStale),
            LoadStatus.Loaded => RepositoryResult<IReadOnlyList<SafetySnapshot>>.Loaded(Parse(), raw.FetchedAt ?? DateTimeOffset.UtcNow),
            LoadStatus.Empty => RepositoryResult<IReadOnlyList<SafetySnapshot>>.Empty(raw.FetchedAt),
            LoadStatus.Offline => RepositoryResult<IReadOnlyList<SafetySnapshot>>.OfflineCached(Parse(), raw.FetchedAt!.Value, raw.Error!),
            _ => RepositoryResult<IReadOnlyList<SafetySnapshot>>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
