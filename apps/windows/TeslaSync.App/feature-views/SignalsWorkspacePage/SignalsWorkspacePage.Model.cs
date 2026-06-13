using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Threading;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews.Telemetry;

/// <summary>
/// The mutually-exclusive workspace mode — the native mirror of the web page's two boolean toggles
/// (<c>isLive</c> / <c>isCompare</c>, web/src/features/telemetry/pages/SignalsWorkspacePage.tsx). The web treats
/// Live and Compare as mutually exclusive (toggling one clears the other) and falls back to a default historical
/// view when neither is on; this enum captures that single tri-state so the projection's mode-label and the view's
/// section switch read from one source of truth.
/// </summary>
public enum SignalsWorkspaceMode
{
    /// <summary>Neither toggle on — the default catalog + historical view (web fall-through).</summary>
    Historical,

    /// <summary>The Live toggle is on — the SSE chart + tail (web <c>isLive</c>).</summary>
    Live,

    /// <summary>The Compare toggle is on — the two-snapshot diff (web <c>isCompare</c>).</summary>
    Compare,
}

/// <summary>
/// The four mandated data-states a workspace data source can be in (the prompt's
/// <c>loading → empty → error → success</c> contract). Each maps onto a visible surface — none is ever hidden
/// (engineering rule #6): <see cref="Loading"/> renders a skeleton/spinner, <see cref="Empty"/> renders an
/// <c>EmptyState</c>, <see cref="Error"/> renders an <c>InfoBar</c>/banner + retry, and <see cref="Success"/>
/// renders the resolved content.
/// </summary>
public enum SignalsWorkspaceDataState
{
    /// <summary>The query is in flight with nothing resolved yet — render the skeleton/spinner.</summary>
    Loading,

    /// <summary>The query resolved with no rows (or no vehicle) — render the friendly empty state.</summary>
    Empty,

    /// <summary>The query failed — render the failure banner + retry.</summary>
    Error,

    /// <summary>The query resolved with content — render it.</summary>
    Success,
}

/// <summary>
/// The render-time data model the <c>SignalsWorkspacePage</c> projects from — the native analogue of the web page's
/// resolved query state plus its URL-synced selection / mode (web
/// web/src/features/telemetry/pages/SignalsWorkspacePage.tsx). Pure data (no WinUI types) so the projection is
/// unit-tested without a UI host. The diff rows reuse the already-ported pure
/// <see cref="TeslaSync.App.FeatureViews.SignalDiffRow"/> so the workspace and the standalone diff surface stay in
/// lockstep.
/// </summary>
/// <param name="VehicleId">The selected vehicle id (web <c>useSelectedVehicle</c>); <c>0</c> means none selected.</param>
/// <param name="CatalogState">The catalog availability query's state (web <c>useSignals</c>).</param>
/// <param name="AvailableSignals">The available signal names (web <c>availableSignals</c>).</param>
/// <param name="SelectedSignals">The currently-selected signal names (web <c>selectedSignals</c>).</param>
/// <param name="PinnedSignals">The pinned signal names (web <c>pinnedSignals</c> derived from <c>usePinned</c>).</param>
/// <param name="Mode">The workspace mode (web <c>isLive</c> / <c>isCompare</c>).</param>
/// <param name="LiveConnected">Whether the live SSE stream is connected (web <c>live.connected</c>).</param>
/// <param name="LiveRate">The live tail rate in events/second (web <c>live.tailRate</c>).</param>
/// <param name="DiffState">The compare diff query's state (web <c>useSignalDiffServer</c>).</param>
/// <param name="DiffRows">The diff rows for the two snapshots (web <c>diffAllRows</c>).</param>
/// <param name="DiffSearch">The diff name filter (web <c>diffSearch</c>).</param>
/// <param name="WindowA">The Window-A instant, or null (web <c>atA</c>).</param>
/// <param name="WindowB">The Window-B instant, or null (web <c>atB</c>).</param>
/// <param name="HasHistorical">Whether a historical query has been run (web <c>exploreKey !== null</c>).</param>
public sealed record SignalsWorkspaceModel(
    long VehicleId,
    SignalsWorkspaceDataState CatalogState,
    IReadOnlyList<string> AvailableSignals,
    IReadOnlyList<string> SelectedSignals,
    IReadOnlySet<string> PinnedSignals,
    SignalsWorkspaceMode Mode,
    bool LiveConnected,
    int LiveRate,
    SignalsWorkspaceDataState DiffState,
    IReadOnlyList<SignalDiffRow> DiffRows,
    string DiffSearch,
    DateTimeOffset? WindowA,
    DateTimeOffset? WindowB,
    bool HasHistorical)
{
    /// <summary>The initial model — no vehicle selected, the catalog query in flight, nothing chosen.</summary>
    public static SignalsWorkspaceModel Initial { get; } = new(
        VehicleId: 0,
        CatalogState: SignalsWorkspaceDataState.Loading,
        AvailableSignals: Array.Empty<string>(),
        SelectedSignals: Array.Empty<string>(),
        PinnedSignals: new HashSet<string>(),
        Mode: SignalsWorkspaceMode.Historical,
        LiveConnected: false,
        LiveRate: 0,
        DiffState: SignalsWorkspaceDataState.Empty,
        DiffRows: Array.Empty<SignalDiffRow>(),
        DiffSearch: string.Empty,
        WindowA: null,
        WindowB: null,
        HasHistorical: false);
}

