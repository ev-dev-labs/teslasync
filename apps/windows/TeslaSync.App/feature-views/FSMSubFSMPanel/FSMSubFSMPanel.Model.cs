using TeslaSync.App.Core.DataDisplay;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Units;

namespace TeslaSync.App.FeatureViews;

/// <summary>
/// The kind of vehicle sub-FSM a <c>FSMSubFSMPanel</c> row represents — the native mirror of the web
/// <c>ActiveSubFSM['type']</c> union (<c>'drive' | 'charge'</c>) from <c>web/src/types/fsm/ui-types.ts</c>. Drives
/// the row's icon (a car for a drive, a lightning bolt for a charge) and its label / terminal-state set.
/// </summary>
public enum SubFSMKind
{
    /// <summary>A per-drive session sub-FSM (web <c>'drive'</c>).</summary>
    Drive,

    /// <summary>A per-charge session sub-FSM (web <c>'charge'</c>).</summary>
    Charge,
}

/// <summary>
/// One active vehicle sub-FSM — the native, WinUI-free analogue of the web <c>ActiveSubFSM</c> interface
/// (<c>web/src/types/fsm/ui-types.ts</c>) the State-Machine debugger hands
/// <c>&lt;FSMSubFSMPanel /&gt;</c> (<c>web/src/features/system/components/FSMSubFSMPanel.tsx</c>). A parent
/// state-holder maps each API <c>active_subs</c> entry field-for-field into this snapshot; the panel performs no
/// fetching of its own. <see cref="DriveId"/> / <see cref="SessionId"/> carry the web optional identity fields
/// (used by the parent for keying / drill-down) and are intentionally never surfaced in the row to keep the
/// diagnostics PII-safe.
/// </summary>
/// <param name="Kind">Whether this is a drive or charge sub-FSM (web <c>type</c>).</param>
/// <param name="State">The current sub-FSM state name, lower-case as the backend emits it (web <c>state</c>).</param>
/// <param name="StartTime">When the sub-FSM started, or null when unknown (web <c>start_time</c>).</param>
/// <param name="DriveId">The originating drive id, when this is a drive sub-FSM (web <c>drive_id</c>).</param>
/// <param name="SessionId">The originating charge session id, when this is a charge sub-FSM (web <c>session_id</c>).</param>
public sealed record ActiveSubFSM(
    SubFSMKind Kind,
    string State,
    DateTimeOffset? StartTime,
    long? DriveId = null,
    long? SessionId = null);

/// <summary>
/// The mutually-exclusive render branch of the <c>FSMSubFSMPanel</c> surface. The web source is a pure
/// presentational child: it returns <c>null</c> for non-vehicle FSM views, an <c>EmptyState</c> when no sub-FSMs
/// are active, and the responsive grid otherwise. Every branch maps onto a visible (or, for the web's deliberate
/// <c>return null</c>, a collapsed) surface — none is ever hidden behind a silent data gate. There is no
/// fetch-driven loading / error / stale / offline branch to reproduce inside this surface because the panel takes
/// resolved props; the parent State-Machine page owns the query lifecycle and its loading / error / freshness
/// chrome.
/// </summary>
public enum FSMSubFSMPanelState
{
    /// <summary>
    /// The host FSM view is not vehicle-scoped (web <c>fsmType</c> is neither <c>'vehicle'</c> nor <c>'all'</c>) —
    /// the web returns <c>null</c>; the native surface collapses to take no space.
    /// </summary>
    Hidden,

    /// <summary>Vehicle-scoped with no active sub-FSMs — the panel chrome over a friendly empty stand-in.</summary>
    Empty,

    /// <summary>Vehicle-scoped with one or more active sub-FSMs — the responsive sub-FSM grid (the web render).</summary>
    Populated,
}

/// <summary>
/// The render model the <c>FSMSubFSMPanel</c> projects — the native analogue of the web component's two props
/// (<c>activeSubs?: ActiveSubFSM[]</c> and <c>fsmType: string</c>). Pure data so the projection is asserted
/// headlessly.
/// </summary>
/// <param name="FsmType">The host FSM view key (web <c>fsmType</c>); the panel is only applicable to <c>vehicle</c> / <c>all</c>.</param>
/// <param name="ActiveSubs">The active sub-FSMs (web <c>activeSubs</c>); null is treated as an empty list.</param>
public sealed record FSMSubFSMPanelModel(
    string FsmType,
    IReadOnlyList<ActiveSubFSM>? ActiveSubs = null)
{
    /// <summary>A vehicle-scoped model with no active sub-FSMs — the view's initial model (renders the empty branch).</summary>
    public static FSMSubFSMPanelModel Empty { get; } = new("vehicle", []);
}

