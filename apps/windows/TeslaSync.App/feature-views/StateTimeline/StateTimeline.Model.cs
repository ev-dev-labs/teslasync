using System.Globalization;
using System.Text.Json;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.StateMachine;

/// <summary>
/// One FSM state transition the timeline renders — the native, WinUI-free mirror of the subset of the web
/// <c>FSMTransition</c> (<c>web/src/types/fsm/ui-types.ts</c>) the component touches: the row
/// <see cref="Id"/> (web <c>id</c>, used as the React key and the selection identity), the
/// <see cref="Ts"/> timestamp (web <c>ts</c>, an ISO-8601 UTC string), and the
/// <see cref="FromState"/> / <see cref="ToState"/> labels (web <c>from_state</c> / <c>to_state</c>) the
/// tooltip and Narrator label compose and whose destination resolves the tick colour. Field names mirror the
/// Go API's snake_case JSON tags. Parsing is null-tolerant so a partial cached row never throws. Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Id">The transition identity (web <c>id</c>); the timeline keys and selects ticks on this.</param>
/// <param name="Ts">When the transition occurred (web <c>ts</c>, API <c>ts</c>, ISO-8601 UTC).</param>
/// <param name="FromState">The state departed (web <c>from_state</c>).</param>
/// <param name="ToState">The state entered (web <c>to_state</c>); resolves the tick colour.</param>
public sealed record StateTransition(long Id, DateTimeOffset Ts, string FromState, string ToState)
{
    /// <summary>Project a single transition JSON object into a tolerant record.</summary>
    public static StateTransition FromJson(JsonElement obj) => new(
        GetInt64(obj, "id") ?? 0,
        GetDateTime(obj, "ts") ?? DateTimeOffset.UnixEpoch,
        GetString(obj, "from_state") ?? string.Empty,
        GetString(obj, "to_state") ?? string.Empty);

    /// <summary>
    /// Project a cached transitions payload into the ordered list the component renders — the native analogue
    /// of the web <c>transitions</c> prop. A JSON array maps element-by-element (non-object entries are
    /// skipped, mirroring the web's already-typed array); a wrapper object with a <c>data</c> array (the Go
    /// <c>FSMTransitionResponse</c> shape) is unwrapped; anything else yields an empty list.
    /// </summary>
    public static IReadOnlyList<StateTransition> ParseList(JsonElement element)
    {
        JsonElement array = element;
        if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty("data", out var data))
        {
            array = data;
        }

        if (array.ValueKind != JsonValueKind.Array)
        {
            return Array.Empty<StateTransition>();
        }

        var list = new List<StateTransition>(array.GetArrayLength());
        foreach (var item in array.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object)
            {
                list.Add(FromJson(item));
            }
        }

        return list;
    }

    private static long? GetInt64(JsonElement obj, string name)
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

    private static DateTimeOffset? GetDateTime(JsonElement obj, string name)
    {
        if (!obj.TryGetProperty(name, out var v))
        {
            return null;
        }

        return v.ValueKind switch
        {
            JsonValueKind.String when DateTimeOffset.TryParse(
                v.GetString(),
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out var dto) => dto,
            JsonValueKind.Number when v.TryGetInt64(out var epoch) => DateTimeOffset.FromUnixTimeSeconds(epoch),
            _ => null,
        };
    }

    private static string? GetString(JsonElement obj, string name) =>
        obj.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}

/// <summary>
/// The semantic colour family an FSM state resolves to — the native union of the web
/// <c>BadgeVariant = 'success' | 'warning' | 'danger' | 'info' | 'neutral'</c>
/// (<c>web/src/types/fsm/types.ts</c>) that <c>VARIANT_THEME</c> turns into the tick colour. Carried so the
/// resolved <see cref="StateColor"/> stays self-describing for tests and Narrator copy.
/// </summary>
public enum StateColorVariant
{
    /// <summary>Web <c>success</c> (green family).</summary>
    Success,

    /// <summary>Web <c>warning</c> (amber family).</summary>
    Warning,

    /// <summary>Web <c>danger</c> (red family).</summary>
    Danger,

    /// <summary>Web <c>info</c> (cyan/blue family).</summary>
    Info,

