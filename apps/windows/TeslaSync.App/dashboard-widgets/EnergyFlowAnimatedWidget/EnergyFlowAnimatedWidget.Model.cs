using System.Collections.Generic;
using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets.EnergyFlowAnimated;

/// <summary>
/// The lifecycle state an <see cref="EnergyFlowAnimatedViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>EnergyFlowAnimatedWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web <c>{state ? … : &lt;EmptyState&gt;}</c>
/// gate — no resolved vehicle / no usable state in the response — the "No energy data available" surface.
/// </summary>
public enum EnergyFlowState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a vehicle state to render the flow surface for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state — render the "No energy data available" surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the view plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the view plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the energy-flow view reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the web <c>VehicleState</c> slice the widget consumes (<c>power</c>, <c>charger_power</c>,
/// <c>battery_level</c>, <c>is_charging</c>, web/src/api/types). Values are read verbatim exactly as the web
/// component reads them (the web treats <c>power</c> and <c>charger_power</c> as kilowatts and
/// <c>battery_level</c> as a unit-free percent) so the native surface reproduces the web's observable output —
/// never silently "corrected". A <see langword="null"/> parse result models the web <c>stateData?.state</c>
/// being undefined (no state in the response → the empty surface). Parsing is null-tolerant so a partial body
/// never throws.
/// </summary>
/// <param name="PowerKw">Instantaneous battery power as the web reads it — kilowatts; positive when driving
/// (consuming), negative when regenerating (web <c>power</c>).</param>
/// <param name="ChargerPowerKw">Charger power as the web reads it — kilowatts (web <c>charger_power</c>).</param>
/// <param name="BatteryLevel">State-of-charge percent (0–100, unit-free; web <c>battery_level</c>).</param>
/// <param name="IsCharging">Whether the vehicle is actively charging (web <c>is_charging</c>).</param>
public sealed record VehicleEnergyFlowState(
    double PowerKw,
    double ChargerPowerKw,
    double BatteryLevel,
    bool IsCharging)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the energy-flow slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct
    /// from <c>position.power</c> / <c>position.battery_level</c> + the top-level charging fields when a
    /// <c>vehicle</c>/<c>position</c> is present. Returns <see langword="null"/> when none of those yield a
    /// state — the native analogue of the web <c>state</c> being undefined.
    /// </summary>
    public static VehicleEnergyFlowState? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        // Web parity (primary): res.state with a vehicle_id is the canonical SignalStore state object.
        if (Object(root, "state") is { } state && Has(state, "vehicle_id"))
        {
            return FromStateObject(state);
        }

        var vehicle = Object(root, "vehicle");
        var position = Object(root, "position");
        if (vehicle is null && position is null)
        {
            // Web parity: `if (!v && !p) return { state: res.state }` — a plain state object is still usable,
            // otherwise there is no state and the widget shows its empty surface.
            return Object(root, "state") is { } plain ? FromStateObject(plain) : null;
        }

        // Web parity (fallback): power + battery from the position snapshot; the charging fields from top-level res.
        return new VehicleEnergyFlowState(
            PowerKw: position is { } p ? ReadDouble(p, "power") ?? 0 : 0,
            ChargerPowerKw: ReadDouble(root, "charger_power") ?? 0,
            BatteryLevel: position is { } pp ? ReadDouble(pp, "battery_level") ?? 0 : 0,
            IsCharging: ReadBool(root, "is_charging"));
    }

    private static VehicleEnergyFlowState FromStateObject(JsonElement state) => new(
        PowerKw: ReadDouble(state, "power") ?? 0,
        ChargerPowerKw: ReadDouble(state, "charger_power") ?? 0,
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0,
        IsCharging: ReadBool(state, "is_charging"));

    private static JsonElement? Object(JsonElement parent, string name) =>
        parent.ValueKind == JsonValueKind.Object &&
        parent.TryGetProperty(name, out var value) &&
        value.ValueKind == JsonValueKind.Object
            ? value
            : null;

    private static bool Has(JsonElement obj, string name) => obj.TryGetProperty(name, out _);

    private static double? ReadDouble(JsonElement obj, string name)
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
}

