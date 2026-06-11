namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// Hover-glow accent for the row's <c>TsGlassPanel</c> body — the native port of the web
/// <c>HistoryListRowGlow</c> union (<c>'cyan' | 'green' | 'purple' | 'none'</c>) in
/// <c>web/src/components/data-display/HistoryListRow.tsx</c>. <see cref="Cyan"/> is the web default. Each value
/// maps to a glass-panel border brush key (see <see cref="HistoryListRowRegistration.GlowBrushKey"/>) so the
/// projection and the view agree on the accent without a UI host.
/// </summary>
public enum HistoryListRowGlow
{
    /// <summary>web <c>'cyan'</c> — the default speed-accent glow.</summary>
    Cyan,

    /// <summary>web <c>'green'</c> — the battery-accent glow.</summary>
    Green,

    /// <summary>web <c>'purple'</c> — the power-accent glow.</summary>
    Purple,

    /// <summary>web <c>'none'</c> — the neutral hairline border, no accent.</summary>
    None,
}

/// <summary>
/// How activating the row behaves — the native projection of the web row's mutually-exclusive
/// <c>href</c> / <c>onClick</c> contract (<c>web/src/components/data-display/HistoryListRow.tsx</c>). A row with
/// an <c>href</c> wraps its body in a react-router <c>&lt;Link&gt;</c> (<see cref="Navigate"/>); a row with an
/// <c>onClick</c> handler fires it on the panel (<see cref="Invoke"/>); a row with neither is inert chrome
/// (<see cref="None"/>).
/// </summary>
public enum HistoryListRowActivation
{
    /// <summary>The row is not activatable (web: neither <c>href</c> nor <c>onClick</c>).</summary>
    None,

    /// <summary>Activating the row navigates to its <c>href</c> (web <c>&lt;Link to={href}&gt;</c>).</summary>
    Navigate,

    /// <summary>Activating the row runs the host's click handler (web <c>onClick</c>).</summary>
    Invoke,
}

/// <summary>
/// The mutually-exclusive content state of the row. The web source
/// (<c>web/src/components/data-display/HistoryListRow.tsx</c>) is a pure presentational slot container with no
/// data source and no asynchronous read, so it has a single content state — <see cref="Ready"/> — plus the
/// defensive <see cref="Empty"/> branch so a degenerate row with no primary content renders a friendly
/// empty marker rather than a blank box (web's <c>primary</c> slot is required, so <see cref="Empty"/> is purely
/// defensive). There is deliberately no loading / error / stale / offline state because the web source has none
/// (those belong to data-backed surfaces; this row only ever receives caller-composed slots).
/// </summary>
public enum HistoryListRowState
{
    /// <summary>The row has primary content and renders its slots (the web row body).</summary>
    Ready,

    /// <summary>No primary content resolved — render a friendly empty marker (never a blank panel).</summary>
    Empty,
}

/// <summary>
/// The outbound navigation seam the row drives when it carries an <c>href</c> — the native analogue of the web
/// react-router <c>&lt;Link to={href}&gt;</c> in <c>web/src/components/data-display/HistoryListRow.tsx</c>. The
/// view never touches the shell directly: activating a navigable row calls <see cref="Navigate(string)"/> with
/// the row's <c>href</c> and the host wires this to the in-app navigation (resolving the path and invoking the
/// shell). A test double records the requested target so the row's navigation behaviour is verified without a
/// shell (P1/S8 state-holder seam, mirroring <c>IQuickLinksNavigator</c>).
/// </summary>
public interface IHistoryListRowNavigator
{
    /// <summary>Navigate the shell to <paramref name="href"/> (the web row's <c>to</c> path).</summary>
    /// <param name="href">The destination route/path the row links to.</param>
    void Navigate(string href);
}