/// <summary>
/// The fully projected, render-ready view of the workspace for one input model — every visible label resolved
/// through the i18n facade, the eight headline / compare stat-card values, the per-source data-state flags and the
/// pinned-first-sorted diff rows. Pure data so every branch is asserted headlessly; the WinUI view is a thin
/// renderer that toggles section visibility from these flags.
/// </summary>
public sealed record SignalsWorkspaceDisplay
{
    /// <summary>The page title (web <c>signalsWorkspace.title</c>).</summary>
    public required string Title { get; init; }

    /// <summary>The page subtitle (web <c>signalsWorkspace.subtitle</c>).</summary>
    public required string Subtitle { get; init; }

    /// <summary>The "Share" copy-link affordance label (web <c>signalsWorkspace.share</c>).</summary>
    public required string ShareLabel { get; init; }

    /// <summary>The live connection badge text (web <c>liveMonitor.connected</c> / <c>.disconnected</c>).</summary>
    public required string LiveBadgeText { get; init; }

    /// <summary>Whether the live badge shows the connected (success) tone.</summary>
    public required bool LiveBadgeConnected { get; init; }

    /// <summary>Whether the live connection badge is shown at all (web: only while live).</summary>
    public required bool ShowLiveBadge { get; init; }

    // ── Headline stat cards ───────────────────────────────────────────────────────────────────
    public required string SelectedLabel { get; init; }
    public required string SelectedValue { get; init; }
    public required string ModeLabel { get; init; }
    public required string ModeValue { get; init; }
    public required string LiveRateLabel { get; init; }
    public required string LiveRateValue { get; init; }
    public required string PinnedLabel { get; init; }
    public required string PinnedValue { get; init; }

    // ── Add-signals accordion ─────────────────────────────────────────────────────────────────
    public required string AddSignalsLabel { get; init; }

    /// <summary>The accordion badge: "{{count}} selected" or "None selected" (web interpolation).</summary>
    public required string SignalsSelectedBadge { get; init; }

    // ── Workspace toolbar (GlassPanel5) ───────────────────────────────────────────────────────
    public required string TimeRangeLabel { get; init; }
    public required string PerPageLabel { get; init; }
    public required string RunLabel { get; init; }
    public required string LiveLabel { get; init; }
    public required string StopLiveLabel { get; init; }
    public required string CompareLabel { get; init; }
    public required string ExitCompareLabel { get; init; }
    public required string HelpLiveAria { get; init; }

    // ── Compare stat cards ────────────────────────────────────────────────────────────────────
    public required string ChangedSignalsLabel { get; init; }
    public required string ChangedSignalsValue { get; init; }
    public required string VisibleLabel { get; init; }
    public required string VisibleValue { get; init; }
    public required string DiffPinnedLabel { get; init; }
    public required string DiffPinnedValue { get; init; }
    public required string WindowSpanLabel { get; init; }
    public required string WindowSpanValue { get; init; }