    /// <summary>Web <c>neutral</c> (grey family) — also the unknown-state default.</summary>
    Neutral,
}

/// <summary>
/// The fully resolved tick style for one destination state — the native, theme-aware analogue of the
/// <c>StateStyle.dot</c> Tailwind class the web <c>getStateColor(fsmType, state).dot</c> returns
/// (<c>web/src/types/fsm/registry.ts</c>). Holds the semantic <see cref="Variant"/> and the design-token brush
/// key (<see cref="DotColorKey"/>) the view resolves through <c>DisplayTokens.Brush</c> so light / dark /
/// high-contrast all flow from the W1 token pipeline instead of a hard-coded hex. Pure data.
/// </summary>
/// <param name="Variant">The semantic colour family the state maps to.</param>
/// <param name="DotColorKey">The design-token brush key for the tick dot (web <c>StateStyle.dot</c>).</param>
public readonly record struct StateColor(StateColorVariant Variant, string DotColorKey);

/// <summary>
/// Resolves an FSM <c>(fsmType, state)</c> pair to its tick colour — the native port of the web
/// <c>getStateColor</c> (<c>web/src/types/fsm/registry.ts</c>) for the FSM domains this surface actually
/// receives. The web <c>StateMachineDebuggerPage</c> only ever hands <c>StateTimeline</c> a
/// <c>fsmType</c> of <c>vehicle</c> or <c>telemetry_connection</c> (it collapses the <c>all</c> filter to
/// <c>vehicle</c>; see <c>FSM_TYPE_OPTIONS</c>), so those two registry tables are ported here verbatim —
/// including the per-state <c>overrides.dot</c> the vehicle FSM applies (charging→cyan, parked→purple,
/// offline→grey, …). The web fallbacks are preserved: an unrecognised <c>fsmType</c> resolves against the
/// vehicle table (web <c>FSM_REGISTRY[fsmType] ?? FSM_REGISTRY.vehicle</c>) and an unrecognised state yields
/// the neutral default (web <c>DEFAULT_STATE</c>). State lookup is case-insensitive (web
/// <c>state.toLowerCase()</c>). UI-free so the whole table is unit-tested without a XAML runtime.
/// </summary>
public static class StateColorResolver
{
    /// <summary>The <c>telemetry_connection</c> FSM domain key (the only non-vehicle table ported).</summary>
    public const string TelemetryConnectionFsm = "telemetry_connection";

    /// <summary>Token brush key for the neutral / grey family (web <c>bg-gray-400</c>; the unknown default).</summary>
    public const string NeutralDotKey = "TsColorTextMutedBrush";

    /// <summary>Token brush key for the success / green family (web <c>bg-green-400</c>).</summary>
    public const string SuccessDotKey = "TsColorSuccessBrush";

    /// <summary>Token brush key for the warning / amber family (web <c>bg-amber-400</c>).</summary>
    public const string WarningDotKey = "TsColorWarningBrush";

    /// <summary>Token brush key for the danger / red family (web <c>bg-red-400</c>).</summary>
    public const string DangerDotKey = "TsColorDangerBrush";

    /// <summary>Token brush key for the info / cyan family (web <c>bg-blue-400</c> / overridden <c>bg-cyan-400</c>).</summary>
    public const string InfoDotKey = "TsColorInfoBrush";

    /// <summary>Token brush key for the violet family (web vehicle overrides <c>bg-purple-400</c> / <c>bg-indigo-400</c>).</summary>
    public const string VioletDotKey = "TsChart07Brush";

    /// <summary>The neutral default returned for unknown states (web <c>DEFAULT_STATE</c>).</summary>
    public static StateColor Default { get; } = new(StateColorVariant.Neutral, NeutralDotKey);

    /// <summary>Resolve the tick colour for <paramref name="state"/> under <paramref name="fsmType"/> (case-insensitive).</summary>
    /// <param name="fsmType">The FSM domain (web <c>fsmType</c>); unknown domains fall back to the vehicle table.</param>
    /// <param name="state">The destination state (web <c>to_state</c>); unknown states fall back to neutral.</param>
    public static StateColor Resolve(string? fsmType, string? state)
    {
        string fsm = (fsmType ?? string.Empty).Trim().ToLowerInvariant();
        string s = (state ?? string.Empty).Trim().ToLowerInvariant();
        return fsm == TelemetryConnectionFsm ? ResolveTelemetry(s) : ResolveVehicle(s);
    }