/// <summary>
/// The structural render inputs for a history row — the native port of the web <c>HistoryListRowProps</c>
/// interface (<c>web/src/components/data-display/HistoryListRow.tsx</c>), reduced to the slot-presence flags,
/// behaviour flags and identifiers the projection needs. The actual slot visuals (<c>checkbox</c>,
/// <c>leading</c>, <c>primary</c>, <c>route</c>, <c>metrics</c>, <c>insight</c>, <c>actions</c>) are
/// caller-supplied WinUI elements owned by the view; this record carries only whether each slot is populated so
/// the render decisions stay UI-thread-free and unit-testable. A record so two equal configurations project
/// identically.
/// </summary>
/// <param name="HasPrimary">Whether the required primary line is populated (web <c>primary</c>); false drives the defensive empty state.</param>
/// <param name="HasCheckbox">Whether the leading checkbox slot is populated (web <c>checkbox</c>).</param>
/// <param name="HasLeading">Whether the fixed-width leading badge slot is populated (web <c>leading</c>).</param>
/// <param name="HasRoute">Whether the second line is populated (web <c>route</c>).</param>
/// <param name="HasMetrics">Whether the metric-chips line is populated (web <c>metrics</c>).</param>
/// <param name="HasInsight">Whether the inline-insight line is populated (web <c>insight</c>).</param>
/// <param name="ActionCount">Number of hover-revealed action buttons (web <c>actions</c> length); negative values clamp to zero.</param>
/// <param name="Href">Navigation target; when set the row navigates on activation (web <c>href</c>).</param>
/// <param name="HasClickHandler">Whether the host supplied a click handler (web <c>onClick</c>); used only when <see cref="Href"/> is unset.</param>
/// <param name="Selected">Whether the row carries the selected tint (web <c>selected</c>).</param>
/// <param name="Glow">Hover glow accent (web <c>glow</c>); defaults to <see cref="HistoryListRowGlow.Cyan"/>.</param>
/// <param name="HideChevron">Whether to hide the trailing chevron (web <c>hideChevron</c>).</param>
/// <param name="AccessibleName">The row's Narrator name when activatable (the caller-composed equivalent of the web link's accessible content); empty when unset.</param>
/// <param name="TestId">Stable automation hook (web <c>testId</c>); null uses the surface default id.</param>
public sealed record HistoryListRowProps(
    bool HasPrimary = false,
    bool HasCheckbox = false,
    bool HasLeading = false,
    bool HasRoute = false,
    bool HasMetrics = false,
    bool HasInsight = false,
    int ActionCount = 0,
    string? Href = null,
    bool HasClickHandler = false,
    bool Selected = false,
    HistoryListRowGlow Glow = HistoryListRowGlow.Cyan,
    bool HideChevron = false,
    string? AccessibleName = null,
    string? TestId = null);

