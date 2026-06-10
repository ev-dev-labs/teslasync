using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews.Fsm;

/// <summary>
/// The mutually-exclusive render branch of the <c>FSMHealthPanel</c> surface — the native union of the branches
/// the web component renders (web/src/features/system/components/FSMHealthPanel.tsx). The web source is a pure
/// presentational component: it takes the resolved <c>transitions</c> array as a prop and derives the health
/// alerts in a <c>useMemo</c>, performing no fetching, so the branch is a direct function of the input
/// <see cref="FsmHealthPanelModel"/> and there is no fetch-driven loading / error / stale / offline branch to
/// reproduce (the parent owns the query and re-renders this component with already-resolved data, exactly as
/// react does). Every branch maps onto a visible surface — none is ever hidden.
/// </summary>
public enum FsmHealthPanelState
{
    /// <summary>
    /// No health alerts were derived (web <c>alerts.length === 0</c>): the friendly "all healthy" status row,
    /// never a blank box.
    /// </summary>
    AllClear,

    /// <summary>
    /// One or more health alerts were derived (web <c>alerts.length &gt; 0</c>): the titled panel with the
    /// flap / stuck / recovery alert cards.
    /// </summary>
    Alerts,
}

/// <summary>
/// The kind of health alert derived from the FSM transition feed — the native mirror of the web
/// <c>HealthAlert.type</c> union (<c>'flap' | 'stuck' | 'recovery'</c>) in FSMHealthPanel.tsx.
/// </summary>
public enum FsmHealthAlertKind
{
    /// <summary>A single FSM transitioned more than five times within a one-minute window (web <c>'flap'</c>).</summary>
    Flap,

    /// <summary>A drive/charge session sat in pending/active for more than four hours (web <c>'stuck'</c>).</summary>
    Stuck,

    /// <summary>One or more sessions transitioned to the <c>recovered</c> state after a pod restart (web <c>'recovery'</c>).</summary>
    Recovery,
}

/// <summary>
/// One FSM transition the panel derives its alerts from — the native mirror of the fields the web
/// <c>FSMHealthPanel</c> reads off an <c>FSMTransition</c> (web/src/types/fsm/ui-types.ts). Only the fields the
/// alert logic actually consumes are modelled: <see cref="Id"/> (the flapped-id set key), <see cref="VehicleId"/>
/// (the stuck-instance grouping key), <see cref="Ts"/> (the ISO-8601 transition timestamp the flap window and the
/// stuck age are measured against), <see cref="FsmName"/> (the per-FSM grouping key) and <see cref="ToState"/>
/// (the stuck / recovery state test). Pure data — no WinUI types — so the projection is unit-tested without a UI
/// host.
/// </summary>
/// <param name="Id">Stable transition id (web <c>tr.id</c>) — the flapped-id set element.</param>
/// <param name="VehicleId">Owning vehicle id (web <c>tr.vehicle_id</c>) — part of the stuck-instance key.</param>
/// <param name="Ts">Raw ISO-8601 transition timestamp (web <c>tr.ts</c>); parsed to epoch milliseconds for the windows.</param>
/// <param name="FsmName">FSM name (web <c>tr.fsm_name</c>) — the flap grouping key and the session-type test.</param>
/// <param name="ToState">Destination state (web <c>tr.to_state</c>) — drives the stuck and recovery counts.</param>
public sealed record FsmHealthTransition(
    long Id,
    long VehicleId,
    string Ts,
    string FsmName,
    string ToState);

/// <summary>
/// The render-time data model the <c>FSMHealthPanel</c> view binds to — the native analogue of the web
/// <c>FSMHealthPanelProps</c> (<c>{ transitions }</c> in FSMHealthPanel.tsx). The component is presentational, so
/// this model carries only the resolved <see cref="Transitions"/> the parent supplies. Pure data — no WinUI types
/// — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Transitions">The resolved FSM transition feed (web <c>transitions</c>).</param>
public sealed record FsmHealthPanelModel(IReadOnlyList<FsmHealthTransition> Transitions)
{
    /// <summary>The initial model — an empty, resolved transition feed (renders the "all healthy" state).</summary>
    public static FsmHealthPanelModel Empty { get; } = new(Array.Empty<FsmHealthTransition>());
}