    // Web VEHICLE_STATE_ENTRIES resolved through VARIANT_THEME + per-state overrides.dot
    // (web/src/types/fsm/vehicle.ts). Only the dot colour is reproduced — the tick is the only consumer.
    private static StateColor ResolveVehicle(string state) => state switch
    {
        "online" => new(StateColorVariant.Success, SuccessDotKey),     // success, dot bg-green-400
        "driving" => new(StateColorVariant.Success, SuccessDotKey),    // success, override dot bg-green-400
        "charging" => new(StateColorVariant.Warning, InfoDotKey),      // warning, override dot bg-cyan-400
        "parked" => new(StateColorVariant.Info, VioletDotKey),         // info, override dot bg-purple-400
        "updating" => new(StateColorVariant.Info, VioletDotKey),       // info, override dot bg-indigo-400
        "asleep" => new(StateColorVariant.Neutral, NeutralDotKey),     // neutral, dot bg-gray-400
        "offline" => new(StateColorVariant.Danger, NeutralDotKey),     // danger, override dot bg-gray-500
        _ => Default,
    };

    // Web TELEMETRY_CONNECTION_STATE_ENTRIES — no per-state overrides, so each state takes its variant's
    // default dot colour (web/src/types/fsm/telemetry-connection.ts + VARIANT_THEME).
    private static StateColor ResolveTelemetry(string state) => state switch
    {
        "unknown" => new(StateColorVariant.Neutral, NeutralDotKey),
        "connecting" => new(StateColorVariant.Warning, WarningDotKey),
        "streaming" => new(StateColorVariant.Success, SuccessDotKey),
        "stale" => new(StateColorVariant.Warning, WarningDotKey),
        "disconnected" => new(StateColorVariant.Danger, DangerDotKey),
        "polling_only" => new(StateColorVariant.Info, InfoDotKey),
        _ => Default,
    };
}

/// <summary>
/// The mutually-exclusive render branch the <c>StateTimeline</c> surface shows — the native union of the two
/// <c>return</c> branches in the web component
/// (<c>web/src/features/system/components/state-machine/StateTimeline.tsx</c>). The web source is a pure
/// presentational component: it takes pre-windowed <c>transitions</c> plus display props and performs no
/// fetching, so — exactly like the sibling <c>DriveTimeline</c> port — the parent
/// <c>StateMachineDebuggerPage</c> owns the query lifecycle (the page renders the page-level skeleton /
/// <c>QueryError</c> / stale / offline chrome once before mounting this strip with an already-resolved buffer).
/// There is therefore no fetch-driven loading / error / stale / offline branch to reproduce <em>inside</em>
/// this surface; the only branches are the populated <see cref="Timeline"/> and the actionable
/// <see cref="Empty"/> stand-in. Both map onto a visible surface; neither is ever hidden.
/// </summary>
public enum StateTimelineState
{
    /// <summary>At least one tick is in the window (web <c>ticks.length &gt; 0</c>) — the dot track.</summary>
    Timeline,

    /// <summary>No ticks in the window (web <c>ticks.length === 0</c>) — the message + actionable hint.</summary>
    Empty,
}

/// <summary>
/// One projected, render-ready tick on the timeline — the native analogue of a web <c>ticks[]</c> entry plus
/// the per-tick JSX the component returns. Holds the transition <see cref="Id"/> (selection identity and
/// automation id suffix), the <see cref="LeftPercent"/> horizontal position (web
/// <c>((ts - startTs) / span) * 100</c>), the resolved dot token key, the <see cref="IsSelected"/> highlight
/// flag (web <c>selectedId === tr.id</c>), the tooltip text (web
/// <c>`${from} → ${to} · ${formatTime(ts)}`</c>) and the localized Narrator label (web
/// <c>t('debugger.timeline.tickAria', …)</c>). Pure data.
/// </summary>
/// <param name="Id">The transition identity (web <c>tr.id</c>).</param>
/// <param name="LeftPercent">Horizontal position as a 0–100 percentage of the window span (web <c>leftPct</c>).</param>
/// <param name="DotColorKey">The design-token brush key for the dot (web <c>getStateColor(...).dot</c>).</param>
/// <param name="IsSelected">Whether this tick is the inspector selection (web <c>isSelected</c>).</param>
/// <param name="TooltipText">The hover tooltip (web Tooltip <c>content</c>).</param>
/// <param name="AutomationName">The localized Narrator label (web <c>aria-label</c>).</param>
public sealed record StateTimelineTick(
    long Id,
    double LeftPercent,
    string DotColorKey,
    bool IsSelected,
    string TooltipText,
    string AutomationName);

