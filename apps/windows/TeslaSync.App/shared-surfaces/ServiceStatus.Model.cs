using System.Globalization;
using TeslaSync.App.Core.Data.State;
using TeslaSync.App.Core.Notifications;

namespace TeslaSync.App.SharedSurfaces;

/// <summary>
/// The two network connection states the <c>ServiceStatusBanner</c> reacts to — the native analogue of the web
/// <c>RequestStatus = 'online' | 'offline'</c> union (web/src/lib/resilience.ts), which the web
/// <c>ServiceStatusBanner</c> reads through <c>getConnectionStatus()</c> / <c>onStatusChange()</c>
/// (web/src/components/data-display/ServiceStatus.tsx L7-41). Only <see cref="Offline"/> renders the banner.
/// </summary>
public enum ServiceStatusConnectionStatus
{
    /// <summary>The device has a usable connection — the banner is collapsed (web <c>'online'</c>).</summary>
    Online,

    /// <summary>The device is offline — the banner is shown (web <c>'offline'</c>).</summary>
    Offline,
}

/// <summary>
/// The resolved system-health level the <c>SystemHealthDot</c> tints from — the native analogue of the web
/// <c>data.overall</c> branch (web/src/components/data-display/ServiceStatus.tsx L54-66): healthy → green,
/// degraded → amber, anything else → red. <see cref="Unknown"/> is the web <c>!data</c> case (the dot returns
/// <c>null</c> and is not rendered).
/// </summary>
public enum ServiceStatusHealthLevel
{
    /// <summary>No system-status data yet — the dot is not rendered (web <c>if (!data) return null</c>).</summary>
    Unknown,

    /// <summary>The rollup is healthy — green dot (web <c>overall === 'healthy'</c>).</summary>
    Healthy,

    /// <summary>The rollup is degraded — amber dot (web <c>overall === 'degraded'</c>).</summary>
    Degraded,

    /// <summary>The rollup is neither healthy nor degraded — red dot (the web <c>else</c> branch).</summary>
    Unhealthy,
}

/// <summary>
/// The minimal read model the <c>SystemHealthDot</c> consumes — the <c>overall</c> field of the web
/// <c>SystemStatus</c> contract (web/src/lib/resilience.ts L865-882, <c>GET /system/status</c>). The dot reads
/// only <c>overall</c>; the wider contract (<c>database</c> / <c>tesla_api</c> / <c>mqtt</c> / <c>worker</c>) is
/// surfaced by the System Health dashboard widget, not this micro-indicator. Pure data — no WinUI types — so the
/// projection is unit-tested without a UI host.
/// </summary>
/// <param name="Overall">The backend's rollup status string (web <c>data.overall</c>), e.g. "healthy".</param>
public sealed record ServiceStatusReadModel(string Overall);

/// <summary>
/// One immutable connection snapshot — the input the web <c>ServiceStatusBanner</c> reads from the resilience
/// connection state (web/src/components/data-display/ServiceStatus.tsx L8-14). Exposed by the P1/S8
/// <see cref="IServiceStatusConnectionSource"/> and consumed by <see cref="ServiceStatusBannerProjection.Project"/>.
/// </summary>
/// <param name="Status">The current connection status (web <c>connStatus</c>).</param>
public sealed record ServiceStatusConnectionSnapshot(ServiceStatusConnectionStatus Status)
{
    /// <summary>The online snapshot — the banner is collapsed.</summary>
    public static ServiceStatusConnectionSnapshot Online { get; } = new(ServiceStatusConnectionStatus.Online);

    /// <summary>The offline snapshot — the banner is shown.</summary>
    public static ServiceStatusConnectionSnapshot Offline { get; } = new(ServiceStatusConnectionStatus.Offline);

    /// <summary>True while offline (web <c>connStatus === 'offline'</c>): the banner's render gate.</summary>
    public bool IsOffline => Status == ServiceStatusConnectionStatus.Offline;
}

