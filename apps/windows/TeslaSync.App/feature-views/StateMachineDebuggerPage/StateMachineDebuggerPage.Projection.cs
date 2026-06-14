using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Charts;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.FeatureViews.Fsm;
using TeslaSync.App.FeatureViews.StateMachine;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The complete, raw input the <c>StateMachineDebuggerPage</c> projects from — the native aggregate of the web
/// page's hook results and local UI state (the selected vehicle + FSM-type + range + page filters, the live/freeze
/// toggle and window, the selected transition and its snapshots, and the four data-source payloads). Pure data so
/// the whole projection is asserted headlessly without a WinUI host.
/// </summary>
public sealed record StateMachineDebuggerModel(
    IReadOnlyList<VehicleOptionRecord> Vehicles,
    long? SelectedVehicleId,
    string FsmType,
    RangePreset Range,
    int Page,
    int PerPage,
    CurrentStateInfo? CurrentState,
    IReadOnlyList<FsmTransitionRecord> Transitions,
    int TotalRows,
    IReadOnlyList<ActiveSubFSM> ActiveSubs,
    bool IsLive,
    int WindowMinutes,
    long? SelectedTransitionId,
    SignalSnapshot? SelectedSnapshot,
    SignalSnapshot? PreviousSnapshot,
    bool SnapshotLoading,
    bool StateLoading,
    bool StatsLoading,
    bool TransitionsLoading,
    bool HasLoaded,
    DateTimeOffset Now)
{
    /// <summary>The initial model — no vehicle selected, defaults matching the web (all FSMs, 7-day range, 50/page, live).</summary>
    public static StateMachineDebuggerModel Initial { get; } = new(
        Vehicles: Array.Empty<VehicleOptionRecord>(),
        SelectedVehicleId: null,
        FsmType: FsmTypeCatalog.All,
        Range: RangePreset.Last7d,
        Page: 1,
        PerPage: 50,
        CurrentState: null,
        Transitions: Array.Empty<FsmTransitionRecord>(),
        TotalRows: 0,
        ActiveSubs: Array.Empty<ActiveSubFSM>(),
        IsLive: true,
        WindowMinutes: 10,
        SelectedTransitionId: null,
        SelectedSnapshot: null,
        PreviousSnapshot: null,
        SnapshotLoading: false,
        StateLoading: false,
        StatsLoading: false,
        TransitionsLoading: false,
        HasLoaded: false,
        Now: DateTimeOffset.UnixEpoch);
}

/// <summary>A resolved value pair for the FSM-type / range / per-page dropdowns (value = wire form, label = localized).</summary>
public sealed record OptionDisplay(string Value, string Label);

/// <summary>A resolved state badge — the text plus the semantic status it tints with (web <c>StateBadge</c>).</summary>
public sealed record StateBadgeInfo(string Text, StatusKind Status);

/// <summary>The projected current-state hero (web Section 3 — Vehicle Live State).</summary>
public sealed record CurrentStateHeroDisplay(
    string StateText,
    StatusKind Status,
    string TypeLabel,
    string TypeValue,
    string ModeLabel,
    string ModeValue,
    string SinceLabel,
    string SinceText,
    string SinceRelative,
    bool HasSince);

/// <summary>One legend chip beside the distribution donut (web pie legend entry).</summary>
public sealed record PieLegendItem(string Name, string CountText, int ColorIndex);

/// <summary>One row of the transition-counts table (web Section 6 right — Transition Counts).</summary>
public sealed record SummaryRowDisplay(StateBadgeInfo State, string CountText, string AvgIntervalText);

/// <summary>One headline stat tile (web Section 7 — summary cards).</summary>
public sealed record StatCardDisplay(string Label, string Value, string Glyph);

/// <summary>One row of the transition log table (web Section 9 — Transition Log).</summary>
public sealed record TransitionRowDisplay(
    long Id,
    string IndexText,
    string TimeText,
    string FsmText,
    StateBadgeInfo FromBadge,
    StateBadgeInfo ToBadge,
    string Trigger,
    bool IsSelected,
    string ViewDetailAria);

