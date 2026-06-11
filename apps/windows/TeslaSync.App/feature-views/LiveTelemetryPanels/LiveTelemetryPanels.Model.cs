using System.Globalization;
using TeslaSync.App.Core;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.FeatureViews;

// ── Input model (the web component's live-connection inputs) ─────────────────────────────────────────────
// web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx is a *presentational*
// composition: it receives the six telemetry-data props plus `live`, `sseConnected` and `remoteStartEnabled`
// from its parent page and renders the "Live Telemetry" header above a staggered grid of seven child panels.
// The seven children (Powertrain / Climate / Security / VehicleState / TirePressure / EnergyCharging /
// MediaNavigation) are *separate* surfaces, each with its own prompt (W-0278/0279/0282/0283/0284/0286/0287);
// the native view composes them via injection and never owns their data. What this composition *does* own is
// the live-connection lifecycle the web received via `sseConnected` (+ data freshness): that is the single
// signal that drives the header's live indicator and the surface-level loading / loaded / empty / error /
// stale / offline states the P2 contract requires. Pure data — no WinUI types — so the projection is
// unit-tested without a UI host.

/// <summary>
/// The live-connection lifecycle the host's shared P1/S8 state-holder resolves for the composition — the
/// native analogue of the web <c>sseConnected</c> prop combined with the freshness of the live telemetry that
/// feeds the seven child panels. The host maps its SSE / cache-then-network state onto one of these; the
/// projection folds it (with <see cref="LiveTelemetryPanelsModel.HasContent"/>) into the surface state.
/// </summary>
public enum LiveTelemetryConnection
{
    /// <summary>Establishing the live stream — no snapshot has arrived yet.</summary>
    Connecting,

    /// <summary>Connected and fresh — the green pulsing "Live" indicator.</summary>
    Live,

    /// <summary>Connected (or cached) but older than the freshness window — a "Stale" chip.</summary>
    Stale,

    /// <summary>Disconnected while a cached snapshot remains — an "Offline" chip over cached panels.</summary>
    Offline,

    /// <summary>The live stream failed — the retry surface when nothing is cached.</summary>
    Failed,
}

/// <summary>
/// The mutually-exclusive surface state the view renders — the native union of the loading / loaded / empty /
/// error / stale / offline branches the P2 surface contract requires. The web composition is always rendered
/// (each child owns its own per-panel skeleton); the native surface additionally reflects the live-connection
/// lifecycle in a single visible state so none is ever hidden.
/// </summary>
public enum LiveTelemetryPanelsState
{
    /// <summary>Connecting with nothing yet to show — the skeleton grid chrome.</summary>
    Loading,

    /// <summary>Live (or connecting with cached content) — the staggered panel grid.</summary>
    Loaded,

    /// <summary>Resolved with no vehicle / no panels to show — a friendly empty surface.</summary>
    Empty,

    /// <summary>The live stream failed and nothing is cached — a retry surface.</summary>
    Error,

    /// <summary>Cached content older than the freshness window — the grid plus a stale chip.</summary>
    Stale,

    /// <summary>Disconnected with cached content — the grid plus an offline chip.</summary>
    Offline,
}

/// <summary>
/// The seven composed child panels in the exact web order (the order the
/// <c>LiveTelemetryPanels</c> JSX renders them, with their staggered <c>FadeIn</c> delays). Each is a separate
/// native surface with its own prompt; this composition only positions them.
/// </summary>
public enum TelemetryPanelSlot
{
    /// <summary>web <c>PowertrainPanel</c> (FadeIn delay 0.14).</summary>
    Powertrain,

    /// <summary>web <c>ClimatePanel</c> (FadeIn delay 0.16).</summary>
    Climate,

    /// <summary>web <c>SecurityPanel</c> (FadeIn delay 0.18).</summary>
    Security,

    /// <summary>web <c>VehicleStatePanel</c> (FadeIn delay 0.19).</summary>
    VehicleState,

    /// <summary>web <c>TirePressurePanel</c> (FadeIn delay 0.20).</summary>
    TirePressure,

    /// <summary>web <c>EnergyChargingPanel</c> (FadeIn delay 0.22).</summary>
    EnergyCharging,

    /// <summary>web <c>MediaNavigationPanel</c> (FadeIn delay 0.24).</summary>
    MediaNavigation,
}

/// <summary>The kind of header live indicator shown for the current state.</summary>
public enum LiveIndicatorKind
{
    /// <summary>Live and fresh — pulsing success dot (web <c>animate-ping</c> green).</summary>
    Live,