    // ── Compare bulk-actions toolbar ──────────────────────────────────────────────────────────
    public required string BulkPinLabel { get; init; }
    public required string BulkUnpinLabel { get; init; }
    public required string BulkCsvLabel { get; init; }
    public required string BulkAddAlertLabel { get; init; }

    // ── Compare diff panel (GlassPanel10) ─────────────────────────────────────────────────────
    public required string NoChangesMessage { get; init; }
    public required string PinnedChipsLabel { get; init; }
    public required IReadOnlyList<string> PinnedChips { get; init; }
    public required SignalDiffDisplay DiffDisplay { get; init; }

    // ── Chart layout tabs ─────────────────────────────────────────────────────────────────────
    public required string ChartModeLabel { get; init; }
    public required string ChartAutoLabel { get; init; }
    public required string ChartOverlayLabel { get; init; }
    public required string ChartGridLabel { get; init; }

    // ── Live / historical section ─────────────────────────────────────────────────────────────
    public required string LiveTailTitle { get; init; }
    public required string HistoryTitle { get; init; }
    public required string EmptyTitle { get; init; }
    public required string EmptyDesc { get; init; }

    // ── No-vehicle empty state ────────────────────────────────────────────────────────────────
    public required string NoVehicleTitle { get; init; }
    public required string NoVehicleDesc { get; init; }

    // ── Footer ────────────────────────────────────────────────────────────────────────────────
    public required string RefreshHint { get; init; }

    // ── Error banner ──────────────────────────────────────────────────────────────────────────
    public required string ErrorLoadFailed { get; init; }
    public required bool ShowError { get; init; }

    // ── Catalog (useSignals) data-state ───────────────────────────────────────────────────────
    public required SignalsWorkspaceDataState CatalogState { get; init; }
    public bool ShowCatalogLoading => CatalogState == SignalsWorkspaceDataState.Loading;
    public bool ShowNoVehicle { get; init; }
    public bool ShowCatalogError => CatalogState == SignalsWorkspaceDataState.Error;
    public bool ShowCatalogSuccess => CatalogState == SignalsWorkspaceDataState.Success;

    // ── Diff (useSignalDiffServer) data-state ─────────────────────────────────────────────────
    public required SignalsWorkspaceDataState DiffState { get; init; }
    public bool ShowDiffLoading => DiffState == SignalsWorkspaceDataState.Loading;
    public bool ShowDiffEmpty => DiffState == SignalsWorkspaceDataState.Empty;
    public bool ShowDiffError => DiffState == SignalsWorkspaceDataState.Error;
    public bool ShowDiffRows => DiffState == SignalsWorkspaceDataState.Success;

    // ── Mode switch ───────────────────────────────────────────────────────────────────────────
    public required bool IsCompare { get; init; }
    public required bool IsLive { get; init; }

    /// <summary>True when at least two signals are selected (web gate for the chart-layout tabs).</summary>
    public required bool ShowChartModeTabs { get; init; }

    /// <summary>True when at least one signal is selected (web gate for the stats + chart panels).</summary>
    public required bool HasSelection { get; init; }

    /// <summary>True once a historical query has been run (web <c>exploreKey !== null</c>).</summary>
    public required bool HasHistorical { get; init; }

    /// <summary>True when the live SSE stats + chart + tail should render (web <c>isLive &amp;&amp; selected</c>).</summary>
    public bool ShowLiveResults => IsLive && HasSelection;

    /// <summary>True when the historical stats + chart + table should render (web <c>hasHistorical &amp;&amp; selected</c>).</summary>
    public bool ShowHistoryResults => !IsCompare && !IsLive && HasHistorical && HasSelection;

    /// <summary>
    /// True when the historical/live "pick signals and run a query" empty panel (GlassPanel11) should render —
    /// the default state before a run and outside Compare mode.
    /// </summary>
    public bool ShowHistoricalEmpty => !IsCompare && !ShowLiveResults && !ShowHistoryResults;

    /// <summary>The composed Narrator name for the whole surface (the page title).</summary>
    public required string AutomationName { get; init; }
}