/// <summary>One field of the selected-transition detail grid (web Section 10 — Transition Detail).</summary>
public sealed record DetailFieldDisplay(string Label, string Value, bool Mono, StateBadgeInfo? Badge = null);

/// <summary>
/// The fully projected, render-ready view of the State-Machine debugger — every label, badge, chart point, table
/// row, stat tile and sub-component model the view binds, plus the page's data-state flags. Pure data so every
/// region is asserted headlessly.
/// </summary>
public sealed record StateMachineDebuggerDisplay(
    string Title,
    string Subtitle,
    string AutomationName,
    bool InitialLoading,
    // Header actions
    bool HasVehicles,
    IReadOnlyList<OptionDisplay> VehicleOptions,
    string SelectedVehicleValue,
    string SelectVehicleLabel,
    IReadOnlyList<OptionDisplay> RangeOptions,
    string SelectedRangeValue,
    string AutoRefreshLabel,
    string ShareLabel,
    // GlassPanel1 — filters
    string FsmTypeLabel,
    string HelpTypeAria,
    string HelpTypeBody,
    IReadOnlyList<OptionDisplay> FsmTypeOptions,
    string SelectedFsmTypeValue,
    string PerPageLabel,
    IReadOnlyList<OptionDisplay> PerPageOptions,
    string SelectedPerPageValue,
    string NoVehiclesMessage,
    // GlassPanel2 — FSM health
    FsmHealthPanelModel HealthModel,
    // GlassPanel3 — current state hero
    string VehicleLiveStateTitle,
    string HelpLiveStateAria,
    string HelpLiveStateBody,
    bool StateLoading,
    bool ShowState,
    CurrentStateHeroDisplay? Hero,
    string NoStateMessage,
    // Section 4 — sub-FSM panel
    FSMSubFSMPanelModel SubFsmModel,
    // Live controls + timeline + inspector (GlassPanel5/11)
    LiveControlsModel LiveControls,
    StateTimelineModel StateTimeline,
    SnapshotInspectorModel SnapshotInspector,
    // Section 5 — state diagram context
    string DiagramFsmType,
    // State-Distribution chart (ChartContainer + PieChart)
    string DistributionTitle,
    string DistributionAria,
    string ChartColStateLabel,
    string ChartColCountLabel,
    ChartState ChartState,
    IReadOnlyList<ChartPoint> PieValues,
    IReadOnlyList<PieLegendItem> PieLegend,
    string ChartEmptyMessage,
    // Transition counts table
    string TransitionCountsTitle,
    string ColStateLabel,
    string ColCountLabel,
    string AvgIntervalLabel,
    bool CountsLoading,
    bool ShowCounts,
    IReadOnlyList<SummaryRowDisplay> SummaryRows,
    string CountsEmptyMessage,
    // Stat cards
    IReadOnlyList<StatCardDisplay> StatCards,
    // FSM timeline chart
    FSMTimelineChartModel TimelineChartModel,
    // Transition log table
    string TransitionLogTitle,
    string TransitionLogTotalText,
    bool HasTotal,
    bool TransitionsLoading,
    bool ShowTransitions,
    IReadOnlyList<TransitionRowDisplay> TransitionRows,
    string TimeColumnLabel,
    string FsmColumnLabel,
    string FromColumnLabel,
    string ToColumnLabel,
    string TriggerColumnLabel,
    bool ShowPagination,
    int Page,
    int PerPage,
    int TotalRows,
    string TransitionsEmptyMessage,
    // Detail panel
    bool ShowDetail,
    string DetailTitle,
    IReadOnlyList<DetailFieldDisplay> DetailFields,
    string DetailContextLabel,
    IReadOnlyList<string> DetailContextChips);

