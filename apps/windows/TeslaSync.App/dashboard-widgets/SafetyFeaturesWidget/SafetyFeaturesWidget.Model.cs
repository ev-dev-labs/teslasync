using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets.SafetyFeatures;

/// <summary>
/// The lifecycle state a <see cref="SafetyFeaturesViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>SafetyFeaturesWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx). Every branch
/// maps onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web outer
/// <c>{data ? … : &lt;EmptyState&gt;}</c> gate — the <c>useSafety</c> read resolved no safety object (a null
/// body or no vehicle) — the "No safety data" surface. A safety object that simply carries no ADAS fields is
/// NOT empty: it still renders the status grid with every cell at the em-dash "unknown" status, exactly like
/// the web (where <c>data</c> is truthy and each <c>boolStatus(undefined)</c> / <c>safetyEnumStatus(undefined)</c>
/// yields an "unknown" cell).
/// </summary>
public enum SafetyFeaturesState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a safety object to render the grid/count for.</summary>
    Loaded,

    /// <summary>No safety object resolved (null body / no vehicle) — render the "No safety data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the grid/count plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the grid/count plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The semantic status of a single ADAS feature cell — the native subset of the web
/// <c>StatusCell['status']</c> the safety widget actually emits (the <c>buildCells</c> helpers only ever
/// return <c>'ok'</c>, <c>'inactive'</c> or <c>'unknown'</c>). The view maps each to the shared
/// <see cref="StatusKind"/> tint via <see cref="SafetyFeaturesProjection.ToStatusKind"/>.
/// </summary>
public enum SafetyStatus
{
    /// <summary>The feature is enabled / active (web <c>'ok'</c>) — renders the success tint.</summary>
    Ok,

    /// <summary>The feature is disabled / off (web <c>'inactive'</c>) — renders the muted surface tint.</summary>
    Inactive,

    /// <summary>No value reported (web <c>'unknown'</c>) — renders the muted surface tint and the em dash.</summary>
    Unknown,
}

/// <summary>
/// The four enum-typed ADAS fields whose raw values carry a Tesla protomodel prefix that must be stripped —
/// the native mirror of the keys in <c>SAFETY_ENUM_PREFIXES</c> (web/src/lib/safetyEnum.ts). Used by
/// <see cref="SafetyFeaturesProjection.CleanSafetyEnum"/> /
/// <see cref="SafetyFeaturesProjection.IsSafetyEnumActive"/> to resolve the per-field prefix and the
/// speed-limit "None → Off" special case.
/// </summary>
public enum SafetyEnumField
{
    /// <summary>Forward collision warning sensitivity (web <c>forward_collision_warning</c>).</summary>
    ForwardCollisionWarning,

    /// <summary>Lane departure avoidance level (web <c>lane_departure_avoidance</c>).</summary>
    LaneDepartureAvoidance,

    /// <summary>Speed limit warning level (web <c>speed_limit_warning</c>).</summary>
    SpeedLimitWarning,

    /// <summary>Cruise follow distance (web <c>cruise_follow_distance</c>).</summary>
    CruiseFollowDistance,
}

/// <summary>The JSON kind a <see cref="SafetyValue"/> was narrowed to.</summary>
public enum SafetyValueKind
{
    /// <summary>No usable value — JSON null, object, array, an empty string, or an absent property.</summary>
    None,

    /// <summary>A native JSON boolean (web <c>typeof value === 'boolean'</c>).</summary>
    Bool,

    /// <summary>A finite JSON number (web <c>asFiniteNumber(value)</c>).</summary>
    Number,

    /// <summary>A non-empty JSON string (web <c>asNonEmptyString(value)</c>).</summary>
    Text,
}

