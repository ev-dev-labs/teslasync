using System.Globalization;
using TeslaSync.App.Core.Data.Net;
using TeslaSync.App.Core.Navigation;
using TeslaSync.App.Core.Notifications;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Core.Widgets;
using TeslaSync.App.Notifications;
using TeslaSync.App.Settings;

namespace TeslaSync.App.Widgets;

/// <summary>The rendered widget payload: the Adaptive Card template, its bound data, and the persisted custom state.</summary>
internal readonly record struct WidgetContent(string Template, string Data, string CustomState);

/// <summary>
/// Bridges the Windows widget provider (P2/W8-0003) to the headless Core projection. It reads the
/// primary vehicle straight from the W5 SQLite response cache (the same file the app's repositories
/// write) — never opening a network request or an SSE stream — applies the W8-0002 unit and privacy
/// preferences, and projects a localized, redacted, freshness-aware Adaptive Card via the Core widget
/// pipeline. Cached-only content correctly reads <c>Stale</c>/<c>Offline</c> once it ages past the
/// two-minute window, so the surface never shows stale data as live.
/// </summary>
internal sealed class WidgetContentService
{
    private readonly IWidgetVehicleSource _source;
    private readonly RouteRegistry _registry;
    private readonly Func<AppSettings> _settings;
    private readonly ILocalizer _localizer;

    internal WidgetContentService(
        IWidgetVehicleSource source,
        RouteRegistry registry,
        Func<AppSettings> settings,
        ILocalizer localizer)
    {
        ArgumentNullException.ThrowIfNull(source);
        ArgumentNullException.ThrowIfNull(registry);
        ArgumentNullException.ThrowIfNull(settings);
        ArgumentNullException.ThrowIfNull(localizer);

        _source = source;
        _registry = registry;
        _settings = settings;
        _localizer = localizer;
    }

    /// <summary>
    /// Builds the default content service over the shared app-local response cache and preferences.
    /// The live store is deliberately omitted: a widget process holds no foreground SSE session, so
    /// freshness derives from the cache age (ADR-009).
    /// </summary>
    public static WidgetContentService CreateDefault()
    {
        var source = new CacheWidgetVehicleSource(AppSettingsHost.Cache, ApiClientOptions.CreateJsonOptions());
        return new WidgetContentService(source, new RouteRegistry(), static () => AppSettingsHost.Current, ShellLocalizer.Instance);
    }

    /// <summary>Builds the vehicle-status widget content from the latest cached state.</summary>
    public WidgetContent BuildVehicleStatus()
    {
        var settings = _settings();
        var privacy = WidgetPrivacyOptions.Create(
            redactSensitiveContent: false,
            telemetryOptIn: settings.TelemetryOptIn,
            notificationsEnabled: true);

        var snapshot = ReadSnapshot() ?? new WidgetVehicleSnapshot();
        var view = WidgetProjection.Project(snapshot, settings.ToUnitPref(), privacy, DateTimeOffset.UtcNow, _registry, _localizer);
        var data = WidgetCardData.Build(view, _localizer);
        var customState = snapshot.VehicleId.ToString(CultureInfo.InvariantCulture);

        return new WidgetContent(WidgetTemplate.VehicleStatus, data, customState);
    }

    private WidgetVehicleSnapshot? ReadSnapshot()
    {
        try
        {
            // The provider callbacks are synchronous; run the cache read off the host thread and block.
            return Task.Run(() => _source.GetPrimaryAsync()).GetAwaiter().GetResult();
        }
        catch (Exception)
        {
            // A missing or unreadable cache simply yields the empty state — never a crash.
            return null;
        }
    }
}
