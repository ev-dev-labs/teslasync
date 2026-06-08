using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.DashboardWidgets;

/// <summary>
/// The lifecycle state a <see cref="DoorWindowStatusViewModel"/> can be in — the native union of the
/// loading / loaded / empty / error / stale / offline branches the web <c>DoorWindowStatusWidget</c>
/// renders through <c>WidgetShell</c>
/// (web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx). Every branch maps onto a visible
/// surface; none is ever hidden. <see cref="Empty"/> mirrors the web outer
/// <c>{securityData ? … : &lt;WidgetStatusGrid cells={[]} … /&gt;}</c> gate — the
/// <c>useSecurityLatest</c> read resolved no security object (a null body or no vehicle) — the
/// "No door/window data" surface. A security object that simply carries no door/window fields is NOT
/// empty: it still renders the grid with every cell at the em-dash "unknown" status, exactly like the web
/// (where <c>securityData</c> is truthy and <c>parseDoorStates(undefined)</c> yields four "unknown" cells).
/// </summary>
public enum DoorWindowStatusState
{
    /// <summary>Initial fetch with no cached snapshot — render the skeleton chrome (web <c>WidgetShell loading</c>).</summary>
    Loading,

    /// <summary>A fresh snapshot (or non-stale cache) carrying a security object to render the grid/badges for.</summary>
    Loaded,

    /// <summary>No security object resolved (null body / no vehicle) — render the "No door/window data" empty surface.</summary>
    Empty,

    /// <summary>The request failed and no cached snapshot exists — render the retry affordance.</summary>
    Error,

    /// <summary>A cached snapshot older than the freshness window — render the grid/badges plus a stale chip.</summary>
    Stale,

    /// <summary>The network failed but a cached snapshot remains — render the grid/badges plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The state of a single door or window — the native union of the web <c>DoorWindowState</c>
/// (web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx). <see cref="Unknown"/> models a field the
/// backend never reported (the web em dash); <see cref="Partial"/> only ever arises for a window (a vented
/// window), never a door, exactly as the web parsers produce.
/// </summary>
public enum DoorWindowState
{
    /// <summary>Closed (web <c>'closed'</c>) — renders the success status.</summary>
    Closed,

    /// <summary>Open (web <c>'open'</c>) — renders the warning status.</summary>
    Open,

    /// <summary>Partially open / vented (web <c>'partial'</c>, windows only) — renders the warning status.</summary>
    Partial,

    /// <summary>No value reported (web <c>'unknown'</c>) — renders the neutral status and the em dash.</summary>
    Unknown,
}

/// <summary>The JSON kind a <see cref="DoorWindowScalar"/> was narrowed to.</summary>
public enum DoorWindowScalarKind
{
    /// <summary>No usable value — JSON null, number, object, array, empty string, or an absent property.</summary>
    None,

    /// <summary>A native JSON boolean (web <c>typeof val === 'boolean'</c>).</summary>
    Boolean,