/// <summary>
/// Pure projection from a <see cref="SignalsWorkspaceModel"/> to its render-ready <see cref="SignalsWorkspaceDisplay"/>
/// — the native port of the web page's render tree (web/src/features/telemetry/pages/SignalsWorkspacePage.tsx). Every
/// one of the 43 i18n keys the manifest (<c>page:telemetry/SignalsWorkspace</c>) requires is resolved here on every
/// call, regardless of mode, so the parity coverage is asserted by a single headless projection. No WinUI types.
/// </summary>
public static class SignalsWorkspaceProjection
{
    /// <summary>The em-dash the web renders for an absent stat (<c>'—'</c>).</summary>
    public const string EmDash = "\u2014";

    private const string CountToken = "{{count}}";

    /// <summary>Project the model into its render-ready display, resolving every label through <paramref name="localizer"/>.</summary>
    public static SignalsWorkspaceDisplay Project(SignalsWorkspaceModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        bool isCompare = model.Mode == SignalsWorkspaceMode.Compare;
        bool isLive = model.Mode == SignalsWorkspaceMode.Live;

        // Resolve the diff rows once (pinned-first, name filtered) reusing the standalone diff surface's pure
        // projection so the workspace and the diff component stay in lockstep.
        var diffDisplay = SignalDiffProjection.Project(
            model.DiffRows,
            model.DiffSearch,
            model.PinnedSignals,
            localizer);

        int changedCount = model.DiffRows.Count;
        int visibleCount = diffDisplay.Rows.Count;
        bool diffLoading = model.DiffState == SignalsWorkspaceDataState.Loading;

        // Pre-resolve every conditionally-rendered key unconditionally so a single Project call requests all 43
        // manifest keys (the mode label, the selection badge and the live badge each pick from these locals).
        string liveLabel = localizer.GetString("signalsWorkspace.live", "Live");
        string historicalLabel = localizer.GetString("signalsWorkspace.historical", "Historical");
        string compareLabel = localizer.GetString("signalsWorkspace.compare", "Compare");
        string connectedLabel = localizer.GetString("liveMonitor.connected", "Connected");
        string disconnectedLabel = localizer.GetString("liveMonitor.disconnected", "Disconnected");
        string signalsSelectedTemplate = localizer.GetString("signalsWorkspace.signalsSelected", "{{count}} selected");
        string noneSelectedLabel = localizer.GetString("signalsWorkspace.noneSelected", "None selected");

        string modeValue = isCompare ? compareLabel : isLive ? liveLabel : historicalLabel;

        string signalsSelectedBadge = model.SelectedSignals.Count > 0
            ? signalsSelectedTemplate.Replace(CountToken, FmtInt(model.SelectedSignals.Count), StringComparison.Ordinal)
            : noneSelectedLabel;

        // Compute the no-vehicle / empty state for the catalog: web shows the "select a vehicle" empty state when
        // vehicleId === 0, otherwise resolves loading / error / success from the useSignals query.
        bool noVehicle = model.VehicleId <= 0;
        SignalsWorkspaceDataState catalogState = noVehicle
            ? SignalsWorkspaceDataState.Empty
            : model.CatalogState;

        string title = localizer.GetString("signalsWorkspace.title", "Signals");

        return new SignalsWorkspaceDisplay
        {
            Title = title,
            Subtitle = localizer.GetString(
                "signalsWorkspace.subtitle",
                "Browse the live catalog, inspect history, monitor live, or compare snapshots \u2014 all in one place."),
            ShareLabel = localizer.GetString("signalsWorkspace.share", "Share"),
            LiveBadgeText = model.LiveConnected ? connectedLabel : disconnectedLabel,
            LiveBadgeConnected = model.LiveConnected,
            ShowLiveBadge = isLive,

            SelectedLabel = localizer.GetString("signalsWorkspace.selected", "Selected"),
            SelectedValue = FmtInt(model.SelectedSignals.Count),
            ModeLabel = localizer.GetString("signalsWorkspace.mode", "Mode"),
            ModeValue = modeValue,
            LiveRateLabel = localizer.GetString("signalsWorkspace.liveRate", "Live rate"),
            LiveRateValue = isLive
                ? string.Create(CultureInfo.CurrentCulture, $"{FmtInt(model.LiveRate)} /s")
                : EmDash,
            PinnedLabel = localizer.GetString("signalsWorkspace.pinned", "Pinned signals"),
            PinnedValue = FmtInt(model.PinnedSignals.Count),

            AddSignalsLabel = localizer.GetString("signalsWorkspace.addSignals", "Add signals"),
            SignalsSelectedBadge = signalsSelectedBadge,

            TimeRangeLabel = localizer.GetString("Time Range", "Time Range"),
            PerPageLabel = localizer.GetString("Per Page", "Per Page"),
            RunLabel = localizer.GetString("signalsWorkspace.run", "Run"),
            LiveLabel = liveLabel,
            StopLiveLabel = localizer.GetString("signalsWorkspace.stopLive", "Stop live"),
            CompareLabel = compareLabel,
            ExitCompareLabel = localizer.GetString("signalsWorkspace.exitCompare", "Exit compare"),
            HelpLiveAria = localizer.GetString("help.signal.live.aria", "More info about live and compare modes"),

            ChangedSignalsLabel = localizer.GetString("signalDiff.totalChanged", "Changed signals"),
            ChangedSignalsValue = diffLoading ? EmDash : FmtInt(changedCount),
            VisibleLabel = localizer.GetString("signalDiff.visible", "Visible after filter"),
            VisibleValue = diffLoading ? EmDash : FmtInt(visibleCount),
            DiffPinnedLabel = localizer.GetString("signalDiff.pinnedCount", "Pinned"),
            DiffPinnedValue = FmtInt(model.PinnedSignals.Count),
            WindowSpanLabel = localizer.GetString("signalDiff.windowSpan", "Window span"),
            WindowSpanValue = WindowSpan(model.WindowA, model.WindowB),

            BulkPinLabel = localizer.GetString("signalDiff.bulk.pin", "Pin selected"),
            BulkUnpinLabel = localizer.GetString("signalDiff.bulk.unpin", "Unpin selected"),
            BulkCsvLabel = localizer.GetString("signalDiff.bulk.csv", "Copy CSV"),
            BulkAddAlertLabel = localizer.GetString("signalDiff.bulk.addAlert", "Add as alert rule"),

            NoChangesMessage = localizer.GetString(
                "signalDiff.noChanges",
                "No signals changed between the two snapshots"),
            PinnedChipsLabel = localizer.GetString("signalDiff.pinnedLabel", "Pinned:"),
            PinnedChips = model.PinnedSignals.OrderBy(s => s, StringComparer.CurrentCulture).ToArray(),
            DiffDisplay = diffDisplay,

            ChartModeLabel = localizer.GetString("signalsWorkspace.chartMode", "Chart layout"),
            ChartAutoLabel = localizer.GetString("signalsWorkspace.chartAuto", "Auto"),
            ChartOverlayLabel = localizer.GetString("signalsWorkspace.chartOverlay", "Overlay"),
            ChartGridLabel = localizer.GetString("signalsWorkspace.chartGrid", "Grid"),

            LiveTailTitle = localizer.GetString("liveMonitor.title", "Live tail"),
            HistoryTitle = localizer.GetString("signalsWorkspace.historyTitle", "Signal history"),
            EmptyTitle = localizer.GetString("signalsWorkspace.emptyTitle", "Pick signals and run a query"),
            EmptyDesc = localizer.GetString(
                "signalsWorkspace.emptyDesc",
                "Pick signals from the catalog, choose a time range, then click Run for historical data \u2014 or toggle Live to stream in real time."),

            NoVehicleTitle = localizer.GetString("signalsWorkspace.noVehicle", "Select a vehicle to begin"),
            NoVehicleDesc = localizer.GetString(
                "signalsWorkspace.noVehicleDesc",
                "Pick a vehicle from the picker above to see its signals."),

            RefreshHint = localizer.GetString("signalGap.refreshInterval", "Catalog refreshes every 5s"),

            ErrorLoadFailed = localizer.GetString("error.loadFailed", "Failed to load data"),
            ShowError = !noVehicle
                && (model.CatalogState == SignalsWorkspaceDataState.Error
                    || model.DiffState == SignalsWorkspaceDataState.Error),

            CatalogState = catalogState,
            ShowNoVehicle = noVehicle,
            DiffState = model.DiffState,

            IsCompare = isCompare,
            IsLive = isLive,
            ShowChartModeTabs = model.SelectedSignals.Count >= 2,
            HasSelection = model.SelectedSignals.Count > 0,
            HasHistorical = model.HasHistorical,

            AutomationName = title,
        };
    }