/// <summary>
/// Pure projection of the row's render decisions — the native port of the web component body
/// (<c>web/src/components/data-display/HistoryListRow.tsx</c>). It decides which slots render, whether the
/// hover-revealed actions and the trailing chevron show, the selected tint, the glow border brush key, and the
/// mutually-exclusive activation behaviour (navigate via <c>href</c> vs invoke the host's <c>onClick</c> vs
/// inert), plus the stable automation ids the view stamps (mirroring the web <c>data-testid={testId}</c> and
/// <c>data-testid={testId}-panel</c>). Kept a side-effect-free <see langword="readonly record struct"/> so the
/// adapter is unit-tested without a view-model or a UI thread; the <see cref="HistoryListRowViewModel"/> and the
/// WinUI view both render from it.
/// </summary>
public readonly record struct HistoryListRowProjection
{
    private HistoryListRowProjection(
        HistoryListRowState state,
        bool showCheckbox,
        bool showLeading,
        bool showRoute,
        bool showMetrics,
        bool showInsight,
        bool showActions,
        bool showChevron,
        bool isSelected,
        HistoryListRowGlow glow,
        string glowBrushKey,
        HistoryListRowActivation activation,
        string href,
        string accessibleName,
        string? automationId,
        string? panelAutomationId,
        int actionCount)
    {
        State = state;
        ShowCheckbox = showCheckbox;
        ShowLeading = showLeading;
        ShowRoute = showRoute;
        ShowMetrics = showMetrics;
        ShowInsight = showInsight;
        ShowActions = showActions;
        ShowChevron = showChevron;
        IsSelected = isSelected;
        Glow = glow;
        GlowBrushKey = glowBrushKey;
        Activation = activation;
        Href = href;
        AccessibleName = accessibleName;
        AutomationId = automationId;
        PanelAutomationId = panelAutomationId;
        ActionCount = actionCount;
    }

    /// <summary>The mutually-exclusive content state (<see cref="HistoryListRowState.Ready"/> / <see cref="HistoryListRowState.Empty"/>).</summary>
    public HistoryListRowState State { get; }

    /// <summary>Whether the primary line renders (web <c>primary</c>); true only in <see cref="HistoryListRowState.Ready"/>.</summary>
    public bool ShowPrimary => State == HistoryListRowState.Ready;

    /// <summary>Whether the leading checkbox column renders (web <c>{checkbox != null &amp;&amp; ...}</c>).</summary>
    public bool ShowCheckbox { get; }

    /// <summary>Whether the fixed-width leading badge column renders (web <c>{leading != null &amp;&amp; ...}</c>).</summary>
    public bool ShowLeading { get; }

    /// <summary>Whether the second (route) line renders (web <c>{route &amp;&amp; ...}</c>).</summary>
    public bool ShowRoute { get; }

    /// <summary>Whether the metric-chips line renders (web <c>{metrics &amp;&amp; ...}</c>).</summary>
    public bool ShowMetrics { get; }

    /// <summary>Whether the inline-insight line renders (web <c>{insight &amp;&amp; ...}</c>).</summary>
    public bool ShowInsight { get; }

    /// <summary>Whether the hover-revealed actions overlay renders (web <c>{actions &amp;&amp; actions.length &gt; 0 &amp;&amp; ...}</c>).</summary>
    public bool ShowActions { get; }

    /// <summary>Whether the trailing chevron renders (web <c>{!hideChevron &amp;&amp; ...}</c>).</summary>
    public bool ShowChevron { get; }

    /// <summary>Whether the selected tint is applied to the panel border (web <c>selected</c>).</summary>
    public bool IsSelected { get; }

    /// <summary>The resolved hover glow accent (web <c>glow</c>).</summary>
    public HistoryListRowGlow Glow { get; }

    /// <summary>The glass-panel border brush resource key for <see cref="Glow"/>.</summary>
    public string GlowBrushKey { get; }

    /// <summary>The mutually-exclusive activation behaviour (web <c>href</c> vs <c>onClick</c> vs inert).</summary>
    public HistoryListRowActivation Activation { get; }

    /// <summary>True when the row is activatable (navigable or has a click handler); drives focus/keyboard affordances.</summary>
    public bool IsInteractive => Activation != HistoryListRowActivation.None;

    /// <summary>The normalized navigation target (web <c>href</c>); empty when the row is not navigable.</summary>
    public string Href { get; }

    /// <summary>The row's Narrator name when activatable (web link accessible content); empty when unset.</summary>
    public string AccessibleName { get; }

    /// <summary>The root automation id (web <c>data-testid={testId}</c>); null falls back to the surface default.</summary>
    public string? AutomationId { get; }

    /// <summary>The panel automation id (web <c>data-testid={testId}-panel</c>); null when no test id was supplied.</summary>
    public string? PanelAutomationId { get; }

    /// <summary>The clamped (non-negative) action count (web <c>actions.length</c>).</summary>
    public int ActionCount { get; }

    /// <summary>
    /// Project the structural inputs into render decisions, reproducing the web component body's conditional
    /// branches verbatim: each slot renders when populated, the actions overlay renders when at least one action
    /// is supplied, the chevron renders unless hidden, and the activation is <see cref="HistoryListRowActivation.Navigate"/>
    /// when an <c>href</c> is present, else <see cref="HistoryListRowActivation.Invoke"/> when a click handler is
    /// present (the web mutually-exclusive <c>href</c> / <c>onClick</c> contract — <c>href</c> wins), else
    /// <see cref="HistoryListRowActivation.None"/>. An absent primary collapses to <see cref="HistoryListRowState.Empty"/>.
    /// </summary>
    /// <param name="props">The structural render inputs (the slot-presence and behaviour flags).</param>
    /// <returns>The render-ready projection.</returns>
    public static HistoryListRowProjection Project(HistoryListRowProps props)
    {
        ArgumentNullException.ThrowIfNull(props);

        string href = (props.Href ?? string.Empty).Trim();
        HistoryListRowActivation activation =
            href.Length > 0 ? HistoryListRowActivation.Navigate
            : props.HasClickHandler ? HistoryListRowActivation.Invoke
            : HistoryListRowActivation.None;

        string? automationId = string.IsNullOrEmpty(props.TestId) ? null : props.TestId;
        string? panelAutomationId = automationId is null
            ? null
            : automationId + HistoryListRowRegistration.PanelAutomationIdSuffix;

        int actionCount = props.ActionCount < 0 ? 0 : props.ActionCount;

        return new HistoryListRowProjection(
            props.HasPrimary ? HistoryListRowState.Ready : HistoryListRowState.Empty,
            props.HasCheckbox,
            props.HasLeading,
            props.HasRoute,
            props.HasMetrics,
            props.HasInsight,
            actionCount > 0,
            !props.HideChevron,
            props.Selected,
            props.Glow,
            HistoryListRowRegistration.GlowBrushKey(props.Glow),
            activation,
            href,
            props.AccessibleName ?? string.Empty,
            automationId,
            panelAutomationId,
            actionCount);
    }
}