/// <summary>
/// The resolved semantic colour of a sub-FSM state — the WinUI-free analogue of the web
/// <c>getStateColor(fsmType, state)</c> result (<c>web/src/types/fsm/registry.ts</c> + <c>theme.ts</c>). The web
/// resolves each state to one of five <c>BadgeVariant</c>s (success / warning / danger / info / neutral) plus
/// cosmetic Tailwind override hues; the native surface keeps the <em>semantic</em> variant (the source of truth)
/// and maps it onto a canonical <see cref="SeverityLevel"/> token at the display boundary, with
/// <see cref="Neutral"/> marking the de-emphasised neutral states (recovered / unknown) that render muted rather
/// than tinted — per the platform token discipline (no ad-hoc per-state hex).
/// </summary>
/// <param name="Severity">The canonical severity token the state's variant maps onto.</param>
/// <param name="Neutral">True for neutral states (recovered / unknown) which render muted, not severity-tinted.</param>
public readonly record struct SubFSMStateStyle(SeverityLevel Severity, bool Neutral);

/// <summary>
/// One fully projected sub-FSM row — the native analogue of everything the web <c>FSMSubFSMPanel</c> computes
/// per <c>subs.map(...)</c> before rendering a row: the leading icon, the localized session label, the
/// active-vs-terminal indicator, the state badge (text + resolved colour) and the start-time stamp. Pure data so
/// every row is asserted without a UI host.
/// </summary>
/// <param name="Kind">The sub-FSM kind backing the row.</param>
/// <param name="Label">The localized session label ("Drive Session" / "Charge Session").</param>
/// <param name="IconGlyph">The Segoe Fluent glyph standing in for the web Lucide icon (Car / Zap).</param>
/// <param name="IsActive">True while the state is non-terminal (drives the live accent + pulse).</param>
/// <param name="StateText">The state name rendered verbatim in the badge (web <c>{state}</c>).</param>
/// <param name="StateSeverity">The canonical severity token the badge tints with (ignored when neutral).</param>
/// <param name="NeutralState">True when the state is neutral and the badge renders muted.</param>
/// <param name="StartTimeText">The formatted relative start time, or the em-dash for an unknown timestamp.</param>
/// <param name="AutomationName">The composed Narrator name for the row.</param>
public sealed record FSMSubFSMPanelRow(
    SubFSMKind Kind,
    string Label,
    string IconGlyph,
    bool IsActive,
    string StateText,
    SeverityLevel StateSeverity,
    bool NeutralState,
    string StartTimeText,
    string AutomationName);

/// <summary>
/// The fully projected, render-ready view of the panel input — the native analogue of everything the web
/// <c>FSMSubFSMPanel</c> resolves before returning its <c>GlassPanel</c>. Holds the active <see cref="State"/>,
/// the localized <see cref="Title"/> and <see cref="EmptyMessage"/>, the projected <see cref="Rows"/> and the
/// composed surface <see cref="AutomationName"/>. Pure data so every branch is asserted headlessly.
/// </summary>
/// <param name="State">The active render branch.</param>
/// <param name="Title">The localized panel heading ("Active Sub-FSMs").</param>
/// <param name="EmptyMessage">The localized empty-state copy.</param>
/// <param name="Rows">The projected sub-FSM rows (empty unless populated).</param>
/// <param name="AutomationName">The composed surface Narrator name.</param>
public sealed record FSMSubFSMPanelDisplay(
    FSMSubFSMPanelState State,
    string Title,
    string EmptyMessage,
    IReadOnlyList<FSMSubFSMPanelRow> Rows,
    string AutomationName);