/// <summary>
/// A tolerant projection of one ADAS JSON field, mirroring the web's <c>unknown</c> narrowing: the backend
/// serializes raw <c>signal.SignalValue</c> (<c>interface{}</c>) directly via <c>/api/v1/safety/latest</c>, so
/// each field can arrive as a native boolean, a number (legacy signal_log rows), or the typed/stripped enum
/// string. This captures exactly the cases the web helpers branch on — a native boolean
/// (<c>typeof value === 'boolean'</c>), a finite number (<c>asFiniteNumber</c>), a non-empty string
/// (<c>asNonEmptyString</c>), and "nothing usable" (every other JSON kind, an empty string, or an absent
/// property) — so the parsers are unit-testable without a JSON host. See lib/safetyEnum.ts for the contract.
/// </summary>
/// <param name="Kind">Which of the four narrowed cases this value is.</param>
/// <param name="BoolValue">The boolean payload when <see cref="Kind"/> is <see cref="SafetyValueKind.Bool"/>.</param>
/// <param name="NumberValue">The numeric payload when <see cref="Kind"/> is <see cref="SafetyValueKind.Number"/>.</param>
/// <param name="TextValue">The string payload when <see cref="Kind"/> is <see cref="SafetyValueKind.Text"/>.</param>
public readonly record struct SafetyValue(SafetyValueKind Kind, bool BoolValue, double NumberValue, string? TextValue)
{
    /// <summary>The "nothing usable" value (web <c>== null</c> / <c>asNonEmptyString</c> returning null).</summary>
    public static SafetyValue None => new(SafetyValueKind.None, false, 0, null);

    /// <summary>A native boolean value (web <c>typeof value === 'boolean'</c>).</summary>
    public static SafetyValue FromBool(bool value) => new(SafetyValueKind.Bool, value, 0, null);

    /// <summary>A finite numeric value (web <c>asFiniteNumber</c>); a non-finite value collapses to <see cref="None"/>.</summary>
    public static SafetyValue FromNumber(double value) =>
        double.IsFinite(value) ? new(SafetyValueKind.Number, false, value, null) : None;

    /// <summary>A string value, narrowed to <see cref="None"/> when null or empty (web <c>asNonEmptyString</c>).</summary>
    public static SafetyValue FromText(string? value) =>
        string.IsNullOrEmpty(value) ? None : new(SafetyValueKind.Text, false, 0, value);

    /// <summary>
    /// True when this value is JavaScript-truthy — the semantics the web <c>boolStatus</c> /
    /// <c>invertedBoolStatus</c> and the Enabled/Disabled value rendering rely on (<c>val ? … : …</c>): a
    /// boolean is itself, a number is non-zero, a (non-empty) string is always truthy, and the
    /// "nothing usable" value is falsy.
    /// </summary>
    public bool IsTruthy => Kind switch
    {
        SafetyValueKind.Bool => BoolValue,
        SafetyValueKind.Number => NumberValue != 0,
        SafetyValueKind.Text => true,
        _ => false,
    };

    /// <summary>
    /// Read property <paramref name="name"/> off <paramref name="obj"/> as a tolerant scalar — a JSON boolean
    /// becomes <see cref="FromBool"/>, a JSON number becomes <see cref="FromNumber"/>, a non-empty JSON string
    /// becomes <see cref="FromText"/>, and every other kind (null / object / array / empty string / absent)
    /// becomes <see cref="None"/>, matching the web's <c>typeof === 'boolean'</c> → <c>asFiniteNumber</c> →
    /// <c>asNonEmptyString</c> narrowing order.
    /// </summary>
    public static SafetyValue Read(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return None;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => FromBool(true),
            JsonValueKind.False => FromBool(false),
            JsonValueKind.Number => v.TryGetDouble(out double d) ? FromNumber(d) : None,
            JsonValueKind.String => FromText(v.GetString()),
            _ => None,
        };
    }
}