/// <summary>
/// One immutable system-health snapshot — the data the web <c>SystemHealthDot</c> reads from its query result
/// (web/src/components/data-display/ServiceStatus.tsx L45-52). <see cref="Overall"/> is null when no data has
/// resolved (web <c>!data</c>); otherwise it is the backend's rollup string. Exposed by the P1/S8
/// <see cref="IServiceStatusHealthSource"/>. <see cref="FromRepositoryResult"/> derives it from the native
/// cache-then-network <see cref="RepositoryResult{T}"/> exactly as the web <c>useQuery</c> result exposes
/// <c>data</c>: a value-bearing emission yields its <c>overall</c>, while a value-less load/empty/error yields
/// the not-yet-resolved (dot-hidden) snapshot. Pure data — no WinUI types.
/// </summary>
/// <param name="Overall">The backend rollup status (web <c>data.overall</c>), or null when no data resolved.</param>
public sealed record ServiceStatusHealthSnapshot(string? Overall)
{
    /// <summary>The not-yet-resolved snapshot — no data, the dot is not rendered (web <c>!data</c>).</summary>
    public static ServiceStatusHealthSnapshot None { get; } = new((string?)null);

    /// <summary>True once a status value has resolved (web <c>data</c> is defined): the dot's render gate.</summary>
    public bool HasData => Overall is not null;

    /// <summary>The resolved health level (web's healthy / degraded / else branch).</summary>
    public ServiceStatusHealthLevel Level => ServiceStatusRegistration.ClassifyHealth(Overall);

    /// <summary>
    /// Derive a snapshot from a cache-then-network <see cref="RepositoryResult{T}"/> — the native port of the web
    /// <c>useQuery</c> <c>data</c> exposure (web/src/components/data-display/ServiceStatus.tsx L45-52). A
    /// value-bearing emission (cached / refreshing / loaded / offline-cached) surfaces its
    /// <see cref="ServiceStatusReadModel.Overall"/> — so a transient refresh or an offline-cached read keeps the
    /// last known dot exactly as a TanStack query retains <c>data</c> across a refetch — while a value-less
    /// load / empty / hard-error emission surfaces <see cref="None"/> (the web <c>!data</c> dot-hidden case).
    /// </summary>
    /// <param name="result">The repository emission to project.</param>
    public static ServiceStatusHealthSnapshot FromRepositoryResult(RepositoryResult<ServiceStatusReadModel> result)
    {
        ArgumentNullException.ThrowIfNull(result);

        return result.HasValue && result.Value is { } value
            ? new ServiceStatusHealthSnapshot(value.Overall)
            : None;
    }
}

/// <summary>
/// Canonical metadata for the ServiceStatus surface — the native analogue of the module-level literals and the
/// <c>overall</c> colour table in web/src/components/data-display/ServiceStatus.tsx. Carries the diagnostics slug,
/// the banner / dot automation ids, the i18n keys (each with the English fallback the web renders verbatim — the
/// web has no <c>t()</c> calls, so these keys are introduced for the WinUI i18n catalogue), the generated
/// design-token brush keys the three health levels tint from, the danger colour / opacity recipe the offline
/// banner is tinted with, and the Segoe Fluent glyph standing in for the web Lucide <c>WifiOff</c> icon. UI-free
/// so it is asserted in tests.
/// </summary>
public static class ServiceStatusRegistration
{
    /// <summary>Diagnostics surface slug emitted with the <c>view.opened</c> event (P1/S11 contract).</summary>
    public const string Slug = "ServiceStatus";

    /// <summary>The automation id Narrator and UI-automation resolve the offline banner by.</summary>
    public const string BannerAutomationId = "service-status-banner";

    /// <summary>The automation id Narrator and UI-automation resolve the system-health dot by.</summary>
    public const string HealthDotAutomationId = "system-health-dot";

    /// <summary>ARIA role both sub-surfaces expose — a read-only status region (web is non-interactive).</summary>
    public const string StatusRole = "status";

    /// <summary>ARIA live urgency both sub-surfaces declare (a polite, non-interrupting announcement).</summary>
    public const string LiveSetting = "polite";

    /// <summary>Generated design-token brush key for the healthy dot (web <c>bg-neon-green</c>).</summary>
    public const string HealthyBrushKey = "TsColorSuccessBrush";