/// <summary>
/// The render-time data model the <c>StateTimeline</c> view binds to — the native analogue of the web
/// <c>StateTimelineProps</c> (<c>web/src/features/system/components/state-machine/StateTimeline.tsx</c>). The
/// component is presentational, so this model carries only the inputs the web props supply. The two web
/// callback props (<c>onWidenWindow</c> / <c>onJumpToLast</c>) become the <see cref="CanWidenWindow"/> /
/// <see cref="CanJumpToLast"/> capability flags here — the projection needs only their presence to decide
/// whether to surface the buttons (web <c>onWidenWindow != null</c> / <c>onJumpToLast != null</c>); the view
/// raises the corresponding events. Pure data — no WinUI types.
/// </summary>
/// <param name="Transitions">The pre-windowed transitions to render (web <c>transitions</c>). Order is irrelevant — the projection sorts.</param>
/// <param name="FsmType">The FSM domain for colour resolution (web <c>fsmType</c>).</param>
/// <param name="SelectedId">The selected transition id, if any (web <c>selectedId</c>).</param>
/// <param name="WindowMinutes">The window length in minutes for the axis labels (web <c>windowMinutes</c>, default 10).</param>
/// <param name="Anchor">An optional fixed end-time anchor; null tracks "now" live (web <c>anchor</c>).</param>
/// <param name="LastTransition">The most recent transition in or outside the window, for the empty hint (web <c>lastTransition</c>).</param>
/// <param name="WiderPreset">The smallest preset (minutes) that would include <see cref="LastTransition"/> (web <c>widerPreset</c>).</param>
/// <param name="CanWidenWindow">Whether a widen handler is wired (web <c>onWidenWindow != null</c>).</param>
/// <param name="CanJumpToLast">Whether a jump handler is wired (web <c>onJumpToLast != null</c>).</param>
public sealed record StateTimelineModel(
    IReadOnlyList<StateTransition> Transitions,
    string FsmType,
    long? SelectedId = null,
    int WindowMinutes = StateTimelineProjection.DefaultWindowMinutes,
    DateTimeOffset? Anchor = null,
    StateTransition? LastTransition = null,
    int? WiderPreset = null,
    bool CanWidenWindow = false,
    bool CanJumpToLast = false)
{
    /// <summary>The initial empty model — no transitions, vehicle FSM, default window.</summary>
    public static StateTimelineModel Empty { get; } = new(Array.Empty<StateTransition>(), "vehicle");
}

/// <summary>
/// The fully projected, render-ready view of the timeline — the native analogue of everything the web
/// component computes before returning JSX. In the <see cref="StateTimelineState.Timeline"/> branch it holds
/// the sorted <see cref="Ticks"/>, the formatted window-start / window-end axis labels and the localized
/// window label; in the <see cref="StateTimelineState.Empty"/> branch it holds the localized "No transitions"
/// copy, the <see cref="HasHint"/> flag and "Last transition {rel}" hint, and the gated Widen / Jump button
/// copy + visibility (web <c>showWiden</c> / <c>showJump</c>). Both branches carry a composed Narrator name.
/// Pure data so the whole contract is unit-tested without a UI host.
/// </summary>
/// <param name="State">The resolved render branch.</param>
/// <param name="Ticks">The sorted, positioned ticks (timeline branch).</param>
/// <param name="StartText">The formatted window-start time (timeline branch).</param>
/// <param name="EndText">The formatted window-end time (timeline branch).</param>
/// <param name="WindowLabel">The localized "Window: {minutes} min" axis label (timeline branch).</param>
/// <param name="EmptyMessage">The localized "No transitions in window" copy (empty branch).</param>
/// <param name="HasHint">Whether a last-transition hint exists (web <c>Boolean(lastTransition)</c>).</param>
/// <param name="LastSeenText">The localized "Last transition {rel}" hint (empty branch, when <see cref="HasHint"/>).</param>
/// <param name="ShowWiden">Whether to surface the Widen button (web <c>widerPreset != null &amp;&amp; onWidenWindow != null</c>).</param>
/// <param name="WidenText">The localized "Widen window to {label}" button copy (empty branch, when <see cref="ShowWiden"/>).</param>
/// <param name="ShowJump">Whether to surface the Jump button (web <c>lastTransition != null &amp;&amp; onJumpToLast != null</c>).</param>
/// <param name="JumpText">The localized "Jump to last transition" button copy (empty branch, when <see cref="ShowJump"/>).</param>
/// <param name="AutomationName">The composed Narrator name for the surface.</param>
public sealed record StateTimelineDisplay(
    StateTimelineState State,
    IReadOnlyList<StateTimelineTick> Ticks,
    string StartText,
    string EndText,
    string WindowLabel,
    string EmptyMessage,
    bool HasHint,
    string LastSeenText,
    bool ShowWiden,
    string WidenText,
    bool ShowJump,
    string JumpText,
    string AutomationName);

