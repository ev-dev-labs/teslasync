using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state an <see cref="EnergyFlowViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>EnergyFlowWidget</c> renders
/// through <c>WidgetShell</c> (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx). Every branch maps
/// onto a visible surface; none is ever hidden. <see cref="Empty"/> mirrors the web
/// <c>{state ? &lt;WidgetFlowDiagram/&gt; : &lt;EmptyState/&gt;}</c> gate — no resolved vehicle / no usable
/// state in the response — the "No energy data available" surface.
/// </summary>
public enum EnergyFlowState
{
    /// <summary>Initial fetch with no cached snapshot — render the full-area skeleton (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) with a vehicle state to render the flow diagram for.</summary>
    Loaded,

    /// <summary>No vehicle resolved or the response carried no state — render the "No energy data available" surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the diagram plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the diagram plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The fields the energy-flow view reads from <c>GET /vehicles/{vehicleID}/state</c> — the native mirror of
/// the <c>VehicleState</c> slice the web widget consumes (<c>power</c>, <c>is_charging</c>,
/// <c>charger_power</c>, <c>battery_level</c>, web/src/api/types). Values are read verbatim from the wire
/// exactly as the web component reads them (the web treats <c>power</c> and <c>charger_power</c> as kW and
/// <c>battery_level</c> as a 0–100 percent) so the native surface reproduces the web's observable output —
/// never silently "corrected". A <see langword="null"/> parse result models the web <c>stateData?.state</c>
/// being undefined (no state in the response → the empty surface). Parsing is null-tolerant so a partial body
/// never throws.
/// </summary>
/// <param name="Power">Instantaneous power as the web reads it — kilowatts; positive = consuming, negative = regenerating (web <c>power</c>).</param>
/// <param name="IsCharging">Whether the vehicle is actively charging (web <c>is_charging</c>).</param>
/// <param name="ChargerPowerKw">Charger power as the web reads it — kilowatts (web <c>charger_power</c>).</param>
/// <param name="BatteryLevel">State-of-charge percent (0–100, unit-free; web <c>battery_level</c>).</param>
public sealed record EnergyFlowVehicleState(
    double Power,
    bool IsCharging,
    double ChargerPowerKw,
    double BatteryLevel)
{
    /// <summary>
    /// Project a <c>GET /vehicles/{vehicleID}/state</c> response into the energy-flow slice, mirroring the
    /// normalisation in the web <c>useVehicleState</c> hook: prefer the canonical <c>state</c> object (the one
    /// carrying <c>vehicle_id</c>), otherwise fall back to a plain <c>state</c> object, otherwise reconstruct
    /// from <c>position.battery_level</c> + the top-level power/charging fields when a <c>vehicle</c>/
    /// <c>position</c> is present. Returns <see langword="null"/> when none of those yield a state — the native
    /// analogue of the web <c>state</c> being undefined.
    /// </summary>
    public static EnergyFlowVehicleState? FromResponse(JsonElement root)
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

        // Web parity (fallback): battery from the position snapshot; power/charging from top-level res.
        return new EnergyFlowVehicleState(
            Power: ReadDouble(root, "power") ?? 0,
            IsCharging: ReadBool(root, "is_charging"),
            ChargerPowerKw: ReadDouble(root, "charger_power") ?? 0,
            BatteryLevel: position is { } p ? ReadDouble(p, "battery_level") ?? 0 : 0);
    }

    private static EnergyFlowVehicleState FromStateObject(JsonElement state) => new(
        Power: ReadDouble(state, "power") ?? 0,
        IsCharging: ReadBool(state, "is_charging"),
        ChargerPowerKw: ReadDouble(state, "charger_power") ?? 0,
        BatteryLevel: ReadDouble(state, "battery_level") ?? 0);

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
/// The energy-flow snapshot the view-model projects — the native analogue of the single web query the
/// component composes (the live vehicle <see cref="State"/> from <c>useVehicleState</c>, which drives every
/// node/arrow and the freshness/error chrome). Pure data so the projection is unit-tested without a UI host.
/// </summary>
public sealed record EnergyFlowSnapshot(EnergyFlowVehicleState State);

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c>. The web
/// <c>EnergyFlowWidget</c> renders the same diagram at every footprint (it never reads <c>size</c>), so the
/// footprint only drives the registry bounds and the host layout; the projection is size-independent.
/// </summary>
public readonly record struct EnergyFlowSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×4).</summary>
    public static EnergyFlowSize Default => new(2, 4);
}

