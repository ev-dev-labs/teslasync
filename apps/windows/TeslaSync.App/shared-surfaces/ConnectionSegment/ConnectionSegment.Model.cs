using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The coarse API-connection health bucket — the native analogue of the web
/// <c>ApiHealthStatus = 'ok' | 'degraded' | 'offline' | 'unknown'</c> union
/// (web/src/api/hooks/useApiHealth.ts L22). The tiers are chosen so the footer indicator turns amber
/// before something is truly broken:
/// <list type="bullet">
///   <item><see cref="Ok"/> — a 2xx <c>/healthz</c> response in under 500&#160;ms.</item>
///   <item><see cref="Degraded"/> — a 2xx response at or above 500&#160;ms (the server is up but slow).</item>
///   <item><see cref="Offline"/> — a non-2xx response, a network error, or no response within the 5&#160;s probe timeout.</item>
///   <item><see cref="Unknown"/> — the probe has not completed even once yet (the web initial / loading state).</item>
/// </list>
/// </summary>
public enum ApiHealthStatus
{
    /// <summary>2xx in under 500&#160;ms (web <c>'ok'</c>).</summary>
    Ok,

    /// <summary>2xx at or above 500&#160;ms — up but slow (web <c>'degraded'</c>).</summary>
    Degraded,

    /// <summary>Non-2xx, network error, or probe timeout (web <c>'offline'</c>).</summary>
    Offline,

    /// <summary>The probe has not completed once yet — the loading / initial state (web <c>'unknown'</c>).</summary>
    Unknown,
}

/// <summary>
/// One raw <c>/healthz</c> probe outcome — the native analogue of the web <c>ProbeResult</c>
/// (web/src/api/hooks/useApiHealth.ts L33): whether the response was 2xx (<see cref="Ok"/>), the measured
/// round-trip in milliseconds (<see cref="LatencyMs"/>) and the wall-clock time the probe completed
/// (<see cref="CheckedAt"/>). Pure data — no WinUI types — so the bucketing is unit-tested without a UI host.
/// </summary>
/// <param name="Ok">Whether the response was 2xx (web <c>res.ok</c>).</param>
/// <param name="LatencyMs">The measured round-trip in milliseconds (web <c>latencyMs</c>).</param>
/// <param name="CheckedAt">The time the probe completed (web <c>checkedAt</c>).</param>
public sealed record ApiHealthProbeResult(bool Ok, int LatencyMs, DateTimeOffset CheckedAt);

/// <summary>
/// One immutable read of the API-connection health — the native analogue of the web <c>ApiHealthState</c>
/// the <c>useApiHealth()</c> hook returns (web/src/api/hooks/useApiHealth.ts L24): the coarse
/// <see cref="Status"/>, the most recent measured round-trip (<see cref="LatencyMs"/>, null until the first
/// successful measurement) and the time of the last completed probe (<see cref="LastCheckedAt"/>). Pure data —
/// no WinUI types — so the projection is unit-tested without a UI host.
/// </summary>
/// <param name="Status">The coarse health bucket (web <c>status</c>).</param>
/// <param name="LatencyMs">The most recent measured round-trip in milliseconds, or null (web <c>latencyMs</c>).</param>
/// <param name="LastCheckedAt">The time of the last completed probe, or null (web <c>lastCheckedAt</c>).</param>
public sealed record ApiHealthSnapshot(ApiHealthStatus Status, int? LatencyMs, DateTimeOffset? LastCheckedAt)
{
    /// <summary>
    /// The pre-first-probe default — unknown health with no measurement (web <c>!data</c> return:
    /// <c>{ status: 'unknown', latencyMs: null, lastCheckedAt: null }</c>, useApiHealth.ts L95-L97).
    /// </summary>
    public static ApiHealthSnapshot Unknown { get; } = new(ApiHealthStatus.Unknown, null, null);

    /// <summary>
    /// Derive a snapshot from a raw probe result — the native equivalent of the web hook mapping its
    /// <c>useQuery</c> data into <c>{ status: bucket(data), latencyMs, lastCheckedAt }</c>
    /// (useApiHealth.ts L98-L102). The status is bucketed via <see cref="ConnectionSegmentRegistration.Bucket"/>.
    /// </summary>
    /// <param name="result">The raw probe outcome to project.</param>
    public static ApiHealthSnapshot FromProbe(ApiHealthProbeResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        return new ApiHealthSnapshot(
            ConnectionSegmentRegistration.Bucket(result),
            result.LatencyMs,
            result.CheckedAt);
    }
}