    /// <summary>Establishing the stream — pulsing dot, no chip.</summary>
    Connecting,

    /// <summary>Stale — warning dot plus a stale chip.</summary>
    Stale,

    /// <summary>Offline — danger dot plus an offline chip.</summary>
    Offline,

    /// <summary>Idle (empty / error) — a muted, non-pulsing dot.</summary>
    Idle,
}

/// <summary>
/// The render-time model the <c>LiveTelemetryPanels</c> view binds to — the live-connection inputs the web
/// component received via props (the parent owns the per-panel queries). <see cref="HasContent"/> is the
/// native analogue of "a vehicle is selected and at least one live panel can be shown" (web always renders
/// seven children); a false value with a resolved connection yields the empty surface. Pure data so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Connection">The live-connection lifecycle resolved by the host's shared state-holder.</param>
/// <param name="HasContent">Whether the host has live panels / a snapshot to show (false → empty surface).</param>
/// <param name="SseConnected">The web <c>sseConnected</c> prop (the host forwards it to the VehicleState panel).</param>
/// <param name="RemoteStartEnabled">The web <c>remoteStartEnabled</c> prop (forwarded to the Security panel).</param>
/// <param name="UpdatedAt">Timestamp of the last live update (surfaced by the freshness chip).</param>
public sealed record LiveTelemetryPanelsModel(
    LiveTelemetryConnection Connection,
    bool HasContent,
    bool SseConnected,
    bool RemoteStartEnabled,
    DateTimeOffset? UpdatedAt)
{
    /// <summary>The initial model: the live stream is still connecting and nothing is shown yet.</summary>
    public static LiveTelemetryPanelsModel Pending { get; } =
        new(LiveTelemetryConnection.Connecting, false, false, false, null);
}

/// <summary>
/// The projected header live indicator — the native analogue of the web's pulsing green dot, plus the
/// stale / offline freshness chips the native surface adds. <see cref="Pulsing"/> is honoured only when the
/// OS reduce-motion setting allows it; <see cref="Tone"/> drives the dot colour; <see cref="ShowChip"/> gates
/// the trailing freshness chip; <see cref="Text"/> is the localized indicator / chip label (empty for the
/// idle dot).
/// </summary>
public sealed record LiveIndicatorDisplay(
    LiveIndicatorKind Kind,
    bool Pulsing,
    StatusKind Tone,
    bool ShowChip,
    string Text);

/// <summary>
/// One projected panel slot — its stable <see cref="Slot"/>, localized <see cref="Title"/> (shown on the
/// loading skeleton and used for the Narrator name), the Segoe Fluent <see cref="Glyph"/> mirroring the web
/// lucide icon, the staggered <see cref="FadeInDelayMs"/> (the web <c>FadeIn delay</c> × 1000) and the
/// <see cref="LoadingAutomationName"/> announced while the slot awaits its child surface. Pure data.
/// </summary>
public sealed record TelemetryPanelSlotDisplay(
    TelemetryPanelSlot Slot,
    string Title,
    string Glyph,
    int FadeInDelayMs,
    string LoadingAutomationName);

/// <summary>
/// The fully projected, render-ready view of the surface — the native analogue of everything the web
/// <c>LiveTelemetryPanels</c> computes before returning JSX: the section <see cref="Title"/> + its
/// <see cref="HeaderDelayMs"/> entrance, the resolved <see cref="State"/>, the header <see cref="Indicator"/>,
/// whether the panel grid is shown (<see cref="ShowGrid"/>) versus a single state surface, the seven
/// <see cref="Panels"/> slot descriptors in web order, the localized empty / error / loading / retry copy and
/// the surface <see cref="AutomationName"/>. Pure data so every state is asserted headlessly.
/// </summary>
public sealed record LiveTelemetryPanelsDisplay(
    string Title,
    int HeaderDelayMs,
    LiveTelemetryPanelsState State,
    LiveIndicatorDisplay Indicator,
    bool ShowGrid,
    IReadOnlyList<TelemetryPanelSlotDisplay> Panels,
    string EmptyMessage,
    string ErrorMessage,
    string LoadingLabel,
    string RetryLabel,
    string AutomationName);

/// <summary>
/// Pure projection from a <see cref="LiveTelemetryPanelsModel"/> to its <see cref="LiveTelemetryPanelsDisplay"/>
/// — the native port of <c>web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx</c>.
/// It reproduces the web header ("Live Telemetry" with its pulsing live dot), the seven child slots in web
/// order with their exact staggered <c>FadeIn</c> delays, and folds the live-connection lifecycle into the
/// loading / loaded / empty / error / stale / offline state the P2 contract requires. Every label resolves
/// through the i18n facade (the title via the web's <c>common.liveTelemetry</c> key; the slot titles via the
/// child panels' own title keys). No WinUI types — unit-tested without a XAML host.
/// </summary>
public static class LiveTelemetryPanelsProjection
{
    /// <summary>web <c>FadeIn delay={0.12}</c> on the section header.</summary>
    public const int HeaderDelayMs = 120;