/// <summary>
/// Where a flow node sits on the diagram — the native union of the web <c>FlowNode['position']</c>
/// ('top' | 'bottom' | 'left' | 'right' | 'center'). <see cref="EnergyFlowGeometry"/> maps each onto the
/// same 100×100 view-box coordinate the web <c>POSITION_COORDS</c> table uses.
/// </summary>
public enum FlowNodePosition
{
    /// <summary>Top centre (web <c>{ cx: 50, cy: 12 }</c>).</summary>
    Top,

    /// <summary>Bottom centre (web <c>{ cx: 50, cy: 88 }</c>).</summary>
    Bottom,

    /// <summary>Left middle (web <c>{ cx: 12, cy: 50 }</c>).</summary>
    Left,

    /// <summary>Right middle (web <c>{ cx: 88, cy: 50 }</c>).</summary>
    Right,

    /// <summary>Centre (web <c>{ cx: 50, cy: 50 }</c>).</summary>
    Center,
}

/// <summary>
/// One node of the energy-flow diagram — the native counterpart of the web <c>FlowNode</c> (an id, a localized
/// label, the raw numeric value the diagram count-up shows, a pre-formatted value for the Narrator name, the
/// leading Segoe Fluent glyph and its semantic colour, and the diagram position). Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable node id (web <c>FlowNode.id</c>, e.g. "battery"); arrows reference it.</param>
/// <param name="Label">The localized node label (web <c>FlowNode.label</c>).</param>
/// <param name="Value">The raw value the diagram renders to one decimal (web <c>FlowNode.value</c>).</param>
/// <param name="FormattedValue">The pre-formatted value for the Narrator name (web <c>FlowNode.formattedValue</c>).</param>
/// <param name="Glyph">The Segoe Fluent glyph for the node icon (web lucide icon).</param>
/// <param name="IconColorHex">The node icon's semantic colour (web Tailwind <c>text-*-400</c>).</param>
/// <param name="Position">Where the node sits on the diagram (web <c>FlowNode.position</c>).</param>
/// <param name="AutomationName">The Narrator name (label + formatted value).</param>
public sealed record EnergyFlowNode(
    string Id,
    string Label,
    double Value,
    string FormattedValue,
    string Glyph,
    string IconColorHex,
    FlowNodePosition Position,
    string AutomationName);

/// <summary>
/// One directional arrow of the energy-flow diagram — the native counterpart of the web <c>FlowArrow</c> (the
/// source/target node ids, the magnitude that drives the stroke width, whether it is the active "marching ants"
/// flow, and its semantic colour). Pure data — no WinUI types.
/// </summary>
/// <param name="FromId">Source node id (web <c>FlowArrow.from</c>).</param>
/// <param name="ToId">Target node id (web <c>FlowArrow.to</c>).</param>
/// <param name="Value">The magnitude driving the stroke width (web <c>FlowArrow.value</c>).</param>
/// <param name="Active">Whether the arrow shows the animated dash flow (web <c>FlowArrow.active</c>).</param>
/// <param name="ColorHex">The arrow's semantic colour (web <c>FlowArrow.color</c>).</param>
public sealed record EnergyFlowArrow(
    string FromId,
    string ToId,
    double Value,
    bool Active,
    string ColorHex);

