using System.IO;
using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Settings;
using TeslaSync.App.Platform;
using Windows.Storage;

namespace TeslaSync.App.Settings;

/// <summary>
/// Composition root for Windows application settings (P2/W8-0002). It wires the shared
/// <see cref="AppSettingsService"/> over the Credential-Locker-free,
/// <c>ApplicationData.LocalSettings</c>-backed <see cref="LocalSettingsAppSettingsStore"/>, and owns
/// the single response-cache handle the "cache size / clear" affordance operates on (pointed at the
/// same app-local SQLite file the W5 data layer uses).
///
/// <para>This is the boundary that keeps the three storage tiers separated: non-secret preferences
/// here, tokens in <see cref="AppAuth"/>'s Credential-Locker store, cached payloads in SQLite. Failures
/// in an unpackaged dev run degrade to defaults rather than crashing launch.</para>
/// </summary>
public static class AppSettingsHost
{
    private const string CacheFileName = "teslasync-cache.db";

    private static readonly Lazy<AppSettingsService> LazyService = new(CreateService);
    private static readonly Lazy<ICacheStore> LazyCache = new(CreateCache);

    /// <summary>The shared settings service (lazily constructed, process-singleton).</summary>
    public static AppSettingsService Service => LazyService.Value;

    /// <summary>The app-local response cache the settings surface manages (size/clear).</summary>
    public static ICacheStore Cache => LazyCache.Value;

    /// <summary>The current settings snapshot.</summary>
    public static AppSettings Current => Service.Current;

    /// <summary>A settings view-model bound to the shared service and response cache.</summary>
    public static SettingsViewModel CreateViewModel() => new(Service, Cache);

    /// <summary>
    /// Loads the persisted settings into the service. Safe to call once at startup; failures (e.g. no
    /// package identity) leave the privacy-first defaults in place rather than crashing.
    /// </summary>
    public static async Task InitializeAsync(CancellationToken cancellationToken = default)
    {
        try
        {
            await Service.LoadAsync(cancellationToken).ConfigureAwait(false);
        }
        catch (Exception)
        {
            // Best-effort load; an unreadable store simply means "defaults".
        }
    }

    private static AppSettingsService CreateService() =>
        new(new LocalSettingsAppSettingsStore());

    private static SqliteCacheStore CreateCache() =>
        new(new CacheOptions
        {
            ConnectionString = ResolveCacheConnectionString(),
            MaxEntries = Current.MaxCacheEntries,
        });

    private static string ResolveCacheConnectionString()
    {
        try
        {
            var path = Path.Combine(ApplicationData.Current.LocalFolder.Path, CacheFileName);
            return $"Data Source={path}";
        }
        catch (Exception)
        {
            // No package identity (unpackaged dev run) — fall back to a working-directory file.
            return $"Data Source={CacheFileName}";
        }
    }
}