    // Per-slot staggered entrance delays — the web FadeIn delays (×1000), in render order.
    private const int PowertrainDelayMs = 140;       // web 0.14
    private const int ClimateDelayMs = 160;          // web 0.16
    private const int SecurityDelayMs = 180;         // web 0.18
    private const int VehicleStateDelayMs = 190;     // web 0.19
    private const int TirePressureDelayMs = 200;     // web 0.20
    private const int EnergyChargingDelayMs = 220;   // web 0.22
    private const int MediaNavigationDelayMs = 240;  // web 0.24

    // Segoe Fluent glyphs mirroring the web lucide icons on each child panel header.
    private const string PowertrainGlyph = "\uE713";      // web Cog
    private const string ClimateGlyph = "\uE9CA";         // web Thermometer
    private const string SecurityGlyph = "\uEA18";        // web Shield
    private const string VehicleStateGlyph = "\uE9D9";    // web Activity (gauge/pulse)
    private const string TirePressureGlyph = "\uE91F";    // web CircleDot
    private const string EnergyChargingGlyph = "\uE945";  // web Zap
    private const string MediaNavigationGlyph = "\uE767"; // web Headphones

    /// <summary>Project <paramref name="model"/> into a render-ready display using the i18n facade.</summary>
    /// <param name="model">The live-connection render model the host assigns from its state-holders.</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static LiveTelemetryPanelsDisplay Project(LiveTelemetryPanelsModel model, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(localizer);

        string title = localizer.GetString("common.liveTelemetry", "Live Telemetry");
        string loadingLabel = localizer.GetString("common.loading", "Loading\u2026");
        string retryLabel = localizer.GetString("common.retry", "Retry");
        string emptyMessage = localizer.GetString("telemetry.noLiveData", "No live telemetry available");
        string errorMessage = localizer.GetString("telemetry.liveError", "Couldn't load live telemetry");

        LiveTelemetryPanelsState state = ResolveState(model.Connection, model.HasContent);
        LiveIndicatorDisplay indicator = ProjectIndicator(state, localizer);
        TelemetryPanelSlotDisplay[] panels = ProjectPanels(loadingLabel, localizer);
        bool showGrid = ShowsGrid(state);

        string automationName = string.Create(
            CultureInfo.CurrentCulture,
            $"{title}. {StateSummary(state, indicator, emptyMessage, errorMessage)}");