/// <summary>
/// Pure projection from the input <see cref="StateTimelineModel"/> to the render-ready
/// <see cref="StateTimelineDisplay"/> — the native port of the windowing math, branch selection, colour
/// resolution, time / relative formatting and copy resolution in
/// <c>web/src/features/system/components/state-machine/StateTimeline.tsx</c>. Times render through the shared
/// <see cref="DateTimeFormatting"/> "Time" variant (the web <c>useDateFormat().formatTime</c> seam) and the
/// empty-state hint reproduces the web <c>formatRelative</c> tiers (just-now / m / h / d ago / absolute date,
/// see <c>web/src/lib/dateFormat.ts</c>). <c>now</c> is injected so the live "anchor" default and the relative
/// hint are unit-tested deterministically. UI-free so the whole contract is verified without a XAML runtime.
/// </summary>
public static class StateTimelineProjection
{
    /// <summary>The default window length in minutes (web <c>windowMinutes = 10</c>).</summary>
    public const int DefaultWindowMinutes = 10;

    /// <summary>i18n key for the sub-hour window preset label (web <c>t('debugger.window.minutes', …)</c>).</summary>
    public const string WindowMinutesKey = "debugger.window.minutes";

    /// <summary>English fallback for <see cref="WindowMinutesKey"/> (matches the web default).</summary>
    public const string WindowMinutesFallback = "{{n}} min";

    /// <summary>i18n key for the sub-day window preset label (web <c>t('debugger.window.hours', …)</c>).</summary>
    public const string WindowHoursKey = "debugger.window.hours";

    /// <summary>English fallback for <see cref="WindowHoursKey"/> (matches the web default).</summary>
    public const string WindowHoursFallback = "{{n}} h";

    /// <summary>i18n key for the day window preset label (web <c>t('debugger.window.day', '24 h')</c>).</summary>
    public const string WindowDayKey = "debugger.window.day";

    /// <summary>English fallback for <see cref="WindowDayKey"/> (matches the web default).</summary>
    public const string WindowDayFallback = "24 h";

    /// <summary>i18n key for the empty-window copy (web <c>t('debugger.timeline.empty', …)</c>).</summary>
    public const string EmptyKey = "debugger.timeline.empty";

    /// <summary>English fallback for <see cref="EmptyKey"/> (matches the web default).</summary>
    public const string EmptyFallback = "No transitions in window";

    /// <summary>i18n key for the last-transition hint (web <c>t('debugger.timeline.lastSeen', …)</c>).</summary>
    public const string LastSeenKey = "debugger.timeline.lastSeen";

    /// <summary>English fallback for <see cref="LastSeenKey"/> (matches the web default).</summary>
    public const string LastSeenFallback = "Last transition {{rel}}";

    /// <summary>i18n key for the widen-window button (web <c>t('debugger.timeline.widenTo', …)</c>).</summary>
    public const string WidenToKey = "debugger.timeline.widenTo";

    /// <summary>English fallback for <see cref="WidenToKey"/> (matches the web default).</summary>
    public const string WidenToFallback = "Widen window to {{label}}";