/// <summary>
/// Canonical metadata for the ConnectionSegment surface — the native analogue of the module-level <c>cfg</c> /
/// <c>stateLabel</c> tables, the <c>bucket()</c> thresholds and the default <c>t()</c> calls in
/// web/src/components/layout/status-bar/ConnectionSegment.tsx and web/src/api/hooks/useApiHealth.ts. Carries the
/// diagnostics slug, the automation id, the navigation target the web <c>&lt;Link to="/system-status"&gt;</c>
/// points at, the latency / timeout / poll constants, the lowercase status tokens the web <c>status</c> union
/// uses, the Segoe Fluent glyphs standing in for the web Lucide icons (Activity / AlertTriangle / CircleSlash /
/// HelpCircle), the generated design-token brush keys (success / warning / danger / muted) and the i18n keys
/// (each with the English fallback the web source renders verbatim). UI-free so it is asserted in tests.
/// </summary>
public static class ConnectionSegmentRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ConnectionSegment";

    /// <summary>The root automation id Narrator and UI-automation resolve the surface by.</summary>
    public const string RootAutomationId = "connection-segment";

    /// <summary>
    /// The route the segment navigates to when invoked — the native port of the web
    /// <c>&lt;Link to="/system-status"&gt;</c> (the RouteTable <c>SystemStatus</c> path pattern, no leading slash).
    /// </summary>
    public const string NavigationTarget = "system-status";

    /// <summary>The latency at or above which a healthy probe is reported as degraded (web <c>&gt;= 500</c>).</summary>
    public const int DegradedLatencyMs = 500;

    /// <summary>The per-probe timeout, after which the probe is treated as offline (web <c>PROBE_TIMEOUT_MS</c>).</summary>
    public const int ProbeTimeoutMs = 5_000;

    /// <summary>The poll cadence between probes (web <c>POLL_INTERVAL_MS</c>).</summary>
    public const int PollIntervalMs = 15_000;

    /// <summary>The middle dot separating the label from the latency / state suffix (web <c>'· '</c>).</summary>
    public const string MiddleDot = "\u00B7";

    /// <summary>The em dash shown when no latency has been measured (web <c>latencyMs != null ? … : '—'</c>).</summary>
    public const string EmDash = "\u2014";

    /// <summary>Segoe Fluent "Health" glyph — the native stand-in for the web Lucide <c>Activity</c> icon (ok).</summary>
    public const string OkGlyph = "\uE950";

    /// <summary>Segoe Fluent "Warning" glyph — the native stand-in for the web Lucide <c>AlertTriangle</c> icon (degraded).</summary>
    public const string DegradedGlyph = "\uE7BA";

    /// <summary>Segoe Fluent "ErrorBadge" glyph — the native stand-in for the web Lucide <c>CircleSlash</c> icon (offline).</summary>
    public const string OfflineGlyph = "\uEA39";

    /// <summary>Segoe Fluent "Help" glyph — the native stand-in for the web Lucide <c>HelpCircle</c> icon (unknown).</summary>
    public const string UnknownGlyph = "\uE897";

    /// <summary>i18n key for the short "API" label (web <c>t('statusBar.connection.short', 'API')</c>).</summary>
    public const string ShortKey = "translation.statusBar.connection.short";

    /// <summary>English fallback for <see cref="ShortKey"/> — the web literal.</summary>
    public const string ShortFallback = "API";

    /// <summary>i18n key for the ok state label (web <c>t('statusBar.connection.ok', 'Online')</c>).</summary>
    public const string OkKey = "translation.statusBar.connection.ok";

    /// <summary>English fallback for <see cref="OkKey"/> — the web literal.</summary>
    public const string OkFallback = "Online";

    /// <summary>i18n key for the degraded state label (web <c>t('statusBar.connection.degraded', 'Degraded')</c>).</summary>
    public const string DegradedKey = "translation.statusBar.connection.degraded";

    /// <summary>English fallback for <see cref="DegradedKey"/> — the web literal.</summary>
    public const string DegradedFallback = "Degraded";

    /// <summary>i18n key for the offline state label (web <c>t('statusBar.connection.offline', 'Offline')</c>).</summary>
    public const string OfflineKey = "translation.statusBar.connection.offline";

    /// <summary>English fallback for <see cref="OfflineKey"/> — the web literal.</summary>
    public const string OfflineFallback = "Offline";

    /// <summary>i18n key for the unknown state label (web <c>t('statusBar.connection.unknown', 'Connecting…')</c>).</summary>
    public const string UnknownKey = "translation.statusBar.connection.unknown";

    /// <summary>English fallback for <see cref="UnknownKey"/> — the web literal (trailing ellipsis).</summary>
    public const string UnknownFallback = "Connecting\u2026";

    /// <summary>i18n key for the tooltip prefix (web <c>t('statusBar.connection.tooltip', 'API connection')</c>).</summary>
    public const string TooltipKey = "translation.statusBar.connection.tooltip";

    /// <summary>English fallback for <see cref="TooltipKey"/> — the web literal.</summary>
    public const string TooltipFallback = "API connection";

    /// <summary>i18n key for the accessible-name prefix (web <c>t('statusBar.connection.aria', 'API connection status')</c>).</summary>
    public const string AriaKey = "translation.statusBar.connection.aria";

    /// <summary>English fallback for <see cref="AriaKey"/> — the web literal.</summary>
    public const string AriaFallback = "API connection status";

    /// <summary>
    /// Bucket a raw probe result into the coarse <see cref="ApiHealthStatus"/> — a 1:1 port of the web
    /// <c>bucket()</c> (useApiHealth.ts L79-L83): a failed probe is offline, a slow (≥ 500&#160;ms) success is
    /// degraded, and a fast success is ok.
    /// </summary>
    /// <param name="result">The raw probe outcome.</param>
    public static ApiHealthStatus Bucket(ApiHealthProbeResult result)
    {
        ArgumentNullException.ThrowIfNull(result);
        if (!result.Ok)
        {
            return ApiHealthStatus.Offline;
        }

        return result.LatencyMs >= DegradedLatencyMs ? ApiHealthStatus.Degraded : ApiHealthStatus.Ok;
    }

    /// <summary>The lowercase status token the web <c>status</c> union uses: ok / degraded / offline / unknown.</summary>
    public static string StatusToken(ApiHealthStatus status) => status switch
    {
        ApiHealthStatus.Ok => "ok",
        ApiHealthStatus.Degraded => "degraded",
        ApiHealthStatus.Offline => "offline",
        _ => "unknown",
    };

    /// <summary>The Segoe Fluent glyph the <paramref name="status"/> shows (web Lucide Activity / AlertTriangle / CircleSlash / HelpCircle).</summary>
    public static string Glyph(ApiHealthStatus status) => status switch
    {
        ApiHealthStatus.Ok => OkGlyph,
        ApiHealthStatus.Degraded => DegradedGlyph,
        ApiHealthStatus.Offline => OfflineGlyph,
        _ => UnknownGlyph,
    };

    /// <summary>
    /// The generated design-token brush key the dot, icon and label tint from — the native port of the web
    /// <c>cfg[status].text</c> / <c>dot</c> (emerald / amber / rose / muted).
    /// </summary>
    public static string AccentBrushKey(ApiHealthStatus status) => status switch
    {
        ApiHealthStatus.Ok => "TsColorSuccessBrush",
        ApiHealthStatus.Degraded => "TsColorWarningBrush",
        ApiHealthStatus.Offline => "TsColorDangerBrush",
        _ => "TsColorTextMutedBrush",
    };

    /// <summary>The i18n key and English fallback for the <paramref name="status"/> state label (web <c>stateLabel[status]</c>).</summary>
    public static (string Key, string Fallback) StateLabelKey(ApiHealthStatus status) => status switch
    {
        ApiHealthStatus.Ok => (OkKey, OkFallback),
        ApiHealthStatus.Degraded => (DegradedKey, DegradedFallback),
        ApiHealthStatus.Offline => (OfflineKey, OfflineFallback),
        _ => (UnknownKey, UnknownFallback),
    };

    /// <summary>Resolve the localized state label for <paramref name="status"/> through the i18n facade (web <c>stateLabel[status]</c>).</summary>
    /// <param name="status">The coarse health bucket.</param>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string StateLabel(ApiHealthStatus status, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        var (key, fallback) = StateLabelKey(status);
        return localizer.GetString(key, fallback);
    }

    /// <summary>Resolve the localized short "API" label (web <c>cfg[status].short</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string ShortLabel(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(ShortKey, ShortFallback);
    }

    /// <summary>Resolve the localized tooltip prefix (web <c>t('statusBar.connection.tooltip', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string TooltipPrefix(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(TooltipKey, TooltipFallback);
    }

    /// <summary>Resolve the localized accessible-name prefix (web <c>t('statusBar.connection.aria', …)</c>).</summary>
    /// <param name="localizer">The i18n facade the label resolves through.</param>
    public static string AriaPrefix(ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);
        return localizer.GetString(AriaKey, AriaFallback);
    }
}