/// <summary>
/// The pure, WinUI-free projection turning the page's <see cref="StateMachineDebuggerModel"/> into a render-ready
/// <see cref="StateMachineDebuggerDisplay"/> — the native analogue of every <c>useMemo</c> / inline derivation in
/// the web <c>StateMachineDebuggerPage</c> (the pie + summary grouping, the flap detection, the windowing, the
/// stat cards, the badges and the four data-state branches). Asserted headlessly.
/// </summary>
public static class StateMachineDebuggerProjection
{
    /// <summary>The window-minute options the live toolbar offers (web <c>WINDOW_OPTIONS</c>).</summary>
    public static IReadOnlyList<int> PerPageOptions { get; } = new[] { 25, 50, 100 };

    /// <summary>Project the page model into its render-ready display.</summary>
    public static StateMachineDebuggerDisplay Project(StateMachineDebuggerModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        var s = new StateMachineDebuggerStrings(localizer);
        string resolvedFsm = FsmTypeCatalog.Resolve(model.FsmType);
        bool hasVehicles = model.Vehicles.Count > 0;
        var transitions = model.Transitions;

        // ── Range label for the empty-state copy (web activeRangeLabel) ──
        string rangeLabel = s.RangePresetLabel(model.Range);
        string emptyRangeMessage = s.NoTransitionsInRange(rangeLabel);

        // ── Pie distribution (web pieData — group by to_state, count desc) ──
        var byState = new Dictionary<string, int>(StringComparer.Ordinal);
        foreach (var tr in transitions)
        {
            byState[tr.ToState] = byState.TryGetValue(tr.ToState, out var c) ? c + 1 : 1;
        }

        var ordered = byState.OrderByDescending(kv => kv.Value).ThenBy(kv => kv.Key, StringComparer.Ordinal).ToList();
        var pieValues = new List<ChartPoint>(ordered.Count);
        var pieLegend = new List<PieLegendItem>(ordered.Count);
        for (int i = 0; i < ordered.Count; i++)
        {
            pieValues.Add(new ChartPoint(i, ordered[i].Value, ordered[i].Key));
            pieLegend.Add(new PieLegendItem(ordered[i].Key, FmtInt(ordered[i].Value), i));
        }

        ChartState chartState = model.TransitionsLoading
            ? ChartState.Loading
            : pieValues.Count > 0 ? ChartState.Ready : ChartState.Empty;

        // ── Summary rows (web summaryRows — count + avg interval per to_state) ──
        var summaryRows = BuildSummaryRows(transitions, s);

        // ── Flap detection (web computeFlapIds) ──
        var healthTransitions = transitions
            .Select(t => new FsmHealthTransition(t.Id, t.VehicleId, t.TsRaw ?? string.Empty, t.FsmName ?? "vehicle", t.ToState))
            .ToList();
        int flapCount = FsmHealthPanelProjection.ComputeFlapIds(healthTransitions).Count;

        // ── Current-state hero (web Section 3) ──
        CurrentStateHeroDisplay? hero = null;
        string? stateName = model.CurrentState?.State?.ToLowerInvariant();
        if (model.CurrentState is { } cs)
        {
            hero = new CurrentStateHeroDisplay(
                StateText: string.IsNullOrEmpty(cs.State) ? StateMachineDebuggerStrings.Dash : cs.State!,
                Status: ResolveStatus("vehicle", stateName),
                TypeLabel: s.Type,
                TypeValue: s.VehicleTypeValue,
                ModeLabel: s.Mode,
                ModeValue: s.ModeLabel(cs.Mode),
                SinceLabel: s.Since,
                SinceText: cs.Since is { } since ? FormatAbsolute(since) : StateMachineDebuggerStrings.Dash,
                SinceRelative: cs.Since is { } sinceRel ? FormatRelative(sinceRel, model.Now) : string.Empty,
                HasSince: cs.Since is not null);
        }

        // ── Stat cards (web Section 7) ──
        var statCards = new List<StatCardDisplay>
        {
            new(s.TotalOnPage, $"{FmtInt(transitions.Count)} / {FmtInt(model.TotalRows)}", StateMachineDebuggerRegistration.ActivityGlyph),
            new(s.TotalTransitions, FmtInt(model.TotalRows), StateMachineDebuggerRegistration.ActivityGlyph),
            new(s.FlapCount, FmtInt(flapCount), StateMachineDebuggerRegistration.WarningGlyph),
            new(s.CurrentState, stateName ?? StateMachineDebuggerStrings.Dash, StateMachineDebuggerRegistration.ZapGlyph),
        };

        // ── Transition log rows (web Section 9) ──
        var rows = new List<TransitionRowDisplay>(transitions.Count);
        for (int i = 0; i < transitions.Count; i++)
        {
            var tr = transitions[i];
            int globalIdx = ((model.Page - 1) * model.PerPage) + i + 1;
            string fsmContext = string.IsNullOrEmpty(tr.FsmName) ? "vehicle" : tr.FsmName!;
            rows.Add(new TransitionRowDisplay(
                Id: tr.Id,
                IndexText: globalIdx.ToString(CultureInfo.InvariantCulture),
                TimeText: tr.Timestamp is { } ts ? FormatClock(ts) : (tr.TsRaw ?? StateMachineDebuggerStrings.Dash),
                FsmText: (tr.FsmName ?? "vehicle").Replace('_', ' '),
                FromBadge: BuildBadge(fsmContext, tr.FromState),
                ToBadge: BuildBadge(fsmContext, tr.ToState),
                Trigger: tr.Trigger,
                IsSelected: model.SelectedTransitionId == tr.Id,
                ViewDetailAria: s.ViewDetail));
        }

        // ── FSM timeline chart model (web Section 8 — to_state as the grouping key) ──
        var timelineModel = new FSMTimelineChartModel(
            transitions.Select(t => new FSMTimelineTransition(t.ToState, t.TsRaw)).ToList(),
            RangePresets.Hours(model.Range),
            emptyRangeMessage);

        // ── Live section windowing (web visibleTransitions / windowed) ──
        var live = BuildLiveSection(model, resolvedFsm, s);

        // ── Detail panel (web Section 10) ──
        var selected = model.SelectedTransitionId is { } selId
            ? transitions.FirstOrDefault(t => t.Id == selId)
            : null;
        var (detailFields, detailChips) = BuildDetail(selected, s);

        bool initialLoading = model.StateLoading && model.TransitionsLoading && model.StatsLoading && !model.HasLoaded;

        return new StateMachineDebuggerDisplay(
            Title: s.Title,
            Subtitle: s.Subtitle,
            AutomationName: s.Title,
            InitialLoading: initialLoading,
            HasVehicles: hasVehicles,
            VehicleOptions: model.Vehicles.Select(v => new OptionDisplay(v.Id.ToString(CultureInfo.InvariantCulture), v.Label)).ToList(),
            SelectedVehicleValue: model.SelectedVehicleId?.ToString(CultureInfo.InvariantCulture) ?? string.Empty,
            SelectVehicleLabel: s.SelectVehicle,
            RangeOptions: RangePresets.Ordered.Select(p => new OptionDisplay(p.ToString(), s.RangePresetLabel(p))).ToList(),
            SelectedRangeValue: model.Range.ToString(),
            AutoRefreshLabel: s.AutoRefresh,
            ShareLabel: s.Share,
            FsmTypeLabel: s.FsmType,
            HelpTypeAria: s.HelpTypeAria,
            HelpTypeBody: s.HelpTypeBody,
            FsmTypeOptions: FsmTypeCatalog.Values.Select(v => new OptionDisplay(v, FsmTypeCatalog.Label(localizer, v))).ToList(),
            SelectedFsmTypeValue: model.FsmType,
            PerPageLabel: s.PerPage,
            PerPageOptions: PerPageOptions.Select(p => new OptionDisplay(p.ToString(CultureInfo.InvariantCulture), p.ToString(CultureInfo.InvariantCulture))).ToList(),
            SelectedPerPageValue: model.PerPage.ToString(CultureInfo.InvariantCulture),
            NoVehiclesMessage: s.NoVehicles,
            HealthModel: new FsmHealthPanelModel(healthTransitions),
            VehicleLiveStateTitle: s.VehicleLiveState,
            HelpLiveStateAria: s.HelpLiveStateAria,
            HelpLiveStateBody: s.HelpLiveStateBody,
            StateLoading: model.StateLoading && !model.HasLoaded,
            ShowState: hero is not null,
            Hero: hero,
            NoStateMessage: s.NoState,
            SubFsmModel: new FSMSubFSMPanelModel(resolvedFsm, model.ActiveSubs),
            LiveControls: live.Controls,
            StateTimeline: live.Timeline,
            SnapshotInspector: live.Inspector,
            DiagramFsmType: resolvedFsm,
            DistributionTitle: s.DistributionByState,
            DistributionAria: s.DistributionByStateAria,
            ChartColStateLabel: s.ColState,
            ChartColCountLabel: s.ColCount,
            ChartState: chartState,
            PieValues: pieValues,
            PieLegend: pieLegend,
            ChartEmptyMessage: emptyRangeMessage,
            TransitionCountsTitle: s.TransitionCounts,
            ColStateLabel: s.State,
            ColCountLabel: s.Count,
            AvgIntervalLabel: s.AvgInterval,
            CountsLoading: model.TransitionsLoading,
            ShowCounts: summaryRows.Count > 0,
            SummaryRows: summaryRows,
            CountsEmptyMessage: emptyRangeMessage,
            StatCards: statCards,
            TimelineChartModel: timelineModel,
            TransitionLogTitle: s.TimelineTitle,
            TransitionLogTotalText: $"{FmtInt(model.TotalRows)} {s.Total}",
            HasTotal: model.TotalRows > 0,
            TransitionsLoading: model.TransitionsLoading,
            ShowTransitions: transitions.Count > 0,
            TransitionRows: rows,
            TimeColumnLabel: s.Time,
            FsmColumnLabel: s.Type,
            FromColumnLabel: s.From,
            ToColumnLabel: s.To,
            TriggerColumnLabel: s.Trigger,
            ShowPagination: transitions.Count > 0,
            Page: model.Page,
            PerPage: model.PerPage,
            TotalRows: model.TotalRows,
            TransitionsEmptyMessage: emptyRangeMessage,
            ShowDetail: selected is not null,
            DetailTitle: s.DetailTitle,
            DetailFields: detailFields,
            DetailContextLabel: s.DetailContext,
            DetailContextChips: detailChips);
    }