/// <summary>
/// The fully projected, render-ready view of the energy-flow surface — the native analogue of everything the
/// web component computes before returning JSX (the memoised <c>nodes</c> and <c>arrows</c> arrays plus the
/// diagram's accessible name). Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Nodes">The diagram nodes (always battery + motor, plus charger while charging).</param>
/// <param name="Arrows">The diagram arrows (battery↔motor, plus charger→battery while charging).</param>
/// <param name="DiagramAutomationName">The diagram's Narrator name (web SVG <c>aria-label</c>, localized here).</param>
public sealed record EnergyFlowDisplay(
    IReadOnlyList<EnergyFlowNode> Nodes,
    IReadOnlyList<EnergyFlowArrow> Arrows,
    string DiagramAutomationName);

/// <summary>
/// Pure geometry for the energy-flow diagram — the native port of the web <c>WidgetFlowDiagram</c>'s
/// <c>POSITION_COORDS</c> table, <c>NODE_RADIUS</c>, <c>strokeForValue</c> and the arrow start/end offsetting
/// (web/src/features/dashboard/widgets/shared/WidgetFlowDiagram.tsx). Operates in the same 100×100 view-box
/// the WinUI view scales with a <c>Viewbox</c>, so the native diagram is laid out identically. Kept UI-free so
/// the layout math is unit-tested without a XAML runtime.
/// </summary>
public static class EnergyFlowGeometry
{
    /// <summary>Node circle radius in view-box units (web <c>NODE_RADIUS</c>).</summary>
    public const double NodeRadius = 14;

    /// <summary>Thinnest arrow stroke in view-box units (web <c>MIN_STROKE</c>).</summary>
    public const double MinStroke = 1;

    /// <summary>Thickest arrow stroke in view-box units (web <c>MAX_STROKE</c>).</summary>
    public const double MaxStroke = 4;

    /// <summary>The diagram view-box edge length (web SVG <c>viewBox="0 0 100 100"</c>).</summary>
    public const double ViewBox = 100;

    /// <summary>The centre coordinate of a node at <paramref name="position"/> (web <c>POSITION_COORDS</c>).</summary>
    public static (double Cx, double Cy) Coords(FlowNodePosition position) => position switch
    {
        FlowNodePosition.Top => (50, 12),
        FlowNodePosition.Bottom => (50, 88),
        FlowNodePosition.Left => (12, 50),
        FlowNodePosition.Right => (88, 50),
        _ => (50, 50),
    };

    /// <summary>
    /// The largest arrow magnitude, floored at 1 (web <c>Math.max(...arrows.map(|value|), 1)</c>). Drives the
    /// stroke-width ratio so the thickest arrow is <see cref="MaxStroke"/>.
    /// </summary>
    public static double MaxArrowValue(IReadOnlyList<EnergyFlowArrow> arrows)
    {
        ArgumentNullException.ThrowIfNull(arrows);
        double max = 1;
        foreach (var arrow in arrows)
        {
            double abs = Math.Abs(arrow.Value);
            if (abs > max)
            {
                max = abs;
            }
        }

        return max;
    }

    /// <summary>
    /// The stroke width for an arrow of <paramref name="value"/> against <paramref name="maxValue"/> (web
    /// <c>strokeForValue</c>): <see cref="MinStroke"/> when the scale is zero, otherwise scaled linearly up to
    /// <see cref="MaxStroke"/> by the magnitude ratio.
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

    /// <summary>
    /// The start/end points of the arrow from <paramref name="from"/> to <paramref name="to"/>, offset by the
    /// node radius <paramref name="r"/> so the line touches the circles' edges rather than their centres (web
    /// <c>x1/y1/x2/y2</c> unit-vector offsetting). A zero-length pair (coincident nodes) keeps the centre.
    /// </summary>
    public static (double X1, double Y1, double X2, double Y2) ArrowEndpoints(
        FlowNodePosition from,
        FlowNodePosition to,
        double r)
    {
        var (fx, fy) = Coords(from);
        var (tx, ty) = Coords(to);

        double dx = tx - fx;
        double dy = ty - fy;
        double dist = Math.Sqrt((dx * dx) + (dy * dy));
        if (dist <= 0)
        {
            return (fx, fy, tx, ty);
        }

        double ux = dx / dist;
        double uy = dy / dist;
        return (fx + (ux * r), fy + (uy * r), tx - (ux * r), ty - (uy * r));
    }
}

