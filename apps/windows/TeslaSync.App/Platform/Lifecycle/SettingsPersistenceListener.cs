using TeslaSync.App.Core.Data.Cache;
using TeslaSync.App.Core.Lifecycle;
using TeslaSync.App.Core.Settings;

namespace TeslaSync.App.Platform.Lifecycle;

/// <summary>
/// The <see cref="ILifecycleListener"/> that keeps durable state crash-safe (P2/W8-0002). On every
/// suspend / window-close / fatal-error it flushes the non-secret <see cref="AppSettingsService"/> and
/// runs the host-supplied window-state persist callback; when the app is backgrounded it bounds the
/// W5 response cache on a fire-and-forget task so teardown is never blocked on SQLite I/O.
///
/// <para>The fatal-error path does the minimum (a synchronous settings flush) so an unhandled-exception
/// handler can persist preferences before the process dies without risking a blocking cache write.</para>
/// </summary>
public sealed class SettingsPersistenceListener : ILifecycleListener
{
    private readonly AppSettingsService _settings;
    private readonly ICacheStore? _cache;
    private readonly Action<LifecycleShutdownReason>? _persistExtra;

    /// <summary>Creates the listener over the settings service, the optional cache, and a persist hook.</summary>
    public SettingsPersistenceListener(
        AppSettingsService settings,
        ICacheStore? cache = null,
        Action<LifecycleShutdownReason>? persistExtra = null)
    {
        ArgumentNullException.ThrowIfNull(settings);
        _settings = settings;
        _cache = cache;
        _persistExtra = persistExtra;
    }

    /// <inheritdoc />
    public void OnLifecycleStateChanged(AppLifecycleState previous, AppLifecycleState current)
    {
        // Bound the cache when the app is parked in the background — off the teardown path.
        if (current == AppLifecycleState.Suspended)
        {
            TrimCacheInBackground();
        }
    }

    /// <inheritdoc />
    public void OnNetworkChanged(bool isOnline)
    {
        // Connectivity is surfaced by the live presenter; nothing to persist here.
    }

    /// <inheritdoc />
    public void PersistForShutdown(LifecycleShutdownReason reason)
    {
        try
        {
            // The LocalSettings write completes synchronously, so this never blocks meaningfully.
            _settings.FlushAsync().GetAwaiter().GetResult();
        }
        catch (Exception)
        {
            // Crash-safe save is best-effort; a store failure must not mask the original teardown.
        }

        try
        {
            _persistExtra?.Invoke(reason);
        }
        catch (Exception)
        {
            // The window-state persist is cosmetic; never let it cascade.
        }
    }

    private void TrimCacheInBackground()
    {
        var cache = _cache;
        if (cache is null)
        {
            return;
        }

        _ = Task.Run(async () =>
        {
            try
            {
                await cache.EvictAsync().ConfigureAwait(false);
            }
            catch (Exception)
            {
                // Eviction is opportunistic; a failure simply leaves the cache larger for now.
            }
        });
    }
}