        return new LiveTelemetryPanelsDisplay(
            Title: title,
            HeaderDelayMs: HeaderDelayMs,
            State: state,
            Indicator: indicator,
            ShowGrid: showGrid,
            Panels: panels,
            EmptyMessage: emptyMessage,
            ErrorMessage: errorMessage,
            LoadingLabel: loadingLabel,
            RetryLabel: retryLabel,
            AutomationName: automationName);
    }

    /// <summary>
    /// Fold the live-connection lifecycle and content presence into the single visible surface state. With no
    /// content the connection drives loading / error / empty; with content it drives loaded / stale / offline.
    /// </summary>
    public static LiveTelemetryPanelsState ResolveState(LiveTelemetryConnection connection, bool hasContent)
    {
        if (!hasContent)
        {
            return connection switch
            {
                LiveTelemetryConnection.Connecting => LiveTelemetryPanelsState.Loading,
                LiveTelemetryConnection.Failed => LiveTelemetryPanelsState.Error,
                LiveTelemetryConnection.Offline => LiveTelemetryPanelsState.Error,
                _ => LiveTelemetryPanelsState.Empty,
            };
        }

        return connection switch
        {
            LiveTelemetryConnection.Stale => LiveTelemetryPanelsState.Stale,
            LiveTelemetryConnection.Offline => LiveTelemetryPanelsState.Offline,
            LiveTelemetryConnection.Failed => LiveTelemetryPanelsState.Offline,
            _ => LiveTelemetryPanelsState.Loaded,
        };
    }

    /// <summary>The panel grid is shown for every state that has (or is awaiting) panels; empty / error show a state surface.</summary>
    private static bool ShowsGrid(LiveTelemetryPanelsState state) => state is
        LiveTelemetryPanelsState.Loading or
        LiveTelemetryPanelsState.Loaded or
        LiveTelemetryPanelsState.Stale or
        LiveTelemetryPanelsState.Offline;

    private static LiveIndicatorDisplay ProjectIndicator(LiveTelemetryPanelsState state, ILocalizer localizer) => state switch
    {
        LiveTelemetryPanelsState.Loaded => new LiveIndicatorDisplay(
            LiveIndicatorKind.Live, Pulsing: true, StatusKind.Success, ShowChip: false,
            localizer.GetString("common.live", "Live")),
        LiveTelemetryPanelsState.Loading => new LiveIndicatorDisplay(
            LiveIndicatorKind.Connecting, Pulsing: true, StatusKind.Success, ShowChip: false,
            localizer.GetString("common.connecting", "Connecting")),
        LiveTelemetryPanelsState.Stale => new LiveIndicatorDisplay(
            LiveIndicatorKind.Stale, Pulsing: false, StatusKind.Warning, ShowChip: true,
            localizer.GetString("common.stale", "Stale")),
        LiveTelemetryPanelsState.Offline => new LiveIndicatorDisplay(
            LiveIndicatorKind.Offline, Pulsing: false, StatusKind.Danger, ShowChip: true,
            localizer.GetString("common.offline", "Offline")),
        _ => new LiveIndicatorDisplay(
            LiveIndicatorKind.Idle, Pulsing: false, StatusKind.Neutral, ShowChip: false, string.Empty),
    };

    private static TelemetryPanelSlotDisplay[] ProjectPanels(string loadingLabel, ILocalizer localizer) => new[]
    {
        Slot(TelemetryPanelSlot.Powertrain, localizer.GetString("common.powertrain", "Powertrain"),
            PowertrainGlyph, PowertrainDelayMs, loadingLabel),
        Slot(TelemetryPanelSlot.Climate, localizer.GetString("common.climate", "Climate"),
            ClimateGlyph, ClimateDelayMs, loadingLabel),
        Slot(TelemetryPanelSlot.Security, localizer.GetString("common.security", "Security"),
            SecurityGlyph, SecurityDelayMs, loadingLabel),
        Slot(TelemetryPanelSlot.VehicleState, localizer.GetString("telemetry.vehicleState", "Vehicle State"),
            VehicleStateGlyph, VehicleStateDelayMs, loadingLabel),
        Slot(TelemetryPanelSlot.TirePressure, localizer.GetString("common.tirePressure", "Tire Pressure"),
            TirePressureGlyph, TirePressureDelayMs, loadingLabel),
        Slot(TelemetryPanelSlot.EnergyCharging, localizer.GetString("telemetry.energyCharging", "Energy & Charging"),
            EnergyChargingGlyph, EnergyChargingDelayMs, loadingLabel),
        Slot(TelemetryPanelSlot.MediaNavigation, localizer.GetString("telemetry.mediaNav", "Media & Navigation"),
            MediaNavigationGlyph, MediaNavigationDelayMs, loadingLabel),
    };

    private static TelemetryPanelSlotDisplay Slot(
        TelemetryPanelSlot slot, string title, string glyph, int delayMs, string loadingLabel) =>
        new(slot, title, glyph, delayMs,
            string.Create(CultureInfo.CurrentCulture, $"{title}. {loadingLabel}"));

    private static string StateSummary(
        LiveTelemetryPanelsState state,
        LiveIndicatorDisplay indicator,
        string emptyMessage,
        string errorMessage) => state switch
        {
            LiveTelemetryPanelsState.Empty => emptyMessage,
            LiveTelemetryPanelsState.Error => errorMessage,
            _ => indicator.Text,
        };
}

/// <summary>
/// PII-safe diagnostics for the <c>LiveTelemetryPanels</c> surface (P1/S11 diagnostics contract). Records only
/// the operational <c>view.opened</c> event with the surface slug — never a live signal value, VIN or vehicle
/// id — so a diagnostics line can never leak fleet or owner-presence data. Thread-safe.
/// </summary>
public sealed class LiveTelemetryPanelsDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    public LiveTelemetryPanelsDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=LiveTelemetryPanels</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={LiveTelemetryPanelsRegistration.Slug}");
    }
}

/// <summary>
/// Canonical metadata for the <c>LiveTelemetryPanels</c> feature surface — the native mirror of the web
/// component at <c>web/src/features/vehicles/components/telemetry-panels/LiveTelemetryPanels.tsx</c>.
/// </summary>
public static class LiveTelemetryPanelsRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event.</summary>
    public const string Slug = "LiveTelemetryPanels";
}