/// <summary>
/// The energy-flow snapshot the view-model projects — the live vehicle <see cref="State"/> the widget's single
/// <c>useVehicleState</c> query yields. Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyFlowSnapshot(VehicleEnergyFlowState State);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact = size.cols &lt; 2</c> branch in
/// web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx.
/// </summary>
public readonly record struct EnergyFlowSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static EnergyFlowSize Default => new(2, 4);

    /// <summary>True below two columns (web <c>isCompact = size.cols &lt; 2</c>): renders the compact fallback.</summary>
    public bool IsCompact => Cols < 2;
}

/// <summary>
/// A node anchor in the flow diagram — the native mirror of the web <c>FlowNode['position']</c> union
/// (web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx). Drives the fixed 100×100 viewBox
/// coordinate of the node.
/// </summary>
public enum EnergyFlowPosition
{
    /// <summary>Top anchor (50, 12).</summary>
    Top,

    /// <summary>Bottom anchor (50, 88).</summary>
    Bottom,

    /// <summary>Left anchor (12, 50).</summary>
    Left,

    /// <summary>Right anchor (88, 50).</summary>
    Right,

    /// <summary>Centre anchor (50, 50).</summary>
    Center,
}

/// <summary>
/// One node of the energy-flow diagram — the native mirror of the web <c>FlowNode</c> (a localized label, a
/// raw numeric value rendered as a count-up number, a pre-formatted value string for accessibility, a leading
/// glyph and an anchor position), plus a Narrator name combining the label and value. Pure data — no WinUI
/// types.
/// </summary>
/// <param name="Id">Stable node id (<c>battery</c> / <c>drive</c> / <c>charger</c>) used to resolve arrows.</param>
/// <param name="Label">The localized node label.</param>
/// <param name="Value">The raw numeric value rendered inside the node (web <c>AnimatedNumber value</c>).</param>
/// <param name="FormattedValue">The pre-formatted value (e.g. "80%", "7 kW", or the em dash).</param>
/// <param name="Glyph">The Segoe Fluent glyph for the node icon.</param>
/// <param name="Position">The node's anchor in the diagram.</param>
/// <param name="AutomationName">The Narrator name (label + formatted value).</param>
public sealed record EnergyFlowNode(
    string Id,
    string Label,
    double Value,
    string FormattedValue,
    string Glyph,
    EnergyFlowPosition Position,
    string AutomationName);

/// <summary>
/// One directed flow arrow between two nodes — the native mirror of the web <c>FlowArrow</c> (a source/target
/// node id, the flow magnitude driving the stroke width, an <see cref="Active"/> flag driving the animated
/// dash, and a semantic <see cref="Color"/>). Pure data — no WinUI types.
/// </summary>
/// <param name="From">Source node id.</param>
/// <param name="To">Target node id.</param>
/// <param name="Value">Flow magnitude (kW) — feeds the stroke width.</param>
/// <param name="Active">Whether the flow is live (web <c>active</c>) — drives the animated dash.</param>
/// <param name="Color">Semantic colour (web CYAN→Info / GREEN→Success / AMBER→Warning).</param>
public sealed record EnergyFlowArrow(
    string From,
    string To,
    double Value,
    bool Active,
    StatusKind Color);