/// <summary>
/// The ADAS slice the safety view reads from <c>GET /safety/latest?vehicle_id={id}</c> — the native mirror of
/// the exact <c>SafetySnapshot</c> fields the web widget consumes, each kept as a tolerant
/// <see cref="SafetyValue"/> so the snake_case wire shape (which may carry a boolean, number, or enum string
/// per field) round-trips losslessly. A <see langword="null"/> parse result models the web <c>data</c> being
/// null/undefined (no safety object → the empty surface); any JSON object yields a snapshot (matching the
/// web's truthy <c>data ?</c> gate), with absent fields parsing to <see cref="SafetyValue.None"/> so a partial
/// body never throws and each cell independently shows the em dash.
/// </summary>
/// <param name="ForwardCollisionWarning">Enum field <c>forward_collision_warning</c>.</param>
/// <param name="AutomaticEmergencyBrakingOff">Inverted boolean flag <c>automatic_emergency_braking_off</c> (true ⇒ disabled).</param>
/// <param name="LaneDepartureAvoidance">Enum field <c>lane_departure_avoidance</c>.</param>
/// <param name="EmergencyLaneDepartureAvoidance">Boolean field <c>emergency_lane_departure_avoidance</c>.</param>
/// <param name="AutomaticBlindSpotCamera">Boolean field <c>automatic_blind_spot_camera</c>.</param>
/// <param name="BlindSpotCollisionWarning">Boolean field <c>blind_spot_collision_warning</c>.</param>
/// <param name="SpeedLimitWarning">Enum field <c>speed_limit_warning</c>.</param>
/// <param name="CruiseFollowDistance">Enum field <c>cruise_follow_distance</c>.</param>
public sealed record SafetySnapshot(
    SafetyValue ForwardCollisionWarning,
    SafetyValue AutomaticEmergencyBrakingOff,
    SafetyValue LaneDepartureAvoidance,
    SafetyValue EmergencyLaneDepartureAvoidance,
    SafetyValue AutomaticBlindSpotCamera,
    SafetyValue BlindSpotCollisionWarning,
    SafetyValue SpeedLimitWarning,
    SafetyValue CruiseFollowDistance)
{
    /// <summary>
    /// Project a <c>GET /safety/latest</c> response into the ADAS slice. Returns <see langword="null"/> when
    /// the body is not a JSON object — the native analogue of the web <c>data</c> being null (the empty
    /// surface). Any object yields a snapshot (matching the web's truthy <c>data ?</c> gate); each field is
    /// read tolerantly so absent / null / boolean / number / string shapes never throw.
    /// </summary>
    public static SafetySnapshot? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        return new SafetySnapshot(
            ForwardCollisionWarning: SafetyValue.Read(root, "forward_collision_warning"),
            AutomaticEmergencyBrakingOff: SafetyValue.Read(root, "automatic_emergency_braking_off"),
            LaneDepartureAvoidance: SafetyValue.Read(root, "lane_departure_avoidance"),
            EmergencyLaneDepartureAvoidance: SafetyValue.Read(root, "emergency_lane_departure_avoidance"),
            AutomaticBlindSpotCamera: SafetyValue.Read(root, "automatic_blind_spot_camera"),
            BlindSpotCollisionWarning: SafetyValue.Read(root, "blind_spot_collision_warning"),
            SpeedLimitWarning: SafetyValue.Read(root, "speed_limit_warning"),
            CruiseFollowDistance: SafetyValue.Read(root, "cruise_follow_distance"));
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> branch and the <c>cols ≥ 3 ? 4 : 2</c> grid-column choice in
/// web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct SafetyFeaturesSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static SafetyFeaturesSize Default => new(2, 4);

    /// <summary>
    /// True at one or zero columns (web <c>isCompact = size.cols &lt;= 1</c>): the title is hidden and the body
    /// collapses to the active-feature count.
    /// </summary>
    public bool IsCompact => Cols <= 1;

    /// <summary>The status-grid column count (web <c>size.cols &gt;= 3 ? 4 : 2</c>).</summary>
    public int GridColumns => Cols >= 3 ? 4 : 2;
}