    /// <summary>Generated design-token brush key for the degraded dot (web <c>bg-neon-amber</c>).</summary>
    public const string DegradedBrushKey = "TsColorWarningBrush";

    /// <summary>Generated design-token brush key for the unhealthy dot (web <c>bg-neon-red</c>).</summary>
    public const string UnhealthyBrushKey = "TsColorDangerBrush";

    /// <summary>Generated design-token colour key the offline banner tint and the dot glow are derived from (web red-500).</summary>
    public const string DangerColorKey = "TsColorDangerColor";

    /// <summary>Generated design-token brush key for the offline banner foreground (web <c>#f87171</c>).</summary>
    public const string DangerBrushKey = "TsColorDangerBrush";

    /// <summary>Offline banner background alpha over the danger colour (web <c>rgba(239,68,68,0.15)</c>).</summary>
    public const double BannerBackgroundOpacity = 0.15;

    /// <summary>Offline banner bottom-border alpha over the danger colour (web <c>rgba(239,68,68,0.2)</c>).</summary>
    public const double BannerBorderOpacity = 0.20;

    /// <summary>Dot glow alpha over the level colour (web <c>shadow-[0_0_6px_rgba(...,0.5)]</c>).</summary>
    public const double DotGlowOpacity = 0.50;

    /// <summary>Segoe Fluent "offline" glyph — the native stand-in for the web Lucide <c>WifiOff</c> icon.</summary>
    public const string WifiOffGlyph = "\uEB5E";

    /// <summary>The web <c>data.overall</c> token for the healthy branch.</summary>
    public const string HealthyToken = "healthy";

    /// <summary>The web <c>data.overall</c> token for the degraded branch.</summary>
    public const string DegradedToken = "degraded";

    /// <summary>The web <c>data.overall</c> token for the canonical unhealthy branch.</summary>
    public const string UnhealthyToken = "unhealthy";

    /// <summary>i18n key for the offline banner message (web literal at ServiceStatus.tsx L35).</summary>
    public const string OfflineBannerKey = "translation.serviceStatus.offlineBanner";

    /// <summary>English fallback for <see cref="OfflineBannerKey"/> — the web literal, verbatim (ASCII ellipsis).</summary>
    public const string OfflineBannerFallback = "You are offline. Data may be stale. Reconnecting automatically...";

    /// <summary>i18n key for the dot tooltip / accessible name (web <c>title={`System: ${data.overall}`}</c>; <c>{0}</c>=status).</summary>
    public const string SystemTooltipKey = "translation.serviceStatus.systemTooltip";

    /// <summary>English fallback for <see cref="SystemTooltipKey"/> — the web literal with the .NET positional format argument.</summary>
    public const string SystemTooltipFallback = "System: {0}";

    /// <summary>i18n key for the localized "healthy" status word interpolated into the tooltip.</summary>
    public const string HealthyLabelKey = "translation.serviceStatus.health.healthy";

    /// <summary>English fallback for <see cref="HealthyLabelKey"/> — the web <c>overall</c> token, verbatim.</summary>
    public const string HealthyLabelFallback = "healthy";

    /// <summary>i18n key for the localized "degraded" status word interpolated into the tooltip.</summary>
    public const string DegradedLabelKey = "translation.serviceStatus.health.degraded";

    /// <summary>English fallback for <see cref="DegradedLabelKey"/> — the web <c>overall</c> token, verbatim.</summary>
    public const string DegradedLabelFallback = "degraded";

    /// <summary>i18n key for the localized "unhealthy" status word interpolated into the tooltip.</summary>
    public const string UnhealthyLabelKey = "translation.serviceStatus.health.unhealthy";

    /// <summary>English fallback for <see cref="UnhealthyLabelKey"/> — the web <c>overall</c> token, verbatim.</summary>
    public const string UnhealthyLabelFallback = "unhealthy";