/// <summary>
/// A single projected, display-ready health alert — the native analogue of one entry in the web
/// <c>alerts</c> array. Holds the derived <see cref="Kind"/>, the semantic <see cref="Severity"/> (the web
/// <c>'warning' | 'info'</c> mapped onto <see cref="StatusKind"/>), the localized <see cref="Title"/> and
/// interpolated <see cref="Message"/>, the formatted <see cref="CountText"/> (web <c>fmtInt(alert.count)</c>),
/// the Segoe Fluent <see cref="IconGlyph"/>, the token resource keys the view tints from
/// (<see cref="AccentBrushKey"/> / <see cref="AccentColorKey"/>) and a Narrator name. Pure data so every alert is
/// asserted headlessly.
/// </summary>
public sealed record FsmHealthAlertView(
    FsmHealthAlertKind Kind,
    StatusKind Severity,
    string Title,
    string Message,
    string CountText,
    string IconGlyph,
    string AccentBrushKey,
    string AccentColorKey,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel for one input model — the native analogue of the branch the
/// web <c>FSMHealthPanel</c> returns. Holds the active <see cref="State"/>, the localized panel <see cref="Title"/>,
/// the "all healthy" copy, the ordered <see cref="Alerts"/> and the surface's accessible name. Pure data so every
/// branch is asserted headlessly.
/// </summary>
public sealed record FsmHealthPanelDisplay(
    FsmHealthPanelState State,
    string Title,
    string AllClearText,
    IReadOnlyList<FsmHealthAlertView> Alerts,
    string AutomationName);

/// <summary>
/// Pure projection from an <see cref="FsmHealthPanelModel"/> to its <see cref="FsmHealthPanelDisplay"/> — the
/// native port of the alert-deriving <c>useMemo</c> in web/src/features/system/components/FSMHealthPanel.tsx. The
/// three detectors run in the web's exact order so the resulting alert list matches it card-for-card:
/// <list type="number">
/// <item>flap — group the transitions by <c>fsm_name</c>; within each group, any window of more than five
/// transitions inside one minute marks every transition in that window as flapped. A single flap alert is emitted
/// the first time the flapped set becomes non-empty, carrying that set's size at that moment (the web pushes the
/// alert inside the per-FSM loop, so its count is captured at the first flapping group — <see cref="ComputeFlapIds"/>
/// returns the complete set the web exports for the parent);</item>
/// <item>stuck — keep the latest transition per <c>fsm_name:vehicle_id</c> for the drive/charge session FSMs, and
/// count those whose latest state is pending/active and older than four hours;</item>
/// <item>recovery — count every transition whose destination state is <c>recovered</c>.</item>
/// </list>
/// Each alert's count renders through <see cref="NumberFormatting"/> (the web <c>fmtInt</c>) and every label
/// resolves through the i18n facade using the catalog keys the web source feeds into <c>t()</c>. The reference
/// instant is injected for deterministic stuck-age tests. No WinUI types — unit-tested without a UI host.
/// </summary>
public static class FsmHealthPanelProjection
{
    /// <summary>FSM name of the drive-session sub-FSM (web <c>'drive_session'</c>).</summary>
    public const string DriveSessionFsm = "drive_session";

    /// <summary>FSM name of the charge-session sub-FSM (web <c>'charge_session'</c>).</summary>
    public const string ChargeSessionFsm = "charge_session";

    /// <summary>Destination state that marks a stuck-eligible pending session (web <c>'pending'</c>).</summary>
    public const string PendingState = "pending";

    /// <summary>Destination state that marks a stuck-eligible active session (web <c>'active'</c>).</summary>
    public const string ActiveState = "active";

    /// <summary>Destination state that marks a pod-restart recovery (web <c>'recovered'</c>).</summary>
    public const string RecoveredState = "recovered";

    /// <summary>The flap detection window, in milliseconds (web <c>60_000</c>).</summary>
    public const double FlapWindowMs = 60_000d;

    /// <summary>The minimum same-FSM transition count, within one window, that flags flapping (web <c>count &gt; 5</c>).</summary>
    public const int FlapThreshold = 5;

    /// <summary>The stuck-session age threshold, in milliseconds (web <c>4 * 60 * 60 * 1000</c>).</summary>
    public const double StuckAgeMs = 4d * 60d * 60d * 1000d;

    // i18n catalog keys (P1/S10 — Strings/{lang}/Resources.resw; the generated catalog stores the web's
    // {{count}} interpolation as the .NET {0} token, so the fallbacks below match the catalog values verbatim).
    private const string TitleKey = "translation.fsm.health.title";
    private const string AllClearKey = "translation.fsm.health.allClear";
    private const string FlapTitleKey = "translation.fsm.health.flapTitle";
    private const string StuckTitleKey = "translation.fsm.health.stuckTitle";
    private const string RecoveryTitleKey = "translation.fsm.health.recoveryTitle";
    private const string FlappingKey = "translation.fsm.health.flapping";
    private const string StuckKey = "translation.fsm.health.stuck";
    private const string RecoveriesKey = "translation.fsm.health.recoveries";

    private const string TitleFallback = "FSM Health";
    private const string AllClearFallback =
        "All FSMs healthy \u2014 no flapping, stuck sessions, or recoveries detected";
    private const string FlapTitleFallback = "State Flapping";
    private const string StuckTitleFallback = "Stuck Sessions";
    private const string RecoveryTitleFallback = "Pod Recoveries";
    private const string FlappingFallback =
        "{0} transitions flagged as state flapping (>5 same-FSM transitions/min)";
    private const string StuckFallback = "{0} session(s) stuck in pending/active for >4 hours";
    private const string RecoveriesFallback = "{0} session(s) recovered after pod restart";

    private const string CountToken = "{0}";

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The render-time data model (the web <c>transitions</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant the stuck-session age is measured against (web <c>Date.now()</c>).</param>
    public static FsmHealthPanelDisplay Project(FsmHealthPanelModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        List<FsmHealthAlertView> alerts = ComputeAlerts(model.Transitions, localizer, now);
        FsmHealthPanelState state = alerts.Count == 0 ? FsmHealthPanelState.AllClear : FsmHealthPanelState.Alerts;

        string title = localizer.GetString(TitleKey, TitleFallback);
        string allClear = localizer.GetString(AllClearKey, AllClearFallback);

        return new FsmHealthPanelDisplay(
            State: state,
            Title: title,
            AllClearText: allClear,
            Alerts: alerts,
            AutomationName: BuildAutomationName(state, title, allClear, alerts));
    }

    /// <summary>
    /// Derive the complete set of flapped transition ids across every FSM — the native port of the web's exported
    /// <c>computeFlapIds</c> helper ("Re-export flapIds for use by parent"). Unlike the flap alert's count (captured
    /// at the first flapping FSM), this returns the union over all FSMs.
    /// </summary>
    /// <param name="transitions">The resolved FSM transition feed (web <c>transitions</c>).</param>
    public static IReadOnlySet<long> ComputeFlapIds(IReadOnlyList<FsmHealthTransition> transitions)
    {
        ArgumentNullException.ThrowIfNull(transitions);

        var flapped = new HashSet<long>();
        foreach (List<FsmHealthTransition> group in GroupByFsm(transitions))
        {
            AccumulateFlapped(SortByTimestamp(group), flapped);
        }

        return flapped;
    }

    private static List<FsmHealthAlertView> ComputeAlerts(
        IReadOnlyList<FsmHealthTransition> transitions,
        ILocalizer localizer,
        DateTimeOffset now)
    {
        var result = new List<FsmHealthAlertView>(3);

        // ── Flap: >5 transitions of the same FSM within any 1-minute window ──────────────────────────
        var flapped = new HashSet<long>();
        foreach (List<FsmHealthTransition> group in GroupByFsm(transitions))
        {
            AccumulateFlapped(SortByTimestamp(group), flapped);

            // web pushes the flap alert inside the per-FSM loop, once, the first time the flapped set is
            // non-empty — so its count is the set's size at that first flapping FSM.
            if (flapped.Count > 0 && !ContainsKind(result, FsmHealthAlertKind.Flap))
            {
                result.Add(BuildAlert(FsmHealthAlertKind.Flap, StatusKind.Warning, flapped.Count, localizer));
            }
        }

        // ── Stuck: session FSMs whose latest state is pending/active for >4 hours ────────────────────
        double nowMs = now.ToUnixTimeMilliseconds();
        var instanceLatest = new Dictionary<string, FsmHealthTransition>(StringComparer.Ordinal);
        foreach (FsmHealthTransition tr in transitions)
        {
            if (!IsSessionFsm(tr.FsmName))
            {
                continue;
            }

            string key = $"{tr.FsmName}:{tr.VehicleId.ToString(CultureInfo.InvariantCulture)}";
            if (!instanceLatest.TryGetValue(key, out FsmHealthTransition? existing) ||
                Milliseconds(tr.Ts) > Milliseconds(existing.Ts))
            {
                instanceLatest[key] = tr;
            }
        }

        int stuckCount = 0;
        foreach (FsmHealthTransition tr in instanceLatest.Values)
        {
            if (IsStuckState(tr.ToState) && (nowMs - Milliseconds(tr.Ts)) > StuckAgeMs)
            {
                stuckCount++;
            }
        }

        if (stuckCount > 0)
        {
            result.Add(BuildAlert(FsmHealthAlertKind.Stuck, StatusKind.Warning, stuckCount, localizer));
        }

        // ── Recovery: transitions into the "recovered" state ─────────────────────────────────────────
        int recoveryCount = 0;
        foreach (FsmHealthTransition tr in transitions)
        {
            if (string.Equals(tr.ToState, RecoveredState, StringComparison.Ordinal))
            {
                recoveryCount++;
            }
        }

        if (recoveryCount > 0)
        {
            result.Add(BuildAlert(FsmHealthAlertKind.Recovery, StatusKind.Info, recoveryCount, localizer));
        }

        return result;
    }

    // Group transitions by fsm_name, preserving first-seen order (a JS Map iterates in insertion order, which the
    // web flap loop — and the "first flapping FSM" count snapshot — depend on).
    private static IEnumerable<List<FsmHealthTransition>> GroupByFsm(IReadOnlyList<FsmHealthTransition> transitions)
    {
        var byType = new Dictionary<string, List<FsmHealthTransition>>(StringComparer.Ordinal);
        var order = new List<string>();
        foreach (FsmHealthTransition tr in transitions)
        {
            if (!byType.TryGetValue(tr.FsmName, out List<FsmHealthTransition>? list))
            {
                list = new List<FsmHealthTransition>();
                byType[tr.FsmName] = list;
                order.Add(tr.FsmName);
            }

            list.Add(tr);
        }

        foreach (string name in order)
        {
            yield return byType[name];
        }
    }

    private static List<FsmHealthTransition> SortByTimestamp(List<FsmHealthTransition> group) =>
        group.OrderBy(t => Milliseconds(t.Ts)).ToList();

    // For each start index, widen a 1-minute window; if it holds more than five transitions, every transition in
    // the window is flapped. Mirrors the web's nested-loop scan exactly (including the early break once a
    // transition falls outside the window of a sorted-ascending list).
    private static void AccumulateFlapped(List<FsmHealthTransition> sorted, HashSet<long> flapped)
    {
        for (int i = 0; i < sorted.Count; i++)
        {
            double windowEnd = Milliseconds(sorted[i].Ts) + FlapWindowMs;

            int count = 0;
            for (int j = i; j < sorted.Count; j++)
            {
                if (Milliseconds(sorted[j].Ts) <= windowEnd)
                {
                    count++;
                }
                else
                {
                    break;
                }
            }

            if (count > FlapThreshold)
            {
                for (int j = i; j < sorted.Count; j++)
                {
                    if (Milliseconds(sorted[j].Ts) <= windowEnd)
                    {
                        flapped.Add(sorted[j].Id);
                    }
                    else
                    {
                        break;
                    }
                }
            }
        }
    }

    private static FsmHealthAlertView BuildAlert(
        FsmHealthAlertKind kind,
        StatusKind severity,
        int count,
        ILocalizer localizer)
    {
        (string titleKey, string titleFallback, string messageKey, string messageFallback, string glyph) = kind switch
        {
            FsmHealthAlertKind.Flap =>
                (FlapTitleKey, FlapTitleFallback, FlappingKey, FlappingFallback, FsmHealthPanelRegistration.FlapGlyph),
            FsmHealthAlertKind.Stuck =>
                (StuckTitleKey, StuckTitleFallback, StuckKey, StuckFallback, FsmHealthPanelRegistration.StuckGlyph),
            _ =>
                (RecoveryTitleKey, RecoveryTitleFallback, RecoveriesKey, RecoveriesFallback, FsmHealthPanelRegistration.RecoveryGlyph),
        };

        string title = localizer.GetString(titleKey, titleFallback);
        string message = Interpolate(localizer.GetString(messageKey, messageFallback), count);
        string countText = FormatCount(count);

        return new FsmHealthAlertView(
            Kind: kind,
            Severity: severity,
            Title: title,
            Message: message,
            CountText: countText,
            IconGlyph: glyph,
            AccentBrushKey: StatusResources.AccentBrushKey(severity),
            AccentColorKey: StatusResources.AccentColorKey(severity),
            AutomationName: $"{title}. {message}");
    }

    private static string BuildAutomationName(
        FsmHealthPanelState state,
        string title,
        string allClear,
        List<FsmHealthAlertView> alerts)
    {
        if (state == FsmHealthPanelState.AllClear)
        {
            return allClear;
        }

        return $"{title}. {string.Join(". ", alerts.Select(a => a.AutomationName))}";
    }

    // web fmtInt(count) — locale-grouped integer; also used to fill the {0} message token (the catalog's port of
    // the web {{count}} interpolation).
    private static string FormatCount(int count) => NumberFormatting.Format(count, null, 0);

    private static string Interpolate(string template, int count) =>
        template.Replace(CountToken, FormatCount(count), StringComparison.Ordinal);

    private static bool IsSessionFsm(string fsmName) =>
        string.Equals(fsmName, DriveSessionFsm, StringComparison.Ordinal) ||
        string.Equals(fsmName, ChargeSessionFsm, StringComparison.Ordinal);

    private static bool IsStuckState(string state) =>
        string.Equals(state, PendingState, StringComparison.Ordinal) ||
        string.Equals(state, ActiveState, StringComparison.Ordinal);

    private static bool ContainsKind(List<FsmHealthAlertView> alerts, FsmHealthAlertKind kind)
    {
        foreach (FsmHealthAlertView alert in alerts)
        {
            if (alert.Kind == kind)
            {
                return true;
            }
        }

        return false;
    }

    // web new Date(ts).getTime(): epoch milliseconds, or NaN for a null / unparseable timestamp. Every comparison
    // against NaN is false, so an unparseable timestamp can never flap, never look stuck, and sorts to one end —
    // matching the web's behaviour without throwing.
    private static double Milliseconds(string ts)
    {
        if (!string.IsNullOrWhiteSpace(ts) && DateTimeOffset.TryParse(
                ts,
                CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal | DateTimeStyles.AdjustToUniversal,
                out DateTimeOffset value))
        {
            return value.ToUnixTimeMilliseconds();
        }

        return double.NaN;
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FSMHealthPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never a vehicle id, FSM name or transition — so a
/// diagnostics line can never leak which vehicle's state machine flapped or stuck. Thread-safe.
/// </summary>
public sealed class FsmHealthPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public FsmHealthPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FSMHealthPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FsmHealthPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>FSMHealthPanel</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/FSMHealthPanel.tsx</c>. The glyphs are the Segoe Fluent equivalents of the
/// web lucide icons (AlertTriangle / Timer / RotateCw).
/// </summary>
public static class FsmHealthPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FSMHealthPanel";

    /// <summary>Flap alert glyph — Segoe Fluent "Warning" (web <c>AlertTriangle</c>).</summary>
    public const string FlapGlyph = "\uE7BA";

    /// <summary>Stuck alert glyph — Segoe Fluent "Timer" (web <c>Timer</c>).</summary>
    public const string StuckGlyph = "\uE916";

    /// <summary>Recovery alert glyph — Segoe Fluent "Refresh" (web <c>RotateCw</c>).</summary>
    public const string RecoveryGlyph = "\uE72C";
}