    /// <summary>A non-empty JSON string (web <c>asNonEmptyString(val)</c>).</summary>
    Text,
}

/// <summary>
/// A tolerant projection of one door/window JSON field, mirroring the web's <c>unknown</c> narrowing: the
/// backend serializes <c>signal.SignalValue</c> (<c>interface{}</c>), so a field can arrive as a native
/// boolean (e.g. <c>false</c>) or a string enum. This captures exactly the three cases the web parsers
/// branch on — a native boolean (<c>typeof val === 'boolean'</c>), a non-empty string
/// (<c>asNonEmptyString(val)</c>, which keeps the value only when it is a string of length &gt; 0), and
/// "nothing usable" (every other JSON kind, an empty string, or an absent property) — so the parsers can be
/// unit-tested without a JSON host.
/// </summary>
/// <param name="Kind">Which of the three narrowed cases this value is.</param>
/// <param name="BooleanValue">The boolean payload when <see cref="Kind"/> is <see cref="DoorWindowScalarKind.Boolean"/>.</param>
/// <param name="TextValue">The string payload when <see cref="Kind"/> is <see cref="DoorWindowScalarKind.Text"/>.</param>
public readonly record struct DoorWindowScalar(DoorWindowScalarKind Kind, bool BooleanValue, string? TextValue)
{
    /// <summary>The "nothing usable" value (web <c>asNonEmptyString</c> returning null).</summary>
    public static DoorWindowScalar None => new(DoorWindowScalarKind.None, false, null);

    /// <summary>A native boolean value (web <c>typeof val === 'boolean'</c>).</summary>
    public static DoorWindowScalar FromBoolean(bool value) => new(DoorWindowScalarKind.Boolean, value, null);

    /// <summary>A string value, narrowed to <see cref="None"/> when null or empty (web <c>asNonEmptyString</c>).</summary>
    public static DoorWindowScalar FromText(string? value) =>
        string.IsNullOrEmpty(value) ? None : new(DoorWindowScalarKind.Text, false, value);

    /// <summary>
    /// Read property <paramref name="name"/> off <paramref name="obj"/> as a tolerant scalar — a JSON
    /// boolean becomes <see cref="FromBoolean"/>, a non-empty JSON string becomes <see cref="FromText"/>,
    /// and every other kind (null / number / object / array / empty string / absent) becomes <see cref="None"/>,
    /// matching the web's <c>typeof === 'boolean'</c> then <c>asNonEmptyString</c> narrowing order.
    /// </summary>
    public static DoorWindowScalar Read(JsonElement obj, string name)
    {
        if (obj.ValueKind != JsonValueKind.Object || !obj.TryGetProperty(name, out var v))
        {
            return None;
        }

        return v.ValueKind switch
        {
            JsonValueKind.True => FromBoolean(true),
            JsonValueKind.False => FromBoolean(false),
            JsonValueKind.String => FromText(v.GetString()),
            _ => None,
        };
    }
}

/// <summary>
/// The four corner states of either the doors or the windows (front-left, front-right, rear-left,
/// rear-right) — the native analogue of the web <c>Record&lt;'fl'|'fr'|'rl'|'rr', DoorWindowState&gt;</c>.
/// </summary>
/// <param name="Fl">Front-left state.</param>
/// <param name="Fr">Front-right state.</param>
/// <param name="Rl">Rear-left state.</param>
/// <param name="Rr">Rear-right state.</param>
public readonly record struct DoorWindowSet(
    DoorWindowState Fl,
    DoorWindowState Fr,
    DoorWindowState Rl,
    DoorWindowState Rr)
{
    /// <summary>All four corners at the same state (the all-open / all-closed / all-unknown shorthands).</summary>
    public static DoorWindowSet All(DoorWindowState state) => new(state, state, state, state);
}

/// <summary>
/// The security slice the door/window view reads from <c>GET /security/latest?vehicle_id={id}</c> — the
/// native mirror of the exact <c>SecurityEvent</c> fields the web widget consumes (<c>door_state</c> and the
/// four window fields <c>fd_window</c> / <c>fp_window</c> / <c>rd_window</c> / <c>rp_window</c>), already
/// reduced to the parsed four-door + four-window matrix. A <see langword="null"/> parse result models the web
/// <c>securityData</c> being null/undefined (no security object → the empty surface); any JSON object yields a
/// reading (matching the web's truthy <c>securityData ?</c> gate), with absent fields parsing to the
/// "unknown" state so a partial body never throws and each cell independently shows the em dash.
/// </summary>
/// <param name="Doors">The four parsed door states (web <c>parseDoorStates(securityData.door_state)</c>).</param>
/// <param name="Windows">The four parsed window states (web per-corner <c>parseWindowState</c>).</param>
public sealed record DoorWindowReading(DoorWindowSet Doors, DoorWindowSet Windows)
{
    /// <summary>
    /// Project a <c>GET /security/latest</c> response into the door/window slice. Returns
    /// <see langword="null"/> when the body is not a JSON object — the native analogue of the web
    /// <c>securityData</c> being null (the empty surface). Any object yields a reading (matching the web's
    /// truthy <c>securityData ?</c> gate); the door matrix comes from <c>door_state</c> and each window from
    /// its dedicated field, all tolerant of absent / null / boolean / string shapes.
    /// </summary>
    public static DoorWindowReading? FromResponse(JsonElement root)
    {
        if (root.ValueKind != JsonValueKind.Object)
        {
            return null;
        }

        var doors = DoorWindowStatusProjection.ParseDoorStates(DoorWindowScalar.Read(root, "door_state"));
        var windows = new DoorWindowSet(
            Fl: DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.Read(root, "fd_window")),
            Fr: DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.Read(root, "fp_window")),
            Rl: DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.Read(root, "rd_window")),
            Rr: DoorWindowStatusProjection.ParseWindowState(DoorWindowScalar.Read(root, "rp_window")));

        return new DoorWindowReading(doors, windows);
    }
}