    /// <summary>Classify a raw <c>overall</c> value into a level (web healthy / degraded / else; null → unknown).</summary>
    /// <param name="overall">The backend rollup string, or null when no data resolved.</param>
    public static ServiceStatusHealthLevel ClassifyHealth(string? overall) => overall switch
    {
        null => ServiceStatusHealthLevel.Unknown,
        HealthyToken => ServiceStatusHealthLevel.Healthy,
        DegradedToken => ServiceStatusHealthLevel.Degraded,
        _ => ServiceStatusHealthLevel.Unhealthy,
    };

    /// <summary>The generated design-token brush key the <paramref name="level"/> dot tints from (web colour table).</summary>
    /// <param name="level">The resolved health level.</param>
    public static string HealthBrushKey(ServiceStatusHealthLevel level) => level switch
    {
        ServiceStatusHealthLevel.Healthy => HealthyBrushKey,
        ServiceStatusHealthLevel.Degraded => DegradedBrushKey,
        _ => UnhealthyBrushKey,
    };

    /// <summary>
    /// The display string for a raw <c>overall</c> value — the canonical healthy / degraded / unhealthy tokens
    /// resolve through the localizer, while any other backend value is passed through verbatim (the web shows the
    /// raw <c>data.overall</c> string in the tooltip, so a non-canonical status is never swallowed).
    /// </summary>
    /// <param name="overall">The backend rollup string, or null when no data resolved.</param>
    /// <param name="localizer">The i18n facade the canonical words resolve through.</param>
    public static string HealthDisplay(string? overall, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(localizer);

        return overall switch
        {
            null => string.Empty,
            HealthyToken => localizer.GetString(HealthyLabelKey, HealthyLabelFallback),
            DegradedToken => localizer.GetString(DegradedLabelKey, DegradedLabelFallback),
            UnhealthyToken => localizer.GetString(UnhealthyLabelKey, UnhealthyLabelFallback),
            _ => overall,
        };
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="ServiceStatusConnectionSnapshot"/> — everything the web
/// <c>ServiceStatusBanner</c> derives before returning JSX (web/src/components/data-display/ServiceStatus.tsx
/// L16-39): whether the banner is shown (<see cref="IsVisible"/> — the web <c>isOffline</c> +
/// <c>AnimatePresence</c> gate), the localized offline <see cref="Message"/>, the <see cref="AccessibleName"/> a
/// screen reader announces (the same message — the web banner is read as a status), and the ARIA
/// <see cref="LiveSetting"/>. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct ServiceStatusBannerProjection
{
    private ServiceStatusBannerProjection(bool isVisible, string message, string accessibleName, string liveSetting)
    {
        IsVisible = isVisible;
        Message = message;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the banner is shown — the web <c>isOffline</c> render gate.</summary>
    public bool IsVisible { get; }

    /// <summary>The localized offline message (web literal at ServiceStatus.tsx L35).</summary>
    public string Message { get; }

    /// <summary>The accessible name a screen reader announces — the offline message.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the banner declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a connection snapshot into a render-ready banner value, reproducing the web component
    /// (web/src/components/data-display/ServiceStatus.tsx L14-39): the banner is visible only while offline, and
    /// always carries the localized offline message it announces when shown.
    /// </summary>
    /// <param name="snapshot">The connection inputs (web <c>connStatus</c>).</param>
    /// <param name="localizer">The i18n facade the message resolves through.</param>
    public static ServiceStatusBannerProjection Project(ServiceStatusConnectionSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var message = localizer.GetString(
            ServiceStatusRegistration.OfflineBannerKey,
            ServiceStatusRegistration.OfflineBannerFallback);

        return new ServiceStatusBannerProjection(
            isVisible: snapshot.IsOffline,
            message: message,
            accessibleName: message,
            liveSetting: ServiceStatusRegistration.LiveSetting);
    }
}

/// <summary>
/// The fully projected, render-ready view of a <see cref="ServiceStatusHealthSnapshot"/> — everything the web
/// <c>SystemHealthDot</c> derives before returning JSX (web/src/components/data-display/ServiceStatus.tsx
/// L52-73): whether the dot is rendered (<see cref="IsVisible"/> — the web <c>!data</c> gate), the resolved
/// <see cref="Level"/> and the generated-token <see cref="AccentBrushKey"/> it tints from (web colour table), the
/// localized <see cref="Tooltip"/> (web <c>title</c>) which is also the dot's <see cref="AccessibleName"/>, and
/// the ARIA <see cref="LiveSetting"/>. Pure value type so every field is asserted headlessly.
/// </summary>
public readonly record struct ServiceStatusHealthDotProjection
{
    private ServiceStatusHealthDotProjection(
        bool isVisible,
        ServiceStatusHealthLevel level,
        string accentBrushKey,
        string tooltip,
        string accessibleName,
        string liveSetting)
    {
        IsVisible = isVisible;
        Level = level;
        AccentBrushKey = accentBrushKey;
        Tooltip = tooltip;
        AccessibleName = accessibleName;
        LiveSetting = liveSetting;
    }

    /// <summary>Whether the dot is rendered — the web <c>if (!data) return null</c> gate.</summary>
    public bool IsVisible { get; }

    /// <summary>The resolved health level (web healthy / degraded / else).</summary>
    public ServiceStatusHealthLevel Level { get; }

    /// <summary>The generated design-token brush key the dot tints from (web colour table).</summary>
    public string AccentBrushKey { get; }

    /// <summary>The hover / Narrator tooltip (web <c>title={`System: ${data.overall}`}</c>).</summary>
    public string Tooltip { get; }

    /// <summary>The accessible name a screen reader announces — the same "System: {status}" string.</summary>
    public string AccessibleName { get; }

    /// <summary>The ARIA live urgency the dot declares (polite).</summary>
    public string LiveSetting { get; }

    /// <summary>
    /// Project a health snapshot into a render-ready dot value, reproducing the web component
    /// (web/src/components/data-display/ServiceStatus.tsx L52-73): the dot is rendered only once data resolves,
    /// tints from the level's token brush, and carries the localized "System: {status}" tooltip / accessible name
    /// (the status word localized for the canonical levels, the raw backend value otherwise).
    /// </summary>
    /// <param name="snapshot">The health inputs (web query <c>data</c>).</param>
    /// <param name="localizer">The i18n facade the tooltip resolves through.</param>
    public static ServiceStatusHealthDotProjection Project(ServiceStatusHealthSnapshot snapshot, ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        ArgumentNullException.ThrowIfNull(localizer);

        var level = snapshot.Level;
        var display = ServiceStatusRegistration.HealthDisplay(snapshot.Overall, localizer);
        var tooltip = string.Format(
            CultureInfo.CurrentCulture,
            localizer.GetString(ServiceStatusRegistration.SystemTooltipKey, ServiceStatusRegistration.SystemTooltipFallback),
            display);

        return new ServiceStatusHealthDotProjection(
            isVisible: snapshot.HasData,
            level: level,
            accentBrushKey: ServiceStatusRegistration.HealthBrushKey(level),
            tooltip: tooltip,
            accessibleName: tooltip,
            liveSetting: ServiceStatusRegistration.LiveSetting);
    }
}

/// <summary>
/// PII-safe diagnostics for the ServiceStatus surface (P1/S11 diagnostics contract). The banner and dot carry no
/// user content (only a connection state and an opaque health word), so the collector records ONLY the
/// operational <c>view.opened</c> event with the surface slug — never the connection state or the health value.
/// Thread-safe; mirrors the peer surfaces' diagnostics collectors.
/// </summary>
public sealed class ServiceStatusDiagnostics
{
    private readonly Action<string>? _sink;
    private long _viewsOpened;

    /// <summary>Creates the collector over an optional PII-safe diagnostics sink.</summary>
    /// <param name="sink">The sink the <c>view.opened</c> line is written to, or null.</param>
    public ServiceStatusDiagnostics(Action<string>? sink = null) => _sink = sink;

    /// <summary>Number of times the surface has been opened.</summary>
    public long ViewsOpened => Interlocked.Read(ref _viewsOpened);

    /// <summary>Record that the surface was opened, emitting <c>view.opened slug=ServiceStatus</c>.</summary>
    public void RecordViewOpened()
    {
        Interlocked.Increment(ref _viewsOpened);
        _sink?.Invoke($"view.opened slug={ServiceStatusRegistration.Slug}");
    }
}