/// <summary>
/// Pure projection from a raw <see cref="EnergyFlowSnapshot"/> to the render-ready <see cref="EnergyFlowDisplay"/>
/// — the native port of the web component's <c>nodes</c> and <c>arrows</c> memos
/// (web/src/features/dashboard/widgets/EnergyFlowWidget.tsx). Reproduces the same derivations: a battery node
/// (left) and a motor node (right, labelled Consuming / Regenerating / Standby by the sign of <c>power</c>),
/// plus a charger node (top) and a charger→battery arrow only while charging; the consume arrow is active when
/// power &gt; 0 and the regen arrow when power &lt; 0. Power/charger values are formatted "{n} kW" to one
/// decimal and the battery as "{n}%" exactly as the web does. Every label resolves through the i18n facade.
/// </summary>
public static class EnergyFlowProjection
{
    /// <summary>Stable node id for the battery node (web <c>'battery'</c>).</summary>
    public const string BatteryNodeId = "battery";

    /// <summary>Stable node id for the motor node (web <c>'motor'</c>).</summary>
    public const string MotorNodeId = "motor";

    /// <summary>Stable node id for the charger node (web <c>'charger'</c>).</summary>
    public const string ChargerNodeId = "charger";

    /// <summary>Segoe Fluent "Battery10" glyph — the web <c>BatteryCharging</c> battery-node icon.</summary>
    public const string BatteryGlyph = "\uE83F";

    /// <summary>Segoe Fluent "LightningBolt" glyph — the web <c>Zap</c> motor-node icon.</summary>
    public const string ZapGlyph = "\uE945";

    /// <summary>Segoe Fluent "PowerButton" glyph — the web <c>Plug</c> charger-node icon.</summary>
    public const string PlugGlyph = "\uE7E8";

    /// <summary>Segoe Fluent "Health" pulse glyph — the web header <c>Activity</c> icon.</summary>
    public const string ActivityGlyph = "\uE9D9";

    /// <summary>Tailwind <c>emerald-400</c> — the battery icon + the regen flow arrow.</summary>
    public const string EmeraldHex = "#34D399";

    /// <summary>Tailwind <c>purple-400</c> — the motor (Zap) icon.</summary>
    public const string PurpleHex = "#C084FC";

    /// <summary>Tailwind <c>amber-400</c> — the charger icon + the charge flow arrow.</summary>
    public const string AmberHex = "#FBBF24";

    /// <summary>Tailwind <c>cyan-400</c> — the consume flow arrow (and the header Activity icon).</summary>
    public const string CyanHex = "#22D3EE";

    /// <summary>The em dash the web renders for the zero-power motor formatted value (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Power / charger readout fraction digits (web <c>fmtNumber(…, 1)</c>).</summary>
    public const int PowerPrecision = 1;