/// <summary>
/// Semantic state-colour and terminality resolution for the drive / charge sub-FSMs — the native port of the web
/// <c>DRIVE_SESSION_STATE_ENTRIES</c> / <c>CHARGE_SESSION_STATE_ENTRIES</c> variant tables
/// (<c>web/src/types/fsm/drive-session.ts</c>, <c>charge-session.ts</c>) consumed via <c>getStateColor</c>, plus
/// the panel's own terminal-state sets (drive <c>completed | recovered</c>, charge <c>done | recovered</c>) that
/// decide the live-vs-terminal indicator. Kept WinUI-free so the mapping is asserted directly in tests.
/// </summary>
public static class FSMSubFSMStateColors
{
    /// <summary>Resolve the semantic badge colour for a sub-FSM <paramref name="state"/> of the given <paramref name="kind"/>.</summary>
    /// <param name="kind">The sub-FSM kind (selects the drive or charge variant table).</param>
    /// <param name="state">The state name (case-insensitive); unknown states resolve to neutral.</param>
    /// <returns>The resolved <see cref="SubFSMStateStyle"/>.</returns>
    public static SubFSMStateStyle Resolve(SubFSMKind kind, string? state)
    {
        string s = Normalize(state);
        return kind switch
        {
            SubFSMKind.Drive => s switch
            {
                "pending" => new SubFSMStateStyle(SeverityLevel.Warn, false),
                "active" => new SubFSMStateStyle(SeverityLevel.Success, false),
                "ending" => new SubFSMStateStyle(SeverityLevel.Warn, false),
                "completed" => new SubFSMStateStyle(SeverityLevel.Info, false),
                "recovered" => NeutralStyle,
                _ => NeutralStyle,
            },
            _ => s switch
            {
                "pending" => new SubFSMStateStyle(SeverityLevel.Warn, false),
                "active" => new SubFSMStateStyle(SeverityLevel.Success, false),
                "completing" => new SubFSMStateStyle(SeverityLevel.Info, false),
                "done" => new SubFSMStateStyle(SeverityLevel.Success, false),
                "recovered" => NeutralStyle,
                _ => NeutralStyle,
            },
        };
    }

    /// <summary>
    /// True when <paramref name="state"/> is a terminal state for the given <paramref name="kind"/> — the native
    /// port of the web <c>terminalStates</c> arrays (drive <c>['completed','recovered']</c>, charge
    /// <c>['done','recovered']</c>). The panel's live indicator is the negation of this.
    /// </summary>
    /// <param name="kind">The sub-FSM kind.</param>
    /// <param name="state">The state name (case-insensitive).</param>
    /// <returns>True when the state is terminal.</returns>
    public static bool IsTerminal(SubFSMKind kind, string? state)
    {
        string s = Normalize(state);
        return kind switch
        {
            SubFSMKind.Drive => s is "completed" or "recovered",
            _ => s is "done" or "recovered",
        };
    }

    private static SubFSMStateStyle NeutralStyle => new(SeverityLevel.Info, true);

    private static string Normalize(string? state) => (state ?? string.Empty).Trim().ToLowerInvariant();
}

/// <summary>
/// Pure, WinUI-free projection of a <see cref="FSMSubFSMPanelModel"/> into a render-ready
/// <see cref="FSMSubFSMPanelDisplay"/> — the native analogue of the web <c>FSMSubFSMPanel</c> render body
/// (<c>web/src/features/system/components/FSMSubFSMPanel.tsx</c>): the <c>isVehicleView</c> gate, the empty-vs-grid
/// branch, and the per-row <c>label</c> / icon / <c>isActive</c> / state-badge / timestamp computation. Every
/// string flows through the <see cref="ILocalizer"/> facade so the resource keys are asserted in tests and
/// resolved for real in the app.
/// </summary>
public static class FSMSubFSMPanelProjection
{
    /// <summary>Resource key for the panel heading (web <c>t('fsm.subFSMs', ...)</c>).</summary>
    public const string TitleKey = "translation.fsm.subFSMs";

    /// <summary>English fallback for the panel heading.</summary>
    public const string TitleFallback = "Active Sub-FSMs";

    /// <summary>Resource key for the empty-state copy (web <c>t('fsm.noSubFSMs', ...)</c>).</summary>
    public const string EmptyKey = "translation.fsm.noSubFSMs";

    /// <summary>English fallback for the empty-state copy.</summary>
    public const string EmptyFallback = "No active drive or charge sessions";

    /// <summary>Resource key for the drive session label (web <c>t('fsm.activeDrive', ...)</c>).</summary>
    public const string DriveLabelKey = "translation.fsm.activeDrive";

    /// <summary>English fallback for the drive session label.</summary>
    public const string DriveLabelFallback = "Drive Session";

    /// <summary>Resource key for the charge session label (web <c>t('fsm.activeCharge', ...)</c>).</summary>
    public const string ChargeLabelKey = "translation.fsm.activeCharge";

    /// <summary>English fallback for the charge session label.</summary>
    public const string ChargeLabelFallback = "Charge Session";