    private static List<SummaryRowDisplay> BuildSummaryRows(IReadOnlyList<FsmTransitionRecord> transitions, StateMachineDebuggerStrings s)
    {
        var counts = new Dictionary<string, int>(StringComparer.Ordinal);
        var times = new Dictionary<string, List<long>>(StringComparer.Ordinal);
        foreach (var tr in transitions)
        {
            counts[tr.ToState] = counts.TryGetValue(tr.ToState, out var c) ? c + 1 : 1;
            if (!times.TryGetValue(tr.ToState, out var list))
            {
                list = new List<long>();
                times[tr.ToState] = list;
            }

            if (tr.Timestamp is { } ts)
            {
                list.Add(ts.ToUnixTimeMilliseconds());
            }
        }

        return counts
            .OrderByDescending(kv => kv.Value)
            .ThenBy(kv => kv.Key, StringComparer.Ordinal)
            .Select(kv =>
            {
                double avgInterval = 0;
                var ms = times[kv.Key];
                if (ms.Count > 1)
                {
                    ms.Sort();
                    long totalGap = 0;
                    for (int i = 1; i < ms.Count; i++)
                    {
                        totalGap += ms[i] - ms[i - 1];
                    }

                    avgInterval = (double)totalGap / (ms.Count - 1) / 1000.0;
                }

                return new SummaryRowDisplay(
                    BuildBadge("vehicle", kv.Key),
                    FmtInt(kv.Value),
                    avgInterval > 0 ? FormatDuration(avgInterval) : StateMachineDebuggerStrings.Dash);
            })
            .ToList();
    }