    /// <summary>Project <paramref name="snapshot"/> using <paramref name="localizer"/> for every label.</summary>
    public static EnergyFlowDisplay Project(EnergyFlowSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var state = snapshot.State;

        // Web parity: derive the same flags the component memoises.
        double power = Safe(state.Power);
        bool isConsuming = power > 0;
        bool isRegen = power < 0;
        double absPower = Math.Abs(power);
        bool isCharging = state.IsCharging;
        double chargerPower = Safe(state.ChargerPowerKw);
        double batteryLevel = Safe(state.BatteryLevel);

        string batteryLabel = localizer.GetString("widget.battery", "Battery");
        string motorLabel = isConsuming
            ? localizer.GetString("widget.consuming", "Consuming")
            : isRegen
                ? localizer.GetString("widget.regenerating", "Regenerating")
                : localizer.GetString("widget.standby", "Standby");

        string batteryFormatted = FormatPercent(batteryLevel);
        string motorFormatted = absPower > 0 ? FormatPowerKw(absPower) : EmDash;

        var nodes = new List<EnergyFlowNode>(3)
        {
            new(
                Id: BatteryNodeId,
                Label: batteryLabel,
                Value: batteryLevel,
                FormattedValue: batteryFormatted,
                Glyph: BatteryGlyph,
                IconColorHex: EmeraldHex,
                Position: FlowNodePosition.Left,
                AutomationName: $"{batteryLabel}, {batteryFormatted}"),
            new(
                Id: MotorNodeId,
                Label: motorLabel,
                Value: absPower,
                FormattedValue: motorFormatted,
                Glyph: ZapGlyph,
                IconColorHex: PurpleHex,
                Position: FlowNodePosition.Right,
                AutomationName: $"{motorLabel}, {motorFormatted}"),
        };

        if (isCharging)
        {
            string chargerLabel = localizer.GetString("widget.charger", "Charger");
            string chargerFormatted = FormatPowerKw(chargerPower);
            nodes.Add(new EnergyFlowNode(
                Id: ChargerNodeId,
                Label: chargerLabel,
                Value: chargerPower,
                FormattedValue: chargerFormatted,
                Glyph: PlugGlyph,
                IconColorHex: AmberHex,
                Position: FlowNodePosition.Top,
                AutomationName: $"{chargerLabel}, {chargerFormatted}"));
        }

        var arrows = new List<EnergyFlowArrow>(3)
        {
            new(BatteryNodeId, MotorNodeId, isConsuming ? absPower : 0, isConsuming, CyanHex),
            new(MotorNodeId, BatteryNodeId, isRegen ? absPower : 0, isRegen, EmeraldHex),
        };

        if (isCharging)
        {
            arrows.Add(new EnergyFlowArrow(ChargerNodeId, BatteryNodeId, chargerPower, true, AmberHex));
        }

        // The web SVG aria-label is the hard-coded "Energy flow diagram"; surface the localized widget title so
        // the native diagram carries a meaningful, translated Narrator name instead of an English literal.
        string diagramName = localizer.GetString("widget.energyFlow", "Energy Flow");

        return new EnergyFlowDisplay(nodes, arrows, diagramName);
    }

    /// <summary>Format a kW value as the web does — one fraction digit with a " kW" suffix (web <c>fmtNumber(…, 1) + ' kW'</c>).</summary>
    public static string FormatPowerKw(double value) =>
        ScalarFormatters.FormatNumber(Safe(value), PowerPrecision) + " kW";

    /// <summary>Format a battery percent the way the web interpolates <c>{batteryLevel}%</c> (raw number + "%").</summary>
    public static string FormatPercent(double value)
    {
        double safe = Safe(value);
        return safe.ToString(CultureInfo.InvariantCulture) + "%";
    }

    private static double Safe(double value) =>
        double.IsNaN(value) || double.IsInfinity(value) ? 0.0 : value;
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> state emissions onto parsed
/// <c>RepositoryResult&lt;EnergyFlowSnapshot&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no usable state collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web
/// <c>{state ? &lt;WidgetFlowDiagram/&gt; : &lt;EmptyState/&gt;}</c> gate. Kept pure so the parse-preserve
/// contract is unit-tested without a network or cache.
/// </summary>
public static class EnergyFlowResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s state payload (when present) and preserve the status.</summary>
    public static RepositoryResult<EnergyFlowSnapshot> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        EnergyFlowSnapshot? Combine() =>
            raw.HasValue && EnergyFlowVehicleState.FromResponse(raw.Value) is { } state
                ? new EnergyFlowSnapshot(state)
                : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<EnergyFlowSnapshot>.Loading(),
            LoadStatus.Cached => Combine() is { } snapshot
                ? RepositoryResult<EnergyFlowSnapshot>.Cached(snapshot, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Combine() is { } snapshot
                ? RepositoryResult<EnergyFlowSnapshot>.Refreshing(snapshot, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Combine() is { } snapshot
                ? RepositoryResult<EnergyFlowSnapshot>.Loaded(snapshot, raw.FetchedAt!.Value)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Combine() is { } snapshot
                ? RepositoryResult<EnergyFlowSnapshot>.OfflineCached(snapshot, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<EnergyFlowSnapshot>.Empty(raw.FetchedAt),
            _ => RepositoryResult<EnergyFlowSnapshot>.Failure(raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