/// <summary>
/// One projected, display-ready ADAS status cell consumed by the WinUI view — the native analogue of a web
/// <c>StatusCell</c> rendered by the shared <c>WidgetStatusGrid</c>. Holds the localized feature label, the
/// derived semantic status (which the view maps to a themed tint + dot), the already-resolved value text
/// ("Enabled" / "Disabled" / a cleaned enum token / em dash) and a Narrator automation name. Pure data — no
/// WinUI types.
/// </summary>
/// <param name="Id">Stable cell id (web <c>fcw</c> / <c>aeb</c> …).</param>
/// <param name="Label">Localized feature label (Forward Collision Warning, …).</param>
/// <param name="Status">Semantic status driving the tint + dot (web <c>boolStatus</c> / <c>safetyEnumStatus</c>).</param>
/// <param name="Value">Already-resolved value text (web <c>cleanSafetyEnum</c> / Enabled / Disabled / em dash).</param>
/// <param name="AutomationName">Narrator name combining the label and value.</param>
public sealed record SafetyCell(
    string Id,
    string Label,
    SafetyStatus Status,
    string Value,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the safety surface for one footprint — the native analogue of
/// everything the web component computes via <c>useMemo</c> before returning JSX. Holds the eight status
/// cells (the web non-compact <c>WidgetStatusGrid</c> branch) with their grid-column count, plus the
/// active-feature count and its localized label (the web <c>isCompact</c> big-number branch), so the view is
/// a thin renderer. Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">Whether the compact active-count layout applies (web <c>isCompact</c>).</param>
/// <param name="GridColumns">The status-grid column count for the standard layout (web <c>cols ≥ 3 ? 4 : 2</c>).</param>
/// <param name="ActiveCount">Number of cells whose status is <see cref="SafetyStatus.Ok"/> (web <c>activeCount</c>).</param>
/// <param name="ActiveCountText">The localized integer rendering of <see cref="ActiveCount"/> (web <c>fmtInt</c>).</param>
/// <param name="ActiveFeaturesLabel">Localized "Active Features" caption (web <c>widget.safety.activeFeatures</c>).</param>
/// <param name="Cells">The eight ADAS cells (web <c>cells</c>).</param>
/// <param name="AutomationName">Narrator name summarising the rendered surface.</param>
public sealed record SafetyFeaturesDisplay(
    bool IsCompact,
    int GridColumns,
    int ActiveCount,
    string ActiveCountText,
    string ActiveFeaturesLabel,
    IReadOnlyList<SafetyCell> Cells,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="SafetySnapshot"/> to the display model — the native port of the
/// <c>buildCells</c> table and the <c>boolStatus</c> / <c>invertedBoolStatus</c> / <c>safetyEnumStatus</c>
/// helpers in web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx, plus a verbatim port of the
/// <c>cleanSafetyEnum</c> / <c>isSafetyEnumActive</c> data-normalization helpers from web/src/lib/safetyEnum.ts.
/// Those two helpers are a faithful 1:1 reproduction of the source-of-truth library (which itself performs no
/// i18n — the enum tokens it emits, e.g. the boolean "On"/"Off", are data values, not UI copy); every genuine
/// UI label (feature names, Enabled/Disabled, Active Features) resolves through the i18n facade, and the em
/// dash reproduces the web <c>'—'</c> for an absent value.
/// </summary>
public static class SafetyFeaturesProjection
{
    /// <summary>Segoe Fluent shield glyph — the security-domain analogue of the web <c>ShieldAlert</c> icon.</summary>
    public const string ShieldGlyph = "\uE72E";

    /// <summary>The em dash the web renders for an absent value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    // The Tesla protomodel enum prefixes stripped for old signal_log rows (web SAFETY_ENUM_PREFIXES).
    private const string ForwardCollisionPrefix = "ForwardCollisionSensitivity";
    private const string LaneAssistPrefix = "LaneAssistLevel";
    private const string SpeedAssistPrefix = "SpeedAssistLevel";
    private const string FollowDistancePrefix = "FollowDistance";

    private const string OnLiteral = "On";
    private const string OffLiteral = "Off";

    /// <summary>
    /// Convert a raw safety-enum value into a human-renderable, prefix-stripped string — a verbatim port of
    /// the web <c>cleanSafetyEnum</c> (lib/safetyEnum.ts). Returns <paramref name="fallback"/> for the
    /// "nothing usable" value; a boolean renders as "On"/"Off"; a number renders as its decimal form; a string
    /// has its per-field protomodel prefix stripped (with the speed-limit "None ⇒ Off" special case).
    /// </summary>
    public static string CleanSafetyEnum(SafetyValue value, SafetyEnumField field, string fallback)
    {
        switch (value.Kind)
        {
            case SafetyValueKind.Bool:
                return value.BoolValue ? OnLiteral : OffLiteral;

            case SafetyValueKind.Number:
                return JsNumber(value.NumberValue);

            case SafetyValueKind.Text:
                string raw = value.TextValue!;
                string? prefix = PrefixFor(field);
                if (prefix is not null && raw.StartsWith(prefix, StringComparison.Ordinal))
                {
                    string stripped = raw[prefix.Length..];
                    if (field == SafetyEnumField.SpeedLimitWarning && stripped == "None")
                    {
                        return OffLiteral;
                    }

                    return stripped.Length > 0 ? stripped : raw;
                }

                return raw;

            default:
                return fallback;
        }
    }

    /// <summary>
    /// Whether a safety-enum value represents an ENABLED feature — a verbatim port of the web
    /// <c>isSafetyEnumActive</c> (lib/safetyEnum.ts). Centralizes the "off / none / disabled / 0"
    /// classification: the "nothing usable" value is inactive, a boolean is itself, and a cleaned string is
    /// inactive only when it is empty or case-insensitively one of "off" / "none" / "disabled" / "0".
    /// </summary>
    public static bool IsSafetyEnumActive(SafetyValue value, SafetyEnumField field)
    {
        if (value.Kind == SafetyValueKind.None)
        {
            return false;
        }

        if (value.Kind == SafetyValueKind.Bool)
        {
            return value.BoolValue;
        }

        string cleaned = CleanSafetyEnum(value, field, string.Empty);
        if (cleaned.Length == 0)
        {
            return false;
        }

        string lower = cleaned.ToLowerInvariant();
        return lower is not ("off" or "none" or "disabled" or "0");
    }

    /// <summary>
    /// Map an enum field's value to its cell status (web <c>safetyEnumStatus</c>): the "nothing usable" value
    /// is <see cref="SafetyStatus.Unknown"/>, an active value is <see cref="SafetyStatus.Ok"/>, otherwise
    /// <see cref="SafetyStatus.Inactive"/>.
    /// </summary>
    public static SafetyStatus SafetyEnumStatus(SafetyValue value, SafetyEnumField field)
    {
        if (value.Kind == SafetyValueKind.None)
        {
            return SafetyStatus.Unknown;
        }

        return IsSafetyEnumActive(value, field) ? SafetyStatus.Ok : SafetyStatus.Inactive;
    }

    /// <summary>
    /// Map a boolean field's value to its cell status (web <c>boolStatus</c>): the "nothing usable" value is
    /// <see cref="SafetyStatus.Unknown"/>, a truthy value is <see cref="SafetyStatus.Ok"/>, otherwise
    /// <see cref="SafetyStatus.Inactive"/>.
    /// </summary>
    public static SafetyStatus BoolStatus(SafetyValue value) =>
        value.Kind == SafetyValueKind.None
            ? SafetyStatus.Unknown
            : value.IsTruthy ? SafetyStatus.Ok : SafetyStatus.Inactive;

    /// <summary>
    /// Map an inverted ("…_off") boolean flag to its cell status (web <c>invertedBoolStatus</c>): the
    /// "nothing usable" value is <see cref="SafetyStatus.Unknown"/>; a truthy flag means the feature is OFF, so
    /// it is <see cref="SafetyStatus.Inactive"/>; otherwise the feature is on (<see cref="SafetyStatus.Ok"/>).
    /// </summary>
    public static SafetyStatus InvertedBoolStatus(SafetyValue value) =>
        value.Kind == SafetyValueKind.None
            ? SafetyStatus.Unknown
            : value.IsTruthy ? SafetyStatus.Inactive : SafetyStatus.Ok;

    /// <summary>
    /// Map a cell status to the shared semantic <see cref="StatusKind"/> the grid tints it with (web
    /// <c>statusStyles</c>): <see cref="SafetyStatus.Ok"/> → <see cref="StatusKind.Success"/> (web emerald);
    /// <see cref="SafetyStatus.Inactive"/> / <see cref="SafetyStatus.Unknown"/> → <see cref="StatusKind.Neutral"/>
    /// (web's muted surface tint — identical for both in the web table).
    /// </summary>
    public static StatusKind ToStatusKind(SafetyStatus status) => status switch
    {
        SafetyStatus.Ok => StatusKind.Success,
        _ => StatusKind.Neutral,
    };

    /// <summary>Number of cells whose status is <see cref="SafetyStatus.Ok"/> (web <c>activeCount</c>).</summary>
    public static int ActiveCount(IReadOnlyList<SafetyCell> cells)
    {
        ArgumentNullException.ThrowIfNull(cells);
        int count = 0;
        foreach (var cell in cells)
        {
            if (cell.Status == SafetyStatus.Ok)
            {
                count++;
            }
        }

        return count;
    }

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static SafetyFeaturesDisplay Project(
        SafetySnapshot snapshot,
        SafetyFeaturesSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var cells = BuildCells(snapshot, localizer);
        int active = ActiveCount(cells);
        string activeText = active.ToString(CultureInfo.CurrentCulture);
        string activeLabel = localizer.GetString("widget.safety.activeFeatures", "Active Features");

        string automation = BuildAutomationName(size.IsCompact, active, activeLabel, cells);

        return new SafetyFeaturesDisplay(
            IsCompact: size.IsCompact,
            GridColumns: size.GridColumns,
            ActiveCount: active,
            ActiveCountText: activeText,
            ActiveFeaturesLabel: activeLabel,
            Cells: cells,
            AutomationName: automation);
    }

    /// <summary>
    /// Build the eight ADAS status cells in the exact order and with the exact status / value rules of the web
    /// <c>buildCells</c> table (web/src/features/dashboard/widgets/SafetyFeaturesWidget.tsx).
    /// </summary>
    public static IReadOnlyList<SafetyCell> BuildCells(SafetySnapshot data, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(data);
        ArgumentNullException.ThrowIfNull(localizer);

        return new[]
        {
            EnumCell(
                "fcw", localizer.GetString("widget.safety.fcw", "Forward Collision Warning"),
                data.ForwardCollisionWarning, SafetyEnumField.ForwardCollisionWarning),
            BoolCell(
                "aeb", localizer.GetString("widget.safety.aeb", "Auto Emergency Braking"),
                data.AutomaticEmergencyBrakingOff, inverted: true, localizer),
            EnumCell(
                "lda", localizer.GetString("widget.safety.lda", "Lane Departure Avoidance"),
                data.LaneDepartureAvoidance, SafetyEnumField.LaneDepartureAvoidance),
            BoolCell(
                "elda", localizer.GetString("widget.safety.elda", "Emergency Lane Departure"),
                data.EmergencyLaneDepartureAvoidance, inverted: false, localizer),
            BoolCell(
                "bsc", localizer.GetString("widget.safety.bsc", "Blind Spot Camera"),
                data.AutomaticBlindSpotCamera, inverted: false, localizer),
            BoolCell(
                "bscw", localizer.GetString("widget.safety.bscw", "Blind Spot Collision Warning"),
                data.BlindSpotCollisionWarning, inverted: false, localizer),
            EnumCell(
                "slw", localizer.GetString("widget.safety.slw", "Speed Limit Warning"),
                data.SpeedLimitWarning, SafetyEnumField.SpeedLimitWarning),
            EnumCell(
                "cfd", localizer.GetString("widget.safety.cfd", "Cruise Follow Distance"),
                data.CruiseFollowDistance, SafetyEnumField.CruiseFollowDistance),
        };
    }

    private static SafetyCell EnumCell(string id, string label, SafetyValue value, SafetyEnumField field)
    {
        var status = SafetyEnumStatus(value, field);
        string text = CleanSafetyEnum(value, field, EmDash);
        return new SafetyCell(id, label, status, text, $"{label} {text}");
    }

    private static SafetyCell BoolCell(string id, string label, SafetyValue value, bool inverted, ILocalizer localizer)
    {
        var status = inverted ? InvertedBoolStatus(value) : BoolStatus(value);
        string text = BoolValueText(value, inverted, localizer);
        return new SafetyCell(id, label, status, text, $"{label} {text}");
    }

    // Web parity: a boolean field renders the em dash when absent, otherwise Enabled / Disabled — with the
    // sense flipped for the inverted "automatic_emergency_braking_off" flag (true ⇒ Disabled).
    private static string BoolValueText(SafetyValue value, bool inverted, ILocalizer localizer)
    {
        if (value.Kind == SafetyValueKind.None)
        {
            return EmDash;
        }

        bool enabled = inverted ? !value.IsTruthy : value.IsTruthy;
        return enabled
            ? localizer.GetString("widget.safety.enabled", "Enabled")
            : localizer.GetString("widget.safety.disabled", "Disabled");
    }

    private static string? PrefixFor(SafetyEnumField field) => field switch
    {
        SafetyEnumField.ForwardCollisionWarning => ForwardCollisionPrefix,
        SafetyEnumField.LaneDepartureAvoidance => LaneAssistPrefix,
        SafetyEnumField.SpeedLimitWarning => SpeedAssistPrefix,
        SafetyEnumField.CruiseFollowDistance => FollowDistancePrefix,
        _ => null,
    };

    // Web parity: cleanSafetyEnum renders a number via JS String(num) — an integral value drops its decimal
    // ("3.0" ⇒ "3"), everything else uses the shortest round-trippable invariant form.
    private static string JsNumber(double value)
    {
        if (double.IsFinite(value) && value == Math.Floor(value) && Math.Abs(value) < 1e15)
        {
            return ((long)value).ToString(CultureInfo.InvariantCulture);
        }

        return value.ToString(CultureInfo.InvariantCulture);
    }

    private static string BuildAutomationName(
        bool compact,
        int activeCount,
        string activeLabel,
        IReadOnlyList<SafetyCell> cells)
    {
        if (compact)
        {
            return string.Create(CultureInfo.CurrentCulture, $"{activeCount} {activeLabel}");
        }

        var names = new string[cells.Count];
        for (int i = 0; i < cells.Count; i++)
        {
            names[i] = cells[i].AutomationName;
        }

        return string.Join(", ", names);
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;SafetySnapshot&gt;</c>, preserving every freshness flag (cached / refreshing / stale
/// / offline). A successful emission whose body carries no safety object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{data ? … : &lt;EmptyState&gt;}</c>
/// gate. Kept pure so the parse-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class SafetyFeaturesResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s safety payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<SafetySnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        SafetySnapshot? Parse() =>
            raw.HasValue ? SafetySnapshot.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<SafetySnapshot>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<SafetySnapshot>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SafetySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<SafetySnapshot>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<SafetySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<SafetySnapshot>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<SafetySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<SafetySnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<SafetySnapshot>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<SafetySnapshot>.Empty(raw.FetchedAt),
            _ => RepositoryResult<SafetySnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