    /// <summary>i18n key for the jump-to-last button (web <c>t('debugger.timeline.jumpToLast', …)</c>).</summary>
    public const string JumpToLastKey = "debugger.timeline.jumpToLast";

    /// <summary>English fallback for <see cref="JumpToLastKey"/> (matches the web default).</summary>
    public const string JumpToLastFallback = "Jump to last transition";

    /// <summary>i18n key for the window axis label (web <c>t('debugger.timeline.windowLabel', …)</c>).</summary>
    public const string WindowLabelKey = "debugger.timeline.windowLabel";

    /// <summary>English fallback for <see cref="WindowLabelKey"/> (matches the web default).</summary>
    public const string WindowLabelFallback = "Window: {{minutes}} min";

    /// <summary>i18n key for the per-tick Narrator label (web <c>t('debugger.timeline.tickAria', …)</c>).</summary>
    public const string TickAriaKey = "debugger.timeline.tickAria";

    /// <summary>English fallback for <see cref="TickAriaKey"/> (matches the web default).</summary>
    public const string TickAriaFallback = "{{from}} to {{to}}";

    private const string RelativeJustNow = "just now";
    private const string RouteArrow = "\u2192";
    private const string MiddleDot = "\u00B7";
    private const int MinutesPerHour = 60;
    private const int MinutesPerDay = 1440;

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade and clock.</summary>
    /// <param name="model">The render-time data model (the web props).</param>
    /// <param name="localizer">The i18n facade every label resolves through (the <c>useTranslation</c> seam).</param>
    /// <param name="now">The current instant (the web <c>new Date()</c> / <c>Date.now()</c> seam); injected for tests.</param>
    public static StateTimelineDisplay Project(StateTimelineModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        DateTimeOffset end = model.Anchor ?? now;
        DateTimeOffset start = end.AddMinutes(-model.WindowMinutes);
        double span = (end - start).TotalMilliseconds;
        if (span == 0)
        {
            span = 1; // web: `span = endTs - startTs || 1`
        }

        // Web parity: [...transitions].sort((a, b) => new Date(a.ts) - new Date(b.ts)).
        var sorted = model.Transitions.OrderBy(static t => t.Ts).ToList();

        if (sorted.Count == 0)
        {
            return ProjectEmpty(model, localizer, now);
        }

        var ticks = new List<StateTimelineTick>(sorted.Count);
        foreach (var tr in sorted)
        {
            double leftPercent = (tr.Ts - start).TotalMilliseconds / span * 100.0;
            var color = StateColorResolver.Resolve(model.FsmType, tr.ToState);
            bool isSelected = model.SelectedId is { } id && tr.Id == id;
            string time = DateTimeFormatting.Format(tr.Ts, DateTimeVariant.Time, now);
            string tooltip = string.Concat(tr.FromState, " ", RouteArrow, " ", tr.ToState, " ", MiddleDot, " ", time);
            string aria = Interpolate(
                Interpolate(localizer.GetString(TickAriaKey, TickAriaFallback), "from", tr.FromState),
                "to",
                tr.ToState);
            ticks.Add(new StateTimelineTick(tr.Id, leftPercent, color.DotColorKey, isSelected, tooltip, aria));
        }

        string startText = DateTimeFormatting.Format(start, DateTimeVariant.Time, now);
        string endText = DateTimeFormatting.Format(end, DateTimeVariant.Time, now);
        string windowLabel = Interpolate(
            localizer.GetString(WindowLabelKey, WindowLabelFallback),
            "minutes",
            model.WindowMinutes.ToString(CultureInfo.CurrentCulture));

        string automationName = string.Concat(windowLabel, ", ", startText, " ", RouteArrow, " ", endText);

        return new StateTimelineDisplay(
            StateTimelineState.Timeline,
            ticks,
            startText,
            endText,
            windowLabel,
            EmptyMessage: string.Empty,
            HasHint: false,
            LastSeenText: string.Empty,
            ShowWiden: false,
            WidenText: string.Empty,
            ShowJump: false,
            JumpText: string.Empty,
            automationName);
    }

    private static StateTimelineDisplay ProjectEmpty(StateTimelineModel model, ILocalizer localizer, DateTimeOffset now)
    {
        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);