    /// <summary>Project <paramref name="model"/> into its render-ready display.</summary>
    /// <param name="model">The panel input (fsm type + active sub-FSMs).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    /// <param name="now">The reference instant the relative start times are measured against.</param>
    /// <returns>The projected <see cref="FSMSubFSMPanelDisplay"/>.</returns>
    public static FSMSubFSMPanelDisplay Project(FSMSubFSMPanelModel model, ILocalizer localizer, DateTimeOffset now)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString(TitleKey, TitleFallback);
        string emptyMessage = localizer.GetString(EmptyKey, EmptyFallback);

        // web: `if (!isVehicleView) return null` — the panel is only applicable to vehicle-level FSM views.
        if (!IsVehicleView(model.FsmType))
        {
            return new FSMSubFSMPanelDisplay(FSMSubFSMPanelState.Hidden, title, emptyMessage, [], title);
        }

        // web: `const subs = activeSubs ?? []`
        IReadOnlyList<ActiveSubFSM> subs = model.ActiveSubs ?? [];
        if (subs.Count == 0)
        {
            return new FSMSubFSMPanelDisplay(
                FSMSubFSMPanelState.Empty, title, emptyMessage, [], $"{title}. {emptyMessage}");
        }

        var rows = new List<FSMSubFSMPanelRow>(subs.Count);
        foreach (var sub in subs)
        {
            rows.Add(ProjectRow(sub, localizer, now));
        }

        return new FSMSubFSMPanelDisplay(FSMSubFSMPanelState.Populated, title, emptyMessage, rows, title);
    }

    /// <summary>
    /// True when the host FSM view is vehicle-scoped — the native port of the web
    /// <c>fsmType === 'vehicle' || fsmType === 'all'</c> guard.
    /// </summary>
    /// <param name="fsmType">The host FSM view key.</param>
    /// <returns>True for <c>vehicle</c> / <c>all</c> (case-insensitive).</returns>
    public static bool IsVehicleView(string? fsmType)
    {
        string t = (fsmType ?? string.Empty).Trim().ToLowerInvariant();
        return t is "vehicle" or "all";
    }

    private static FSMSubFSMPanelRow ProjectRow(ActiveSubFSM sub, ILocalizer localizer, DateTimeOffset now)
    {
        bool isDrive = sub.Kind == SubFSMKind.Drive;
        string label = isDrive
            ? localizer.GetString(DriveLabelKey, DriveLabelFallback)
            : localizer.GetString(ChargeLabelKey, ChargeLabelFallback);
        string glyph = isDrive ? FSMSubFSMPanelRegistration.CarGlyph : FSMSubFSMPanelRegistration.ZapGlyph;

        bool isActive = !FSMSubFSMStateColors.IsTerminal(sub.Kind, sub.State);
        SubFSMStateStyle style = FSMSubFSMStateColors.Resolve(sub.Kind, sub.State);
        string stateText = (sub.State ?? string.Empty).Trim();
        string startTimeText = DateTimeFormatting.Format(sub.StartTime, DateTimeVariant.Relative, now);

        string automationName = $"{label}, {stateText}, {startTimeText}";

        return new FSMSubFSMPanelRow(
            sub.Kind,
            label,
            glyph,
            isActive,
            stateText,
            style.Severity,
            style.Neutral,
            startTimeText,
            automationName);
    }
}

/// <summary>
/// PII-safe diagnostics for the <c>FSMSubFSMPanel</c> surface (P1/S11 diagnostics contract). Records only the
/// operational <c>view.opened</c> event with the surface slug — never the sub-FSM state, start time, drive id or
/// session id — so a diagnostics line can never leak a user's drive / charge activity. Thread-safe.
/// </summary>
public sealed class FSMSubFSMPanelDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public FSMSubFSMPanelDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=FSMSubFSMPanel</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={FSMSubFSMPanelRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>FSMSubFSMPanel</c> feature surface — the native mirror of the web component at
/// <c>web/src/features/system/components/FSMSubFSMPanel.tsx</c>. Holds the diagnostics slug and the Segoe Fluent
/// glyphs that stand in for the web Lucide icons. UI-free so the metadata is asserted in tests.
/// </summary>
public static class FSMSubFSMPanelRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "FSMSubFSMPanel";

    /// <summary>Segoe Fluent "Car" glyph for the drive row (web Lucide <c>Car</c>).</summary>
    public const string CarGlyph = "\uE804";

    /// <summary>Segoe Fluent "LightningBolt" glyph for the charge row (web Lucide <c>Zap</c>).</summary>
    public const string ZapGlyph = "\uE945";
}