/// <summary>
/// The fully projected, render-ready view of an <see cref="ApiHealthSnapshot"/> for a given <c>iconOnly</c>
/// mode — everything the web component derives before returning JSX
/// (web/src/components/layout/status-bar/ConnectionSegment.tsx L29-L86): the resolved <see cref="Status"/> and its
/// lowercase <see cref="StatusToken"/>, the generated design-token <see cref="AccentBrushKey"/> the dot / icon /
/// label tint from, the Segoe Fluent <see cref="IconGlyph"/>, the localized <see cref="ShortLabel"/> ("API") and
/// <see cref="StateLabel"/> (Online / Degraded / Offline / Connecting…), the <see cref="LatencyLabel"/>
/// ("{n}ms" or "—"), which sub-elements the mode draws (<see cref="ShowShortLabel"/> /
/// <see cref="ShowLatencySuffix"/> / <see cref="ShowOfflineSuffix"/>) with their composed suffix text, the
/// hover <see cref="TooltipText"/> (web <c>&lt;Tooltip content&gt;</c>), the accessible <see cref="AutomationName"/>
/// (web <c>aria-label</c>) and the <see cref="NavigationTarget"/> the link points at. Pure value type so every
/// field is asserted headlessly.
/// </summary>
public readonly record struct ConnectionSegmentProjection
{
    private ConnectionSegmentProjection(
        ApiHealthStatus status,
        bool iconOnly,
        string accentBrushKey,
        string iconGlyph,
        string shortLabel,
        string stateLabel,
        int? latencyMs,
        string latencyLabel,
        bool showLatencySuffix,
        bool showOfflineSuffix,
        string latencySuffixText,
        string offlineSuffixText,
        string tooltipText,
        string automationName)
    {
        Status = status;
        IconOnly = iconOnly;
        AccentBrushKey = accentBrushKey;
        IconGlyph = iconGlyph;
        ShortLabel = shortLabel;
        StateLabel = stateLabel;
        LatencyMs = latencyMs;
        LatencyLabel = latencyLabel;
        ShowLatencySuffix = showLatencySuffix;
        ShowOfflineSuffix = showOfflineSuffix;
        LatencySuffixText = latencySuffixText;
        OfflineSuffixText = offlineSuffixText;
        TooltipText = tooltipText;
        AutomationName = automationName;
        StatusToken = ConnectionSegmentRegistration.StatusToken(status);
        NavigationTarget = ConnectionSegmentRegistration.NavigationTarget;
    }

    /// <summary>The resolved API-connection health (web <c>status</c>).</summary>
    public ApiHealthStatus Status { get; }

    /// <summary>The lowercase status token (web <c>status</c> union): ok / degraded / offline / unknown.</summary>
    public string StatusToken { get; }

    /// <summary>Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</summary>
    public bool IconOnly { get; }

    /// <summary>The generated design-token brush key the dot, icon and label tint from (web <c>cfg[status].text</c> / <c>dot</c>).</summary>
    public string AccentBrushKey { get; }

    /// <summary>The Segoe Fluent glyph (web Lucide Activity / AlertTriangle / CircleSlash / HelpCircle).</summary>
    public string IconGlyph { get; }

    /// <summary>The localized short label, "API" (web <c>cfg[status].short</c>).</summary>
    public string ShortLabel { get; }

    /// <summary>The localized state label: Online / Degraded / Offline / Connecting… (web <c>stateLabel[status]</c>).</summary>
    public string StateLabel { get; }

    /// <summary>The most recent measured round-trip in milliseconds, or null (web <c>latencyMs</c>).</summary>
    public int? LatencyMs { get; }

    /// <summary>The latency display, "{n}ms" or the em dash (web <c>latencyMs != null ? `${latencyMs}ms` : '—'</c>).</summary>
    public string LatencyLabel { get; }

    /// <summary>Whether the chip short label is drawn (web <c>!iconOnly</c>).</summary>
    public bool ShowShortLabel => !IconOnly;

    /// <summary>
    /// Whether the latency suffix is drawn (web <c>!iconOnly &amp;&amp; status !== 'offline' &amp;&amp;
    /// status !== 'unknown' &amp;&amp; latencyMs != null</c>).
    /// </summary>
    public bool ShowLatencySuffix { get; }

    /// <summary>Whether the offline suffix is drawn (web <c>!iconOnly &amp;&amp; status === 'offline'</c>).</summary>
    public bool ShowOfflineSuffix { get; }

    /// <summary>The composed latency suffix, "· {n}ms" (web <c>· {latencyLabel}</c>); empty unless <see cref="ShowLatencySuffix"/>.</summary>
    public string LatencySuffixText { get; }

    /// <summary>The composed offline suffix, "· Offline" (web <c>· {stateLabel.offline}</c>); empty unless <see cref="ShowOfflineSuffix"/>.</summary>
    public string OfflineSuffixText { get; }

    /// <summary>The hover tooltip text (web <c>&lt;Tooltip content&gt;</c>): "API connection · {state}" plus an optional " · {n}ms".</summary>
    public string TooltipText { get; }

    /// <summary>The accessible name (web <c>aria-label</c>): "API connection status: {state}" plus an optional " ({n}ms)".</summary>
    public string AutomationName { get; }

    /// <summary>The route the link navigates to (web <c>to="/system-status"</c>).</summary>
    public string NavigationTarget { get; }

    /// <summary>
    /// Project a snapshot into a render-ready value for the given <paramref name="iconOnly"/> mode, reproducing
    /// the web component body exactly (web/src/components/layout/status-bar/ConnectionSegment.tsx L29-L86): the
    /// per-status <c>cfg</c> table (token accent, Segoe Fluent glyph, short "API" label), the
    /// <c>stateLabel[status]</c> map, the <c>latencyLabel</c> ("{n}ms" or the em dash), the body's two conditional
    /// suffixes (latency when not offline / not unknown with a measurement; the offline label when offline) and
    /// the <c>&lt;Tooltip&gt;</c> / <c>aria-label</c> composition (both append the latency only when a measurement
    /// exists and the status is not offline). Every string flows through the i18n facade.
    /// </summary>
    /// <param name="snapshot">The API-connection read (web <c>useApiHealth()</c> return).</param>
    /// <param name="iconOnly">Whether the compact icon-only mode is rendered (web <c>iconOnly</c> prop).</param>
    /// <param name="localizer">The i18n facade every label resolves through.</param>
    public static ConnectionSegmentProjection Project(
        ApiHealthSnapshot snapshot,
        bool iconOnly,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var status = snapshot.Status;
        var latencyMs = snapshot.LatencyMs;

        // web: const latencyLabel = latencyMs != null ? `${latencyMs}ms` : '—';
        var latencyLabel = latencyMs.HasValue
            ? $"{latencyMs.Value}ms"
            : ConnectionSegmentRegistration.EmDash;

        var stateLabel = ConnectionSegmentRegistration.StateLabel(status, localizer);
        var offlineLabel = ConnectionSegmentRegistration.StateLabel(ApiHealthStatus.Offline, localizer);

        // web body: {status !== 'offline' && status !== 'unknown' && latencyMs != null && (· {latencyLabel})}.
        var showLatencySuffix = !iconOnly
            && status != ApiHealthStatus.Offline
            && status != ApiHealthStatus.Unknown
            && latencyMs.HasValue;

        // web body: {status === 'offline' && (· {stateLabel.offline})}.
        var showOfflineSuffix = !iconOnly && status == ApiHealthStatus.Offline;

        var dot = ConnectionSegmentRegistration.MiddleDot;

        // web Tooltip / aria append the latency only when latencyMs != null && status !== 'offline'.
        var includeMeasurement = latencyMs.HasValue && status != ApiHealthStatus.Offline;

        var tooltip = $"{ConnectionSegmentRegistration.TooltipPrefix(localizer)} {dot} {stateLabel}";
        if (includeMeasurement)
        {
            tooltip += $" {dot} {latencyLabel}";
        }

        var aria = $"{ConnectionSegmentRegistration.AriaPrefix(localizer)}: {stateLabel}";
        if (includeMeasurement)
        {
            aria += $" ({latencyLabel})";
        }

        return new ConnectionSegmentProjection(
            status: status,
            iconOnly: iconOnly,
            accentBrushKey: ConnectionSegmentRegistration.AccentBrushKey(status),
            iconGlyph: ConnectionSegmentRegistration.Glyph(status),
            shortLabel: ConnectionSegmentRegistration.ShortLabel(localizer),
            stateLabel: stateLabel,
            latencyMs: latencyMs,
            latencyLabel: latencyLabel,
            showLatencySuffix: showLatencySuffix,
            showOfflineSuffix: showOfflineSuffix,
            latencySuffixText: showLatencySuffix ? $"{dot} {latencyLabel}" : string.Empty,
            offlineSuffixText: showOfflineSuffix ? $"{dot} {offlineLabel}" : string.Empty,
            tooltipText: tooltip,
            automationName: aria);
    }
}