    private static (LiveControlsModel Controls, StateTimelineModel Timeline, SnapshotInspectorModel Inspector) BuildLiveSection(
        StateMachineDebuggerModel model, string resolvedFsm, StateMachineDebuggerStrings s)
    {
        var sorted = model.Transitions
            .Where(t => t.Timestamp is not null)
            .OrderBy(t => t.Timestamp!.Value)
            .ToList();

        var last = sorted.Count > 0 ? sorted[^1] : null;
        DateTimeOffset anchor = model.IsLive
            ? model.Now
            : (model.SelectedTransitionId is { } selId
                ? sorted.FirstOrDefault(t => t.Id == selId)?.Timestamp ?? model.Now
                : model.Now);

        DateTimeOffset windowStart = anchor.AddMinutes(-model.WindowMinutes);
        var inWindow = sorted.Where(t => t.Timestamp!.Value >= windowStart && t.Timestamp!.Value <= anchor).ToList();

        int? widerPreset = null;
        if (inWindow.Count == 0 && last?.Timestamp is { } lastTs)
        {
            foreach (int preset in new[] { 5, 10, 30, 60, 120, 360, 720, 1440 })
            {
                if (preset > model.WindowMinutes && lastTs >= anchor.AddMinutes(-preset))
                {
                    widerPreset = preset;
                    break;
                }
            }
        }

        int selectedIndex = model.SelectedTransitionId is { } sid
            ? sorted.FindIndex(t => t.Id == sid)
            : -1;

        var controls = new LiveControlsModel(
            IsLive: model.IsLive,
            CanStepPrev: !model.IsLive && sorted.Count > 0 && selectedIndex > 0,
            CanStepNext: !model.IsLive && sorted.Count > 0 && selectedIndex >= 0 && selectedIndex < sorted.Count - 1,
            WindowMinutes: model.WindowMinutes,
            WindowCount: inWindow.Count,
            TotalCount: sorted.Count);

        var timeline = new StateTimelineModel(
            Transitions: inWindow.Select(ToStateTransition).ToList(),
            FsmType: resolvedFsm,
            SelectedId: model.SelectedTransitionId,
            WindowMinutes: model.WindowMinutes,
            Anchor: model.IsLive ? null : anchor,
            LastTransition: last is not null ? ToStateTransition(last) : null,
            WiderPreset: widerPreset,
            CanWidenWindow: true,
            CanJumpToLast: true);

        var selectedTransition = model.SelectedTransitionId is { } selId2
            ? model.Transitions.FirstOrDefault(t => t.Id == selId2)
            : null;

        SnapshotTransition? snapTransition = selectedTransition is null
            ? null
            : new SnapshotTransition(
                selectedTransition.Id,
                selectedTransition.VehicleId,
                selectedTransition.TsRaw,
                selectedTransition.FsmName ?? string.Empty,
                selectedTransition.FromState,
                selectedTransition.ToState,
                selectedTransition.Trigger,
                selectedTransition.DurationMs,
                selectedTransition.RawJson);

        string lastRelative = last?.Timestamp is { } lr ? FormatRelative(lr, model.Now) : string.Empty;

        var inspector = SnapshotInspectorModel.Create(
            fsmType: selectedTransition?.FsmName ?? resolvedFsm,
            transition: snapTransition,
            snapshot: model.SelectedSnapshot,
            previousSnapshot: model.PreviousSnapshot,
            loading: model.SnapshotLoading,
            hasLastTransition: last is not null,
            inWindowCount: inWindow.Count,
            canJumpToLast: true,
            lastTransitionRelative: lastRelative);

        return (controls, timeline, inspector);
    }