    /// <summary>Format an integer with locale grouping — the native port of the web <c>fmtInt</c>.</summary>
    public static string FmtInt(long value) => value.ToString("N0", CultureInfo.CurrentCulture);

    /// <summary>
    /// The window-span cell — the native port of the web
    /// <c>{Math.abs(atB - atA) / 1000} s</c> when both windows are present, else the em-dash.
    /// </summary>
    public static string WindowSpan(DateTimeOffset? a, DateTimeOffset? b)
    {
        if (a is { } start && b is { } end)
        {
            double seconds = Math.Abs((end - start).TotalSeconds);
            return string.Create(CultureInfo.CurrentCulture, $"{seconds.ToString("0.###", CultureInfo.CurrentCulture)} s");
        }

        return EmDash;
    }
}

/// <summary>
/// Canonical registry metadata for the <c>SignalsWorkspacePage</c> surface — the stable navigation route name (so
/// the shell page factory binds <c>/signals</c> to this view), the diagnostics slug, and the four generated OpenAPI
/// operation ids backing the web hooks it composes (<c>useSignals</c> / <c>useSignalDiffServer</c> / <c>usePinned</c>
/// / <c>useTogglePin</c>). Centralised so the view, view-model and feed stay free of literal identifiers.
/// </summary>
public static class SignalsWorkspaceRegistration
{
    /// <summary>The navigation route name (matches RouteTable.cs <c>Page("SignalsWorkspace","signals",…)</c>).</summary>
    public const string RouteName = "SignalsWorkspace";