/// <summary>
/// The widget's grid footprint (columns × rows). Mirrors the web <c>WidgetProps.size</c> plus the
/// <c>isCompact</c> / <c>isTall</c> branches in
/// web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx.
/// </summary>
/// <param name="Cols">Column span.</param>
/// <param name="Rows">Row span.</param>
public readonly record struct DoorWindowStatusSize(int Cols, int Rows)
{
    /// <summary>The registry default footprint (2×2).</summary>
    public static DoorWindowStatusSize Default => new(2, 2);

    /// <summary>
    /// True only at the single 1×1 footprint (web <c>isCompact = size.cols === 1 &amp;&amp; size.rows === 1</c>):
    /// the title is hidden and the body collapses to the two summary badges.
    /// </summary>
    public bool IsCompact => Cols == 1 && Rows == 1;

    /// <summary>True at two or more rows (web <c>isTall = size.rows &gt;= 2</c>): the two grids breathe further apart.</summary>
    public bool IsTall => Rows >= 2;
}

/// <summary>
/// One projected, display-ready status cell consumed by the WinUI view — the native analogue of a web
/// <c>StatusCell</c> rendered by the shared <c>WidgetStatusGrid</c>. Holds the localized corner label, the
/// derived semantic status (which the view maps to a themed tint + dot), the already-localized value text
/// ("Open" / "Closed" / "Partial" / em dash) and a Narrator automation name. Pure data — no WinUI types.
/// </summary>
/// <param name="Id">Stable cell id (web <c>door-fl</c> / <c>window-rr</c> …).</param>
/// <param name="Label">Localized corner label (Front Left / Front Right / Rear Left / Rear Right).</param>
/// <param name="Status">Semantic status driving the tint + dot (web <c>toGridStatus</c>).</param>
/// <param name="Value">Localized value text (web <c>toValueLabel</c>).</param>
/// <param name="AutomationName">Narrator name combining the label and value.</param>
public sealed record DoorWindowCell(
    string Id,
    string Label,
    StatusKind Status,
    string Value,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the door/window surface for one footprint — the native analogue
/// of everything the web component computes via <c>useMemo</c> before returning JSX. Holds both the two
/// summary-badge texts/statuses (the web <c>isCompact</c> branch) and the two four-cell grids with their
/// section headings (the web non-compact branch), plus the footprint flags, so the view is a thin renderer.
/// Pure data so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="IsCompact">Whether the compact badge layout applies (web <c>isCompact</c>).</param>
/// <param name="IsTall">Whether the taller inter-section spacing applies (web <c>isTall</c>).</param>
/// <param name="OpenDoorCount">Number of open doors (web <c>openDoorCount</c>).</param>
/// <param name="OpenWindowCount">Number of open/partial windows (web <c>openWindowCount</c>).</param>
/// <param name="DoorBadgeText">Localized door summary badge text (web doors badge).</param>
/// <param name="DoorBadgeStatus">Door badge status — success when all closed, else warning.</param>
/// <param name="WindowBadgeText">Localized window summary badge text (web windows badge).</param>
/// <param name="WindowBadgeStatus">Window badge status — success when all closed, else warning.</param>
/// <param name="DoorsHeading">Localized "Doors" section heading.</param>
/// <param name="WindowsHeading">Localized "Windows" section heading.</param>
/// <param name="DoorCells">The four door cells (web <c>doorCells</c>).</param>
/// <param name="WindowCells">The four window cells (web <c>windowCells</c>).</param>
/// <param name="AutomationName">Narrator name summarising the rendered surface.</param>
public sealed record DoorWindowStatusDisplay(
    bool IsCompact,
    bool IsTall,
    int OpenDoorCount,
    int OpenWindowCount,
    string DoorBadgeText,
    StatusKind DoorBadgeStatus,
    string WindowBadgeText,
    StatusKind WindowBadgeStatus,
    string DoorsHeading,
    string WindowsHeading,
    IReadOnlyList<DoorWindowCell> DoorCells,
    IReadOnlyList<DoorWindowCell> WindowCells,
    string AutomationName);

/// <summary>
/// Pure projection from a raw <see cref="DoorWindowReading"/> to the display model — the native port of the
/// <c>parseDoorStates</c> / <c>parseWindowState</c> / <c>toGridStatus</c> / <c>toValueLabel</c> helpers and the
/// <c>doorCells</c> / <c>windowCells</c> / badge logic in
/// web/src/features/dashboard/widgets/DoorWindowStatusWidget.tsx. Every label resolves through the i18n facade;
/// the em dash reproduces the web <c>'—'</c> for an unknown corner.
/// </summary>
public static class DoorWindowStatusProjection
{
    /// <summary>Segoe Fluent "Permissions" glyph — the security-domain analogue of the web <c>DoorOpen</c> icon.</summary>
    public const string DoorGlyph = "\uE8D7";

    /// <summary>The em dash the web renders for an unknown corner (web <c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>The check mark the web suffixes the "all closed" badges with (web <c>'✓'</c>).</summary>
    public const string CheckMark = "\u2713";

    private const string AllClosedUnderscore = "all_closed";
    private const string AllClosedJoined = "allclosed";
    private const string OpenLiteral = "open";

    /// <summary>
    /// Parse a window field exactly as the web <c>parseWindowState</c> does: a native boolean maps
    /// <see langword="true"/> → <see cref="DoorWindowState.Open"/> and <see langword="false"/> →
    /// <see cref="DoorWindowState.Closed"/>; a non-empty string lower-cases (no trim, matching the web) then
    /// maps <c>"closed"</c> → <see cref="DoorWindowState.Closed"/>, anything containing <c>"vent"</c> or
    /// <c>"partial"</c> → <see cref="DoorWindowState.Partial"/>, else → <see cref="DoorWindowState.Open"/>;
    /// every other shape → <see cref="DoorWindowState.Unknown"/>.
    /// </summary>
    public static DoorWindowState ParseWindowState(DoorWindowScalar value)
    {
        switch (value.Kind)
        {
            case DoorWindowScalarKind.Boolean:
                return value.BooleanValue ? DoorWindowState.Open : DoorWindowState.Closed;

            case DoorWindowScalarKind.Text:
                string lower = value.TextValue!.ToLowerInvariant();
                if (lower == "closed")
                {
                    return DoorWindowState.Closed;
                }

                if (lower.Contains("vent", StringComparison.Ordinal) || lower.Contains("partial", StringComparison.Ordinal))
                {
                    return DoorWindowState.Partial;
                }

                return DoorWindowState.Open;

            default:
                return DoorWindowState.Unknown;
        }
    }

    /// <summary>
    /// Parse the aggregate <c>door_state</c> field exactly as the web <c>parseDoorStates</c> does: a native
    /// boolean opens or closes all four corners; a non-empty string is split on commas, each part trimmed,
    /// lower-cased and dropped when empty, then — if any part is <c>"all_closed"</c>/<c>"allclosed"</c> all four
    /// close; otherwise (when at least one part survived) all four default to closed and each part flips a
    /// specific corner open when it names that corner and contains <c>"open"</c> (driver/passenger ×
    /// front/rear, or front/rear × left/right), with a bare <c>"open"</c> opening all four. Every other shape
    /// (and an all-whitespace string) leaves all four <see cref="DoorWindowState.Unknown"/>.
    /// </summary>
    public static DoorWindowSet ParseDoorStates(DoorWindowScalar value)
    {
        if (value.Kind == DoorWindowScalarKind.Boolean)
        {
            return DoorWindowSet.All(value.BooleanValue ? DoorWindowState.Open : DoorWindowState.Closed);
        }

        if (value.Kind != DoorWindowScalarKind.Text)
        {
            return DoorWindowSet.All(DoorWindowState.Unknown);
        }

        var parts = SplitParts(value.TextValue!);
        if (parts.Count == 0)
        {
            return DoorWindowSet.All(DoorWindowState.Unknown);
        }

        foreach (var part in parts)
        {
            if (part == AllClosedUnderscore || part == AllClosedJoined)
            {
                return DoorWindowSet.All(DoorWindowState.Closed);
            }
        }

        var fl = DoorWindowState.Closed;
        var fr = DoorWindowState.Closed;
        var rl = DoorWindowState.Closed;
        var rr = DoorWindowState.Closed;

        foreach (var part in parts)
        {
            bool open = part.Contains(OpenLiteral, StringComparison.Ordinal);
            if (part.Contains("driver", StringComparison.Ordinal) && part.Contains("front", StringComparison.Ordinal) && open)
            {
                fl = DoorWindowState.Open;
            }
            else if (part.Contains("passenger", StringComparison.Ordinal) && part.Contains("front", StringComparison.Ordinal) && open)
            {
                fr = DoorWindowState.Open;
            }
            else if (part.Contains("driver", StringComparison.Ordinal) && part.Contains("rear", StringComparison.Ordinal) && open)
            {
                rl = DoorWindowState.Open;
            }
            else if (part.Contains("passenger", StringComparison.Ordinal) && part.Contains("rear", StringComparison.Ordinal) && open)
            {
                rr = DoorWindowState.Open;
            }
            else if (part.Contains("front", StringComparison.Ordinal) && part.Contains("left", StringComparison.Ordinal) && open)
            {
                fl = DoorWindowState.Open;
            }
            else if (part.Contains("front", StringComparison.Ordinal) && part.Contains("right", StringComparison.Ordinal) && open)
            {
                fr = DoorWindowState.Open;
            }
            else if (part.Contains("rear", StringComparison.Ordinal) && part.Contains("left", StringComparison.Ordinal) && open)
            {
                rl = DoorWindowState.Open;
            }
            else if (part.Contains("rear", StringComparison.Ordinal) && part.Contains("right", StringComparison.Ordinal) && open)
            {
                rr = DoorWindowState.Open;
            }
            else if (part == OpenLiteral)
            {
                fl = fr = rl = rr = DoorWindowState.Open;
            }
        }

        return new DoorWindowSet(fl, fr, rl, rr);
    }

    /// <summary>
    /// Map a corner state to the semantic status the grid tints it with (web <c>toGridStatus</c>):
    /// <see cref="DoorWindowState.Closed"/> → <see cref="StatusKind.Success"/> (web <c>'ok'</c>),
    /// <see cref="DoorWindowState.Open"/> / <see cref="DoorWindowState.Partial"/> → <see cref="StatusKind.Warning"/>,
    /// <see cref="DoorWindowState.Unknown"/> → <see cref="StatusKind.Neutral"/> (web <c>'unknown'</c>).
    /// </summary>
    public static StatusKind ToStatusKind(DoorWindowState state) => state switch
    {
        DoorWindowState.Closed => StatusKind.Success,
        DoorWindowState.Open or DoorWindowState.Partial => StatusKind.Warning,
        _ => StatusKind.Neutral,
    };

    /// <summary>
    /// Localize a corner value the way the web <c>toValueLabel</c> does — Closed / Open / Partial through the
    /// i18n facade, and the em dash for an unknown corner.
    /// </summary>
    public static string ValueLabel(DoorWindowState state, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return state switch
        {
            DoorWindowState.Closed => localizer.GetString("widget.doorWindow.closed", "Closed"),
            DoorWindowState.Open => localizer.GetString("widget.doorWindow.open", "Open"),
            DoorWindowState.Partial => localizer.GetString("widget.doorWindow.partial", "Partial"),
            _ => EmDash,
        };
    }

    /// <summary>Count of open doors (web <c>openDoorCount</c> — corners strictly equal to "open").</summary>
    public static int OpenDoorCount(DoorWindowSet doors) => Count(doors, static s => s == DoorWindowState.Open);

    /// <summary>
    /// Count of open/partial windows (web <c>openWindowCount</c> — corners that are neither "closed" nor
    /// "unknown").
    /// </summary>
    public static int OpenWindowCount(DoorWindowSet windows) =>
        Count(windows, static s => s != DoorWindowState.Closed && s != DoorWindowState.Unknown);

    /// <summary>Project <paramref name="reading"/> for <paramref name="size"/> using the localizer for every label.</summary>
    public static DoorWindowStatusDisplay Project(
        DoorWindowReading reading,
        DoorWindowStatusSize size,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(reading);
        ArgumentNullException.ThrowIfNull(localizer);

        int openDoors = OpenDoorCount(reading.Doors);
        int openWindows = OpenWindowCount(reading.Windows);

        string doorsHeading = localizer.GetString("widget.doorWindow.doors", "Doors");
        string windowsHeading = localizer.GetString("widget.doorWindow.windows", "Windows");

        var doorCells = BuildCells("door", reading.Doors, localizer);
        var windowCells = BuildCells("window", reading.Windows, localizer);

        string doorBadge = openDoors == 0
            ? localizer.GetString("widget.doorWindow.doorsAllClosed", "Doors " + CheckMark)
            : string.Create(CultureInfo.InvariantCulture, $"{openDoors} {localizer.GetString("widget.doorWindow.doorsOpen", "door(s) open")}");
        string windowBadge = openWindows == 0
            ? localizer.GetString("widget.doorWindow.windowsAllClosed", "Windows " + CheckMark)
            : string.Create(CultureInfo.InvariantCulture, $"{openWindows} {localizer.GetString("widget.doorWindow.windowsOpen", "window(s) open")}");

        string automation = BuildAutomationName(
            size.IsCompact, doorBadge, windowBadge, doorsHeading, windowsHeading, doorCells, windowCells);

        return new DoorWindowStatusDisplay(
            IsCompact: size.IsCompact,
            IsTall: size.IsTall,
            OpenDoorCount: openDoors,
            OpenWindowCount: openWindows,
            DoorBadgeText: doorBadge,
            DoorBadgeStatus: openDoors == 0 ? StatusKind.Success : StatusKind.Warning,
            WindowBadgeText: windowBadge,
            WindowBadgeStatus: openWindows == 0 ? StatusKind.Success : StatusKind.Warning,
            DoorsHeading: doorsHeading,
            WindowsHeading: windowsHeading,
            DoorCells: doorCells,
            WindowCells: windowCells,
            AutomationName: automation);
    }

    private static DoorWindowCell[] BuildCells(string prefix, DoorWindowSet set, ILocalizer localizer)
    {
        return new[]
        {
            BuildCell(prefix, "fl", localizer.GetString("widget.doorWindow.fl", "Front Left"), set.Fl, localizer),
            BuildCell(prefix, "fr", localizer.GetString("widget.doorWindow.fr", "Front Right"), set.Fr, localizer),
            BuildCell(prefix, "rl", localizer.GetString("widget.doorWindow.rl", "Rear Left"), set.Rl, localizer),
            BuildCell(prefix, "rr", localizer.GetString("widget.doorWindow.rr", "Rear Right"), set.Rr, localizer),
        };
    }

    private static DoorWindowCell BuildCell(string prefix, string pos, string label, DoorWindowState state, ILocalizer localizer)
    {
        string value = ValueLabel(state, localizer);
        return new DoorWindowCell(
            Id: $"{prefix}-{pos}",
            Label: label,
            Status: ToStatusKind(state),
            Value: value,
            AutomationName: $"{label} {value}");
    }

    private static string BuildAutomationName(
        bool compact,
        string doorBadge,
        string windowBadge,
        string doorsHeading,
        string windowsHeading,
        IReadOnlyList<DoorWindowCell> doorCells,
        IReadOnlyList<DoorWindowCell> windowCells)
    {
        if (compact)
        {
            return $"{doorBadge}, {windowBadge}";
        }

        string doors = string.Join(", ", Project(doorCells));
        string windows = string.Join(", ", Project(windowCells));
        return $"{doorsHeading}: {doors}. {windowsHeading}: {windows}";

        static IEnumerable<string> Project(IReadOnlyList<DoorWindowCell> cells)
        {
            foreach (var cell in cells)
            {
                yield return cell.AutomationName;
            }
        }
    }

    private static List<string> SplitParts(string raw)
    {
        var result = new List<string>();
        foreach (var segment in raw.Split(','))
        {
            string trimmed = segment.Trim().ToLowerInvariant();
            if (trimmed.Length > 0)
            {
                result.Add(trimmed);
            }
        }

        return result;
    }

    private static int Count(DoorWindowSet set, Func<DoorWindowState, bool> predicate)
    {
        int count = 0;
        if (predicate(set.Fl))
        {
            count++;
        }

        if (predicate(set.Fr))
        {
            count++;
        }

        if (predicate(set.Rl))
        {
            count++;
        }

        if (predicate(set.Rr))
        {
            count++;
        }

        return count;
    }
}

/// <summary>
/// Maps the engine's raw <c>RepositoryResult&lt;JsonElement&gt;</c> emissions onto parsed
/// <c>RepositoryResult&lt;DoorWindowReading&gt;</c>, preserving every freshness flag (cached / refreshing /
/// stale / offline). A successful emission whose body carries no security object collapses to
/// <see cref="RepositoryResult{T}.Empty"/> — the native analogue of the web
/// <c>{securityData ? … : empty grid}</c> gate. Kept pure so the parse-preserve contract is unit-tested
/// without a network or cache.
/// </summary>
public static class DoorWindowStatusResultMapper
{
    /// <summary>Parse <paramref name="raw"/>'s security payload (when present) and preserve the load status.</summary>
    public static RepositoryResult<DoorWindowReading> Map(RepositoryResult<JsonElement> raw)
    {
        ArgumentNullException.ThrowIfNull(raw);

        DoorWindowReading? Parse() =>
            raw.HasValue ? DoorWindowReading.FromResponse(raw.Value) : null;

        return raw.Status switch
        {
            LoadStatus.Loading => RepositoryResult<DoorWindowReading>.Loading(),
            LoadStatus.Cached => Parse() is { } cached
                ? RepositoryResult<DoorWindowReading>.Cached(cached, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<DoorWindowReading>.Empty(raw.FetchedAt),
            LoadStatus.Refreshing => Parse() is { } refreshing
                ? RepositoryResult<DoorWindowReading>.Refreshing(refreshing, raw.FetchedAt!.Value, raw.IsStale)
                : RepositoryResult<DoorWindowReading>.Empty(raw.FetchedAt),
            LoadStatus.Loaded => Parse() is { } loaded
                ? RepositoryResult<DoorWindowReading>.Loaded(loaded, raw.FetchedAt ?? DateTimeOffset.UtcNow)
                : RepositoryResult<DoorWindowReading>.Empty(raw.FetchedAt),
            LoadStatus.Empty => RepositoryResult<DoorWindowReading>.Empty(raw.FetchedAt),
            LoadStatus.Offline => Parse() is { } offline
                ? RepositoryResult<DoorWindowReading>.OfflineCached(offline, raw.FetchedAt!.Value, raw.Error!)
                : RepositoryResult<DoorWindowReading>.Empty(raw.FetchedAt),
            _ => RepositoryResult<DoorWindowReading>.Failure(
                raw.Error ?? new RepositoryError(RepositoryErrorKind.Unknown, "Unknown error")),
        };
    }
}