    private static StateTransition ToStateTransition(FsmTransitionRecord t) =>
        new(t.Id, t.Timestamp ?? DateTimeOffset.UnixEpoch, t.FromState, t.ToState);

    private static (IReadOnlyList<DetailFieldDisplay> Fields, IReadOnlyList<string> Chips) BuildDetail(
        FsmTransitionRecord? transition, StateMachineDebuggerStrings s)
    {
        if (transition is null)
        {
            return (Array.Empty<DetailFieldDisplay>(), Array.Empty<string>());
        }

        string fsmContext = string.IsNullOrEmpty(transition.FsmName) ? "vehicle" : transition.FsmName!;
        var fields = new List<DetailFieldDisplay>
        {
            new(s.DetailId, transition.Id.ToString(CultureInfo.InvariantCulture), Mono: true),
            new(s.DetailVehicleId, transition.VehicleId.ToString(CultureInfo.InvariantCulture), Mono: true),
        };

        if (!string.IsNullOrEmpty(transition.FsmName))
        {
            fields.Add(new DetailFieldDisplay(s.DetailName, transition.FsmName!, Mono: true));
        }

        fields.Add(new DetailFieldDisplay(s.DetailFrom, transition.FromState, Mono: false, Badge: BuildBadge(fsmContext, transition.FromState)));
        fields.Add(new DetailFieldDisplay(s.DetailTo, transition.ToState, Mono: false, Badge: BuildBadge(fsmContext, transition.ToState)));
        fields.Add(new DetailFieldDisplay(s.DetailTrigger, transition.Trigger, Mono: true));

        if (!string.IsNullOrEmpty(transition.Guard))
        {
            fields.Add(new DetailFieldDisplay(s.DetailGuard, transition.Guard!, Mono: true));
        }

        if (transition.DurationMs is { } dur && dur > 0)
        {
            fields.Add(new DetailFieldDisplay(s.DetailDuration, FormatDuration(dur / 1000.0), Mono: true));
        }

        string timestamp = transition.Timestamp is { } ts
            ? FormatAbsolute(ts)
            : (transition.TsRaw ?? StateMachineDebuggerStrings.Dash);
        fields.Add(new DetailFieldDisplay(s.DetailTimestamp, timestamp, Mono: true));

        var chips = transition.Details.Select(d => $"{d.Key}: {d.Value}").ToList();
        return (fields, chips);
    }