/// <summary>
/// PII-safe diagnostics for the ConnectionSegment surface (P1/S11 diagnostics contract). The segment carries no
/// user content (only a coarse connection status and a latency number), so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug — never the status or latency. Thread-safe;
/// mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ConnectionSegmentDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ConnectionSegmentDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ConnectionSegment</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ConnectionSegmentRegistration.Slug}");
    }
}

/// <summary>
/// The navigation seam the ConnectionSegment surface routes its link activation through (P1/S8 state-holder
/// layer) — the native analogue of the web <c>&lt;Link to="/system-status"&gt;</c>
/// (web/src/components/layout/status-bar/ConnectionSegment.tsx L63). The view never navigates directly; the host
/// adapter (or a test fake) performs the navigation, so the segment's routing is asserted headlessly.
/// <see cref="NullConnectionSegmentNavigator"/> stands in when no host router is wired (design-time / tests);
/// <see cref="DelegateConnectionSegmentNavigator"/> is the production binding.
/// </summary>
public interface IConnectionSegmentNavigator
{
    /// <summary>Navigate to <paramref name="route"/> (web <c>&lt;Link to={route}&gt;</c> activation).</summary>
    /// <param name="route">The destination route path (no leading slash).</param>
    void Navigate(string route);
}

/// <summary>
/// The inert navigation seam used when no host router is wired — the safe design-time / unit-test default. The
/// operation is a no-op that never throws, mirroring a <c>&lt;Link&gt;</c> rendered outside a router.
/// </summary>
public sealed class NullConnectionSegmentNavigator : IConnectionSegmentNavigator
{
    /// <summary>The shared inert instance.</summary>
    public static NullConnectionSegmentNavigator Instance { get; } = new();

    private NullConnectionSegmentNavigator()
    {
    }

    /// <inheritdoc />
    public void Navigate(string route)
    {
        // No host router wired — navigation is intentionally inert.
    }
}

/// <summary>
/// An <see cref="IConnectionSegmentNavigator"/> that forwards to a caller-supplied callback — the production
/// binding the composition root wires to the shell router (e.g. <c>ShellWindow.NavigateTo</c>).
/// </summary>
public sealed class DelegateConnectionSegmentNavigator : IConnectionSegmentNavigator
{
    private readonly Action<string> _navigate;

    /// <summary>Creates the navigator over the host's navigation callback.</summary>
    /// <param name="navigate">The callback invoked with the destination route.</param>
    public DelegateConnectionSegmentNavigator(Action<string> navigate)
    {
        ArgumentNullException.ThrowIfNull(navigate);
        _navigate = navigate;
    }

    /// <inheritdoc />
    public void Navigate(string route) => _navigate(route);
}