        bool hasHint = model.LastTransition is not null;
        bool showWiden = model.WiderPreset is not null && model.CanWidenWindow;
        bool showJump = model.LastTransition is not null && model.CanJumpToLast;

        string lastSeenText = string.Empty;
        if (hasHint)
        {
            string rel = FormatRelative(model.LastTransition!.Ts, now);
            lastSeenText = Interpolate(localizer.GetString(LastSeenKey, LastSeenFallback), "rel", rel);
        }

        string widenText = string.Empty;
        if (showWiden)
        {
            string label = PresetLabel(model.WiderPreset!.Value, localizer);
            widenText = Interpolate(localizer.GetString(WidenToKey, WidenToFallback), "label", label);
        }

        string jumpText = showJump ? localizer.GetString(JumpToLastKey, JumpToLastFallback) : string.Empty;

        string automationName = hasHint
            ? string.Concat(emptyMessage, " ", MiddleDot, " ", lastSeenText)
            : emptyMessage;

        return new StateTimelineDisplay(
            StateTimelineState.Empty,
            Array.Empty<StateTimelineTick>(),
            StartText: string.Empty,
            EndText: string.Empty,
            WindowLabel: string.Empty,
            emptyMessage,
            hasHint,
            lastSeenText,
            showWiden,
            widenText,
            showJump,
            jumpText,
            automationName);
    }

    /// <summary>
    /// Format a window preset (in minutes) exactly as the web <c>presetLabel</c> does: under an hour →
    /// "{n} min", under a day → "{round(n/60)} h" (JavaScript <c>Math.round</c>, round-half-up), otherwise the
    /// fixed "24 h" copy.
    /// </summary>
    public static string PresetLabel(int minutes, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        if (minutes < MinutesPerHour)
        {
            return Interpolate(
                localizer.GetString(WindowMinutesKey, WindowMinutesFallback),
                "n",
                minutes.ToString(CultureInfo.CurrentCulture));
        }

        if (minutes < MinutesPerDay)
        {
            long hours = (long)Math.Floor(minutes / (double)MinutesPerHour + 0.5);
            return Interpolate(
                localizer.GetString(WindowHoursKey, WindowHoursFallback),
                "n",
                hours.ToString(CultureInfo.CurrentCulture));
        }

        return localizer.GetString(WindowDayKey, WindowDayFallback);
    }

    /// <summary>
    /// Reproduce the web <c>formatRelative</c> tiers (<c>web/src/lib/dateFormat.ts</c>): under a minute →
    /// "just now", under an hour → "{m}m ago", under a day → "{h}h ago", under a week → "{d}d ago", otherwise
    /// the absolute "MMM d, yyyy" date (the web <c>formatDate</c> fallback). <c>now</c> is injected for
    /// deterministic tests.
    /// </summary>
    public static string FormatRelative(DateTimeOffset value, DateTimeOffset now)
    {
        long seconds = (long)Math.Floor((now - value).TotalSeconds);
        if (seconds < 60)
        {
            return RelativeJustNow;
        }

        long minutes = seconds / 60;
        if (minutes < 60)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{minutes}m ago");
        }

        long hours = minutes / 60;
        if (hours < 24)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{hours}h ago");
        }

        long days = hours / 24;
        if (days < 7)
        {
            return string.Create(CultureInfo.InvariantCulture, $"{days}d ago");
        }

        return DateTimeFormatting.Format(value, DateTimeVariant.Date, now);
    }

    private static string Interpolate(string template, string token, string value) =>
        template.Replace("{{" + token + "}}", value, StringComparison.Ordinal);
}

/// <summary>
/// Canonical diagnostics metadata for the State Timeline surface — the stable slug emitted with the
/// <c>view.opened</c> event (P1/S11 diagnostics contract). UI-free so the metadata is asserted in tests.
/// </summary>
public static class StateTimelineRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "StateTimeline";
}

/// <summary>
/// PII-safe diagnostics for the State Timeline surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, state name or timestamp —
/// so a diagnostics line can never leak fleet data. Thread-safe.
/// </summary>
public sealed class StateTimelineDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public StateTimelineDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=StateTimeline</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={StateTimelineRegistration.Slug}");
    }
}