    private static StateBadgeInfo BuildBadge(string fsmType, string state) =>
        new(string.IsNullOrEmpty(state) ? StateMachineDebuggerStrings.Dash : state, ResolveStatus(fsmType, state));

    private static StatusKind ResolveStatus(string fsmType, string? state)
    {
        StateColor color = StateColorResolver.Resolve(fsmType, state);
        return color.Variant switch
        {
            StateColorVariant.Success => StatusKind.Success,
            StateColorVariant.Warning => StatusKind.Warning,
            StateColorVariant.Danger => StatusKind.Danger,
            StateColorVariant.Info => StatusKind.Info,
            _ => StatusKind.Neutral,
        };
    }

    private static string FmtInt(double value) =>
        Math.Round(value).ToString("N0", CultureInfo.InvariantCulture);

    private static string FormatDuration(double seconds)
    {
        if (seconds < 60)
        {
            return $"{FmtInt(seconds)}s";
        }

        if (seconds < 3600)
        {
            return $"{FmtInt(seconds / 60)}m";
        }

        int h = (int)Math.Floor(seconds / 3600);
        double mRaw = (seconds % 3600) / 60;
        return mRaw >= 0.5 ? $"{h}h {FmtInt(mRaw)}m" : $"{h}h";
    }

    private static string FormatClock(DateTimeOffset ts) =>
        ts.ToLocalTime().ToString("HH:mm:ss", CultureInfo.InvariantCulture);

    private static string FormatAbsolute(DateTimeOffset ts) =>
        ts.ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);

    private static string FormatRelative(DateTimeOffset value, DateTimeOffset now)
    {
        TimeSpan delta = now - value;
        if (delta < TimeSpan.Zero)
        {
            delta = TimeSpan.Zero;
        }

        if (delta.TotalSeconds < 60)
        {
            return $"{(int)delta.TotalSeconds}s ago";
        }

        if (delta.TotalMinutes < 60)
        {
            return $"{(int)delta.TotalMinutes}m ago";
        }

        if (delta.TotalHours < 24)
        {
            return $"{(int)delta.TotalHours}h ago";
        }

        return $"{(int)delta.TotalDays}d ago";
    }
}