    /// <summary>The diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "SignalsWorkspacePage";

    /// <summary>The available-signals catalog read (web <c>useSignals</c> → GET /signals/{vehicleID}/available).</summary>
    public const string AvailableOperation = "get_api_v1_signals_vehicleID_available";

    /// <summary>The two-snapshot diff read (web <c>useSignalDiffServer</c> → GET /signals/{vehicleID}/diff).</summary>
    public const string DiffOperation = "get_api_v1_signals_vehicleID_diff";

    /// <summary>The pinned-items list read (web <c>usePinned</c> → GET /pinned).</summary>
    public const string PinnedListOperation = "get_api_v1_pinned";

    /// <summary>The pin-create write (web <c>useTogglePin</c> pin → POST /pinned).</summary>
    public const string PinCreateOperation = "post_api_v1_pinned";

    /// <summary>The pin-delete write (web <c>useTogglePin</c> unpin → DELETE /pinned/{id}).</summary>
    public const string PinDeleteOperation = "delete_api_v1_pinned_id";

    /// <summary>The pinned-item type the workspace pins under (web <c>useTogglePin('widget')</c>).</summary>
    public const string PinType = "widget";

    /// <summary>The pinned-item id prefix the workspace stores signals under (web <c>signal:{name}</c>).</summary>
    public const string SignalItemPrefix = "signal:";

    /// <summary>The pin context for one vehicle (web <c>signal-diff:vehicle:{vehicleId}</c>).</summary>
    public static string PinContext(long vehicleId) =>
        string.Create(CultureInfo.InvariantCulture, $"signal-diff:vehicle:{vehicleId}");
}

/// <summary>
/// PII-safe diagnostics for the <c>SignalsWorkspacePage</c> surface (P1/S11). Records only the operational
/// <c>view.opened</c> event with the surface slug — never a signal name, value or vehicle id — so a diagnostics line
/// can never leak which vehicle or telemetry value was involved. Thread-safe.
/// </summary>
public sealed class SignalsWorkspaceDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public SignalsWorkspaceDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=SignalsWorkspacePage</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={SignalsWorkspaceRegistration.Slug}");
    }
}