/// <summary>
/// One line of the compact fallback — a leading glyph, a pre-formatted "{value} kW" string and a semantic
/// colour, plus a Narrator name. Mirrors the web <c>CompactView</c> rows (charging / consuming / regen). Pure
/// data — no WinUI types.
/// </summary>
/// <param name="Glyph">The Segoe Fluent glyph for the leading icon.</param>
/// <param name="Value">The pre-formatted power string (e.g. "7.2 kW").</param>
/// <param name="Color">Semantic colour (charging→Warning / consuming→Info / regen→Success).</param>
/// <param name="AutomationName">The Narrator name (semantic label + value).</param>
public sealed record EnergyFlowCompactLine(string Glyph, string Value, StatusKind Color, string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the energy-flow surface for one footprint — the native analogue
/// of everything the web component computes before returning JSX (the derived <c>isConsuming</c>/<c>isRegen</c>
/// flags, the compact rows, and the <c>nodes</c>/<c>arrows</c> memos). Pure data so the projection is
/// unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">True at &lt; 2 columns — renders the compact fallback instead of the diagram.</param>
/// <param name="IsCharging">Whether the charger flow is live (web <c>isCharging</c>).</param>
/// <param name="IsConsuming">Whether the battery→drive flow is live (web <c>power &gt; 0.5</c>).</param>
/// <param name="IsRegen">Whether the drive→battery flow is live (web <c>power &lt; -0.5</c>).</param>
/// <param name="IsIdle">True when no flow is live — the compact "Idle" row (web <c>!isConsuming &amp;&amp; !isRegen &amp;&amp; !isCharging</c>).</param>
/// <param name="BatteryPercentText">The battery percent string (web <c>{batteryLevel}%</c>).</param>
/// <param name="IdleText">The localized "Idle" label.</param>
/// <param name="CompactLines">The active compact rows (web <c>CompactView</c> conditional lines).</param>
/// <param name="Nodes">The three diagram nodes (battery / drive / charger).</param>
/// <param name="Arrows">The three diagram arrows.</param>
/// <param name="AutomationName">The Narrator summary of the whole surface.</param>
public sealed record EnergyFlowDisplay(
    bool IsCompact,
    bool IsCharging,
    bool IsConsuming,
    bool IsRegen,
    bool IsIdle,
    string BatteryPercentText,
    string IdleText,
    IReadOnlyList<EnergyFlowCompactLine> CompactLines,
    IReadOnlyList<EnergyFlowNode> Nodes,
    IReadOnlyList<EnergyFlowArrow> Arrows,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="EnergyFlowSnapshot"/> to the display model — the native port of the
/// web component's <c>isConsuming</c>/<c>isRegen</c> derivation, its <c>CompactView</c> rows and its
/// <c>nodes</c>/<c>arrows</c> memos in web/src/features/dashboard/widgets/EnergyFlowAnimatedWidget.tsx. Power
/// is always rendered in kW and battery as a raw percent (the web hard-codes both — no unit conversion). Every
/// label resolves through the i18n facade.
/// </summary>
public static class EnergyFlowProjection
{
    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> icon (header, drive node, consuming row).</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "Battery10" glyph — the web <c>Battery</c> icon (battery node, regen row).</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "PowerButton" glyph — the web <c>Plug</c> icon (charger node, charging row).</summary>
    public const string PlugGlyph = "\uE7E8";

    /// <summary>The em dash the web renders for an inactive node value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Battery node id (web <c>'battery'</c>).</summary>
    public const string BatteryNodeId = "battery";

    /// <summary>Drive node id (web <c>'drive'</c>).</summary>
    public const string DriveNodeId = "drive";

    /// <summary>Charger node id (web <c>'charger'</c>).</summary>
    public const string ChargerNodeId = "charger";

    /// <summary>Consuming threshold — power above this drives the battery→drive flow (web <c>power &gt; 0.5</c>).</summary>
    public const double ConsumingThreshold = 0.5;

    /// <summary>Regen threshold — power below this drives the drive→battery flow (web <c>power &lt; -0.5</c>).</summary>
    public const double RegenThreshold = -0.5;

    /// <summary>Power readout fraction digits for the kW rows / drive node (web <c>fmtNumber(…, 1)</c>).</summary>
    public const int PowerPrecision = 1;

    /// <summary>Charger node fraction digits (web <c>fmtNumber(chargerPower, 0)</c>).</summary>
    public const int ChargerPrecision = 0;

    /// <summary>The kW suffix the web appends to every power readout (web <c>" kW"</c>).</summary>
    public const string PowerSuffix = " kW";

    /// <summary>Project <paramref name="snapshot"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static EnergyFlowDisplay Project(EnergyFlowSnapshot snapshot, EnergyFlowSize size, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = snapshot.State;
        double power = Safe(state.PowerKw);
        double chargerPower = Safe(state.ChargerPowerKw);
        double batteryLevel = Safe(state.BatteryLevel);
        bool isCharging = state.IsCharging;

        // Web parity: derive the same flow flags the component computes.
        bool isConsuming = power > ConsumingThreshold;
        bool isRegen = power < RegenThreshold;
        double absPower = Math.Abs(power);

        string battery = localizer.GetString("widget.energyFlowAnimated.battery", "Battery");
        string drive = localizer.GetString("widget.energyFlowAnimated.drive", "Drive");
        string regen = localizer.GetString("widget.energyFlowAnimated.regen", "Regen");
        string charger = localizer.GetString("widget.energyFlowAnimated.charger", "Charger");
        string idle = localizer.GetString("widget.energyFlowAnimated.idle", "Idle");

        string batteryPercent = FormatPercent(batteryLevel);
        string drivePower = FormatPower(absPower, PowerPrecision);
        string chargerPower1 = FormatPower(chargerPower, PowerPrecision);
        string chargerPower0 = FormatPower(chargerPower, ChargerPrecision);

        // Web parity: CompactView renders one row per live flow, falling back to the "Idle" label.
        var lines = new List<EnergyFlowCompactLine>(3);
        if (isCharging)
        {
            lines.Add(new EnergyFlowCompactLine(PlugGlyph, chargerPower1, StatusKind.Warning, $"{charger} {chargerPower1}"));
        }

        if (isConsuming)
        {
            lines.Add(new EnergyFlowCompactLine(ZapGlyph, drivePower, StatusKind.Info, $"{drive} {drivePower}"));
        }

        if (isRegen)
        {
            lines.Add(new EnergyFlowCompactLine(BatteryGlyph, drivePower, StatusKind.Success, $"{regen} {drivePower}"));
        }

        bool isIdle = lines.Count == 0;

        // Web parity: the diagram's three nodes (battery left, drive right, charger top).
        string driveLabel = isConsuming ? drive : isRegen ? regen : idle;
        string driveFormatted = isConsuming || isRegen ? drivePower : EmDash;
        string chargerFormatted = isCharging ? chargerPower0 : EmDash;

        var nodes = new List<EnergyFlowNode>(3)
        {
            new(BatteryNodeId, battery, batteryLevel, batteryPercent, BatteryGlyph, EnergyFlowPosition.Left, $"{battery} {batteryPercent}"),
            new(DriveNodeId, driveLabel, absPower, driveFormatted, ZapGlyph, EnergyFlowPosition.Right, $"{driveLabel} {driveFormatted}"),
            new(ChargerNodeId, charger, chargerPower, chargerFormatted, PlugGlyph, EnergyFlowPosition.Top, $"{charger} {chargerFormatted}"),
        };

        // Web parity: battery→drive (consuming), drive→battery (regen), charger→battery (charging).
        var arrows = new List<EnergyFlowArrow>(3)
        {
            new(BatteryNodeId, DriveNodeId, isConsuming ? absPower : 0, isConsuming, StatusKind.Info),
            new(DriveNodeId, BatteryNodeId, isRegen ? absPower : 0, isRegen, StatusKind.Success),
            new(ChargerNodeId, BatteryNodeId, isCharging ? chargerPower : 0, isCharging, StatusKind.Warning),
        };

        string automationName = BuildAutomationName(
            battery, batteryPercent, idle, isConsuming, isRegen, isCharging, drive, regen, charger, drivePower, chargerPower0);

        return new EnergyFlowDisplay(
            IsCompact: size.IsCompact,
            IsCharging: isCharging,
            IsConsuming: isConsuming,
            IsRegen: isRegen,
            IsIdle: isIdle,
            BatteryPercentText: batteryPercent,
            IdleText: idle,
            CompactLines: lines,
            Nodes: nodes,
            Arrows: arrows,
            AutomationName: automationName);
    }

    /// <summary>Format a power value the way the web does — "{fmtNumber(value, precision)} kW".</summary>
    public static string FormatPower(double value, int precision) =>
        ScalarFormatters.FormatNumber(Safe(value), precision) + PowerSuffix;

    /// <summary>Format a battery percent the way the web interpolates <c>{batteryLevel}%</c> (raw number + "%").</summary>
    public static string FormatPercent(double value) =>
        Safe(value).ToString(CultureInfo.InvariantCulture) + "%";

    private static string BuildAutomationName(
        string battery,
        string batteryPercent,
        string idle,
        bool isConsuming,
        bool isRegen,
        bool isCharging,
        string drive,
        string regen,
        string charger,
        string drivePower,
        string chargerPower0)
    {
        var parts = new List<string>(4) { $"{battery} {batteryPercent}" };
        if (isConsuming)
        {
            parts.Add($"{drive} {drivePower}");
        }

        if (isRegen)
        {
            parts.Add($"{regen} {drivePower}");
        }

        if (isCharging)
        {
            parts.Add($"{charger} {chargerPower0}");
        }

        if (!isConsuming && !isRegen && !isCharging)
        {
            parts.Add(idle);
        }

        return string.Join(", ", parts);
    }

    private static double Safe(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>A point in the flow diagram's fixed 100×100 viewBox.</summary>
/// <param name="X">The x coordinate (0–100).</param>
/// <param name="Y">The y coordinate (0–100).</param>
public readonly record struct FlowPoint(double X, double Y);

/// <summary>A line segment between two diagram points (an arrow's drawn extent).</summary>
/// <param name="X1">Start x.</param>
/// <param name="Y1">Start y.</param>
/// <param name="X2">End x.</param>
/// <param name="Y2">End y.</param>
public readonly record struct FlowSegment(double X1, double Y1, double X2, double Y2);

/// <summary>
/// The pure SVG-coordinate math behind the flow diagram — a faithful port of the web
/// <c>WidgetFlowDiagram</c>'s <c>POSITION_COORDS</c>, <c>strokeForValue</c> and the node-radius-offset arrow
/// geometry (web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx). Kept pure so the geometry is
/// unit-tested without a XAML runtime.
/// </summary>
public static class EnergyFlowGeometry
{
    /// <summary>The full viewBox extent (web <c>viewBox="0 0 100 100"</c>).</summary>
    public const double ViewExtent = 100;

    /// <summary>Node circle radius (web <c>NODE_RADIUS</c>).</summary>
    public const double NodeRadius = 14;

    /// <summary>Minimum arrow stroke width (web <c>MIN_STROKE</c>).</summary>
    public const double MinStroke = 1;

    /// <summary>Maximum arrow stroke width (web <c>MAX_STROKE</c>).</summary>
    public const double MaxStroke = 4;

    /// <summary>Map a node anchor to its viewBox coordinate (web <c>POSITION_COORDS</c>).</summary>
    public static FlowPoint Coord(EnergyFlowPosition position) => position switch
    {
        EnergyFlowPosition.Top => new FlowPoint(50, 12),
        EnergyFlowPosition.Bottom => new FlowPoint(50, 88),
        EnergyFlowPosition.Left => new FlowPoint(12, 50),
        EnergyFlowPosition.Right => new FlowPoint(88, 50),
        _ => new FlowPoint(50, 50),
    };

    /// <summary>
    /// Stroke width for a flow magnitude (web <c>strokeForValue</c>): scales linearly from
    /// <see cref="MinStroke"/> to <see cref="MaxStroke"/> by the value's share of <paramref name="maxValue"/>.
    /// </summary>
    public static double StrokeForValue(double value, double maxValue)
    {
        if (maxValue == 0)
        {
            return MinStroke;
        }

        double ratio = Math.Abs(value) / maxValue;
        return MinStroke + (ratio * (MaxStroke - MinStroke));
    }

    /// <summary>The arrow-normalising denominator (web <c>Math.max(...|values|, 1)</c>).</summary>
    public static double MaxArrowValue(IEnumerable<EnergyFlowArrow> arrows)
    {
        ArgumentNullException.ThrowIfNull(arrows);
        double max = 1;
        foreach (var arrow in arrows)
        {
            max = Math.Max(max, Math.Abs(arrow.Value));
        }

        return max;
    }

    /// <summary>
    /// The drawn segment between two nodes, offset at each end by <paramref name="radius"/> so the line never
    /// overlaps a node circle (web's unit-vector offset of the start/end by the node radius).
    /// </summary>
    public static FlowSegment Segment(FlowPoint from, FlowPoint to, double radius)
    {
        double dx = to.X - from.X;
        double dy = to.Y - from.Y;
        double dist = Math.Sqrt((dx * dx) + (dy * dy));
        if (dist == 0)
        {
            dist = 1;
        }

        double ux = dx / dist;
        double uy = dy / dist;
        return new FlowSegment(
            from.X + (ux * radius),
            from.Y + (uy * radius),
            to.X - (ux * radius),
            to.Y - (uy * radius));
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> state emissions onto parsed
/// <c>RepositoryResult&lt;EnergyFlowSnapshot&gt;</c>, preserving every freshness flag
/// (cached / refreshing / stale / offline). A successful emission whose body carries no usable state collapses
/// to <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web <c>{state ? … : empty}</c>
/// gate. Kept pure so the parse-and-preserve contract is unit-tested without a network or cache.
/// </summary>
public static class EnergyFlowResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s state payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<EnergyFlowSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        EnergyFlowSnapshot? Parse() =>
            raw.HasValue && VehicleEnergyFlowState.FromResponse(raw.Value) is { } state
                ? new EnergyFlowSnapshot(state)
                : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<EnergyFlowSnapshot>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<EnergyFlowSnapshot>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<EnergyFlowSnapshot>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<EnergyFlowSnapshot>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<EnergyFlowSnapshot>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            _ => RepositoryResult<EnergyFlowSnapshot>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