/// <summary>
/// Canonical metadata for the HistoryListRow surface — the native mirror of the module-level constants and the
/// slot layout in <c>web/src/components/data-display/HistoryListRow.tsx</c>. The web component is anonymous
/// (it declares no <c>t()</c> calls and renders no copy of its own — every visible string lives in the
/// caller-composed slots), so this carries no i18n keys; it holds only the diagnostics slug, the automation ids
/// mirroring the web <c>data-testid</c> hooks, the chevron glyph, the per-glow border brush keys and the panel
/// geometry. UI-free so it is asserted without a XAML host.
/// </summary>
public static class HistoryListRowRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "HistoryListRow";

    /// <summary>Root automation id — the native fallback for the web <c>data-testid={testId}</c> when no test id is supplied.</summary>
    public const string RootAutomationId = "history-list-row";

    /// <summary>Suffix appended to the test id for the panel automation id (web <c>data-testid={testId}-panel</c>).</summary>
    public const string PanelAutomationIdSuffix = "-panel";

    /// <summary>Segoe Fluent chevron-right glyph (web lucide <c>ChevronRight</c> trailing icon).</summary>
    public const string ChevronGlyph = "\uE76C";

    /// <summary>The default hover glow accent (web <c>glow = 'cyan'</c>).</summary>
    public const HistoryListRowGlow DefaultGlow = HistoryListRowGlow.Cyan;

    /// <summary>Panel padding in pixels (web <c>p-3 sm:p-4</c>, the comfortable size at the <c>sm</c> breakpoint).</summary>
    public const double PanelPadding = 16;

    /// <summary>Fixed leading-column width in pixels (web <c>w-9</c> = 36px) so rows align regardless of badge content.</summary>
    public const double LeadingColumnWidth = 36;

    /// <summary>Glass-panel border brush key used for the selected tint (web <c>border-cyan-400</c>).</summary>
    public const string SelectedBorderBrushKey = "TsChartSpeedBrush";

    /// <summary>
    /// The glass-panel border brush resource key for a glow accent — the native analogue of the web
    /// <c>GlassPanel glow</c> prop mapping. Mirrors <c>TsGlassPanel</c>'s own switch so the row's accent matches
    /// the shared panel exactly.
    /// </summary>
    /// <param name="glow">The hover glow accent.</param>
    /// <returns>The brush resource key for the panel border.</returns>
    public static string GlowBrushKey(HistoryListRowGlow glow) => glow switch
    {
        HistoryListRowGlow.Cyan => "TsChartSpeedBrush",
        HistoryListRowGlow.Green => "TsChartBatteryBrush",
        HistoryListRowGlow.Purple => "TsChartPowerBrush",
        _ => "TsColorBorderBrush",
    };
}

/// <summary>
/// PII-safe diagnostics for the HistoryListRow surface (P1/S11 diagnostics contract). The row carries no copy
/// of its own (its content is caller-composed), so the collector records only the operational
/// <c>view.opened</c> event and the data-free activation event with the surface slug — never an href, a label
/// or any user data — so a diagnostics line can never leak operational data. Thread-safe.
/// </summary>
public sealed class HistoryListRowDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;
    private long _activations;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the diagnostics lines are written to, or null.</param>
    public HistoryListRowDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Number of times the row has been activated (navigated or invoked).</summary>
    public long Activations => Interlocked.Read(ref _activations);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=HistoryListRow</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={Slug}");
    }

    /// <summary>Record that the row was activated, emitting <c>history-list-row.activated slug=HistoryListRow</c>.</summary>
    public void RecordActivated()
    {
        Interlocked.Increment(ref _activations);
        _sink?.Invoke($"history-list-row.activated slug={Slug}");
    }

    private static string Slug => HistoryListRowRegistration.Slug;
}
